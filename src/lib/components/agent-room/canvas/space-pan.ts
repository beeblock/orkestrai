import { eventTargetElement } from '../event-target.js';

type SpacePanOptions = {
  enabled: boolean;
  onChange: (active: boolean) => void;
};

const interactive = 'input, textarea, select, button, a, [role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"]), .xterm, .monaco-editor, .cm-editor, [role="dialog"], [role="menu"], .svelte-flow__panel';

/** Reserve plain Space for navigation only when the Canvas owns keyboard input. */
export function spacePan(element: HTMLElement, initial: SpacePanOptions) {
  let options = initial;
  let active = false;
  let pointerDown = false;

  function setActive(value: boolean) {
    if (active === value) return;
    active = value;
    options.onChange(value);
  }

  function reset() {
    pointerDown = false;
    setActive(false);
  }

  function ownsKeyboard(target: EventTarget | null) {
    const origin = eventTargetElement(target);
    if (!origin || origin.closest(interactive)) return false;
    if (origin !== document.body && origin !== document.documentElement && !element.contains(origin)) return false;
    return !document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]');
  }

  function keydown(event: KeyboardEvent) {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (!active && (!options.enabled || pointerDown || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !ownsKeyboard(event.target))) return;
    event.preventDefault();
    // Do not also select the focused node or activate XYFlow's separate key state.
    event.stopPropagation();
    setActive(true);
  }

  function keyup(event: KeyboardEvent) {
    if (event.code === 'Space' || event.key === ' ') setActive(false);
  }

  function focusin(event: FocusEvent) {
    if (active && !ownsKeyboard(event.target)) setActive(false);
  }

  function visibilitychange() {
    if (document.hidden) reset();
  }

  function pointerStart() { pointerDown = true; }
  function pointerEnd() { pointerDown = false; }

  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', reset);
  window.addEventListener('pointerdown', pointerStart, true);
  window.addEventListener('pointerup', pointerEnd, true);
  window.addEventListener('pointercancel', pointerEnd, true);
  document.addEventListener('focusin', focusin);
  document.addEventListener('visibilitychange', visibilitychange);

  return {
    update(next: SpacePanOptions) {
      options = next;
      if (!options.enabled) reset();
    },
    destroy() {
      reset();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pointerdown', pointerStart, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('visibilitychange', visibilitychange);
    },
  };
}
