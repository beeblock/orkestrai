<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { resolveDesignNumericInput } from '$lib/modules/agent-room/domain/design-numeric.js';

  let {
    label,
    value,
    min,
    max,
    step = 1,
    percentBase,
    disabled = false,
    allowEmpty = false,
    placeholder = '',
    onCommit,
  }: {
    label: string;
    value: number | null;
    min?: number;
    max?: number;
    step?: number;
    percentBase?: number;
    disabled?: boolean;
    allowEmpty?: boolean;
    placeholder?: string;
    onCommit: (value: number | null) => void;
  } = $props();

  let draft = $state('');
  let focused = $state(false);

  $effect(() => {
    if (!focused) draft = value === null ? '' : String(Math.round(value * 1_000) / 1_000);
  });

  function commit() {
    if (allowEmpty && !draft.trim()) {
      if (value !== null) onCommit(null);
      return;
    }
    try {
      const current = value ?? min ?? 0;
      const next = resolveDesignNumericInput(draft, current, { min, max, percentBase });
      draft = String(next);
      if (next !== value) onCommit(next);
    } catch {
      draft = value === null ? '' : String(Math.round(value * 1_000) / 1_000);
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      draft = value === null ? '' : String(Math.round(value * 1_000) / 1_000);
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const current = value ?? min ?? 0;
    const next = resolveDesignNumericInput(String(current + (event.key === 'ArrowUp' ? 1 : -1) * step * multiplier), current, { min, max, percentBase });
    draft = String(next);
    onCommit(next);
  }

  function startScrub(event: PointerEvent) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const origin = event.clientX;
    const initial = value ?? min ?? 0;
    let next = initial;
    const move = (moveEvent: PointerEvent) => {
      const multiplier = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      next = resolveDesignNumericInput(String(initial + (moveEvent.clientX - origin) * step * multiplier), initial, { min, max, percentBase });
      draft = String(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (next !== value) onCommit(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
</script>

<div class="relative min-w-0">
  <button
    type="button"
    tabindex="-1"
    class="absolute inset-y-0 left-0 z-10 flex w-11 cursor-ew-resize select-none items-center justify-center px-1 text-ui-xs font-medium text-[var(--app-text-muted)]"
    aria-label={label}
    {disabled}
    onpointerdown={startScrub}
  >{label}</button>
  <Input
    class="h-8 pl-11 text-ui-sm tabular-nums"
    value={draft}
    {disabled}
    aria-label={label}
    inputmode="decimal"
    {placeholder}
    oninput={(event: Event) => (draft = (event.currentTarget as HTMLInputElement).value)}
    onfocus={() => (focused = true)}
    onblur={() => { focused = false; commit(); }}
    onkeydown={keydown}
  />
</div>
