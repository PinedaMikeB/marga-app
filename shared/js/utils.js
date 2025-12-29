/**
 * MARGA Enterprise Management System
 * Utility Functions - Shared across all modules
 */

const MargaUtils = {
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
            } else {
                result[key] = null;
            }
        }
        
        if (doc.name) {
            result._docId = doc.name.split('/').pop();
        }
        
        return result;
    },

    /**
     * Fetch collection from Firestore with pagination
     */
    async fetchCollection(collection, pageSize = 300) {
        const allDocs = [];
        let pageToken = null;
        
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
        
        return allDocs;
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
