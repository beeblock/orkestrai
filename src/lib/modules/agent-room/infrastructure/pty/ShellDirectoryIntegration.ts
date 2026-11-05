const powershellPrompt = [
  '$global:__OrkestraiOriginalPrompt = $function:prompt;',
  'function global:prompt {',
  '  $directory = $executionContext.SessionState.Path.CurrentFileSystemLocation.Path;',
  '  [Console]::Write(([char]27).ToString() + "]9;9;" + $directory + ([char]7));',
  '  if ($global:__OrkestraiOriginalPrompt) { & $global:__OrkestraiOriginalPrompt } else { "PS " + $directory + "> " }',
  '}',
].join('\n');

const bashPrompt = 'builtin printf "\\033]9;9;%s\\007" "$PWD"';
const bashRc = [
  'if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
  '__orkestrai_report_directory() { ' + bashPrompt + '; }',
  'case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in',
  '  declare\\ -a*) PROMPT_COMMAND+=(__orkestrai_report_directory) ;;',
  '  *) if [ -n "$PROMPT_COMMAND" ]; then PROMPT_COMMAND="$PROMPT_COMMAND; __orkestrai_report_directory"; else PROMPT_COMMAND=__orkestrai_report_directory; fi ;;',
  'esac',
].join('\n');
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const wslDirectoryShellScript = 'builtin printf "\\033]777;orkestrai-pid;%s\\007" "$$"; ' + "export PATH=\"$ORKESTRAI_WORKSPACE_BIN:$PATH\"; exec /bin/bash --rcfile <(builtin printf '%s\\n' " + quote(bashRc) + ') -i';

/** Session-only integration: never edit profile files or provider CLI arguments. */
export function integrateNativeShellDirectory(command: string, args: string[], env: Record<string, string>, platform = process.platform) {
  if (platform !== 'win32') return { args, env };
  const shell = command.replaceAll('\\', '/').split('/').at(-1) ?? '';
  if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(shell) && args.length === 0) {
    return { args: ['-NoExit', '-EncodedCommand', Buffer.from(powershellPrompt, 'utf16le').toString('base64')], env };
  }
  if (/^cmd(?:\.exe)?$/i.test(shell) && !args.some(arg => /^\/c$/i.test(arg))) {
    return { args, env: { ...env, PROMPT: '$e]9;9;$P$e\\' + (env.PROMPT ?? '$P$G') } };
  }
  if (/^wsl(?:\.exe)?$/i.test(shell) && !args.some(arg => ['--exec', '-e', '--shell-type', '--system'].includes(arg))) {
    const forwarded = (env.WSLENV ?? '').split(':').filter(Boolean);
    if (!forwarded.some(value => value.split('/')[0] === 'PROMPT_COMMAND')) forwarded.push('PROMPT_COMMAND');
    return { args, env: { ...env, WSLENV: forwarded.join(':'), PROMPT_COMMAND: (env.PROMPT_COMMAND ? env.PROMPT_COMMAND + '; ' : '') + bashPrompt } };
  }
  return { args, env };
}
