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
        HR: 'hr',
        TECHNICIAN: 'technician',
        MESSENGER: 'messenger',
        VIEWER: 'viewer'
    },

    // Module permissions per role
    PERMISSIONS: {
        admin: ['customers', 'billing', 'collections', 'service', 'inventory', 'hr', 'reports', 'settings', 'sync', 'field', 'purchasing', 'pettycash', 'sales'],
        billing: ['customers', 'billing', 'reports'],
        collection: ['customers', 'collections', 'reports'],
        service: ['customers', 'service', 'inventory', 'field'],
        hr: ['hr', 'settings'],
        technician: ['field'],
        messenger: ['field'],
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
            const ident = String(username || '').trim();
            if (!ident) return { success: false, message: 'Email is required.' };

            // Backward-compatible: allow default admin even if Firestore is misconfigured.
            if (this.checkDefaultAdmin(ident, password, remember).success) {
                return this.checkDefaultAdmin(ident, password, remember);
            }

            const user = await this.findUserByEmailOrUsername(ident);
            if (!user) return { success: false, message: 'Invalid email or password' };
            if (user.active === false) return { success: false, message: 'Account is inactive' };

            const ok = await this.verifyPassword(user, password);
            if (!ok) return { success: false, message: 'Invalid email or password' };

            return this.setSession({
                id: user._docId,
                username: user.username || user.email || ident,
                name: user.name || user.username || user.email || ident,
                role: user.role || 'viewer',
                email: user.email || '',
                staff_id: user.staff_id || user.staffId || null,
                allowed_modules: this.normalizeModules(user.allowed_modules)
            }, remember);

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
        window.location.href = this.buildAppUrl('index.html');
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
        if (this.currentUser.role === 'admin') return true;
        return this.getAccessibleModules().includes(module);
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
        if (this.currentUser.role === 'admin') return [...new Set(this.PERMISSIONS.admin || [])];
        const userModules = this.normalizeModules(this.currentUser.allowed_modules);
        if (userModules.length) return userModules;
        return this.PERMISSIONS[this.currentUser.role] || [];
    },

    /**
     * Require authentication - redirect to login if not authenticated
     */
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = this.buildAppUrl('index.html');
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
            window.location.href = this.buildAppUrl('dashboard.html');
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
        const parseValue = (value) => {
            if (!value || typeof value !== 'object') return null;
            if (value.stringValue !== undefined) return value.stringValue;
            if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
            if (value.doubleValue !== undefined) return Number(value.doubleValue);
            if (value.booleanValue !== undefined) return value.booleanValue;
            if (value.timestampValue !== undefined) return value.timestampValue;
            if (value.arrayValue !== undefined) {
                const arr = value.arrayValue?.values || [];
                return arr.map((entry) => parseValue(entry)).filter((entry) => entry !== null && entry !== undefined);
            }
            if (value.mapValue !== undefined) {
                const obj = {};
                Object.entries(value.mapValue?.fields || {}).forEach(([k, v]) => {
                    obj[k] = parseValue(v);
                });
                return obj;
            }
            return null;
        };
        for (const [key, value] of Object.entries(fields)) {
            result[key] = parseValue(value);
        }
        if (doc.name) {
            result._docId = doc.name.split('/').pop();
        }
        return result;
    }
};

MargaAuth.normalizeModules = function normalizeModules(modules) {
    if (Array.isArray(modules)) {
        return [...new Set(modules.map((m) => String(m || '').trim().toLowerCase()).filter(Boolean))];
    }
    if (typeof modules === 'string' && modules.trim()) {
        return [...new Set(modules.split(',').map((m) => m.trim().toLowerCase()).filter(Boolean))];
    }
    return [];
};

MargaAuth.getAppBasePath = function getAppBasePath() {
    // Supports both file:// local testing and hosted environments.
    const path = window.location.pathname || '/';
    const marker = '/Marga-App/';
    const idx = path.indexOf(marker);

    if (window.location.protocol === 'file:' && idx !== -1) {
        return path.slice(0, idx + marker.length);
    }
    if (window.location.protocol === 'file:') {
        // Best-effort: use current directory.
        return path.replace(/\/[^/]*$/, '/');
    }
    return '/';
};

MargaAuth.buildAppUrl = function buildAppUrl(relativePath) {
    const base = this.getAppBasePath();
    const rel = String(relativePath || '').replace(/^\/+/, '');
    if (base.endsWith('/')) return base + rel;
    return `${base}/${rel}`;
};

/**
 * Password hashing helpers (PBKDF2-SHA256).
 * This is not as strong as a server-side auth system, but it avoids storing plaintext passwords in Firestore.
 */
MargaAuth.pbkdf2 = async function pbkdf2(password, saltBytes, iterations) {
    if (!crypto?.subtle) {
        throw new Error('WebCrypto is unavailable in this context. Use HTTPS/localhost, or fallback to legacy plaintext passwords.');
    }
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
        keyMaterial,
        256
    );
    return new Uint8Array(bits);
};

MargaAuth.bytesToBase64 = function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
};

MargaAuth.base64ToBytes = function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

MargaAuth.canHashPasswords = function canHashPasswords() {
    return Boolean(crypto?.subtle);
};

MargaAuth.findUserByEmailOrUsername = async function findUserByEmailOrUsername(ident) {
    const email = String(ident || '').trim().toLowerCase();
    const run = async (fieldPath, value) => {
        const body = {
            structuredQuery: {
                from: [{ collectionId: 'marga_users' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath },
                        op: 'EQUAL',
                        value: { stringValue: String(value ?? '') }
                    }
                },
                limit: 1
            }
        };

        const response = await fetch(
            `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        const payload = await response.json();
        if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) return null;
        const doc = Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean)[0] : null;
        return doc ? this.parseFirestoreDoc(doc) : null;
    };

    return (await run('email', email)) || (await run('username', ident));
};

MargaAuth.verifyPassword = async function verifyPassword(user, password) {
    const provided = String(password || '');

    // Legacy fallback (plaintext). Prefer migrating to password_hash.
    if (user.password && !user.password_hash) {
        return String(user.password) === provided;
    }

    const hashB64 = String(user.password_hash || '').trim();
    const saltB64 = String(user.password_salt || '').trim();
    const iterations = Number(user.password_iterations || 120000);
    if (!hashB64 || !saltB64 || !Number.isFinite(iterations) || iterations < 20000) return false;

    if (!this.canHashPasswords()) {
        // Cannot verify PBKDF2 on insecure contexts (e.g. file://). If legacy password exists, use it.
        return Boolean(user.password) && String(user.password) === provided;
    }

    const derived = await this.pbkdf2(provided, this.base64ToBytes(saltB64), iterations);
    const derivedB64 = this.bytesToBase64(derived);
    return derivedB64 === hashB64;
};

// Auto-initialize
MargaAuth.init();

// Make available globally
window.MargaAuth = MargaAuth;
