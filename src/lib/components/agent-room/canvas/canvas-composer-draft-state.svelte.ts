import { readCanvasDraft, writeCanvasDraft } from './canvas-composer-drafts.js';

export class CanvasComposerDraft {
  #text = $state('');
  #revision = 0;
  sending = $state(false);
  constructor(readonly workspaceId: string, storage: Storage | null) {
    this.#text = readCanvasDraft(storage, workspaceId);
  }
  get text(): string { return this.#text; }
  set text(value: string) {
    if (value === this.#text) return;
    this.#revision++;
    this.#text = value;
  }
  capture(): { text: string; revision: number } {
    return { text: this.text.trim(), revision: this.#revision };
  }
  accept(submitted: { revision: number }, storage: Storage | null): void {
    if (this.#revision === submitted.revision) this.text = '';
    this.save(storage);
  }
  save(storage: Storage | null): void { writeCanvasDraft(storage, this.workspaceId, this.text); }
}

// Sharing the draft also lets a send acknowledgement update a composer that
// was remounted while that request was in flight. No prompt goes to the server
// until Send; this bounded cache contains no attachments or provider secrets.
const drafts = new Map<string, CanvasComposerDraft>();
export function canvasComposerDraft(workspaceId: string, storage: Storage | null): CanvasComposerDraft {
  const draft = drafts.get(workspaceId) ?? new CanvasComposerDraft(workspaceId, storage);
  drafts.delete(workspaceId);
  drafts.set(workspaceId, draft);
  if (drafts.size > 20) {
    for (const [id, old] of drafts) {
      if (id === workspaceId || old.sending) continue;
      old.save(storage);
      drafts.delete(id);
      break;
    }
  }
  return draft;
}
