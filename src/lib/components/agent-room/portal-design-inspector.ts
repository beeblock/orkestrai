import {
  PORTAL_DESIGN_LIMITS,
  portalDesignCaptureSchema,
  type PortalDesignCapture,
} from '$lib/modules/agent-room/contracts/schemas/portal-design-feedback.schema.js';

export type PortalWebviewElement = HTMLElement & {
  getWebContentsId: () => number;
  src: string;
  loadURL: (url: string) => Promise<void>;
  executeJavaScript: (code: string) => Promise<unknown>;
  capturePage: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{
    isEmpty?: () => boolean;
    toDataURL: () => string;
  }>;
};

const MAX_SCREENSHOT_DATA_URL = 10 * 1024 * 1024 * 1.38;

export function portalInspectorSource(): string {
  return String.raw`(() => {
    const KEY = '__orkestraiPortalInspector';
    if (window[KEY] && typeof window[KEY].cancel === 'function') window[KEY].cancel();

    return new Promise((resolve) => {
      let current = null;
      let settled = false;
      let raf = 0;
      const allowedAttributes = new Set([
        'id', 'class', 'role', 'aria-label', 'aria-describedby', 'aria-labelledby',
        'data-testid', 'data-test', 'name', 'type', 'placeholder', 'title', 'alt', 'href', 'src'
      ]);
      const sensitiveName = /token|secret|password|passwd|authorization|cookie|session|credential|api[-_]?key/i;
      const tokenPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
      const namedSecretPattern = /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|password|secret|session(?:id)?)\b\s*[:=]\s*[^\s,;]+/gi;
      const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi;

      const redact = (value, limit) => String(value || '')
        .replace(tokenPattern, '[redacted token]')
        .replace(bearerPattern, '$1[redacted]')
        .replace(namedSecretPattern, '$1=[redacted]')
        .slice(0, limit);
      const escapeSelector = (value) => window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape(value)
        : String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&');
      const safeResourceUrl = (value) => {
        try {
          const url = new URL(value, location.href);
          return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname : '';
        } catch {
          return '';
        }
      };
      const selectorFor = (element) => {
        if (element.id && !sensitiveName.test(element.id)) return '#' + escapeSelector(element.id);
        for (const attribute of ['data-testid', 'data-test', 'aria-label']) {
          const value = element.getAttribute(attribute);
          if (value && !sensitiveName.test(value)) {
            return element.tagName.toLowerCase() + '[' + attribute + '="' + String(value).replace(/["\\]/g, '\\$&').slice(0, 160) + '"]';
          }
        }
        const parts = [];
        let node = element;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
          let part = node.tagName.toLowerCase();
          const safeClasses = Array.from(node.classList || []).filter((name) => name && !sensitiveName.test(name)).slice(0, 2);
          if (safeClasses.length) part += '.' + safeClasses.map(escapeSelector).join('.');
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = parent;
        }
        return parts.join(' > ').slice(0, ${PORTAL_DESIGN_LIMITS.selector});
      };
      const safeHtml = (element) => {
        const clone = element.cloneNode(true);
        for (const blocked of clone.querySelectorAll('script,style,iframe,object,embed,template,noscript')) blocked.remove();
        for (const node of [clone, ...clone.querySelectorAll('*')]) {
          for (const attribute of Array.from(node.attributes || [])) {
            const name = attribute.name.toLowerCase();
            if (!allowedAttributes.has(name) || sensitiveName.test(name)) {
              node.removeAttribute(attribute.name);
              continue;
            }
            if (name === 'href' || name === 'src') {
              const safe = safeResourceUrl(attribute.value);
              if (safe) node.setAttribute(name, safe);
              else node.removeAttribute(name);
              continue;
            }
            node.setAttribute(name, redact(attribute.value, 300));
          }
          if ('value' in node) node.removeAttribute('value');
          if ('checked' in node) node.removeAttribute('checked');
          if ('selected' in node) node.removeAttribute('selected');
        }
        return redact(clone.outerHTML || '', ${PORTAL_DESIGN_LIMITS.html});
      };

      const overlay = document.createElement('div');
      overlay.setAttribute('data-orkestrai-inspector', 'overlay');
      Object.assign(overlay.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483646', border: '2px solid #7c3aed',
        background: 'rgba(124,58,237,.10)', borderRadius: '3px', boxSizing: 'border-box', display: 'none'
      });
      const badge = document.createElement('div');
      badge.setAttribute('data-orkestrai-inspector', 'badge');
      Object.assign(badge.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', maxWidth: 'min(420px,90vw)',
        padding: '4px 7px', borderRadius: '4px', color: '#fff', background: '#5b21b6',
        font: '600 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', display: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.24)'
      });
      document.documentElement.append(overlay, badge);

      const cleanup = () => {
        cancelAnimationFrame(raf);
        document.removeEventListener('pointerover', onPointerOver, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('scroll', scheduleHighlight, true);
        window.removeEventListener('resize', scheduleHighlight, true);
        overlay.remove();
        badge.remove();
        delete window[KEY];
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const highlight = () => {
        raf = 0;
        if (!current || !current.isConnected) {
          overlay.style.display = 'none';
          badge.style.display = 'none';
          return;
        }
        const rect = current.getBoundingClientRect();
        Object.assign(overlay.style, {
          display: 'block', left: rect.left + 'px', top: rect.top + 'px',
          width: Math.max(0, rect.width) + 'px', height: Math.max(0, rect.height) + 'px'
        });
        badge.textContent = selectorFor(current) + '  ' + Math.round(rect.width) + '×' + Math.round(rect.height);
        badge.style.display = 'block';
        badge.style.left = Math.max(4, Math.min(rect.left, innerWidth - 424)) + 'px';
        badge.style.top = Math.max(4, rect.top > 30 ? rect.top - 27 : rect.bottom + 5) + 'px';
      };
      const scheduleHighlight = () => {
        if (!raf) raf = requestAnimationFrame(highlight);
      };
      const onPointerOver = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest('[data-orkestrai-inspector]')) return;
        current = target;
        scheduleHighlight();
      };
      const onClick = (event) => {
        const target = event.target instanceof Element ? event.target : current;
        if (!target || target.closest('[data-orkestrai-inspector]')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const rect = target.getBoundingClientRect();
        const styles = getComputedStyle(target);
        const payload = {
          selector: selectorFor(target),
          tagName: target.tagName.toLowerCase(),
          html: safeHtml(target),
          text: redact(target.innerText || target.textContent || '', ${PORTAL_DESIGN_LIMITS.text}),
          role: redact(target.getAttribute('role') || '', 120) || null,
          ariaLabel: redact(target.getAttribute('aria-label') || '', 300) || null,
          rect: {
            x: Math.max(0, rect.x), y: Math.max(0, rect.y),
            width: Math.max(0, rect.width), height: Math.max(0, rect.height)
          },
          viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio || 1 },
          page: { origin: location.origin, path: location.pathname || '/', title: redact(document.title, 240) },
          styles: {
            display: styles.display, position: styles.position, color: styles.color,
            backgroundColor: styles.backgroundColor, fontFamily: styles.fontFamily,
            fontSize: styles.fontSize, fontWeight: styles.fontWeight, lineHeight: styles.lineHeight,
            textAlign: styles.textAlign, border: styles.border, borderRadius: styles.borderRadius,
            padding: styles.padding, margin: styles.margin, width: styles.width, height: styles.height
          }
        };
        finish(payload);
      };
      const onKeydown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish({ cancelled: true });
      };

      document.addEventListener('pointerover', onPointerOver, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeydown, true);
      window.addEventListener('scroll', scheduleHighlight, true);
      window.addEventListener('resize', scheduleHighlight, true);
      window[KEY] = { cancel: () => finish({ cancelled: true }) };
    });
  })()`;
}

export async function beginPortalInspection(webview: PortalWebviewElement): Promise<PortalDesignCapture | null> {
  const result = await webview.executeJavaScript(portalInspectorSource());
  if ((result as { cancelled?: boolean } | null)?.cancelled) return null;
  return portalDesignCaptureSchema.parse(result);
}

export async function cancelPortalInspection(webview: PortalWebviewElement): Promise<void> {
  await webview.executeJavaScript("window.__orkestraiPortalInspector?.cancel?.()").catch(() => undefined);
}

export async function portalSelectionExists(webview: PortalWebviewElement, selector: string): Promise<boolean> {
  return Boolean(await webview.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));
}

export async function capturePortalSelection(webview: PortalWebviewElement, capture: PortalDesignCapture): Promise<string> {
  const padding = 8;
  const x = Math.max(0, Math.floor(capture.rect.x - padding));
  const y = Math.max(0, Math.floor(capture.rect.y - padding));
  const right = Math.min(capture.viewport.width, Math.ceil(capture.rect.x + capture.rect.width + padding));
  const bottom = Math.min(capture.viewport.height, Math.ceil(capture.rect.y + capture.rect.height + padding));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const image = await webview.capturePage({ x, y, width, height });
  if (image.isEmpty?.()) throw new Error('empty_screenshot');
  const dataUrl = image.toDataURL();
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_SCREENSHOT_DATA_URL) {
    throw new Error('invalid_screenshot');
  }
  return dataUrl;
}

export function portalScreenshotFile(dataUrl: string, name = `portal-selection-${Date.now()}.png`): File {
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return new File([bytes], name, { type: 'image/png' });
}
