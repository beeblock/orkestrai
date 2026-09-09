const BACKGROUND_CORE_ARGUMENT = '--background-core';

function normalizeCorePreferences(input = {}) {
  const runInBackground = input.runInBackground === true || input.runInBackground === 'true';
  return {
    runInBackground,
    launchAtLogin: runInBackground && (input.launchAtLogin === true || input.launchAtLogin === 'true'),
  };
}

function isBackgroundCoreLaunch(argv = []) {
  return argv.includes(BACKGROUND_CORE_ARGUMENT);
}

function shouldKeepCoreRunning({ isQuitting = false, runInBackground = false } = {}) {
  return !isQuitting && runInBackground;
}

module.exports = {
  BACKGROUND_CORE_ARGUMENT,
  isBackgroundCoreLaunch,
  normalizeCorePreferences,
  shouldKeepCoreRunning,
};
