<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";

	let { delayDuration = 80, ...restProps }: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider {delayDuration} {...restProps} />
