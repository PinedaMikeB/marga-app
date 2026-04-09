if (!MargaAuth.requireAccess('apd')) {
    throw new Error('Unauthorized access to APD module.');
}

const APD_STORAGE_KEYS = {
    accounts: MargaFinanceAccounts?.getStorageKey?.() || 'marga_apd_accounts_v1',
    bills: 'marga_apd_bills_v1',
    checks: 'marga_apd_checks_v1'
};

const BILL_STATUSES = [
    'Draft',
    'For Approval',
    'Approved for Payment',
    'For Check Printing',
    'Printed',
    'Released',
    'Cleared',
    'Voided'
];

const CHECK_STATUSES = [
    'For Check Printing',
    'Printed',
    'Released',
    'Cleared',
    'Voided',
    'Spoiled',
    'Skipped'
];

const STATUS_TO_BILL = {
    'For Check Printing': 'For Check Printing',
    Printed: 'Printed',
    Released: 'Released',
    Cleared: 'Cleared',
    Voided: 'Voided'
};

const DEFAULT_BILLS = [
    {
        id: 'APD-1001',
        payee: 'Shell Fleet Card',
        documentType: 'Invoice',
        documentNumber: 'INV-23918',
        dueDate: offsetDate(4),
        accountId: 'fuel_delivery_expense',
        amount: 8420.50,
        status: 'For Approval',
        notes: 'Messenger and delivery fuel for weekly machine transport.',
        createdAt: isoNow()
    },
    {
        id: 'APD-1002',
        payee: 'Metro Copier Supply',
        documentType: 'SOA',
        documentNumber: 'SOA-7710',
        dueDate: offsetDate(2),
        accountId: 'rental_service_supplies_expense',
        amount: 15480.00,
        status: 'Approved for Payment',
        notes: 'Toner and parts consumed under rental package support.',
        createdAt: isoNow()
    },
    {
        id: 'APD-1003',
        payee: 'Land Bank',
        documentType: 'Loan Amortization',
        documentNumber: 'LBA-APR-2026',
        dueDate: offsetDate(7),
        accountId: 'bank_loans_payable',
        amount: 25000.00,
        status: 'For Check Printing',
        notes: 'Principal portion only. Interest tracked separately offline for now.',
        createdAt: isoNow()
    }
];

const DEFAULT_CHECKS = [
    {
        id: 'CHK-9001',
        billId: 'APD-1002',
        bank: 'BDO Operating',
        checkNumber: '001245',
        issueDate: offsetDate(0),
        amount: 15480.00,
        status: 'Printed',
        receiptNumber: '',
        reason: '',
        createdAt: isoNow()
    },
    {
        id: 'CHK-9002',
        billId: 'APD-1003',
        bank: 'Land Bank Current',
        checkNumber: '001246',
        issueDate: offsetDate(1),
        amount: 25000.00,
        status: 'Skipped',
        receiptNumber: '',
        reason: 'Printer jam during batch run. Control number reserved and documented.',
        createdAt: isoNow()
    }
];

const APD_STATE = {
    accounts: [],
    bills: [],
    checks: []
};

const VIEW_STATE = {
    activeView: 'dashboard',
    dashboardOffset: 0
};

const DOC_TYPE_PRESETS = {
    'Loan Amortization': { accountId: 'loan_amortization_lending_institution', planType: 'monthly_term', label: 'Loan Amortization' },
    'Housing Loan': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Housing Loan' },
    'Bank Loan': { accountId: 'bank_loans_payable', planType: 'monthly_term', label: 'Bank Loan' },
    'Credit Card Payment': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Card Payment' },
    'Tuition Fee': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Tuition Fee' },
    'Phone Bill': { accountId: 'telephone_expense', planType: 'repeat_last_amount', label: 'Phone Bill' },
    'Electricity Bill': { accountId: 'electricity_expense', planType: 'repeat_last_amount', label: 'Electricity Bill' },
    'Utility Bill': { accountId: 'internet_expense', planType: 'repeat_last_amount', label: 'Utility Bill' },
    'Personal Withdrawal': { accountId: 'owners_drawings', planType: 'one_time', label: "Owner's Drawings" }
};

const LOAN_DOCUMENT_TYPES = new Set(['Loan Amortization', 'Housing Loan', 'Bank Loan']);

const BILL_STATUS_GUIDE = [
    { status: 'Draft', meaning: 'Encoded but not yet confirmed.' },
    { status: 'For Approval', meaning: 'Ready for management review.' },
    { status: 'Approved for Payment', meaning: 'Approved and waiting to prepare payment.' },
    { status: 'For Check Printing', meaning: 'Approved and ready to issue check.' },
    { status: 'Printed', meaning: 'Check already printed.' },
    { status: 'Released', meaning: 'Check already given to payee.' },
    { status: 'Cleared', meaning: 'Payment already cleared or settled.' },
    { status: 'Voided', meaning: 'Cancelled entry or check.' }
];

document.addEventListener('DOMContentLoaded', () => {
    loadUserHeader();
    hydrateState();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindFormControls();
    bindTabControls();
    bindViewControls();
    populateSelects();
    showView(VIEW_STATE.activeView);
    renderAll();
});

function loadUserHeader() {
    const user = MargaAuth.getUser();
    if (!user) return;
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
    document.getElementById('userAvatar').textContent = String(user.name || 'A').charAt(0).toUpperCase();
}

function hydrateState() {
    APD_STATE.accounts = readStorage(APD_STORAGE_KEYS.accounts, MargaFinanceAccounts.getDefaultAccounts()).map(normalizeAccount);
    APD_STATE.bills = readStorage(APD_STORAGE_KEYS.bills, DEFAULT_BILLS).map(normalizeBill);
    APD_STATE.checks = readStorage(APD_STORAGE_KEYS.checks, DEFAULT_CHECKS).map(normalizeCheck);
}

function bindFormControls() {
    document.getElementById('billForm').addEventListener('submit', onBillSubmit);
    document.getElementById('checkForm').addEventListener('submit', onCheckSubmit);
    document.getElementById('billFormClearBtn').addEventListener('click', clearBillForm);
    document.getElementById('checkFormClearBtn').addEventListener('click', clearCheckForm);
    document.getElementById('billDocTypeInput').addEventListener('change', onBillDocTypeChange);
    document.getElementById('billPlanTypeInput').addEventListener('change', updatePlanHint);
    document.getElementById('billSimpleLoanModeInput').addEventListener('change', syncLoanFields);
    document.getElementById('accountSearchInput').addEventListener('input', renderAccountCards);
    document.getElementById('accountScopeFilter').addEventListener('change', renderAccountCards);
    document.getElementById('billSearchInput').addEventListener('input', renderBillsTable);
    document.getElementById('billStatusFilter').addEventListener('change', renderBillsTable);
    document.getElementById('checkStatusFilter').addEventListener('change', renderChecksTable);
    document.getElementById('checkBillSelect').addEventListener('change', syncCheckBillSelection);
    document.getElementById('resetDemoBtn').addEventListener('click', resetDemoData);
    document.getElementById('billsTableBody').addEventListener('click', onBillTableAction);
    document.getElementById('checksTableBody').addEventListener('click', onCheckTableAction);
    document.getElementById('manageAccountsBtn').addEventListener('click', openAccountManager);
    document.getElementById('accountForm').addEventListener('submit', onAccountSubmit);
    document.getElementById('accountFormClearBtn').addEventListener('click', clearAccountForm);
    document.getElementById('newAccountBtn').addEventListener('click', clearAccountForm);
    document.querySelectorAll('[data-open-status-guide]').forEach((button) => {
        button.addEventListener('click', openStatusGuide);
    });
    document.querySelectorAll('[data-close-account-manager]').forEach((button) => {
        button.addEventListener('click', closeAccountManager);
    });
    document.querySelectorAll('[data-close-status-guide]').forEach((button) => {
        button.addEventListener('click', closeStatusGuide);
    });
    document.getElementById('accountManagerTableBody').addEventListener('click', onAccountTableAction);
    syncLoanFields();
    syncSeriesEditFields();
}

function bindTabControls() {
    document.querySelectorAll('[data-tab-target]').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.tabTarget));
    });
}

function bindViewControls() {
    document.getElementById('showDashboardBtn').addEventListener('click', () => showView('dashboard'));
    document.getElementById('openWorkspaceBtn').addEventListener('click', () => {
        showView('workspace');
        setActiveTab('payable-intake');
    });
    document.getElementById('prevWindowBtn').addEventListener('click', () => {
        VIEW_STATE.dashboardOffset -= 1;
        renderDashboardMatrix();
    });
    document.getElementById('nextWindowBtn').addEventListener('click', () => {
        VIEW_STATE.dashboardOffset += 1;
        renderDashboardMatrix();
    });
    document.getElementById('dashboardMatrixBody').addEventListener('click', onDashboardMatrixClick);
}

function populateSelects() {
    const accounts = getAccounts();
    const billAccountInput = document.getElementById('billAccountInput');
    billAccountInput.innerHTML = accounts.map((account) => (
        `<option value="${account.id}">${MargaUtils.escapeHtml(account.name)} (${account.type})</option>`
    )).join('');

    const billStatusInput = document.getElementById('billStatusInput');
    billStatusInput.innerHTML = BILL_STATUSES.map((status) => `<option value="${status}">${MargaUtils.escapeHtml(status)}</option>`).join('');

    const billStatusFilter = document.getElementById('billStatusFilter');
    billStatusFilter.innerHTML = '<option value="all">All Statuses</option>' + BILL_STATUSES.map((status) => `<option value="${status}">${MargaUtils.escapeHtml(status)}</option>`).join('');

    const checkStatusInput = document.getElementById('checkStatusInput');
    checkStatusInput.innerHTML = CHECK_STATUSES.map((status) => `<option value="${status}">${MargaUtils.escapeHtml(status)}</option>`).join('');

    const checkStatusFilter = document.getElementById('checkStatusFilter');
    checkStatusFilter.innerHTML = '<option value="all">All Check Statuses</option>' + CHECK_STATUSES.map((status) => `<option value="${status}">${MargaUtils.escapeHtml(status)}</option>`).join('');

    populateBillSelect();
    updatePlanHint();
}

function populateBillSelect(selectedId = '') {
    const select = document.getElementById('checkBillSelect');
    const options = APD_STATE.bills
        .slice()
        .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)))
        .map((bill) => {
            const account = getAccountById(bill.accountId);
            return `<option value="${bill.id}">${MargaUtils.escapeHtml(bill.id)} · ${MargaUtils.escapeHtml(bill.payee)} · ${MargaUtils.escapeHtml(account?.name || '')} · ${MargaUtils.formatCurrency(bill.amount)}</option>`;
        })
        .join('');
    select.innerHTML = `<option value="">Select payable</option>${options}`;
    select.value = selectedId || '';
}

function renderAll() {
    renderOverview();
    renderDashboardMatrix();
    renderAccountCards();
    renderAccountManagerTable();
    renderStatusGuideTable();
    renderBillsTable();
    renderChecksTable();
    renderAlerts();
    populateBillSelect(document.getElementById('checkBillSelect').value);
}

function renderOverview() {
    const today = startOfDay(new Date());
    const nextWeek = addDays(today, 7);
    const openBills = APD_STATE.bills.filter((bill) => !['Cleared', 'Voided'].includes(bill.status));
    const dueThisWeek = openBills.filter((bill) => {
        const due = parseDateOnly(bill.dueDate);
        return due && due >= today && due <= nextWeek;
    });
    const approved = openBills.filter((bill) => ['Approved for Payment', 'For Check Printing'].includes(bill.status));
    const printedChecks = APD_STATE.checks.filter((check) => ['Printed', 'Released', 'Cleared'].includes(check.status));
    const alerts = APD_STATE.checks.filter((check) => ['Skipped', 'Spoiled', 'Voided'].includes(check.status));

    document.getElementById('statDueWeek').textContent = MargaUtils.formatCurrency(sumAmounts(dueThisWeek.map((bill) => bill.amount)));
    document.getElementById('statDueWeekMeta').textContent = `${dueThisWeek.length} bill(s)`;
    document.getElementById('statApprovedCount').textContent = approved.length.toLocaleString();
    document.getElementById('statApprovedMeta').textContent = `${MargaUtils.formatCurrency(sumAmounts(approved.map((bill) => bill.amount)))} scheduled`;
    document.getElementById('statPrintedCount').textContent = printedChecks.length.toLocaleString();
    document.getElementById('statPrintedMeta').textContent = `${MargaUtils.formatCurrency(sumAmounts(printedChecks.map((check) => check.amount)))} in control register`;
    document.getElementById('statAlertCount').textContent = alerts.length.toLocaleString();
    document.getElementById('statAlertMeta').textContent = alerts.length ? 'Needs audit explanation' : 'No control exceptions';
}

function renderDashboardMatrix() {
    const months = getDashboardMonths();
    const head = document.getElementById('dashboardMatrixHead');
    const body = document.getElementById('dashboardMatrixBody');
    const foot = document.getElementById('dashboardMatrixFoot');
    const matrixBills = APD_STATE.bills.filter((bill) => bill.status !== 'Voided');
    const rowMap = new Map();

    matrixBills.forEach((bill) => {
        const label = getDashboardLabel(bill);
        if (!rowMap.has(label)) rowMap.set(label, []);
        rowMap.get(label).push(bill);
    });

    head.innerHTML = `
        <tr>
            <th>Account Payables Dashboard</th>
            ${months.map((month) => `<th>${MargaUtils.escapeHtml(formatMonthHeading(month))}</th>`).join('')}
        </tr>
    `;

    const labels = [...rowMap.keys()].sort((left, right) => left.localeCompare(right));
    body.innerHTML = labels.map((label) => {
        const bills = rowMap.get(label) || [];
        return `
            <tr>
                <td class="dashboard-row-label" title="${MargaUtils.escapeHtml(label)}">${MargaUtils.escapeHtml(label)}</td>
                ${months.map((month) => renderDashboardCell(label, month, bills)).join('')}
            </tr>
        `;
    }).join('') || `<tr><td class="dashboard-row-label">No payables yet</td>${months.map(() => '<td class="dashboard-cell dashboard-empty">-</td>').join('')}</tr>`;

    const totalByMonth = months.map((month) => sumAmounts(matrixBills.filter((bill) => isSameMonth(bill.dueDate, month)).map((bill) => bill.amount)));
    const paidByMonth = months.map((month) => sumAmounts(matrixBills
        .filter((bill) => isSameMonth(bill.dueDate, month) && bill.status === 'Cleared')
        .map((bill) => bill.amount)));
    const netByMonth = totalByMonth.map((amount, index) => Math.max(amount - paidByMonth[index], 0));

    foot.innerHTML = `
        ${renderSummaryRow('Total Payables', totalByMonth)}
        ${renderSummaryRow('Paid', paidByMonth)}
        ${renderSummaryRow('Net Payables', netByMonth)}
    `;

    document.getElementById('dashboardWindowLabel').textContent = `${formatMonthHeading(months[0])} to ${formatMonthHeading(months[months.length - 1])}`;
}

function renderDashboardCell(label, month, bills) {
    const monthBills = bills.filter((bill) => isSameMonth(bill.dueDate, month));
    if (!monthBills.length) {
        return '<td class="dashboard-cell dashboard-empty"></td>';
    }
    const total = sumAmounts(monthBills.map((bill) => bill.amount));
    const ids = monthBills.map((bill) => bill.id).join(',');
    const fullyPaid = monthBills.every((bill) => bill.status === 'Cleared');
    const title = monthBills.length > 1
        ? `${label}: ${monthBills.length} payables in ${formatMonthHeading(month)}`
        : `${label}: ${MargaUtils.formatCurrency(total)}`;
    return `
        <td class="dashboard-cell">
            <button type="button" class="dashboard-amount-btn ${fullyPaid ? 'is-paid' : ''}" data-bill-ids="${MargaUtils.escapeHtml(ids)}" title="${MargaUtils.escapeHtml(title)}">
                ${MargaUtils.formatCurrency(total)}
            </button>
        </td>
    `;
}

function renderSummaryRow(label, values) {
    return `
        <tr>
            <td class="dashboard-summary-label">${MargaUtils.escapeHtml(label)}</td>
            ${values.map((value) => `<td class="dashboard-cell dashboard-summary-label">${value ? MargaUtils.formatCurrency(value) : ''}</td>`).join('')}
        </tr>
    `;
}

function showView(viewKey) {
    VIEW_STATE.activeView = viewKey === 'workspace' ? 'workspace' : 'dashboard';
    document.getElementById('dashboardHome').classList.toggle('hidden', VIEW_STATE.activeView !== 'dashboard');
    document.getElementById('workspaceHome').classList.toggle('hidden', VIEW_STATE.activeView !== 'workspace');
    document.getElementById('showDashboardBtn').classList.toggle('btn-primary', VIEW_STATE.activeView === 'dashboard');
    document.getElementById('showDashboardBtn').classList.toggle('btn-secondary', VIEW_STATE.activeView !== 'dashboard');
    document.getElementById('openWorkspaceBtn').classList.toggle('btn-primary', VIEW_STATE.activeView === 'workspace');
    document.getElementById('openWorkspaceBtn').classList.toggle('btn-secondary', VIEW_STATE.activeView !== 'workspace');
}

function updatePlanHint() {
    const planType = String(document.getElementById('billPlanTypeInput').value || 'one_time');
    const hint = document.getElementById('billPlanHint');
    const recurrenceRow = document.getElementById('recurrenceFieldsRow');
    if (planType === 'one_time') {
        recurrenceRow.classList.add('hidden');
        hint.textContent = 'Use one-time for normal invoices, SOAs, and personal owner drawings.';
        return;
    }
    recurrenceRow.classList.remove('hidden');
    if (planType === 'monthly_term') {
        hint.textContent = 'Use monthly fixed term for housing loan, bank loan, card payment, tuition, and any fixed monthly amount. Remaining years and months will auto-generate future payables.';
        return;
    }
    hint.textContent = 'Use repeat last bill amount for electricity, mobile phones, internet, and similar bills when you want to copy the latest amount forward and edit later if the actual bill changes.';
}

function applyDocTypePreset() {
    const docType = String(document.getElementById('billDocTypeInput').value || '').trim();
    const preset = DOC_TYPE_PRESETS[docType];
    if (!preset || document.getElementById('billIdInput').value) return;
    document.getElementById('billPlanTypeInput').value = preset.planType;
    if (getAccountById(preset.accountId)) {
        document.getElementById('billAccountInput').value = preset.accountId;
    }
    if (!String(document.getElementById('billDashboardLabelInput').value || '').trim()) {
        document.getElementById('billDashboardLabelInput').value = preset.label;
    }
    updatePlanHint();
}

function onBillDocTypeChange() {
    applyDocTypePreset();
    const isEditing = Boolean(String(document.getElementById('billIdInput').value || '').trim());
    const docType = String(document.getElementById('billDocTypeInput').value || '').trim();

    if (!isEditing && isLoanDocumentType(docType)) {
        document.getElementById('billSimpleLoanModeInput').checked = true;
        document.getElementById('billBreakdownPendingInput').checked = true;
        clearLoanBreakdownInputs();
    }

    if (!isEditing && !isLoanDocumentType(docType)) {
        document.getElementById('billSimpleLoanModeInput').checked = false;
        document.getElementById('billBreakdownPendingInput').checked = false;
        clearLoanBreakdownInputs();
    }

    syncLoanFields();
}

function isLoanDocumentType(documentType) {
    return LOAN_DOCUMENT_TYPES.has(String(documentType || '').trim());
}

function clearLoanBreakdownInputs() {
    document.getElementById('billPrincipalAmountInput').value = '';
    document.getElementById('billInterestAmountInput').value = '';
    document.getElementById('billPenaltyAmountInput').value = '';
}

function syncLoanFields() {
    const docType = String(document.getElementById('billDocTypeInput').value || '').trim();
    const isLoan = isLoanDocumentType(docType);
    const simpleLoanMode = document.getElementById('billSimpleLoanModeInput').checked;
    const setupPanel = document.getElementById('billLoanSetupPanel');
    const breakdownPanel = document.getElementById('billBreakdownPanel');
    const hint = document.getElementById('billLoanModeHint');

    setupPanel.classList.toggle('hidden', !isLoan);
    breakdownPanel.classList.toggle('hidden', !isLoan || simpleLoanMode);

    if (!isLoan) {
        hint.textContent = 'Simple mode keeps one monthly amount in APD now and lets you split principal and interest later.';
        return;
    }

    if (simpleLoanMode) {
        document.getElementById('billBreakdownPendingInput').checked = true;
        hint.textContent = 'Simple mode keeps one monthly amount in APD now and marks the principal and interest split as pending.';
        return;
    }

    hint.textContent = 'Full accounting mode lets you split one payable into principal, interest, and penalty before the check is issued.';
}

function syncSeriesEditFields() {
    const billId = String(document.getElementById('billIdInput').value || '').trim();
    const seriesId = String(document.getElementById('billSeriesIdInput').value || '').trim();
    const seriesIndex = Number(document.getElementById('billSeriesIndexInput').value || 0);
    const panel = document.getElementById('billSeriesEditPanel');
    const checkbox = document.getElementById('billCascadeFutureInput');
    const showSeriesEdit = Boolean(billId && seriesId && seriesIndex > 0);
    panel.classList.toggle('hidden', !showSeriesEdit);
    checkbox.checked = showSeriesEdit;
}

function renderAccountCards() {
    const grid = document.getElementById('accountGuideGrid');
    const search = String(document.getElementById('accountSearchInput').value || '').trim().toLowerCase();
    const scope = String(document.getElementById('accountScopeFilter').value || 'all').trim().toLowerCase();
    const accounts = getAccounts().filter((account) => {
        const haystack = `${account.name} ${account.meaning} ${account.useWhen} ${account.avoid}`.toLowerCase();
        const scopeMatch = scope === 'all' || account.scope === scope || (scope === 'pettycash' && (account.scope === 'shared' || account.scope === 'pettycash'));
        return scopeMatch && (!search || haystack.includes(search));
    });

    if (!accounts.length) {
        grid.innerHTML = '<div class="empty-state">No shared account matched your search.</div>';
        return;
    }

    grid.innerHTML = accounts.map((account) => `
        <article class="account-card">
            <div class="account-card-header">
                <div>
                    <h4>${MargaUtils.escapeHtml(account.name)}</h4>
                </div>
                <div class="account-tags">
                    <span class="type-badge ${slugify(account.type)}">${MargaUtils.escapeHtml(account.type)}</span>
                    <span class="scope-badge ${account.scope}">${formatScope(account.scope)}</span>
                </div>
            </div>
            <div class="account-copy">
                <p><strong>Meaning:</strong> ${MargaUtils.escapeHtml(account.meaning)}</p>
                <p><strong>Use This When:</strong> ${MargaUtils.escapeHtml(account.useWhen)}</p>
                <p><strong>Do Not Use For:</strong> ${MargaUtils.escapeHtml(account.avoid)}</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm use-account-btn" data-account-id="${account.id}">Use In Payable Form</button>
        </article>
    `).join('');

    grid.querySelectorAll('[data-account-id]').forEach((button) => {
        button.addEventListener('click', () => {
            showView('workspace');
            setActiveTab('payable-intake');
            document.getElementById('billAccountInput').value = button.dataset.accountId;
            document.getElementById('billAccountInput').focus();
            MargaUtils.showToast('Account selected in payable form.', 'info');
        });
    });
}

function renderAccountManagerTable() {
    const tbody = document.getElementById('accountManagerTableBody');
    if (!tbody) return;
    const rows = getAccounts().slice().sort((left, right) => left.name.localeCompare(right.name));
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">No account found.</div></td></tr>';
        return;
    }
    tbody.innerHTML = rows.map((account) => `
        <tr>
            <td>
                <div class="ref-cell">
                    <span class="ref-primary">${MargaUtils.escapeHtml(account.name)}</span>
                    <span class="ref-secondary">${MargaUtils.escapeHtml(account.meaning || '')}</span>
                </div>
            </td>
            <td><span class="type-badge ${slugify(account.type)}">${MargaUtils.escapeHtml(account.type)}</span></td>
            <td><span class="scope-badge ${account.scope}">${formatScope(account.scope)}</span></td>
            <td>
                <div class="row-actions">
                    <button type="button" class="row-btn" data-action="view-account" data-id="${account.id}">View</button>
                    <button type="button" class="row-btn" data-action="edit-account" data-id="${account.id}">Edit</button>
                    <button type="button" class="row-btn" data-action="delete-account" data-id="${account.id}">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderStatusGuideTable() {
    const tbody = document.getElementById('statusGuideTableBody');
    if (!tbody) return;
    tbody.innerHTML = BILL_STATUS_GUIDE.map((item) => `
        <tr>
            <td><span class="status-badge ${slugify(item.status)}">${MargaUtils.escapeHtml(item.status)}</span></td>
            <td>${MargaUtils.escapeHtml(item.meaning)}</td>
        </tr>
    `).join('');
}

function renderBillsTable() {
    const tbody = document.getElementById('billsTableBody');
    const search = String(document.getElementById('billSearchInput').value || '').trim().toLowerCase();
    const statusFilter = String(document.getElementById('billStatusFilter').value || 'all');
    const rows = APD_STATE.bills
        .filter((bill) => {
            const account = getAccountById(bill.accountId);
            const haystack = `${bill.id} ${bill.dashboardLabel || ''} ${bill.payee} ${bill.documentNumber} ${account?.name || ''}`.toLowerCase();
            return (!search || haystack.includes(search)) && (statusFilter === 'all' || bill.status === statusFilter);
        })
        .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No payable matched the current filters.</div></td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((bill) => {
        const account = getAccountById(bill.accountId);
        const billMeta = [bill.documentType, bill.documentNumber];
        if (isLoanDocumentType(bill.documentType) && bill.simpleLoanMode) {
            billMeta.push('Simple Loan Mode');
        }
        if (bill.breakdownPending) {
            billMeta.push('Breakdown Pending');
        }
        return `
            <tr>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${MargaUtils.escapeHtml(bill.dashboardLabel || bill.id)}</span>
                        <span class="ref-secondary">${MargaUtils.escapeHtml(billMeta.join(' · '))}</span>
                    </div>
                </td>
                <td>${MargaUtils.escapeHtml(bill.payee)}</td>
                <td>${MargaUtils.escapeHtml(account?.name || 'Unknown Account')}</td>
                <td>
                    <div class="ref-cell">
                        <span>${MargaUtils.formatDate(bill.dueDate, 'long')}</span>
                        <span class="due-badge ${getDueClass(bill.dueDate, bill.status)}">${getDueLabel(bill.dueDate, bill.status)}</span>
                    </div>
                </td>
                <td><span class="amount-strong">${MargaUtils.formatCurrency(bill.amount)}</span></td>
                <td><span class="status-badge ${slugify(bill.status)}">${MargaUtils.escapeHtml(bill.status)}</span></td>
                <td>
                    <div class="row-actions">
                        <button type="button" class="row-btn" data-action="edit-bill" data-id="${bill.id}">Edit</button>
                        <button type="button" class="row-btn" data-action="link-check" data-id="${bill.id}">Use In Check</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderChecksTable() {
    const tbody = document.getElementById('checksTableBody');
    const statusFilter = String(document.getElementById('checkStatusFilter').value || 'all');
    const rows = APD_STATE.checks
        .filter((check) => statusFilter === 'all' || check.status === statusFilter)
        .sort((left, right) => String(right.issueDate).localeCompare(String(left.issueDate)));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">No check record matched the current filter.</div></td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((check) => {
        const bill = APD_STATE.bills.find((item) => item.id === check.billId);
        return `
            <tr>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${MargaUtils.escapeHtml(check.checkNumber)}</span>
                        <span class="ref-secondary">${MargaUtils.escapeHtml(check.billId)}</span>
                    </div>
                </td>
                <td>${MargaUtils.escapeHtml(bill?.payee || 'Unlinked Payable')}</td>
                <td>${MargaUtils.escapeHtml(check.bank || '-')}</td>
                <td>${MargaUtils.formatDate(check.issueDate, 'long')}</td>
                <td><span class="amount-strong">${MargaUtils.formatCurrency(check.amount)}</span></td>
                <td><span class="status-badge ${slugify(check.status)}">${MargaUtils.escapeHtml(check.status)}</span></td>
                <td>${MargaUtils.escapeHtml(check.receiptNumber || '-')}</td>
                <td>
                    <div class="row-actions">
                        <button type="button" class="row-btn" data-action="edit-check" data-id="${check.id}">Edit</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAlerts() {
    const list = document.getElementById('controlAlertList');
    const alerts = APD_STATE.checks.filter((check) => ['Skipped', 'Spoiled', 'Voided'].includes(check.status));

    if (!alerts.length) {
        list.innerHTML = '<div class="empty-state">No skipped, spoiled, or voided check number is waiting for audit review.</div>';
        return;
    }

    list.innerHTML = alerts.map((check) => {
        const bill = APD_STATE.bills.find((item) => item.id === check.billId);
        return `
            <article class="alert-item">
                <strong>${MargaUtils.escapeHtml(check.status)} Check ${MargaUtils.escapeHtml(check.checkNumber)}</strong>
                <span>${MargaUtils.escapeHtml(check.bank || 'Bank not specified')} · ${MargaUtils.escapeHtml(bill?.payee || check.billId)} · ${MargaUtils.formatDate(check.issueDate, 'long')}</span>
                <span>${MargaUtils.escapeHtml(check.reason || 'No control reason provided.')}</span>
            </article>
        `;
    }).join('');
}

function onBillSubmit(event) {
    event.preventDefault();
    const billId = String(document.getElementById('billIdInput').value || '').trim();
    const documentType = document.getElementById('billDocTypeInput').value;
    const isLoan = isLoanDocumentType(documentType);
    const simpleLoanMode = isLoan ? document.getElementById('billSimpleLoanModeInput').checked : false;
    const base = normalizeBill({
        id: billId || createBillId(),
        dashboardLabel: document.getElementById('billDashboardLabelInput').value,
        payee: document.getElementById('billPayeeInput').value,
        documentType,
        documentNumber: document.getElementById('billDocNumberInput').value,
        dueDate: document.getElementById('billDueDateInput').value,
        accountId: document.getElementById('billAccountInput').value,
        amount: document.getElementById('billAmountInput').value,
        status: document.getElementById('billStatusInput').value,
        planType: document.getElementById('billPlanTypeInput').value,
        remainingYears: document.getElementById('billRemainingYearsInput').value,
        remainingMonths: document.getElementById('billRemainingMonthsInput').value,
        simpleLoanMode,
        breakdownPending: isLoan ? (simpleLoanMode || document.getElementById('billBreakdownPendingInput').checked) : false,
        principalAmount: isLoan && !simpleLoanMode ? document.getElementById('billPrincipalAmountInput').value : 0,
        interestAmount: isLoan && !simpleLoanMode ? document.getElementById('billInterestAmountInput').value : 0,
        penaltyAmount: isLoan && !simpleLoanMode ? document.getElementById('billPenaltyAmountInput').value : 0,
        notes: document.getElementById('billNotesInput').value,
        createdAt: isoNow()
    });

    if (!base.payee || !base.documentNumber || !base.accountId || !base.dueDate || !(base.amount > 0)) {
        MargaUtils.showToast('Complete the payable form before saving.', 'error');
        return;
    }

    if (isLoan && !base.simpleLoanMode) {
        const breakdownTotal = Number(base.principalAmount || 0) + Number(base.interestAmount || 0) + Number(base.penaltyAmount || 0);
        if (!(breakdownTotal > 0)) {
            MargaUtils.showToast('Enter the principal, interest, or penalty breakdown for this loan.', 'error');
            return;
        }
        if (Math.abs(breakdownTotal - Number(base.amount || 0)) > 0.01) {
            MargaUtils.showToast('Loan breakdown must match the payable amount.', 'error');
            return;
        }
    }

    let savedCount = 1;
    if (billId) {
        const original = APD_STATE.bills.find((bill) => bill.id === billId);
        const shouldCascade = Boolean(
            original?.seriesId
            && original?.seriesIndex
            && document.getElementById('billCascadeFutureInput').checked
        );

        if (shouldCascade) {
            const futureBills = APD_STATE.bills.filter((bill) => (
                bill.seriesId === original.seriesId && bill.seriesIndex >= original.seriesIndex
            ));
            futureBills.forEach((bill) => {
                const updatedBill = normalizeBill({
                    ...bill,
                    dashboardLabel: base.dashboardLabel,
                    payee: base.payee,
                    documentType: base.documentType,
                    accountId: base.accountId,
                    amount: base.amount,
                    status: base.status,
                    simpleLoanMode: base.simpleLoanMode,
                    breakdownPending: base.breakdownPending,
                    principalAmount: base.principalAmount,
                    interestAmount: base.interestAmount,
                    penaltyAmount: base.penaltyAmount,
                    notes: base.notes
                });
                upsertById(APD_STATE.bills, updatedBill);
            });
            savedCount = futureBills.length;
        } else {
            upsertById(APD_STATE.bills, {
                ...base,
                seriesId: original?.seriesId || '',
                seriesIndex: original?.seriesIndex || 1,
                seriesTotal: original?.seriesTotal || 1
            });
        }
    } else {
        const plannedBills = createBillsFromPlan(base);
        savedCount = plannedBills.length;
        plannedBills.forEach((bill) => APD_STATE.bills.push(bill));
    }

    persistState();
    focusDashboardOnDueDate(base.dueDate);
    clearBillForm();
    populateBillSelect();
    showView('dashboard');
    renderAll();
    const actionLabel = billId ? 'updated' : 'saved';
    MargaUtils.showToast(savedCount > 1
        ? `${savedCount} payables ${actionLabel} for ${getDashboardLabel(base)}.`
        : `Payable ${actionLabel} for ${getDashboardLabel(base)}.`, 'success');
}

function onCheckSubmit(event) {
    event.preventDefault();
    const checkId = String(document.getElementById('checkIdInput').value || '').trim();
    const next = normalizeCheck({
        id: checkId || createCheckId(),
        billId: document.getElementById('checkBillSelect').value,
        bank: document.getElementById('checkBankInput').value,
        checkNumber: document.getElementById('checkNumberInput').value,
        issueDate: document.getElementById('checkIssueDateInput').value,
        amount: document.getElementById('checkAmountInput').value,
        status: document.getElementById('checkStatusInput').value,
        receiptNumber: document.getElementById('checkReceiptInput').value,
        reason: document.getElementById('checkReasonInput').value,
        createdAt: isoNow()
    });

    if (!next.billId || !next.checkNumber || !next.issueDate || !(next.amount > 0)) {
        MargaUtils.showToast('Complete the check register form before saving.', 'error');
        return;
    }

    if (['Skipped', 'Spoiled', 'Voided'].includes(next.status) && !next.reason) {
        MargaUtils.showToast('Control reason is required for skipped, spoiled, or voided checks.', 'error');
        return;
    }

    const duplicate = APD_STATE.checks.find((item) => item.id !== next.id && item.checkNumber === next.checkNumber && String(item.bank || '').toLowerCase() === String(next.bank || '').toLowerCase());
    if (duplicate) {
        MargaUtils.showToast('This check number already exists for the same bank.', 'error');
        return;
    }

    upsertById(APD_STATE.checks, next);
    syncBillStatusFromCheck(next);
    persistState();
    clearCheckForm();
    renderAll();
    MargaUtils.showToast('Check register updated.', 'success');
}

function syncBillStatusFromCheck(check) {
    const bill = APD_STATE.bills.find((item) => item.id === check.billId);
    if (!bill) return;
    const mapped = STATUS_TO_BILL[check.status];
    if (mapped) {
        bill.status = mapped;
    }
}

function syncCheckBillSelection() {
    const bill = APD_STATE.bills.find((item) => item.id === document.getElementById('checkBillSelect').value);
    if (!bill) return;
    document.getElementById('checkAmountInput').value = Number(bill.amount || 0).toFixed(2);
    if (!document.getElementById('checkBankInput').value) {
        document.getElementById('checkBankInput').value = 'Operating Check Account';
    }
}

function onBillTableAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const bill = APD_STATE.bills.find((item) => item.id === button.dataset.id);
    if (!bill) return;

    if (button.dataset.action === 'edit-bill') {
        showView('workspace');
        setActiveTab('payable-intake');
        fillBillForm(bill);
        return;
    }

    if (button.dataset.action === 'link-check') {
        showView('workspace');
        setActiveTab('check-register-entry');
        document.getElementById('checkBillSelect').value = bill.id;
        syncCheckBillSelection();
        document.getElementById('checkNumberInput').focus();
    }
}

function onCheckTableAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const check = APD_STATE.checks.find((item) => item.id === button.dataset.id);
    if (!check) return;
    if (button.dataset.action === 'edit-check') {
        showView('workspace');
        setActiveTab('check-register-entry');
        document.getElementById('checkIdInput').value = check.id;
        populateBillSelect(check.billId);
        document.getElementById('checkBillSelect').value = check.billId;
        document.getElementById('checkBankInput').value = check.bank || '';
        document.getElementById('checkNumberInput').value = check.checkNumber;
        document.getElementById('checkIssueDateInput').value = check.issueDate;
        document.getElementById('checkAmountInput').value = Number(check.amount || 0).toFixed(2);
        document.getElementById('checkStatusInput').value = check.status;
        document.getElementById('checkReceiptInput').value = check.receiptNumber || '';
        document.getElementById('checkReasonInput').value = check.reason || '';
    }
}

function onAccountTableAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const account = getAccountById(button.dataset.id);
    if (!account) return;

    if (button.dataset.action === 'view-account' || button.dataset.action === 'edit-account') {
        fillAccountForm(account);
        document.getElementById('accountFormTitle').textContent = button.dataset.action === 'view-account' ? 'View Or Edit Account' : 'Edit Account';
        if (button.dataset.action === 'edit-account') {
            document.getElementById('accountNameInput').focus();
        }
        return;
    }

    if (button.dataset.action === 'delete-account') {
        const used = APD_STATE.bills.some((bill) => bill.accountId === account.id);
        if (used) {
            MargaUtils.showToast('This account is already used by payables and cannot be removed yet.', 'error');
            return;
        }
        APD_STATE.accounts = APD_STATE.accounts.filter((item) => item.id !== account.id);
        persistState();
        clearAccountForm();
        refreshAccountViews();
        MargaUtils.showToast('Account removed.', 'info');
    }
}

function clearBillForm() {
    document.getElementById('billForm').reset();
    document.getElementById('billIdInput').value = '';
    document.getElementById('billSeriesIdInput').value = '';
    document.getElementById('billSeriesIndexInput').value = '';
    document.getElementById('billStatusInput').value = 'Draft';
    document.getElementById('billPlanTypeInput').value = 'one_time';
    document.getElementById('billRemainingYearsInput').value = '0';
    document.getElementById('billRemainingMonthsInput').value = '0';
    document.getElementById('billCascadeFutureInput').checked = false;
    document.getElementById('billSimpleLoanModeInput').checked = false;
    document.getElementById('billBreakdownPendingInput').checked = false;
    clearLoanBreakdownInputs();
    document.getElementById('billAccountInput').selectedIndex = 0;
    updatePlanHint();
    syncLoanFields();
    syncSeriesEditFields();
}

function clearCheckForm() {
    document.getElementById('checkForm').reset();
    document.getElementById('checkIdInput').value = '';
    document.getElementById('checkStatusInput').value = 'For Check Printing';
    populateBillSelect();
}

function clearAccountForm() {
    document.getElementById('accountForm').reset();
    document.getElementById('accountIdInput').value = '';
    document.getElementById('accountTypeInput').value = 'Expense';
    document.getElementById('accountScopeInput').value = 'shared';
    document.getElementById('accountFormTitle').textContent = 'Add Account';
}

function resetDemoData() {
    localStorage.removeItem(APD_STORAGE_KEYS.accounts);
    localStorage.removeItem(APD_STORAGE_KEYS.bills);
    localStorage.removeItem(APD_STORAGE_KEYS.checks);
    VIEW_STATE.dashboardOffset = 0;
    hydrateState();
    clearBillForm();
    clearCheckForm();
    showView('dashboard');
    renderAll();
    MargaUtils.showToast('APD demo data reset to defaults.', 'info');
}

function persistState() {
    localStorage.setItem(APD_STORAGE_KEYS.accounts, JSON.stringify(APD_STATE.accounts));
    localStorage.setItem(APD_STORAGE_KEYS.bills, JSON.stringify(APD_STATE.bills));
    localStorage.setItem(APD_STORAGE_KEYS.checks, JSON.stringify(APD_STATE.checks));
}

function readStorage(key, fallback) {
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

function normalizeBill(bill) {
    const documentType = String(bill.documentType || 'Invoice').trim();
    const principalAmount = Number(bill.principalAmount || 0);
    const interestAmount = Number(bill.interestAmount || 0);
    const penaltyAmount = Number(bill.penaltyAmount || 0);
    const hasLoanBreakdown = principalAmount > 0 || interestAmount > 0 || penaltyAmount > 0;
    const loanDocument = isLoanDocumentType(documentType);
    return {
        id: String(bill.id || createBillId()).trim(),
        dashboardLabel: String(bill.dashboardLabel || '').trim(),
        payee: String(bill.payee || '').trim(),
        documentType,
        documentNumber: String(bill.documentNumber || '').trim(),
        dueDate: String(bill.dueDate || '').trim(),
        accountId: String(bill.accountId || '').trim(),
        amount: Number(bill.amount || 0),
        status: BILL_STATUSES.includes(String(bill.status || '').trim()) ? String(bill.status).trim() : 'Draft',
        planType: String(bill.planType || 'one_time').trim(),
        remainingYears: Number(bill.remainingYears || 0),
        remainingMonths: Number(bill.remainingMonths || 0),
        simpleLoanMode: loanDocument ? ('simpleLoanMode' in bill ? Boolean(bill.simpleLoanMode) : !hasLoanBreakdown) : false,
        breakdownPending: loanDocument ? ('breakdownPending' in bill ? Boolean(bill.breakdownPending) : !hasLoanBreakdown) : false,
        principalAmount,
        interestAmount,
        penaltyAmount,
        seriesId: String(bill.seriesId || '').trim(),
        seriesIndex: Number(bill.seriesIndex || 1),
        seriesTotal: Number(bill.seriesTotal || 1),
        notes: String(bill.notes || '').trim(),
        createdAt: String(bill.createdAt || isoNow())
    };
}

function normalizeAccount(account) {
    return MargaFinanceAccounts.normalizeAccount({
        id: String(account.id || createAccountId()).trim(),
        name: String(account.name || '').trim(),
        type: String(account.type || 'Expense').trim(),
        scope: String(account.scope || 'shared').trim().toLowerCase(),
        meaning: String(account.meaning || '').trim(),
        useWhen: String(account.useWhen || '').trim(),
        avoid: String(account.avoid || '').trim()
    });
}

function normalizeCheck(check) {
    return {
        id: String(check.id || createCheckId()).trim(),
        billId: String(check.billId || '').trim(),
        bank: String(check.bank || '').trim(),
        checkNumber: String(check.checkNumber || '').trim(),
        issueDate: String(check.issueDate || '').trim(),
        amount: Number(check.amount || 0),
        status: CHECK_STATUSES.includes(String(check.status || '').trim()) ? String(check.status).trim() : 'For Check Printing',
        receiptNumber: String(check.receiptNumber || '').trim(),
        reason: String(check.reason || '').trim(),
        createdAt: String(check.createdAt || isoNow())
    };
}

function getAccountById(accountId) {
    return APD_STATE.accounts.find((account) => account.id === accountId) || null;
}

function getAccounts() {
    return Array.isArray(APD_STATE.accounts) ? APD_STATE.accounts : [];
}

function upsertById(items, nextItem) {
    const index = items.findIndex((item) => item.id === nextItem.id);
    if (index === -1) {
        items.push(nextItem);
        return;
    }
    items[index] = nextItem;
}

function fillBillForm(bill) {
    document.getElementById('billIdInput').value = bill.id;
    document.getElementById('billSeriesIdInput').value = bill.seriesId || '';
    document.getElementById('billSeriesIndexInput').value = String(bill.seriesIndex || 1);
    document.getElementById('billDashboardLabelInput').value = bill.dashboardLabel || '';
    document.getElementById('billPlanTypeInput').value = bill.planType || 'one_time';
    document.getElementById('billRemainingYearsInput').value = String(bill.remainingYears || 0);
    document.getElementById('billRemainingMonthsInput').value = String(bill.remainingMonths || 0);
    document.getElementById('billPayeeInput').value = bill.payee;
    document.getElementById('billDocTypeInput').value = bill.documentType;
    document.getElementById('billDocNumberInput').value = bill.documentNumber;
    document.getElementById('billDueDateInput').value = bill.dueDate;
    document.getElementById('billAccountInput').value = bill.accountId;
    document.getElementById('billAmountInput').value = Number(bill.amount || 0).toFixed(2);
    document.getElementById('billStatusInput').value = bill.status;
    document.getElementById('billSimpleLoanModeInput').checked = Boolean(bill.simpleLoanMode);
    document.getElementById('billBreakdownPendingInput').checked = Boolean(bill.breakdownPending);
    document.getElementById('billPrincipalAmountInput').value = bill.principalAmount ? Number(bill.principalAmount).toFixed(2) : '';
    document.getElementById('billInterestAmountInput').value = bill.interestAmount ? Number(bill.interestAmount).toFixed(2) : '';
    document.getElementById('billPenaltyAmountInput').value = bill.penaltyAmount ? Number(bill.penaltyAmount).toFixed(2) : '';
    document.getElementById('billNotesInput').value = bill.notes || '';
    updatePlanHint();
    syncLoanFields();
    syncSeriesEditFields();
}

function createBillsFromPlan(baseBill) {
    const totalMonths = getPlannedOccurrences(baseBill.planType, baseBill.remainingYears, baseBill.remainingMonths);
    const seriesId = totalMonths > 1 ? `SER-${Date.now()}` : '';
    const due = parseDateOnly(baseBill.dueDate) || startOfDay(new Date());
    const idSeed = APD_STATE.bills.reduce((max, bill) => {
        const value = Number(String(bill.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 1000);
    const bills = [];

    for (let index = 0; index < totalMonths; index += 1) {
        const billDate = addMonths(due, index);
        bills.push(normalizeBill({
            ...baseBill,
            id: `APD-${idSeed + index + 1}`,
            dueDate: toDateInputValue(billDate),
            documentNumber: totalMonths > 1 ? `${baseBill.documentNumber}-${String(index + 1).padStart(2, '0')}` : baseBill.documentNumber,
            seriesId,
            seriesIndex: index + 1,
            seriesTotal: totalMonths,
            notes: baseBill.planType === 'repeat_last_amount'
                ? `${baseBill.notes || ''}${baseBill.notes ? ' ' : ''}Projected from latest known bill amount.`.trim()
                : baseBill.notes
        }));
    }

    return bills;
}

function getPlannedOccurrences(planType, years, months) {
    if (planType === 'one_time') return 1;
    const total = (Number(years || 0) * 12) + Number(months || 0);
    return Math.max(total, 1);
}

function onDashboardMatrixClick(event) {
    const button = event.target.closest('[data-bill-ids]');
    if (!button) return;
    const ids = String(button.dataset.billIds || '').split(',').filter(Boolean);
    if (!ids.length) return;
    const bill = APD_STATE.bills.find((item) => item.id === ids[0]);
    if (!bill) return;
    if (ids.length > 1) {
        MargaUtils.showToast('More than one payable is in this month slot. Opening the first payable in the series.', 'info');
    }
    openBillInWorkspace(bill);
}

function openBillInWorkspace(bill) {
    showView('workspace');
    setActiveTab('payable-intake');
    fillBillForm(bill);
}

function getDashboardLabel(bill) {
    return String(bill.dashboardLabel || bill.payee || getAccountById(bill.accountId)?.name || bill.id).trim();
}

function getDueClass(dateValue, status) {
    if (['Cleared', 'Voided'].includes(status)) return 'on-schedule';
    const due = parseDateOnly(dateValue);
    if (!due) return 'on-schedule';
    const today = startOfDay(new Date());
    if (due < today) return 'overdue';
    if (due <= addDays(today, 7)) return 'due-soon';
    return 'on-schedule';
}

function getDueLabel(dateValue, status) {
    if (status === 'Cleared') return 'Closed';
    if (status === 'Released') return 'Check Released';
    if (status === 'Printed') return 'Check Printed';
    if (status === 'Voided') return 'Voided';
    const due = parseDateOnly(dateValue);
    if (!due) return 'No Due Date';
    const today = startOfDay(new Date());
    if (due < today) return 'Overdue';
    if (due <= addDays(today, 7)) return 'Due Soon';
    return 'On Schedule';
}

function formatScope(scope) {
    return MargaFinanceAccounts.formatScope(scope);
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
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

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0));
}

function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + Number(months || 0), date.getDate());
}

function parseDateOnly(value) {
    if (!value) return null;
    const parts = String(value).split('-').map((item) => Number(item));
    if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getDashboardMonths() {
    const firstMonth = startOfMonth(addMonths(startOfDay(new Date()), VIEW_STATE.dashboardOffset));
    return Array.from({ length: 6 }, (_, index) => addMonths(firstMonth, index));
}

function focusDashboardOnDueDate(dateValue) {
    const due = parseDateOnly(dateValue);
    if (!due) return;
    const today = startOfDay(new Date());
    VIEW_STATE.dashboardOffset = ((due.getFullYear() - today.getFullYear()) * 12) + (due.getMonth() - today.getMonth());
}

function formatMonthHeading(date) {
    return date.toLocaleDateString('en-PH', {
        month: 'short',
        year: '2-digit'
    }).replace(' ', ' ');
}

function isSameMonth(dateValue, date) {
    const parsed = parseDateOnly(dateValue);
    if (!parsed || !date) return false;
    return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth();
}

function toDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function offsetDate(days) {
    const date = addDays(startOfDay(new Date()), days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createBillId() {
    const highest = APD_STATE.bills.reduce((max, bill) => {
        const value = Number(String(bill.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 1000);
    return `APD-${highest + 1}`;
}

function createCheckId() {
    const highest = APD_STATE.checks.reduce((max, check) => {
        const value = Number(String(check.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 9000);
    return `CHK-${highest + 1}`;
}

function createAccountId() {
    const base = slugify(document.getElementById('accountNameInput')?.value || `account-${Date.now()}`) || `account-${Date.now()}`;
    let candidate = base;
    let suffix = 2;
    while (getAccounts().some((account) => account.id === candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function onAccountSubmit(event) {
    event.preventDefault();
    const next = normalizeAccount({
        id: document.getElementById('accountIdInput').value || createAccountId(),
        name: document.getElementById('accountNameInput').value,
        type: document.getElementById('accountTypeInput').value,
        scope: document.getElementById('accountScopeInput').value,
        meaning: document.getElementById('accountMeaningInput').value,
        useWhen: document.getElementById('accountUseWhenInput').value,
        avoid: document.getElementById('accountAvoidInput').value
    });

    if (!next.name || !next.meaning) {
        MargaUtils.showToast('Account name and meaning are required.', 'error');
        return;
    }

    const duplicate = getAccounts().find((account) => account.id !== next.id && account.name.toLowerCase() === next.name.toLowerCase());
    if (duplicate) {
        MargaUtils.showToast('An account with the same name already exists.', 'error');
        return;
    }

    upsertById(APD_STATE.accounts, next);
    persistState();
    refreshAccountViews(next.id);
    clearAccountForm();
    MargaUtils.showToast('Account saved.', 'success');
}

function fillAccountForm(account) {
    document.getElementById('accountIdInput').value = account.id;
    document.getElementById('accountNameInput').value = account.name;
    document.getElementById('accountTypeInput').value = account.type;
    document.getElementById('accountScopeInput').value = account.scope;
    document.getElementById('accountMeaningInput').value = account.meaning || '';
    document.getElementById('accountUseWhenInput').value = account.useWhen || '';
    document.getElementById('accountAvoidInput').value = account.avoid || '';
}

function openAccountManager() {
    document.getElementById('accountManagerModal').classList.remove('hidden');
    document.getElementById('accountManagerModal').setAttribute('aria-hidden', 'false');
    clearAccountForm();
    renderAccountManagerTable();
    document.getElementById('accountNameInput').focus();
}

function closeAccountManager() {
    document.getElementById('accountManagerModal').classList.add('hidden');
    document.getElementById('accountManagerModal').setAttribute('aria-hidden', 'true');
}

function openStatusGuide() {
    document.getElementById('statusGuideModal').classList.remove('hidden');
    document.getElementById('statusGuideModal').setAttribute('aria-hidden', 'false');
    renderStatusGuideTable();
}

function closeStatusGuide() {
    document.getElementById('statusGuideModal').classList.add('hidden');
    document.getElementById('statusGuideModal').setAttribute('aria-hidden', 'true');
}

function refreshAccountViews(preferredId = '') {
    const currentBillAccount = preferredId || document.getElementById('billAccountInput').value;
    populateSelects();
    if (currentBillAccount && getAccountById(currentBillAccount)) {
        document.getElementById('billAccountInput').value = currentBillAccount;
    }
    renderAccountCards();
    renderAccountManagerTable();
    renderBillsTable();
    renderDashboardMatrix();
}

function setActiveTab(tabKey) {
    const normalized = String(tabKey || '').trim().toLowerCase();
    document.querySelectorAll('[data-tab-target]').forEach((button) => {
        const active = String(button.dataset.tabTarget || '').trim().toLowerCase() === normalized;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        const active = String(panel.dataset.tabPanel || '').trim().toLowerCase() === normalized;
        panel.classList.toggle('is-active', active);
    });
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;
