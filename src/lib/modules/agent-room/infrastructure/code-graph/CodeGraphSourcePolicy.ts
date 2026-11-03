import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Unity regenerates these at the project root; Assets/Packages remain authored input. */
const UNITY_GENERATED_ROOTS = ['Library', 'Temp', 'obj', 'Logs', 'UserSettings'];

export async function codeGraphGeneratedRoots(root: string): Promise<string[]> {
  const unity = await stat(join(root, 'ProjectSettings', 'ProjectVersion.txt'))
    .then(info => info.isFile(), () => false);
  return unity ? [...UNITY_GENERATED_ROOTS] : [];
}

/** Root-relative matching works for native Windows, WSL/UNC and POSIX paths. */
export function isCodeGraphGeneratedPath(relativePath: string, roots: string[]): boolean {
  const first = relativePath.replaceAll('\\', '/').replace(/^\.\//, '').split('/')[0].toLowerCase();
  return roots.some(root => root.toLowerCase() === first);
}
