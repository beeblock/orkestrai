const RESULT_MARKER = '__orkestraiPortalScriptResult';
const MAX_ERROR_LENGTH = 2_000;

type PortalScriptEnvelope = {
  [RESULT_MARKER]: true;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
};

export function portalScriptExpression(source: string): string {
  const encodedSource = JSON.stringify(source);
  return `(async () => {
    const normalize = (value) => {
      if (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (typeof value === 'bigint') return String(value);
      try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? String(value) : JSON.parse(serialized);
      } catch {
        return String(value);
      }
    };
    try {
      const value = await (0, eval)(${encodedSource});
      return { ${JSON.stringify(RESULT_MARKER)}: true, ok: true, value: normalize(value) };
    } catch (error) {
      return {
        ${JSON.stringify(RESULT_MARKER)}: true,
        ok: false,
        error: {
          name: String(error?.name ?? 'Error').slice(0, 120),
          message: String(error?.message ?? error ?? 'Portal script failed.').slice(0, ${MAX_ERROR_LENGTH}),
        },
      };
    }
  })()`;
}

export function unwrapPortalScriptResult(value: unknown): unknown {
  const envelope = value as PortalScriptEnvelope | null;
  if (!envelope || typeof envelope !== 'object' || envelope[RESULT_MARKER] !== true || typeof envelope.ok !== 'boolean') {
    throw new Error('Portal returned an invalid script result.');
  }
  if (!envelope.ok) {
    const name = String(envelope.error?.name ?? 'Error').slice(0, 120);
    const message = String(envelope.error?.message ?? 'Portal script failed.').slice(0, MAX_ERROR_LENGTH);
    throw new Error(`${name}: ${message}`);
  }
  return envelope.value;
}
