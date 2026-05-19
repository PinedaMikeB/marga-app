if (!MargaAuth.requireAccess('apd')) {
    throw new Error('Unauthorized access to APD module.');
}

const APD_STORAGE_KEYS = {
    accounts: MargaFinanceAccounts?.getStorageKey?.() || 'marga_apd_accounts_v1',
    bills: 'marga_apd_bills_v1',
    checks: 'marga_apd_checks_v1',
    checkPrintTemplates: 'marga_apd_check_print_templates_v1',
    checkPrintActiveTemplate: 'marga_apd_check_print_active_template_v1'
};

const PETTY_CASH_SYNC_STORAGE_KEYS = {
    requests: 'marga_petty_cash_requests_v1',
    entries: 'marga_petty_cash_entries_v1'
};

const APD_FIRESTORE = {
    bills: 'marga_apd_bills',
    checks: 'marga_apd_checks'
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

const CHECK_PRINT_PREVIEW_MM_PX = 3.4;

const CHECK_PRINT_SECTION_LAYOUT = {
    payee: { label: 'Payee', subtitle: 'Name line on the check', xMm: 24, yMm: 42, widthMm: 132, fontScale: 1 },
    date: { label: 'Date', subtitle: 'Check issue date', xMm: 158, yMm: 22, widthMm: 36, fontScale: 1 },
    amount: { label: 'Amount', subtitle: 'Numeric peso amount', xMm: 158, yMm: 42, widthMm: 34, fontScale: 1 },
    words: { label: 'Pesos In Words', subtitle: 'Amount written in words', xMm: 22, yMm: 55, widthMm: 150, fontScale: 1 }
};

const CHECK_PRINT_CALIBRATION = {
    paperWidthCm: 20.3,
    paperHeightCm: 9.2,
    offsetXmm: 0,
    offsetYmm: 0,
    scale: 1,
    sections: Object.fromEntries(Object.entries(CHECK_PRINT_SECTION_LAYOUT).map(([key, layout]) => [
        key,
        {
            xMm: 0,
            yMm: 0,
            widthMm: layout.widthMm,
            fontScale: layout.fontScale
        }
    ]))
};

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
    checks: [],
    activePrintPayload: null
};

const VIEW_STATE = {
    activeView: 'dashboard',
    dashboardOffset: 0
};

let currentCheckPrintTemplates = {};
let currentCheckPrintTemplateName = 'Default';
let currentCheckPrintCalibration = normalizeCheckPrintCalibration(CHECK_PRINT_CALIBRATION);

const DOC_TYPE_PRESETS = {
    'Loan Amortization': { accountId: 'loan_amortization_lending_institution', planType: 'monthly_term', label: 'Loan Amortization' },
    'Housing Loan': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Housing Loan' },
    'Bank Loan': { accountId: 'bank_loans_payable', planType: 'monthly_term', label: 'Bank Loan' },
    'Credit Card Payment': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Card Payment' },
    'Tuition Fee': { accountId: 'accounts_payable_installment_arrangement', planType: 'monthly_term', label: 'Tuition Fee' },
    'Phone Bill': { accountId: 'telephone_expense', planType: 'repeat_last_amount', label: 'Phone Bill' },
    'Electricity Bill': { accountId: 'electricity_expense', planType: 'repeat_last_amount', label: 'Electricity Bill' },
    'Utility Bill': { accountId: 'internet_expense', planType: 'repeat_last_amount', label: 'Utility Bill' },
    'Purchase Request': { accountId: 'rental_service_supplies_expense', planType: 'one_time', label: '' },
    'Quotation': { accountId: 'rental_service_supplies_expense', planType: 'one_time', label: '' },
    'Parts/Supplies Purchase': { accountId: 'rental_service_supplies_expense', planType: 'one_time', label: '' },
    'Asset Purchase': { accountId: 'rental_machines_equipment', planType: 'one_time', label: '' },
    'Petty Cash Replenishment': { accountId: 'petty_cash_fund', planType: 'one_time', label: 'Petty Cash Replenishment' },
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
    initializeCheckPrintTemplateState();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindFormControls();
    bindTabControls();
    bindViewControls();
    populateSelects();
    showView(VIEW_STATE.activeView);
    renderAll();
    syncApdSharedState();
});

window.addEventListener('storage', onExternalApdStateChange);
window.addEventListener('focus', onExternalApdStateChange);

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
    syncPettyCashRequestsFromChecks();
}

function bindFormControls() {
    document.getElementById('billForm').addEventListener('submit', onBillSubmit);
    document.getElementById('checkForm').addEventListener('submit', onCheckSubmit);
    document.getElementById('billFormClearBtn').addEventListener('click', clearBillForm);
    document.getElementById('checkFormClearBtn').addEventListener('click', clearCheckForm);
    document.getElementById('checkPreviewPrintBtn').addEventListener('click', openCheckPrintFromForm);
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
    document.querySelectorAll('[data-close-check-print]').forEach((button) => {
        button.addEventListener('click', closeCheckPrintModal);
    });
    document.getElementById('checkPrintAdjustPanel').addEventListener('input', handleCheckPrintControlInput);
    document.getElementById('checkPrintAdjustPanel').addEventListener('change', handleCheckPrintControlInput);
    document.getElementById('checkPrintAdjustPanel').addEventListener('click', handleCheckPrintToolClick);
    document.getElementById('checkPrintResetBtn').addEventListener('click', () => {
        resetCheckPrintCalibration();
        renderCheckPrintAdjustmentControls();
        renderActiveCheckPrintPreview();
    });
    document.getElementById('checkPrintNowBtn').addEventListener('click', printActiveCheck);
    document.getElementById('accountManagerTableBody').addEventListener('click', onAccountTableAction);
    syncLoanFields();
    syncSeriesEditFields();
}

function onExternalApdStateChange(event) {
    if (event?.key && ![
        APD_STORAGE_KEYS.accounts,
        APD_STORAGE_KEYS.bills,
        APD_STORAGE_KEYS.checks,
        APD_STORAGE_KEYS.checkPrintTemplates,
        APD_STORAGE_KEYS.checkPrintActiveTemplate,
        PETTY_CASH_SYNC_STORAGE_KEYS.requests,
        PETTY_CASH_SYNC_STORAGE_KEYS.entries
    ].includes(event.key)) {
        return;
    }

    const preserveCheckEdit = (document.activeElement?.id || '').startsWith('check');
    const preserveBillEdit = (document.activeElement?.id || '').startsWith('bill');

    hydrateState();
    populateSelects();
    renderAll();

    if (!preserveBillEdit && !document.getElementById('billIdInput')?.value) {
        clearBillForm();
    }
    if (!preserveCheckEdit && !document.getElementById('checkIdInput')?.value) {
        clearCheckForm();
    }
    syncApdSharedState();
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
    document.getElementById('addAdHocPayableBtn').addEventListener('click', prepareAdHocPayable);
    document.getElementById('prevWindowBtn').addEventListener('click', () => {
        VIEW_STATE.dashboardOffset -= 1;
        renderDashboardMatrix();
    });
    document.getElementById('nextWindowBtn').addEventListener('click', () => {
        VIEW_STATE.dashboardOffset += 1;
        renderDashboardMatrix();
    });
    document.getElementById('dashboardMatrixBody').addEventListener('click', onDashboardMatrixClick);
    document.querySelectorAll('[data-close-month-payables]').forEach((button) => {
        button.addEventListener('click', closeMonthPayablesModal);
    });
    document.getElementById('monthPayablesList').addEventListener('click', onMonthPayablePick);
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
    const visibleMonthKeys = new Set(months.map((month) => getMonthKey(month)));
    const visibleBills = matrixBills.filter((bill) => visibleMonthKeys.has(getMonthKey(parseDateOnly(bill.dueDate))));
    const outsideWindowBills = matrixBills.filter((bill) => bill.dueDate && !visibleMonthKeys.has(getMonthKey(parseDateOnly(bill.dueDate))));
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
    renderDashboardVisibilityNote(matrixBills, visibleBills, outsideWindowBills);
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
            <button type="button" class="dashboard-amount-btn ${fullyPaid ? 'is-paid' : ''}" data-bill-ids="${MargaUtils.escapeHtml(ids)}" data-cell-label="${MargaUtils.escapeHtml(label)}" data-cell-month="${MargaUtils.escapeHtml(formatMonthHeading(month))}" title="${MargaUtils.escapeHtml(title)}">
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
    const biMonthlyRow = document.getElementById('biMonthlyPdcRow');
    const biMonthlyGuideRow = document.getElementById('biMonthlyPdcGuideRow');
    const dueDateLabel = document.getElementById('billDueDateLabel');
    const amountLabel = document.getElementById('billAmountLabel');
    if (planType === 'one_time') {
        recurrenceRow.classList.add('hidden');
        biMonthlyRow.classList.add('hidden');
        biMonthlyGuideRow.classList.add('hidden');
        dueDateLabel.textContent = 'Due Date';
        amountLabel.textContent = 'Amount';
        hint.textContent = 'Use one-time for normal invoices, SOAs, and personal owner drawings.';
        return;
    }
    recurrenceRow.classList.remove('hidden');
    biMonthlyRow.classList.toggle('hidden', planType !== 'bi_monthly_pdc');
    biMonthlyGuideRow.classList.toggle('hidden', planType !== 'bi_monthly_pdc');
    dueDateLabel.textContent = planType === 'bi_monthly_pdc' ? 'First PDC Date' : 'Due Date';
    amountLabel.textContent = planType === 'bi_monthly_pdc' ? 'First Check Amount' : 'Amount';
    if (planType === 'monthly_term') {
        hint.textContent = 'Use monthly fixed term for housing loan, bank loan, card payment, tuition, and any fixed monthly amount. Remaining years and months will auto-generate future payables.';
        return;
    }
    if (planType === 'bi_monthly_pdc') {
        hint.textContent = 'Use bi-monthly PDC when the same loan requires two post-dated checks each month. Remaining months means how many months APD should project, and each month will generate two payable dates.';
        return;
    }
    hint.textContent = 'Use repeat last bill amount for electricity, mobile phones, internet, and similar bills when you want to copy the latest amount forward and edit later if the actual bill changes.';
}

function prepareAdHocPayable() {
    showView('workspace');
    setActiveTab('payable-intake');
    clearBillForm();
    document.getElementById('billDashboardLabelInput').value = '';
    document.getElementById('billPlanTypeInput').value = 'one_time';
    document.getElementById('billDocTypeInput').value = 'Purchase Request';
    document.getElementById('billStatusInput').value = 'For Approval';
    document.getElementById('billDueDateInput').value = toDateInputValue(startOfDay(new Date()));
    const suppliesAccount = getAccountById('rental_service_supplies_expense');
    if (suppliesAccount) {
        document.getElementById('billAccountInput').value = suppliesAccount.id;
    }
    updatePlanHint();
    syncLoanFields();
    document.getElementById('billPayeeInput').focus();
    MargaUtils.showToast('Ad hoc payable ready. Enter supplier, reference, amount, and due month.', 'info');
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
        if (bill.sourceModule === 'pettycash' && bill.sourceRequestId) {
            billMeta.push(`Petty Cash ${bill.sourceRequestId}`);
        }
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
                        <button type="button" class="row-btn" data-action="print-check-bill" data-id="${bill.id}">Print Check</button>
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
                        <button type="button" class="row-btn" data-action="print-check" data-id="${check.id}">Print</button>
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
        secondDueDate: document.getElementById('billSecondDueDateInput').value,
        accountId: document.getElementById('billAccountInput').value,
        amount: document.getElementById('billAmountInput').value,
        secondAmount: document.getElementById('billSecondAmountInput').value,
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

    if (base.planType === 'bi_monthly_pdc') {
        const primaryDate = parseDateOnly(base.dueDate);
        const secondDate = parseDateOnly(base.secondDueDate);
        if (!primaryDate || !secondDate) {
            MargaUtils.showToast('Enter both PDC dates for a bi-monthly PDC schedule.', 'error');
            return;
        }
        if (primaryDate.getFullYear() !== secondDate.getFullYear() || primaryDate.getMonth() !== secondDate.getMonth()) {
            MargaUtils.showToast('Both PDC dates must be inside the same month.', 'error');
            return;
        }
        if (primaryDate.getDate() === secondDate.getDate()) {
            MargaUtils.showToast('Use two different PDC dates in the same month.', 'error');
            return;
        }
        if (!(Number(base.amount || 0) > 0) || !(Number(base.secondAmount || 0) > 0)) {
            MargaUtils.showToast('Enter both check amounts for a bi-monthly PDC schedule.', 'error');
            return;
        }
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
            const biMonthlyPattern = getBiMonthlyPattern(base, original);
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
                    amount: base.planType === 'bi_monthly_pdc'
                        ? (bill.pdcSlot === 'second' ? biMonthlyPattern.secondAmount : biMonthlyPattern.firstAmount)
                        : base.amount,
                    secondAmount: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.secondAmount : 0,
                    status: base.status,
                    planType: base.planType,
                    remainingYears: base.remainingYears,
                    remainingMonths: base.remainingMonths,
                    simpleLoanMode: base.simpleLoanMode,
                    breakdownPending: base.breakdownPending,
                    principalAmount: base.principalAmount,
                    interestAmount: base.interestAmount,
                    penaltyAmount: base.penaltyAmount,
                    dueDate: base.planType === 'bi_monthly_pdc'
                        ? toDateInputValue(setDayWithinMonth(startOfMonth(parseDateOnly(bill.dueDate) || new Date()), bill.pdcSlot === 'second' ? biMonthlyPattern.secondDay : biMonthlyPattern.firstDay))
                        : bill.dueDate,
                    secondDueDate: base.planType === 'bi_monthly_pdc'
                        ? toDateInputValue(setDayWithinMonth(startOfMonth(parseDateOnly(bill.dueDate) || new Date()), bill.pdcSlot === 'second' ? biMonthlyPattern.firstDay : biMonthlyPattern.secondDay))
                        : '',
                    pdcFirstDay: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.firstDay : 0,
                    pdcSecondDay: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.secondDay : 0,
                    pdcFirstAmount: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.firstAmount : 0,
                    pdcSecondAmount: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.secondAmount : 0,
                    notes: base.notes
                });
                upsertById(APD_STATE.bills, updatedBill);
            });
            savedCount = futureBills.length;
        } else {
            const biMonthlyPattern = getBiMonthlyPattern(base, original);
            if (base.planType === 'bi_monthly_pdc' && original?.seriesId) {
                const monthPairBills = APD_STATE.bills.filter((bill) => (
                    bill.seriesId === original.seriesId
                    && isSameMonth(bill.dueDate, parseDateOnly(original.dueDate))
                ));
                monthPairBills.forEach((bill) => {
                    upsertById(APD_STATE.bills, normalizeBill({
                        ...bill,
                        dashboardLabel: base.dashboardLabel,
                        payee: base.payee,
                        documentType: base.documentType,
                        accountId: base.accountId,
                        amount: bill.pdcSlot === 'second' ? biMonthlyPattern.secondAmount : biMonthlyPattern.firstAmount,
                        secondAmount: biMonthlyPattern.secondAmount,
                        status: base.status,
                        planType: base.planType,
                        remainingYears: base.remainingYears,
                        remainingMonths: base.remainingMonths,
                        simpleLoanMode: base.simpleLoanMode,
                        breakdownPending: base.breakdownPending,
                        principalAmount: base.principalAmount,
                        interestAmount: base.interestAmount,
                        penaltyAmount: base.penaltyAmount,
                        dueDate: toDateInputValue(setDayWithinMonth(startOfMonth(parseDateOnly(original.dueDate) || new Date()), bill.pdcSlot === 'second' ? biMonthlyPattern.secondDay : biMonthlyPattern.firstDay)),
                        secondDueDate: toDateInputValue(setDayWithinMonth(startOfMonth(parseDateOnly(original.dueDate) || new Date()), bill.pdcSlot === 'second' ? biMonthlyPattern.firstDay : biMonthlyPattern.secondDay)),
                        pdcFirstDay: biMonthlyPattern.firstDay,
                        pdcSecondDay: biMonthlyPattern.secondDay,
                        pdcFirstAmount: biMonthlyPattern.firstAmount,
                        pdcSecondAmount: biMonthlyPattern.secondAmount,
                        notes: base.notes
                    }));
                });
                savedCount = monthPairBills.length;
            } else {
                upsertById(APD_STATE.bills, normalizeBill({
                    ...base,
                    pdcFirstDay: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.firstDay : 0,
                    pdcSecondDay: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.secondDay : 0,
                    pdcFirstAmount: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.firstAmount : 0,
                    pdcSecondAmount: base.planType === 'bi_monthly_pdc' ? biMonthlyPattern.secondAmount : 0,
                    amount: base.planType === 'bi_monthly_pdc'
                        ? (original?.pdcSlot === 'second' ? biMonthlyPattern.secondAmount : biMonthlyPattern.firstAmount)
                        : base.amount,
                    pdcSlot: original?.pdcSlot || '',
                    seriesId: original?.seriesId || '',
                    seriesIndex: original?.seriesIndex || 1,
                    seriesTotal: original?.seriesTotal || 1
                }));
            }
        }
    } else {
        const plannedBills = createBillsFromPlan(base);
        savedCount = plannedBills.length;
        plannedBills.forEach((bill) => APD_STATE.bills.push(bill));
    }

    persistState();
    persistApdSharedState();
    syncPettyCashRequestsFromChecks();
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
    persistApdSharedState();
    syncPettyCashRequestsFromChecks();
    populateBillSelect(next.billId);
    fillCheckForm(next);
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
    const billId = document.getElementById('checkBillSelect').value;
    const bill = APD_STATE.bills.find((item) => item.id === billId);
    if (!bill) return;
    const savedCheck = getLatestCheckForBill(bill.id);
    if (savedCheck) {
        fillCheckForm(savedCheck);
        return;
    }
    document.getElementById('checkIdInput').value = '';
    document.getElementById('checkAmountInput').value = Number(bill.amount || 0).toFixed(2);
    document.getElementById('checkNumberInput').value = '';
    document.getElementById('checkIssueDateInput').value = bill.dueDate || toDateInputValue(new Date());
    document.getElementById('checkStatusInput').value = 'For Check Printing';
    document.getElementById('checkReceiptInput').value = '';
    document.getElementById('checkReasonInput').value = '';
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
        prepareCheckForBill(bill);
        return;
    }

    if (button.dataset.action === 'print-check-bill') {
        openCheckPrintForBill(bill);
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
        fillCheckForm(check);
        return;
    }
    if (button.dataset.action === 'print-check') {
        openCheckPrintForCheck(check);
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
    document.getElementById('billSecondDueDateInput').value = '';
    document.getElementById('billSecondAmountInput').value = '';
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

async function syncApdSharedState() {
    try {
        const localBills = cloneData(APD_STATE.bills).map(normalizeBill);
        const localChecks = cloneData(APD_STATE.checks).map(normalizeCheck);
        const [remoteBills, remoteChecks] = await Promise.all([
            fetchApdCollection(APD_FIRESTORE.bills).catch((error) => {
                console.warn('Unable to load shared APD payables.', error);
                return [];
            }),
            fetchApdCollection(APD_FIRESTORE.checks).catch((error) => {
                console.warn('Unable to load shared APD checks.', error);
                return [];
            })
        ]);

        const remoteBillIds = new Set(remoteBills.map((bill) => String(bill.id || '').trim()).filter(Boolean));
        const remoteCheckIds = new Set(remoteChecks.map((check) => String(check.id || '').trim()).filter(Boolean));
        const localBillsToShare = localBills.filter((bill) => !remoteBillIds.has(bill.id) && shouldShareLocalBill(bill));
        const localChecksToShare = localChecks.filter((check) => !remoteCheckIds.has(check.id) && shouldShareLocalCheck(check));

        await Promise.all([
            ...localBillsToShare.map((bill) => saveApdBillToShared(bill)),
            ...localChecksToShare.map((check) => saveApdCheckToShared(check))
        ]);

        const mergedBills = mergeById(remoteBills, localBillsToShare);
        const mergedChecks = mergeById(remoteChecks, localChecksToShare);
        APD_STATE.bills = (mergedBills.length ? mergedBills : localBills.length ? localBills : cloneData(DEFAULT_BILLS)).map(normalizeBill);
        APD_STATE.checks = (mergedChecks.length ? mergedChecks : localChecks.length ? localChecks : cloneData(DEFAULT_CHECKS)).map(normalizeCheck);
        persistState();
        syncPettyCashRequestsFromChecks();
        populateSelects();
        renderAll();
    } catch (error) {
        console.warn('APD shared Margabase sync failed; using local cache for now.', error);
        MargaUtils.showToast('APD shared data is temporarily unavailable; using this browser cache.', 'info');
    }
}

function persistApdSharedState() {
    const bills = APD_STATE.bills.filter(shouldShareLocalBill);
    const checks = APD_STATE.checks.filter(shouldShareLocalCheck);
    Promise.all([
        ...bills.map((bill) => saveApdBillToShared(bill)),
        ...checks.map((check) => saveApdCheckToShared(check))
    ]).catch((error) => {
        console.warn('Unable to save APD shared Margabase state.', error);
        MargaUtils.showToast('Saved locally, but shared APD sync is still catching up.', 'info');
    });
}

async function fetchApdCollection(collection) {
    const rows = await MargaUtils.fetchCollection(collection, 500);
    return rows.filter((row) => Number(row.is_archived || 0) !== 1);
}

function shouldShareLocalBill(bill) {
    const defaultIds = new Set(DEFAULT_BILLS.map((item) => item.id));
    return Boolean(bill?.id && !defaultIds.has(bill.id));
}

function shouldShareLocalCheck(check) {
    const defaultIds = new Set(DEFAULT_CHECKS.map((item) => item.id));
    return Boolean(check?.id && !defaultIds.has(check.id));
}

function mergeById(primaryRows = [], secondaryRows = []) {
    const rowsById = new Map();
    primaryRows.forEach((row) => {
        const id = String(row.id || row._docId || '').trim();
        if (id) rowsById.set(id, row);
    });
    secondaryRows.forEach((row) => {
        const id = String(row.id || row._docId || '').trim();
        if (id && !rowsById.has(id)) rowsById.set(id, row);
    });
    return Array.from(rowsById.values());
}

function withApdAudit(fields) {
    const user = MargaAuth.getUser?.() || {};
    const now = isoNow();
    return {
        ...fields,
        updatedAt: now,
        updatedBy: String(user.name || user.username || 'APD user').trim()
    };
}

async function saveApdBillToShared(bill) {
    const payload = withApdAudit(normalizeBill(bill));
    return setApdDocument(APD_FIRESTORE.bills, payload.id, payload, {
        label: `APD payable ${payload.id}`,
        dedupeKey: `${APD_FIRESTORE.bills}:${payload.id}`
    });
}

async function saveApdCheckToShared(check) {
    const payload = withApdAudit(normalizeCheck(check));
    return setApdDocument(APD_FIRESTORE.checks, payload.id, payload, {
        label: `APD check ${payload.id}`,
        dedupeKey: `${APD_FIRESTORE.checks}:${payload.id}`
    });
}

async function setApdDocument(collection, docId, fields, options = {}) {
    if (window.MargaOfflineSync?.writeFirestoreDoc) {
        return window.MargaOfflineSync.writeFirestoreDoc({
            mode: 'set',
            collection,
            docId,
            fields,
            label: options.label,
            dedupeKey: options.dedupeKey
        });
    }
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to save ${collection}/${docId}`);
    }
    return payload;
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    return { stringValue: String(value ?? '') };
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

function syncPettyCashRequestsFromChecks() {
    const requests = readStorage(PETTY_CASH_SYNC_STORAGE_KEYS.requests, []);
    const entries = readStorage(PETTY_CASH_SYNC_STORAGE_KEYS.entries, []);
    let changed = false;

    APD_STATE.bills.forEach((bill) => {
        if (String(bill.sourceModule || '').trim() !== 'pettycash' || !String(bill.sourceRequestId || '').trim()) {
            return;
        }

        const request = requests.find((item) => String(item.id || '').trim() === String(bill.sourceRequestId || '').trim());
        if (!request) return;

        const receivedCheck = APD_STATE.checks
            .filter((check) => String(check.billId || '').trim() === String(bill.id || '').trim()
                && ['Released', 'Cleared'].includes(String(check.status || '').trim()))
            .sort((left, right) => `${right.issueDate} ${right.id}`.localeCompare(`${left.issueDate} ${left.id}`))[0] || null;

        const nextStatus = receivedCheck ? 'Received' : mapApdBillStatusToPettyCashRequestStatus(bill.status);

        if (String(request.apdBillId || '') !== String(bill.id || '')) {
            request.apdBillId = String(bill.id || '');
            changed = true;
        }
        if (String(request.apdBillStatus || '') !== String(bill.status || '')) {
            request.apdBillStatus = String(bill.status || '');
            changed = true;
        }
        if (String(request.apdCheckNumber || '') !== String(receivedCheck?.checkNumber || '')) {
            request.apdCheckNumber = String(receivedCheck?.checkNumber || '');
            changed = true;
        }
        if (String(request.receivedDate || '') !== String(receivedCheck?.issueDate || '')) {
            request.receivedDate = String(receivedCheck?.issueDate || '');
            changed = true;
        }
        if (String(request.status || '') !== nextStatus) {
            request.status = nextStatus;
            changed = true;
        }

        const linkedIds = new Set(Array.isArray(request.entryIds) ? request.entryIds.map((item) => String(item).trim()) : []);
        entries.forEach((entry) => {
            if (String(entry.replenishmentId || '').trim() !== String(request.id || '').trim() && !linkedIds.has(String(entry.id || '').trim())) {
                return;
            }
            if (entry.status === 'Cancelled') return;
            entry.replenishmentId = String(request.id || '').trim();
            const desiredStatus = nextStatus === 'Received' ? 'Replenished' : 'Liquidated';
            if (String(entry.status || '').trim() !== desiredStatus) {
                entry.status = desiredStatus;
                changed = true;
            }
        });
    });

    if (changed) {
        localStorage.setItem(PETTY_CASH_SYNC_STORAGE_KEYS.requests, JSON.stringify(requests));
        localStorage.setItem(PETTY_CASH_SYNC_STORAGE_KEYS.entries, JSON.stringify(entries));
    }
}

function mapApdBillStatusToPettyCashRequestStatus(billStatus) {
    const normalized = String(billStatus || '').trim();
    if (normalized === 'Draft') return 'Draft';
    if (normalized === 'For Approval') return 'Requested';
    if (!normalized) return 'Draft';
    return 'Approved';
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
        secondDueDate: String(bill.secondDueDate || '').trim(),
        accountId: String(bill.accountId || '').trim(),
        amount: Number(bill.amount || 0),
        secondAmount: Number(bill.secondAmount || 0),
        status: BILL_STATUSES.includes(String(bill.status || '').trim()) ? String(bill.status).trim() : 'Draft',
        planType: String(bill.planType || 'one_time').trim(),
        remainingYears: Number(bill.remainingYears || 0),
        remainingMonths: Number(bill.remainingMonths || 0),
        simpleLoanMode: loanDocument ? ('simpleLoanMode' in bill ? Boolean(bill.simpleLoanMode) : !hasLoanBreakdown) : false,
        breakdownPending: loanDocument ? ('breakdownPending' in bill ? Boolean(bill.breakdownPending) : !hasLoanBreakdown) : false,
        principalAmount,
        interestAmount,
        penaltyAmount,
        pdcFirstDay: Number(bill.pdcFirstDay || 0),
        pdcSecondDay: Number(bill.pdcSecondDay || 0),
        pdcFirstAmount: Number(bill.pdcFirstAmount || 0),
        pdcSecondAmount: Number(bill.pdcSecondAmount || 0),
        pdcSlot: String(bill.pdcSlot || '').trim(),
        seriesId: String(bill.seriesId || '').trim(),
        seriesIndex: Number(bill.seriesIndex || 1),
        seriesTotal: Number(bill.seriesTotal || 1),
        sourceModule: String(bill.sourceModule || '').trim(),
        sourceRequestId: String(bill.sourceRequestId || '').trim(),
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
    document.getElementById('billDueDateInput').value = resolveBiMonthlyFirstDate(bill);
    document.getElementById('billSecondDueDateInput').value = resolveBiMonthlyOtherDate(bill);
    document.getElementById('billAccountInput').value = bill.accountId;
    document.getElementById('billAmountInput').value = resolveBiMonthlyFirstAmount(bill);
    document.getElementById('billSecondAmountInput').value = resolveBiMonthlyOtherAmount(bill);
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

function fillCheckForm(check) {
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

function createBillsFromPlan(baseBill) {
    if (baseBill.planType === 'bi_monthly_pdc') {
        return createBiMonthlyPdcBills(baseBill);
    }

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
    if (planType === 'bi_monthly_pdc') return Math.max(total, 1) * 2;
    return Math.max(total, 1);
}

function createBiMonthlyPdcBills(baseBill) {
    const totalMonths = Math.max((Number(baseBill.remainingYears || 0) * 12) + Number(baseBill.remainingMonths || 0), 1);
    const firstDate = parseDateOnly(baseBill.dueDate) || startOfDay(new Date());
    const secondDate = parseDateOnly(baseBill.secondDueDate) || firstDate;
    const firstDay = Math.min(firstDate.getDate(), secondDate.getDate());
    const secondDay = Math.max(firstDate.getDate(), secondDate.getDate());
    const seriesId = `SER-${Date.now()}`;
    const idSeed = APD_STATE.bills.reduce((max, bill) => {
        const value = Number(String(bill.id || '').replace(/[^\d]/g, '')) || 0;
        return Math.max(max, value);
    }, 1000);
    const startMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const bills = [];

    for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
        const monthDate = addMonths(startMonth, monthIndex);
        const firstMonthDate = setDayWithinMonth(monthDate, firstDay);
        const secondMonthDate = setDayWithinMonth(monthDate, secondDay);

        bills.push(normalizeBill({
            ...baseBill,
            id: `APD-${idSeed + bills.length + 1}`,
            dueDate: toDateInputValue(firstMonthDate),
            secondDueDate: toDateInputValue(secondMonthDate),
            amount: Number(baseBill.amount || 0),
            secondAmount: Number(baseBill.secondAmount || 0),
            documentNumber: `${baseBill.documentNumber}-${String(monthIndex + 1).padStart(2, '0')}-A`,
            pdcFirstDay: firstDay,
            pdcSecondDay: secondDay,
            pdcFirstAmount: Number(baseBill.amount || 0),
            pdcSecondAmount: Number(baseBill.secondAmount || 0),
            pdcSlot: 'first',
            seriesId,
            seriesIndex: bills.length + 1,
            seriesTotal: totalMonths * 2
        }));

        bills.push(normalizeBill({
            ...baseBill,
            id: `APD-${idSeed + bills.length + 1}`,
            dueDate: toDateInputValue(secondMonthDate),
            secondDueDate: toDateInputValue(firstMonthDate),
            amount: Number(baseBill.secondAmount || 0),
            secondAmount: Number(baseBill.amount || 0),
            documentNumber: `${baseBill.documentNumber}-${String(monthIndex + 1).padStart(2, '0')}-B`,
            pdcFirstDay: firstDay,
            pdcSecondDay: secondDay,
            pdcFirstAmount: Number(baseBill.amount || 0),
            pdcSecondAmount: Number(baseBill.secondAmount || 0),
            pdcSlot: 'second',
            seriesId,
            seriesIndex: bills.length + 1,
            seriesTotal: totalMonths * 2
        }));
    }

    return bills;
}

function resolveBiMonthlyOtherDate(bill) {
    if (bill.planType !== 'bi_monthly_pdc') {
        return bill.secondDueDate || '';
    }
    const sibling = APD_STATE.bills.find((item) => (
        item.id !== bill.id
        && item.seriesId
        && item.seriesId === bill.seriesId
        && item.planType === 'bi_monthly_pdc'
        && item.dueDate
        && bill.dueDate
        && isSameMonth(item.dueDate, parseDateOnly(bill.dueDate))
    ));
    if (sibling) return sibling.dueDate;
    if (bill.secondDueDate) return bill.secondDueDate;
    const baseDate = parseDateOnly(bill.dueDate);
    if (!baseDate || !(bill.pdcFirstDay > 0) || !(bill.pdcSecondDay > 0)) return '';
    const otherDay = bill.pdcSlot === 'second' ? bill.pdcFirstDay : bill.pdcSecondDay;
    return toDateInputValue(setDayWithinMonth(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1), otherDay));
}

function resolveBiMonthlyFirstDate(bill) {
    if (bill.planType !== 'bi_monthly_pdc') return bill.dueDate;
    if (bill.pdcSlot === 'second') return resolveBiMonthlyOtherDate(bill);
    return bill.dueDate;
}

function resolveBiMonthlyFirstAmount(bill) {
    if (bill.planType !== 'bi_monthly_pdc') {
        return bill.amount ? Number(bill.amount).toFixed(2) : '';
    }
    if (bill.pdcFirstAmount > 0) return Number(bill.pdcFirstAmount).toFixed(2);
    if (bill.pdcSlot === 'second') {
        const sibling = resolveBiMonthlySibling(bill);
        if (sibling?.amount) return Number(sibling.amount).toFixed(2);
    }
    return bill.amount ? Number(bill.amount).toFixed(2) : '';
}

function resolveBiMonthlyOtherAmount(bill) {
    if (bill.planType !== 'bi_monthly_pdc') {
        return bill.secondAmount ? Number(bill.secondAmount).toFixed(2) : '';
    }
    if (bill.pdcSecondAmount > 0) return Number(bill.pdcSecondAmount).toFixed(2);
    const sibling = resolveBiMonthlySibling(bill);
    if (sibling?.amount) return Number(sibling.amount).toFixed(2);
    return bill.secondAmount ? Number(bill.secondAmount).toFixed(2) : '';
}

function resolveBiMonthlySibling(bill) {
    return APD_STATE.bills.find((item) => (
        item.id !== bill.id
        && item.seriesId
        && item.seriesId === bill.seriesId
        && item.planType === 'bi_monthly_pdc'
        && item.dueDate
        && bill.dueDate
        && isSameMonth(item.dueDate, parseDateOnly(bill.dueDate))
    )) || null;
}

function getBiMonthlyPattern(baseBill, originalBill = null) {
    if (baseBill.planType !== 'bi_monthly_pdc') {
        return { firstDay: 0, secondDay: 0 };
    }

    const mainDate = parseDateOnly(baseBill.dueDate);
    const otherDate = parseDateOnly(baseBill.secondDueDate);
    if (!mainDate || !otherDate) {
        return {
            firstDay: Number(originalBill?.pdcFirstDay || 0),
            secondDay: Number(originalBill?.pdcSecondDay || 0),
            firstAmount: Number(originalBill?.pdcFirstAmount || baseBill.amount || 0),
            secondAmount: Number(originalBill?.pdcSecondAmount || baseBill.secondAmount || 0)
        };
    }

    if (!originalBill?.pdcSlot) {
        return {
            firstDay: Math.min(mainDate.getDate(), otherDate.getDate()),
            secondDay: Math.max(mainDate.getDate(), otherDate.getDate()),
            firstAmount: Number(baseBill.amount || 0),
            secondAmount: Number(baseBill.secondAmount || 0)
        };
    }

    return originalBill.pdcSlot === 'second'
        ? { firstDay: otherDate.getDate(), secondDay: mainDate.getDate(), firstAmount: Number(baseBill.secondAmount || 0), secondAmount: Number(baseBill.amount || 0) }
        : { firstDay: mainDate.getDate(), secondDay: otherDate.getDate(), firstAmount: Number(baseBill.amount || 0), secondAmount: Number(baseBill.secondAmount || 0) };
}

function onDashboardMatrixClick(event) {
    const button = event.target.closest('[data-bill-ids]');
    if (!button) return;
    const ids = String(button.dataset.billIds || '').split(',').filter(Boolean);
    if (!ids.length) return;
    if (ids.length > 1) {
        openMonthPayablesModal(ids, button.dataset.cellLabel || '', button.dataset.cellMonth || '');
        return;
    }
    const bill = APD_STATE.bills.find((item) => item.id === ids[0]);
    if (!bill) return;
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

function renderDashboardVisibilityNote(matrixBills, visibleBills, outsideWindowBills) {
    const note = document.getElementById('dashboardVisibilityNote');
    if (!note) return;
    if (!matrixBills.length) {
        note.textContent = 'No saved APD payables yet.';
        note.classList.add('is-muted');
        return;
    }
    note.classList.remove('is-muted');
    if (!outsideWindowBills.length) {
        note.textContent = `${visibleBills.length} payable(s) are visible in this month window.`;
        return;
    }
    const earliest = outsideWindowBills
        .map((bill) => parseDateOnly(bill.dueDate))
        .filter(Boolean)
        .sort((left, right) => left - right)[0];
    const latest = outsideWindowBills
        .map((bill) => parseDateOnly(bill.dueDate))
        .filter(Boolean)
        .sort((left, right) => right - left)[0];
    const range = earliest && latest
        ? ` from ${formatMonthHeading(earliest)} to ${formatMonthHeading(latest)}`
        : '';
    note.textContent = `${visibleBills.length} payable(s) visible. ${outsideWindowBills.length} saved payable(s) are outside this window${range}; use Earlier/Later or the Payables Planner to find them.`;
}

function openMonthPayablesModal(ids, label, monthLabel) {
    const modal = document.getElementById('monthPayablesModal');
    const title = document.getElementById('monthPayablesTitle');
    const meta = document.getElementById('monthPayablesMeta');
    const list = document.getElementById('monthPayablesList');
    const bills = ids
        .map((id) => APD_STATE.bills.find((bill) => bill.id === id))
        .filter(Boolean)
        .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)) || left.payee.localeCompare(right.payee));

    title.textContent = `${label || 'Payables'} · ${monthLabel || 'Month'}`;
    meta.textContent = `${bills.length} payable(s) in this cell. Choose one to edit or prepare for check printing.`;
    list.innerHTML = bills.map((bill) => {
        const account = getAccountById(bill.accountId);
        return `
            <article class="month-payable-item">
                <div class="ref-cell">
                    <span class="ref-primary">${MargaUtils.escapeHtml(bill.payee || bill.id)}</span>
                    <span class="ref-secondary">${MargaUtils.escapeHtml([bill.documentType, bill.documentNumber, account?.name || ''].filter(Boolean).join(' · '))}</span>
                </div>
                <div class="month-payable-side">
                    <strong>${MargaUtils.formatCurrency(bill.amount)}</strong>
                    <span class="status-badge ${slugify(bill.status)}">${MargaUtils.escapeHtml(bill.status)}</span>
                    <button type="button" class="row-btn" data-open-month-bill="${MargaUtils.escapeHtml(bill.id)}">Open</button>
                    <button type="button" class="row-btn" data-check-month-bill="${MargaUtils.escapeHtml(bill.id)}">Prepare Check</button>
                    <button type="button" class="row-btn" data-print-month-bill="${MargaUtils.escapeHtml(bill.id)}">Print Check</button>
                </div>
            </article>
        `;
    }).join('');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeMonthPayablesModal() {
    const modal = document.getElementById('monthPayablesModal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function onMonthPayablePick(event) {
    const openButton = event.target.closest('[data-open-month-bill]');
    const checkButton = event.target.closest('[data-check-month-bill]');
    const printButton = event.target.closest('[data-print-month-bill]');
    const billId = openButton?.dataset.openMonthBill || checkButton?.dataset.checkMonthBill || printButton?.dataset.printMonthBill || '';
    if (!billId) return;
    const bill = APD_STATE.bills.find((item) => item.id === billId);
    if (!bill) return;
    closeMonthPayablesModal();
    if (checkButton) {
        prepareCheckForBill(bill);
        return;
    }
    if (printButton) {
        openCheckPrintForBill(bill);
        return;
    }
    openBillInWorkspace(bill);
}

function prepareCheckForBill(bill) {
    showView('workspace');
    setActiveTab('check-register-entry');
    document.getElementById('checkBillSelect').value = bill.id;
    syncCheckBillSelection();
    document.getElementById('checkNumberInput').focus();
}

function openCheckPrintForBill(bill) {
    const check = getLatestCheckForBill(bill.id);
    openCheckPrintModal(buildCheckPrintPayload({ bill, check }));
}

function openCheckPrintForCheck(check) {
    const bill = APD_STATE.bills.find((item) => item.id === check.billId);
    if (!bill) {
        MargaUtils.showToast('Cannot print: linked payable is missing.', 'error');
        return;
    }
    openCheckPrintModal(buildCheckPrintPayload({ bill, check }));
}

function openCheckPrintFromForm() {
    const bill = APD_STATE.bills.find((item) => item.id === document.getElementById('checkBillSelect').value);
    if (!bill) {
        MargaUtils.showToast('Choose a linked payable before printing.', 'error');
        return;
    }
    const draftCheck = normalizeCheck({
        id: document.getElementById('checkIdInput').value || '',
        billId: bill.id,
        bank: document.getElementById('checkBankInput').value,
        checkNumber: document.getElementById('checkNumberInput').value,
        issueDate: document.getElementById('checkIssueDateInput').value,
        amount: document.getElementById('checkAmountInput').value || bill.amount,
        status: document.getElementById('checkStatusInput').value || 'For Check Printing',
        receiptNumber: document.getElementById('checkReceiptInput').value,
        reason: document.getElementById('checkReasonInput').value
    });
    if (!draftCheck.issueDate || !(draftCheck.amount > 0)) {
        MargaUtils.showToast('Enter the check issue date and amount before printing.', 'error');
        return;
    }
    openCheckPrintModal(buildCheckPrintPayload({ bill, check: draftCheck }));
}

function openCheckPrintModal(payload) {
    APD_STATE.activePrintPayload = payload;
    document.getElementById('checkPrintMeta').textContent = `${payload.payee} · ${formatPesoAmount(payload.amount)} · ${payload.dateText}`;
    renderCheckPrintAdjustmentControls();
    renderActiveCheckPrintPreview();
    const modal = document.getElementById('checkPrintModal');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeCheckPrintModal() {
    const modal = document.getElementById('checkPrintModal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

function getLatestCheckForBill(billId) {
    return APD_STATE.checks
        .filter((check) => String(check.billId || '').trim() === String(billId || '').trim())
        .sort((left, right) => `${right.issueDate} ${right.id}`.localeCompare(`${left.issueDate} ${left.id}`))[0] || null;
}

function buildCheckPrintPayload({ bill, check = null }) {
    const amount = Number(check?.amount || bill.amount || 0);
    const issueDate = check?.issueDate || bill.dueDate || toDateInputValue(new Date());
    return {
        billId: bill.id,
        checkId: check?.id || '',
        checkNumber: String(check?.checkNumber || '').trim(),
        bank: String(check?.bank || '').trim(),
        payee: String(bill.payee || '').trim(),
        dateValue: issueDate,
        dateText: formatCheckDate(issueDate),
        amount,
        amountText: formatPesoAmount(amount),
        words: pesosToWords(amount),
        sourceStatus: check?.status || bill.status || 'For Check Printing'
    };
}

function normalizeCheckPrintCalibration(value = {}) {
    const paperWidthCm = Number(value?.paperWidthCm ?? CHECK_PRINT_CALIBRATION.paperWidthCm);
    const paperHeightCm = Number(value?.paperHeightCm ?? CHECK_PRINT_CALIBRATION.paperHeightCm);
    const offsetXmm = Number(value?.offsetXmm ?? CHECK_PRINT_CALIBRATION.offsetXmm);
    const offsetYmm = Number(value?.offsetYmm ?? CHECK_PRINT_CALIBRATION.offsetYmm);
    const scale = Number(value?.scale ?? CHECK_PRINT_CALIBRATION.scale);
    const rawSections = value?.sections || {};
    return {
        paperWidthCm: Number.isFinite(paperWidthCm) ? Math.max(10, Math.min(30, paperWidthCm)) : CHECK_PRINT_CALIBRATION.paperWidthCm,
        paperHeightCm: Number.isFinite(paperHeightCm) ? Math.max(5, Math.min(15, paperHeightCm)) : CHECK_PRINT_CALIBRATION.paperHeightCm,
        offsetXmm: Number.isFinite(offsetXmm) ? Math.max(-60, Math.min(60, offsetXmm)) : CHECK_PRINT_CALIBRATION.offsetXmm,
        offsetYmm: Number.isFinite(offsetYmm) ? Math.max(-40, Math.min(40, offsetYmm)) : CHECK_PRINT_CALIBRATION.offsetYmm,
        scale: Number.isFinite(scale) ? Math.max(0.75, Math.min(1.35, scale)) : CHECK_PRINT_CALIBRATION.scale,
        sections: Object.fromEntries(Object.keys(CHECK_PRINT_SECTION_LAYOUT).map((sectionKey) => {
            const defaults = CHECK_PRINT_CALIBRATION.sections[sectionKey];
            const current = rawSections?.[sectionKey] || {};
            const xMm = Number(current?.xMm ?? defaults.xMm);
            const yMm = Number(current?.yMm ?? defaults.yMm);
            const widthMm = Number(current?.widthMm ?? defaults.widthMm);
            const fontScale = Number(current?.fontScale ?? defaults.fontScale);
            return [sectionKey, {
                xMm: Number.isFinite(xMm) ? Math.max(-80, Math.min(80, xMm)) : defaults.xMm,
                yMm: Number.isFinite(yMm) ? Math.max(-50, Math.min(50, yMm)) : defaults.yMm,
                widthMm: Number.isFinite(widthMm) ? Math.max(20, Math.min(190, widthMm)) : defaults.widthMm,
                fontScale: Number.isFinite(fontScale) ? Math.max(0.65, Math.min(1.8, fontScale)) : defaults.fontScale
            }];
        }))
    };
}

function initializeCheckPrintTemplateState() {
    currentCheckPrintTemplates = loadCheckPrintTemplates();
    const storedActive = loadCheckPrintActiveTemplateName();
    currentCheckPrintTemplateName = currentCheckPrintTemplates[storedActive] ? storedActive : 'Default';
    currentCheckPrintCalibration = currentCheckPrintTemplates[currentCheckPrintTemplateName] || normalizeCheckPrintCalibration(CHECK_PRINT_CALIBRATION);
    saveCheckPrintActiveTemplateName(currentCheckPrintTemplateName);
    saveCheckPrintTemplates(currentCheckPrintTemplates);
}

function loadCheckPrintTemplates() {
    const templates = { Default: normalizeCheckPrintCalibration(CHECK_PRINT_CALIBRATION) };
    try {
        const parsed = JSON.parse(localStorage.getItem(APD_STORAGE_KEYS.checkPrintTemplates) || '{}');
        Object.entries(parsed || {}).forEach(([templateName, calibration]) => {
            templates[normalizeCheckPrintTemplateName(templateName)] = normalizeCheckPrintCalibration(calibration);
        });
    } catch (error) {
        console.warn('Unable to load APD check print templates.', error);
    }
    return templates;
}

function saveCheckPrintTemplates(nextTemplates = currentCheckPrintTemplates) {
    currentCheckPrintTemplates = Object.fromEntries(Object.entries(nextTemplates || {}).map(([templateName, calibration]) => [
        normalizeCheckPrintTemplateName(templateName),
        normalizeCheckPrintCalibration(calibration)
    ]));
    if (!Object.keys(currentCheckPrintTemplates).length) {
        currentCheckPrintTemplates.Default = normalizeCheckPrintCalibration(CHECK_PRINT_CALIBRATION);
    }
    try {
        localStorage.setItem(APD_STORAGE_KEYS.checkPrintTemplates, JSON.stringify(currentCheckPrintTemplates));
    } catch (error) {
        console.warn('Unable to save APD check print templates.', error);
    }
    return currentCheckPrintTemplates;
}

function normalizeCheckPrintTemplateName(value = '') {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    return normalized.slice(0, 48) || 'Default';
}

function loadCheckPrintActiveTemplateName() {
    try {
        return normalizeCheckPrintTemplateName(localStorage.getItem(APD_STORAGE_KEYS.checkPrintActiveTemplate) || 'Default');
    } catch (error) {
        return 'Default';
    }
}

function saveCheckPrintActiveTemplateName(templateName) {
    currentCheckPrintTemplateName = normalizeCheckPrintTemplateName(templateName);
    try {
        localStorage.setItem(APD_STORAGE_KEYS.checkPrintActiveTemplate, currentCheckPrintTemplateName);
    } catch (error) {
        console.warn('Unable to save active APD check print template.', error);
    }
    return currentCheckPrintTemplateName;
}

function saveCheckPrintCalibration(nextValue, options = {}) {
    currentCheckPrintCalibration = normalizeCheckPrintCalibration(nextValue);
    if (options.persistTemplate !== false) {
        currentCheckPrintTemplates[currentCheckPrintTemplateName] = currentCheckPrintCalibration;
        saveCheckPrintTemplates(currentCheckPrintTemplates);
    }
    return currentCheckPrintCalibration;
}

function resetCheckPrintCalibration() {
    saveCheckPrintActiveTemplateName('Default');
    return saveCheckPrintCalibration(CHECK_PRINT_CALIBRATION);
}

function applyCheckPrintTemplate(templateName) {
    const normalized = normalizeCheckPrintTemplateName(templateName);
    const nextCalibration = currentCheckPrintTemplates[normalized];
    if (!nextCalibration) return currentCheckPrintCalibration;
    saveCheckPrintActiveTemplateName(normalized);
    return saveCheckPrintCalibration(nextCalibration, { persistTemplate: false });
}

function saveCurrentCheckPrintTemplate(templateName) {
    const normalized = normalizeCheckPrintTemplateName(templateName || currentCheckPrintTemplateName);
    saveCheckPrintActiveTemplateName(normalized);
    currentCheckPrintTemplates[normalized] = normalizeCheckPrintCalibration(currentCheckPrintCalibration);
    saveCheckPrintTemplates(currentCheckPrintTemplates);
    return currentCheckPrintTemplates[normalized];
}

function deleteCheckPrintTemplate(templateName) {
    const normalized = normalizeCheckPrintTemplateName(templateName);
    if (normalized === 'Default') return currentCheckPrintCalibration;
    const nextTemplates = { ...currentCheckPrintTemplates };
    delete nextTemplates[normalized];
    saveCheckPrintTemplates(nextTemplates);
    const nextActive = currentCheckPrintTemplates[currentCheckPrintTemplateName] ? currentCheckPrintTemplateName : 'Default';
    return applyCheckPrintTemplate(nextActive);
}

function getCheckPrintSectionCalibration(sectionKey) {
    return currentCheckPrintCalibration.sections?.[sectionKey] || CHECK_PRINT_CALIBRATION.sections[sectionKey];
}

function checkSizeUnit(valueMm, mode = 'print') {
    return mode === 'screen'
        ? `${Number(valueMm || 0) * CHECK_PRINT_PREVIEW_MM_PX}px`
        : `${valueMm}mm`;
}

function buildCheckSectionStyle(sectionKey, mode = 'print') {
    const layout = CHECK_PRINT_SECTION_LAYOUT[sectionKey];
    const calibration = getCheckPrintSectionCalibration(sectionKey);
    return [
        'position:absolute',
        `left:${checkSizeUnit((layout.xMm || 0) + (calibration.xMm || 0), mode)}`,
        `top:${checkSizeUnit((layout.yMm || 0) + (calibration.yMm || 0), mode)}`,
        `width:${checkSizeUnit(calibration.widthMm || layout.widthMm || 40, mode)}`,
        'transform-origin:top left',
        `transform:scale(${calibration.fontScale || 1})`
    ].join(';');
}

function renderCheckPrintAdjustmentControls() {
    const panel = document.getElementById('checkPrintAdjustPanel');
    if (!panel) return;
    const templateOptions = Object.keys(currentCheckPrintTemplates)
        .sort((left, right) => left.localeCompare(right))
        .map((templateName) => `<option value="${escapeAttr(templateName)}"${templateName === currentCheckPrintTemplateName ? ' selected' : ''}>${MargaUtils.escapeHtml(templateName)}</option>`)
        .join('');
    panel.innerHTML = `
        <div class="check-template-grid">
            <label class="check-print-field">
                <span>Template</span>
                <select id="checkPrintTemplateSelect">${templateOptions}</select>
            </label>
            <label class="check-print-field">
                <span>Template Name</span>
                <input type="text" id="checkPrintTemplateNameInput" value="${escapeAttr(currentCheckPrintTemplateName)}" placeholder="BDO check layout">
            </label>
            <div class="check-template-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="checkPrintSaveTemplateBtn">Save Template</button>
                <button type="button" class="btn btn-secondary btn-sm" id="checkPrintDeleteTemplateBtn"${currentCheckPrintTemplateName === 'Default' ? ' disabled' : ''}>Delete</button>
            </div>
        </div>
        <div class="check-print-grid">
            <label class="check-print-field">
                <span>Paper W (cm)</span>
                <input type="number" data-check-print-control="paperWidthCm" step="0.1" min="10" max="30" value="${escapeAttr(String(currentCheckPrintCalibration.paperWidthCm))}">
            </label>
            <label class="check-print-field">
                <span>Paper H (cm)</span>
                <input type="number" data-check-print-control="paperHeightCm" step="0.1" min="5" max="15" value="${escapeAttr(String(currentCheckPrintCalibration.paperHeightCm))}">
            </label>
            <label class="check-print-field">
                <span>Left (mm)</span>
                <input type="number" data-check-print-control="offsetXmm" step="0.5" value="${escapeAttr(String(currentCheckPrintCalibration.offsetXmm))}">
            </label>
            <label class="check-print-field">
                <span>Top (mm)</span>
                <input type="number" data-check-print-control="offsetYmm" step="0.5" value="${escapeAttr(String(currentCheckPrintCalibration.offsetYmm))}">
            </label>
            <label class="check-print-field">
                <span>Scale</span>
                <input type="number" data-check-print-control="scale" step="0.01" min="0.75" max="1.35" value="${escapeAttr(String(currentCheckPrintCalibration.scale))}">
            </label>
        </div>
        <div class="check-print-section-title">Section Adjustments</div>
        <div class="check-section-grid">
            ${Object.entries(CHECK_PRINT_SECTION_LAYOUT).map(([sectionKey, layout]) => {
                const calibration = getCheckPrintSectionCalibration(sectionKey);
                return `
                    <div class="check-section-card">
                        <h4>${MargaUtils.escapeHtml(layout.label)}</h4>
                        <p>${MargaUtils.escapeHtml(layout.subtitle)}</p>
                        <div class="check-print-grid section-controls">
                            <label class="check-print-field">
                                <span>X (mm)</span>
                                <input type="number" data-check-section-key="${escapeAttr(sectionKey)}" data-check-section-field="xMm" step="0.5" value="${escapeAttr(String(calibration.xMm))}">
                            </label>
                            <label class="check-print-field">
                                <span>Y (mm)</span>
                                <input type="number" data-check-section-key="${escapeAttr(sectionKey)}" data-check-section-field="yMm" step="0.5" value="${escapeAttr(String(calibration.yMm))}">
                            </label>
                            <label class="check-print-field">
                                <span>Width</span>
                                <input type="number" data-check-section-key="${escapeAttr(sectionKey)}" data-check-section-field="widthMm" step="1" value="${escapeAttr(String(calibration.widthMm))}">
                            </label>
                            <label class="check-print-field">
                                <span>Font</span>
                                <input type="number" data-check-section-key="${escapeAttr(sectionKey)}" data-check-section-field="fontScale" step="0.05" min="0.65" max="1.8" value="${escapeAttr(String(calibration.fontScale))}">
                            </label>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function handleCheckPrintControlInput(event) {
    const target = event.target;
    if (target?.id === 'checkPrintTemplateSelect') {
        applyCheckPrintTemplate(target.value);
        renderCheckPrintAdjustmentControls();
        renderActiveCheckPrintPreview();
        return;
    }
    if (!target?.matches?.('[data-check-print-control], [data-check-section-key][data-check-section-field]')) return;
    updateCheckPrintCalibrationFromControls();
}

function handleCheckPrintToolClick(event) {
    if (event.target?.id === 'checkPrintSaveTemplateBtn') {
        const nameInput = document.getElementById('checkPrintTemplateNameInput');
        saveCurrentCheckPrintTemplate(nameInput?.value || currentCheckPrintTemplateName);
        renderCheckPrintAdjustmentControls();
        renderActiveCheckPrintPreview();
        MargaUtils.showToast(`Check print template "${currentCheckPrintTemplateName}" saved.`, 'success');
        return;
    }
    if (event.target?.id === 'checkPrintDeleteTemplateBtn') {
        const deletedTemplate = currentCheckPrintTemplateName;
        deleteCheckPrintTemplate(currentCheckPrintTemplateName);
        renderCheckPrintAdjustmentControls();
        renderActiveCheckPrintPreview();
        MargaUtils.showToast(`Check print template "${deletedTemplate}" deleted.`, 'success');
    }
}

function updateCheckPrintCalibrationFromControls() {
    const modal = document.getElementById('checkPrintModal');
    const nextSections = Object.fromEntries(Object.keys(CHECK_PRINT_SECTION_LAYOUT).map((sectionKey) => {
        const defaults = currentCheckPrintCalibration.sections?.[sectionKey] || CHECK_PRINT_CALIBRATION.sections[sectionKey];
        const sectionValues = { ...defaults };
        modal.querySelectorAll('[data-check-section-key][data-check-section-field]').forEach((input) => {
            if (input.dataset.checkSectionKey !== sectionKey) return;
            sectionValues[input.dataset.checkSectionField] = Number(input.value || 0);
        });
        return [sectionKey, sectionValues];
    }));
    const controlValue = (key, fallback) => {
        const input = modal.querySelector(`[data-check-print-control="${key}"]`);
        return input ? Number(input.value || 0) : fallback;
    };
    saveCheckPrintCalibration({
        paperWidthCm: controlValue('paperWidthCm', currentCheckPrintCalibration.paperWidthCm),
        paperHeightCm: controlValue('paperHeightCm', currentCheckPrintCalibration.paperHeightCm),
        offsetXmm: controlValue('offsetXmm', currentCheckPrintCalibration.offsetXmm),
        offsetYmm: controlValue('offsetYmm', currentCheckPrintCalibration.offsetYmm),
        scale: controlValue('scale', currentCheckPrintCalibration.scale),
        sections: nextSections
    });
    renderActiveCheckPrintPreview();
}

function renderActiveCheckPrintPreview() {
    if (!APD_STATE.activePrintPayload) return;
    document.getElementById('checkPrintPreviewPage').innerHTML = buildCheckPrintHtml(APD_STATE.activePrintPayload, 'screen');
}

function buildCheckPrintHtml(payload, mode = 'screen') {
    const paperWidthMm = currentCheckPrintCalibration.paperWidthCm * 10;
    const paperHeightMm = currentCheckPrintCalibration.paperHeightCm * 10;
    return `
        <section class="check-calibration-shell" aria-label="Check print preview">
            <div
                class="check-calibration-paper"
                style="--check-paper-width-mm:${paperWidthMm}; --check-paper-height-mm:${paperHeightMm}; width:${checkSizeUnit(paperWidthMm, mode)}; height:${checkSizeUnit(paperHeightMm, mode)};"
            >
                <div
                    class="check-calibration-sheet"
                    style="transform: translate(${checkSizeUnit(currentCheckPrintCalibration.offsetXmm, mode)}, ${checkSizeUnit(currentCheckPrintCalibration.offsetYmm, mode)}) scale(${currentCheckPrintCalibration.scale});"
                >
                    <div class="check-print-section check-payee" style="${buildCheckSectionStyle('payee', mode)}">${MargaUtils.escapeHtml(payload.payee)}</div>
                    <div class="check-print-section check-date" style="${buildCheckSectionStyle('date', mode)}">${MargaUtils.escapeHtml(payload.dateText)}</div>
                    <div class="check-print-section check-amount" style="${buildCheckSectionStyle('amount', mode)}">${MargaUtils.escapeHtml(payload.amountText)}</div>
                    <div class="check-print-section check-words" style="${buildCheckSectionStyle('words', mode)}">${MargaUtils.escapeHtml(payload.words)}</div>
                </div>
            </div>
        </section>
    `;
}

function printActiveCheck() {
    const payload = APD_STATE.activePrintPayload;
    if (!payload) return;
    savePrintedCheckRecord(payload);
    writePrintHtmlDocument(openPrintWindow(`marga_apd_check_${payload.checkNumber || payload.billId}`), buildCheckPrintDocument(payload));
}

function savePrintedCheckRecord(payload) {
    if (!payload.checkNumber || !payload.billId) return;
    const existingDuplicate = APD_STATE.checks.find((check) => (
        check.id !== payload.checkId
        && check.checkNumber === payload.checkNumber
        && String(check.bank || '').toLowerCase() === String(payload.bank || '').toLowerCase()
    ));
    if (existingDuplicate) {
        MargaUtils.showToast('Printed preview opened, but the check record was not changed because that check number already exists for the same bank.', 'info');
        return;
    }
    const next = normalizeCheck({
        id: payload.checkId || createCheckId(),
        billId: payload.billId,
        bank: payload.bank || 'Operating Check Account',
        checkNumber: payload.checkNumber,
        issueDate: payload.dateValue,
        amount: payload.amount,
        status: 'Printed',
        createdAt: isoNow()
    });
    upsertById(APD_STATE.checks, next);
    syncBillStatusFromCheck(next);
    persistState();
    persistApdSharedState();
    syncPettyCashRequestsFromChecks();
    renderAll();
}

function openPrintWindow(windowName) {
    const printWindow = window.open('', windowName, 'width=1000,height=760');
    if (!printWindow) {
        alert('Please allow pop-ups to print the check.');
        return null;
    }
    printWindow.document.write('<!DOCTYPE html><html><head><title>Preparing Check</title></head><body style="font-family:Arial,sans-serif;padding:24px;">Preparing check print...</body></html>');
    printWindow.document.close();
    return printWindow;
}

function writePrintHtmlDocument(printWindow, html) {
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    const triggerPrint = () => {
        try {
            printWindow.print();
        } catch (error) {
            console.warn('Check print failed:', error);
        }
    };
    printWindow.addEventListener('load', triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 500);
}

function buildCheckPrintDocument(payload) {
    const paperWidthCm = currentCheckPrintCalibration.paperWidthCm;
    const paperHeightCm = currentCheckPrintCalibration.paperHeightCm;
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>APD Check ${MargaUtils.escapeHtml(payload.checkNumber || payload.billId)}</title>
            <style>
                @page { size: ${paperWidthCm}cm ${paperHeightCm}cm; margin: 0; }
                * { box-sizing: border-box; }
                body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; }
                .check-print-wrap { width: ${paperWidthCm}cm; height: ${paperHeightCm}cm; overflow: hidden; position: relative; }
                .check-calibration-shell, .check-calibration-paper { width: 100%; height: 100%; position: relative; overflow: hidden; background: #fff; }
                .check-calibration-sheet { position: absolute; inset: 0; transform-origin: top left; }
                .check-print-section { position: absolute; white-space: nowrap; overflow: hidden; line-height: 1.25; color: #111; font-size: 12pt; }
                .check-date, .check-amount { text-align: right; }
                .check-words { white-space: normal; font-size: 11pt; }
            </style>
        </head>
        <body><div class="check-print-wrap">${buildCheckPrintHtml(payload, 'print')}</div></body>
        </html>
    `;
}

function formatCheckDate(value) {
    const date = parseDateOnly(value);
    if (!date) return '';
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatPesoAmount(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function pesosToWords(value) {
    const amount = Math.max(0, Number(value || 0));
    const pesos = Math.floor(amount);
    const cents = Math.round((amount - pesos) * 100);
    return `${numberToEnglishWords(pesos)} Pesos and ${String(cents).padStart(2, '0')}/100 Only`;
}

function numberToEnglishWords(value) {
    const number = Math.floor(Number(value || 0));
    const small = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if (number === 0) return 'Zero';
    if (number < 20) return small[number];
    if (number < 100) return [tens[Math.floor(number / 10)], small[number % 10]].filter(Boolean).join(' ');
    if (number < 1000) return [small[Math.floor(number / 100)], 'Hundred', numberToEnglishWords(number % 100)].filter((part) => part && part !== 'Zero').join(' ');
    const scales = [
        { value: 1000000000, label: 'Billion' },
        { value: 1000000, label: 'Million' },
        { value: 1000, label: 'Thousand' }
    ];
    for (const scale of scales) {
        if (number >= scale.value) {
            const head = numberToEnglishWords(Math.floor(number / scale.value));
            const tail = numberToEnglishWords(number % scale.value);
            return [head, scale.label, tail === 'Zero' ? '' : tail].filter(Boolean).join(' ');
        }
    }
    return String(number);
}

function escapeAttr(value) {
    return MargaUtils.escapeHtml(String(value ?? '')).replace(/"/g, '&quot;');
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

function setDayWithinMonth(monthDate, day) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.max(1, Math.min(Number(day || 1), lastDay));
    return new Date(year, month, safeDay);
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

function getMonthKey(date) {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
