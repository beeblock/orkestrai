import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSshConfig, type SshMachine } from '../../domain/ssh-machines.js';

/** Other computers reachable over SSH, as the owner configured them in ~/.ssh/config. */
export class MachineService {
  async list(): Promise<SshMachine[]> {
    const text = await readFile(join(homedir(), '.ssh', 'config'), 'utf8').catch(() => '');
    return parseSshConfig(text).slice(0, 200);
  }
}

export const machineService = new MachineService();
