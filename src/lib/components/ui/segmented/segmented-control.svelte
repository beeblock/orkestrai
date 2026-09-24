<script lang="ts" module>
	import type { Component } from "svelte";

	export type SegmentedOption<V extends string = string> = {
		value: V;
		label: string;
		// Aceita icones do @lucide/svelte (e qualquer componente com size/class).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: Component<any>;
		/** Contagem opcional exibida em mono ao lado do rotulo. */
		count?: number;
		disabled?: boolean;
	};
</script>

<script lang="ts" generics="T extends string">
	import { cn } from "$lib/utils.js";

	type Props = {
		options: SegmentedOption<T>[];
		value: T;
		onValueChange?: (value: T) => void;
		label: string;
		size?: "sm" | "md";
		/** Ocupa toda a largura, com segmentos de largura igual. */
		fill?: boolean;
		/** Esconde o rotulo visual (fica so no aria-label do segmento). */
		iconOnly?: boolean;
		class?: string;
	};

	let {
		options,
		value = $bindable(),
		onValueChange,
		label,
		size = "md",
		fill = false,
		iconOnly = false,
		class: className,
	}: Props = $props();

	let track = $state<HTMLDivElement | null>(null);
	let pill = $state<HTMLSpanElement | null>(null);
	let ready = $state(false);

	// Pilula deslizante: o JS mede o segmento ativo e escreve posicao/largura;
	// o CSS faz a interpolacao. Na primeira pintura e em resize a pilula
	// "salta" sem transicao para nao animar a partir de zero.
	function place(animate: boolean) {
		if (!track || !pill) return;
		const active = track.querySelector<HTMLElement>('[data-segment][aria-checked="true"]');
		if (!active) {
			pill.style.opacity = "0";
			return;
		}
		const apply = () => {
			pill!.style.opacity = "1";
			pill!.style.transform = `translateX(${active.offsetLeft}px)`;
			pill!.style.width = `${active.offsetWidth}px`;
		};
		if (animate && ready) {
			apply();
			return;
		}
		const previous = pill.style.transition;
		pill.style.transition = "none";
		apply();
		void pill.offsetWidth;
		pill.style.transition = previous;
		ready = true;
	}

	$effect(() => {
		void value;
		void options.length;
		requestAnimationFrame(() => place(true));
	});

	$effect(() => {
		if (!track) return;
		const observer = new ResizeObserver(() => place(false));
		observer.observe(track);
		return () => observer.disconnect();
	});

	function select(next: T) {
		if (next === value) return;
		value = next;
		onValueChange?.(next);
	}

	function onKeydown(event: KeyboardEvent) {
		const enabled = options.filter((option) => !option.disabled);
		// Tudo desabilitado (ex.: durante uma sessao): as setas nao tem para onde ir.
		if (!enabled.length) return;
		const index = enabled.findIndex((option) => option.value === value);
		let next = -1;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % enabled.length;
		if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + enabled.length) % enabled.length;
		if (event.key === "Home") next = 0;
		if (event.key === "End") next = enabled.length - 1;
		if (next < 0) return;
		event.preventDefault();
		select(enabled[next].value);
		requestAnimationFrame(() => track?.querySelector<HTMLElement>('[data-segment][aria-checked="true"]')?.focus());
	}
</script>

<div
	bind:this={track}
	role="radiogroup"
	aria-label={label}
	tabindex="-1"
	data-slot="segmented-control"
	data-size={size}
	class={cn("segmented", fill && "fill", className)}
	onkeydown={onKeydown}
>
	<span bind:this={pill} class="segmented-pill" aria-hidden="true"></span>
	{#each options as option (option.value)}
		{@const selected = option.value === value}
		<button
			type="button"
			role="radio"
			data-segment
			aria-checked={selected}
			aria-label={iconOnly ? option.label : undefined}
			tabindex={selected ? 0 : -1}
			disabled={option.disabled}
			class="segment"
			onclick={() => select(option.value)}
		>
			{#if option.icon}
				<option.icon size={size === "sm" ? 13 : 14} class="segment-icon" />
			{/if}
			{#if !iconOnly}<span class="segment-label">{option.label}</span>{/if}
			{#if option.count !== undefined}<span class="segment-count">{option.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	/* Trilho 8px com 2px de respiro -> segmentos e pilula 6px (concentrico). */
	.segmented {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: 8px;
		background: var(--app-hover);
		isolation: isolate;
	}

	.segmented.fill {
		display: flex;
		width: 100%;
	}

	.segmented.fill .segment {
		flex: 1;
	}

	.segmented-pill {
		position: absolute;
		top: 2px;
		bottom: 2px;
		left: 0;
		width: 0;
		z-index: -1;
		border-radius: 6px;
		background: var(--app-surface-raised);
		box-shadow: var(--app-shadow-border);
		opacity: 0;
		transition:
			transform var(--duration-fast) var(--ease-smooth-out),
			width var(--duration-fast) var(--ease-smooth-out);
		pointer-events: none;
	}

	.segment {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		height: 28px;
		padding: 0 10px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--app-text-muted);
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition: color var(--duration-quick) ease-out;
	}

	.segmented[data-size="sm"] .segment {
		height: 24px;
		padding: 0 8px;
		font-size: 11.5px;
	}

	.segment:hover:not(:disabled),
	.segment[aria-checked="true"] {
		color: var(--app-text);
	}

	.segment:focus-visible {
		outline: 2px solid var(--app-accent);
		outline-offset: 1px;
	}

	.segment:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.segment[aria-checked="true"] :global(.segment-icon) {
		color: var(--app-accent);
	}

	.segment-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.segment-count {
		min-width: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--app-hover);
		color: var(--app-text-muted);
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 16px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		.segmented-pill {
			transition: none;
		}
	}
</style>
