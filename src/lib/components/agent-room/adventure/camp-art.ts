// Illustrations of the camp (the header banner, the world map, the cube,
// ornaments), shipped as fingerprinted assets like the sprite sheets.
const ART = import.meta.glob('$lib/assets/adventure/art/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(ART).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.webp$/, ''), url]));

export type CampArt = 'camp-banner' | 'world-map' | 'cube' | 'corner' | 'pedestal' | 'divider';

/** The URL of a camp illustration, or null while it does not exist. */
export function campArt(name: CampArt): string | null {
  return BY_NAME[name] ?? null;
}
