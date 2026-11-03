const GENERATED_PROVIDER_ENTRIES = [
  '.claude/skills/orkestrai/', '.cline/skills/orkestrai/',
  '.devin/skills/orkestrai/', '.agents/skills/orkestrai/',
] as const;
const LEGACY_GENERATED_ENTRIES = ['.orkestrai/', ...GENERATED_PROVIDER_ENTRIES];
const LEGACY_USER_OWNED_ENTRIES = [
  '.mcp.json', '.cursor/mcp.json', '.cline/mcp.json', '.devin/mcp_config.json',
  '.agents/mcp_config.json', 'opencode.json', 'AGENTS.md',
] as const;
const BEGIN = '# orkestrai:generated-excludes:begin';
const END = '# orkestrai:generated-excludes:end';
const PORTABLE_DIRECTORIES = ['roles', 'skills', 'presets', 'designs'];

/** Replace only identifiable app-owned blocks. Independent owner rules remain authoritative. */
export function updateOrkestraiGitExclude(current: string): string {
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  // Ignore runtime data by default, but keep portable definitions visible to
  // normal Git commands. Already tracked authored files are never removed.
  const block = [BEGIN, '**/.orkestrai/*',
    ...PORTABLE_DIRECTORIES.flatMap(name => [`!**/.orkestrai/${name}/`, `!**/.orkestrai/${name}/**`]),
    '!**/.orkestrai/SKILL.md', '!**/.orkestrai/REFERENCE.md',
    ...GENERATED_PROVIDER_ENTRIES, END].join(eol);
  const managed = /(^|\r?\n)# orkestrai:generated-excludes:begin\r?\n[\s\S]*?\r?\n# orkestrai:generated-excludes:end(?=\r?\n|$)/;
  if (managed.test(current)) return current.replace(managed, (_match, before) => before + block);
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const entries of [[...LEGACY_GENERATED_ENTRIES, ...LEGACY_USER_OWNED_ENTRIES], LEGACY_GENERATED_ENTRIES]) {
    const pattern = new RegExp(`(^|\\r?\\n)${escaped(entries.join(eol))}(?=\\r?\\n|$)`);
    if (pattern.test(current)) return current.replace(pattern, (_match, before) => before + block);
  }
  return `${current.replace(/(?:\r?\n)?$/, eol)}${block}${eol}`;
}
