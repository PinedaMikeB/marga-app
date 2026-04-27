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
  if (isDemoMode(config)) return null;
  if (firebaseContextPromise) return firebaseContextPromise;

  firebaseContextPromise = (async () => {
    const [{ initializeApp }, authPkg, fsPkg, storagePkg] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js')
    ]);

    const app = initializeApp(config.firebase);
    const auth = authPkg.getAuth(app);
    const db = fsPkg.getFirestore(app);
    const storage = storagePkg.getStorage(app);

    return {
      app,
      auth,
      db,
      storage,
      authPkg,
      fsPkg,
      storagePkg
    };
  })();

  return firebaseContextPromise;
}
