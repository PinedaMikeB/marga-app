const MargaExpenseSupplierOptions = (() => {
    const FALLBACK_OPTIONS = [
        'Michael Pineda',
        'Mike Pineda',
        'Petty Cash Manager',
        'Accounting',
        'Messenger Team',
        'Admin Office',
        'Lazada',
        'Shopee',
        'Globe Telecom',
        'Converge',
        'Phoenix Fuel Station',
        'Ace Hardware',
        'Mercury Drug',
        'Grab',
        'Taxi Fare',
        'Tricycle Fare'
    ];

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatSupplierName(supplier) {
        if (!supplier || typeof supplier !== 'object') return '';
        return String(
            supplier.supplier
            || supplier.supplier_name
            || supplier.vendor
            || supplier.vendor_name
            || supplier.name
            || supplier.company
            || supplier.companyname
            || ''
        ).trim();
    }

    function addApdPayeeNames(names) {
        try {
            const apdRaw = localStorage.getItem('marga_apd_bills_v1');
            if (!apdRaw) return;
            const bills = JSON.parse(apdRaw);
            if (!Array.isArray(bills)) return;
            bills.forEach((bill) => {
                const payee = String(bill?.payee || '').trim();
                if (payee) names.add(payee);
            });
        } catch (error) {
            console.warn('Unable to read APD payees for supplier dropdown:', error);
        }
    }

    async function loadSupplierNames({ runQuery, parseFirestoreDoc, extraNames = [] } = {}) {
        const names = new Set(FALLBACK_OPTIONS);
        extraNames.forEach((name) => {
            const normalized = String(name || '').trim();
            if (normalized) names.add(normalized);
        });
        addApdPayeeNames(names);

        if (typeof runQuery === 'function' && typeof parseFirestoreDoc === 'function') {
            try {
                const docs = await runQuery({
                    from: [{ collectionId: 'tbl_supplier' }],
                    orderBy: [{ field: { fieldPath: 'id' }, direction: 'ASCENDING' }],
                    limit: 5000
                });
                docs.forEach((doc) => {
                    const row = parseFirestoreDoc(doc);
                    const name = formatSupplierName(row);
                    if (name && name.toUpperCase() !== 'N/A') names.add(name);
                });
            } catch (error) {
                console.warn('Unable to load tbl_supplier for supplier dropdown:', error);
                try {
                    const cachedRows = await MargaUtils.fetchCollection('tbl_supplier', 5000);
                    cachedRows.forEach((row) => {
                        const name = formatSupplierName(row);
                        if (name && name.toUpperCase() !== 'N/A') names.add(name);
                    });
                } catch (cacheError) {
                    console.warn('Supplier dropdown cache fallback failed:', cacheError);
                }
            }
        }

        return [...names]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
    }

    function fillDatalist(elementId, names = []) {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.innerHTML = names
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join('');
    }

    async function loadAndFillDatalist(elementId, deps = {}) {
        const names = await loadSupplierNames(deps);
        fillDatalist(elementId, names);
        return names;
    }

    return {
        FALLBACK_OPTIONS,
        formatSupplierName,
        loadSupplierNames,
        fillDatalist,
        loadAndFillDatalist
    };
})();

window.MargaExpenseSupplierOptions = MargaExpenseSupplierOptions;
