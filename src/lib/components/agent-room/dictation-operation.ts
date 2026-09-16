export const DICTATION_START_TIMEOUT_MS = 15_000;
export const DICTATION_TRANSCRIBE_TIMEOUT_MS = 180_000;
export const DICTATION_MAX_RECORDING_MS = 15 * 60_000;

/** One attempt owns capture, deadlines and insertion, even if an old request resolves late. */
export class DictationOperation {
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly signal = this.controller.signal;

  deadline(milliseconds: number | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = milliseconds === null ? null : setTimeout(() => {
      this.controller.abort(new DOMException('Dictation timed out.', 'TimeoutError'));
    }, milliseconds);
  }

  cancel(): void {
    this.deadline(null);
    this.controller.abort(new DOMException('Dictation cancelled.', 'AbortError'));
  }

  wait<T>(pending: Promise<T>, discard?: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
      pending.then((value) => {
        if (this.signal.aborted) discard?.(value);
        else resolve(value);
      }, reject).finally(() => this.signal.removeEventListener('abort', abort));
    });
  }
}
