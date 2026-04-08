if (!MargaAuth.requireAccess('pettycash')) {
    throw new Error('Unauthorized access to Petty Cash module.');
}

const PETTY_CASH_STORAGE_KEYS = {
    entries: 'marga_petty_cash_entries_v1',
    requests: 'marga_petty_cash_requests_v1',
    settings: 'marga_petty_cash_settings_v1'
};

const ENTRY_STATUSES = [
    'Pending Liquidation',
    'Liquidated',
    'Replenished',
    'Cancelled'
];

const REQUEST_STATUSES = [
    'Draft',
    'Requested',
    'Approved',
    'Released'
];

const EXPENSE_GROUPS = [
    { id: 'field_parts', label: 'Printer Parts - Field Repair', accountId: 'printer_repair_parts_field_expense' },
    { id: 'workshop_parts', label: 'Printer Parts - Workshop Repair', accountId: 'printer_repair_parts_workshop_expense' },
    { id: 'toner', label: 'Toner', accountId: 'toner_expense' },
    { id: 'ink', label: 'Ink', accountId: 'ink_expense' },
    { id: 'gasoline', label: 'Gasoline', accountId: '' },
    { id: 'diesel', label: 'Diesel', accountId: '' },
    { id: 'commute_fare', label: 'Commute Fare', accountId: 'commute_fare_expense' },
    { id: 'meal_allowance', label: 'Meal Allowance', accountId: 'meal_allowance_expense_field_operations' },
    { id: 'bible_study_snacks', label: 'Bible Study Snacks', accountId: 'staff_welfare_snacks_expense' },
    { id: 'office_supplies', label: 'Office Supplies', accountId: 'office_supplies_expense' },
    { id: 'other_materials', label: 'Other Materials', accountId: 'other_materials_expense' },
    { id: 'other', label: 'Other Expense', accountId: '' }
];

const PETTY_CASH_HIDDEN_ACCOUNT_IDS = new Set([
    'fuel_delivery_expense',
    'gasoline_expense',
    'diesel_expense'
]);

const EMPLOYEE_FALLBACK_OPTIONS = [
    'Michael Pineda',
    'Mike Pineda',
    'Petty Cash Manager',
    'Accounting',
    'Messenger Team',
    'Admin Office'
];

const PAYEE_FALLBACK_OPTIONS = [
    'Michael Pineda',
    'Mike Pineda',
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

const DEFAULT_SETTINGS = {
    custodian: 'Petty Cash Manager',
    department: 'Office Finance',
    fundLimit: 15000,
    openingBalance: 15000,
    threshold: 3000
};

const DEFAULT_ENTRIES = [
    {
        id: 'PCV-1001',
        voucherNumber: 'PCV-1001',
        date: offsetDate(-2),
        payee: 'Phoenix Fuel Station',
        requestedBy: 'Messenger Team',
        expenseGroup: 'gasoline',
        accountId: 'fuel_expense_motorcycle',
        amount: 860.00,
        receiptNumber: 'OR-1182',
        description: 'Fuel for messenger and delivery runs around the south area.',
        status: 'Liquidated',
        replenishmentId: '',
        createdAt: isoNow()
    },
    {
        id: 'PCV-1002',
        voucherNumber: 'PCV-1002',
        date: offsetDate(-2),
        payee: 'Ace Hardware',
        requestedBy: 'Admin Office',
        expenseGroup: 'other_materials',
        accountId: 'other_materials_expense',
        amount: 540.00,
        receiptNumber: 'OR-4405',
        description: 'Minor office repair materials. Remarks: replaced broken faucet and hose.',
        status: 'Pending Liquidation',
        replenishmentId: '',
        createdAt: isoNow()
    },
    {
        id: 'PCV-1003',
        voucherNumber: 'PCV-1003',
        date: offsetDate(-1),
        payee: 'Converge Payment Center',
        requestedBy: 'Accounting',
        expenseGroup: 'other',
        accountId: 'internet_expense',
        amount: 1899.00,
        receiptNumber: 'OR-9821',
        description: 'Backup prepaid internet load for office continuity.',
        status: 'Replenished',
        replenishmentId: 'REQ-3001',
        createdAt: isoNow()
    }
];

const DEFAULT_REQUESTS = [
    {
        id: 'REQ-3001',
        requestDate: offsetDate(0),
        reportDate: offsetDate(-1),
        requestedBy: 'Petty Cash Manager',
        approvedBy: 'Finance Supervisor',
        status: 'Released',
        notes: 'Replenishment for prior-day emergency internet expense.',
        amount: 1899.00,
        entryIds: ['PCV-1003'],
        createdAt: isoNow()
    }
];

const PETTY_CASH_STATE = {
    accounts: [],
    entries: [],
    requests: [],
    employees: [],
    payees: [],
    settings: normalizeSettings(DEFAULT_SETTINGS)
};

document.addEventListener('DOMContentLoaded', async () => {
    loadUserHeader();
    hydrateState();
    await loadEmployeeOptions();
    await loadPayeeOptions();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindControls();
    populateSelects();
    fillSettingsForm();
    clearEntryForm();
    clearRequestForm();
    renderAll();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function loadUserHeader() {
    const user = MargaAuth.getUser();
    if (!user) return;
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
    document.getElementById('userAvatar').textContent = String(user.name || 'A').charAt(0).toUpperCase();
}

function hydrateState() {
    PETTY_CASH_STATE.accounts = MargaFinanceAccounts.getStoredAccounts().map(normalizeAccount);
    PETTY_CASH_STATE.entries = readArrayStorage(PETTY_CASH_STORAGE_KEYS.entries, DEFAULT_ENTRIES).map(normalizeEntry);
    PETTY_CASH_STATE.requests = readArrayStorage(PETTY_CASH_STORAGE_KEYS.requests, DEFAULT_REQUESTS).map(normalizeRequest);
    PETTY_CASH_STATE.settings = normalizeSettings(readObjectStorage(PETTY_CASH_STORAGE_KEYS.settings, DEFAULT_SETTINGS));
    reconcileRequests();
}

function bindControls() {
    document.getElementById('reportDateInput').addEventListener('change', onWorkingDateChange);
    document.getElementById('entryForm').addEventListener('submit', onEntrySubmit);
    document.getElementById('entryFormClearBtn').addEventListener('click', clearEntryForm);
    document.getElementById('entryExpenseGroupInput').addEventListener('change', onExpenseGroupChange);
    document.getElementById('settingsForm').addEventListener('submit', onSettingsSubmit);
    document.getElementById('requestForm').addEventListener('submit', onRequestSubmit);
    document.getElementById('requestClearBtn').addEventListener('click', clearRequestForm);
    document.getElementById('generateRequestBtn').addEventListener('click', generateRequestFromSelectedDay);
    document.getElementById('requestReportDateInput').addEventListener('change', renderRequestPreview);
    document.getElementById('requestStatusInput').addEventListener('change', renderRequestPreview);
    document.getElementById('entrySearchInput').addEventListener('input', renderEntriesTable);
    document.getElementById('entryStatusFilter').addEventListener('change', renderEntriesTable);
    document.getElementById('accountSearchInput').addEventListener('input', renderAccountCards);
    document.getElementById('accountScopeFilter').addEventListener('change', renderAccountCards);
    document.getElementById('entriesTableBody').addEventListener('click', onEntriesTableAction);
    document.getElementById('requestsTableBody').addEventListener('click', onRequestsTableAction);
    document.getElementById('printDailyReportBtn').addEventListener('click', printDailyReport);
    document.getElementById('printReplenishmentBtn').addEventListener('click', printReplenishmentRequest);
    document.getElementById('resetTrialEntriesBtn').addEventListener('click', resetTrialEntries);
    document.getElementById('resetDemoBtn').addEventListener('click', resetDemoData);
}

function populateSelects() {
    const accountOptions = getSelectablePettyCashAccounts()
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((account) => `<option value="${account.id}">${escapeHtml(account.name)} (${escapeHtml(account.type)})</option>`)
        .join('');
    const employeeOptions = PETTY_CASH_STATE.employees
        .slice()
        .sort((left, right) => left.localeCompare(right))
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');
    const expenseGroupOptions = EXPENSE_GROUPS
        .map((group) => `<option value="${group.id}">${escapeHtml(group.label)}</option>`)
        .join('');
    const payeeOptions = PETTY_CASH_STATE.payees
        .slice()
        .sort((left, right) => left.localeCompare(right))
        .map((name) => `<option value="${escapeHtml(name)}"></option>`)
        .join('');

    document.getElementById('entryAccountInput').innerHTML = `<option value="">Select account</option>${accountOptions}`;
    document.getElementById('entryRequestedByInput').innerHTML = `<option value="">Select employee/requester</option>${employeeOptions}`;
    document.getElementById('requestRequestedByInput').innerHTML = `<option value="">Select employee/requester</option>${employeeOptions}`;
    document.getElementById('entryExpenseGroupInput').innerHTML = `<option value="">Select item group</option>${expenseGroupOptions}`;
    document.getElementById('entryPayeeList').innerHTML = payeeOptions;
    document.getElementById('entryStatusInput').innerHTML = ENTRY_STATUSES.map((status) => `<option value="${status}">${escapeHtml(status)}</option>`).join('');
    document.getElementById('entryStatusFilter').innerHTML = '<option value="all">All Entry Statuses</option>' + ENTRY_STATUSES.map((status) => `<option value="${status}">${escapeHtml(status)}</option>`).join('');
    document.getElementById('requestStatusInput').innerHTML = REQUEST_STATUSES.map((status) => `<option value="${status}">${escapeHtml(status)}</option>`).join('');
}

function onExpenseGroupChange() {
    const groupId = String(document.getElementById('entryExpenseGroupInput').value || '').trim();
    const group = EXPENSE_GROUPS.find((item) => item.id === groupId) || null;
    if (!group?.accountId) {
        if (groupId === 'gasoline' || groupId === 'diesel') {
            document.getElementById('entryAccountInput').value = '';
        }
        return;
    }
    if (getAccountById(group.accountId)) {
        document.getElementById('entryAccountInput').value = group.accountId;
    }
}

function onWorkingDateChange() {
    const selectedDate = getSelectedDateValue();
    document.getElementById('workingDateNote').textContent = `Preparing petty cash activity for ${formatLongDate(selectedDate)}.`;
    if (!document.getElementById('entryIdInput').value) {
        document.getElementById('entryDateInput').value = selectedDate;
    }
    if (!document.getElementById('requestIdInput').value) {
        document.getElementById('requestReportDateInput').value = selectedDate;
    }
    renderAll();
}

function onEntrySubmit(event) {
    event.preventDefault();

    const next = normalizeEntry({
        id: String(document.getElementById('entryIdInput').value || '').trim() || createEntryId(),
        voucherNumber: String(document.getElementById('entryVoucherInput').value || '').trim() || '',
        date: document.getElementById('entryDateInput').value,
        payee: document.getElementById('entryPayeeInput').value,
        requestedBy: document.getElementById('entryRequestedByInput').value,
        expenseGroup: document.getElementById('entryExpenseGroupInput').value,
        accountId: document.getElementById('entryAccountInput').value,
        amount: document.getElementById('entryAmountInput').value,
        receiptNumber: document.getElementById('entryReceiptInput').value,
        description: document.getElementById('entryDescriptionInput').value,
        status: document.getElementById('entryStatusInput').value,
        replenishmentId: getExistingEntryById(document.getElementById('entryIdInput').value)?.replenishmentId || '',
        createdAt: getExistingEntryById(document.getElementById('entryIdInput').value)?.createdAt || isoNow()
    });

    if (!next.date || !next.payee || !next.requestedBy || !next.expenseGroup || !next.accountId || next.amount <= 0 || !next.description) {
        MargaUtils.showToast('Date, payee, requested by, item group, account, amount, and description are required.', 'error');
        return;
    }

    if (!getAccountById(next.accountId)) {
        MargaUtils.showToast('Please select a valid chart of account.', 'error');
        return;
    }

    ensurePayeeOption(next.payee);
    upsertById(PETTY_CASH_STATE.entries, next);
    reconcileRequests();
    persistState();
    clearEntryForm();
    renderAll();
    MargaUtils.showToast('Petty cash entry saved.', 'success');
}

function onSettingsSubmit(event) {
    event.preventDefault();
    PETTY_CASH_STATE.settings = normalizeSettings({
        custodian: document.getElementById('custodianInput').value,
        department: document.getElementById('departmentInput').value,
        fundLimit: document.getElementById('fundLimitInput').value,
        openingBalance: document.getElementById('openingBalanceInput').value,
        threshold: document.getElementById('thresholdInput').value
    });
    persistState();
    renderAll();
    MargaUtils.showToast('Fund setup saved.', 'success');
}

function onRequestSubmit(event) {
    event.preventDefault();

    const requestId = String(document.getElementById('requestIdInput').value || '').trim() || createRequestId();
    const reportDate = String(document.getElementById('requestReportDateInput').value || '').trim();
    const requestDate = String(document.getElementById('requestDateInput').value || '').trim();
    const entryIds = getEligibleEntriesForRequest(reportDate, requestId).map((entry) => entry.id);

    if (!reportDate || !requestDate) {
        MargaUtils.showToast('Request date and report date are required.', 'error');
        return;
    }

    if (!entryIds.length) {
        MargaUtils.showToast('No liquidated petty cash entry is ready for replenishment on that date.', 'error');
        return;
    }

    const next = normalizeRequest({
        id: requestId,
        requestDate,
        reportDate,
        requestedBy: document.getElementById('requestRequestedByInput').value,
        approvedBy: document.getElementById('requestApprovedByInput').value,
        status: document.getElementById('requestStatusInput').value,
        notes: document.getElementById('requestNotesInput').value,
        amount: sumAmounts(entryIds.map((entryId) => getEntryById(entryId)?.amount || 0)),
        entryIds,
        createdAt: getRequestById(requestId)?.createdAt || isoNow()
    });

    upsertById(PETTY_CASH_STATE.requests, next);
    reconcileRequests();
    persistState();
    fillRequestForm(getRequestById(requestId) || next);
    renderAll();
    MargaUtils.showToast('Replenishment request saved.', 'success');
}

function onEntriesTableAction(event) {
    const button = event.target.closest('[data-action][data-id]');
    if (!button) return;

    const entry = getEntryById(button.dataset.id);
    if (!entry) return;

    if (button.dataset.action === 'edit-entry') {
        fillEntryForm(entry);
        return;
    }

    if (button.dataset.action === 'delete-entry') {
        const ok = confirm(`Delete petty cash entry ${entry.voucherNumber || entry.id}?`);
        if (!ok) return;
        PETTY_CASH_STATE.entries = PETTY_CASH_STATE.entries.filter((item) => item.id !== entry.id);
        reconcileRequests();
        persistState();
        clearEntryForm();
        renderAll();
        MargaUtils.showToast('Petty cash entry deleted.', 'info');
    }
}

function onRequestsTableAction(event) {
    const button = event.target.closest('[data-action][data-id]');
    if (!button) return;

    const request = getRequestById(button.dataset.id);
    if (!request) return;

    if (button.dataset.action === 'edit-request') {
        fillRequestForm(request);
        return;
    }

    if (button.dataset.action === 'print-request') {
        printRequestDocument(request);
        return;
    }

    if (button.dataset.action === 'delete-request') {
        const ok = confirm(`Delete replenishment request ${request.id}? Linked entries will return to liquidated status.`);
        if (!ok) return;
        PETTY_CASH_STATE.entries.forEach((entry) => {
            if (entry.replenishmentId === request.id) {
                entry.replenishmentId = '';
                if (entry.status === 'Replenished') entry.status = 'Liquidated';
            }
        });
        PETTY_CASH_STATE.requests = PETTY_CASH_STATE.requests.filter((item) => item.id !== request.id);
        reconcileRequests();
        persistState();
        clearRequestForm();
        renderAll();
        MargaUtils.showToast('Replenishment request deleted.', 'info');
    }
}

function renderAll() {
    renderOverview();
    renderFundSnapshot();
    renderDailySummary();
    renderEntriesTable();
    renderRequestsTable();
    renderAccountCards();
    renderRequestPreview();
}

function renderOverview() {
    const selectedDate = getSelectedDateValue();
    const allSpent = sumAmounts(getActiveEntries().map((entry) => entry.amount));
    const releasedAmount = sumAmounts(getReleasedRequests().map((request) => request.amount));
    const cashOnHand = Math.max(PETTY_CASH_STATE.settings.openingBalance + releasedAmount - allSpent, 0);
    const spentTodayEntries = getEntriesByDate(selectedDate).filter((entry) => entry.status !== 'Cancelled');
    const pendingLiquidation = PETTY_CASH_STATE.entries.filter((entry) => entry.status === 'Pending Liquidation');
    const readyForReplenishment = PETTY_CASH_STATE.entries.filter((entry) => (
        entry.status === 'Liquidated' && !entry.replenishmentId
    ));

    document.getElementById('statCashOnHand').textContent = MargaUtils.formatCurrency(cashOnHand);
    document.getElementById('statCashOnHandMeta').textContent = cashOnHand <= PETTY_CASH_STATE.settings.threshold
        ? `Below warning level of ${MargaUtils.formatCurrency(PETTY_CASH_STATE.settings.threshold)}`
        : `Fund ceiling ${MargaUtils.formatCurrency(PETTY_CASH_STATE.settings.fundLimit)}`;
    document.getElementById('statSpentToday').textContent = MargaUtils.formatCurrency(sumAmounts(spentTodayEntries.map((entry) => entry.amount)));
    document.getElementById('statSpentTodayMeta').textContent = `${spentTodayEntries.length} entry(s) on ${formatLongDate(selectedDate)}`;
    document.getElementById('statPendingLiquidation').textContent = MargaUtils.formatCurrency(sumAmounts(pendingLiquidation.map((entry) => entry.amount)));
    document.getElementById('statPendingLiquidationMeta').textContent = `${pendingLiquidation.length} entry(s) still waiting`;
    document.getElementById('statReadyReplenishment').textContent = MargaUtils.formatCurrency(sumAmounts(readyForReplenishment.map((entry) => entry.amount)));
    document.getElementById('statReadyReplenishmentMeta').textContent = readyForReplenishment.length
        ? `${readyForReplenishment.length} liquidated entry(s) not yet requested`
        : 'No liquidated line is waiting for replenishment';
}

function renderFundSnapshot() {
    const selectedDate = getSelectedDateValue();
    const selectedEntries = getEntriesByDate(selectedDate).filter((entry) => entry.status !== 'Cancelled');
    const linkedRequests = PETTY_CASH_STATE.requests.filter((request) => request.reportDate === selectedDate);
    const snapshot = [
        {
            label: 'Custodian',
            value: PETTY_CASH_STATE.settings.custodian || 'Not set',
            meta: PETTY_CASH_STATE.settings.department || 'No department saved'
        },
        {
            label: 'Fund Ceiling',
            value: MargaUtils.formatCurrency(PETTY_CASH_STATE.settings.fundLimit),
            meta: `Opening ${MargaUtils.formatCurrency(PETTY_CASH_STATE.settings.openingBalance)}`
        },
        {
            label: 'Entries This Day',
            value: selectedEntries.length.toLocaleString(),
            meta: `${MargaUtils.formatCurrency(sumAmounts(selectedEntries.map((entry) => entry.amount)))} logged`
        },
        {
            label: 'Requests This Day',
            value: linkedRequests.length.toLocaleString(),
            meta: `${MargaUtils.formatCurrency(sumAmounts(linkedRequests.map((request) => request.amount)))} requested`
        }
    ];

    document.getElementById('fundSnapshotGrid').innerHTML = snapshot.map((item) => `
        <article class="snapshot-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.meta)}</small>
        </article>
    `).join('');
}

function renderDailySummary() {
    const selectedDate = getSelectedDateValue();
    const dayOpening = calculateDayOpeningBalance(selectedDate);
    const dayEntries = getEntriesByDate(selectedDate).filter((entry) => entry.status !== 'Cancelled');
    const releasedToday = PETTY_CASH_STATE.requests.filter((request) => request.status === 'Released' && request.requestDate === selectedDate);
    const spentToday = sumAmounts(dayEntries.map((entry) => entry.amount));
    const releasedAmount = sumAmounts(releasedToday.map((request) => request.amount));
    const closingBalance = Math.max(dayOpening + releasedAmount - spentToday, 0);
    const summaryCards = [
        {
            label: 'Opening Balance',
            value: MargaUtils.formatCurrency(dayOpening),
            meta: `Before transactions on ${formatLongDate(selectedDate)}`
        },
        {
            label: 'Spent Today',
            value: MargaUtils.formatCurrency(spentToday),
            meta: `${dayEntries.length} petty cash line(s)`
        },
        {
            label: 'Released Back Today',
            value: MargaUtils.formatCurrency(releasedAmount),
            meta: `${releasedToday.length} replenishment release(s)`
        },
        {
            label: 'Closing Balance',
            value: MargaUtils.formatCurrency(closingBalance),
            meta: closingBalance <= PETTY_CASH_STATE.settings.threshold ? 'Below threshold, replenish soon' : 'Still above warning level'
        }
    ];

    document.getElementById('dailySummaryGrid').innerHTML = summaryCards.map((item) => `
        <article class="daily-summary-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.meta)}</small>
        </article>
    `).join('');
}

function renderEntriesTable() {
    const tbody = document.getElementById('entriesTableBody');
    const selectedDate = getSelectedDateValue();
    const statusFilter = String(document.getElementById('entryStatusFilter').value || 'all');
    const search = String(document.getElementById('entrySearchInput').value || '').trim().toLowerCase();

    const rows = getEntriesByDate(selectedDate)
        .filter((entry) => {
            const account = getAccountById(entry.accountId);
            const request = getRequestById(entry.replenishmentId);
            const haystack = [
                entry.id,
                entry.voucherNumber,
                entry.payee,
                entry.requestedBy,
                getExpenseGroupLabel(entry.expenseGroup),
                entry.receiptNumber,
                entry.description,
                account?.name || '',
                request?.id || ''
            ].join(' ').toLowerCase();
            return (statusFilter === 'all' || entry.status === statusFilter) && (!search || haystack.includes(search));
        })
        .sort((left, right) => String(left.voucherNumber || left.id).localeCompare(String(right.voucherNumber || right.id)));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">No petty cash entry matched the selected day and filters.</div></td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((entry) => {
        const account = getAccountById(entry.accountId);
        const request = getRequestById(entry.replenishmentId);
        return `
            <tr>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${escapeHtml(entry.voucherNumber || entry.id)}</span>
                        <span class="ref-secondary">${escapeHtml(entry.payee)}</span>
                    </div>
                </td>
                <td>${escapeHtml(entry.requestedBy || '-')}</td>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${escapeHtml(account?.name || 'Unknown Account')}</span>
                        <span class="ref-secondary">${escapeHtml(account?.type || '')}</span>
                    </div>
                </td>
                <td>${escapeHtml(getExpenseGroupLabel(entry.expenseGroup) || '-')}</td>
                <td>
                    <div class="ref-cell">
                        <span>${escapeHtml(entry.description || '-')}</span>
                        <span class="ref-secondary">${escapeHtml(entry.receiptNumber ? `Receipt ${entry.receiptNumber}` : 'No receipt/reference')}</span>
                    </div>
                </td>
                <td>${MargaUtils.formatCurrency(entry.amount)}</td>
                <td><span class="status-badge ${slugify(entry.status)}">${escapeHtml(entry.status)}</span></td>
                <td>${renderRequestBadge(request)}</td>
                <td>
                    <div class="row-actions">
                        <button type="button" class="row-btn" data-action="edit-entry" data-id="${entry.id}">Edit</button>
                        <button type="button" class="row-btn" data-action="delete-entry" data-id="${entry.id}">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderRequestsTable() {
    const tbody = document.getElementById('requestsTableBody');
    const rows = PETTY_CASH_STATE.requests
        .slice()
        .sort((left, right) => {
            const leftDate = `${left.requestDate} ${left.id}`;
            const rightDate = `${right.requestDate} ${right.id}`;
            return rightDate.localeCompare(leftDate);
        });

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No replenishment request has been saved yet.</div></td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((request) => {
        const linkedEntries = getEntriesByRequestId(request.id);
        return `
            <tr>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${escapeHtml(request.id)}</span>
                        <span class="ref-secondary">${escapeHtml(formatLongDate(request.requestDate))}</span>
                    </div>
                </td>
                <td>${escapeHtml(formatLongDate(request.reportDate))}</td>
                <td>
                    <div class="ref-cell">
                        <span>${escapeHtml(request.requestedBy || '-')}</span>
                        <span class="ref-secondary">${escapeHtml(request.approvedBy ? `Approver: ${request.approvedBy}` : 'Approver not set')}</span>
                    </div>
                </td>
                <td>${MargaUtils.formatCurrency(request.amount)}</td>
                <td><span class="status-badge ${slugify(request.status)}">${escapeHtml(request.status)}</span></td>
                <td>${linkedEntries.length.toLocaleString()}</td>
                <td>
                    <div class="row-actions">
                        <button type="button" class="row-btn" data-action="edit-request" data-id="${request.id}">Edit</button>
                        <button type="button" class="row-btn" data-action="print-request" data-id="${request.id}">Print</button>
                        <button type="button" class="row-btn" data-action="delete-request" data-id="${request.id}">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAccountCards() {
    const grid = document.getElementById('accountGuideGrid');
    const search = String(document.getElementById('accountSearchInput').value || '').trim().toLowerCase();
    const scope = String(document.getElementById('accountScopeFilter').value || 'all').trim().toLowerCase();

    const accounts = getSelectablePettyCashAccounts()
        .filter((account) => {
            const haystack = [account.name, account.meaning, account.useWhen, account.avoid].join(' ').toLowerCase();
            const scopeMatch = scope === 'all' || account.scope === scope || (scope === 'pettycash' && (account.scope === 'shared' || account.scope === 'pettycash'));
            return scopeMatch && (!search || haystack.includes(search));
        })
        .sort((left, right) => left.name.localeCompare(right.name));

    if (!accounts.length) {
        grid.innerHTML = '<div class="empty-state">No account matched the current search.</div>';
        return;
    }

    grid.innerHTML = accounts.map((account) => `
        <article class="account-card">
            <div class="account-card-header">
                <div>
                    <h4>${escapeHtml(account.name)}</h4>
                </div>
                <div class="account-tags">
                    <span class="type-badge ${slugify(account.type)}">${escapeHtml(account.type)}</span>
                    <span class="scope-badge ${account.scope}">${escapeHtml(MargaFinanceAccounts.formatScope(account.scope))}</span>
                </div>
            </div>
            <div class="account-copy">
                <p><strong>Meaning:</strong> ${escapeHtml(account.meaning)}</p>
                <p><strong>Use This When:</strong> ${escapeHtml(account.useWhen)}</p>
                <p><strong>Do Not Use For:</strong> ${escapeHtml(account.avoid)}</p>
            </div>
            <div class="account-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-use-account="${account.id}">Use In Entry Form</button>
            </div>
        </article>
    `).join('');

    grid.querySelectorAll('[data-use-account]').forEach((button) => {
        button.addEventListener('click', () => {
            document.getElementById('entryAccountInput').value = button.dataset.useAccount;
            const inferredGroup = inferExpenseGroupFromAccount(button.dataset.useAccount);
            if (inferredGroup) {
                document.getElementById('entryExpenseGroupInput').value = inferredGroup;
            }
            document.getElementById('entryAccountInput').focus();
            MargaUtils.showToast('Account selected in petty cash entry form.', 'info');
        });
    });
}

function renderRequestPreview() {
    const reportDate = String(document.getElementById('requestReportDateInput').value || getSelectedDateValue()).trim();
    const requestId = String(document.getElementById('requestIdInput').value || '').trim();
    const entries = getEligibleEntriesForRequest(reportDate, requestId);
    const breakdown = buildAccountBreakdown(entries);
    const total = sumAmounts(entries.map((entry) => entry.amount));
    const status = String(document.getElementById('requestStatusInput').value || 'Draft');
    const previewTotals = [
        {
            label: 'Entries Covered',
            value: entries.length.toLocaleString(),
            meta: entries.length ? `Liquidated line(s) for ${formatLongDate(reportDate)}` : 'Nothing ready yet'
        },
        {
            label: 'Accounts Included',
            value: breakdown.length.toLocaleString(),
            meta: breakdown.length ? 'Grouped for replenishment summary' : 'No account grouping yet'
        },
        {
            label: 'Request Amount',
            value: MargaUtils.formatCurrency(total),
            meta: status === 'Released' ? 'This request adds back to cash on hand' : 'Will remain pending until released'
        }
    ];

    document.getElementById('requestAmountInput').value = MargaUtils.formatCurrency(total);
    document.getElementById('requestCoverageMeta').textContent = entries.length
        ? `${entries.length} eligible entry(s) from ${formatLongDate(reportDate)} will be attached to this request.`
        : `No liquidated entry is ready for ${formatLongDate(reportDate)}.`;
    document.getElementById('requestDraftBadge').textContent = requestId
        ? `Editing ${requestId}`
        : 'Draft Based On Selected Day';

    document.getElementById('requestPreviewTotals').innerHTML = previewTotals.map((item) => `
        <article class="preview-total-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.meta)}</small>
        </article>
    `).join('');

    document.getElementById('requestPreviewBreakdown').innerHTML = breakdown.length
        ? breakdown.map((item) => `
            <article class="preview-breakdown-card">
                <span>${escapeHtml(item.accountName)}</span>
                <strong>${MargaUtils.formatCurrency(item.total)}</strong>
                <small>${item.count} entry(s) ready for replenishment</small>
            </article>
        `).join('')
        : '<div class="empty-state">Generate from the selected day after entries are liquidated.</div>';
}

function fillSettingsForm() {
    document.getElementById('custodianInput').value = PETTY_CASH_STATE.settings.custodian;
    document.getElementById('departmentInput').value = PETTY_CASH_STATE.settings.department;
    document.getElementById('fundLimitInput').value = Number(PETTY_CASH_STATE.settings.fundLimit || 0).toFixed(2);
    document.getElementById('openingBalanceInput').value = Number(PETTY_CASH_STATE.settings.openingBalance || 0).toFixed(2);
    document.getElementById('thresholdInput').value = Number(PETTY_CASH_STATE.settings.threshold || 0).toFixed(2);
}

function fillEntryForm(entry) {
    document.getElementById('entryIdInput').value = entry.id;
    document.getElementById('entryVoucherInput').value = entry.voucherNumber || '';
    document.getElementById('entryDateInput').value = entry.date;
    document.getElementById('entryStatusInput').value = entry.status;
    ensurePayeeOption(entry.payee || '');
    document.getElementById('entryPayeeInput').value = entry.payee;
    ensureEmployeeOption(entry.requestedBy || '');
    document.getElementById('entryRequestedByInput').value = entry.requestedBy || '';
    document.getElementById('entryExpenseGroupInput').value = entry.expenseGroup || inferExpenseGroupFromAccount(entry.accountId) || '';
    document.getElementById('entryAccountInput').value = entry.accountId;
    document.getElementById('entryAmountInput').value = Number(entry.amount || 0).toFixed(2);
    document.getElementById('entryReceiptInput').value = entry.receiptNumber || '';
    document.getElementById('entryDescriptionInput').value = entry.description || '';
    document.getElementById('entryFormModeLabel').textContent = `Editing ${entry.voucherNumber || entry.id}`;
}

function fillRequestForm(request) {
    document.getElementById('requestIdInput').value = request.id;
    document.getElementById('requestDateInput').value = request.requestDate;
    document.getElementById('requestReportDateInput').value = request.reportDate;
    document.getElementById('requestStatusInput').value = request.status;
    ensureEmployeeOption(request.requestedBy || '');
    document.getElementById('requestRequestedByInput').value = request.requestedBy || '';
    document.getElementById('requestApprovedByInput').value = request.approvedBy || '';
    document.getElementById('requestNotesInput').value = request.notes || '';
    document.getElementById('requestAmountInput').value = MargaUtils.formatCurrency(request.amount);
    renderRequestPreview();
}

function clearEntryForm() {
    const currentUser = MargaAuth.getUser();
    document.getElementById('entryForm').reset();
    document.getElementById('entryIdInput').value = '';
    document.getElementById('entryVoucherInput').value = '';
    document.getElementById('entryDateInput').value = getSelectedDateValue();
    document.getElementById('entryStatusInput').value = 'Pending Liquidation';
    ensureEmployeeOption(currentUser?.name || '');
    document.getElementById('entryRequestedByInput').value = currentUser?.name || '';
    document.getElementById('entryExpenseGroupInput').value = '';
    document.getElementById('entryFormModeLabel').textContent = 'New Entry';
}

function clearRequestForm() {
    const currentUser = MargaAuth.getUser();
    document.getElementById('requestForm').reset();
    document.getElementById('requestIdInput').value = '';
    document.getElementById('requestDateInput').value = getSelectedDateValue();
    document.getElementById('requestReportDateInput').value = getSelectedDateValue();
    document.getElementById('requestStatusInput').value = 'Draft';
    ensureEmployeeOption(currentUser?.name || PETTY_CASH_STATE.settings.custodian || '');
    document.getElementById('requestRequestedByInput').value = currentUser?.name || PETTY_CASH_STATE.settings.custodian || '';
    document.getElementById('requestApprovedByInput').value = '';
    document.getElementById('requestNotesInput').value = '';
    document.getElementById('requestAmountInput').value = MargaUtils.formatCurrency(0);
    renderRequestPreview();
}

function generateRequestFromSelectedDay() {
    const reportDate = getSelectedDateValue();
    const entries = getEligibleEntriesForRequest(reportDate, String(document.getElementById('requestIdInput').value || '').trim());
    if (!entries.length) {
        MargaUtils.showToast('No liquidated petty cash entry is ready for replenishment on the selected date.', 'error');
        return;
    }

    document.getElementById('requestReportDateInput').value = reportDate;
    document.getElementById('requestDateInput').value = getSelectedDateValue();
    if (!document.getElementById('requestRequestedByInput').value.trim()) {
        ensureEmployeeOption(MargaAuth.getUser()?.name || PETTY_CASH_STATE.settings.custodian || '');
        document.getElementById('requestRequestedByInput').value = MargaAuth.getUser()?.name || PETTY_CASH_STATE.settings.custodian || '';
    }
    if (!document.getElementById('requestNotesInput').value.trim()) {
        document.getElementById('requestNotesInput').value = buildSuggestedRequestNotes(reportDate, entries);
    }
    renderRequestPreview();
    MargaUtils.showToast('Replenishment draft generated from selected day.', 'success');
}

function printDailyReport() {
    const selectedDate = getSelectedDateValue();
    const entries = getEntriesByDate(selectedDate).filter((entry) => entry.status !== 'Cancelled');
    if (!entries.length) {
        MargaUtils.showToast('No petty cash entry is available for the selected date.', 'error');
        return;
    }
    printDailyDocument(selectedDate, entries);
}

function printReplenishmentRequest() {
    const currentRequestId = String(document.getElementById('requestIdInput').value || '').trim();
    const request = currentRequestId ? getRequestById(currentRequestId) : buildDraftRequestForPrint();
    if (!request) {
        MargaUtils.showToast('Generate or save a replenishment request first.', 'error');
        return;
    }
    printRequestDocument(request);
}

function printDailyDocument(reportDate, entries) {
    const popup = window.open('', '_blank', 'width=1180,height=820');
    if (!popup) {
        MargaUtils.showToast('Popup blocked. Please allow popups and try again.', 'error');
        return;
    }

    const breakdown = buildAccountBreakdown(entries);
    const dayOpening = calculateDayOpeningBalance(reportDate);
    const releasedToday = PETTY_CASH_STATE.requests.filter((request) => request.status === 'Released' && request.requestDate === reportDate);
    const spentToday = sumAmounts(entries.map((entry) => entry.amount));
    const releasedAmount = sumAmounts(releasedToday.map((request) => request.amount));
    const dayClosing = Math.max(dayOpening + releasedAmount - spentToday, 0);

        const detailRows = entries.map((entry, index) => {
            const account = getAccountById(entry.accountId);
            const request = getRequestById(entry.replenishmentId);
            return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(entry.voucherNumber || entry.id)}</td>
                <td>${escapeHtml(entry.payee)}</td>
                <td>${escapeHtml(entry.requestedBy || '-')}</td>
                <td>${escapeHtml(account?.name || '-')}</td>
                <td>${escapeHtml(getExpenseGroupLabel(entry.expenseGroup) || '-')}</td>
                <td>${escapeHtml(entry.description || '-')}</td>
                <td>${escapeHtml(entry.receiptNumber || '-')}</td>
                <td>${escapeHtml(entry.status)}</td>
                <td>${request ? escapeHtml(request.id) : '-'}</td>
                <td class="amount">${MargaUtils.formatCurrency(entry.amount)}</td>
            </tr>
        `;
    }).join('');

    const breakdownRows = breakdown.map((item) => `
        <tr>
            <td>${escapeHtml(item.accountName)}</td>
            <td>${item.count}</td>
            <td class="amount">${MargaUtils.formatCurrency(item.total)}</td>
        </tr>
    `).join('');

    popup.document.write(`
        <html>
        <head>
            <title>Petty Cash Daily Report - ${escapeHtml(formatLongDate(reportDate))}</title>
            <style>
                body { font-family: "Helvetica Neue", Arial, sans-serif; padding: 24px; color: #21352d; }
                h1 { margin: 0; font-size: 24px; }
                h2 { margin: 6px 0 18px; font-size: 13px; font-weight: normal; color: #4b6358; }
                .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
                .meta-card { border: 1px solid #cfdbd3; border-radius: 12px; padding: 10px; background: #f9fcfa; }
                .meta-card span { display: block; font-size: 11px; color: #607368; text-transform: uppercase; letter-spacing: 0.08em; }
                .meta-card strong { display: block; margin-top: 4px; font-size: 18px; color: #15392f; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                th, td { border: 1px solid #d3ddd7; padding: 7px 8px; font-size: 12px; vertical-align: top; text-align: left; }
                th { background: #eaf3ef; color: #17362e; }
                .section-title { margin-top: 22px; font-size: 15px; font-weight: 700; color: #17362e; }
                .amount { text-align: right; white-space: nowrap; }
            </style>
        </head>
        <body>
            <h1>MARGA Petty Cash Daily Report</h1>
            <h2>Date: ${escapeHtml(formatLongDate(reportDate))} | Custodian: ${escapeHtml(PETTY_CASH_STATE.settings.custodian || 'Not set')} | Department: ${escapeHtml(PETTY_CASH_STATE.settings.department || 'Not set')}</h2>
            <div class="meta">
                <div class="meta-card"><span>Opening Balance</span><strong>${MargaUtils.formatCurrency(dayOpening)}</strong></div>
                <div class="meta-card"><span>Spent Today</span><strong>${MargaUtils.formatCurrency(spentToday)}</strong></div>
                <div class="meta-card"><span>Released Back</span><strong>${MargaUtils.formatCurrency(releasedAmount)}</strong></div>
                <div class="meta-card"><span>Closing Balance</span><strong>${MargaUtils.formatCurrency(dayClosing)}</strong></div>
            </div>

            <div class="section-title">Account Breakdown</div>
            <table>
                <thead>
                    <tr>
                        <th>Account</th>
                        <th>Entries</th>
                        <th class="amount">Amount</th>
                    </tr>
                </thead>
                <tbody>${breakdownRows}</tbody>
            </table>

            <div class="section-title">Voucher Detail</div>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Voucher</th>
                        <th>Payee</th>
                        <th>Requested By</th>
                        <th>Account</th>
                        <th>Group</th>
                        <th>Description / Remarks</th>
                        <th>Receipt</th>
                        <th>Status</th>
                        <th>Replenishment</th>
                        <th class="amount">Amount</th>
                    </tr>
                </thead>
                <tbody>${detailRows}</tbody>
            </table>
        </body>
        </html>
    `);

    popup.document.close();
    popup.focus();
    popup.print();
}

function printRequestDocument(request) {
    const entries = getEntriesByRequestId(request.id).length ? getEntriesByRequestId(request.id) : getEligibleEntriesForRequest(request.reportDate, request.id);
    if (!entries.length) {
        MargaUtils.showToast('This request has no petty cash entries to print.', 'error');
        return;
    }

    const popup = window.open('', '_blank', 'width=1180,height=820');
    if (!popup) {
        MargaUtils.showToast('Popup blocked. Please allow popups and try again.', 'error');
        return;
    }

    const breakdown = buildAccountBreakdown(entries);
        const detailRows = entries.map((entry, index) => {
            const account = getAccountById(entry.accountId);
            return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(entry.voucherNumber || entry.id)}</td>
                <td>${escapeHtml(entry.payee)}</td>
                <td>${escapeHtml(entry.requestedBy || '-')}</td>
                <td>${escapeHtml(account?.name || '-')}</td>
                <td>${escapeHtml(getExpenseGroupLabel(entry.expenseGroup) || '-')}</td>
                <td>${escapeHtml(entry.description || '-')}</td>
                <td class="amount">${MargaUtils.formatCurrency(entry.amount)}</td>
            </tr>
        `;
    }).join('');

    const breakdownRows = breakdown.map((item) => `
        <tr>
            <td>${escapeHtml(item.accountName)}</td>
            <td>${item.count}</td>
            <td class="amount">${MargaUtils.formatCurrency(item.total)}</td>
        </tr>
    `).join('');

    popup.document.write(`
        <html>
        <head>
            <title>Petty Cash Replenishment - ${escapeHtml(request.id)}</title>
            <style>
                body { font-family: "Helvetica Neue", Arial, sans-serif; padding: 24px; color: #21352d; }
                h1 { margin: 0; font-size: 24px; }
                h2 { margin: 6px 0 18px; font-size: 13px; font-weight: normal; color: #4b6358; }
                .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
                .meta-card { border: 1px solid #cfdbd3; border-radius: 12px; padding: 10px; background: #f9fcfa; }
                .meta-card span { display: block; font-size: 11px; color: #607368; text-transform: uppercase; letter-spacing: 0.08em; }
                .meta-card strong { display: block; margin-top: 4px; font-size: 18px; color: #15392f; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                th, td { border: 1px solid #d3ddd7; padding: 7px 8px; font-size: 12px; vertical-align: top; text-align: left; }
                th { background: #eaf3ef; color: #17362e; }
                .section-title { margin-top: 22px; font-size: 15px; font-weight: 700; color: #17362e; }
                .amount { text-align: right; white-space: nowrap; }
                .notes { margin-top: 14px; padding: 12px; border: 1px solid #d3ddd7; border-radius: 12px; background: #f9fcfa; font-size: 12px; }
            </style>
        </head>
        <body>
            <h1>MARGA Request For Petty Cash Replenishment</h1>
            <h2>Request ID: ${escapeHtml(request.id)} | Report Date: ${escapeHtml(formatLongDate(request.reportDate))} | Request Date: ${escapeHtml(formatLongDate(request.requestDate))}</h2>
            <div class="meta">
                <div class="meta-card"><span>Requested Amount</span><strong>${MargaUtils.formatCurrency(request.amount)}</strong></div>
                <div class="meta-card"><span>Status</span><strong>${escapeHtml(request.status)}</strong></div>
                <div class="meta-card"><span>Prepared By</span><strong>${escapeHtml(request.requestedBy || 'Not set')}</strong></div>
                <div class="meta-card"><span>Approved By</span><strong>${escapeHtml(request.approvedBy || 'Not set')}</strong></div>
            </div>

            <div class="section-title">Account Breakdown</div>
            <table>
                <thead>
                    <tr>
                        <th>Account</th>
                        <th>Entries</th>
                        <th class="amount">Amount</th>
                    </tr>
                </thead>
                <tbody>${breakdownRows}</tbody>
            </table>

            <div class="section-title">Liquidated Voucher Detail</div>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Voucher</th>
                        <th>Payee</th>
                        <th>Requested By</th>
                        <th>Account</th>
                        <th>Group</th>
                        <th>Description / Remarks</th>
                        <th class="amount">Amount</th>
                    </tr>
                </thead>
                <tbody>${detailRows}</tbody>
            </table>

            <div class="notes"><strong>Notes:</strong> ${escapeHtml(request.notes || 'No notes added.')}</div>
        </body>
        </html>
    `);

    popup.document.close();
    popup.focus();
    popup.print();
}

function buildDraftRequestForPrint() {
    const draft = normalizeRequest({
        id: String(document.getElementById('requestIdInput').value || '').trim() || 'Draft',
        requestDate: document.getElementById('requestDateInput').value,
        reportDate: document.getElementById('requestReportDateInput').value,
        requestedBy: document.getElementById('requestRequestedByInput').value,
        approvedBy: document.getElementById('requestApprovedByInput').value,
        status: document.getElementById('requestStatusInput').value,
        notes: document.getElementById('requestNotesInput').value,
        amount: 0,
        entryIds: [],
        createdAt: isoNow()
    });
    const entries = getEligibleEntriesForRequest(draft.reportDate, draft.id);
    if (!entries.length) return null;
    draft.entryIds = entries.map((entry) => entry.id);
    draft.amount = sumAmounts(entries.map((entry) => entry.amount));
    return draft;
}

function reconcileRequests() {
    PETTY_CASH_STATE.requests.forEach((request) => {
        const linkedEntries = getEligibleEntriesForRequest(request.reportDate, request.id);
        syncEntriesForRequest(request, linkedEntries);
        request.entryIds = linkedEntries.map((entry) => entry.id);
        request.amount = sumAmounts(linkedEntries.map((entry) => entry.amount));
    });
}

function syncEntriesForRequest(request, linkedEntries) {
    const linkedIds = new Set(linkedEntries.map((entry) => entry.id));
    PETTY_CASH_STATE.entries.forEach((entry) => {
        if (entry.replenishmentId === request.id && !linkedIds.has(entry.id)) {
            entry.replenishmentId = '';
            if (entry.status === 'Replenished') entry.status = 'Liquidated';
        }
    });

    linkedEntries.forEach((entry) => {
        entry.replenishmentId = request.id;
        if (request.status === 'Released') {
            if (entry.status !== 'Cancelled') entry.status = 'Replenished';
            return;
        }
        if (entry.status === 'Replenished') {
            entry.status = 'Liquidated';
        }
    });
}

function getEligibleEntriesForRequest(reportDate, requestId = '') {
    return PETTY_CASH_STATE.entries.filter((entry) => {
        if (entry.date !== reportDate) return false;
        if (entry.status === 'Cancelled' || entry.status === 'Pending Liquidation') return false;
        if (!entry.replenishmentId) return true;
        return entry.replenishmentId === requestId;
    });
}

function calculateDayOpeningBalance(reportDate) {
    const priorEntries = PETTY_CASH_STATE.entries.filter((entry) => entry.date < reportDate && entry.status !== 'Cancelled');
    const priorReleased = PETTY_CASH_STATE.requests.filter((request) => request.status === 'Released' && request.requestDate < reportDate);
    return Math.max(
        PETTY_CASH_STATE.settings.openingBalance
        + sumAmounts(priorReleased.map((request) => request.amount))
        - sumAmounts(priorEntries.map((entry) => entry.amount)),
        0
    );
}

function buildAccountBreakdown(entries) {
    const map = new Map();
    entries.forEach((entry) => {
        const account = getAccountById(entry.accountId);
        const key = account?.id || entry.accountId || 'unknown';
        if (!map.has(key)) {
            map.set(key, {
                accountName: account?.name || 'Unknown Account',
                total: 0,
                count: 0
            });
        }
        const bucket = map.get(key);
        bucket.total += Number(entry.amount || 0);
        bucket.count += 1;
    });
    return [...map.values()].sort((left, right) => left.accountName.localeCompare(right.accountName));
}

function buildSuggestedRequestNotes(reportDate, entries) {
    const breakdown = buildAccountBreakdown(entries);
    const names = breakdown.slice(0, 3).map((item) => item.accountName).join(', ');
    const suffix = breakdown.length > 3 ? ', and other petty cash lines' : '';
    return `Replenishment for ${entries.length} liquidated petty cash entr${entries.length === 1 ? 'y' : 'ies'} dated ${formatLongDate(reportDate)} covering ${names || 'daily expenses'}${suffix}.`;
}

function renderRequestBadge(request) {
    if (!request) return '<span class="request-badge none">Not Yet Requested</span>';
    return `<span class="request-badge">${escapeHtml(request.id)} · ${escapeHtml(request.status)}</span>`;
}

function getActiveEntries() {
    return PETTY_CASH_STATE.entries.filter((entry) => entry.status !== 'Cancelled');
}

function getEntriesByDate(dateValue) {
    return PETTY_CASH_STATE.entries.filter((entry) => entry.date === dateValue);
}

function getReleasedRequests() {
    return PETTY_CASH_STATE.requests.filter((request) => request.status === 'Released');
}

function getEntriesByRequestId(requestId) {
    return PETTY_CASH_STATE.entries.filter((entry) => entry.replenishmentId === requestId);
}

function getEntryById(entryId) {
    return PETTY_CASH_STATE.entries.find((entry) => entry.id === entryId) || null;
}

function getExistingEntryById(entryId) {
    return PETTY_CASH_STATE.entries.find((entry) => entry.id === entryId) || null;
}

function getRequestById(requestId) {
    return PETTY_CASH_STATE.requests.find((request) => request.id === requestId) || null;
}

function getAccountById(accountId) {
    return PETTY_CASH_STATE.accounts.find((account) => account.id === accountId) || null;
}

function getSelectablePettyCashAccounts() {
    return PETTY_CASH_STATE.accounts.filter((account) => !PETTY_CASH_HIDDEN_ACCOUNT_IDS.has(account.id));
}

function getExpenseGroupLabel(groupId) {
    return EXPENSE_GROUPS.find((group) => group.id === groupId)?.label || '';
}

function getDefaultAccountForGroup(groupId) {
    return EXPENSE_GROUPS.find((group) => group.id === groupId)?.accountId || '';
}

function inferExpenseGroupFromAccount(accountId) {
    const normalized = String(accountId || '').trim();
    const direct = EXPENSE_GROUPS.find((group) => group.accountId === normalized);
    if (direct) return direct.id;
    if (normalized === 'fuel_expense_delivery_van' || normalized === 'fuel_expense_motorcycle' || normalized === 'fuel_delivery_expense' || normalized === 'gasoline_expense') return 'gasoline';
    if (normalized === 'diesel_expense') return 'diesel';
    return '';
}

function normalizeAccount(account) {
    return MargaFinanceAccounts.normalizeAccount(account);
}

function normalizeEntry(entry) {
    const baseId = String(entry.id || createEntryId()).trim();
    return {
        id: baseId,
        voucherNumber: String(entry.voucherNumber || baseId).trim(),
        date: String(entry.date || getSelectedDateValue()).trim(),
        payee: String(entry.payee || '').trim(),
        requestedBy: String(entry.requestedBy || '').trim(),
        expenseGroup: String(entry.expenseGroup || inferExpenseGroupFromAccount(entry.accountId) || '').trim(),
        accountId: String(entry.accountId || getDefaultAccountForGroup(entry.expenseGroup) || '').trim(),
        amount: Number(entry.amount || 0),
        receiptNumber: String(entry.receiptNumber || '').trim(),
        description: String(entry.description || '').trim(),
        status: ENTRY_STATUSES.includes(String(entry.status || '').trim()) ? String(entry.status).trim() : 'Pending Liquidation',
        replenishmentId: String(entry.replenishmentId || '').trim(),
        createdAt: String(entry.createdAt || isoNow())
    };
}

function normalizeRequest(request) {
    return {
        id: String(request.id || createRequestId()).trim(),
        requestDate: String(request.requestDate || getSelectedDateValue()).trim(),
        reportDate: String(request.reportDate || getSelectedDateValue()).trim(),
        requestedBy: String(request.requestedBy || '').trim(),
        approvedBy: String(request.approvedBy || '').trim(),
        status: REQUEST_STATUSES.includes(String(request.status || '').trim()) ? String(request.status).trim() : 'Draft',
        notes: String(request.notes || '').trim(),
        amount: Number(request.amount || 0),
        entryIds: Array.isArray(request.entryIds) ? request.entryIds.map((item) => String(item).trim()).filter(Boolean) : [],
        createdAt: String(request.createdAt || isoNow())
    };
}

function normalizeSettings(settings) {
    return {
        custodian: String(settings.custodian || '').trim(),
        department: String(settings.department || '').trim(),
        fundLimit: Number(settings.fundLimit || 0),
        openingBalance: Number(settings.openingBalance || 0),
        threshold: Number(settings.threshold || 0)
    };
}

async function loadEmployeeOptions() {
    const currentUser = MargaAuth.getUser();
    const names = new Set(EMPLOYEE_FALLBACK_OPTIONS);
    if (currentUser?.name) names.add(String(currentUser.name).trim());
    names.add('Michael Pineda');

    try {
        const docs = await runQuery({
            from: [{ collectionId: 'tbl_employee' }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'ASCENDING' }],
            limit: 5000
        });
        docs
            .map((doc) => MargaAuth.parseFirestoreDoc(doc))
            .filter(Boolean)
            .filter((employee) => employee.marga_active !== false && employee.active !== false && Number(employee.estatus || 1) !== 0)
            .forEach((employee) => {
                const name = formatEmployeeName(employee);
                if (name) names.add(name);
            });
    } catch (error) {
        console.warn('Unable to load employee dropdown for petty cash:', error);
    }

    PETTY_CASH_STATE.employees = [...names].map((item) => String(item || '').trim()).filter(Boolean);
}

async function loadPayeeOptions() {
    const names = new Set(PAYEE_FALLBACK_OPTIONS);
    PETTY_CASH_STATE.entries.forEach((entry) => {
        if (entry.payee) names.add(String(entry.payee).trim());
    });
    PETTY_CASH_STATE.employees.forEach((name) => {
        if (name) names.add(String(name).trim());
    });

    try {
        const apdRaw = localStorage.getItem('marga_apd_bills_v1');
        if (apdRaw) {
            const bills = JSON.parse(apdRaw);
            if (Array.isArray(bills)) {
                bills.forEach((bill) => {
                    const payee = String(bill?.payee || '').trim();
                    if (payee) names.add(payee);
                });
            }
        }
    } catch (error) {
        console.warn('Unable to read APD payees for petty cash dropdown:', error);
    }

    try {
        const docs = await runQuery({
            from: [{ collectionId: 'tbl_supplier' }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'ASCENDING' }],
            limit: 5000
        });
        docs
            .map((doc) => MargaAuth.parseFirestoreDoc(doc))
            .filter(Boolean)
            .forEach((supplier) => {
                const name = formatSupplierName(supplier);
                if (name) names.add(name);
            });
    } catch (error) {
        console.warn('Unable to load supplier suggestions for petty cash:', error);
    }

    PETTY_CASH_STATE.payees = [...names].map((item) => String(item || '').trim()).filter(Boolean);
}

function formatEmployeeName(employee) {
    if (!employee || typeof employee !== 'object') return '';
    const full = String(
        employee.marga_fullname
        || employee.name
        || `${String(employee.firstname || '').trim()} ${String(employee.lastname || '').trim()}`.trim()
        || employee.nickname
        || employee.username
        || ''
    ).trim();
    return full;
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

function ensureEmployeeOption(name) {
    const normalized = String(name || '').trim();
    if (!normalized) return;
    if (!PETTY_CASH_STATE.employees.includes(normalized)) {
        PETTY_CASH_STATE.employees.push(normalized);
        populateSelects();
    }
}

function ensurePayeeOption(name) {
    const normalized = String(name || '').trim();
    if (!normalized) return;
    if (!PETTY_CASH_STATE.payees.includes(normalized)) {
        PETTY_CASH_STATE.payees.push(normalized);
        populateSelects();
    }
}

async function runQuery(structuredQuery) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        }
    );
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        const message = payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.';
        throw new Error(message);
    }
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean);
}

function persistState() {
    localStorage.setItem(PETTY_CASH_STORAGE_KEYS.entries, JSON.stringify(PETTY_CASH_STATE.entries));
    localStorage.setItem(PETTY_CASH_STORAGE_KEYS.requests, JSON.stringify(PETTY_CASH_STATE.requests));
    localStorage.setItem(PETTY_CASH_STORAGE_KEYS.settings, JSON.stringify(PETTY_CASH_STATE.settings));
}

function resetDemoData() {
    localStorage.removeItem(PETTY_CASH_STORAGE_KEYS.entries);
    localStorage.removeItem(PETTY_CASH_STORAGE_KEYS.requests);
    localStorage.removeItem(PETTY_CASH_STORAGE_KEYS.settings);
    hydrateState();
    fillSettingsForm();
    clearEntryForm();
    clearRequestForm();
    renderAll();
    MargaUtils.showToast('Petty cash demo data reset to defaults.', 'info');
}

function resetTrialEntries() {
    localStorage.removeItem(PETTY_CASH_STORAGE_KEYS.entries);
    localStorage.removeItem(PETTY_CASH_STORAGE_KEYS.requests);
    PETTY_CASH_STATE.entries = cloneData(DEFAULT_ENTRIES).map(normalizeEntry);
    PETTY_CASH_STATE.requests = cloneData(DEFAULT_REQUESTS).map(normalizeRequest);
    reconcileRequests();
    persistState();
    clearEntryForm();
    clearRequestForm();
    renderAll();
    MargaUtils.showToast('Trial petty cash entries and replenishment requests were reset.', 'info');
}

function createEntryId() {
    const highest = PETTY_CASH_STATE.entries.reduce((max, entry) => {
        const value = Number(String(entry.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 1000);
    return `PCV-${highest + 1}`;
}

function createRequestId() {
    const highest = PETTY_CASH_STATE.requests.reduce((max, request) => {
        const value = Number(String(request.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 3000);
    return `REQ-${highest + 1}`;
}

function getSelectedDateValue() {
    const input = document.getElementById('reportDateInput');
    const today = toDateInputValue(startOfDay(new Date()));
    if (!input.value) input.value = today;
    return input.value || today;
}

function readArrayStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return cloneData(fallback);
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : cloneData(fallback);
    } catch (error) {
        console.warn(`Failed to read ${key}:`, error);
        return cloneData(fallback);
    }
}

function readObjectStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return cloneData(fallback);
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : cloneData(fallback);
    } catch (error) {
        console.warn(`Failed to read ${key}:`, error);
        return cloneData(fallback);
    }
}

function upsertById(items, nextItem) {
    const index = items.findIndex((item) => item.id === nextItem.id);
    if (index === -1) {
        items.push(nextItem);
        return;
    }
    items[index] = nextItem;
}

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function sumAmounts(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
}

function isoNow() {
    return new Date().toISOString();
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function offsetDate(days) {
    const base = startOfDay(new Date());
    base.setDate(base.getDate() + Number(days || 0));
    return toDateInputValue(base);
}

function formatLongDate(value) {
    const date = parseDateOnly(value);
    if (!date) return 'No Date';
    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function parseDateOnly(value) {
    if (!value) return null;
    const parts = String(value).split('-').map((item) => Number(item));
    if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}
