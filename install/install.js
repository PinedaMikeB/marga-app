const APP_INSTALL_URL = 'https://margaapp.netlify.app/index.html?install=true';
const IN_APP_MARKERS = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line|Twitter|X\b|MicroMessenger|WeChat|Snapchat/i;
const userAgent = navigator.userAgent || navigator.vendor || window.opera || '';
const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
const isAndroid = /Android/i.test(userAgent);
const isInAppBrowser = IN_APP_MARKERS.test(userAgent);

const openInstallBtn = document.getElementById('openInstallBtn');
const fallbackText = document.getElementById('fallbackText');
const copyLinkBtn = document.getElementById('copyLinkBtn');

function chromeIntentUrl(urlString) {
    const url = new URL(urlString);
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(urlString)};end`;
}

function safariUrl(urlString) {
    return `x-safari-${urlString}`;
}

function revealFallback() {
    fallbackText.classList.remove('hidden');
    copyLinkBtn.classList.remove('hidden');
}

function openInstaller() {
    if (!isInAppBrowser) {
        window.location.href = APP_INSTALL_URL;
        return;
    }

    revealFallback();

    if (isAndroid) {
        window.location.href = chromeIntentUrl(APP_INSTALL_URL);
        return;
    }

    if (isIOS) {
        window.location.href = safariUrl(APP_INSTALL_URL);
        return;
    }

    window.location.href = APP_INSTALL_URL;
}

async function copyLink() {
    try {
        await navigator.clipboard.writeText(APP_INSTALL_URL);
        copyLinkBtn.textContent = 'Copied';
        window.setTimeout(() => {
            copyLinkBtn.textContent = 'Copy Link';
        }, 1500);
    } catch (error) {
        copyLinkBtn.textContent = 'Copy failed';
        window.setTimeout(() => {
            copyLinkBtn.textContent = 'Copy Link';
        }, 1500);
    }
}

openInstallBtn.addEventListener('click', openInstaller);
copyLinkBtn.addEventListener('click', copyLink);
