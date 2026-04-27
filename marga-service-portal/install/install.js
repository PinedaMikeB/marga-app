const INSTALL_TARGETS = {
  portal: {
    label: 'Customer Portal',
    title: 'MARGA Service Portal',
    tagline: 'Corporate customer access for support, devices, and billing.',
    path: '/',
    installPath: '/?install=true',
    steps: {
      ios: [
        { title: 'Open the Share menu', body: 'Tap the Safari share icon at the bottom or top of the screen.' },
        { title: 'Choose Add to Home Screen', body: 'Scroll the share sheet until you find the Add to Home Screen option.' },
        { title: 'Tap Add', body: 'Confirm from the top-right corner to place Marga on your home screen.' },
        { title: 'Launch Marga', body: 'Open the new MARGA Service Portal icon from your home screen and sign in there.' }
      ],
      android: [
        { title: 'Open the browser menu', body: 'Tap the three-dot Chrome menu if the install bar does not appear automatically.' },
        { title: 'Choose Install app', body: 'Some Android devices show Add to Home screen instead.' },
        { title: 'Confirm installation', body: 'Tap Install or Add when Chrome asks for confirmation.' },
        { title: 'Launch Marga', body: 'Open the new MARGA Service Portal icon from your home screen and sign in there.' }
      ]
    }
  },
  tech: {
    label: 'Tech Mobile',
    title: 'MARGA Tech Mobile',
    tagline: 'Dispatch, completion, and offline sync for field technicians.',
    path: '/tech/',
    installPath: '/tech/?install=true',
    steps: {
      ios: [
        { title: 'Open the Share menu', body: 'Tap the Safari share icon at the bottom or top of the screen.' },
        { title: 'Choose Add to Home Screen', body: 'Scroll the share sheet until you find the Add to Home Screen option.' },
        { title: 'Tap Add', body: 'Confirm from the top-right corner to place Marga Tech on your home screen.' },
        { title: 'Launch Marga Tech', body: 'Open the new MARGA Tech Mobile icon from your home screen and sign in there.' }
      ],
      android: [
        { title: 'Open the browser menu', body: 'Tap the three-dot Chrome menu if the install bar does not appear automatically.' },
        { title: 'Choose Install app', body: 'Some Android devices show Add to Home screen instead.' },
        { title: 'Confirm installation', body: 'Tap Install or Add when Chrome asks for confirmation.' },
        { title: 'Launch Marga Tech', body: 'Open the new MARGA Tech Mobile icon from your home screen and sign in there.' }
      ]
    }
  }
};

const STAGES = ['welcome', 'device', 'ready', 'steps'];
const IN_APP_MARKERS = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line|Twitter|X\b|MicroMessenger|WeChat|Snapchat/i;

const stageMount = document.getElementById('stageMount');
const progressStrip = document.getElementById('progressStrip');
const environmentPill = document.getElementById('environmentPill');
const manualPanel = document.getElementById('manualPanel');
const manualMessage = document.getElementById('manualMessage');
const installerLinkLabel = document.getElementById('installerLinkLabel');
const copyInstallerBtn = document.getElementById('copyInstallerBtn');
const iosManual = document.getElementById('iosManual');
const androidManual = document.getElementById('androidManual');

const userAgent = navigator.userAgent || navigator.vendor || window.opera || '';
const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
const isAndroid = /Android/i.test(userAgent);
const isInAppBrowser = IN_APP_MARKERS.test(userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const params = new URLSearchParams(window.location.search);
let selectedTarget = params.get('target') === 'tech' ? 'tech' : 'portal';
let selectedStage = STAGES.includes(params.get('stage')) ? params.get('stage') : 'welcome';
let selectedOs = ['ios', 'android'].includes(params.get('os')) ? params.get('os') : inferOs();
let manualVisible = false;

function inferOs() {
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return 'android';
}

function installerUrl(target = selectedTarget, stage = selectedStage, os = selectedOs) {
  const url = new URL('/install/', window.location.origin);
  url.searchParams.set('target', target);
  url.searchParams.set('stage', stage);
  url.searchParams.set('os', os);
  return url.toString();
}

function appInstallUrl(target = selectedTarget) {
  return new URL(INSTALL_TARGETS[target].installPath, window.location.origin).toString();
}

function chromeIntentUrl(urlString) {
  const url = new URL(urlString);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
    urlString
  )};end`;
}

function safariUrl(urlString) {
  return `x-safari-${urlString}`;
}

function syncQuery() {
  const next = new URL(window.location.href);
  next.searchParams.set('target', selectedTarget);
  next.searchParams.set('stage', selectedStage);
  next.searchParams.set('os', selectedOs);
  window.history.replaceState({}, '', next.toString());
}

function saveInstallContext() {
  localStorage.setItem('marga_install_target', selectedTarget);
  localStorage.setItem('marga_install_os', selectedOs);
}

function redirectStandaloneLaunch() {
  if (!isStandalone) return;
  const storedTarget = localStorage.getItem('marga_install_target');
  const target = INSTALL_TARGETS[storedTarget] ? storedTarget : selectedTarget;
  window.location.replace(INSTALL_TARGETS[target].path);
}

function environmentLabel() {
  if (isInAppBrowser && isIOS) return 'In-app browser on iPhone';
  if (isInAppBrowser && isAndroid) return 'In-app browser on Android';
  if (!isInAppBrowser && isIOS) return 'Safari-ready on iPhone';
  if (!isInAppBrowser && isAndroid) return 'Chrome-ready on Android';
  return isInAppBrowser ? 'In-app browser detected' : 'Regular browser detected';
}

function renderProgress() {
  progressStrip.innerHTML = STAGES.map((stage, index) => {
    const currentIndex = STAGES.indexOf(selectedStage);
    const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : '';
    const label =
      stage === 'welcome' ? 'Start' :
      stage === 'device' ? 'Device' :
      stage === 'ready' ? 'Read' :
      'Steps';
    return `
      <div class="progress-step ${state}">
        <span>Step ${index + 1}</span>
        <strong>${label}</strong>
      </div>
    `;
  }).join('');
}

function renderWelcomeStage() {
  const target = INSTALL_TARGETS[selectedTarget];
  const cta = isInAppBrowser
    ? isIOS
      ? 'Open Installer in Safari'
      : isAndroid
        ? 'Open Installer in Chrome'
        : 'Open Installer in Browser'
    : 'Start Installation';

  stageMount.innerHTML = `
    <section class="stage-card">
      <p class="card-kicker">Step 1</p>
      <h2 class="stage-title">Send users into a real browser before they install.</h2>
      <p class="subtext">
        This installer should behave like Go Mission: landing page first, then device-specific instructions, then the actual app install.
      </p>

      <div class="target-grid">
        ${Object.entries(INSTALL_TARGETS)
          .map(
            ([key, item]) => `
              <button type="button" class="target-card ${key === selectedTarget ? 'active' : ''}" data-target="${key}">
                <p class="card-kicker">${item.label}</p>
                <strong>${item.title}</strong>
                <p class="target-description">${item.tagline}</p>
              </button>
            `
          )
          .join('')}
      </div>

      <div class="hint-box">
        <p class="subtext">
          Selected app: <strong>${target.title}</strong><br />
          ${isInAppBrowser
            ? 'The button below will attempt a best-effort handoff into Safari or Chrome first.'
            : 'You are already in a full browser, so the installer can continue directly.'}
        </p>
      </div>

      <div class="action-stack" style="margin-top:16px;">
        <button id="primaryActionBtn" class="primary-btn" type="button">${cta}</button>
      </div>
    </section>
  `;
}

function renderDeviceStage() {
  stageMount.innerHTML = `
    <section class="stage-card">
      <button type="button" class="back-link" data-back="welcome">Back</button>
      <p class="card-kicker">Step 2</p>
      <h2 class="stage-title">Choose the phone you are installing on.</h2>
      <p class="subtext">Pick the device so Marga can show the correct install steps.</p>

      <div class="device-grid">
        <button type="button" class="device-card ${selectedOs === 'android' ? 'active' : ''}" data-os="android">
          <p class="card-kicker">Android</p>
          <strong>Install with Chrome</strong>
          <p>Best for Samsung, Pixel, Xiaomi, Oppo, Vivo, and other Android devices.</p>
        </button>
        <button type="button" class="device-card ${selectedOs === 'ios' ? 'active' : ''}" data-os="ios">
          <p class="card-kicker">iPhone / iPad</p>
          <strong>Install with Safari</strong>
          <p>Use Safari before trying Add to Home Screen. In-app browsers are not enough.</p>
        </button>
      </div>
    </section>
  `;
}

function renderReadyStage() {
  stageMount.innerHTML = `
    <section class="stage-card">
      <button type="button" class="back-link" data-back="device">Back</button>
      <p class="card-kicker">Step 3</p>
      <h2 class="stage-title">Read the steps before you start.</h2>
      <p class="subtext">
        Installation usually fails when people tap too fast and miss one menu item. Read the full sequence first, then follow it in order.
      </p>

      <div class="ready-box">
        <h3>Important</h3>
        <p class="ready-tip">
          Scroll through every step first. After that, open the actual ${INSTALL_TARGETS[selectedTarget].title} app page and install it.
        </p>
      </div>

      <div class="action-stack" style="margin-top:16px;">
        <button id="showStepsBtn" class="primary-btn" type="button">I understand, show the steps</button>
      </div>
    </section>
  `;
}

function renderStepsStage() {
  const target = INSTALL_TARGETS[selectedTarget];
  const steps = target.steps[selectedOs];
  const browserName = selectedOs === 'ios' ? 'Safari' : 'Chrome';

  stageMount.innerHTML = `
    <section class="stage-card">
      <button type="button" class="back-link" data-back="ready">Back</button>
      <p class="card-kicker">Step 4</p>
      <h2 class="stage-title">Follow these install steps in ${browserName}.</h2>
      <p class="subtext">
        App selected: <strong>${target.title}</strong><br />
        Device selected: <strong>${selectedOs === 'ios' ? 'iPhone / iPad' : 'Android'}</strong>
      </p>

      <div class="step-stack" style="margin-top:16px;">
        ${steps
          .map(
            (step, index) => `
              <article class="step-card">
                <div class="step-number">${index + 1}</div>
                <div>
                  <h3>${step.title}</h3>
                  <p>${step.body}</p>
                </div>
              </article>
            `
          )
          .join('')}
      </div>

      <div class="final-card">
        <h3>Ready to install</h3>
        <p>
          Open the actual ${target.title} app page in ${browserName}, then follow the steps above and add it to your home screen.
        </p>
      </div>

      <div class="action-stack" style="margin-top:16px;">
        <button id="openAppForInstallBtn" class="primary-btn" type="button">Open ${target.label} for install</button>
        <button id="copyAppInstallBtn" class="secondary-btn" type="button">Copy app install link</button>
      </div>
    </section>
  `;
}

function renderStage() {
  renderProgress();
  environmentPill.textContent = environmentLabel();
  installerLinkLabel.textContent = installerUrl(selectedTarget, 'welcome', selectedOs);

  if (selectedStage === 'welcome') renderWelcomeStage();
  if (selectedStage === 'device') renderDeviceStage();
  if (selectedStage === 'ready') renderReadyStage();
  if (selectedStage === 'steps') renderStepsStage();
}

function revealManual(message) {
  manualVisible = true;
  manualPanel.classList.remove('hidden');
  manualMessage.textContent = message;
  iosManual.classList.toggle('hidden', isAndroid);
  androidManual.classList.toggle('hidden', isIOS);
}

function hideManual() {
  manualVisible = false;
  manualPanel.classList.add('hidden');
}

function goToStage(stage) {
  selectedStage = stage;
  saveInstallContext();
  syncQuery();
  if (!isInAppBrowser) hideManual();
  renderStage();
}

function attemptBrowserHandoff() {
  saveInstallContext();
  const nextInstallerUrl = installerUrl(selectedTarget, 'device', selectedOs);

  if (!isInAppBrowser) {
    hideManual();
    goToStage('device');
    return;
  }

  revealManual('If automatic handoff fails, open this same installer link in Safari or Chrome manually, then continue.');

  if (isAndroid) {
    window.location.href = chromeIntentUrl(nextInstallerUrl);
    return;
  }

  if (isIOS) {
    window.location.href = safariUrl(nextInstallerUrl);
    window.setTimeout(() => {
      manualMessage.textContent = 'If Safari did not open, use the in-app browser menu and choose Open in Safari.';
    }, 900);
    return;
  }

  window.location.href = nextInstallerUrl;
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = 'Copied';
    button.classList.add('copied');
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1600);
  } catch (error) {
    button.textContent = 'Copy failed';
    window.setTimeout(() => {
      button.textContent = button.id === 'copyInstallerBtn' ? 'Copy Link' : 'Copy app install link';
    }, 1600);
  }
}

function openAppForInstall() {
  saveInstallContext();
  const url = appInstallUrl(selectedTarget);

  if (isInAppBrowser) {
    revealManual('You still need to open the real browser first. After Safari or Chrome opens, use the button again.');
    if (isAndroid) {
      window.location.href = chromeIntentUrl(installerUrl(selectedTarget, 'steps', selectedOs));
      return;
    }
    if (isIOS) {
      window.location.href = safariUrl(installerUrl(selectedTarget, 'steps', selectedOs));
      return;
    }
  }

  window.location.href = url;
}

function bindEvents() {
  copyInstallerBtn.addEventListener('click', () => copyText(installerUrl(selectedTarget, 'welcome', selectedOs), copyInstallerBtn));

  stageMount.addEventListener('click', (event) => {
    const targetButton = event.target.closest('[data-target]');
    if (targetButton) {
      selectedTarget = targetButton.getAttribute('data-target');
      saveInstallContext();
      syncQuery();
      renderStage();
      return;
    }

    const osButton = event.target.closest('[data-os]');
    if (osButton) {
      selectedOs = osButton.getAttribute('data-os');
      goToStage('ready');
      return;
    }

    const backButton = event.target.closest('[data-back]');
    if (backButton) {
      goToStage(backButton.getAttribute('data-back'));
      return;
    }

    if (event.target.id === 'primaryActionBtn') {
      attemptBrowserHandoff();
      return;
    }

    if (event.target.id === 'showStepsBtn') {
      goToStage('steps');
      return;
    }

    if (event.target.id === 'openAppForInstallBtn') {
      openAppForInstall();
      return;
    }

    if (event.target.id === 'copyAppInstallBtn') {
      copyText(appInstallUrl(selectedTarget), event.target);
    }
  });
}

redirectStandaloneLaunch();

if (selectedStage === 'welcome') {
  hideManual();
} else if (isInAppBrowser) {
  revealManual('Stay in Safari or Chrome while you finish the installation steps.');
}

saveInstallContext();
syncQuery();
renderStage();
bindEvents();
