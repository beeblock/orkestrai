import { Connection, TableBuilder, type ColumnDefinition, type Schema } from '@beeblock/svelar/database';

// Narrow recovery for the three historical workspace-group migrations. Do not
// infer that an arbitrary existing table means its migration was completed.
// PRAGMA/index inspection is a low-level SQLite infrastructure exception.
function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid recovery schema identifier.');
  return `"${value}"`;
}

type SqliteColumn = { name: string; type: string; notnull: number; pk: number; dflt_value: string | null; hidden: number };

function normalizedDefault(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/^\((.*)\)$/, '$1').replace(/^false$/i, '0').replace(/^true$/i, '1');
}

function assertColumn(table: string, actual: SqliteColumn | undefined, expected: ColumnDefinition) {
  const type = expected.type === 'UUID' ? 'TEXT' : expected.type === 'BOOLEAN' ? 'INTEGER' : expected.type;
  if (!actual || actual.hidden !== 0 || actual.type.toUpperCase() !== type.toUpperCase()
    || actual.pk !== Number(expected.primaryKey)
    || actual.notnull !== Number(!expected.nullable && !expected.primaryKey)
    || normalizedDefault(actual.dflt_value) !== normalizedDefault(expected.defaultValue)) {
    throw new Error(`Cannot safely resume workspace migration: incompatible ${table}.${expected.name}. Data was preserved.`);
  }
}

async function tableColumns(table: string): Promise<SqliteColumn[]> {
  return Connection.raw(`PRAGMA table_xinfo(${identifier(table)})`);
}

export async function createResumableWorkspaceGroups(schema: Schema, define: (table: TableBuilder) => void) {
  const name = 'agent_workspace_groups';
  if (Connection.getDriver() !== 'sqlite' || !await schema.hasTable(name)) {
    await schema.createTable(name, define);
    return;
  }

  const blueprint = new TableBuilder();
  define(blueprint);
  const columns = await tableColumns(name);
  for (const column of blueprint.getColumns()) assertColumn(name, columns.find((item) => item.name === column.name), column);
  // A later historical migration may already have added collapsed.
  const later = new TableBuilder();
  later.boolean('collapsed').default(false);
  const collapsed = columns.find((column) => column.name === 'collapsed');
  if (collapsed) assertColumn(name, collapsed, later.getColumns()[0]);
  const allowed = new Set([...blueprint.getColumns().map((column) => column.name), 'collapsed']);
  if (columns.some((column) => !allowed.has(column.name))) throw new Error('Cannot safely resume workspace migration: unknown group columns. Data was preserved.');

  const foreignKeys = await Connection.raw(`PRAGMA foreign_key_list(${identifier(name)})`);
  if (foreignKeys.length !== 1 || foreignKeys[0].from !== 'parent_id' || foreignKeys[0].to !== 'id'
    || foreignKeys[0].table !== name || foreignKeys[0].on_delete !== 'SET NULL'
    || foreignKeys[0].on_update !== 'NO ACTION') {
    throw new Error('Cannot safely resume workspace migration: incompatible group foreign key. Data was preserved.');
  }

  const indexName = 'idx_agent_workspace_groups_parent_id_position';
  const [existing] = await Connection.raw('SELECT type, tbl_name FROM sqlite_master WHERE name = ?', [indexName]);
  if (existing) {
    const index = (await Connection.raw(`PRAGMA index_list(${identifier(name)})`)).find((item: { name: string }) => item.name === indexName);
    const indexed = await Connection.raw(`PRAGMA index_info(${identifier(indexName)})`);
    if (existing.type !== 'index' || existing.tbl_name !== name || !index || index.unique !== 0 || index.partial !== 0
      || indexed.map((item: { name: string }) => item.name).join(',') !== 'parent_id,position') {
      throw new Error('Cannot safely resume workspace migration: incompatible group index. Data was preserved.');
    }
  } else {
    // Reuse the exact Svelar-generated index statement; never drop/recreate data.
    await Connection.raw(blueprint.toSQL(name, 'sqlite')[1]);
  }
}

export async function addResumableWorkspaceColumns(schema: Schema, table: string, definitions: Record<string, (table: TableBuilder) => void>) {
  if (Connection.getDriver() !== 'sqlite') {
    await schema.table(table, (blueprint) => Object.values(definitions).forEach((define) => define(blueprint)));
    return;
  }
  const columns = await tableColumns(table);
  if (!columns.length) throw new Error('Cannot safely resume workspace migration: target table is missing.');
  const missing: Array<(table: TableBuilder) => void> = [];
  // Validate every existing target before adding any missing column.
  for (const [name, define] of Object.entries(definitions)) {
    const blueprint = new TableBuilder();
    define(blueprint);
    const expected = blueprint.getColumns();
    if (expected.length !== 1 || expected[0].name !== name) throw new Error('Invalid recovery column definition.');
    const actual = columns.find((column) => column.name === name);
    if (actual) assertColumn(table, actual, expected[0]);
    else missing.push(define);
  }
  for (const define of missing) await schema.table(table, define);
}
