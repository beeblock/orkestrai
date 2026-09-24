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
  // Tres larguras de rotulo: simbolo (X, %), abreviacao (Tam.) e palavra
  // inteira (Desfoque) - o valor nunca fica escondido atras do rotulo.
  const labelLength = $derived([...label].length);
  const compact = $derived(labelLength <= 2);
  const wide = $derived(labelLength > 6);

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
      // Blur commits once; committing here too races the asynchronous document save.
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
    class={`absolute inset-y-0 left-0 z-10 flex cursor-ew-resize select-none items-center overflow-hidden pl-2 text-ui-xs font-medium whitespace-nowrap text-[var(--app-text-muted)] transition-colors duration-150 hover:text-[var(--app-text)] disabled:cursor-default disabled:hover:text-[var(--app-text-muted)] ${compact ? 'w-6' : wide ? 'w-16' : 'w-11'}`}
    aria-label={label}
    title={compact ? undefined : label}
    {disabled}
    onpointerdown={startScrub}
  ><span class="truncate">{label}</span></button>
  <Input
    class={`h-7 pr-1.5 text-ui-md tabular-nums md:text-ui-md ${compact ? 'pl-6' : wide ? 'pl-16' : 'pl-11'}`}
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
