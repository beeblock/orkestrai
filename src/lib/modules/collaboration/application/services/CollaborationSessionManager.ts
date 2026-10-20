import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { uuidv7 } from '@beeblock/svelar/support';
import {
  COLLABORATION_PROTOCOL,
  SecureCollaborationChannel,
  collaborationEnvelopeSchema,
  derivePairingMaterial,
  deriveSessionMaterial,
  generateHandshakeNonce,
  parseInviteUri,
  type CollaborationEnvelope,
  type CollaborationMessage,
} from '@orkestrai/collaboration-protocol';
import type { CollaborationCommand, CollaborationCommandResult, CollaborationReadCommand, SharedChatPageDto, SharedWorkspaceDto } from '../../domain/types.js';
import { collaborationRepository } from '../../infrastructure/repositories/CollaborationRepository.js';
import { scopeSharedWorkspaceSnapshot, sharedWorkspaceQuery } from '../queries/SharedWorkspaceQuery.js';
import { ExecuteCollaborationCommandDto } from '../dto/CollaborationDto.js';
import { chatReadCommandSchema, collaborationCommandSchema } from '../../contracts/schemas/collaboration.schema.js';
import { sharedWorkspaceCommandBus } from './SharedWorkspaceCommandBus.js';
import { collaborationRuntime } from './CollaborationRuntime.js';
import { withCollaborationShareLock } from './CollaborationShareLock.js';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { voiceService, VOICE_MODELS_MISSING_ERROR } from '$lib/modules/agent-room/application/services/VoiceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

const MAX_REMOTE_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_REMOTE_VOICE_CHUNK_BYTES = 48 * 1024;
const MAX_REMOTE_VOICE_REQUESTS_PER_MINUTE = 6;
const MAX_CHAT_READS_PER_MINUTE = 40;
// A remote terminal opens with as much recent output as one frame carries: the
// protocol allows 98,304 characters, and JSON turns each escape byte into six.
const TERMINAL_REPLAY_LIMITS = [96_000, 64_000, 40_000, 24_000, 12_000] as const;
const TERMINAL_REPLAY_MAX_JSON_BYTES = 120_000;

type HostVoiceRequest = {
  requestId: string;
  language: 'auto' | 'pt' | 'en' | 'es';
  byteLength: number;
  chunkCount: number;
  chunks: Buffer[];
  receivedBytes: number;
  timer: ReturnType<typeof setTimeout>;
};

type HostTerminalAttachment = {
  nodeId: string;
  sessionId: string;
  detach: () => void;
};

type HostPeer = {
  peerId: string;
  deviceRecordId: string;
  guestNonce: string;
  pairingSecret: string;
  pairingChannel: SecureCollaborationChannel;
  sessionChannel: SecureCollaborationChannel | null;
  terminal: HostTerminalAttachment | null;
  inputWindowStartedAt: number;
  inputBytesInWindow: number;
  voiceRequest: HostVoiceRequest | null;
  voiceTranscribing: boolean;
  voiceWindowStartedAt: number;
  voiceRequestsInWindow: number;
  eventSequence: number;
  chatReadWindowStartedAt: number;
  chatReadsInWindow: number;
};

type HostSession = {
  shareId: string;
  workspaceId: string;
  relayUrl: string;
  socket: WebSocket | null;
  peers: Map<string, HostPeer>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  lastProjectionHash: string | null;
  projectionTimer: ReturnType<typeof setInterval> | null;
  transportState: 'connecting' | 'connected' | 'reconnecting' | 'offline';
};

export type RemoteCollaborationState = {
  status: 'idle' | 'connecting' | 'waiting_approval' | 'connected' | 'reconnecting' | 'rejected' | 'expired' | 'offline' | 'incompatible' | 'revoked' | 'error';
  shareId: string | null;
  hostDeviceId: string | null;
  deviceId: string | null;
  displayName: string | null;
  role: string | null;
  scopes: string[];
  revision: number;
  snapshot: SharedWorkspaceDto | null;
  errorCode: string | null;
};

type GuestSession = {
  shareId: string;
  pairingSecret: string;
  relayUrl: string;
  deviceId: string;
  displayName: string;
  platform: 'darwin' | 'win32' | 'linux' | 'ios' | 'android' | 'web';
  guestNonce: string;
  hostDeviceId: string | null;
  socket: WebSocket | null;
  pairingChannel: SecureCollaborationChannel | null;
  sessionChannel: SecureCollaborationChannel | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  state: RemoteCollaborationState;
  commands: Map<string, { resolve: (value: CollaborationCommandResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  chatReads: Map<string, { resolve: (page: SharedChatPageDto) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
};

type ManagerState = { hosts: Map<string, HostSession>; guest: GuestSession | null };
const globalKey = Symbol.for('orkestrai.collaborationSessionManager');
const globals = globalThis as typeof globalThis & { [globalKey]?: ManagerState };
const managerState = globals[globalKey] ??= { hosts: new Map(), guest: null };

function websocketDataText(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Recent output of a live session that fits one frame, with the modes it relies on. */
function terminalReplay(sessionId: string): string {
  for (const limit of TERMINAL_REPLAY_LIMITS) {
    const replay = ptySessionManager.replay(sessionId, limit);
    if (Buffer.byteLength(JSON.stringify(replay)) <= TERMINAL_REPLAY_MAX_JSON_BYTES) return replay;
  }
  return ptySessionManager.replay(sessionId, 6_000);
}

export class CollaborationSessionManager {
  async startHost(shareId: string): Promise<void> {
    const share = await collaborationRepository.findShare(shareId);
    if (!share || share.status !== 'active') throw new Error('SHARE_NOT_FOUND');
    if (!collaborationRuntime.get(shareId)) collaborationRuntime.create(shareId);
    const existing = managerState.hosts.get(shareId);
    if (existing) this.stopHost(shareId);
    const host: HostSession = {
      shareId, workspaceId: share.workspaceId, relayUrl: share.relayUrl,
      socket: null, peers: new Map(), reconnectTimer: null, stopped: false,
      lastProjectionHash: null, projectionTimer: null,
      transportState: 'connecting',
    };
    managerState.hosts.set(shareId, host);
    this.connectHost(host);
    void usageService.getAll(false).then(() => this.publishChangedSnapshot(host)).catch(() => undefined);
    host.projectionTimer = setInterval(() => void this.publishChangedSnapshot(host).catch(() => undefined), 5_000);
    host.projectionTimer.unref?.();
  }

  stopHost(shareId: string, reason: 'revoked' | 'expired' = 'revoked'): void {
    const host = managerState.hosts.get(shareId);
    if (!host) return;
    host.stopped = true;
    if (host.reconnectTimer) clearTimeout(host.reconnectTimer);
    if (host.projectionTimer) clearInterval(host.projectionTimer);
    for (const peer of host.peers.values()) {
      this.detachTerminal(peer);
      this.clearVoiceRequest(peer);
      try {
        this.send(host.socket, peer.pairingChannel.encrypt({ type: 'join.rejected', reason }, peer.peerId));
      } catch {
        // A closed or partially paired peer has no access left to revoke.
      }
    }
    host.socket?.close(1000, 'Sharing stopped.');
    host.peers.clear();
    managerState.hosts.delete(shareId);
  }

  async approvePeer(shareId: string, deviceRecordId: string): Promise<void> {
    const host = managerState.hosts.get(shareId);
    const runtime = collaborationRuntime.get(shareId);
    const device = await collaborationRepository.findDevice(deviceRecordId);
    if (!host || !runtime || !device?.approvedAt || device.revokedAt) return;
    const peer = [...host.peers.values()].find((candidate) => candidate.deviceRecordId === deviceRecordId);
    if (!peer) return;
    if (!device.scopes.includes('terminal.control')) this.detachTerminal(peer);
    const sessionId = `session_${uuidv7().replaceAll('-', '_')}`;
    this.send(host.socket, peer.pairingChannel.encrypt({
      type: 'join.approved',
      sessionId,
      hostNonce: runtime.hostNonce,
      role: device.role,
      scopes: device.scopes,
      workspace: { name: (await sharedWorkspaceQuery.snapshot(shareId)).workspace.name, icon: null },
    }, peer.peerId));
    const sessionMaterial = deriveSessionMaterial({
      pairingSecret: peer.pairingSecret, shareId, sessionId,
      hostNonce: runtime.hostNonce, guestNonce: peer.guestNonce,
    });
    peer.sessionChannel = new SecureCollaborationChannel({
      role: 'host', shareId, localDeviceId: runtime.hostDeviceId, remoteDeviceId: peer.peerId, material: sessionMaterial,
    });
    await this.sendSnapshot(host, peer);
    collaborationRuntime.rotatePairing(shareId);
  }

  hostStatus(shareId: string): { state: HostSession['transportState']; connectedPeers: number } {
    const host = managerState.hosts.get(shareId);
    return host
      ? { state: host.transportState, connectedPeers: [...host.peers.values()].filter((peer) => peer.sessionChannel).length }
      : { state: 'offline', connectedPeers: 0 };
  }

  async rejectPeer(shareId: string, deviceRecordId: string, reason: 'denied' | 'revoked' = 'denied'): Promise<void> {
    const host = managerState.hosts.get(shareId);
    const peer = host ? [...host.peers.values()].find((candidate) => candidate.deviceRecordId === deviceRecordId) : null;
    if (host && peer) {
      this.detachTerminal(peer);
      this.clearVoiceRequest(peer);
      this.send(host.socket, peer.pairingChannel.encrypt({ type: 'join.rejected', reason: reason === 'revoked' ? 'revoked' : 'denied' }, peer.peerId));
      peer.sessionChannel = null;
      host.peers.delete(peer.peerId);
    }
    if (collaborationRuntime.get(shareId)) collaborationRuntime.rotatePairing(shareId);
  }

  async join(input: {
    inviteUri: string; relayUrl: string; displayName: string; platform: 'darwin' | 'win32' | 'linux' | 'ios' | 'android' | 'web';
  }): Promise<RemoteCollaborationState> {
    this.leaveGuest();
    const invite = parseInviteUri(input.inviteUri);
    this.assertRelayUrl(input.relayUrl);
    const guestNonce = generateHandshakeNonce();
    const deviceId = `guest_${uuidv7().replaceAll('-', '_')}`;
    const guest: GuestSession = {
      shareId: invite.shareId, pairingSecret: invite.pairingSecret, relayUrl: input.relayUrl,
      deviceId, displayName: input.displayName.trim().slice(0, 80), platform: input.platform,
      guestNonce, hostDeviceId: null, socket: null, pairingChannel: null, sessionChannel: null,
      reconnectTimer: null, stopped: false, commands: new Map(), chatReads: new Map(),
      state: {
        status: 'connecting', shareId: invite.shareId, hostDeviceId: null, deviceId,
        displayName: input.displayName.trim().slice(0, 80), role: null, scopes: [], revision: 0,
        snapshot: null, errorCode: null,
      },
    };
    managerState.guest = guest;
    this.connectGuest(guest);
    return guest.state;
  }

  guestStatus(): RemoteCollaborationState {
    return managerState.guest?.state ?? {
      status: 'idle', shareId: null, hostDeviceId: null, deviceId: null, displayName: null,
      role: null, scopes: [], revision: 0, snapshot: null, errorCode: null,
    };
  }

  leaveGuest(): void {
    const guest = managerState.guest;
    if (!guest) return;
    guest.stopped = true;
    if (guest.reconnectTimer) clearTimeout(guest.reconnectTimer);
    guest.socket?.close(1000, 'Guest left.');
    for (const pending of guest.commands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Remote workspace disconnected.'));
    }
    guest.commands.clear();
    for (const pending of guest.chatReads.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Remote workspace disconnected.'));
    }
    guest.chatReads.clear();
    guest.pairingSecret = '';
    guest.pairingChannel = null;
    guest.sessionChannel = null;
    managerState.guest = null;
  }

  async sendGuestCommand(command: CollaborationCommand): Promise<CollaborationCommandResult> {
    const guest = managerState.guest;
    if (!guest?.sessionChannel || !guest.socket || guest.socket.readyState !== WebSocket.OPEN) throw new Error('REMOTE_WORKSPACE_OFFLINE');
    const commandId = `command_${uuidv7().replaceAll('-', '_')}`;
    const message: CollaborationMessage = { type: 'command', commandId, revision: guest.state.revision, command };
    const result = new Promise<CollaborationCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        guest.commands.delete(commandId);
        reject(new Error('REMOTE_COMMAND_TIMEOUT'));
      }, 20_000);
      timer.unref?.();
      guest.commands.set(commandId, { resolve, reject, timer });
    });
    this.send(guest.socket, guest.sessionChannel.encrypt(message, guest.hostDeviceId));
    return result;
  }

  /** A page of one channel of the host's Conversa (see `chat.read`). */
  async readGuestChat(channel: string, before: string | null = null, beforeId: string | null = null): Promise<SharedChatPageDto> {
    const guest = managerState.guest;
    if (!guest?.sessionChannel || !guest.socket || guest.socket.readyState !== WebSocket.OPEN) throw new Error('REMOTE_WORKSPACE_OFFLINE');
    const commandId = `read_${uuidv7().replaceAll('-', '_')}`;
    const read: CollaborationReadCommand = { type: 'chat.read', channel, before, ...(before && beforeId ? { beforeId } : {}) };
    const message = { type: 'command', commandId, revision: guest.state.revision, command: read } as CollaborationMessage;
    const page = new Promise<SharedChatPageDto>((resolve, reject) => {
      const timer = setTimeout(() => {
        guest.chatReads.delete(commandId);
        reject(new Error('REMOTE_COMMAND_TIMEOUT'));
      }, 20_000);
      timer.unref?.();
      guest.chatReads.set(commandId, { resolve, reject, timer });
    });
    this.send(guest.socket, guest.sessionChannel.encrypt(message, guest.hostDeviceId));
    return page;
  }

  shutdown(): void {
    for (const shareId of [...managerState.hosts.keys()]) this.stopHost(shareId);
    this.leaveGuest();
  }

  private connectHost(host: HostSession): void {
    const runtime = collaborationRuntime.get(host.shareId);
    if (!runtime || host.stopped) return;
    const socket = new WebSocket(this.relayConnectionUrl(host.relayUrl, host.shareId, runtime.hostDeviceId, 'host'), COLLABORATION_PROTOCOL, { perMessageDeflate: false });
    host.socket = socket;
    socket.on('open', () => { host.transportState = 'connected'; });
    socket.on('message', (data) => void this.handleHostMessage(host, websocketDataText(data)).catch((error) => {
      console.error('[orkestrai:collaboration] Host frame failed:', error);
    }));
    socket.on('close', () => {
      host.socket = null;
      host.transportState = host.stopped ? 'offline' : 'reconnecting';
      for (const peer of host.peers.values()) peer.sessionChannel = null;
      for (const peer of host.peers.values()) this.detachTerminal(peer);
      for (const peer of host.peers.values()) this.clearVoiceRequest(peer);
      if (!host.stopped) host.reconnectTimer = setTimeout(() => this.connectHost(host), 2_000);
    });
    socket.on('error', () => undefined);
  }

  private async handleHostMessage(host: HostSession, raw: string): Promise<void> {
    const envelope = collaborationEnvelopeSchema.parse(JSON.parse(raw)) as CollaborationEnvelope;
    let peer = host.peers.get(envelope.senderDeviceId);
    if (!peer) {
      const runtime = collaborationRuntime.get(host.shareId);
      if (!runtime?.pairingSecret) return;
      peer = {
        peerId: envelope.senderDeviceId, deviceRecordId: '', guestNonce: '',
        pairingSecret: runtime.pairingSecret,
        pairingChannel: new SecureCollaborationChannel({
          role: 'host', shareId: host.shareId, localDeviceId: runtime.hostDeviceId,
          remoteDeviceId: envelope.senderDeviceId,
          material: derivePairingMaterial({ pairingSecret: runtime.pairingSecret, shareId: host.shareId }),
        }),
        sessionChannel: null,
        terminal: null,
        inputWindowStartedAt: Date.now(),
        inputBytesInWindow: 0,
        voiceRequest: null,
        voiceTranscribing: false,
        voiceWindowStartedAt: Date.now(),
        voiceRequestsInWindow: 0,
        eventSequence: 0,
        chatReadWindowStartedAt: Date.now(),
        chatReadsInWindow: 0,
      };
      host.peers.set(peer.peerId, peer);
    }
    if (envelope.keyId === peer.pairingChannel.keyId && envelope.sequence === 1 && peer.pairingChannel.receivedSequence > 0) {
      const runtime = collaborationRuntime.get(host.shareId);
      if (!runtime) return;
      peer.pairingChannel = new SecureCollaborationChannel({
        role: 'host', shareId: host.shareId, localDeviceId: runtime.hostDeviceId,
        remoteDeviceId: peer.peerId,
        material: derivePairingMaterial({ pairingSecret: peer.pairingSecret, shareId: host.shareId }),
      });
    }
    const message = peer.sessionChannel && envelope.keyId === peer.sessionChannel.keyId
      ? peer.sessionChannel.decrypt(envelope)
      : peer.pairingChannel.decrypt(envelope);
    if (message.type === 'join.request') {
      const existing = await collaborationRepository.findDeviceByPeer(host.shareId, message.deviceId);
      if (existing?.approvedAt && !existing.revokedAt) {
        peer.deviceRecordId = existing.id;
        peer.guestNonce = message.guestNonce;
        await collaborationRepository.touchDevice(existing.id);
        await collaborationRepository.appendAudit({
          workspaceId: host.workspaceId, shareId: host.shareId, actorDeviceId: existing.deviceId,
          eventType: 'device.reconnected', metadata: { fingerprint: existing.fingerprint },
        });
        await this.approvePeer(host.shareId, existing.id);
        return;
      }
      try {
        const { collaborationShareService } = await import('./CollaborationShareService.js');
        const device = await collaborationShareService.requestDevice(host.shareId, message);
        peer.deviceRecordId = device.id;
        peer.guestNonce = message.guestNonce;
      } catch (error) {
        const reason = error instanceof Error && error.message === 'SHARE_FULL' ? 'full' : 'expired';
        this.send(host.socket, peer.pairingChannel.encrypt({ type: 'join.rejected', reason }, peer.peerId));
        host.peers.delete(peer.peerId);
      }
      return;
    }
    if (message.type === 'snapshot.request' && peer.sessionChannel) {
      await this.sendSnapshot(host, peer);
      return;
    }
    if (message.type === 'terminal.open' && peer.sessionChannel && peer.deviceRecordId) {
      await this.openTerminal(host, peer, message.nodeId, message.cols, message.rows);
      return;
    }
    if (message.type === 'terminal.input' && peer.sessionChannel && peer.deviceRecordId) {
      await this.writeTerminal(host, peer, message.nodeId, message.data);
      return;
    }
    if (message.type === 'terminal.resize' && peer.sessionChannel && peer.deviceRecordId) {
      await this.resizeTerminal(host, peer, message.nodeId, message.cols, message.rows);
      return;
    }
    if (message.type === 'terminal.close' && peer.sessionChannel && peer.deviceRecordId) {
      await this.closeTerminal(host, peer, message.nodeId);
      return;
    }
    if (message.type === 'voice.transcription.start' && peer.sessionChannel && peer.deviceRecordId) {
      await this.startVoiceTranscription(host, peer, message);
      return;
    }
    if (message.type === 'voice.transcription.chunk' && peer.sessionChannel && peer.deviceRecordId) {
      this.appendVoiceChunk(host, peer, message);
      return;
    }
    if (message.type === 'voice.transcription.finish' && peer.sessionChannel && peer.deviceRecordId) {
      await this.finishVoiceTranscription(host, peer, message.requestId);
      return;
    }
    if (message.type === 'command' && peer.sessionChannel && peer.deviceRecordId) {
      const read = chatReadCommandSchema.safeParse(message.command);
      if (read.success) {
        await this.readChat(host, peer, message.commandId, read.data.channel, read.data.before ?? null, read.data.beforeId ?? null);
        return;
      }
      // Guests are approved devices, but their commands are still untrusted input.
      const command = collaborationCommandSchema.safeParse(message.command);
      if (!command.success) {
        await this.rejectCommand(host, peer, message.commandId, 'INVALID_COMMAND');
        return;
      }
      const result = await sharedWorkspaceCommandBus.execute(host.shareId, peer.deviceRecordId, new ExecuteCollaborationCommandDto(
        message.commandId, message.revision, command.data as CollaborationCommand,
      ));
      this.send(host.socket, peer.sessionChannel.encrypt({
        type: 'command.result', commandId: result.commandId, accepted: result.accepted,
        revision: result.revision, ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      }, peer.peerId));
      if (result.accepted) await this.sendSnapshot(host, peer);
    }
  }

  private connectGuest(guest: GuestSession): void {
    if (guest.stopped) return;
    guest.state = { ...guest.state, status: guest.state.status === 'connecting' ? 'connecting' : 'reconnecting', errorCode: null };
    const socket = new WebSocket(this.relayConnectionUrl(guest.relayUrl, guest.shareId, guest.deviceId, 'guest'), COLLABORATION_PROTOCOL, { perMessageDeflate: false });
    guest.socket = socket;
    socket.on('open', () => {
      guest.state = { ...guest.state, status: 'waiting_approval' };
      guest.pairingChannel = null;
      guest.sessionChannel = null;
      // The host identity is learned from its first authenticated response.
      const material = derivePairingMaterial({ pairingSecret: guest.pairingSecret, shareId: guest.shareId });
      const provisionalHost = `pending_${guest.shareId}`.slice(0, 128);
      guest.pairingChannel = new SecureCollaborationChannel({
        role: 'guest', shareId: guest.shareId, localDeviceId: guest.deviceId,
        remoteDeviceId: provisionalHost, material,
      });
      this.send(socket, guest.pairingChannel.encrypt({
        type: 'join.request', deviceId: guest.deviceId, displayName: guest.displayName,
        platform: guest.platform, requestedRole: 'viewer', guestNonce: guest.guestNonce,
        appVersion: process.env.npm_package_version ?? '0.0.0',
      }));
    });
    socket.on('message', (data) => void this.handleGuestMessage(guest, websocketDataText(data)).catch((error) => {
      guest.state = { ...guest.state, status: 'error', errorCode: error instanceof Error ? error.message : 'REMOTE_PROTOCOL_ERROR' };
    }));
    socket.on('close', () => {
      guest.socket = null;
      if (!guest.stopped && !['rejected', 'revoked', 'expired'].includes(guest.state.status)) {
        guest.state = { ...guest.state, status: 'reconnecting' };
        guest.reconnectTimer = setTimeout(() => this.connectGuest(guest), 2_000);
      }
    });
    socket.on('error', () => undefined);
  }

  private async handleGuestMessage(guest: GuestSession, raw: string): Promise<void> {
    const envelope = collaborationEnvelopeSchema.parse(JSON.parse(raw)) as CollaborationEnvelope;
    if (!guest.hostDeviceId) {
      const hostDeviceId = String(envelope.senderDeviceId);
      guest.hostDeviceId = hostDeviceId;
      guest.pairingChannel = new SecureCollaborationChannel({
        role: 'guest', shareId: guest.shareId, localDeviceId: guest.deviceId,
        remoteDeviceId: hostDeviceId,
        material: derivePairingMaterial({ pairingSecret: guest.pairingSecret, shareId: guest.shareId }),
      });
      guest.state = { ...guest.state, hostDeviceId: guest.hostDeviceId };
    }
    const message = guest.sessionChannel && envelope.keyId === guest.sessionChannel.keyId
      ? guest.sessionChannel.decrypt(envelope)
      : guest.pairingChannel!.decrypt(envelope);
    if (message.type === 'join.rejected') {
      const status = message.reason === 'expired' ? 'expired' : message.reason === 'incompatible' ? 'incompatible' : message.reason === 'revoked' ? 'revoked' : 'rejected';
      guest.state = { ...guest.state, status, errorCode: message.reason };
      return;
    }
    if (message.type === 'join.approved') {
      const material = deriveSessionMaterial({
        pairingSecret: guest.pairingSecret, shareId: guest.shareId, sessionId: message.sessionId,
        hostNonce: message.hostNonce, guestNonce: guest.guestNonce,
      });
      guest.sessionChannel = new SecureCollaborationChannel({
        role: 'guest', shareId: guest.shareId, localDeviceId: guest.deviceId,
        remoteDeviceId: guest.hostDeviceId!, material,
      });
      guest.state = { ...guest.state, status: 'connected', role: message.role, scopes: message.scopes, errorCode: null };
      this.send(guest.socket, guest.sessionChannel.encrypt({ type: 'snapshot.request' }, guest.hostDeviceId));
      return;
    }
    if (message.type === 'snapshot') {
      guest.state = { ...guest.state, status: 'connected', revision: message.revision, snapshot: message.workspace as SharedWorkspaceDto, errorCode: null };
      return;
    }
    if (message.type === 'event') {
      const event = message.event as Partial<SharedChatPageDto>;
      const read = event.kind === 'chat.page' && typeof event.requestId === 'string' ? guest.chatReads.get(event.requestId) : undefined;
      if (!read || !event.requestId) return;
      clearTimeout(read.timer);
      guest.chatReads.delete(event.requestId);
      read.resolve(event as SharedChatPageDto);
      return;
    }
    if (message.type === 'command.result') {
      const read = guest.chatReads.get(message.commandId);
      if (read) {
        // A page arrives before its accepted result; only a refusal is left to report.
        clearTimeout(read.timer);
        guest.chatReads.delete(message.commandId);
        read.reject(new Error(message.errorCode ?? 'CHAT_UNAVAILABLE'));
        return;
      }
      const pending = guest.commands.get(message.commandId);
      if (!pending) return;
      clearTimeout(pending.timer);
      guest.commands.delete(message.commandId);
      pending.resolve({ commandId: message.commandId, accepted: message.accepted, revision: message.revision, result: null, errorCode: message.errorCode ?? null });
    }
  }

  private async sendSnapshot(host: HostSession, peer: HostPeer): Promise<void> {
    if (!peer.sessionChannel) return;
    const device = await collaborationRepository.findDevice(peer.deviceRecordId);
    if (!device?.approvedAt || device.revokedAt) return;
    const fullSnapshot = await sharedWorkspaceQuery.snapshot(host.shareId);
    const snapshot = scopeSharedWorkspaceSnapshot(fullSnapshot, device.scopes);
    this.send(host.socket, peer.sessionChannel.encrypt({ type: 'snapshot', revision: snapshot.revision, workspace: snapshot }, peer.peerId));
    host.lastProjectionHash = this.projectionHash(fullSnapshot);
  }

  private async openTerminal(
    host: HostSession,
    peer: HostPeer,
    nodeId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const device = await collaborationRepository.findDevice(peer.deviceRecordId);
    if (!device?.approvedAt || device.revokedAt || !device.scopes.includes('terminal.control')) {
      this.sendTerminalError(host, peer, 'TERMINAL_ACCESS_DENIED', nodeId);
      return;
    }
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== host.workspaceId || node.type !== 'terminal') {
      this.sendTerminalError(host, peer, 'TERMINAL_NOT_FOUND', nodeId);
      return;
    }
    const sessionId = (node.payload as { sessionId?: string }).sessionId;
    const session = sessionId ? ptySessionManager.get(sessionId) : null;
    if (!session || session.exited) {
      this.sendTerminalError(host, peer, 'TERMINAL_SESSION_OFFLINE', nodeId);
      return;
    }

    this.detachTerminal(peer);
    ptySessionManager.resize(session.id, cols, rows);
    const attached = ptySessionManager.attach(
      session.id,
      (data) => {
        if (peer.terminal?.sessionId !== session.id || !peer.sessionChannel) return;
        for (const chunk of this.terminalChunks(data)) {
          try {
            this.send(host.socket, peer.sessionChannel.encrypt({ type: 'terminal.output', nodeId, data: chunk }, peer.peerId));
          } catch {
            this.detachTerminal(peer);
            break;
          }
        }
      },
      (exitCode) => {
        if (peer.terminal?.sessionId !== session.id || !peer.sessionChannel) return;
        try {
          this.send(host.socket, peer.sessionChannel.encrypt({ type: 'terminal.exit', nodeId, exitCode }, peer.peerId));
        } finally {
          this.detachTerminal(peer);
        }
      },
    );
    peer.terminal = { nodeId, sessionId: session.id, detach: attached.detach };
    // The guest may have dropped while the node and its session were looked up.
    if (!peer.sessionChannel) {
      this.detachTerminal(peer);
      return;
    }
    this.send(host.socket, peer.sessionChannel.encrypt({
      type: 'terminal.opened',
      nodeId,
      cols,
      rows,
      scrollback: terminalReplay(session.id),
    }, peer.peerId));
    await collaborationRepository.appendAudit({
      workspaceId: host.workspaceId,
      shareId: host.shareId,
      actorDeviceId: device.deviceId,
      eventType: 'terminal.opened',
      metadata: { nodeId },
    });
  }

  private async writeTerminal(host: HostSession, peer: HostPeer, nodeId: string, data: string): Promise<void> {
    const attachment = peer.terminal;
    if (!attachment || attachment.nodeId !== nodeId) {
      this.sendTerminalError(host, peer, 'TERMINAL_NOT_OPEN', nodeId);
      return;
    }
    const bytes = Buffer.byteLength(data);
    const now = Date.now();
    if (now - peer.inputWindowStartedAt >= 1_000) {
      peer.inputWindowStartedAt = now;
      peer.inputBytesInWindow = 0;
    }
    peer.inputBytesInWindow += bytes;
    if (bytes > 8_192 || peer.inputBytesInWindow > 32_768) {
      this.sendTerminalError(host, peer, 'TERMINAL_INPUT_RATE_LIMITED', nodeId);
      return;
    }
    try {
      ptySessionManager.writeHumanInput(attachment.sessionId, data);
    } catch {
      this.detachTerminal(peer);
      this.sendTerminalError(host, peer, 'TERMINAL_SESSION_OFFLINE', nodeId);
    }
  }

  private async resizeTerminal(
    host: HostSession,
    peer: HostPeer,
    nodeId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const attachment = peer.terminal;
    if (!attachment || attachment.nodeId !== nodeId) {
      this.sendTerminalError(host, peer, 'TERMINAL_NOT_OPEN', nodeId);
      return;
    }
    ptySessionManager.resize(attachment.sessionId, cols, rows);
  }

  private async closeTerminal(host: HostSession, peer: HostPeer, nodeId: string): Promise<void> {
    if (!peer.terminal || peer.terminal.nodeId !== nodeId) return;
    const device = await collaborationRepository.findDevice(peer.deviceRecordId);
    this.detachTerminal(peer);
    if (device) {
      await collaborationRepository.appendAudit({
        workspaceId: host.workspaceId,
        shareId: host.shareId,
        actorDeviceId: device.deviceId,
        eventType: 'terminal.closed',
        metadata: { nodeId },
      });
    }
  }

  private async startVoiceTranscription(
    host: HostSession,
    peer: HostPeer,
    message: { requestId: string; language: 'auto' | 'pt' | 'en' | 'es'; byteLength: number; chunks: number },
  ): Promise<void> {
    const device = await collaborationRepository.findDevice(peer.deviceRecordId);
    if (!device?.approvedAt || device.revokedAt || !device.scopes.includes('voice.transcribe')) {
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_ACCESS_DENIED');
      return;
    }
    if (peer.voiceRequest || peer.voiceTranscribing) {
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_BUSY');
      return;
    }
    const now = Date.now();
    if (now - peer.voiceWindowStartedAt >= 60_000) {
      peer.voiceWindowStartedAt = now;
      peer.voiceRequestsInWindow = 0;
    }
    peer.voiceRequestsInWindow += 1;
    if (peer.voiceRequestsInWindow > MAX_REMOTE_VOICE_REQUESTS_PER_MINUTE) {
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_RATE_LIMITED');
      return;
    }
    if (message.byteLength > MAX_REMOTE_VOICE_BYTES || message.chunks > 64) {
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_RECORDING_TOO_LONG');
      return;
    }
    const timer = setTimeout(() => {
      if (peer.voiceRequest?.requestId !== message.requestId) return;
      this.clearVoiceRequest(peer);
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_UPLOAD_TIMEOUT');
    }, 30_000);
    timer.unref?.();
    peer.voiceRequest = {
      requestId: message.requestId,
      language: message.language,
      byteLength: message.byteLength,
      chunkCount: message.chunks,
      chunks: [],
      receivedBytes: 0,
      timer,
    };
  }

  private appendVoiceChunk(
    host: HostSession,
    peer: HostPeer,
    message: { requestId: string; index: number; data: string },
  ): void {
    const request = peer.voiceRequest;
    if (!request || request.requestId !== message.requestId) {
      this.sendVoiceError(host, peer, message.requestId, 'VOICE_REQUEST_NOT_FOUND');
      return;
    }
    if (message.index !== request.chunks.length || message.index >= request.chunkCount) {
      this.abortVoiceRequest(host, peer, message.requestId, 'VOICE_CHUNK_ORDER_INVALID');
      return;
    }
    const chunk = Buffer.from(message.data, 'base64url');
    if (!chunk.length || chunk.byteLength > MAX_REMOTE_VOICE_CHUNK_BYTES) {
      this.abortVoiceRequest(host, peer, message.requestId, 'VOICE_CHUNK_INVALID');
      return;
    }
    request.receivedBytes += chunk.byteLength;
    if (request.receivedBytes > request.byteLength || request.receivedBytes > MAX_REMOTE_VOICE_BYTES) {
      chunk.fill(0);
      this.abortVoiceRequest(host, peer, message.requestId, 'VOICE_RECORDING_TOO_LONG');
      return;
    }
    request.chunks.push(chunk);
  }

  private async finishVoiceTranscription(host: HostSession, peer: HostPeer, requestId: string): Promise<void> {
    const request = peer.voiceRequest;
    if (!request || request.requestId !== requestId) {
      this.sendVoiceError(host, peer, requestId, 'VOICE_REQUEST_NOT_FOUND');
      return;
    }
    if (request.chunks.length !== request.chunkCount || request.receivedBytes !== request.byteLength) {
      this.abortVoiceRequest(host, peer, requestId, 'VOICE_UPLOAD_INCOMPLETE');
      return;
    }
    const language = request.language;
    const audio = Buffer.concat(request.chunks, request.byteLength);
    this.clearVoiceRequest(peer);
    peer.voiceTranscribing = true;
    try {
      const text = (await voiceService.transcribe(audio, 'remote-dictation.wav', language)).trim();
      if (!text) {
        this.sendVoiceError(host, peer, requestId, 'VOICE_NOTHING_TRANSCRIBED');
        return;
      }
      if (peer.sessionChannel) {
        this.send(host.socket, peer.sessionChannel.encrypt({ type: 'voice.transcription.result', requestId, text }, peer.peerId));
      }
      const device = await collaborationRepository.findDevice(peer.deviceRecordId);
      if (device) {
        await collaborationRepository.appendAudit({
          workspaceId: host.workspaceId,
          shareId: host.shareId,
          actorDeviceId: device.deviceId,
          eventType: 'voice.transcribed',
          metadata: { byteLength: audio.byteLength, language },
        });
      }
    } catch (error) {
      const code = error instanceof Error && error.message === VOICE_MODELS_MISSING_ERROR
        ? 'VOICE_MODELS_MISSING'
        : 'VOICE_TRANSCRIPTION_FAILED';
      this.sendVoiceError(host, peer, requestId, code);
    } finally {
      audio.fill(0);
      peer.voiceTranscribing = false;
    }
  }

  private abortVoiceRequest(host: HostSession, peer: HostPeer, requestId: string, code: string): void {
    this.clearVoiceRequest(peer);
    this.sendVoiceError(host, peer, requestId, code);
  }

  private clearVoiceRequest(peer: HostPeer): void {
    const request = peer.voiceRequest;
    if (!request) return;
    clearTimeout(request.timer);
    for (const chunk of request.chunks) chunk.fill(0);
    peer.voiceRequest = null;
  }

  private sendVoiceError(host: HostSession, peer: HostPeer, requestId: string, code: string): void {
    if (!peer.sessionChannel) return;
    try {
      this.send(host.socket, peer.sessionChannel.encrypt({ type: 'voice.transcription.error', requestId, code }, peer.peerId));
    } catch {
      this.clearVoiceRequest(peer);
    }
  }

  private detachTerminal(peer: HostPeer): void {
    peer.terminal?.detach();
    peer.terminal = null;
    peer.inputWindowStartedAt = Date.now();
    peer.inputBytesInWindow = 0;
  }

  private async rejectCommand(host: HostSession, peer: HostPeer, commandId: string, errorCode: string): Promise<void> {
    if (!peer.sessionChannel) return;
    const share = await collaborationRepository.findShare(host.shareId);
    this.send(host.socket, peer.sessionChannel.encrypt({
      type: 'command.result', commandId, accepted: false, revision: share?.revision ?? 0, errorCode,
    }, peer.peerId));
  }

  /**
   * Answers `chat.read` with a page of whole messages for the guest's open
   * conversation: an `event` carrying the page, then the command result.
   */
  private async readChat(host: HostSession, peer: HostPeer, commandId: string, channel: string, before: string | null, beforeId: string | null): Promise<void> {
    const device = await collaborationRepository.findDevice(peer.deviceRecordId);
    if (!device?.approvedAt || device.revokedAt || !device.scopes.includes('agents.message')) {
      await this.rejectCommand(host, peer, commandId, 'SCOPE_DENIED');
      return;
    }
    const now = Date.now();
    if (now - peer.chatReadWindowStartedAt >= 60_000) {
      peer.chatReadWindowStartedAt = now;
      peer.chatReadsInWindow = 0;
    }
    peer.chatReadsInWindow += 1;
    if (peer.chatReadsInWindow > MAX_CHAT_READS_PER_MINUTE) {
      await this.rejectCommand(host, peer, commandId, 'CHAT_READ_RATE_LIMITED');
      return;
    }
    let page: Awaited<ReturnType<typeof sharedWorkspaceQuery.chatPage>>;
    try {
      page = await sharedWorkspaceQuery.chatPage(host.shareId, channel, before, beforeId);
    } catch {
      await this.rejectCommand(host, peer, commandId, 'CHAT_UNAVAILABLE');
      return;
    }
    if (!peer.sessionChannel) return;
    const share = await collaborationRepository.findShare(host.shareId);
    const revision = share?.revision ?? 0;
    peer.eventSequence += 1;
    this.send(host.socket, peer.sessionChannel.encrypt({
      type: 'event', sequence: peer.eventSequence, revision, event: { ...page, requestId: commandId },
    }, peer.peerId));
    this.send(host.socket, peer.sessionChannel.encrypt({ type: 'command.result', commandId, accepted: true, revision }, peer.peerId));
  }

  private sendTerminalError(host: HostSession, peer: HostPeer, code: string, nodeId?: string): void {
    if (!peer.sessionChannel) return;
    this.send(host.socket, peer.sessionChannel.encrypt({
      type: 'terminal.error',
      ...(nodeId ? { nodeId } : {}),
      code,
    }, peer.peerId));
  }

  private terminalChunks(data: string): string[] {
    const chunks: string[] = [];
    for (let offset = 0; offset < data.length; offset += 8_192) chunks.push(data.slice(offset, offset + 8_192));
    return chunks;
  }

  private async publishChangedSnapshot(host: HostSession): Promise<void> {
    if (!host.socket || host.socket.readyState !== WebSocket.OPEN || ![...host.peers.values()].some((peer) => peer.sessionChannel)) return;
    await withCollaborationShareLock(host.shareId, async () => {
      let snapshot = await sharedWorkspaceQuery.snapshot(host.shareId);
      const hash = this.projectionHash(snapshot);
      if (host.lastProjectionHash === hash) return;
      const revision = await collaborationRepository.incrementRevision(host.shareId);
      snapshot = { ...snapshot, revision };
      host.lastProjectionHash = this.projectionHash(snapshot);
      for (const peer of host.peers.values()) {
        if (!peer.sessionChannel) continue;
        const device = await collaborationRepository.findDevice(peer.deviceRecordId);
        if (!device?.approvedAt || device.revokedAt) continue;
        const scoped = scopeSharedWorkspaceSnapshot(snapshot, device.scopes);
        this.send(host.socket, peer.sessionChannel.encrypt({ type: 'snapshot', revision, workspace: scoped }, peer.peerId));
      }
    });
  }

  private projectionHash(snapshot: SharedWorkspaceDto): string {
    return createHash('sha256').update(JSON.stringify({ ...snapshot, generatedAt: null, revision: 0 })).digest('hex');
  }

  private send(socket: WebSocket | null, envelope: CollaborationEnvelope): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('COLLABORATION_TRANSPORT_OFFLINE');
    socket.send(JSON.stringify(envelope), { compress: false });
  }

  private relayConnectionUrl(relayUrl: string, shareId: string, peerId: string, role: 'host' | 'guest'): string {
    const url = new URL(relayUrl);
    url.searchParams.set('share', shareId);
    url.searchParams.set('peer', peerId);
    url.searchParams.set('role', role);
    return url.toString();
  }

  private assertRelayUrl(value: string): void {
    const url = new URL(value);
    if (url.protocol === 'wss:') return;
    if (url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return;
    throw new Error('COLLABORATION_RELAY_MUST_USE_WSS');
  }
}

export const collaborationSessionManager = new CollaborationSessionManager();

const shutdown = globalThis as typeof globalThis & { __orkestraiShutdownCollaboration?: () => Promise<void> };
shutdown.__orkestraiShutdownCollaboration = async () => collaborationSessionManager.shutdown();
