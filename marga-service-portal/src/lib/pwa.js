export function setupPwa({ installButton, onConnectivityChange } = {}) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }

  let deferredPrompt;
  const installBtn = installButton;
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.classList.remove('hidden');
  });

  const emit = () => {
    if (typeof onConnectivityChange === 'function') onConnectivityChange(navigator.onLine);
  };
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  emit();
}
