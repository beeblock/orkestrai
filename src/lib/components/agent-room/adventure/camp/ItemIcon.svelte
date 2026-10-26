<script lang="ts">
  import { loadAtlas, type Atlas } from '../atlas.js';

  /** One frame of an icon atlas, scaled to fit a square box. */
  let { atlasId, frame, size = 40, dim = false }: { atlasId: string; frame: number; size?: number; dim?: boolean } = $props();

  let atlas = $state<Atlas | null>(null);

  $effect(() => {
    const id = atlasId;
    void loadAtlas(id).then((loaded) => { if (id === atlasId) atlas = loaded; });
  });

  const sprite = $derived.by(() => {
    const entry = atlas?.frames[frame];
    if (!atlas || !entry) return null;
    const scale = (size * 0.86) / Math.max(entry.w, entry.h);
    return {
      width: entry.w * scale,
      height: entry.h * scale,
      image: atlas.image.src,
      position: `-${entry.x * scale}px -${entry.y * scale}px`,
      background: `${atlas.image.naturalWidth * scale}px ${atlas.image.naturalHeight * scale}px`,
    };
  });
</script>

<span class="icon" class:dim style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  {#if sprite}
    <span
      style:width={`${sprite.width}px`}
      style:height={`${sprite.height}px`}
      style:background-image={`url(${sprite.image})`}
      style:background-position={sprite.position}
      style:background-size={sprite.background}
    ></span>
  {/if}
</span>

<style>
  .icon {
    display: inline-grid;
    place-items: center;
    flex: none;
  }

  .icon > span {
    background-repeat: no-repeat;
  }

  .dim {
    opacity: 0.35;
    filter: grayscale(1);
  }
</style>
