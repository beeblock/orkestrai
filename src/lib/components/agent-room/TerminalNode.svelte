<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { SearchAddon } from '@xterm/addon-search';
  import { Mic, Square, Volume2, VolumeX, X } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Select from '$lib/components/ui/select';
  import HeaderIconButton from './canvas/HeaderIconButton.svelte';
  import VoiceConfirmDialog from './VoiceConfirmDialog.svelte';
  import '@xterm/xterm/css/xterm.css';
  import { TERMINAL_THEMES, type TerminalThemeName } from './terminal-themes.js';
  import { DEFAULT_DICTATION_HOTKEY, comboLabel, matchesCombo } from './dictation-hotkey.js';
  import { appSettingsStore, getAppSettings, updateAppSettings } from './app-settings.svelte.js';
  import { DEFAULT_AUDIO_DEVICE_ID, classifyAudioCaptureFailure, openPreferredAudioInput } from './audio-devices.js';
  import { audioCaptureFailureMessage } from './audio-device-messages.js';
  import { PcmAudioRecorder } from './audio-pcm.js';
  import { cleanSpeechText, normalizeSpeechText } from './voice-cleanup.js';
  import { speakText } from './voice-speech.js';
  import { voiceModelsReadyForUse } from './voice-model-status.js';
  import { terminalDictationInput } from './terminal-dictation.js';
  import { DictationOperation, DICTATION_START_TIMEOUT_MS, DICTATION_TRANSCRIBE_TIMEOUT_MS, DICTATION_MAX_RECORDING_MS } from './dictation-operation.js';
  import { installScaledTerminalMouse, isTerminalCopyShortcut, isWindowsTerminalPasteShortcut } from './terminal-selection.js';
  import { workingDirectoryFromOsc } from './terminal-working-directory.js';
  import { audioSignalIsEmpty } from '$lib/modules/agent-room/domain/voice-audio.js';
  import {
    LEADER_DICTATION_COMMAND,
    LEADER_DICTATION_STATE,
    type LeaderDictationCommandDetail,
    type LeaderDictationStateDetail,
    type LeaderDictationStatus,
  } from './leader-dictation.js';
  import * as m from '$lib/paraglide/messages.js';
  import type { WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';

  export type CreatePtyRequest = {
    command: string;
    args?: string[];
    conversationArgs?: string[];
    freshSessionArgs?: string[];
    agentSessionId?: string;
    cwd: string;
    env?: Record<string, string>;
    profileId?: string | null;
    runtime?: WorkspaceExecutionRuntime;
    workspaceRoot?: string;
  };

  type Props = {
    /** Se presente, anexa a uma sessao existente; senao cria uma nova. */
    sessionId?: string;
    createRequest?: CreatePtyRequest;
    /** Provider do agente (para rastrear o session-id da CLI). */
    provider?: string;
    sessionStorage?: string;
    /** Workspace do no (filtra eventos de broadcast, ex.: talking). */
    workspaceId?: string;
    /** Rotulos para a notificacao nativa de fim de sessao. */
    sessionLabel?: string;
    workspaceName?: string;
    onExit?: (exitCode: number) => void;
    onSessionCreated?: (sessionId: string) => void | Promise<void>;
    onSessionReady?: (sessionId: string, mode: 'created' | 'attached') => void | Promise<void>;
    /** Cmd/Ctrl+clique num caminho de arquivo detectado no output. */
    onOpenPath?: (path: string) => void;
    /** Sessao PTY nao existe mais (servidor reiniciou) — recriar/retomar. */
    onRespawn?: () => void;
    /** Session-id real da CLI descoberto (para resume exato). */
    onAgentSession?: (agentSessionId: string) => void;
    /** Diretorio real reportado por um shell puro, para restauracao futura. */
    onWorkingDirectoryChange?: (cwd: string) => void;
    /** Id do no no canvas (para o endpoint de resposta do transcrito). */
    nodeId?: string;
    /** Edge conversando (bridge ask) — repassado pela pagina do canvas. */
    onTalking?: (payload: { from: string | null; to: string; talking: boolean }) => void;
    /** Resposta de um ask destinada a este no (para voz de volta, TTS). */
    onAgentReply?: (payload: { to: string; from: string | null; text: string }) => void;
    /** Voz de volta ativa + toggle (botao junto ao mic). */
    voiceOn?: boolean;
    onToggleVoice?: () => void;
    /** Tema do terminal (payload.theme). */
    themeName?: TerminalThemeName;
  };

  let { sessionId, createRequest, provider, sessionStorage, workspaceId, nodeId, sessionLabel, workspaceName, onExit, onSessionCreated, onSessionReady, onOpenPath, onRespawn, onAgentSession, onWorkingDirectoryChange, onTalking, onAgentReply, voiceOn = false, onToggleVoice, themeName = 'dark' }: Props = $props();

  let container: HTMLDivElement;
  let xtermInstance: Terminal | null = null;
  let terminalPaddingPx = $state(6);
  let statusMessage = $state('');
  let exited = $state<number | null>(null);
  let waiting = $state(false);

  // -- Ditado por voz (Parakeet local ou sidecar configurado) ----------------
  let dictating = $state(false);
  let transcribing = $state(false);
  let dictateLang = $state<'auto' | 'pt' | 'en'>('pt');
  let dictateError = $state('');
  let dictateStatus = $state('');
  let voiceConfirmOpen = $state(false);
  let checkingVoiceModels = $state(false);
  let dictationOperation: DictationOperation | null = null;
  /** Atalho REATIVO da store global (mudanca em Configuracoes aplica na hora). */
  const dictateHotkey = $derived(appSettingsStore.values.dictationHotkey || DEFAULT_DICTATION_HOTKEY);
  const dictationAutoSubmit = $derived(appSettingsStore.values.dictationAutoSubmit === 'true');
  let audioRecorder: PcmAudioRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let sendInput: ((data: string) => void) | null = null;
  let recSeconds = $state(0);
  let recTimer: ReturnType<typeof setInterval> | null = null;

  function startRecTimer() {
    recSeconds = 0;
    const startedAt = Date.now();
    recTimer = setInterval(() => {
      recSeconds = Math.floor((Date.now() - startedAt) / 1_000);
      if (Date.now() - startedAt >= DICTATION_MAX_RECORDING_MS) void finishDictation();
    }, 1_000);
  }

  function stopRecTimer() {
    if (recTimer) clearInterval(recTimer);
    recTimer = null;
    recSeconds = 0;
  }

  const dictationSupported = typeof window !== 'undefined' &&
    typeof AudioContext !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  function stopTracks() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function reportDictationState(status: LeaderDictationStatus) {
    if (!nodeId || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<LeaderDictationStateDetail>(LEADER_DICTATION_STATE, {
      detail: { nodeId, status },
    }));
  }

  // -- Voz de volta quando EU dito (ciclo conversa: dito -> ouco a resposta) --
  // A captura NAO arma no ditado: arma so quando o texto e SUBMETIDO (Enter),
  // senao o eco do texto digitado/redraw do TUI dispara a fala sem resposta.
  let captureAfterDictation = false;
  let pendingDictation = false;
  let lastSpoken = '';
  let captureBuf = '';
  let speakTimer: ReturnType<typeof setTimeout> | null = null;

  function terminalErrorMessage(code: unknown, fallback: unknown): string {
    if (code === 'WSL_DISTRIBUTION_UNAVAILABLE') return m['term.wsl_distribution_unavailable']();
    if (code === 'WSL_DIRECTORY_NOT_FOUND') return m['term.wsl_directory_missing']();
    if (code === 'WSL_COMMAND_NOT_FOUND') return m['term.wsl_command_missing']({ provider: provider ?? m['term.provider_fallback']() });
    if (code === 'WSL_SPAWN_FAILED') return m['term.wsl_start_failed']();
    if (code === 'WORKSPACE_SUSPENDED') return m['term.workspace_suspended']();
    if (code === 'AGENT_SESSION_IN_USE') return m['term.conversation_in_use']();
    return String(fallback ?? m['term.ws_error']());
  }


  function scheduleSpeakFromCapture() {
    if (speakTimer) clearTimeout(speakTimer);
    speakTimer = setTimeout(async () => {
      captureAfterDictation = false;
      speakTimer = null;
      // Fonte 1: transcrito da CLI (JSONL limpo — resposta COMPLETA, sem TUI).
      // Fonte 2 (fallback): raspagem da tela (quando nao ha session-id ainda).
      const text = (await transcriptReplyText()) ?? cleanSpeechText(captureBuf);
      captureBuf = '';
      if (!text || !voiceOn) return;
      if (text === lastSpoken) return; // ja falou exatamente isso — nao repete
      lastSpoken = text;
      try {
        await speakText(text, appSettingsStore.values.audioOutputDeviceId);
      } catch {
        // voz indisponivel — segue em texto
      }
    }, 5_000);
  }

  function armDictationReplyCapture() {
    pendingDictation = false;
    captureAfterDictation = true;
    captureBuf = '';
    scheduleSpeakFromCapture();
  }

  /** Ultima resposta do agente pelo transcrito da CLI (null = usar raspagem). */
  async function transcriptReplyText(): Promise<string | null> {
    if (!workspaceId || !nodeId) return null;
    try {
      const response = await fetch(`/api/agent-room/voice/reply?workspaceId=${encodeURIComponent(workspaceId)}&nodeId=${encodeURIComponent(nodeId)}`);
      const payload = await response.json().catch(() => null);
      const text = String(payload?.data?.text ?? '').trim();
      return text ? normalizeSpeechText(text) : null;
    } catch {
      return null;
    }
  }

  async function toggleDictation() {
    dictateError = '';
    if (dictating) {
      void finishDictation();
      return;
    }
    if (transcribing || checkingVoiceModels) {
      cancelDictation();
      return;
    }
    const operation = new DictationOperation();
    dictationOperation = operation;
    operation.deadline(DICTATION_START_TIMEOUT_MS);
    checkingVoiceModels = true;
    reportDictationState('starting');
    let voiceSettings: Record<string, string> = appSettingsStore.values;
    try {
      // A presenca real dos modelos prevalece sobre a confirmacao persistida:
      // eles podem ter sido apagados nas Configuracoes ou fora do app.
      voiceSettings = await operation.wait(getAppSettings(true));
      if (!(await operation.wait(voiceModelsReadyForUse(voiceSettings, fetch, operation.signal)))) {
        voiceConfirmOpen = true;
        return;
      }
      const opened = await operation.wait(openPreferredAudioInput(voiceSettings.audioInputDeviceId),
        (late) => late.stream.getTracks().forEach((track) => track.stop()));
      mediaStream = opened.stream;
      if (opened.fallback) {
        dictateError = m['voice.mic_fallback']();
        void updateAppSettings({ audioInputDeviceId: DEFAULT_AUDIO_DEVICE_ID });
      }
      const recorder = new PcmAudioRecorder(mediaStream);
      audioRecorder = recorder;
      await operation.wait(recorder.start());
      dictating = true;
      reportDictationState('recording');
      pendingDictation = false;
      startRecTimer();
    } catch (error) {
      if (dictationOperation === operation) dictateError = operation.signal.reason?.name === 'TimeoutError'
        ? m['voice.operation_timeout']()
        : audioCaptureFailureMessage(classifyAudioCaptureFailure(error, 1));
    } finally {
      operation.deadline(null);
      if (dictationOperation === operation) {
        checkingVoiceModels = false;
        if (!dictating) cancelDictation();
      }
    }
  }

  function cancelDictation() {
    dictationOperation?.cancel();
    dictationOperation = null;
    audioRecorder?.cancel();
    audioRecorder = null;
    stopTracks();
    stopRecTimer();
    dictating = false;
    transcribing = false;
    checkingVoiceModels = false;
    dictateStatus = '';
    reportDictationState('idle');
  }

  async function finishDictation() {
    const recorder = audioRecorder;
    const operation = dictationOperation;
    if (!recorder || !dictating || !operation) return;
    operation.deadline(DICTATION_TRANSCRIBE_TIMEOUT_MS);
    stopRecTimer();
    dictating = false;
    transcribing = true;
    reportDictationState('transcribing');
    dictateStatus = m['voice.transcribing']();
    try {
      const pending = recorder.stop();
      stopTracks();
      const recording = await operation.wait(pending);
      if (audioSignalIsEmpty(recording.stats)) {
        dictateError = m['voice.mic_no_signal']();
        return;
      }
      const form = new FormData();
      form.append('file', recording.wav, 'ditado.wav');
      if (dictateLang !== 'auto') form.append('language', dictateLang);
      const csrf = getCsrfToken();
      const response = await operation.wait(fetch('/api/agent-room/voice/transcribe', {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
        body: form,
        signal: operation.signal,
      }));
      const payload = await operation.wait(response.json().catch(() => ({})));
      if (response.status === 413) throw new Error(m['voice.recording_too_long']());
      if (!response.ok || payload.error) throw new Error(payload.error || `Erro ${response.status}`);
      const text = String(payload.data?.text ?? '').trim();
      if (text) {
        sendInput?.(terminalDictationInput(text, dictationAutoSubmit));
        if (voiceOn && provider) {
          if (dictationAutoSubmit) armDictationReplyCapture();
          else pendingDictation = true;
        }
      } else dictateError = m['voice.nothing_transcribed']();
    } catch (error) {
      if (dictationOperation === operation) dictateError = operation.signal.reason?.name === 'TimeoutError'
        ? m['voice.operation_timeout']()
        : error instanceof Error ? error.message : m['voice.dictation_error']();
    } finally {
      operation.deadline(null);
      if (dictationOperation === operation) cancelDictation();
    }
  }

  let searchOpen = $state(false);
  let searchQuery = $state('');
  let searchAddon: SearchAddon | null = null;

  function handleTerminalKeydown(event: KeyboardEvent) {
    if (matchesCombo(event, dictateHotkey)) {
      event.preventDefault();
      toggleDictation();
      event.stopPropagation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchOpen = !searchOpen;
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && searchOpen) {
      event.preventDefault();
      searchOpen = false;
      searchAddon?.clearDecorations();
      requestAnimationFrame(() => xtermInstance?.focus());
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' && searchOpen && searchQuery) {
      searchAddon?.findNext(searchQuery);
    }

    // O xterm processa a tecla antes deste handler no wrapper. Nao deixe o
    // evento subir ao NodeWrapper do XYFlow: ele usa Escape para desselecionar
    // o node e agenda blur(), interrompendo Vim, merge/rebase e outras TUIs.
    event.stopPropagation();
  }

  export function isWaiting() {
    return waiting;
  }

  export function focus() {
    xtermInstance?.focus();
  }

  export function write(data: string) {
    sendInput?.(data);
  }

  async function copyTerminalSelection(terminal: Terminal) {
    const selection = terminal.getSelection();
    if (!selection) return false;
    const desktop = (window as typeof window & {
      orkestraiDesktop?: { writeClipboardText?: (value: string) => Promise<boolean> };
    }).orkestraiDesktop;
    try {
      if (desktop?.writeClipboardText) return await desktop.writeClipboardText(selection);
      await navigator.clipboard.writeText(selection);
      return true;
    } catch {
      return false;
    }
  }

  async function pasteTerminalClipboard(terminal: Terminal) {
    const desktop = (window as typeof window & {
      orkestraiDesktop?: {
        pasteClipboardText?: () => Promise<boolean>;
        platform?: string;
      };
    }).orkestraiDesktop;
    try {
      if (desktop?.pasteClipboardText && await desktop.pasteClipboardText()) return;
      if (!desktop?.pasteClipboardText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          terminal.paste(text);
          return;
        }
      }
    } catch {
      // Fall through to the original Ctrl+V control character. Agent CLIs use
      // it for image paste when the clipboard does not contain text.
    }
    sendInput?.('\x16');
  }

  onMount(() => {
    let fontSize = 13;
    let fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily,
      theme: TERMINAL_THEMES[themeName]?.theme ?? TERMINAL_THEMES.dark.theme,
      scrollback: 5000,
    });
    xtermInstance = terminal;

    const fitAddon = new FitAddon();
    searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.attachCustomKeyEventHandler((event) => {
      if (isTerminalCopyShortcut(event, terminal.hasSelection())) {
        void copyTerminalSelection(terminal);
        return false;
      }
      const desktopPlatform = (window as typeof window & { orkestraiDesktop?: { platform?: string } })
        .orkestraiDesktop?.platform;
      if (isWindowsTerminalPasteShortcut(event, desktopPlatform ?? navigator.platform)) {
        event.preventDefault();
        event.stopPropagation();
        void pasteTerminalClipboard(terminal);
        return false;
      }
      if (event.type !== 'keydown') return true;
      if (matchesCombo(event, dictateHotkey)) return false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') return false;
      if (event.key === 'Escape' && searchOpen) return false;
      return true;
    });
    terminal.open(container);
    terminal.attachCustomWheelEventHandler((event) => {
      // The terminal owns wheel/trackpad gestures. Keep xterm's native
      // scrollback and alternate-buffer mouse handling, but never bubble the
      // gesture into XYFlow where it would zoom or pan the Canvas instead.
      event.stopPropagation();
      return true;
    });
    fitAddon.fit();

    // OSC 7 e o contrato padrao de shells integrados para publicar o cwd.
    // A deteccao no servidor cobre zsh/bash sem integracao no macOS/Linux.
    terminal.parser.registerOscHandler(7, (payload) => {
      const cwd = workingDirectoryFromOsc(payload, navigator.platform.startsWith('Win'));
      if (cwd) onWorkingDirectoryChange?.(cwd);
      return true;
    });

    const restoreTerminalMouse = installScaledTerminalMouse(terminal);
    const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
    const copySelectionFromContextMenu = (event: MouseEvent) => {
      if (!terminal.hasSelection()) return;
      event.preventDefault();
      event.stopPropagation();
      void copyTerminalSelection(terminal);
    };
    screen?.addEventListener('contextmenu', copySelectionFromContextMenu);

    // Cmd/Ctrl+clique em caminhos de arquivo (ex.: src/index.ts:42, ./a/b.js).
    if (onOpenPath) {
      terminal.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
          const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
          if (!line) {
            callback(undefined);
            return;
          }
          const text = line.translateToString();
          const pattern = /(?:\.|~)?\/?(?:[\w.@+-]+\/)+[\w.@+-]+(?::\d+)?/g;
          const links = [];
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const raw = match[0];
            links.push({
              range: { start: { x: match.index + 1, y: bufferLineNumber }, end: { x: match.index + raw.length, y: bufferLineNumber } },
              text: raw,
              activate: (event: MouseEvent, linkText: string) => {
                if (event.metaKey || event.ctrlKey) {
                  onOpenPath(linkText.replace(/:\d+$/, ''));
                }
              },
            });
          }
          callback(links.length ? links : undefined);
        },
      });
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    let socket: WebSocket;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let resizeFrame: number | null = null;
    const pendingInput: string[] = [];

    const handleLeaderDictation = (event: Event) => {
      const detail = (event as CustomEvent<LeaderDictationCommandDetail>).detail;
      if (!nodeId || detail?.nodeId !== nodeId) return;
      void toggleDictation();
    };
    window.addEventListener(LEADER_DICTATION_COMMAND, handleLeaderDictation);

    const send = (payload: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    let createdSessionId: string | undefined;
    const currentSessionId = () => createdSessionId ?? sessionId;
    const sendTerminalInput = (data: string) => {
      const id = currentSessionId();
      if (!id || socket?.readyState !== WebSocket.OPEN) {
        pendingInput.push(data);
        while (pendingInput.join('').length > 16_384) pendingInput.shift();
        return;
      }
      send({ type: 'input', sessionId: id, data });
    };
    const flushPendingInput = () => {
      const id = currentSessionId();
      if (!id || socket?.readyState !== WebSocket.OPEN) return;
      for (const data of pendingInput.splice(0)) send({ type: 'input', sessionId: id, data });
    };

    const fitAndReportSize = () => {
      if (disposed) return;
      fitAddon.fit();
      const id = currentSessionId();
      if (id) send({ type: 'resize', sessionId: id, cols: terminal.cols, rows: terminal.rows });
      terminal.refresh(0, terminal.rows - 1);
    };

    const scheduleFitAndReportSize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        fitAndReportSize();
      });
    };

    const replayScrollback = (scrollback: unknown) => {
      const replay = typeof scrollback === 'string' ? scrollback : '';
      if (!replay) {
        scheduleFitAndReportSize();
        return;
      }
      // xterm parses large ANSI histories asynchronously. Refit only after the
      // parser reaches the final cursor position, otherwise a remounted Canvas
      // can keep drawing the cursor with the previous renderer geometry.
      terminal.write(replay, () => {
        if (disposed) return;
        terminal.clearTextureAtlas();
        scheduleFitAndReportSize();
      });
    };

    const initializeTerminal = async () => {
      try {
        const settings = await getAppSettings(true);
        if (disposed) return;
        terminalPaddingPx = Number(settings.terminalPadding ?? 6);
        terminal.options.fontSize = Number(settings.terminalFontSize) || 13;
        terminal.options.fontFamily = settings.terminalFontFamily || fontFamily;
        terminal.clearTextureAtlas();
      } catch {
        // defaults
      }
      // Let Svelte apply padding and the browser resolve the chosen font before
      // telling the existing PTY its rows/columns and asking for scrollback.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed) return;
      fitAddon.fit();
      connect();
    };

    const handleOpen = () => {
      if (sessionId) {
        fitAddon.fit();
        send({ type: 'attach', sessionId, cols: terminal.cols, rows: terminal.rows });
      } else if (createRequest) {
        send({
          type: 'create',
          ...createRequest,
          provider,
          sessionStorage,
          label: sessionLabel,
          workspace: workspaceName,
          workspaceId,
          nodeId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } else {
        statusMessage = m['term.no_session']();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));
      switch (message.type) {
        case 'created':
          createdSessionId = message.session.id;
          void Promise.resolve(onSessionCreated?.(message.session.id))
            .then(() => onSessionReady?.(message.session.id, 'created'))
            .catch(() => undefined);
          replayScrollback(message.scrollback);
          statusMessage = '';
          reconnectAttempts = 0;
          flushPendingInput();
          break;
        case 'attached':
          replayScrollback(message.scrollback);
          statusMessage = '';
          reconnectAttempts = 0;
          waiting = Boolean(message.session?.waiting);
          if (message.session?.exited) exited = message.session.exitCode ?? 0;
          flushPendingInput();
          {
            const attachedSessionId = String(message.session?.id ?? sessionId ?? '');
            if (attachedSessionId) void onSessionReady?.(attachedSessionId, 'attached');
          }
          break;
        case 'output':
          terminal.write(message.data);
          if (captureAfterDictation) {
            captureBuf = (captureBuf + String(message.data)).slice(-32_000);
            scheduleSpeakFromCapture();
          }
          break;
        case 'idle':
          waiting = Boolean(message.idle);
          break;
        case 'exit':
          waiting = false;
          exited = message.exitCode;
          onExit?.(message.exitCode);
          break;
        case 'agentSession':
          if (!message.sessionId || message.sessionId === currentSessionId()) {
            onAgentSession?.(String(message.agentSessionId));
          }
          break;
        case 'cwd':
          if (!message.sessionId || message.sessionId === currentSessionId()) {
            onWorkingDirectoryChange?.(String(message.cwd ?? ''));
          }
          break;
        case 'talking':
          if (!workspaceId || message.workspaceId === workspaceId) {
            onTalking?.({ from: message.from ?? null, to: String(message.to), talking: Boolean(message.talking) });
          }
          break;
        case 'agentReply':
          if (!workspaceId || message.workspaceId === workspaceId) {
            onAgentReply?.({ to: String(message.to), from: message.from ?? null, text: String(message.text ?? '') });
          }
          break;
        case 'say':
          // orkestrai say: TTS sob demanda no desktop (falha silenciosa sem modelo).
          if ((!workspaceId || message.workspaceId === workspaceId) && typeof message.text === 'string' && message.text.trim()) {
            speakText(String(message.text), appSettingsStore.values.audioOutputDeviceId).catch(() => {});
          }
          break;
        case 'killed':
          exited = -1;
          break;
        case 'error':
          if (
            sessionId
            && onRespawn
            && (
              message.code === 'PTY_SESSION_NOT_FOUND'
              || /sessao pty nao encontrada/i.test(
                String(message.message).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              )
            )
          ) {
            statusMessage = '';
            onRespawn();
          } else {
            statusMessage = terminalErrorMessage(message.code, message.message);
          }
          break;
      }
    };

    const handleError = () => {
      statusMessage = m['term.ws_error']();
    };

    const handleClose = () => {
      if (exited !== null || disposed) return;
      // Suspensao/hibernacao derruba a conexao (Windows em sleep): tenta
      // re-attach com backoff. Se a sessao PTY morreu junto, o 'error' do
      // attach aciona o respawn com resume (o contexto volta sozinho).
      if (reconnectAttempts >= 6) {
        statusMessage = m['term.connection_closed']();
        return;
      }
      reconnectAttempts += 1;
      statusMessage = m['term.reconnecting']({ attempt: reconnectAttempts });
      reconnectTimer = setTimeout(connect, 2_000 * reconnectAttempts);
    };

    function connect() {
      if (disposed) return;
      socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
      socket.onopen = handleOpen;
      socket.onmessage = handleMessage;
      socket.onerror = handleError;
      socket.onclose = handleClose;
    }
    void initializeTerminal();

    terminal.onData((data) => {
      sendTerminalInput(data);
      // Enter depois de um ditado: agora sim arma a captura da resposta.
      if (pendingDictation && data.includes('\r')) {
        armDictationReplyCapture();
      }
    });
    sendInput = sendTerminalInput;

    const resizeObserver = new ResizeObserver(scheduleFitAndReportSize);
    resizeObserver.observe(container);
    const refitForDisplayChange = () => {
      terminal.clearTextureAtlas();
      scheduleFitAndReportSize();
    };
    window.addEventListener('resize', refitForDisplayChange);
    window.visualViewport?.addEventListener('resize', refitForDisplayChange);

    $effect(() => {
      terminal.options.theme = TERMINAL_THEMES[themeName]?.theme ?? TERMINAL_THEMES.dark.theme;
    });

    return () => {
      disposed = true;
      restoreTerminalMouse();
      screen?.removeEventListener('contextmenu', copySelectionFromContextMenu);
      window.removeEventListener('resize', refitForDisplayChange);
      window.visualViewport?.removeEventListener('resize', refitForDisplayChange);
      window.removeEventListener(LEADER_DICTATION_COMMAND, handleLeaderDictation);
      reportDictationState('idle');
      cancelDictation();
      if (speakTimer) clearTimeout(speakTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      captureAfterDictation = false;
      pendingDictation = false;
      resizeObserver.disconnect();
      socket?.close();
      terminal.dispose();
      xtermInstance = null;
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="terminal-node nokey"
  style:background={TERMINAL_THEMES[themeName]?.theme.background ?? TERMINAL_THEMES.dark.theme.background}
  onkeydown={handleTerminalKeydown}
  onclick={() => xtermInstance?.focus()}
  role="application"
>
  {#if waiting}
    <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="idle-dot" role="status" aria-label={m['term.idle']()}></span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="left">{m['term.idle']()}</Tooltip.Content>
      </Tooltip.Root>
  {/if}
  {#if dictationSupported}
    <div class="dictate-controls" class:busy={dictating || transcribing || checkingVoiceModels || voiceOn}>
      {#if dictating}
        <span class="dictate-rec" aria-live="polite">● {recSeconds}s</span>
      {:else if transcribing}
        <span class="dictate-transcribing">{m['voice.transcribing']()}</span>
      {:else if checkingVoiceModels}
        <span class="dictate-transcribing">{m['voice.preparing']()}</span>
      {/if}
      <Select.Root type="single" value={dictateLang} onValueChange={(value: string) => (dictateLang = value as 'auto' | 'pt' | 'en')} disabled={dictating || transcribing}>
        <Select.Trigger class="dictate-lang" aria-label={m['voice.dictation_lang']()}>
          {dictateLang === 'auto' ? 'Auto' : dictateLang.toUpperCase()}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="pt">PT</Select.Item>
          <Select.Item value="en">EN</Select.Item>
          <Select.Item value="auto">Auto</Select.Item>
        </Select.Content>
      </Select.Root>
      <HeaderIconButton
        label={dictating ? m['voice.stop_dictation']({ hotkey: comboLabel(dictateHotkey) }) : transcribing || checkingVoiceModels ? m['voice.cancel_dictation']() : m['voice.dictate']({ hotkey: comboLabel(dictateHotkey) })}
        class="dictate-btn"
        side="left"
        active={dictating}
        onclick={toggleDictation}
      >
        {#if dictating}<Square size={11} />{:else if transcribing || checkingVoiceModels}<X size={12} />{:else}<Mic size={12} />{/if}
      </HeaderIconButton>
      <HeaderIconButton
        label={voiceOn ? m['voice.on_tooltip']() : m['voice.off_tooltip']()}
        class="dictate-btn"
        side="left"
        active={voiceOn}
        onclick={() => onToggleVoice?.()}
      >
        {#if voiceOn}<Volume2 size={12} />{:else}<VolumeX size={12} />{/if}
      </HeaderIconButton>
    </div>
  {/if}
  {#if searchOpen}
    <div class="terminal-search nodrag">
      <input
        bind:value={searchQuery}
        oninput={() => searchQuery && searchAddon?.findNext(searchQuery)}
        placeholder={m['ph.search_terminal']()}
        spellcheck="false"
      />
      <span class="search-hint">{m['term.esc_closes']()}</span>
    </div>
  {/if}
  {#if dictateError}
    <p class="terminal-status">{dictateError}</p>
  {/if}
  {#if dictateStatus && !dictateError}
    <p class="terminal-status">{dictateStatus}</p>
  {/if}
  {#if statusMessage}
    <p class="terminal-status">{statusMessage}</p>
  {/if}
  {#if exited !== null}
    <p class="terminal-status">{m['term.process_exited']({ code: exited })}</p>
  {/if}
  <div class="terminal-container" bind:this={container} style:--terminal-padding="{terminalPaddingPx}px"></div>
  <VoiceConfirmDialog bind:open={voiceConfirmOpen} onConfirm={() => toggleDictation()} onCancel={() => {}} />
</div>

<style>
  .terminal-node {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: #090820;
    overflow: hidden;
  }

  .terminal-container {
    flex: 1;
    min-height: 0;
    padding: var(--terminal-padding, 6px);
    overscroll-behavior: contain;
  }

  /*
   * Controles sobre o terminal usam um vidro escuro neutro: legivel sobre
   * qualquer tema de terminal (claro ou escuro) sem competir com a saida.
   */
  .terminal-search {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 20;
    padding: 0 10px;
    height: 32px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--app-surface-raised) 94%, transparent);
    box-shadow: var(--app-shadow-overlay);
    backdrop-filter: blur(10px);
    animation: overlay-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes overlay-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(var(--distance-micro) * -1)) scale(var(--scale-dropdown));
    }
  }

  .terminal-search input {
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
    width: 240px;
  }

  .search-hint {
    font-size: 11px;
    color: var(--app-text-muted);
    white-space: nowrap;
  }

  /*
   * Ditado e fala: um grupo compacto no canto. Em repouso fica oculto para nao
   * cobrir a saida; aparece ao apontar ou focar o terminal e permanece visivel
   * enquanto grava, transcreve ou com a fala ligada.
   */
  .dictate-controls {
    position: absolute;
    bottom: 10px;
    right: 10px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: color-mix(in srgb, #0b0d10 76%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, #ffffff 9%, transparent), 0 6px 18px color-mix(in srgb, #000000 28%, transparent);
    backdrop-filter: blur(8px);
    opacity: 0;
    transform: translateY(var(--distance-micro));
    pointer-events: none;
    transition: opacity var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .dictate-controls > :global(*) {
    pointer-events: auto;
  }

  .terminal-node:hover .dictate-controls,
  .terminal-node:focus-within .dictate-controls,
  .dictate-controls.busy {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }

  :global(.dictate-lang) {
    height: 24px;
    min-height: 0;
    width: auto;
    gap: 2px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: color-mix(in srgb, #ffffff 72%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
    box-shadow: none;
  }

  :global(.dictate-lang:hover) {
    background: color-mix(in srgb, #ffffff 10%, transparent);
    color: #ffffff;
  }

  :global(.dictate-btn) {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: color-mix(in srgb, #ffffff 72%, transparent);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  :global(.dictate-btn:hover) {
    background: color-mix(in srgb, #ffffff 10%, transparent);
    color: #ffffff;
  }

  :global(.dictate-btn:active) {
    transform: scale(var(--scale-press));
  }

  :global(.dictate-btn).active {
    color: #ff6b6f;
    background: color-mix(in srgb, #e5484d 18%, transparent);
  }

  .dictate-rec {
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: #ff6b6f;
    animation: rec-pulse 1.2s ease-in-out infinite;
  }

  .dictate-transcribing {
    padding: 0 6px;
    font-size: 11px;
    color: #ffd27a;
    animation: rec-pulse 1.2s ease-in-out infinite;
  }

  @keyframes rec-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Ponto de "aguardando entrada": halo suave em vez de brilho. */
  .idle-dot {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4cc38a;
    z-index: 10;
    box-shadow: 0 0 0 3px color-mix(in srgb, #4cc38a 22%, transparent);
  }

  .terminal-status {
    margin: 0;
    padding: 7px 12px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--app-warning);
    background: color-mix(in srgb, var(--app-warning) 10%, var(--app-surface));
    border-bottom: 1px solid color-mix(in srgb, var(--app-warning) 20%, transparent);
  }
</style>
