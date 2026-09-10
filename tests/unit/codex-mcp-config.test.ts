import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import {
  codexMcpLaunchForRuntime,
  codexMcpOverrideArgs,
  codexWorkspaceTrustOverrideArgs,
  FIGMA_MCP_URL,
  repairLegacyCodexMcpConfig,
} from '$lib/modules/agent-room/infrastructure/codex-mcp-config.js';

describe('configuracao MCP do Codex', () => {
  const windowsLaunch = {
    command: 'C:\\Program Files\\Orkestrai\\Orkestrai.exe',
    args: ['C:\\Program Files\\Orkestrai\\resources\\app\\packages\\orkestrai-cli\\bin\\orkestrai.js', 'mcp'],
    electronRuntime: true,
  };

  it('repara exatamente o TOML corrompido por versoes anteriores', () => {
    const corrupted = [
      '[mcp_servers.orkestrai]',
      'command = "/Applications/Orkestrai.app/Contents/MacOS/Orkestrai"',
      'args = ["/Applications/Orkestrai.app/Contents/Resources/app/packages/orkestrai-cli/bin/orkestrai.js", "mcp"]',
      'default_tools_approval_mode = "approve"',
      '  "/Applications/Orkestrai.app/Contents/Resources/app/packages/orkestrai-cli/bin/orkestrai.js",',
      '  "mcp"',
      ']',
      'env = { ELECTRON_RUN_AS_NODE = "1" }',
      '',
      '[mcp_servers.orkestrai.env]',
      'ELECTRON_RUN_AS_NODE = "1"',
      '',
      '[features]',
      'js_repl = false',
      '',
    ].join('\n');

    const result = repairLegacyCodexMcpConfig(corrupted);

    expect(result.repaired).toBe(true);
    expect(result.content).not.toContain('\n  "/Applications/Orkestrai.app');
    expect(result.content).not.toContain('env = { ELECTRON_RUN_AS_NODE');
    expect(result.content).toContain('default_tools_approval_mode = "approve"');
    expect(result.content).toContain('[features]\njs_repl = false');
    expect(() => parse(result.content)).not.toThrow();
  });

  it('nao altera TOML invalido que nao tenha a assinatura de corrupcao do Orkestrai', () => {
    const malformed = '[features]\nthis is not toml\n';
    expect(repairLegacyCodexMcpConfig(malformed)).toEqual({ content: malformed, repaired: false });
  });

  it('nao altera configuracao global valida, inclusive uma secao Orkestrai customizada', () => {
    const valid = [
      '[mcp_servers.orkestrai]',
      'command = "my-wrapper"',
      'args = ["mcp"]',
      'default_tools_approval_mode = "approve"',
      '',
    ].join('\n');
    expect(repairLegacyCodexMcpConfig(valid)).toEqual({ content: valid, repaired: false });
  });

  it('gera overrides efemeros completos sem persistir configuracao', () => {
    const args = codexMcpOverrideArgs(windowsLaunch);

    expect(args).toContain('mcp_servers.orkestrai.command="C:\\\\Program Files\\\\Orkestrai\\\\Orkestrai.exe"');
    expect(args).toContain('mcp_servers.orkestrai.env={ ELECTRON_RUN_AS_NODE = "1" }');
    expect(args).toContain(`mcp_servers.figma.url="${FIGMA_MCP_URL}"`);
    const forwarded = args.find((arg) => arg.startsWith('mcp_servers.orkestrai.env_vars='))!;
    const config = parse(forwarded) as any;
    expect(config.mcp_servers.orkestrai.env_vars).toContain('ORKESTRAI_AGENT_TOKEN');
    expect(config.mcp_servers.orkestrai.env_vars).toContain('ORKESTRAI_NODE_ID');
    expect(config.mcp_servers.orkestrai.env_vars).not.toContain('OPENAI_API_KEY');
  });

  it('resolve o launcher dentro da distribuicao WSL sem reutilizar caminhos Windows', () => {
    const launch = codexMcpLaunchForRuntime({
      kind: 'wsl',
      distribution: 'Ubuntu-24.04',
      linuxWorkingDir: '/home/raoni/project',
    });

    expect(launch).toEqual({
      command: '/home/raoni/project/.orkestrai/bin/orkestrai',
      args: ['mcp'],
      electronRuntime: false,
    });
  });

  it('confia somente o workspace exato em launches Codex de acesso total', () => {
    expect(codexWorkspaceTrustOverrideArgs('C:\\Users\\Raoni\\project', true)).toEqual([
      '-c',
      'projects={"C:\\\\Users\\\\Raoni\\\\project"={trust_level="trusted"}}',
    ]);
    expect(codexWorkspaceTrustOverrideArgs('/home/raoni/project', true)).toEqual([
      '-c',
      'projects={"/home/raoni/project"={trust_level="trusted"}}',
    ]);
    expect(codexWorkspaceTrustOverrideArgs('/home/raoni/project', false)).toEqual([]);
  });

});
