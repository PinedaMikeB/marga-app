let firebaseContextPromise;

function hasFirebaseConfig(config) {
  const fb = config?.firebase || {};
  return Boolean(fb.apiKey && fb.projectId && fb.authDomain && fb.appId);
}

export function readRuntimeConfig() {
  const cfg = window.MSP_CONFIG || {};
  if (!cfg.firebase) cfg.firebase = {};
  return cfg;
}

export function isDemoMode(config = readRuntimeConfig()) {
  if (config.demoMode === true) return true;
  return !hasFirebaseConfig(config);
}

export async function getFirebaseContext(config = readRuntimeConfig()) {
  return null;
}
