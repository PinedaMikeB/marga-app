function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectDevice() {
  const userAgent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iphone';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

function buildStepMarkup(steps) {
  return steps
    .map(
      (step, index) => `
        <article class="marga-install-step">
          <span class="marga-install-step-num">${index + 1}</span>
          <div>
            <h3>${step.title}</h3>
            <p>${step.body}</p>
          </div>
        </article>
      `
    )
    .join('');
}

export function setupInstallGuide({ appName, tagline, appIcon, storagePrefix, installHelpUrl } = {}) {
  const welcomeKey = `${storagePrefix}:install-welcome-shown`;
  const device = detectDevice();

  const steps = {
    android: [
      { title: 'Keep this page in Chrome', body: 'If you arrived from the install landing page, Chrome is the correct browser for Android.' },
      { title: 'Open the browser menu', body: 'Tap the three-dot menu if Chrome does not show an install prompt right away.' },
      { title: 'Choose Install app or Add to Home screen', body: 'The label depends on the Android version and Chrome build.' },
      { title: 'Confirm and launch', body: `Tap Install, then open ${appName} from your home screen.` }
    ],
    iphone: [
      { title: 'Make sure this page is in Safari', body: 'iPhone and iPad installation only works from Safari, not from Messenger or other in-app browsers.' },
      { title: 'Tap Share', body: 'Use the Safari share icon at the bottom or top of the screen.' },
      { title: 'Tap Add to Home Screen', body: 'Scroll the share sheet if you do not see it immediately.' },
      { title: 'Tap Add and launch', body: `After adding it, open ${appName} from your home screen.` }
    ],
    desktop: [
      { title: 'Open this link on mobile', body: 'The smoothest install path for this project is on iPhone Safari or Android Chrome.' },
      { title: 'Use the install landing page', body: 'Send the install link to your phone if you started on desktop.' }
    ]
  };

  function ensureStyles() {
    if (document.getElementById('margaInstallGuideStyles')) return;

    const style = document.createElement('style');
    style.id = 'margaInstallGuideStyles';
    style.textContent = `
      #margaInstallGuide,
      #margaInstallWelcome {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: grid;
        place-items: center;
        padding: 16px;
      }

      .marga-install-overlay {
        position: absolute;
        inset: 0;
        background: rgba(8, 24, 41, 0.76);
      }

      .marga-install-panel {
        position: relative;
        z-index: 1;
        width: min(100%, 440px);
        max-height: min(90vh, 760px);
        overflow: auto;
        border-radius: 28px;
        padding: 24px 20px;
        color: #17324f;
        background:
          radial-gradient(circle at top, rgba(244, 195, 91, 0.16), transparent 24%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(232, 244, 252, 0.96));
        border: 1px solid rgba(18, 59, 103, 0.14);
        box-shadow: 0 30px 70px rgba(9, 26, 43, 0.34);
      }

      .marga-install-logo {
        width: 84px;
        height: 84px;
        margin: 0 auto 14px;
        padding: 12px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 32px rgba(18, 59, 103, 0.12);
      }

      .marga-install-logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .marga-install-kicker {
        margin: 0;
        text-align: center;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #b7790d;
      }

      .marga-install-panel h2,
      .marga-install-panel h3 {
        margin: 0;
      }

      .marga-install-panel h2 {
        margin-top: 10px;
        text-align: center;
        font-size: 2rem;
        line-height: 1.08;
      }

      .marga-install-subtitle {
        margin: 12px 0 18px;
        text-align: center;
        line-height: 1.6;
        color: #4f6985;
      }

      .marga-install-steps {
        display: grid;
        gap: 12px;
      }

      .marga-install-step {
        display: grid;
        grid-template-columns: 38px 1fr;
        gap: 12px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid rgba(18, 59, 103, 0.1);
      }

      .marga-install-step-num {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        font-weight: 800;
        color: #0f1b2b;
        background: linear-gradient(135deg, #f4c35b, #de9b20);
      }

      .marga-install-step h3 {
        font-size: 0.98rem;
      }

      .marga-install-step p {
        margin: 6px 0 0;
        line-height: 1.55;
        color: #4f6985;
      }

      .marga-install-note {
        margin-top: 14px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(18, 59, 103, 0.08);
        color: #214667;
        line-height: 1.55;
      }

      .marga-install-actions {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }

      .marga-install-action,
      .marga-install-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 50px;
        border-radius: 999px;
        font: inherit;
        font-weight: 800;
        text-decoration: none;
      }

      .marga-install-action {
        border: 0;
        color: #0f1b2b;
        background: linear-gradient(135deg, #f4c35b, #de9b20);
        box-shadow: 0 14px 30px rgba(222, 155, 32, 0.22);
      }

      .marga-install-link {
        border: 1px solid rgba(18, 59, 103, 0.16);
        color: #123b67;
        background: rgba(255, 255, 255, 0.84);
      }
    `;
    document.head.appendChild(style);
  }

  function closeModal(id) {
    document.getElementById(id)?.remove();
    document.body.style.overflow = '';
  }

  function showWelcome() {
    ensureStyles();

    const modal = document.createElement('div');
    modal.id = 'margaInstallWelcome';
    modal.innerHTML = `
      <div class="marga-install-overlay"></div>
      <section class="marga-install-panel" role="dialog" aria-modal="true" aria-label="${appName} installed">
        <div class="marga-install-logo"><img src="${appIcon}" alt="${appName} icon" /></div>
        <p class="marga-install-kicker">${appName} is installed</p>
        <h2>Open it from your home screen any time.</h2>
        <p class="marga-install-subtitle">${tagline}</p>
        <div class="marga-install-note">
          Installation is complete. Look for the ${appName} icon on your home screen the next time you need to launch it.
        </div>
        <div class="marga-install-actions">
          <button type="button" class="marga-install-action" id="margaInstallWelcomeClose">Continue</button>
        </div>
      </section>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const close = () => {
      localStorage.setItem(welcomeKey, 'true');
      closeModal('margaInstallWelcome');
    };

    modal.querySelector('.marga-install-overlay')?.addEventListener('click', close);
    document.getElementById('margaInstallWelcomeClose')?.addEventListener('click', close);
  }

  function showGuide() {
    ensureStyles();

    const modal = document.createElement('div');
    modal.id = 'margaInstallGuide';
    modal.innerHTML = `
      <div class="marga-install-overlay"></div>
      <section class="marga-install-panel" role="dialog" aria-modal="true" aria-label="Install ${appName}">
        <div class="marga-install-logo"><img src="${appIcon}" alt="${appName} icon" /></div>
        <p class="marga-install-kicker">Install ${appName}</p>
        <h2>Save Marga to your home screen.</h2>
        <p class="marga-install-subtitle">${tagline}</p>
        <div class="marga-install-steps">${buildStepMarkup(steps[device])}</div>
        <div class="marga-install-note">
          ${device === 'iphone'
            ? 'Safari is required on iPhone and iPad. If you are still inside Messenger or another in-app browser, use the install landing page first.'
            : device === 'android'
              ? 'Chrome gives the cleanest install flow on Android. If you are not in Chrome yet, use the install landing page first.'
              : 'Send the install landing link to your phone if you need the full mobile install flow.'}
        </div>
        <div class="marga-install-actions">
          <a class="marga-install-link" href="${installHelpUrl}">Open install landing page</a>
          <button type="button" class="marga-install-action" id="margaInstallGuideClose">Close</button>
        </div>
      </section>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const close = () => closeModal('margaInstallGuide');
    modal.querySelector('.marga-install-overlay')?.addEventListener('click', close);
    document.getElementById('margaInstallGuideClose')?.addEventListener('click', close);
  }

  function init() {
    if (isStandaloneMode()) {
      if (!localStorage.getItem(welcomeKey)) {
        window.setTimeout(showWelcome, 360);
      }
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const forceInstall = params.get('install') === 'true' || params.has('install');
    if (!forceInstall) return;

    window.setTimeout(showGuide, 360);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('install');
    window.history.replaceState({}, '', cleanUrl.toString());
  }

  init();
}
