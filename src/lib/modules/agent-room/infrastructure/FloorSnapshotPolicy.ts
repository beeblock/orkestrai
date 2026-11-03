const RUNTIME_DIRECTORIES = ['floors', 'reviews'];
const RUNTIME_FILES = ['workspace.json', 'runtime.json', 'bin/orkestrai', 'bin/orkestrai.cmd'];

/** Keep versioned roles, skills, designs and unknown authored files. Only runtime state is prohibited. */
export function isFloorRuntimePath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/').map(part => part.toLowerCase());
  return parts.some((part, index) => part === '.orkestrai'
    && (RUNTIME_DIRECTORIES.includes(parts[index + 1])
      || RUNTIME_FILES.includes(parts.slice(index + 1).join('/'))));
}

export function floorRuntimePathspecs(exclude = false): string[] {
  const prefix = `:(top,glob,icase${exclude ? ',exclude' : ''})**/.orkestrai/`;
  return [
    ...RUNTIME_DIRECTORIES.flatMap(name => [`${prefix}${name}`, `${prefix}${name}/**`]),
    ...RUNTIME_FILES.map(name => `${prefix}${name}`),
  ];
}
