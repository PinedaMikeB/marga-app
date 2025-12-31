/**
 * MARGA Authentication & Authorization System
 * Handles user login, role-based access control, and route protection
 */

const MargaAuth = {
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
            permissions: ['dashboard', 'reports'],
            canCreate: false,
            canEdit: false,
            canDelete: false
        }
    },

    /**
     * Initialize authentication
     */
    init: async function() {
        // Check if Firebase is initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        
        // Listen for auth state changes
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                await this.loadUserProfile(user.uid);
                this.updateUI();
            } else {
                this.currentUser = null;
                this.userProfile = null;
                this.redirectToLogin();
            }
        });
    },

    /**
     * Load user profile from Firestore
     */
    loadUserProfile: async function(uid) {
        try {
            const db = firebase.firestore();
            const doc = await db.collection('tbl_users').doc(uid).get();
            
            if (doc.exists) {
                this.userProfile = doc.data();
                
                // Check if user is active
                if (this.userProfile.status !== 'active') {
                    await this.logout();
                    alert('Your account has been deactivated. Please contact administrator.');
                    return;
                }
                
                // Update last login
                await db.collection('tbl_users').doc(uid).update({
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // User exists in Auth but not in Firestore - create profile
                console.warn('User profile not found, creating default profile');
                await this.createUserProfile(uid, this.currentUser.email);
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    },

    /**
     * Create user profile in Firestore
     */
    createUserProfile: async function(uid, email, role = 'viewer') {
        const db = firebase.firestore();
        const profile = {
            uid: uid,
            email: email,
            displayName: email.split('@')[0],
            role: role,
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('tbl_users').doc(uid).set(profile);
        this.userProfile = profile;
    },

    /**
     * Login with email and password
     */
    login: async function(email, password) {
        try {
            const result = await firebase.auth().signInWithEmailAndPassword(email, password);
            return { success: true, user: result.user };
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
            await firebase.auth().signOut();
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    },

    /**
     * Check if user has permission for a module
     */
    hasPermission: function(module) {
        if (!this.userProfile) return false;
        const role = this.roles[this.userProfile.role];
        if (!role) return false;
        return role.permissions.includes(module);
    },

    /**
     * Check if user can perform action
     */
    canCreate: function() {
        if (!this.userProfile) return false;
        const role = this.roles[this.userProfile.role];
        return role ? role.canCreate : false;
    },

    canEdit: function() {
        if (!this.userProfile) return false;
        const role = this.roles[this.userProfile.role];
        return role ? role.canEdit : false;
    },

    canDelete: function() {
        if (!this.userProfile) return false;
        const role = this.roles[this.userProfile.role];
        return role ? role.canDelete : false;
    },

    /**
     * Check if user is admin
     */
    isAdmin: function() {
        return this.userProfile?.role === 'admin';
    },

    /**
     * Redirect to login if not authenticated
     */
    redirectToLogin: function() {
        const currentPage = window.location.pathname;
        const publicPages = ['/login.html', '/index.html', '/', '/forgot-password.html'];
        
        if (!publicPages.includes(currentPage)) {
            window.location.href = '/login.html?redirect=' + encodeURIComponent(currentPage);
        }
    },

    /**
     * Protect a page - call this on page load
     */
    protectPage: function(requiredModule = null) {
        if (!this.currentUser) {
            this.redirectToLogin();
            return false;
        }
        
        if (requiredModule && !this.hasPermission(requiredModule)) {
            alert('You do not have permission to access this page.');
            window.location.href = '/dashboard.html';
            return false;
        }
        
        return true;
    },

    /**
     * Update UI based on user role
     */
    updateUI: function() {
        // Update user display in sidebar
        const userNameEl = document.querySelector('.user-name');
        const userRoleEl = document.querySelector('.user-role');
        const userAvatarEl = document.querySelector('.user-avatar');
        
        if (userNameEl) {
            userNameEl.textContent = this.userProfile?.displayName || this.currentUser?.email || 'User';
        }
        if (userRoleEl) {
            const role = this.roles[this.userProfile?.role];
            userRoleEl.textContent = role?.name || 'User';
        }
        if (userAvatarEl) {
            const initials = (this.userProfile?.displayName || this.currentUser?.email || 'U')[0].toUpperCase();
            userAvatarEl.textContent = initials;
        }
        
        // Hide/show sidebar items based on permissions
        this.updateSidebar();
        
        // Hide/show action buttons based on permissions
        this.updateActionButtons();
    },

    /**
     * Update sidebar visibility based on role
     */
    updateSidebar: function() {
        const moduleMap = {
            'dashboard': ['dashboard.html'],
            'customers': ['customers.html'],
            'billing': ['billing.html', 'billing'],
            'collections': ['collections.html', 'collections'],
            'service': ['service.html', 'service'],
            'inventory': ['inventory.html', 'inventory'],
            'reports': ['reports.html', 'reports'],
            'settings': ['settings.html', 'settings'],
            'users': ['users.html', 'users']
        };
        
        document.querySelectorAll('.nav-link').forEach(link => {
            const href = link.getAttribute('href') || '';
            let hasAccess = false;
            
            for (const [module, pages] of Object.entries(moduleMap)) {
                if (pages.some(page => href.includes(page))) {
                    hasAccess = this.hasPermission(module);
                    break;
                }
            }
            
            // Dashboard is always visible
            if (href.includes('dashboard')) {
                hasAccess = true;
            }
            
            // Hide link if no access
            const navItem = link.closest('.nav-item') || link.parentElement;
            if (navItem) {
                navItem.style.display = hasAccess ? '' : 'none';
            }
        });
    },

    /**
     * Update action buttons based on permissions
     */
    updateActionButtons: function() {
        // Hide create buttons if can't create
        if (!this.canCreate()) {
            document.querySelectorAll('[data-action="create"], .btn-create, .btn-add').forEach(btn => {
                btn.style.display = 'none';
            });
        }
        
        // Hide edit buttons if can't edit
        if (!this.canEdit()) {
            document.querySelectorAll('[data-action="edit"], .btn-edit').forEach(btn => {
                btn.style.display = 'none';
            });
        }
        
        // Hide delete buttons if can't delete
        if (!this.canDelete()) {
            document.querySelectorAll('[data-action="delete"], .btn-delete').forEach(btn => {
                btn.style.display = 'none';
            });
        }
    },

    /**
     * Get friendly error message
     */
    getErrorMessage: function(code) {
        const messages = {
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
