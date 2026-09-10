type StartupState = { ready: Promise<void>; release: () => void };

// Node's production launcher and the bundled Svelar hooks load separate copies.
const state = globalThis as typeof globalThis & { __orkestraiDatabaseStartup?: StartupState };

export function holdBackgroundStartup(): () => void {
  if (!state.__orkestraiDatabaseStartup) {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    state.__orkestraiDatabaseStartup = { ready, release };
  }
  return state.__orkestraiDatabaseStartup.release;
}

export async function afterDatabaseReady(start: () => void): Promise<void> {
  await state.__orkestraiDatabaseStartup?.ready;
  start();
}
