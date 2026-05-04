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
        admin: ['customers', 'ai-product-consultant', 'billing', 'schedule', 'master-schedule', 'apd', 'collections', 'service', 'general-production', 'releasing', 'receiving', 'inventory', 'hr', 'reports', 'settings', 'sync', 'field', 'purchasing', 'pettycash', 'sales'],
        billing: ['customers', 'billing', 'schedule', 'apd', 'pettycash', 'reports'],
        collection: ['customers', 'collections', 'schedule', 'master-schedule', 'reports'],
        service: ['customers', 'ai-product-consultant', 'master-schedule', 'service', 'schedule', 'general-production', 'releasing', 'receiving', 'inventory', 'field'],
        hr: ['hr', 'settings'],
        technician: ['field'],
        messenger: ['field', 'schedule'],
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
                this.currentUser.roles = this.normalizeRoles(this.currentUser.roles || this.currentUser.role || 'viewer');
                this.currentUser.role = this.normalizeRole(this.currentUser.role || this.currentUser.roles[0] || 'viewer');
                this.currentUser.allowed_modules = this.normalizeModules(this.currentUser.allowed_modules);
                this.currentUser.role_modules = this.normalizeModules(this.currentUser.role_modules);
                this.currentUser.allowed_modules_configured = this.currentUser.allowed_modules_configured === true;
                this.reconcileStoredSessionModules();
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
            if (!this.isEmployeeActive(user)) return { success: false, message: 'Account is inactive' };

            const ok = await this.verifyPassword(user, password);
            if (!ok) return { success: false, message: 'Invalid email or password' };

            const roles = this.normalizeRoles(user.marga_roles || user.roles || user.marga_role || user.role || this.inferRole(user));
            const role = roles[0] || 'viewer';
            const userModulesConfigured = user.allowed_modules_configured === true;
            const allowedModules = userModulesConfigured
                ? this.normalizeModules(user.marga_allowed_modules || user.allowed_modules)
                : [];
            let roleModules = null;
            if (!userModulesConfigured && !roles.includes('admin')) {
                roleModules = await this.fetchRoleModulesForRoles(roles);
            }
            const resolvedRoleModules = Array.isArray(roleModules)
                ? roleModules
                : this.getRoleModulesFromPermissions(roles);

            const sessionName = String(
                user.marga_fullname
                || user.name
                || `${String(user.firstname || '').trim()} ${String(user.lastname || '').trim()}`.trim()
                || user.nickname
                || user.username
                || user.email
                || ident
            ).trim();

            const sessionEmail = String(user.email || user.marga_login_email || '').trim().toLowerCase();
            const sessionStaffId = user.id || user.staff_id || user.staffId || null;

            return this.setSession({
                id: user._docId,
                username: user.username || sessionEmail || ident,
                name: sessionName,
                role,
                roles,
                email: sessionEmail,
                staff_id: sessionStaffId,
                allowed_modules: allowedModules,
                role_modules: resolvedRoleModules,
                allowed_modules_configured: userModulesConfigured
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
                roles: ['admin'],
                email: '',
                allowed_modules: [],
                role_modules: this.normalizeModules(this.PERMISSIONS.admin || []),
                allowed_modules_configured: false
            }, remember);
        }
        return { success: false, message: 'Invalid username or password' };
    },

    /**
     * Set user session
     */
    setSession(user, remember) {
        this.currentUser = {
            ...user,
            roles: this.normalizeRoles(user?.roles || user?.role || 'viewer'),
            role: this.normalizeRole(user?.role || user?.roles?.[0] || 'viewer'),
            allowed_modules: this.normalizeModules(user?.allowed_modules),
            role_modules: this.normalizeModules(user?.role_modules),
            allowed_modules_configured: user?.allowed_modules_configured === true
        };
        if (!this.currentUser.roles.length) {
            this.currentUser.roles = [this.currentUser.role];
        }
        this.currentUser.role = this.currentUser.roles[0] || 'viewer';
        this.reconcileStoredSessionModules();
        const storage = remember ? localStorage : sessionStorage;
        storage.setItem('marga_user', JSON.stringify(this.currentUser));
        return { success: true, user: this.currentUser };
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
        const normalizedModule = String(module || '').trim().toLowerCase();
        if (!normalizedModule || normalizedModule === 'dashboard') return true;
        if (this.isAdmin()) return true;
        return this.getAccessibleModules().includes(normalizedModule);
    },

    isEmployeeActive(user) {
        if (!user || typeof user !== 'object') return false;
        if (user.marga_active === false) return false;
        if (user.marga_account_active === false) return false;
        if (user.active === false) return false;
        if (user.marga_active === true || user.marga_account_active === true || user.active === true) return true;
        const estatus = Number(user.estatus);
        if (Number.isFinite(estatus)) return estatus === 1;
        return true;
    },

    inferRole(user) {
        const positionName = String(user?.position || user?.position_name || user?.position_label || '').toLowerCase();
        const positionId = Number(user?.position_id || 0);
        if (positionId === 5 || positionName.includes('technician') || positionName.includes('tech')) return 'technician';
        if (positionId === 9 || positionName.includes('messenger') || positionName.includes('driver')) return 'messenger';
        if (positionName.includes('collection')) return 'collection';
        if (positionName.includes('billing') || positionName.includes('account') || positionName.includes('finance') || positionName.includes('cashier')) return 'billing';
        if (positionName.includes('service') || positionName.includes('csr') || positionName.includes('sales')) return 'service';
        if (positionName.includes('hr')) return 'hr';
        if (positionName.includes('admin') || positionName.includes('manager')) return 'admin';
        return 'viewer';
    },

    /**
     * Check if user is admin
     */
    isAdmin() {
        return this.hasRole('admin');
    },

    /**
     * Get accessible modules for current user
     */
    getAccessibleModules() {
        if (!this.currentUser) return [];
        if (this.isAdmin()) return [...new Set(this.PERMISSIONS.admin || [])];
        const hasUserOverride = this.currentUser.allowed_modules_configured === true;
        const userModules = this.normalizeModules(this.currentUser.allowed_modules);
        if (hasUserOverride) return userModules;
        const roleModules = this.normalizeModules(this.currentUser.role_modules);
        if (roleModules.length) {
            return [...new Set([
                ...roleModules,
                ...this.getRoleModulesFromPermissions(this.currentUser.roles || this.currentUser.role)
            ])];
        }
        return this.getRoleModulesFromPermissions(this.currentUser.roles || this.currentUser.role);
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

MargaAuth.reconcileStoredSessionModules = function reconcileStoredSessionModules() {
    if (!this.currentUser) return;
    const roleModules = this.getRoleModulesFromPermissions(this.currentUser.roles || this.currentUser.role);
    const userModules = this.normalizeModules(this.currentUser.allowed_modules);
    const roleModuleSet = new Set(roleModules);
    this.currentUser.role_modules = this.normalizeModules([
        ...this.normalizeModules(this.currentUser.role_modules),
        ...roleModules
    ]);
    if (
        this.currentUser.allowed_modules_configured === true
        && userModules.length
        && userModules.every((module) => roleModuleSet.has(module))
    ) {
        this.currentUser.allowed_modules_configured = false;
    }
    if (this.currentUser.allowed_modules_configured === true) return;
    this.currentUser.allowed_modules = [];
};

MargaAuth.normalizeModules = function normalizeModules(modules) {
    const normalizeModule = (module) => String(module || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (Array.isArray(modules)) {
        return [...new Set(modules.map((m) => normalizeModule(m)).filter(Boolean))];
    }
    if (typeof modules === 'string' && modules.trim()) {
        return [...new Set(modules.split(',').map((m) => normalizeModule(m)).filter(Boolean))];
    }
    return [];
};

MargaAuth.normalizeRole = function normalizeRole(role) {
    const value = String(role || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return value || 'viewer';
};

MargaAuth.normalizeRoles = function normalizeRoles(roles) {
    if (Array.isArray(roles)) {
        return [...new Set(roles.map((role) => this.normalizeRole(role)).filter(Boolean))];
    }
    if (typeof roles === 'string' && roles.trim()) {
        return [...new Set(roles.split(',').map((role) => this.normalizeRole(role)).filter(Boolean))];
    }
    return [];
};

MargaAuth.getRoles = function getRoles(user = this.currentUser) {
    const roles = this.normalizeRoles(user?.roles || user?.role || []);
    if (roles.length) return roles;
    return ['viewer'];
};

MargaAuth.hasRole = function hasRole(role, user = this.currentUser) {
    const normalizedRole = this.normalizeRole(role);
    return this.getRoles(user).includes(normalizedRole);
};

MargaAuth.formatRoleLabel = function formatRoleLabel(role) {
    return String(role || '')
        .trim()
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Viewer';
};

MargaAuth.getDisplayRoles = function getDisplayRoles(user = this.currentUser) {
    return this.getRoles(user).map((role) => this.formatRoleLabel(role)).join(', ');
};

MargaAuth.getRoleModulesFromPermissions = function getRoleModulesFromPermissions(roles) {
    return [...new Set(
        this.normalizeRoles(roles).flatMap((role) => this.normalizeModules(this.PERMISSIONS[role] || []))
    )];
};

MargaAuth.persistCurrentUser = function persistCurrentUser() {
    if (!this.currentUser) return;
    const value = JSON.stringify(this.currentUser);
    if (localStorage.getItem('marga_user')) localStorage.setItem('marga_user', value);
    if (sessionStorage.getItem('marga_user')) sessionStorage.setItem('marga_user', value);
};

MargaAuth.registerModules = function registerModules(modules) {
    const normalizedModules = this.normalizeModules(
        Array.isArray(modules)
            ? modules.map((module) => typeof module === 'string' ? module : module?.id)
            : modules
    );
    if (!normalizedModules.length) return;
    this.PERMISSIONS.admin = [...new Set([
        ...this.normalizeModules(this.PERMISSIONS.admin || []),
        ...normalizedModules
    ])];
    if (!this.currentUser || !this.isAdmin() || this.currentUser.allowed_modules_configured === true) return;
    this.currentUser.role_modules = this.normalizeModules(this.PERMISSIONS.admin);
    this.persistCurrentUser();
};

MargaAuth.setRolePermissions = function setRolePermissions(role, modules) {
    const normalizedRole = this.normalizeRole(role);
    const normalizedModules = this.normalizeModules(modules);
    this.PERMISSIONS[normalizedRole] = normalizedModules;

    if (!this.currentUser) return;
    if (!this.hasRole(normalizedRole)) return;
    if (this.currentUser.allowed_modules_configured === true) return;

    this.currentUser.role_modules = this.getRoleModulesFromPermissions(this.currentUser.roles);
    this.persistCurrentUser();
};

MargaAuth.fetchRoleModules = async function fetchRoleModules(role) {
    const normalizedRole = this.normalizeRole(role);
    try {
        const response = await fetch(
            `${FIREBASE_CONFIG.baseUrl}/marga_role_permissions/${encodeURIComponent(normalizedRole)}?key=${FIREBASE_CONFIG.apiKey}`
        );
        const payload = await response.json();
        if (!response.ok || payload?.error) return null;

        const parsed = this.parseFirestoreDoc(payload);
        if (!parsed || parsed.active === false) {
            this.PERMISSIONS[normalizedRole] = [];
            return [];
        }
        const modules = this.normalizeModules(parsed.allowed_modules);
        this.PERMISSIONS[normalizedRole] = modules;
        return modules;
    } catch (error) {
        console.warn('Role-permission lookup failed:', error);
        return null;
    }
};

MargaAuth.fetchRoleModulesForRoles = async function fetchRoleModulesForRoles(roles) {
    const normalizedRoles = this.normalizeRoles(roles);
    if (!normalizedRoles.length) return this.getRoleModulesFromPermissions(['viewer']);
    const results = await Promise.all(normalizedRoles.map((role) => this.fetchRoleModules(role)));
    const resolved = [...new Set(results.flatMap((modules, index) => {
        if (Array.isArray(modules)) return modules;
        return this.normalizeModules(this.PERMISSIONS[normalizedRoles[index]] || []);
    }))];
    return resolved;
};

MargaAuth.applyModulePermissions = function applyModulePermissions({ selector = '[data-module]', hideUnauthorized = false } = {}) {
    if (!this.currentUser) this.init();
    document.querySelectorAll(selector).forEach((el) => {
        const module = String(el.dataset.module || '').trim().toLowerCase();
        if (!module) return;
        const canAccess = this.hasAccess(module);
        if (canAccess) {
            el.classList.remove('disabled');
            if (hideUnauthorized) el.style.removeProperty('display');
            return;
        }
        if (hideUnauthorized) {
            el.style.display = 'none';
            return;
        }
        el.classList.add('disabled');
        if (!el.dataset.noAccessBound) {
            el.addEventListener('click', (event) => {
                event.preventDefault();
                alert('You do not have permission to access this module.');
            });
            el.dataset.noAccessBound = '1';
        }
    });
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
    const rawIdent = String(ident || '').trim();
    const email = rawIdent.toLowerCase();
    const username = rawIdent.toLowerCase();
    const run = async (collectionId, fieldPath, value) => {
        const body = {
            structuredQuery: {
                from: [{ collectionId }],
                where: {
                    fieldFilter: {
                        field: { fieldPath },
                        op: 'EQUAL',
                        value: { stringValue: String(value ?? '') }
                    }
                },
                limit: 10
            }
        };

        const response = await fetch(
            `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        const payload = await response.json();
        if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) return null;
        const docs = Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean) : [];
        const users = docs.map((doc) => this.parseFirestoreDoc(doc)).filter(Boolean);
        return users.find((user) => this.isEmployeeActive(user)) || users[0] || null;
    };

    const employeeByEmail = await run('tbl_employee', 'email', email);
    if (employeeByEmail) return employeeByEmail;

    return await run('tbl_employee', 'username', username);
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
