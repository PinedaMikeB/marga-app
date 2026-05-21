/**
 * MARGA Enterprise Management System
 * Margabase runtime configuration
 * 
 * The old Firebase project is intentionally not exposed to browser modules.
 * FIREBASE_CONFIG remains as a compatibility name for modules that still use
 * the Firestore REST-shaped API; it now points only to Margabase.
 */

const MARGABASE_ENABLED = true;

function blockLegacyNetlifyHost() {
    try {
        const host = String(window.location.hostname || '').toLowerCase();
        if (!host.endsWith('.netlify.app')) return;
        try {
            window.localStorage?.removeItem('marga_user');
            window.sessionStorage?.removeItem('marga_user');
        } catch (storageError) {
            // Storage can be unavailable in private browsing.
        }
        const renderBlock = () => {
            document.documentElement.innerHTML = `
                <head>
                    <title>MARGA App Retired Host</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body{margin:0;font-family:Arial,sans-serif;background:#edf6ff;color:#14355c;display:grid;place-items:center;min-height:100vh}
                        main{max-width:560px;margin:24px;padding:28px;background:#fff;border:1px solid #bfd7ef;border-radius:10px;box-shadow:0 20px 50px rgba(20,53,92,.14)}
                        h1{margin:0 0 12px;font-size:26px}
                        p{font-size:16px;line-height:1.5}
                        a{display:inline-block;margin-top:10px;color:#fff;background:#1f65b7;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700}
                    </style>
                </head>
                <body>
                    <main>
                        <h1>This MARGA address is retired.</h1>
                        <p><strong>margaapp.netlify.app is blocked</strong> to prevent bad Firebase records. Use the official app only.</p>
                        <a href="https://app.marga.biz/">Open app.marga.biz</a>
                    </main>
                </body>`;
        };
        if (document.body) renderBlock();
        else document.addEventListener('DOMContentLoaded', renderBlock, { once: true });
        throw new Error('Blocked retired MARGA host.');
    } catch (error) {
        throw error;
    }
}

blockLegacyNetlifyHost();

function isMargabaseHost() {
    try {
        return ['app.marga.biz', '127.0.0.1', 'localhost'].includes(window.location.hostname);
    } catch (error) {
        return false;
    }
}

function defaultMargabaseBaseUrl() {
    try {
        if (window.location.hostname === 'app.marga.biz' || window.location.origin === 'http://127.0.0.1:9100') {
            return '/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents';
        }
    } catch (error) {
        // Fall back to direct local API below.
    }
    return 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
}

const DEFAULT_MARGABASE_BASE_URL = defaultMargabaseBaseUrl();

const MARGABASE_CONFIG = {
    apiKey: 'margabase-local',
    authDomain: '',
    projectId: 'margabase',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    baseUrl: DEFAULT_MARGABASE_BASE_URL
};

const FIREBASE_CONFIG = MARGABASE_CONFIG;

const MARGA_DATA_BACKEND_KEY = 'marga_data_backend';
const MARGA_API_BASE_URL_KEY = 'marga_api_base_url';
const LEGACY_FIRESTORE_HOST = ['firestore', 'googleapis', 'com'].join('.');

function readMargaQueryParam(name) {
    try {
        return new URLSearchParams(window.location.search).get(name) || '';
    } catch (error) {
        return '';
    }
}

function getMargaCookie(name) {
    try {
        const cookie = typeof document.cookie === 'undefined' ? '' : document.cookie;
        const safeName = `${encodeURIComponent(name)}=`;
        return cookie
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(safeName))
            ?.slice(safeName.length) || '';
    } catch (error) {
        return '';
    }
}

function clearMargaCookie(name) {
    try {
        document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
    } catch (error) {
        // Cookie storage can be blocked in test or private browsing contexts.
    }
}

function setMargaCookie(name, value) {
    try {
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value || '')}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (error) {
        // Cookie storage can be blocked in test or private browsing contexts.
    }
}

function safeStorageGet(storage, key) {
    try {
        return storage?.getItem(key) || '';
    } catch (error) {
        return '';
    }
}

function safeStorageSet(storage, key, value) {
    try {
        storage?.setItem(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

function safeStorageRemove(storage, key) {
    try {
        storage?.removeItem(key);
    } catch (error) {
        // Browser storage can be unavailable or full in private windows.
    }
}

function getMargaLocalStorage() {
    try {
        return typeof window.localStorage === 'undefined' ? null : window.localStorage;
    } catch (error) {
        return null;
    }
}

function getMargaSessionStorage() {
    try {
        return typeof window.sessionStorage === 'undefined' ? null : window.sessionStorage;
    } catch (error) {
        return null;
    }
}

function readMargaDataBackendPreference() {
    clearMargaBackendPreference();
    return 'margabase';
}

function clearMargaBackendPreference() {
    safeStorageRemove(getMargaLocalStorage(), MARGA_DATA_BACKEND_KEY);
    safeStorageRemove(getMargaSessionStorage(), MARGA_DATA_BACKEND_KEY);
    safeStorageRemove(getMargaLocalStorage(), MARGA_API_BASE_URL_KEY);
    safeStorageRemove(getMargaSessionStorage(), MARGA_API_BASE_URL_KEY);
    clearMargaCookie(MARGA_DATA_BACKEND_KEY);
    clearMargaCookie(MARGA_API_BASE_URL_KEY);
}

function writeMargaDataBackendPreference(backend) {
    const saved = safeStorageSet(getMargaLocalStorage(), MARGA_DATA_BACKEND_KEY, 'margabase')
        || safeStorageSet(getMargaSessionStorage(), MARGA_DATA_BACKEND_KEY, 'margabase');
    setMargaCookie(MARGA_DATA_BACKEND_KEY, 'margabase');
    return saved;
}

function readMargaApiBaseUrlPreference() {
    if (isMargabaseHost()) return DEFAULT_MARGABASE_BASE_URL;
    const queryBaseUrl = String(readMargaQueryParam(MARGA_API_BASE_URL_KEY) || '').trim();
    if (queryBaseUrl && !queryBaseUrl.includes(LEGACY_FIRESTORE_HOST)) return queryBaseUrl;
    const value = String(
        safeStorageGet(getMargaLocalStorage(), MARGA_API_BASE_URL_KEY)
        || safeStorageGet(getMargaSessionStorage(), MARGA_API_BASE_URL_KEY)
        || decodeURIComponent(getMargaCookie(MARGA_API_BASE_URL_KEY) || '')
        || ''
    ).trim();
    return value && !value.includes(LEGACY_FIRESTORE_HOST) ? value : DEFAULT_MARGABASE_BASE_URL;
}

function writeMargaApiBaseUrlPreference(baseUrl) {
    if (isMargabaseHost()) {
        clearMargaBackendPreference();
        setMargaCookie(MARGA_DATA_BACKEND_KEY, 'margabase');
        return true;
    }
    const value = String(baseUrl || '').trim();
    if (value && value.includes(LEGACY_FIRESTORE_HOST)) {
        clearMargaBackendPreference();
        return false;
    }
    const saved = value
        ? safeStorageSet(getMargaLocalStorage(), MARGA_API_BASE_URL_KEY, value)
            || safeStorageSet(getMargaSessionStorage(), MARGA_API_BASE_URL_KEY, value)
        : true;
    if (value) setMargaCookie(MARGA_API_BASE_URL_KEY, value);
    setMargaCookie(MARGA_DATA_BACKEND_KEY, 'margabase');
    return saved;
}

function getMargaDataBackendConfig() {
    return { ...MARGABASE_CONFIG, baseUrl: readMargaApiBaseUrlPreference() };
}

// Make available globally
window.FIREBASE_CONFIG = getMargaDataBackendConfig();
window.MARGA_FIREBASE_CONFIG = null;
window.MARGABASE_CONFIG = { ...MARGABASE_CONFIG, enabled: MARGABASE_ENABLED, baseUrl: readMargaApiBaseUrlPreference() };
window.MargaBackendPreference = {
    read: readMargaDataBackendPreference,
    write: writeMargaDataBackendPreference,
    readApiBaseUrl: readMargaApiBaseUrlPreference,
    writeApiBaseUrl: writeMargaApiBaseUrlPreference
};
