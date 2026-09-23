<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, Download } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
  import * as m from '$lib/paraglide/messages.js';
  let { url }: { url: string } = $props();
  let canvas: HTMLCanvasElement, host: HTMLDivElement;
  let page = $state(1), pages = $state(0), busy = $state(true), error = $state('');
  let pdf: PDFDocumentProxy | null = null, rendering: RenderTask | null = null;
  let alive = true, sequence = 0;
  async function render() {
    if (!pdf || !canvas || !alive) return;
    const request = ++sequence;
    rendering?.cancel(); busy = true;
    try {
      const sheet = await pdf.getPage(page);
      if (!alive || request !== sequence) return;
      const base = sheet.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.max(0.25, (host.clientWidth - 24) / base.width));
      const viewport = sheet.getViewport({ scale });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(viewport.width * ratio); canvas.height = Math.round(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      rendering = sheet.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await rendering.promise;
    } catch (cause) { if (alive && request === sequence && (cause as Error).name !== 'RenderingCancelledException') error = m['knowledge.parse_error'](); }
    finally { if (alive && request === sequence) busy = false; }
  }
  onMount(() => {
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => void render(), 150); }); observer.observe(host);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist'); if (!alive) return;
        pdfjs.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;
        task = pdfjs.getDocument({ url, useWorkerFetch: false });
        pdf = await task.promise; if (!alive) return;
        pages = pdf.numPages; await render();
      } catch { if (alive) { error = m['knowledge.parse_error'](); busy = false; } }
    })();
    return () => { alive = false; sequence++; clearTimeout(timer); observer.disconnect(); rendering?.cancel(); void task?.destroy(); };
  });
</script>
<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-center gap-3 border-b border-[var(--app-border)] p-2">
    <Button variant="outline" size="icon" disabled={busy || page <= 1} aria-label={m['knowledge.previous_page']()} onclick={() => { page--; void render(); }}><ChevronLeft size={16} /></Button>
    <span class="text-xs">{page} / {pages}</span>
    <Button variant="outline" size="icon" disabled={busy || page >= pages} aria-label={m['knowledge.next_page']()} onclick={() => { page++; void render(); }}><ChevronRight size={16} /></Button>
    <Button variant="outline" size="icon" href={url} download aria-label={m['knowledge.download']()}><Download size={16} /></Button>
  </div>
  <div bind:this={host} class="min-h-0 flex-1 overflow-auto bg-[var(--app-surface-subtle)] p-2">
    {#if error}<p role="alert" class="p-2 text-sm text-[var(--app-danger)]">{error}</p>{/if}
    <canvas bind:this={canvas} class="mx-auto block" aria-label={m['knowledge.file']()}></canvas>
  </div>
</div>
