(function () {
    const INSTALL_QUERY = 'install';
    const WELCOME_KEY = 'marga_pwa_welcome_shown_v1';

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
            console.warn('Service worker registration failed', error);
        });
    }

    function isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true
            || document.referrer.startsWith('android-app://');
    }

    function clearInstallQuery() {
        const params = new URLSearchParams(window.location.search);
        if (!(params.get(INSTALL_QUERY) === 'true' || params.has(INSTALL_QUERY))) return;
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete(INSTALL_QUERY);
        window.history.replaceState({}, '', nextUrl.toString());
    }

    function shouldShowInstallGuide() {
        if (isInstalled()) return false;
        const params = new URLSearchParams(window.location.search);
        return params.get(INSTALL_QUERY) === 'true' || params.has(INSTALL_QUERY);
    }

    function ensureStyles() {
        if (document.getElementById('margaInstallGuideStyles')) return;

        const style = document.createElement('style');
        style.id = 'margaInstallGuideStyles';
        style.textContent = `
            #margaInstallGuide {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                background: linear-gradient(180deg, #f7fbff 0%, #eef6ff 44%, #dbeafe 100%);
            }
            .marga-install-overlay {
                position: absolute;
                inset: 0;
                background: rgba(17, 34, 58, 0.14);
            }
            .marga-install-panel {
                position: relative;
                z-index: 1;
                width: min(100%, 390px);
                padding: 26px 22px;
                border-radius: 28px;
                background: rgba(255, 255, 255, 0.98);
                color: #17324f;
                text-align: center;
                box-shadow: 0 26px 70px rgba(0, 0, 0, 0.24);
            }
            .marga-install-badge {
                width: 70px;
                height: 70px;
                margin: 0 auto 14px;
                border-radius: 18px;
                display: block;
                object-fit: cover;
                box-shadow: 0 12px 28px rgba(15, 109, 242, 0.24);
            }
            .marga-install-panel h2 {
                margin: 0;
                font-family: 'Space Grotesk', sans-serif;
                font-size: 1.8rem;
            }
            .marga-install-subtitle {
                margin: 12px 0 0;
                line-height: 1.65;
                color: #57708f;
            }
            .marga-slide-wrap {
                position: relative;
                min-height: 176px;
                margin-top: 18px;
            }
            .marga-slide {
                position: absolute;
                inset: 0;
                display: grid;
                align-content: center;
                gap: 12px;
                padding: 18px 16px;
                border-radius: 22px;
                background: rgba(59, 130, 246, 0.06);
                border: 1px solid rgba(59, 130, 246, 0.12);
                opacity: 0;
                transform: translateX(12px);
                transition: opacity 0.28s ease, transform 0.28s ease;
            }
            .marga-slide.active {
                opacity: 1;
                transform: translateX(0);
            }
            .marga-slide-step {
                font-size: 0.78rem;
                font-weight: 800;
                letter-spacing: 0.12em;
                text-transform: uppercase;
                color: #1d4ed8;
            }
            .marga-slide-title {
                font-family: 'Space Grotesk', sans-serif;
                font-size: 1.15rem;
                font-weight: 700;
                color: #17324f;
            }
            .marga-install-copy {
                line-height: 1.7;
                color: #57708f;
            }
            .marga-slide-dots {
                display: flex;
                justify-content: center;
                gap: 8px;
                margin-top: 16px;
            }
            .marga-slide-dot {
                width: 8px;
                height: 8px;
                border-radius: 999px;
                background: rgba(59, 130, 246, 0.2);
                transition: transform 0.2s ease, background 0.2s ease;
            }
            .marga-slide-dot.active {
                background: #0f6df2;
                transform: scale(1.25);
            }
            #margaInstallClose {
                width: 100%;
                min-height: 50px;
                margin-top: 18px;
                border: 0;
                border-radius: 16px;
                color: #fff;
                background: linear-gradient(135deg, #0f6df2, #0759cf);
                font: inherit;
                font-weight: 800;
                cursor: pointer;
            }
            .marga-install-footer {
                margin-top: 18px;
                padding: 14px 16px;
                border-radius: 18px;
                background: rgba(29, 78, 216, 0.06);
                border: 1px solid rgba(29, 78, 216, 0.12);
                color: #29476b;
                line-height: 1.65;
            }
        `;
        document.head.appendChild(style);
    }

    function showInstallGuide() {
        if (!shouldShowInstallGuide()) return;

        const ua = navigator.userAgent || '';
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const steps = isIOS
            ? [
                {
                    step: 'Step 1',
                    title: 'Open Share or browser menu',
                    body: 'Tap the Share button or the browser menu in Safari.'
                },
                {
                    step: 'Step 2',
                    title: 'Choose Add to Home Screen',
                    body: 'Scroll if needed until you see Add to Home Screen.'
                },
                {
                    step: 'Step 3',
                    title: 'Tap Add',
                    body: 'Marga will install and place the icon on your home screen.'
                }
            ]
            : [
                {
                    step: 'Step 1',
                    title: 'Open the browser menu',
                    body: 'Tap the Chrome menu on the top or bottom of the screen.'
                },
                {
                    step: 'Step 2',
                    title: 'Choose Install app',
                    body: 'Some phones show Add to Home screen instead.'
                },
                {
                    step: 'Step 3',
                    title: 'Confirm install',
                    body: 'Marga will install and place the icon on your home screen.'
                }
            ];

        const overlay = document.createElement('div');
        overlay.id = 'margaInstallGuide';
        overlay.innerHTML = `
            <div class="marga-install-overlay"></div>
            <section class="marga-install-panel" role="dialog" aria-modal="true" aria-label="Install Marga App">
                <img class="marga-install-badge" src="/assets/icons/icon-192.png" alt="MARGA logo">
                <h2>Install Marga App</h2>
                <p class="marga-install-subtitle">Follow the steps. When installation finishes, go to your home screen and tap the <strong>MARGA</strong> icon to log in.</p>
                <div class="marga-slide-wrap">
                    ${steps
                        .map(
                            (item, index) => `
                                <article class="marga-slide ${index === 0 ? 'active' : ''}" data-slide="${index}">
                                    <div class="marga-slide-step">${item.step}</div>
                                    <div class="marga-slide-title">${item.title}</div>
                                    <div class="marga-install-copy">${item.body}</div>
                                </article>
                            `
                        )
                        .join('')}
                </div>
                <div class="marga-slide-dots">
                    ${steps
                        .map((_, index) => `<span class="marga-slide-dot ${index === 0 ? 'active' : ''}" data-dot="${index}"></span>`)
                        .join('')}
                </div>
                <div class="marga-install-footer">
                    To log in later, leave this browser page, go to your home screen, and find the MARGA icon with your logo.
                </div>
            </section>
        `;

        ensureStyles();
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        const slides = Array.from(overlay.querySelectorAll('.marga-slide'));
        const dots = Array.from(overlay.querySelectorAll('.marga-slide-dot'));
        let activeIndex = 0;

        window.setInterval(() => {
            activeIndex = (activeIndex + 1) % slides.length;
            slides.forEach((slide, index) => slide.classList.toggle('active', index === activeIndex));
            dots.forEach((dot, index) => dot.classList.toggle('active', index === activeIndex));
        }, 2400);
    }

    function showInstalledWelcome() {
        if (!isInstalled()) return;
        if (localStorage.getItem(WELCOME_KEY)) return;

        const overlay = document.createElement('div');
        overlay.id = 'margaInstallGuide';
        overlay.innerHTML = `
            <div class="marga-install-overlay"></div>
            <section class="marga-install-panel" role="dialog" aria-modal="true" aria-label="Marga App installed">
                <img class="marga-install-badge" src="/assets/icons/icon-192.png" alt="MARGA logo">
                <h2>Marga App is installed</h2>
                <p class="marga-install-copy">Use this home screen icon anytime to open Marga.</p>
                <button type="button" id="margaInstallClose">Continue</button>
            </section>
        `;

        ensureStyles();
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        function closeGuide() {
            localStorage.setItem(WELCOME_KEY, 'true');
            overlay.remove();
            document.body.style.overflow = '';
        }

        overlay.querySelector('.marga-install-overlay').addEventListener('click', closeGuide);
        overlay.querySelector('#margaInstallClose').addEventListener('click', closeGuide);
    }

    window.MargaPwa = {
        isInstalled
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            showInstallGuide();
            showInstalledWelcome();
        });
    } else {
        showInstallGuide();
        showInstalledWelcome();
    }
})();
