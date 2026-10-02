// Independent DDL transcribed from the user's SQLite table_xinfo screenshots.
// Do not generate this fixture through the migrations being tested: 0.39.1
// did that and therefore never covered the user's incomplete schema.
export const reportedGroupsDDL = `CREATE TABLE agent_workspace_groups (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  parent_id TEXT
)`;

export const reportedWorkspacesDDL = `CREATE TABLE agent_workspaces (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  working_dir TEXT NOT NULL,
  icon VARCHAR(255),
  instructions TEXT,
  sync_agent_instruction_files INTEGER NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  bridge_token VARCHAR(255),
  hooks_json TEXT,
  runtime_kind VARCHAR(255) NOT NULL DEFAULT 'native',
  wsl_distribution VARCHAR(255),
  wsl_working_dir TEXT,
  color VARCHAR(255),
  group_id TEXT,
  default_environment_id TEXT,
  environment_id TEXT,
  remote_working_dir VARCHAR(255)
)`;

export async function createReportedWorkspaceSchema(connection) {
  await connection.raw(reportedGroupsDDL);
  await connection.raw(reportedWorkspacesDDL);
  await connection.raw('INSERT INTO agent_workspace_groups (id, name, created_at, updated_at, parent_id) VALUES (?, ?, ?, ?, ?)',
    ['parent', 'Keep this parent', '2026-08-01', '2026-08-02', null]);
  await connection.raw('INSERT INTO agent_workspace_groups (id, name, created_at, updated_at, parent_id) VALUES (?, ?, ?, ?, ?)',
    ['child', 'Keep this child', '2026-08-03', '2026-08-04', 'parent']);
  await connection.raw('INSERT INTO agent_workspaces (id, name, working_dir, group_id, default_environment_id, environment_id, remote_working_dir) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['workspace', 'Keep this workspace', '/fixture/project', 'parent', 'fixture-default', 'fixture-environment', '/fixture/remote']);
}
