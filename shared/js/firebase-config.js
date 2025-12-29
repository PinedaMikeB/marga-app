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

// Make available globally
window.FIREBASE_CONFIG = FIREBASE_CONFIG;
