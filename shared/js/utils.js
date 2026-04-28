/**
 * MARGA Enterprise Management System
 * Utility Functions - Shared across all modules
 */

const MargaUtils = {
    OFFLINE_CACHE_PREFIX: 'marga_firestore_cache_v1:',
    OFFLINE_CACHEABLE_COLLECTIONS: new Set([
        'tbl_supplier',
        'tbl_employee',
        'tbl_inventoryparts',
        'tbl_partstype',
        'tbl_tonerink',
        'tbl_model',
        'tbl_brand',
        'tbl_machine',
        'tbl_newmachinestatus',
        'marga_production_queue',
        'tbl_ownership',
        'tbl_branchinfo',
        'tbl_companylist',
        'tbl_pettycash_entries',
        'tbl_pettycash_requests',
        'tbl_pettycash_settings'
    ]),

    /**
     * Parse Firestore document to regular object
     */
    parseFirestoreDoc(doc) {
        const fields = doc.fields || {};
        const result = {};
        
        for (const [key, value] of Object.entries(fields)) {
            if (value.stringValue !== undefined) {
                result[key] = value.stringValue;
            } else if (value.integerValue !== undefined) {
                result[key] = parseInt(value.integerValue);
            } else if (value.doubleValue !== undefined) {
                result[key] = parseFloat(value.doubleValue);
            } else if (value.booleanValue !== undefined) {
                result[key] = value.booleanValue;
            } else if (value.nullValue !== undefined) {
                result[key] = null;
            } else if (value.timestampValue !== undefined) {
                result[key] = new Date(value.timestampValue);
            } else if (value.arrayValue !== undefined) {
                const values = value.arrayValue?.values || [];
                result[key] = values.map((entry) => this.parseFirestoreScalar(entry)).filter((entry) => entry !== null && entry !== undefined);
            } else if (value.mapValue !== undefined) {
                const mapped = {};
                Object.entries(value.mapValue?.fields || {}).forEach(([mapKey, mapValue]) => {
                    mapped[mapKey] = this.parseFirestoreScalar(mapValue);
                });
                result[key] = mapped;
            } else {
                result[key] = null;
            }
        }
        
        if (doc.name) {
            result._docId = doc.name.split('/').pop();
        }
        
        return result;
    },

    parseFirestoreScalar(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
        if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.nullValue !== undefined) return null;
        if (value.timestampValue !== undefined) return new Date(value.timestampValue);
        if (value.arrayValue !== undefined) {
            return (value.arrayValue?.values || []).map((entry) => this.parseFirestoreScalar(entry)).filter((entry) => entry !== null && entry !== undefined);
        }
        if (value.mapValue !== undefined) {
            const mapped = {};
            Object.entries(value.mapValue?.fields || {}).forEach(([key, child]) => {
                mapped[key] = this.parseFirestoreScalar(child);
            });
            return mapped;
        }
        return null;
    },

    async fetchDoc(collection, docId) {
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return payload?.fields ? this.parseFirestoreDoc(payload) : null;
    },

    normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    },

    async fetchActiveEmployeeRoster() {
        if (this.activeEmployeeRosterPromise) return this.activeEmployeeRosterPromise;
        this.activeEmployeeRosterPromise = this.fetchDoc('tbl_app_settings', 'active_employee_roster_v1')
            .then((doc) => new Set((doc?.active_emails || []).map((email) => this.normalizeEmail(email)).filter(Boolean)))
            .catch((error) => {
                console.warn('Unable to load active employee roster.', error);
                return new Set();
            });
        return this.activeEmployeeRosterPromise;
    },

    getEmployeeId(employee) {
        return String(employee?.id || employee?._docId || '').trim();
    },

    getEmployeeFullName(employee, fallbackId = '') {
        if (!employee) return fallbackId ? `ID ${fallbackId}` : '';
        const first = String(employee.firstname || '').trim();
        const last = String(employee.lastname || '').trim();
        const fullName = `${first} ${last}`.trim();
        return fullName
            || String(employee.name || employee.marga_fullname || employee.fullname || employee.nickname || '').trim()
            || (fallbackId ? `ID ${fallbackId}` : '');
    },

    getEmployeeDesignation(employee, positions = null) {
        if (!employee) return 'Staff';
        const position = positions?.get?.(String(employee.position_id || '')) || null;
        const label = [
            position?.position,
            position?.position_name,
            position?.name,
            employee.position,
            employee.position_name,
            employee.position_label
        ].map((value) => String(value || '').trim()).filter(Boolean)[0];
        if (label) return label;
        const roleLabel = [
            employee.marga_role,
            ...(Array.isArray(employee.marga_roles) ? employee.marga_roles : [])
        ].map((value) => String(value || '').trim()).filter(Boolean)[0];
        return roleLabel ? this.titleCase(roleLabel.replace(/[-_]+/g, ' ')) : 'Staff';
    },

    getEmployeeRoleKey(employee, positions = null) {
        const designation = this.getEmployeeDesignation(employee, positions).toLowerCase();
        const roleText = [
            designation,
            employee?.marga_role,
            ...(Array.isArray(employee?.marga_roles) ? employee.marga_roles : [])
        ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
        const positionId = Number(employee?.position_id || 0);
        if (positionId === 5 || roleText.includes('technician') || roleText.includes('tech')) return 'technician';
        if (positionId === 9 || roleText.includes('messenger')) return 'messenger';
        if (roleText.includes('driver')) return 'driver';
        if (roleText.includes('production') || roleText.includes('prod')) return 'production';
        if (roleText.includes('billing')) return 'billing';
        if (roleText.includes('collection')) return 'collection';
        if (roleText.includes('service') || roleText.includes('csr')) return 'service';
        if (roleText.includes('admin') || roleText.includes('manager') || roleText.includes('head')) return 'admin';
        return 'staff';
    },

    isOfficialActiveEmployee(employee) {
        return Boolean(employee) && employee.marga_active !== false && Number(employee.id || employee._docId || 0) > 0;
    },

    makeEmployeeAssignmentOption(employee, positions = null) {
        const id = this.getEmployeeId(employee);
        const designation = this.getEmployeeDesignation(employee, positions);
        const name = this.getEmployeeFullName(employee, id);
        return {
            id,
            name,
            designation,
            role: designation,
            roleKey: this.getEmployeeRoleKey(employee, positions),
            email: this.normalizeEmail(employee?.email || employee?.marga_login_email || ''),
            username: this.normalizeEmail(employee?.username || ''),
            label: `${name} - ${designation}`
        };
    },

    filterEmployeeAssignmentOptions(employees = [], options = {}) {
        const positions = options.positions || null;
        const includeRoleKeys = new Set((options.includeRoleKeys || []).map((role) => String(role || '').toLowerCase()));
        return employees
            .filter((employee) => this.isOfficialActiveEmployee(employee))
            .map((employee) => this.makeEmployeeAssignmentOption(employee, positions))
            .filter((employee) => employee.id && employee.name)
            .filter((employee) => !includeRoleKeys.size || includeRoleKeys.has(employee.roleKey))
            .sort((left, right) => (
                left.name.localeCompare(right.name) ||
                left.designation.localeCompare(right.designation) ||
                left.id.localeCompare(right.id)
            ));
    },

    titleCase(value) {
        return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
    },

    /**
     * Fetch collection from Firestore with pagination
     */
    async fetchCollection(collection, pageSize = 300) {
        const allDocs = [];
        let pageToken = null;

        try {
            do {
                let url = `${FIREBASE_CONFIG.baseUrl}/${collection}?pageSize=${pageSize}&key=${FIREBASE_CONFIG.apiKey}`;
                if (pageToken) url += `&pageToken=${pageToken}`;

                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                if (data.documents) {
                    allDocs.push(...data.documents.map(doc => this.parseFirestoreDoc(doc)));
                }
                pageToken = data.nextPageToken;
            } while (pageToken);

            const mergedRows = this.mergePendingOfflineRows(collection, allDocs);
            this.writeCollectionCache(collection, mergedRows);
            return mergedRows;
        } catch (error) {
            const cachedRows = this.readCollectionCache(collection);
            if (cachedRows.length) {
                console.warn(`Using cached ${collection} rows while offline or unreachable.`, error);
                return this.mergePendingOfflineRows(collection, cachedRows);
            }
            throw error;
        }
    },

    getCollectionCacheKey(collection) {
        return `${this.OFFLINE_CACHE_PREFIX}${collection}`;
    },

    shouldCacheCollection(collection) {
        return this.OFFLINE_CACHEABLE_COLLECTIONS.has(String(collection || '').trim());
    },

    readCollectionCache(collection) {
        if (!this.shouldCacheCollection(collection)) return [];
        try {
            const raw = localStorage.getItem(this.getCollectionCacheKey(collection));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn(`Unable to read offline cache for ${collection}.`, error);
            return [];
        }
    },

    writeCollectionCache(collection, rows) {
        if (!this.shouldCacheCollection(collection)) return;
        try {
            const safeRows = Array.isArray(rows) ? rows : [];
            const payload = JSON.stringify(safeRows);
            if (payload.length > 3_500_000) return;
            localStorage.setItem(this.getCollectionCacheKey(collection), payload);
        } catch (error) {
            console.warn(`Unable to write offline cache for ${collection}.`, error);
        }
    },

    mergePendingOfflineRows(collection, rows) {
        if (!window.MargaOfflineSync?.mergePendingCollectionRows) return Array.isArray(rows) ? rows : [];
        return window.MargaOfflineSync.mergePendingCollectionRows(collection, rows);
    },

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num?.toLocaleString() || '0';
    },

    /**
     * Format currency (Philippine Peso)
     */
    formatCurrency(amount) {
        return '₱' + (amount || 0).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    },

    /**
     * Format date
     */
    formatDate(date, format = 'short') {
        if (!date) return 'N/A';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'N/A';
        
        if (format === 'short') {
            return d.toLocaleDateString('en-PH');
        } else if (format === 'long') {
            return d.toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } else if (format === 'datetime') {
            return d.toLocaleString('en-PH');
        }
        return d.toLocaleDateString('en-PH');
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Debounce function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer') || this.createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span>${this.escapeHtml(message)}</span>
            <button onclick="this.parentElement.remove()">&times;</button>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => toast.remove(), duration);
    },

    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed;bottom:2rem;right:2rem;z-index:1000;display:flex;flex-direction:column;gap:0.5rem;';
        document.body.appendChild(container);
        return container;
    },

    /**
     * Animate number counting
     */
    animateNumber(element, targetValue, duration = 1000) {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        if (!element) return;

        const startTime = performance.now();
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentValue = Math.round(targetValue * easeOut);
            element.textContent = currentValue.toLocaleString();
            if (progress < 1) requestAnimationFrame(animate);
        };
        
        requestAnimationFrame(animate);
    },

    /**
     * Get URL parameter
     */
    getUrlParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    },

    /**
     * Set URL parameter without reload
     */
    setUrlParam(name, value) {
        const url = new URL(window.location);
        if (value) {
            url.searchParams.set(name, value);
        } else {
            url.searchParams.delete(name);
        }
        window.history.replaceState({}, '', url);
    }
};

// Make available globally
window.MargaUtils = MargaUtils;
