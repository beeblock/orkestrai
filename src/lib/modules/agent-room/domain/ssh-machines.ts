export type SshMachine = { alias: string; hostName: string | null; user: string | null; port: number | null };

const ALIAS = /^[A-Za-z0-9._-]{1,128}$/;

/** Concrete Host entries of an OpenSSH config (patterns and negations are skipped). */
export function parseSshConfig(text: string): SshMachine[] {
  const machines = new Map<string, SshMachine>();
  let current: SshMachine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = /^(\S+)\s*=?\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      current = value.split(/\s+/)
        .filter((alias) => ALIAS.test(alias))
        .map((alias) => machines.get(alias) ?? { alias, hostName: null, user: null, port: null });
      for (const machine of current) machines.set(machine.alias, machine);
      continue;
    }
    if (key === 'match') {
      current = [];
      continue;
    }
    for (const machine of current) {
      if (key === 'hostname' && !machine.hostName) machine.hostName = value.slice(0, 255);
      if (key === 'user' && !machine.user) machine.user = value.slice(0, 64);
      if (key === 'port' && !machine.port) {
        const port = Number(value);
        if (Number.isInteger(port) && port > 0 && port < 65536) machine.port = port;
      }
    }
  }
  return [...machines.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}

export function isSshAlias(value: string): boolean {
  return ALIAS.test(value) && !value.startsWith('-');
}

/** Single-quotes a value for the remote POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const PROGRAM = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Arguments for a local `ssh` process that opens `program` (or a login shell)
 * in `directory` on the machine. Arguments go to node-pty as an array, so only
 * the remote command string needs quoting.
 */
export function sshTerminalArgs(alias: string, directory: string | null, program: string | null): string[] {
  if (!isSshAlias(alias)) throw new Error('Máquina SSH inválida.');
  if (program && !PROGRAM.test(program)) throw new Error('Programa inválido.');
  const cd = directory?.trim() ? `cd ${shellQuote(directory.trim())} && ` : '';
  const run = program ? `exec ${program}` : 'exec "${SHELL:-/bin/sh}" -l';
  return ['-t', alias, `${cd}${run}`];
}
