// Runs in an isolated world: page scripts cannot replace the reference registry.
function portalDomRuntime() {
  const key = '__orkestraiControlledPortal';
  if (globalThis[key]) return;
  let sequence = 0;
  const refs = new Map();
  const sensitive = (el) => el.closest?.('[data-private]') || el.matches?.('input[type="password"],input[type="hidden"],[autocomplete="one-time-code"]')
    || /password|passwd|secret|token|api.?key|credential|one.?time|otp/i.test([
      el.getAttribute?.('name'), el.getAttribute?.('id'), el.getAttribute?.('autocomplete'), el.getAttribute?.('aria-label'),
    ].filter(Boolean).join(' '));
  const privateValues = () => [...document.querySelectorAll('input,textarea,[data-private]')]
    .filter(sensitive).map((el) => String(el.value || el.textContent || '')).filter(Boolean).sort((a, b) => b.length - a.length);
  const redact = (value) => privateValues().reduce((text, secret) => text.split(secret).join('[redacted]'), String(value || ''))
    .replace(/\bBearer\s+[\w.~+/-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]');
  const visible = (el) => {
    const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const label = (el) => sensitive(el) ? 'Protected field' : redact(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value).trim().replace(/\s+/g, ' ').slice(0, 500);
  const fingerprint = (el) => JSON.stringify([el.tagName, el.getAttribute('type'), label(el), el.getAttribute('href'), el.getAttribute('formaction')]);
  const resolve = (ref) => {
    const entry = refs.get(ref);
    if (!entry || !entry.element.isConnected || !visible(entry.element) || entry.fingerprint !== fingerprint(entry.element)) throw new Error('Portal reference is stale. Take another snapshot.');
    return entry.element;
  };
  const safeUrl = (value) => {
    try { const url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : ''; } catch { return ''; }
  };
  const snapshot = () => {
    refs.clear();
    return [...document.querySelectorAll('a,button,input,select,textarea,summary,[role],[contenteditable="true"],[tabindex]')]
      .filter(visible).slice(0, 5000).map((el) => {
        if (++sequence > 999999) throw new Error('Portal reference limit reached; reload the page.');
        const ref = 'e' + sequence;
        refs.set(ref, { element: el, fingerprint: fingerprint(el) });
        const rect = el.getBoundingClientRect();
        return { ref, role: el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] || 'generic'),
          name: label(el), tag: el.tagName.toLowerCase(), protected: Boolean(sensitive(el)), disabled: !!el.disabled,
          value: sensitive(el) ? '[redacted]' : redact(el.value).slice(0, 1000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      });
  };
  const inspect = (ref) => {
    const el = resolve(ref);
    return { name: label(el), protected: Boolean(sensitive(el)), tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), href: safeUrl(el.getAttribute('href') || location.href), form: Boolean(el.form), editable: el.matches('input,textarea,[contenteditable="true"]') };
  };
  const act = (ref, action, args) => {
    const el = resolve(ref);
    if (sensitive(el)) throw new Error('Protected fields require the user to authenticate in the Portal.');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('Portal element is disabled.');
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (action === 'click') el.click();
    else if (action === 'type') {
      el.focus();
      if (el.matches('input,textarea')) {
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set;
        setter.call(el, (args.clear === false ? el.value : '') + args.text);
      } else if (el.isContentEditable) el.textContent = (args.clear === false ? el.textContent : '') + args.text;
      else throw new Error('The selected element is not editable.');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: args.text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (action === 'select') {
      if (el.tagName !== 'SELECT') throw new Error('The selected element is not a select.');
      for (const option of el.options) option.selected = args.values.includes(option.value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { performed: action };
  };
  const safeDom = () => {
    const clone = document.documentElement.cloneNode(true);
    for (const el of clone.querySelectorAll('script,style,template,noscript,iframe,object,embed,input[type="hidden"],[data-private]')) el.remove();
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      if (sensitive(el)) { el.textContent = ''; el.setAttribute('aria-label', 'Protected field'); }
      for (const attr of [...el.attributes]) {
        if (!['role', 'aria-label', 'title', 'alt', 'type', 'href', 'src'].includes(attr.name)) el.removeAttribute(attr.name);
        else el.setAttribute(attr.name, ['href', 'src'].includes(attr.name) ? safeUrl(attr.value) : redact(attr.value));
      }
    }
    return redact(clone.outerHTML).slice(0, 500000);
  };
  const extract = (args) => {
    const root = args.ref ? resolve(args.ref) : document;
    if (args.ref && sensitive(root)) throw new Error('Protected fields cannot be extracted.');
    if (args.kind === 'attribute') {
      if (!['role', 'aria-label', 'title', 'alt', 'href', 'src', 'type'].includes(args.attribute)) throw new Error('This attribute cannot be extracted.');
      const value = root.getAttribute?.(args.attribute);
      return ['href', 'src'].includes(args.attribute) ? safeUrl(value) : redact(value);
    }
    if (args.kind === 'links') return [...root.querySelectorAll('a[href]')].slice(0, 2000).map((a) => ({ text: label(a), href: safeUrl(a.href) }));
    if (args.kind === 'table') return [...root.querySelectorAll('tr')].slice(0, 5000).map((row) => [...row.querySelectorAll('th,td')].map((cell) => redact(cell.innerText).slice(0, 2000)));
    return redact(root.innerText || root.body?.innerText || '').slice(0, 500000);
  };
  let masks = [];
  const mask = (enabled) => {
    for (const el of masks) el.remove(); masks = [];
    if (!enabled) return;
    // Cross-origin frames cannot be inspected safely; mask their whole surface.
    for (const el of [...document.querySelectorAll('input,textarea,[data-private],iframe,object,embed')].filter(el => sensitive(el) || el.matches('iframe,object,embed'))) {
      const rect = el.getBoundingClientRect(); const cover = document.createElement('div');
      Object.assign(cover.style, { position: 'fixed', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', background: '#444', zIndex: '2147483647', pointerEvents: 'none' });
      document.documentElement.appendChild(cover); masks.push(cover);
    }
  };
  globalThis[key] = { snapshot, inspect, act, safeDom, extract, mask, resolve };
}

const INIT_SCRIPT = `(${portalDomRuntime.toString()})()`;
const SNAPSHOT_SCRIPT = `${INIT_SCRIPT}; globalThis.__orkestraiControlledPortal.snapshot()`;
module.exports = { INIT_SCRIPT, SNAPSHOT_SCRIPT };
