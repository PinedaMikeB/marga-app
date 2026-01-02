/**
 * MARGA Authentication & Authorization System
 * Handles user login, role-based access control, and route protection
 */

var MargaAuth = window.MargaAuth || {
    currentUser: null,
    userProfile: null,
    
    // Role definitions with permissions
    roles: {
        admin: {
            name: 'Administrator',
            permissions: ['dashboard', 'customers', 'billing', 'collections', 'service', 'inventory', 'reports', 'settings', 'users'],
            canCreate: true,
            canEdit: true,
            canDelete: true
        },
        manager: {
            name: 'Manager',
            permissions: ['dashboard', 'customers', 'billing', 'collections', 'service', 'reports'],
            canCreate: true,
            canEdit: true,
            canDelete: false
        },
        billing: {
            name: 'Billing Staff',
            permissions: ['dashboard', 'customers', 'billing'],
            canCreate: true,
            canEdit: true,
            canDelete: false
        },
        collection: {
            name: 'Collection Staff',
            permissions: ['dashboard', 'customers', 'collections'],
            canCreate: true,
            canEdit: false,
            canDelete: false
        },
        service: {
            name: 'Service Technician',
            permissions: ['dashboard', 'service'],
            canCreate: true,
            canEdit: true,
            canDelete: false
        },
        viewer: {
            name: 'Viewer',
            permissions: ['dashboard', 'customers', 'billing', 'reports'],
            canCreate: false,
            canEdit: false,
            canDelete: false
        }
    },

    /**
     * Initialize authentication
     */
    init: function() {
        try {
            // Check if Firebase is initialized
            if (typeof firebase !== 'undefined' && !firebase.apps.length && typeof FIREBASE_CONFIG !== 'undefined') {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            
            // Try to get stored user
            var storedUser = localStorage.getItem('margaUser');
            if (storedUser) {
                this.userProfile = JSON.parse(storedUser);
                this.updateUI();
            }
        } catch (e) {
            console.log('Auth init:', e);
        }
    },

    /**
     * Get current user - returns user object or null
     */
    getUser: function() {
        if (this.userProfile) {
            return this.userProfile;
        }
        // Try localStorage
        try {
            var storedUser = localStorage.getItem('margaUser');
            if (storedUser) {
                this.userProfile = JSON.parse(storedUser);
                return this.userProfile;
            }
        } catch (e) {}
        // Return default viewer for demo
        return { name: 'Guest', role: 'viewer', email: 'guest@marga.com' };
    },

    /**
     * Check if user has access to a module
     */
    hasAccess: function(module) {
        var user = this.getUser();
        if (!user) return false;
        var role = this.roles[user.role];
        if (!role) return true; // Default allow if role not found
        return role.permissions.includes(module);
    },

    /**
     * Require authentication - returns true if logged in
     */
    requireAuth: function() {
        var user = this.getUser();
        if (!user) {
            // For demo, don't redirect
            return false;
        }
        return true;
    },

    /**
     * Check if user has permission for a module
     */
    hasPermission: function(module) {
        return this.hasAccess(module);
    },

    /**
     * Login with email and password
     */
    login: async function(email, password) {
        try {
            if (typeof firebase !== 'undefined') {
                var result = await firebase.auth().signInWithEmailAndPassword(email, password);
                return { success: true, user: result.user };
            }
            return { success: false, error: 'Firebase not available' };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: this.getErrorMessage(error.code) };
        }
    },

    /**
     * Logout
     */
    logout: async function() {
        try {
            localStorage.removeItem('margaUser');
            this.userProfile = null;
            this.currentUser = null;
            if (typeof firebase !== 'undefined') {
                await firebase.auth().signOut();
            }
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
            window.location.href = 'login.html';
        }
    },

    /**
     * Check if user can perform actions
     */
    canCreate: function() {
        var user = this.getUser();
        if (!user) return false;
        var role = this.roles[user.role];
        return role ? role.canCreate : false;
    },

    canEdit: function() {
        var user = this.getUser();
        if (!user) return false;
        var role = this.roles[user.role];
        return role ? role.canEdit : false;
    },

    canDelete: function() {
        var user = this.getUser();
        if (!user) return false;
        var role = this.roles[user.role];
        return role ? role.canDelete : false;
    },

    /**
     * Check if user is admin
     */
    isAdmin: function() {
        var user = this.getUser();
        return user && user.role === 'admin';
    },

    /**
     * Update UI based on user role
     */
    updateUI: function() {
        var user = this.getUser();
        if (!user) return;
        
        // Update user display
        var userNameEl = document.getElementById('userName');
        var userRoleEl = document.getElementById('userRole');
        var userAvatarEl = document.getElementById('userAvatar');
        
        if (userNameEl) userNameEl.textContent = user.name || user.displayName || user.email || 'User';
        if (userRoleEl) {
            var role = this.roles[user.role];
            userRoleEl.textContent = role ? role.name : 'User';
        }
        if (userAvatarEl) {
            var name = user.name || user.displayName || user.email || 'U';
            userAvatarEl.textContent = name.charAt(0).toUpperCase();
        }
    },

    /**
     * Get friendly error message
     */
    getErrorMessage: function(code) {
        var messages = {
            'auth/user-not-found': 'No account found with this email.',
            'auth/wrong-password': 'Incorrect password.',
            'auth/invalid-email': 'Invalid email address.',
            'auth/user-disabled': 'This account has been disabled.',
            'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
            'auth/network-request-failed': 'Network error. Please check your connection.',
            'auth/invalid-credential': 'Invalid email or password.'
        };
        return messages[code] || 'An error occurred. Please try again.';
    }
};

// Export for use in other modules
window.MargaAuth = MargaAuth;
