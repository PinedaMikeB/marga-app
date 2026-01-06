/**
 * MARGA Enterprise Management System
 * Authentication & Role-Based Access Control
 */

const MargaAuth = {
    // User roles
    ROLES: {
        ADMIN: 'admin',
        BILLING: 'billing',
        COLLECTION: 'collection',
        SERVICE: 'service',
        VIEWER: 'viewer'
    },

    // Module permissions per role
    PERMISSIONS: {
        admin: ['customers', 'billing', 'collections', 'service', 'inventory', 'hr', 'reports', 'settings'],
        billing: ['customers', 'billing', 'reports'],
        collection: ['customers', 'collections', 'reports'],
        service: ['customers', 'service', 'inventory'],
        viewer: ['customers', 'reports']
    },

    // Current user session
    currentUser: null,

    /**
     * Initialize auth - check for existing session
     */
    init() {
        const stored = localStorage.getItem('marga_user') || sessionStorage.getItem('marga_user');
        if (stored) {
            try {
                this.currentUser = JSON.parse(stored);
                return true;
            } catch (e) {
                this.logout();
            }
        }
        return false;
    },

    /**
     * Login user
     */
    async login(username, password, remember = false) {
        try {
            // Fetch users from Firebase
            const response = await fetch(
                `${FIREBASE_CONFIG.baseUrl}/marga_users?key=${FIREBASE_CONFIG.apiKey}`
            );
            
            if (!response.ok) {
                // If marga_users collection doesn't exist, use default admin
                console.log('Users collection not found, using default admin');
                return this.checkDefaultAdmin(username, password, remember);
            }

            const data = await response.json();
            
            if (!data.documents || data.documents.length === 0) {
                return this.checkDefaultAdmin(username, password, remember);
            }

            // Find matching user
            for (const doc of data.documents) {
                const user = this.parseFirestoreDoc(doc);
                if (user.username === username && user.password === password && user.active !== false) {
                    return this.setSession({
                        id: user._docId,
                        username: user.username,
                        name: user.name || user.username,
                        role: user.role || 'viewer',
                        email: user.email || ''
                    }, remember);
                }
            }

            return { success: false, message: 'Invalid username or password' };

        } catch (error) {
            console.error('Login error:', error);
            // Fallback to default admin on error
            return this.checkDefaultAdmin(username, password, remember);
        }
    },

    /**
     * Check default admin credentials
     */
    checkDefaultAdmin(username, password, remember) {
        // Default admin account - CHANGE IN PRODUCTION
        if (username === 'admin' && password === 'marga2025') {
            return this.setSession({
                id: 'default_admin',
                username: 'admin',
                name: 'Administrator',
                role: 'admin',
                email: ''
            }, remember);
        }
        return { success: false, message: 'Invalid username or password' };
    },

    /**
     * Set user session
     */
    setSession(user, remember) {
        this.currentUser = user;
        const storage = remember ? localStorage : sessionStorage;
        storage.setItem('marga_user', JSON.stringify(user));
        return { success: true, user };
    },

    /**
     * Logout user
     */
    logout() {
        this.currentUser = null;
        localStorage.removeItem('marga_user');
        sessionStorage.removeItem('marga_user');
        window.location.href = '/index.html';
    },

    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        if (!this.currentUser) {
            this.init();
        }
        return this.currentUser !== null;
    },

    /**
     * Get current user
     */
    getUser() {
        if (!this.currentUser) {
            this.init();
        }
        return this.currentUser;
    },

    /**
     * Check if user has access to a module
     */
    hasAccess(module) {
        if (!this.currentUser) return false;
        const permissions = this.PERMISSIONS[this.currentUser.role] || [];
        return permissions.includes(module);
    },

    /**
     * Check if user is admin
     */
    isAdmin() {
        return this.currentUser?.role === 'admin';
    },

    /**
     * Get accessible modules for current user
     */
    getAccessibleModules() {
        if (!this.currentUser) return [];
        return this.PERMISSIONS[this.currentUser.role] || [];
    },

    /**
     * Require authentication - redirect to login if not authenticated
     */
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = '/index.html';
            return false;
        }
        return true;
    },

    /**
     * Require specific module access
     */
    requireAccess(module) {
        if (!this.requireAuth()) return false;
        if (!this.hasAccess(module)) {
            alert('You do not have permission to access this module.');
            window.location.href = '/dashboard.html';
            return false;
        }
        return true;
    },

    /**
     * Parse Firestore document
     */
    parseFirestoreDoc(doc) {
        const fields = doc.fields || {};
        const result = {};
        for (const [key, value] of Object.entries(fields)) {
            if (value.stringValue !== undefined) result[key] = value.stringValue;
            else if (value.integerValue !== undefined) result[key] = parseInt(value.integerValue);
            else if (value.booleanValue !== undefined) result[key] = value.booleanValue;
            else result[key] = null;
        }
        if (doc.name) {
            result._docId = doc.name.split('/').pop();
        }
        return result;
    }
};

// Auto-initialize
MargaAuth.init();

// Make available globally
window.MargaAuth = MargaAuth;
