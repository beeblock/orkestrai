const string = { type: 'string' };
/** @param {Record<string, unknown>} properties @param {string[]} [required] */
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
/** @param {Record<string, unknown>} items @param {number} maxItems */
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const schema = { type: 'object', description: 'Bounded JSON Schema: type, properties, required, items, enum, default, title, description, minLength, maxLength, minimum, maximum, additionalProperties. No $ref or executable validators; depth <= 8.' };

export const TOOL_MANIFEST_SCHEMA = object({
  schemaVersion: { const: 1, type: 'integer' },
  executor: { oneOf: [
    object({ kind: { const: 'transform' }, operations: { ...list({ oneOf: [
      object({ kind: { const: 'pick' }, paths: list(string, 100) }),
      object({ kind: { const: 'set' }, path: string, value: {} }),
      object({ kind: { const: 'rename' }, from: string, to: string }),
      object({ kind: { const: 'template' }, path: string, template: string }),
    ] }, 50), minItems: 1 } }),
    object({ kind: { const: 'browser' }, nodeId: { type: 'string', format: 'uuid' }, steps: { ...list(object({ action: { enum: ['navigate','snapshot','click','type','select','extract','screenshot','wait'] }, target: object({ role: string, name: string }), args: { type: 'object' } }, ['action']), 30), minItems: 1 } }),
    object({ kind: { const: 'http' }, method: { enum: ['GET','HEAD','POST','PUT','PATCH','DELETE'] }, urlTemplate: string, headers: list(object({ name: string, value: string, secretRef: string }, ['name']), 50), bodyTemplate: { type: ['string','null'] } }, ['kind','method','urlTemplate']),
    object({ kind: { const: 'integration' }, integrationId: { type: 'string', format: 'uuid' }, action: string, inputTemplate: { type: 'object' } }, ['kind','integrationId','action']),
    object({ kind: { const: 'workspace_command' }, executable: string, args: list(string, 100), cwd: string, stdinSecretRef: { type: ['string','null'] } }, ['kind','executable']),
  ] },
  inputSchema: schema, outputSchema: schema,
  capabilities: { ...list({ enum: ['agent','browser','computer','filesystem','git','integration','network','notification','task','tool'] }, 10), minItems: 1 },
  secretRefs: list({ type: 'string', pattern: '^secretref:[0-9a-f-]{16,}$' }, 50),
  timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 },
  maxOutputBytes: { type: 'integer', minimum: 1024, maximum: 10485760 },
  fixtures: list(object({ name: string, input: { type: 'object' }, expectedOutput: {} }, ['name','input']), 20),
}, ['schemaVersion','executor','inputSchema','outputSchema','capabilities']);

export function workspaceToolReference() {
  return {
    manifestSchema: TOOL_MANIFEST_SCHEMA,
    instructions: [
      'Read tool_list.authoring for YOUR current automatic publication limits. Defaults are not standing grants. Use timeoutMs/maxOutputBytes at or below those limits.',
      'Create or update through tool_propose/tool_update with an active assigned task. A draft is not executable; check publishedRevision before tool_execute.',
      'Transform supports pick, set, rename and template, not JavaScript. Templates use input paths directly, for example {{revenue}} or {{customer.name}}. Pick removes unwanted original fields.',
      'Use at least two distinct fixtures with expectedOutput for transforms. Automatic transform publication checks their outputs, not just the output type. Do not hardcode one fixture as implementation.',
      'All executors require tool; browser also browser, http also network, integration also integration, workspace_command also filesystem. workspace_command always requires owner publication.',
      'SecretRefs only, never credentials. Browser references must belong to the authorized Portal. HTTP destinations remain literal and allowlisted. A new tool never broadens permissions.',
    ],
    transformExample: {
      schemaVersion: 1,
      executor: { kind: 'transform', operations: [
        { kind: 'template', path: 'summary', template: 'Revenue: {{revenue}}; Expenses: {{expenses}}; Balance: {{balance}}' },
        { kind: 'pick', paths: ['summary'] },
      ] },
      inputSchema: object({ revenue: { type: 'number' }, expenses: { type: 'number' }, balance: { type: 'number' } }),
      outputSchema: object({ summary: string }),
      capabilities: ['tool'], secretRefs: [], timeoutMs: 100, maxOutputBytes: 1024,
      fixtures: [
        { name: 'positive', input: { revenue: 100, expenses: 25, balance: 75 }, expectedOutput: { summary: 'Revenue: 100; Expenses: 25; Balance: 75' } },
        { name: 'negative', input: { revenue: 40, expenses: 50, balance: -10 }, expectedOutput: { summary: 'Revenue: 40; Expenses: 50; Balance: -10' } },
      ],
    },
  };
}
