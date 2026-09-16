const fs = require('node:fs/promises');
const path = require('node:path');

function isWithin(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`));
}

/** Never pass a file, URL, executable bundle or shell command to openPath. */
async function openWorkspaceFolder(shell, input) {
  if (!input || !['root', 'path'].every(key => typeof input[key] === 'string' && input[key].length <= 4000
    && !/[\x00-\x1f\x7f]/.test(input[key]) && path.isAbsolute(input[key]))) throw new Error('Invalid folder path.');
  if (!isWithin(input.root, input.path)) throw new Error('Folder is outside the approved repository.');
  const root = await fs.realpath(input.root);
  const candidate = await fs.realpath(input.path);
  if (!isWithin(root, candidate)) throw new Error('Folder is outside the approved repository.');
  if (!(await fs.stat(candidate)).isDirectory()) throw new Error('Only folders can be opened with this action.');
  if (/\.(?:app|workflow|bundle|xpc|plugin|prefpane|scptd)$/i.test(candidate)
    || /\.\{[a-f0-9-]{36}\}$/i.test(candidate)) throw new Error('Application bundles and shell shortcuts cannot be opened as folders.');
  const error = await shell.openPath(candidate);
  if (error) throw new Error('The system file manager could not open the folder.');
  return { opened: true };
}

module.exports = { openWorkspaceFolder, isWithin };
