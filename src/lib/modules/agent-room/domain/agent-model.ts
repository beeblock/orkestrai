/** Display metadata only; never forward launch arguments or embedded instructions. */
export function modelFromArgs(args: readonly unknown[] | null | undefined): string | null {
  if (!Array.isArray(args)) return null;
  for (let index = 0; index < args.length; index++) {
    const value = String(args[index] ?? '');
    if (value.startsWith('--model=')) return value.slice(8).trim() || null;
    if ((value === '--model' || value === '-m') && typeof args[index + 1] === 'string') {
      const next = String(args[index + 1]).trim();
      return next && !next.startsWith('-') ? next : null;
    }
  }
  return null;
}
