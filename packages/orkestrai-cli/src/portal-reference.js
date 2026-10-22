/**
 * What an agent reads after a Portal screenshot: the PNG saved in the
 * workspace, to open with its own image viewer (Read in Claude Code,
 * view_image in Codex). The image itself never travels as base64 text.
 * @param {any} data the bridge response
 */
export function portalScreenshotMessage(data) {
  const file = data?.result;
  if (!file || typeof file.relativePath !== 'string') return data;
  const size = file.width && file.height ? ` (${file.width}x${file.height})` : '';
  return `Captura do Portal salva em ${file.relativePath}${size}, relativo à pasta do workspace (caminho completo: ${file.path}). Abra esse PNG para ver a tela: Read no Claude Code, view_image no Codex.`;
}
