// Fixed diagnostics cross the desktop boundary; native error text never does.
export const nativeFailureMessages = {
  permission_accessibility: 'Orkestrai Accessibility permission is required. No input was attempted.',
  permission_screen_recording: 'Orkestrai Screen Recording permission is required.',
  runtime_load_failed: 'The embedded Computer runtime could not load.',
  runtime_busy: 'The embedded Computer runtime is busy or stopping. No input was attempted.',
  runtime_expired: 'The native operation expired. Inspect before repeating an uncertain action.',
  observation_incomplete: 'A complete native conversation observation is required.',
  control_changed: 'The native control or recipient changed.',
  guard_unbound: 'The current recipient guard could not be bound to the native driver.',
  control_unavailable: 'The requested native control or action is unavailable.',
  delivery_interrupted: 'The native driver did not confirm the action. Do not retry automatically.',
  effect_unconfirmed: 'The native action effect is unconfirmed. Inspect the target; no automatic retry.',
  result_unconfirmed: 'The action ran but its resulting native state is unconfirmed.',
  recipient_changed: 'The recipient changed after composition. No Send was attempted.',
  draft_unconfirmed: 'The complete draft could not be confirmed. No Send was attempted.',
  clipboard_interrupted: 'Native paste or clipboard restoration was interrupted. Do not retry automatically.',
} as const;

export type NativeFailureCode = keyof typeof nativeFailureMessages;

export function nativeFailureMessage(code: unknown): string | undefined {
  return typeof code === 'string' && Object.hasOwn(nativeFailureMessages, code)
    ? nativeFailureMessages[code as NativeFailureCode] : undefined;
}

// This receipt comes only from a trusted native adapter, never a bridge payload.
export class NativeInteractionError extends Error {
  constructor(message: string, readonly inputAttempted: boolean, readonly code?: NativeFailureCode) {
    super(message);
    this.name = 'NativeInteractionError';
  }
}
