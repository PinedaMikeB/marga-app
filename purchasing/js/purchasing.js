if (!MargaAuth.requireAccess('purchasing')) {
    throw new Error('Unauthorized access to Purchasing module.');
}

const PURCHASE_REQUEST_COLLECTION = 'marga_purchase_requests';
const PURCHASING_PURPOSE_ID = 7;
const PURCHASING_DRAFT_KEY = 'marga_purchasing_draft_v2';
const ZERO_DATETIME = '0000-00-00 00:00:00';

const SCHEDULE_PURPOSE_LABELS = {
    buy_items: 'Buy Items',
    pick_up_machine: 'Pick Up Machine',
    supplier_follow_up: 'Supplier Follow-up',
    others: 'Others'
};

const purchasingState = {
    loading: false,
    requests: [],
    staffOptions: [],
    activeRequestId: '',
    lineItems: [],
    draftItem: null
};

document.addEventListener('DOMContentLoaded', () => {
    hydrateUserChrome();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindPurchasingControls();
    resetDraftItem();
    setDefaultDates();
    restoreDraftIfNeeded();
    void loadPurchasingData();
});

window.toggleSidebar = function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
};

function hydrateUserChrome() {
    const user = MargaAuth.getUser();
    if (!user) return;
    document.getElementById('userName').textContent = user.name || 'User';
    document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
    document.getElementById('userAvatar').textContent = String(user.name || 'M').charAt(0).toUpperCase();
}

function bindPurchasingControls() {
    document.getElementById('purchasingViewListBtn').addEventListener('click', () => viewSavedRequests());
    document.getElementById('purchasingRefreshBtn').addEventListener('click', () => loadPurchasingData({ force: true }));
    document.getElementById('purchasingNewBtn').addEventListener('click', () => startNewRequest());
    document.getElementById('purchasingAddLineBtn').addEventListener('click', () => addDraftItemRow());
    document.getElementById('purchasingClearBtn').addEventListener('click', () => startNewRequest({ clearDraft: true }));
    document.getElementById('purchasingRequestForm').addEventListener('submit', (event) => {
        event.preventDefault();
        savePurchaseRequest().catch(handleError);
    });
    document.getElementById('purchasingSaveScheduleBtn').addEventListener('click', () => {
        savePurchaseSchedule().catch(handleError);
    });
    document.getElementById('purchasingItemEntry')?.addEventListener('input', handleDraftEntryInput);
    document.getElementById('purchasingItemEntry')?.addEventListener('change', handleDraftEntryChange);
    document.getElementById('purchasingItemEntry')?.addEventListener('click', handleDraftEntryClick);
    document.getElementById('purchasingItemList')?.addEventListener('click', handleItemListClick);
    document.getElementById('purchasingRequestList')?.addEventListener('click', handleRequestListClick);
    ['purchasingRequestDate', 'purchasingRemarks', 'purchasingScheduleDate', 'purchasingScheduleTime', 'purchasingSchedulePurpose', 'purchasingAssignee']
        .forEach((id) => document.getElementById(id)?.addEventListener('input', persistDraft));
    document.getElementById('purchasingSchedulePurpose')?.addEventListener('change', persistDraft);
    document.getElementById('purchasingAssignee')?.addEventListener('change', persistDraft);
}

function getDefaultGroup() {
    return window.MargaExpenseRequestCatalog?.getGroupById?.('field_parts')
        || { id: 'field_parts', label: 'Printer Parts - Inkjet', accountId: 'printer_repair_parts_field_expense', category: 'Parts / supplies' };
}

function createPurchaseItem(item = {}) {
    const catalog = window.MargaExpenseRequestCatalog;
    const defaultGroup = getDefaultGroup();
    const normalized = catalog?.normalizeLineItem?.({
        ...item,
        expenseGroup: item.groupId || item.expenseGroup,
        supplier: item.supplierStoreName || item.supplier
    }) || item;
    const groupId = String(normalized.groupId || normalized.expenseGroup || item.groupId || defaultGroup.id).trim();
    const group = catalog?.getGroupById?.(groupId) || defaultGroup;
    const allowedAccounts = catalog?.getAccountsForGroup?.(group.id) || [];
    const accountId = String(item.accountId || normalized.accountId || group.accountId || allowedAccounts[0]?.id || '').trim();
    return {
        id: String(item.id || `line-${Date.now()}-${Math.floor(Math.random() * 1000)}`).trim(),
        groupId: group.id,
        expenseGroup: group.id,
        accountId,
        quantity: Math.max(1, Number(normalized.quantity || item.quantity || 1) || 1),
        model: String(normalized.model || item.model || '').trim(),
        itemNote: String(normalized.itemNote || item.itemNote || '').trim(),
        supplierStoreName: String(normalized.supplier || item.supplierStoreName || item.supplier || '').trim(),
        amount: Number(normalized.amount || item.amount || 0) || 0
    };
}

function formatPeso(value) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0) || 0);
}

function sumLineItemAmounts(items = []) {
    return items.reduce((sum, item) => sum + (Number(item.amount || 0) || 0), 0);
}

async function viewSavedRequests() {
    const panel = document.getElementById('purchasingRequestsPanel');
    if (!panel) return;
    setSaveStatus('Loading saved requests...');
    try {
        await loadPurchaseRequests();
        renderRequestList();
    } catch (error) {
        handleError(error);
        return;
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.add('is-highlight');
    window.setTimeout(() => panel.classList.remove('is-highlight'), 1600);
    if (!purchasingState.requests.length) {
        setSaveStatus('No saved requests yet.');
        return;
    }
    setSaveStatus(`${purchasingState.requests.length} saved request(s). Click Edit to change or Delete to remove.`);
}

function resetDraftItem() {
    purchasingState.draftItem = createPurchaseItem();
}

function normalizeLineItems(items = []) {
    return Array.isArray(items) ? items.map((item) => createPurchaseItem(item)) : [];
}

function setDefaultDates() {
    const today = localDateYmd();
    const requestDate = document.getElementById('purchasingRequestDate');
    const scheduleDate = document.getElementById('purchasingScheduleDate');
    if (requestDate && !requestDate.value) requestDate.value = today;
    if (scheduleDate && !scheduleDate.value) scheduleDate.value = today;
}

function localDateYmd(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function loadPurchasingData(options = {}) {
    if (purchasingState.loading && !options.force) return;
    purchasingState.loading = true;
    setSaveStatus('Loading purchase requests...');
    try {
        const results = await Promise.allSettled([
            loadSupplierDatalist(),
            window.MargaExpenseRequestCatalog?.loadModelOptions?.() || Promise.resolve(),
            loadAssignableStaff(),
            loadPurchaseRequests()
        ]);
        const requestResult = results[3];
        if (requestResult.status === 'rejected') {
            throw requestResult.reason;
        }
        renderRequestList();
        if (!purchasingState.lineItems.length && !purchasingState.activeRequestId) {
            renderItemEntry();
            renderItemList();
        }
        if (!window.MargaExpenseRequestCatalog) {
            setSaveStatus('Catalog scripts missing. Purchase list may load, but item rows cannot be encoded until admin deploys shared expense scripts.');
            return;
        }
        setSaveStatus(purchasingState.requests.length
            ? `Ready. ${purchasingState.requests.length} saved request(s).`
            : 'Ready.');
    } catch (error) {
        handleError(error);
    } finally {
        purchasingState.loading = false;
    }
}

async function loadSupplierDatalist() {
    if (!window.MargaExpenseSupplierOptions?.loadAndFillDatalist) return;
    await MargaExpenseSupplierOptions.loadAndFillDatalist('purchasingSupplierList', {
        runQuery,
        parseFirestoreDoc: MargaUtils.parseFirestoreDoc
    });
}

async function loadAssignableStaff() {
    const employees = await MargaUtils.fetchCollection('tbl_employee', 2500).catch(() => []);
    const positions = await MargaUtils.fetchCollection('tbl_empos', 500).catch(() => []);
    const positionMap = new Map(positions.map((row) => [String(row.id || ''), row]));
    const filtered = window.MargaUtils?.getActiveAssignmentEmployees
        ? MargaUtils.getActiveAssignmentEmployees(employees, { positions: positionMap })
        : employees.filter((row) => Number(row.estatus || 0) === 1);

    purchasingState.staffOptions = filtered
        .map((employee) => {
            const option = MargaUtils.makeEmployeeAssignmentOption?.(employee, positionMap);
            return {
                id: Number(employee.id || 0),
                name: option?.name || employee.name || `Staff #${employee.id}`,
                role: option?.designation || option?.role || 'Staff'
            };
        })
        .filter((staff) => staff.id > 0)
        .sort((left, right) => left.name.localeCompare(right.name));

    const select = document.getElementById('purchasingAssignee');
    if (!select) return;
    const current = select.value;
    select.innerHTML = [
        '<option value="">Select employee...</option>',
        ...purchasingState.staffOptions.map((staff) => `
            <option value="${escapeHtml(String(staff.id))}">${escapeHtml(`${staff.name} - ${staff.role}`)}</option>
        `)
    ].join('');
    if (current) select.value = current;
}

async function loadPurchaseRequests() {
    let rows = [];
    try {
        const docs = await runQuery({
            from: [{ collectionId: PURCHASE_REQUEST_COLLECTION }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'DESCENDING' }],
            limit: 500
        });
        rows = docs.map((doc) => MargaUtils.parseFirestoreDoc(doc)).filter(Boolean);
    } catch (error) {
        console.warn('Purchasing ordered query failed; using collection scan.', error);
    }
    if (!rows.length) {
        try {
            rows = await MargaUtils.fetchCollection(PURCHASE_REQUEST_COLLECTION, 500);
        } catch (error) {
            console.warn('Purchasing collection scan failed.', error);
        }
    }
    purchasingState.requests = rows
        .filter((row) => String(row.status || '').toLowerCase() !== 'deleted')
        .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
}

function renderRequestList() {
    const list = document.getElementById('purchasingRequestList');
    const count = document.getElementById('purchasingRequestCount');
    if (!list) return;
    count.textContent = String(purchasingState.requests.length);
    if (!purchasingState.requests.length) {
        list.innerHTML = '<div class="purchasing-empty">No purchase requests yet. Click New Request to start.</div>';
        return;
    }
    list.innerHTML = purchasingState.requests.map((row) => {
        const active = String(row.id || '') === String(purchasingState.activeRequestId || '');
        const status = String(row.status || 'draft').toLowerCase();
        const statusLabel = status === 'scheduled' ? 'Scheduled' : 'Draft';
        const scheduleNote = row.tbl_schedule_id
            ? `Schedule #${row.tbl_schedule_id}${row.schedule_date ? ` · ${formatShortDate(row.schedule_date)}` : ''}`
            : 'Not scheduled yet';
        const supplierHint = summarizeSuppliers(parseLineItems(row));
        const totalAmount = Number(row.total_amount || sumLineItemAmounts(parseLineItems(row)) || 0);
        const createdBy = clean(row.created_by_name || row.created_by || 'Unknown');
        return `
            <article class="purchasing-list-item${active ? ' is-active' : ''}" data-request-id="${escapeHtml(String(row.id || ''))}">
                <button type="button" class="purchasing-list-body" data-purchase-edit="${escapeHtml(String(row.id || ''))}">
                    <h4>#${escapeHtml(String(row.id || ''))} ${escapeHtml(supplierHint || 'Purchase request')} <span class="purchasing-status-pill ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></h4>
                    <div class="meta">${escapeHtml(formatShortDate(row.request_date || row.created_at))} · ${escapeHtml(scheduleNote)}${totalAmount > 0 ? ` · ${escapeHtml(formatPeso(totalAmount))}` : ''}</div>
                    <div class="meta">Saved by ${escapeHtml(createdBy)}</div>
                    <div class="summary">${escapeHtml(row.items_summary || summarizeLineItems(parseLineItems(row)))}</div>
                </button>
                <div class="purchasing-list-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-purchase-edit="${escapeHtml(String(row.id || ''))}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm purchasing-delete-btn" data-purchase-delete="${escapeHtml(String(row.id || ''))}">Delete</button>
                </div>
            </article>
        `;
    }).join('');
}

function handleRequestListClick(event) {
    const deleteBtn = event.target.closest('[data-purchase-delete]');
    if (deleteBtn) {
        event.preventDefault();
        event.stopPropagation();
        const requestId = deleteBtn.getAttribute('data-purchase-delete') || '';
        deletePurchaseRequest(requestId).catch(handleError);
        return;
    }
    const editBtn = event.target.closest('[data-purchase-edit]');
    if (!editBtn) return;
    event.preventDefault();
    const requestId = editBtn.getAttribute('data-purchase-edit') || '';
    const row = purchasingState.requests.find((item) => String(item.id || '') === requestId);
    if (!row) return;
    loadRequestIntoForm(row);
    document.getElementById('purchasingFormTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSaveStatus(`Editing purchase request #${requestId}.`);
}

function canDeletePurchaseRequest(row) {
    if (MargaAuth.isAdmin()) return true;
    const user = MargaAuth.getUser() || {};
    const creator = String(row?.created_by || '').trim().toLowerCase();
    const creatorStaffId = Number(row?.created_by_staff_id || 0);
    const identities = [
        user.email,
        user.name,
        user.username,
        user.staff_id,
        user.id
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    if (creatorStaffId > 0 && Number(user.staff_id || user.id || 0) === creatorStaffId) return true;
    return identities.some((identity) => creator && (creator === identity || creator.includes(identity)));
}

async function deletePurchaseRequest(requestId) {
    const normalizedId = String(requestId || '').trim();
    if (!normalizedId) return;
    const row = purchasingState.requests.find((item) => String(item.id || '') === normalizedId);
    if (!row) {
        alert('Purchase request not found. Refresh and try again.');
        return;
    }
    if (!canDeletePurchaseRequest(row)) {
        alert('Only admin or the request creator can delete this purchase request.');
        return;
    }
    const label = `#${normalizedId}${row.supplier ? ` · ${row.supplier}` : ''}`;
    if (!window.confirm(`Delete purchase request ${label}? This removes it from the office list.`)) return;

    const now = new Date().toISOString();
    const user = MargaAuth.getUser() || {};
    await setDocument(PURCHASE_REQUEST_COLLECTION, normalizedId, {
        ...row,
        status: 'deleted',
        deleted_at: now,
        deleted_by: clean(user.email || user.name || 'purchasing'),
        updated_at: now
    });

    const scheduleId = Number(row.tbl_schedule_id || 0);
    if (scheduleId > 0) {
        try {
            await patchDocument('tbl_schedule', String(scheduleId), {
                iscancel: 1,
                status: 0,
                remarks: `${clean(row.remarks || row.items_summary || '')} [CANCELLED - purchase request deleted]`.trim(),
                bridge_updated_at: now,
                bridge_updated_by: Number(user.staff_id || 0) || 0
            });
        } catch (error) {
            console.warn('Unable to cancel linked schedule for deleted purchase request:', error);
        }
    }

    if (String(purchasingState.activeRequestId || '') === normalizedId) {
        startNewRequest({ clearDraft: true });
    }
    await loadPurchaseRequests();
    renderRequestList();
    MargaUtils.showToast?.(`Purchase request #${normalizedId} deleted.`, 'success');
    setSaveStatus(`Deleted purchase request #${normalizedId}.`);
}

function renderItemEntry() {
    const entry = document.getElementById('purchasingItemEntry');
    if (!entry) return;
    if (!purchasingState.draftItem) resetDraftItem();
    const item = purchasingState.draftItem;
    const catalog = window.MargaExpenseRequestCatalog;
    const lineUi = window.MargaExpenseLineItemUi;
    entry.innerHTML = `
        <div class="field-reimbursement-entry-grid">
            <label><span>Item Group</span><select data-purchase-draft-field="groupId">${catalog?.buildGroupOptionsHtml?.(item.groupId) || ''}</select></label>
            <label><span>Chart Of Account</span><select data-purchase-draft-field="accountId">${catalog?.buildAccountOptionsHtml?.(item.accountId, item.groupId) || ''}</select></label>
            <label><span>Quantity</span>${lineUi?.buildDraftQuantityInputHtml?.(item.quantity) || ''}</label>
            <label data-expense-model-cell><span>Model</span>${lineUi?.buildDraftModelSelectHtml?.(item.groupId, item.model) || ''}</label>
            <label class="field-reimbursement-draft-part-note"><span>Item / Part Note</span>${lineUi?.buildDraftPartNoteHtml?.(item.groupId, item.itemNote) || ''}</label>
            <label><span>Supplier / Store</span><input type="text" data-purchase-draft-field="supplierStoreName" list="purchasingSupplierList" placeholder="Type or select supplier/store" value="${escapeHtml(item.supplierStoreName)}"></label>
            <label><span>Amount</span><input type="number" data-purchase-draft-field="amount" min="0" step="0.01" placeholder="0.00" value="${item.amount ? escapeHtml(Number(item.amount).toFixed(2)) : ''}"></label>
            <div class="field-reimbursement-entry-action"><span>Action</span><button type="button" class="btn btn-secondary btn-sm" data-purchase-draft-clear>Clear Row</button></div>
        </div>
    `;
}

function renderItemList() {
    const list = document.getElementById('purchasingItemList');
    if (!list) return;
    if (!purchasingState.lineItems.length) {
        list.innerHTML = '<div class="purchasing-empty-table">No item rows added yet.</div>';
        return;
    }
    const catalog = window.MargaExpenseRequestCatalog;
    list.innerHTML = `
        <div class="purchasing-line-table-wrap">
            <table class="purchasing-line-table">
                <thead>
                    <tr>
                        <th>Item Group</th>
                        <th>Account</th>
                        <th>Qty</th>
                        <th>Model</th>
                        <th>Item / Part Note</th>
                        <th>Supplier / Store</th>
                        <th>Amount</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${purchasingState.lineItems.map((item, index) => {
                        const group = catalog?.getGroupById?.(item.groupId);
                        const account = catalog?.getAccountById?.(item.accountId);
                        return `
                            <tr>
                                <td>${escapeHtml(group?.label || item.groupId || '-')}</td>
                                <td>${escapeHtml(account?.label || item.accountId || '-')}</td>
                                <td>${escapeHtml(String(item.quantity || 1))}</td>
                                <td>${escapeHtml(item.model || 'NA')}</td>
                                <td>${escapeHtml(item.itemNote || '-')}</td>
                                <td>${escapeHtml(item.supplierStoreName || '-')}</td>
                                <td>${escapeHtml(formatPeso(item.amount))}</td>
                                <td><button type="button" class="btn btn-secondary btn-sm" data-purchase-remove="${index}">Remove</button></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="purchasing-total-row"><span>Rows Total</span><strong>${escapeHtml(formatPeso(sumLineItemAmounts(purchasingState.lineItems)))}</strong></div>
    `;
}

function handleDraftEntryInput(event) {
    const field = event.target?.dataset?.purchaseDraftField;
    if (!field) return;
    if (!purchasingState.draftItem) resetDraftItem();
    purchasingState.draftItem[field] = field === 'quantity' || field === 'amount'
        ? Number(event.target.value || 0)
        : String(event.target.value || '').trim();
    persistDraft();
}

function handleDraftEntryChange(event) {
    const field = event.target?.dataset?.purchaseDraftField;
    if (!field) return;
    if (!purchasingState.draftItem) resetDraftItem();
    purchasingState.draftItem[field] = field === 'quantity' || field === 'amount'
        ? Number(event.target.value || 0)
        : String(event.target.value || '').trim();

    if (field === 'groupId') {
        const group = window.MargaExpenseRequestCatalog?.getGroupById?.(purchasingState.draftItem.groupId);
        if (group) {
            const allowedAccounts = window.MargaExpenseRequestCatalog?.getAccountsForGroup?.(group.id) || [];
            purchasingState.draftItem.accountId = group.accountId || allowedAccounts[0]?.id || '';
            purchasingState.draftItem.itemNote = '';
            purchasingState.draftItem.model = '';
            renderItemEntry();
        }
        persistDraft();
        return;
    }
    if (field === 'itemNote' && event.target?.classList?.contains('reimbursement-draft-note-select')) {
        window.MargaExpenseLineItemUi?.toggleManualPartNote?.(event.target.closest('.field-reimbursement-entry-grid'), 'reimbursement-draft');
    }
    persistDraft();
}

function handleDraftEntryClick(event) {
    if (!event.target.closest('[data-purchase-draft-clear]')) return;
    resetDraftItem();
    renderItemEntry();
    persistDraft();
}

function handleItemListClick(event) {
    const button = event.target.closest('[data-purchase-remove]');
    if (!button) return;
    const index = Number(button.dataset.purchaseRemove || -1);
    if (index < 0) return;
    purchasingState.lineItems = purchasingState.lineItems.filter((_, itemIndex) => itemIndex !== index);
    renderItemList();
    persistDraft();
}

function addDraftItemRow() {
    if (!purchasingState.draftItem) resetDraftItem();
    const item = createPurchaseItem(purchasingState.draftItem);
    const catalog = window.MargaExpenseRequestCatalog;
    if (!item.groupId || !item.accountId || !item.supplierStoreName || Number(item.amount || 0) <= 0) {
        alert('Each item row needs item group, chart of account, supplier/store, and amount.');
        return;
    }
    if (catalog?.isModelApplicable?.(item.groupId) && !String(item.model || '').trim()) {
        alert('Model is required for parts, toner, and ink rows.');
        return;
    }
    if (catalog?.isProtectedPartNoteGroup?.(item.groupId) && !String(item.itemNote || '').trim()) {
        alert('Select a part or product from the dropdown for this item group.');
        return;
    }
    purchasingState.lineItems.push(item);
    resetDraftItem();
    renderItemEntry();
    renderItemList();
    persistDraft();
}

function startNewRequest(options = {}) {
    purchasingState.activeRequestId = '';
    purchasingState.lineItems = [];
    document.getElementById('purchasingFormTitle').textContent = 'New Purchase Request';
    document.getElementById('purchasingRequestId').value = '';
    document.getElementById('purchasingRemarks').value = '';
    document.getElementById('purchasingSchedulePurpose').value = 'buy_items';
    document.getElementById('purchasingAssignee').value = '';
    document.getElementById('purchasingScheduleStatus').textContent = 'Save the request first, then set schedule for the field route.';
    resetDraftItem();
    setDefaultDates();
    renderItemEntry();
    renderItemList();
    setSaveStatus('Ready.');
    if (options.clearDraft) {
        localStorage.removeItem(draftStorageKey());
    } else {
        persistDraft();
    }
    renderRequestList();
}

function loadRequestIntoForm(row) {
    purchasingState.activeRequestId = String(row.id || '');
    document.getElementById('purchasingFormTitle').textContent = `Purchase Request #${row.id || ''}`;
    document.getElementById('purchasingRequestId').value = String(row.id || '');
    document.getElementById('purchasingRequestDate').value = dateOnly(row.request_date || row.created_at) || localDateYmd();
    document.getElementById('purchasingRemarks').value = String(row.remarks || '');
    purchasingState.lineItems = normalizeLineItems(parseLineItems(row));
    resetDraftItem();
    renderItemEntry();
    renderItemList();
    document.getElementById('purchasingScheduleDate').value = dateOnly(row.schedule_date || row.request_date) || localDateYmd();
    document.getElementById('purchasingScheduleTime').value = normalizeTimeInput(row.schedule_time) || '08:00';
    document.getElementById('purchasingSchedulePurpose').value = String(row.schedule_purpose || 'buy_items');
    document.getElementById('purchasingAssignee').value = String(row.assigned_staff_id || '');
    const scheduleStatus = document.getElementById('purchasingScheduleStatus');
    const purposeLabel = getSchedulePurposeLabel(row.schedule_purpose || 'buy_items');
    if (row.tbl_schedule_id) {
        scheduleStatus.textContent = `Active schedule #${row.tbl_schedule_id}${row.assigned_staff_name ? ` for ${row.assigned_staff_name}` : ''} · ${purposeLabel}. Saving again will update the same field task.`;
    } else {
        scheduleStatus.textContent = `Request saved. Set schedule date, purpose (${purposeLabel}), and assignee for the field route.`;
    }
    setSaveStatus('Loaded saved request.');
    persistDraft();
    renderRequestList();
}

function parseLineItems(row) {
    if (Array.isArray(row?.line_items)) return row.line_items;
    try {
        const parsed = JSON.parse(String(row?.line_items_json || row?.purchase_items_json || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function summarizeLineItems(items = []) {
    const catalog = window.MargaExpenseRequestCatalog;
    if (!items.length) return 'No items yet';
    return items.map((item) => {
        const legacyMaterial = clean(item.material_name || item.material || '');
        if (legacyMaterial && !item.groupId && !item.expenseGroup) {
            const qty = Math.max(1, Number(item.qty || item.quantity || 1) || 1);
            const part = clean(item.part_note || item.part || '');
            return part ? `${qty}x ${legacyMaterial} (${part})` : `${qty}x ${legacyMaterial}`;
        }
        const qty = Math.max(1, Number(item.quantity || item.qty || 1) || 1);
        const groupLabel = catalog?.getGroupLabel?.(item.groupId || item.expenseGroup) || 'Item';
        const model = clean(item.model || '');
        const part = clean(item.itemNote || item.part_note || '');
        const supplier = clean(item.supplierStoreName || item.supplier || '');
        const chunks = [`${qty}x ${groupLabel}`];
        if (model && model !== 'NA') chunks.push(model);
        if (part) chunks.push(part);
        if (supplier) chunks.push(`@ ${supplier}`);
        const amount = Number(item.amount || 0) || 0;
        if (amount > 0) chunks.push(formatPeso(amount));
        return chunks.join(' / ');
    }).join('; ');
}

function summarizeSuppliers(items = []) {
    const suppliers = [...new Set(items.map((item) => clean(item.supplierStoreName || item.supplier || '')).filter(Boolean))];
    if (!suppliers.length) return '';
    if (suppliers.length === 1) return suppliers[0];
    return `${suppliers[0]} +${suppliers.length - 1} more`;
}

function getSchedulePurposeLabel(purposeId) {
    return SCHEDULE_PURPOSE_LABELS[String(purposeId || '').trim()] || 'Buy Items';
}

function buildPurchaseSummary(schedulePurpose, items = [], remarks = '') {
    const purposeLabel = getSchedulePurposeLabel(schedulePurpose);
    const supplierSummary = summarizeSuppliers(items);
    const lines = [`Purpose: ${purposeLabel}`];
    if (supplierSummary) lines.push(`Supplier: ${supplierSummary}`);
    lines.push(`Buy: ${summarizeLineItems(items)}`);
    if (remarks) lines.push(`Notes: ${remarks}`);
    return lines.join(' | ');
}

async function savePurchaseRequest() {
    const requestDate = document.getElementById('purchasingRequestDate').value;
    const remarks = clean(document.getElementById('purchasingRemarks').value);
    const lineItems = [...purchasingState.lineItems];
    if (!requestDate) {
        alert('Request date is required.');
        return;
    }
    if (!lineItems.length) {
        alert('Add at least one item row before saving.');
        return;
    }

    const existingId = clean(document.getElementById('purchasingRequestId').value);
    const nextId = existingId ? Number(existingId) : await allocateNextNumericId(PURCHASE_REQUEST_COLLECTION);
    const now = new Date().toISOString();
    const user = MargaAuth.getUser() || {};
    const previous = purchasingState.requests.find((row) => String(row.id || '') === String(nextId)) || {};
    const supplier = summarizeSuppliers(lineItems);
    const totalAmount = sumLineItemAmounts(lineItems);
    const record = {
        id: nextId,
        request_date: requestDate,
        supplier,
        total_amount: totalAmount,
        remarks,
        line_items: lineItems,
        line_items_json: JSON.stringify(lineItems),
        items_summary: summarizeLineItems(lineItems),
        status: previous.status === 'scheduled' ? 'scheduled' : 'draft',
        tbl_schedule_id: Number(previous.tbl_schedule_id || 0) || 0,
        schedule_date: previous.schedule_date || '',
        schedule_time: previous.schedule_time || '',
        schedule_purpose: previous.schedule_purpose || document.getElementById('purchasingSchedulePurpose').value || 'buy_items',
        assigned_staff_id: Number(previous.assigned_staff_id || 0) || 0,
        assigned_staff_name: previous.assigned_staff_name || '',
        updated_at: now,
        created_at: previous.created_at || now,
        created_by: previous.created_by || clean(user.email || user.name || 'purchasing'),
        created_by_name: previous.created_by_name || clean(user.name || user.email || 'purchasing'),
        created_by_staff_id: Number(previous.created_by_staff_id || user.staff_id || user.id || 0) || 0
    };

    await setDocument(PURCHASE_REQUEST_COLLECTION, String(nextId), record);
    purchasingState.activeRequestId = String(nextId);
    document.getElementById('purchasingRequestId').value = String(nextId);
    document.getElementById('purchasingFormTitle').textContent = `Purchase Request #${nextId}`;
    localStorage.removeItem(draftStorageKey());
    await loadPurchaseRequests();
    renderRequestList();
    const loaded = purchasingState.requests.find((row) => String(row.id || '') === String(nextId));
    if (loaded) loadRequestIntoForm(loaded);
    setSaveStatus(`Saved purchase request #${nextId}.`);
    MargaUtils.showToast?.('Purchase request saved.', 'success');
}

async function savePurchaseSchedule() {
    const requestId = clean(document.getElementById('purchasingRequestId').value);
    if (!requestId) {
        alert('Save the purchase request first.');
        return;
    }
    const request = purchasingState.requests.find((row) => String(row.id || '') === requestId);
    if (!request) {
        alert('Purchase request not found. Refresh and try again.');
        return;
    }

    const scheduleDate = document.getElementById('purchasingScheduleDate').value;
    const scheduleTime = normalizeTimeInput(document.getElementById('purchasingScheduleTime').value) || '08:00';
    const schedulePurpose = document.getElementById('purchasingSchedulePurpose').value || 'buy_items';
    const assigneeId = Number(document.getElementById('purchasingAssignee').value || 0);
    if (!scheduleDate) {
        alert('Schedule date is required.');
        return;
    }
    if (!assigneeId) {
        alert('Please assign an employee.');
        return;
    }

    const remarks = clean(document.getElementById('purchasingRemarks').value || request.remarks);
    const lineItems = purchasingState.lineItems.length ? purchasingState.lineItems : normalizeLineItems(parseLineItems(request));
    const purposeLabel = getSchedulePurposeLabel(schedulePurpose);
    const summary = buildPurchaseSummary(schedulePurpose, lineItems, remarks);
    const supplier = summarizeSuppliers(lineItems);
    const staff = purchasingState.staffOptions.find((row) => Number(row.id) === assigneeId);
    const staffName = staff?.name || `Staff #${assigneeId}`;
    const taskDateTime = `${scheduleDate} ${scheduleTime.length === 5 ? `${scheduleTime}:00` : scheduleTime}`;
    const now = new Date().toISOString();
    const user = MargaAuth.getUser() || {};

    let scheduleId = Number(request.tbl_schedule_id || 0) || 0;
    if (!scheduleId) {
        scheduleId = await allocateNextNumericId('tbl_schedule');
    }

    const scheduleRecord = {
        id: scheduleId,
        company_id: 0,
        branch_id: 0,
        area_id: 0,
        serial: 0,
        caller: supplier || purposeLabel,
        phone_number: '',
        purpose_id: PURCHASING_PURPOSE_ID,
        task_datetime: taskDateTime,
        original_sched: taskDateTime,
        tech_id: assigneeId,
        assigned_to_id: assigneeId,
        assigned_to: staffName,
        assigned_technician_id: assigneeId,
        assigned_technician_name: staffName,
        trouble_id: 0,
        remarks: summary,
        customer_request: summary,
        route_remarks: summary,
        purchase_supplier: supplier,
        purchase_schedule_purpose: schedulePurpose,
        purchase_schedule_purpose_label: purposeLabel,
        purchase_items_json: JSON.stringify(lineItems),
        purchase_request_id: Number(requestId),
        status: 1,
        isongoing: 0,
        date_finished: ZERO_DATETIME,
        iscancel: 0,
        scheduled: 1,
        withcomplain: 0,
        withrequest: 1,
        super_urgent: 0,
        request_origin: 'purchasing',
        from_mobileapp: 0,
        bridge_updated_at: now,
        bridge_updated_by: Number(user.staff_id || 0) || 0,
        pcname: 'PWA',
        ipadd: '',
        automove: 0,
        empty_cart: 0,
        order_cart: 0,
        priority: 0,
        user_id: 0,
        returning_cart: 0,
        userlog_id: 0,
        closedby: 0,
        from_other_source: 0
    };

    await setDocument('tbl_schedule', String(scheduleId), scheduleRecord);

    const updatedRequest = {
        ...request,
        supplier,
        total_amount: sumLineItemAmounts(lineItems),
        remarks,
        line_items: lineItems,
        line_items_json: JSON.stringify(lineItems),
        items_summary: summarizeLineItems(lineItems),
        status: 'scheduled',
        tbl_schedule_id: scheduleId,
        schedule_date: scheduleDate,
        schedule_time: scheduleTime,
        schedule_purpose: schedulePurpose,
        assigned_staff_id: assigneeId,
        assigned_staff_name: staffName,
        updated_at: now
    };
    await setDocument(PURCHASE_REQUEST_COLLECTION, String(requestId), updatedRequest);

    await loadPurchaseRequests();
    const loaded = purchasingState.requests.find((row) => String(row.id || '') === requestId);
    if (loaded) loadRequestIntoForm(loaded);
    document.getElementById('purchasingScheduleStatus').textContent = `Scheduled as field task #${scheduleId} for ${staffName} · ${purposeLabel} on ${formatShortDate(scheduleDate)}.`;
    MargaUtils.showToast?.(`Purchase schedule #${scheduleId} saved for ${staffName}.`, 'success');
}

function draftStorageKey() {
    const user = MargaAuth.getUser() || {};
    return `${PURCHASING_DRAFT_KEY}:${user.staff_id || user.id || user.email || 'user'}`;
}

function persistDraft() {
    try {
        const payload = {
            requestId: readHiddenRequestId(),
            requestDate: document.getElementById('purchasingRequestDate')?.value || '',
            remarks: document.getElementById('purchasingRemarks')?.value || '',
            lineItems: purchasingState.lineItems,
            draftItem: purchasingState.draftItem,
            scheduleDate: document.getElementById('purchasingScheduleDate')?.value || '',
            scheduleTime: document.getElementById('purchasingScheduleTime')?.value || '',
            schedulePurpose: document.getElementById('purchasingSchedulePurpose')?.value || 'buy_items',
            assigneeId: document.getElementById('purchasingAssignee')?.value || ''
        };
        localStorage.setItem(draftStorageKey(), JSON.stringify(payload));
    } catch (error) {
        console.warn('Purchasing draft save failed:', error);
    }
}

function restoreDraftIfNeeded() {
    try {
        const raw = localStorage.getItem(draftStorageKey());
        if (!raw) {
            renderItemEntry();
            renderItemList();
            return;
        }
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object') {
            renderItemEntry();
            renderItemList();
            return;
        }
        if (draft.requestDate) document.getElementById('purchasingRequestDate').value = draft.requestDate;
        if (draft.remarks) document.getElementById('purchasingRemarks').value = draft.remarks;
        if (draft.scheduleDate) document.getElementById('purchasingScheduleDate').value = draft.scheduleDate;
        if (draft.scheduleTime) document.getElementById('purchasingScheduleTime').value = draft.scheduleTime;
        if (draft.schedulePurpose) document.getElementById('purchasingSchedulePurpose').value = draft.schedulePurpose;
        if (draft.assigneeId) document.getElementById('purchasingAssignee').value = draft.assigneeId;
        if (Array.isArray(draft.lineItems)) purchasingState.lineItems = normalizeLineItems(draft.lineItems);
        if (draft.draftItem) purchasingState.draftItem = createPurchaseItem(draft.draftItem);
        if (draft.requestId) {
            purchasingState.activeRequestId = String(draft.requestId);
            document.getElementById('purchasingRequestId').value = String(draft.requestId);
        }
        renderItemEntry();
        renderItemList();
    } catch (error) {
        console.warn('Purchasing draft restore failed:', error);
        renderItemEntry();
        renderItemList();
    }
}

function readHiddenRequestId() {
    return clean(document.getElementById('purchasingRequestId')?.value);
}

function setSaveStatus(message) {
    const node = document.getElementById('purchasingSaveStatus');
    if (node) node.textContent = message;
}

function handleError(error) {
    console.error('Purchasing error:', error);
    alert(error?.message || 'Purchasing action failed.');
    setSaveStatus('Action failed.');
}

async function allocateNextNumericId(collection) {
    const docs = await runQuery({
        from: [{ collectionId: collection }],
        orderBy: [{ field: { fieldPath: 'id' }, direction: 'DESCENDING' }],
        limit: 1
    });
    const latest = docs.map((doc) => MargaUtils.parseFirestoreDoc(doc)).filter(Boolean)[0];
    const nextId = Number(latest?.id || 0) + 1;
    if (!Number.isFinite(nextId) || nextId <= 0) {
        throw new Error(`Unable to allocate new ${collection} id.`);
    }
    return nextId;
}

async function runQuery(structuredQuery) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.');
    }
    return Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean) : [];
}

function toFirestoreFieldValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map((item) => toFirestoreFieldValue(item))
            }
        };
    }
    if (typeof value === 'object') {
        const fields = {};
        Object.entries(value).forEach(([key, child]) => {
            if (child === undefined || typeof child === 'function') return;
            fields[key] = toFirestoreFieldValue(child);
        });
        return { mapValue: { fields } };
    }
    return { stringValue: String(value ?? '') };
}

async function setDocument(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    }
    return payload;
}

async function patchDocument(collection, docId, fields) {
    return setDocument(collection, docId, fields);
}

function dateOnly(value) {
    const text = clean(value);
    if (!text) return '';
    return text.slice(0, 10);
}

function normalizeTimeInput(value) {
    const text = clean(value);
    if (!text) return '';
    return text.length >= 5 ? text.slice(0, 5) : text;
}

function formatShortDate(value) {
    const text = dateOnly(value);
    if (!text) return '-';
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
}

function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}
