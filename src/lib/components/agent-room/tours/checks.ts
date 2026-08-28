import type { Tour, TourCheck, WorkspaceSnapshot } from './types.js';

/** O tour conclui quando o ultimo passo tem check E ele passou (auto-conclusao no poll). */
export function isTourComplete(tour: Tour, stepIndex: number, autoCompleted: ReadonlySet<string>): boolean {
  const last = tour.steps.at(-1);
  return Boolean(last?.check && autoCompleted.has(last.id) && stepIndex >= tour.steps.length - 1);
}

/** Avalia um check de passo contra o snapshot do workspace (puro, sem runes). */
export function checkPasses(check: TourCheck, snap: WorkspaceSnapshot): boolean {
  switch (check.kind) {
    case 'nodeExists': {
      const needle = check.titleIncludes?.toLowerCase();
      return snap.nodes.some((node) => node.type === check.nodeType && (!needle || (node.title ?? '').toLowerCase().includes(needle)));
    }
    case 'edgeExists': {
      const idOf = (title: string) => snap.nodes.find((node) => (node.title ?? '').toLowerCase() === title.toLowerCase())?.id;
      const from = idOf(check.fromTitle);
      const to = idOf(check.toTitle);
      if (!from || !to) return false;
      return snap.edges.some(
        (edge) =>
          (edge.sourceNodeId === from && edge.targetNodeId === to) || (edge.sourceNodeId === to && edge.targetNodeId === from)
      );
    }
    case 'taskExists':
      return snap.tasks.some((task) => task.title.toLowerCase().includes(check.titleIncludes.toLowerCase()));
    case 'mcpInstalled':
      return snap.mcps.some((server) => server.name === check.name);
    case 'floorExists':
      return snap.floors.some((floor) => floor.name.toLowerCase().includes(check.nameIncludes.toLowerCase()));
    case 'routineExists':
      return snap.routines.length > 0;
    case 'flowRunFinished': {
      const flow = snap.nodes.find((node) => node.type === 'flow');
      const run = (flow?.payload as { run?: { active?: boolean } | null } | undefined)?.run;
      return Boolean(flow) && run === null;
    }
    case 'imageWorkflowSucceeded': {
      const workflow = snap.nodes.find((node) => (
        node.type === 'imageWorkflow' && (node.title ?? '').toLowerCase() === check.title.toLowerCase()
      ));
      if (!workflow || workflow.payload?.status !== 'succeeded') return false;
      const outputCount = snap.nodes.filter((node) => (
        node.type === 'image'
        && (node.payload?.generatedBy as { workflowNodeId?: unknown } | undefined)?.workflowNodeId === workflow.id
      )).length;
      return outputCount >= (check.minOutputs ?? 1);
    }
  }
}
