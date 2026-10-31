/** Agent and UI commands use the same server-side leadership validation. */
const id = { type: 'string', format: 'uuid' };
const revision = { type: 'string', minLength: 1, maxLength: 128 };
const text = { type: 'string', minLength: 1, maxLength: 8000 };
const strings = { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 2000 } };
/** @param {string} name @param {Record<string, unknown>} properties @param {string[]} [required] */
const command = (name, properties, required = []) => ({ type: 'object', properties: { command: { type: 'string', const: name }, ...properties }, required: ['command', ...required] });
export const LEADERSHIP_COMMAND_SCHEMA = { oneOf: [
  command('configure', { requestId: id, expectedRevision: revision, leaderNodeId: { anyOf: [id, { type: 'null' }] }, deputyNodeId: { anyOf: [id, { type: 'null' }] }, note: text, taskId: id }, ['requestId', 'expectedRevision', 'leaderNodeId', 'deputyNodeId']),
  command('handoff_read', { handoffId: id, section: { type: 'string', enum: ['overview', 'instructions', 'messages', 'tasks', 'notes', 'learning'] }, offset: { type: 'integer', minimum: 0, maximum: 10000 } }, ['handoffId']),
  command('handoff_brief', { handoffId: id, brief: text }, ['handoffId', 'brief']),
  command('handoff_acknowledge', { handoffId: id }, ['handoffId']),
  command('review_prepare', { taskId: id, artifacts: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
    { type: 'object', properties: { kind: { const: 'file' }, path: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['kind', 'path'] },
    { type: 'object', properties: { kind: { const: 'node' }, nodeId: id }, required: ['kind', 'nodeId'] },
  ] } }, note: text }, ['taskId', 'artifacts']),
  command('review_read', { reviewId: id }, ['reviewId']),
  command('review_decide', { reviewId: id, expectedRevision: revision, decision: { type: 'string', enum: ['approve', 'changes_requested'] }, evidence: strings, findings: { ...strings, minItems: 0 } }, ['reviewId', 'expectedRevision', 'decision', 'evidence']),
] };
export const LEADERSHIP_TOOLS = [
  { name: 'leadership_status', description: 'Reads the current primary, optional deputy, durable context handoffs and compact review states. No polling loop. A configured deputy makes task done request two independent approvals instead of closing the card.', inputSchema: { type: 'object', properties: {} } },
  { name: 'leadership_command', description: 'Transfer leadership with saved context, manage the optional deputy, read/acknowledge a handoff, add the former leader brief, prepare delivery artifacts, read full review evidence or record your own independent decision. Read leadership_status first for revision and node ids. Only the actual primary/deputy can configure with an active coordination task; agents cannot remove the deputy review gate. Only each reviewer\'s authenticated live terminal can cast its vote. Findings require corrections and a fresh review approved by BOTH. Other executable cards continue.', inputSchema: { type: 'object', properties: { input: LEADERSHIP_COMMAND_SCHEMA }, required: ['input'] } },
];
/** @param {string[]} rest @param {Record<string, unknown>} flags */
export function leadershipCliInput(rest, flags) {
  if (flags.input) return JSON.parse(String(flags.input));
  const [area, action, key, ...body] = rest;
  if (area === 'handoff') {
    if (action === 'read') return { command: 'handoff_read', handoffId: key, section: flags.section ?? 'overview', offset: Number(flags.offset ?? 0) };
    if (action === 'brief') return { command: 'handoff_brief', handoffId: key, brief: body.join(' ') };
    if (action === 'acknowledge' || action === 'ack') return { command: 'handoff_acknowledge', handoffId: key };
  }
  if (area === 'review') {
    if (action === 'read') return { command: 'review_read', reviewId: key };
    if (action === 'prepare') return { command: 'review_prepare', taskId: key, artifacts: [
      ...(flags.file ? [{ kind: 'file', path: flags.file }] : []), ...(flags.node ? [{ kind: 'node', nodeId: flags.node }] : []),
    ] };
    if (action === 'approve' || action === 'changes') return { command: 'review_decide', reviewId: key, expectedRevision: flags.revision,
      decision: action === 'approve' ? 'approve' : 'changes_requested', evidence: flags.evidence ? [String(flags.evidence)] : [], findings: flags.finding ? [String(flags.finding)] : [] };
  }
  throw new Error('Use: orkestrai leadership status | command --input <json> | handoff read|brief|acknowledge <id> | review prepare <task> --file <path> | review read|approve|changes <id> --revision <revision> --evidence <text> [--finding <text>]. Use --input for several artifacts/evidence entries.');
}
