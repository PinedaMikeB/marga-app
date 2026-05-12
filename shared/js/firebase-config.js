/**
 * MARGA Enterprise Management System
 * Firebase Configuration
 * 
 * This file contains Firebase connection settings.
 * Used by all modules across the application.
 */

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M',
    authDomain: 'sah-spiritual-journal.firebaseapp.com',
    projectId: 'sah-spiritual-journal',
    storageBucket: 'sah-spiritual-journal.firebasestorage.app',
    messagingSenderId: '450636566224',
    appId: '1:450636566224:web:5c46eb4b827e6fd3ad58d5',
    
    // Firestore REST API base URL
    baseUrl: 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents'
};

const MARGABASE_ENABLED = false;
const DEFAULT_MARGABASE_BASE_URL = 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';

const MARGABASE_CONFIG = {
    ...FIREBASE_CONFIG,
    apiKey: 'margabase-local',
    baseUrl: DEFAULT_MARGABASE_BASE_URL
};

const MARGA_DATA_BACKEND_KEY = 'marga_data_backend';
const MARGA_API_BASE_URL_KEY = 'marga_api_base_url';

function getMargaCookie(name) {
    const safeName = `${encodeURIComponent(name)}=`;
    return document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(safeName))
        ?.slice(safeName.length) || '';
}

function clearMargaCookie(name) {
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
}

function setMargaCookie(name, value) {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value || '')}; path=/; max-age=31536000; SameSite=Lax`;
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

function readMargaDataBackendPreference() {
    if (MARGABASE_ENABLED) {
        const value = String(
            safeStorageGet(localStorage, MARGA_DATA_BACKEND_KEY)
            || safeStorageGet(sessionStorage, MARGA_DATA_BACKEND_KEY)
            || decodeURIComponent(getMargaCookie(MARGA_DATA_BACKEND_KEY) || '')
            || ''
        ).trim().toLowerCase();
        return value === 'margabase' ? 'margabase' : 'firebase';
    }
    clearMargaBackendPreference();
    return 'firebase';
}

function clearMargaBackendPreference() {
    safeStorageRemove(localStorage, MARGA_DATA_BACKEND_KEY);
    safeStorageRemove(sessionStorage, MARGA_DATA_BACKEND_KEY);
    safeStorageRemove(localStorage, MARGA_API_BASE_URL_KEY);
    safeStorageRemove(sessionStorage, MARGA_API_BASE_URL_KEY);
    clearMargaCookie(MARGA_DATA_BACKEND_KEY);
    clearMargaCookie(MARGA_API_BASE_URL_KEY);
}

function writeMargaDataBackendPreference(backend) {
    if (MARGABASE_ENABLED && backend === 'margabase') {
        const saved = safeStorageSet(localStorage, MARGA_DATA_BACKEND_KEY, 'margabase')
            || safeStorageSet(sessionStorage, MARGA_DATA_BACKEND_KEY, 'margabase');
        setMargaCookie(MARGA_DATA_BACKEND_KEY, 'margabase');
        return saved;
    }
    clearMargaBackendPreference();
    return true;
}

function readMargaApiBaseUrlPreference() {
    if (MARGABASE_ENABLED) {
        const value = String(
            safeStorageGet(localStorage, MARGA_API_BASE_URL_KEY)
            || safeStorageGet(sessionStorage, MARGA_API_BASE_URL_KEY)
            || decodeURIComponent(getMargaCookie(MARGA_API_BASE_URL_KEY) || '')
            || ''
        ).trim();
        return value || DEFAULT_MARGABASE_BASE_URL;
    }
    clearMargaBackendPreference();
    return FIREBASE_CONFIG.baseUrl;
}

function writeMargaApiBaseUrlPreference(baseUrl) {
    if (MARGABASE_ENABLED && baseUrl) {
        const value = String(baseUrl || '').trim();
        const saved = safeStorageSet(localStorage, MARGA_API_BASE_URL_KEY, value)
            || safeStorageSet(sessionStorage, MARGA_API_BASE_URL_KEY, value);
        setMargaCookie(MARGA_API_BASE_URL_KEY, value);
        return saved;
    }
    clearMargaBackendPreference();
    return true;
}

function getMargaDataBackendConfig() {
    if (!MARGABASE_ENABLED) {
        clearMargaBackendPreference();
        return FIREBASE_CONFIG;
    }
    return readMargaDataBackendPreference() === 'margabase'
        ? { ...MARGABASE_CONFIG, baseUrl: readMargaApiBaseUrlPreference() }
        : FIREBASE_CONFIG;
}

// Make available globally
window.FIREBASE_CONFIG = getMargaDataBackendConfig();
window.MARGA_FIREBASE_CONFIG = FIREBASE_CONFIG;
window.MARGABASE_CONFIG = { ...MARGABASE_CONFIG, enabled: MARGABASE_ENABLED, baseUrl: readMargaApiBaseUrlPreference() };
window.MargaBackendPreference = {
    read: readMargaDataBackendPreference,
    write: writeMargaDataBackendPreference,
    readApiBaseUrl: readMargaApiBaseUrlPreference,
    writeApiBaseUrl: writeMargaApiBaseUrlPreference
};
