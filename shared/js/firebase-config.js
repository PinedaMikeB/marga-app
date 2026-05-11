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

const MARGABASE_CONFIG = {
    ...FIREBASE_CONFIG,
    apiKey: 'margabase-local',
    baseUrl: 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents'
};

const MARGA_DATA_BACKEND_KEY = 'marga_data_backend';

function getMargaCookie(name) {
    const safeName = `${encodeURIComponent(name)}=`;
    return document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(safeName))
        ?.slice(safeName.length) || '';
}

function setMargaCookie(name, value) {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value || '')}; path=/; max-age=31536000; SameSite=Lax`;
}

function clearMargaCookie(name) {
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
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
    const value = String(
        safeStorageGet(localStorage, MARGA_DATA_BACKEND_KEY)
        || safeStorageGet(sessionStorage, MARGA_DATA_BACKEND_KEY)
        || decodeURIComponent(getMargaCookie(MARGA_DATA_BACKEND_KEY) || '')
        || ''
    ).trim().toLowerCase();
    return value === 'margabase' ? 'margabase' : 'firebase';
}

function writeMargaDataBackendPreference(backend) {
    const value = backend === 'margabase' ? 'margabase' : 'firebase';
    if (value === 'firebase') {
        safeStorageRemove(localStorage, MARGA_DATA_BACKEND_KEY);
        safeStorageRemove(sessionStorage, MARGA_DATA_BACKEND_KEY);
        clearMargaCookie(MARGA_DATA_BACKEND_KEY);
        return true;
    }

    const saved = safeStorageSet(localStorage, MARGA_DATA_BACKEND_KEY, value)
        || safeStorageSet(sessionStorage, MARGA_DATA_BACKEND_KEY, value);
    setMargaCookie(MARGA_DATA_BACKEND_KEY, value);
    return saved;
}

function getMargaDataBackendConfig() {
    return readMargaDataBackendPreference() === 'margabase' ? MARGABASE_CONFIG : FIREBASE_CONFIG;
}

// Make available globally
window.FIREBASE_CONFIG = getMargaDataBackendConfig();
window.MARGA_FIREBASE_CONFIG = FIREBASE_CONFIG;
window.MARGABASE_CONFIG = MARGABASE_CONFIG;
window.MargaBackendPreference = {
    read: readMargaDataBackendPreference,
    write: writeMargaDataBackendPreference
};
