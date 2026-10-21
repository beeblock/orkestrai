import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { planNodeService } from '$lib/modules/agent-room/application/services/PlanNodeService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { PlanNodeController } from '$lib/modules/agent-room/interface/http/controllers/PlanNodeController.js';
import { calendarOperationsSchema, checklistOperationsSchema } from '$lib/modules/agent-room/contracts/schemas/planNodeSchemas.js';

async function board() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'plan', workingDir: '/tmp' });
  const checklist = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'checklist', title: 'Lançamento', payload: { items: [{ id: 'a', text: 'Revisar', done: false }] } });
  const calendar = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'calendar', title: 'Agenda', payload: { events: [] } });
  return { workspace, checklist, calendar };
}

function bridgeEvent(method: 'GET' | 'POST', path: string, token: string, nodeId: string, body?: unknown) {
  const url = new URL(`http://localhost/api/agent-room/bridge/${path}/${encodeURIComponent(nodeId)}`);
  return {
    request: new Request(url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    params: { nodeId },
    url,
  };
}

describe('checklists and calendars', () => {
  useSvelarTest({ refreshDatabase: true });

  it('keeps every item when two screens change a checklist at once or one screen is out of date', async () => {
    const { workspace, checklist } = await board();
    // Two screens add at the same moment.
    await Promise.all([
      planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'add', text: 'Gravar vídeo' }]),
      planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'add', text: 'Publicar post' }]),
    ]);
    // A screen still showing only the first item checks it: the others stay.
    const after = await planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'set', itemId: 'a', done: true }]);
    expect(after.items.map((item) => item.text).sort()).toEqual(['Gravar vídeo', 'Publicar post', 'Revisar']);
    expect(after.items.find((item) => item.id === 'a')?.done).toBe(true);
    expect(((await workspaceRepository.getNode(checklist.id))!.payload as { items: unknown[] }).items).toHaveLength(3);

    await expect(planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'set', itemId: 'gone', done: true }])).rejects.toThrow('não existe mais');
    const removed = await planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'remove', itemId: 'a' }, { op: 'remove', itemId: 'a' }]);
    expect(removed.items).toHaveLength(2);
    const id = '01a15042-3362-4000-8000-000000000001';
    await planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'add', id, text: 'Uma vez' }]);
    const twice = await planNodeService.applyChecklist(workspace.id, checklist.id, [{ op: 'add', id, text: 'Uma vez' }]);
    expect(twice.items.filter((item) => item.id === id)).toHaveLength(1);
  });

  it('changes calendar events on the latest content and keeps a timeless event all day', async () => {
    const { workspace, calendar } = await board();
    const created = await planNodeService.applyCalendar(workspace.id, 'agenda', [
      { op: 'add', title: 'Reunião', date: '2026-10-21', time: '14:30' },
      { op: 'add', title: 'Entrega', date: '2026-10-20' },
    ]);
    expect(created.events.map((event) => [event.date, event.time, event.allDay, event.title])).toEqual([
      ['2026-10-20', null, true, 'Entrega'],
      ['2026-10-21', '14:30', false, 'Reunião'],
    ]);
    const meeting = created.events.find((event) => event.title === 'Reunião')!;
    const moved = await planNodeService.applyCalendar(workspace.id, calendar.id, [{ op: 'edit', eventId: meeting.id, date: '2026-10-22', time: null, notes: 'Sala 2' }]);
    expect(moved.events.find((event) => event.id === meeting.id)).toMatchObject({ date: '2026-10-22', time: null, allDay: true, notes: 'Sala 2' });
    const timed = await planNodeService.applyCalendar(workspace.id, calendar.id, [{ op: 'edit', eventId: meeting.id, time: '09:00' }]);
    expect(timed.events.find((event) => event.id === meeting.id)).toMatchObject({ time: '09:00', allDay: false });
    expect((await planNodeService.applyCalendar(workspace.id, calendar.id, [{ op: 'remove', eventId: meeting.id }])).events).toHaveLength(1);
  });

  it('accepts only real dates and times, and drops fields an operation does not use', () => {
    expect(calendarOperationsSchema.safeParse({ operations: [{ op: 'add', title: 'X', date: '2026-02-30' }] }).success).toBe(false);
    expect(calendarOperationsSchema.safeParse({ operations: [{ op: 'add', title: 'X', date: '2026-10-20', time: '25:00' }] }).success).toBe(false);
    expect(calendarOperationsSchema.parse({ operations: [{ op: 'remove', eventId: 'e1', title: null }] }).operations[0]).toEqual({ op: 'remove', eventId: 'e1' });
    expect(checklistOperationsSchema.safeParse({ operations: [] }).success).toBe(false);
    expect(checklistOperationsSchema.safeParse({ operations: [{ op: 'add', text: '   ' }] }).success).toBe(false);
  });

  it('finds a node by id or exact title only in its own workspace and type', async () => {
    const { workspace, checklist, calendar } = await board();
    const other = await workspaceRepository.createWorkspace({ name: 'outro', workingDir: '/tmp' });
    await expect(planNodeService.checklist(other.id, checklist.id)).rejects.toThrow('não é um checklist deste workspace');
    await expect(planNodeService.checklist(workspace.id, calendar.id)).rejects.toThrow('não é um checklist');
    expect((await planNodeService.checklist(workspace.id, 'LANÇAMENTO')).nodeId).toBe(checklist.id);
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'checklist', title: 'Lançamento', payload: {} });
    await expect(planNodeService.checklist(workspace.id, 'Lançamento')).rejects.toThrow('use o id');
    await expect(planNodeService.calendar(workspace.id, 'Nada')).rejects.toThrow('Nenhum calendário');
  });

  it('lets agents read and change them through the bridge', async () => {
    const { workspace, checklist, calendar } = await board();
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const controller = new BridgeController();
    const added = await controller.checklistUpdate(bridgeEvent('POST', 'checklists', token, 'Lançamento', { operations: [{ op: 'add', text: 'Testar no celular', itemId: null }] }) as never) as Response;
    expect(added.status, await added.clone().text()).toBe(200);
    const read = await (await controller.checklistRead(bridgeEvent('GET', 'checklists', token, checklist.id) as never) as Response).json();
    expect(read.data.items.map((item: { text: string }) => item.text)).toEqual(['Revisar', 'Testar no celular']);
    const event = await controller.calendarUpdate(bridgeEvent('POST', 'calendars', token, calendar.id, { operations: [{ op: 'add', title: 'Demo', date: '2026-10-23', time: '10:00' }] }) as never) as Response;
    expect((await event.json()).data.events).toEqual([expect.objectContaining({ title: 'Demo', date: '2026-10-23', time: '10:00', allDay: false })]);
    const refused = await controller.checklistRead(bridgeEvent('GET', 'checklists', 'wrong-token', checklist.id) as never) as Response;
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it('accepts the screens operations on the workspace node routes', async () => {
    const { workspace, checklist, calendar } = await board();
    const route = (kind: string, nodeId: string, body?: unknown) => {
      const url = new URL(`http://localhost/api/agent-room/workspaces/${workspace.id}/nodes/${nodeId}/${kind}`);
      return { request: new Request(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), params: { id: workspace.id, nodeId }, url };
    };
    const controller = new PlanNodeController();
    const added = await controller.updateChecklist(route('checklist', checklist.id, { operations: [{ op: 'add', id: '6f1c2c1e-1f8a-4c3e-9d2b-1a2b3c4d5e6f', text: 'Novo' }] }) as never) as Response;
    expect(added.status, await added.clone().text()).toBe(200);
    expect((await added.json()).data.items.map((item: { text: string }) => item.text)).toEqual(['Revisar', 'Novo']);
    const read = await controller.checklist(route('checklist', checklist.id) as never) as Response;
    expect((await read.json()).data.items).toHaveLength(2);
    const invalid = await controller.updateChecklist(route('checklist', checklist.id, { operations: [] }) as never) as Response;
    expect(invalid.status).toBe(400);
    const event = await controller.updateCalendar(route('calendar', calendar.id, { operations: [{ op: 'add', id: '7f1c2c1e-1f8a-4c3e-9d2b-1a2b3c4d5e6f', title: 'Demo', date: '2026-10-23', allDay: true, time: null, color: '#e8b84a', notes: null }] }) as never) as Response;
    expect(event.status, await event.clone().text()).toBe(200);
  });
});
