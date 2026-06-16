const MargaExpenseRequestCatalog = (() => {
    const GROUPS = [
        { id: 'field_parts', label: 'Printer Parts - Inkjet', accountId: 'printer_repair_parts_field_expense', category: 'Parts / supplies' },
        { id: 'workshop_parts', label: 'Printer Parts - Laser', accountId: 'printer_repair_parts_workshop_expense', category: 'Parts / supplies' },
        { id: 'copier_parts_color', label: 'Copier Parts - Color', accountId: 'printer_repair_parts_field_expense', category: 'Parts / supplies' },
        { id: 'copier_parts_bw', label: 'Copier Parts - Monochrome B&W', accountId: 'printer_repair_parts_field_expense', category: 'Parts / supplies' },
        { id: 'toner', label: 'Toner', accountId: 'toner_expense', category: 'Toner / ink' },
        { id: 'ink', label: 'Ink', accountId: 'ink_expense', category: 'Toner / ink' },
        { id: 'gasoline', label: 'Gasoline', accountId: '', category: 'Gasoline / fuel' },
        { id: 'diesel', label: 'Diesel', accountId: '', category: 'Gasoline / fuel' },
        { id: 'commute_fare', label: 'Commute Fare', accountId: 'commute_fare_expense', category: 'Transportation / fare' },
        { id: 'parking', label: 'Parking', accountId: 'parking_expense', category: 'Parking' },
        { id: 'meal_allowance', label: 'Meal Allowance', accountId: 'meal_allowance_expense_field_operations', category: 'Meal allowance' },
        { id: 'bible_study_snacks', label: 'Bible Study Snacks', accountId: 'staff_welfare_snacks_expense', category: 'Other' },
        { id: 'owner_withdrawal', label: "Owner's Withdrawal", accountId: 'owners_drawings', category: 'Other' },
        { id: 'office_supplies', label: 'Office Supplies', accountId: 'office_supplies_expense', category: 'Office supplies' },
        { id: 'other_materials', label: 'Other Materials', accountId: 'other_materials_expense', category: 'Emergency purchase' },
        { id: 'other', label: 'Other Expense', accountId: '', category: 'Other' }
    ];

    const HIDDEN_ACCOUNT_IDS = new Set([
        'fuel_delivery_expense',
        'gasoline_expense',
        'diesel_expense',
        'petty_cash_fund'
    ]);

    const FUEL_ACCOUNT_IDS = new Set(['fuel_expense_delivery_van', 'fuel_expense_motorcycle']);

    const GROUP_ALIASES = {
        fuel: 'gasoline',
        meal: 'meal_allowance',
        toll: 'commute_fare',
        fare: 'commute_fare',
        delivery: 'commute_fare',
        parts: 'field_parts',
        emergency: 'other_materials'
    };

    const PURCHASE_GROUP_IDS = new Set([
        'field_parts',
        'workshop_parts',
        'copier_parts_color',
        'copier_parts_bw',
        'toner',
        'ink',
        'other_materials',
        'office_supplies'
    ]);

    const REGULAR_EXPENSE_GROUP_IDS = new Set([
        'gasoline',
        'diesel',
        'commute_fare',
        'parking',
        'meal_allowance',
        'bible_study_snacks'
    ]);

    const MODEL_APPLICABLE_GROUP_IDS = new Set([
        'field_parts',
        'workshop_parts',
        'copier_parts_color',
        'copier_parts_bw',
        'toner',
        'ink'
    ]);

    const PROTECTED_PART_NOTE_GROUP_IDS = new Set([
        'field_parts',
        'workshop_parts',
        'copier_parts_color',
        'copier_parts_bw',
        'toner',
        'ink'
    ]);

    const LASER_PART_NOTES = [
        'Drum',
        'PCR',
        'Cleaning blade',
        'Wiper blade',
        'Empty cartridge',
        'Fuser film',
        'Heating element',
        'Thermistor',
        'Grease',
        'Pick up roller',
        'Feed roller',
        'ADF pickup roller',
        'ADF feed roller',
        'Separation pad',
        'Main board',
        'Paper tray',
        'Output tray'
    ];

    const INKJET_PART_NOTES = [
        'CISS kit',
        'Print head',
        'Feed roller',
        'Pickup roller',
        'ADF feed roller',
        'ADF pickup roller',
        'Output tray',
        'Paper tray',
        'PCV board',
        'Coding strip',
        'Main board'
    ];

    const TONER_PRODUCT_NOTES = [
        'Black powder 250gm',
        'Black powder 500gm',
        'Black powder 1kg',
        'Cyan powder 250gm',
        'Cyan powder 500gm',
        'Cyan powder 1kg',
        'Magenta powder 250gm',
        'Magenta powder 500gm',
        'Magenta powder 1kg',
        'Yellow powder 250gm',
        'Yellow powder 500gm',
        'Yellow powder 1kg'
    ];

    const INK_PRODUCT_NOTES = [
        'Black Ink 75ml',
        'Black ink 100ml',
        'Black ink 120ml',
        'Black ink 1L',
        'Cyan Ink 75ml',
        'Cyan ink 100ml',
        'Cyan ink 120ml',
        'Cyan ink 1L',
        'Magenta Ink 75ml',
        'Magenta ink 100ml',
        'Magenta ink 120ml',
        'Magenta ink 1L',
        'Yellow Ink 75ml',
        'Yellow ink 100ml',
        'Yellow ink 120ml',
        'Yellow ink 1L'
    ];

    const PART_NOTE_OPTIONS = {
        field_parts: INKJET_PART_NOTES,
        workshop_parts: LASER_PART_NOTES,
        copier_parts_color: LASER_PART_NOTES,
        copier_parts_bw: LASER_PART_NOTES,
        toner: TONER_PRODUCT_NOTES,
        ink: INK_PRODUCT_NOTES
    };

    let modelOptions = [];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function resolveGroupId(groupId) {
        const normalized = String(groupId || '').trim();
        return GROUP_ALIASES[normalized] || normalized;
    }

    function getGroups() {
        return clone(GROUPS);
    }

    function getCategories() {
        return [...new Set(GROUPS.map((group) => group.category).filter(Boolean))];
    }

    function getGroupById(groupId) {
        const resolved = resolveGroupId(groupId);
        return getGroups().find((group) => group.id === resolved) || null;
    }

    function getGroupLabel(groupId) {
        return getGroupById(groupId)?.label || String(groupId || '').trim();
    }

    function getDefaultAccountForGroup(groupId) {
        return getGroupById(groupId)?.accountId || '';
    }

    function getStoredFinanceAccounts() {
        return (window.MargaFinanceAccounts?.getStoredAccounts?.() || [])
            .filter((account) => account.scope === 'shared' || account.scope === 'pettycash')
            .filter((account) => !HIDDEN_ACCOUNT_IDS.has(String(account.id || '').trim()));
    }

    function getRawAccountsForGroup(groupId) {
        const normalized = resolveGroupId(groupId);
        const selectable = getStoredFinanceAccounts();
        if (normalized === 'gasoline' || normalized === 'diesel') {
            return selectable.filter((account) => FUEL_ACCOUNT_IDS.has(String(account.id || '').trim()));
        }
        const defaultAccountId = getDefaultAccountForGroup(normalized);
        if (defaultAccountId) {
            return selectable.filter((account) => String(account.id || '').trim() === defaultAccountId);
        }
        return selectable;
    }

    function getAccounts() {
        return getRawAccountsForGroup('')
            .slice()
            .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
            .map((account) => ({
                id: String(account.id || '').trim(),
                label: String(account.name || '').trim(),
                type: String(account.type || '').trim(),
                scope: String(account.scope || '').trim()
            }));
    }

    function getAccountsForGroup(groupId) {
        return getRawAccountsForGroup(groupId)
            .slice()
            .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
            .map((account) => ({
                id: String(account.id || '').trim(),
                label: String(account.name || '').trim(),
                type: String(account.type || '').trim(),
                scope: String(account.scope || '').trim()
            }));
    }

    function getAccountById(accountId) {
        const normalized = String(accountId || '').trim();
        const account = getStoredFinanceAccounts().find((entry) => String(entry.id || '').trim() === normalized);
        if (!account) return null;
        return {
            id: normalized,
            label: String(account.name || '').trim(),
            type: String(account.type || '').trim(),
            scope: String(account.scope || '').trim()
        };
    }

    function isAccountAllowedForGroup(accountId, groupId) {
        const normalizedAccountId = String(accountId || '').trim();
        if (!normalizedAccountId) return false;
        return getRawAccountsForGroup(groupId).some((account) => String(account.id || '').trim() === normalizedAccountId);
    }

    function inferGroupFromAccount(accountId) {
        const normalized = String(accountId || '').trim();
        const direct = GROUPS.find((group) => group.accountId === normalized);
        if (direct) return direct.id;
        if (normalized === 'fuel_expense_delivery_van' || normalized === 'fuel_expense_motorcycle' || normalized === 'fuel_delivery_expense' || normalized === 'gasoline_expense') {
            return 'gasoline';
        }
        if (normalized === 'diesel_expense') return 'diesel';
        if (normalized === 'parking_expense') return 'parking';
        if (normalized === 'owners_drawings') return 'owner_withdrawal';
        return '';
    }

    function buildGroupOptionsHtml(selectedValue = '', includeBlank = false) {
        const selected = resolveGroupId(selectedValue);
        const blank = includeBlank ? `<option value="">Select item group</option>` : '';
        const options = GROUPS.map((group) => `
            <option value="${escapeHtml(group.id)}"${group.id === selected ? ' selected' : ''}>${escapeHtml(group.label)}</option>
        `).join('');
        return `${blank}${options}`;
    }

    function buildAccountOptionsHtml(selectedValue = '', groupId = '', includeBlank = true) {
        const options = getAccountsForGroup(groupId)
            .map((account) => `
                <option value="${escapeHtml(account.id)}"${account.id === selectedValue ? ' selected' : ''}>${escapeHtml(account.label)}${account.type ? ` (${escapeHtml(account.type)})` : ''}</option>
            `)
            .join('');
        return `${includeBlank ? '<option value="">Select account</option>' : ''}${options}`;
    }

    function isPurchaseGroup(groupId) {
        return PURCHASE_GROUP_IDS.has(resolveGroupId(groupId));
    }

    function isRegularExpenseGroup(groupId) {
        return REGULAR_EXPENSE_GROUP_IDS.has(resolveGroupId(groupId));
    }

    function classifySpendKind(groupId) {
        const resolved = resolveGroupId(groupId);
        if (PURCHASE_GROUP_IDS.has(resolved)) return 'purchase';
        if (REGULAR_EXPENSE_GROUP_IDS.has(resolved)) return 'regular';
        return 'other';
    }

    function getPurchaseGroupIds() {
        return [...PURCHASE_GROUP_IDS];
    }

    function getRegularExpenseGroupIds() {
        return [...REGULAR_EXPENSE_GROUP_IDS];
    }

    function isModelApplicable(groupId) {
        return MODEL_APPLICABLE_GROUP_IDS.has(resolveGroupId(groupId));
    }

    function isProtectedPartNoteGroup(groupId) {
        return PROTECTED_PART_NOTE_GROUP_IDS.has(resolveGroupId(groupId));
    }

    function getPartNoteOptions(groupId) {
        const resolved = resolveGroupId(groupId);
        return [...(PART_NOTE_OPTIONS[resolved] || [])];
    }

    function setModelOptions(models = []) {
        modelOptions = [...new Set(
            (Array.isArray(models) ? models : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        )].sort((left, right) => left.localeCompare(right));
    }

    function getModelOptions() {
        return [...modelOptions];
    }

    function formatModelLabel(row = {}) {
        const name = String(row.modelname || row.model_name || row.name || row.description || '').trim();
        const brand = String(row.brandname || row.brand_name || '').trim();
        if (name && brand) return `${brand} ${name}`.trim();
        return name || brand || String(row.id || '').trim();
    }

    async function loadModelOptions(fetcher) {
        try {
            const rows = typeof fetcher === 'function'
                ? await fetcher()
                : await (window.MargaUtils?.fetchCollection?.('tbl_model', 5000) || Promise.resolve([]));
            setModelOptions((rows || []).map(formatModelLabel).filter(Boolean));
        } catch (error) {
            console.warn('Unable to load expense model options:', error);
            setModelOptions([]);
        }
        return getModelOptions();
    }

    function normalizeLineItem(item = {}) {
        const groupId = resolveGroupId(item.expenseGroup || item.groupId || '');
        const quantity = Math.max(0, Number(item.quantity || 1) || 1);
        const model = String(item.model || item.modelLabel || '').trim();
        const modelId = String(item.modelId || '').trim();
        const normalizedModel = isModelApplicable(groupId) ? model : 'NA';
        return {
            expenseGroup: groupId,
            groupId,
            accountId: String(item.accountId || getDefaultAccountForGroup(groupId) || '').trim(),
            quantity,
            model: normalizedModel || (isModelApplicable(groupId) ? '' : 'NA'),
            modelId: isModelApplicable(groupId) ? modelId : '',
            itemNote: String(item.itemNote || '').trim(),
            supplier: String(item.supplier || item.supplierStoreName || '').trim(),
            amount: Number(item.amount || 0)
        };
    }

    return {
        getGroups,
        getCategories,
        getGroupById,
        getGroupLabel,
        resolveGroupId,
        getDefaultAccountForGroup,
        getAccounts,
        getAccountsForGroup,
        getRawAccountsForGroup,
        getAccountById,
        isAccountAllowedForGroup,
        inferGroupFromAccount,
        buildGroupOptionsHtml,
        buildAccountOptionsHtml,
        isPurchaseGroup,
        isRegularExpenseGroup,
        classifySpendKind,
        getPurchaseGroupIds,
        getRegularExpenseGroupIds,
        isModelApplicable,
        isProtectedPartNoteGroup,
        getPartNoteOptions,
        setModelOptions,
        getModelOptions,
        formatModelLabel,
        loadModelOptions,
        normalizeLineItem
    };
})();

window.MargaExpenseRequestCatalog = MargaExpenseRequestCatalog;
