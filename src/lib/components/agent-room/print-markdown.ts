import { marked } from 'marked';
import DOMPurify from 'dompurify';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}

/**
 * Prints a note as a paginated document through the system print dialog
 * (where "Save as PDF" lives). The markdown is sanitized before it reaches
 * the hidden frame, which has no scripts.
 */
export function printMarkdown(title: string, content: string): void {
  const body = DOMPurify.sanitize(marked.parse(content, { async: false, gfm: true, breaks: true }) as string);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { margin: 18mm 16mm; }
    body { font: 11pt/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1714; }
    h1 { font-size: 22pt; margin: 0 0 12pt; } h2 { font-size: 15pt; margin: 18pt 0 6pt; } h3 { font-size: 12.5pt; margin: 14pt 0 4pt; }
    pre, code { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; background: #f3f0ea; border-radius: 4px; }
    pre { padding: 8pt; white-space: pre-wrap; break-inside: avoid; } code { padding: 0 3px; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #dcd6cc; padding: 4pt 6pt; text-align: left; }
    img { max-width: 100%; } blockquote { border-left: 3px solid #e8b84a; margin: 8pt 0; padding-left: 10pt; color: #4a443c; }
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
