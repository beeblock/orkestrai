/** Retain explicit anchor selection at a clamped scroll position, not forever. */
export function createSettingsSectionSelection() {
  let preferred: { id: string; target: number; previous: number } | null = null;

  return {
    select(id: string, target: number, scrollTop: number) {
      preferred = { id, target, previous: scrollTop };
      return id;
    },
    update(scrollTop: number, observed: string) {
      if (preferred) {
        // Native anchor navigation may scroll asynchronously or smoothly. Keep
        // the click while approaching its destination, including a clamped one.
        // Scrolling away hands selection back to scrollspy immediately.
        const previousDistance = Math.abs(preferred.previous - preferred.target);
        const distance = Math.abs(scrollTop - preferred.target);
        if (scrollTop !== preferred.previous && distance > 1 && distance > previousDistance) preferred = null;
        else preferred.previous = scrollTop;
      }
      return preferred?.id ?? observed;
    },
    reset() {
      preferred = null;
    },
  };
}
