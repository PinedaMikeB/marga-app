if (!MargaAuth.requireAccess('apd')) {
    throw new Error('Unauthorized access to APD module.');
}

const APD_STORAGE_KEYS = {
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

const SHARED_ACCOUNTS = [
    {
        id: 'fuel_delivery_expense',
        name: 'Fuel and Delivery Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Fuel used for messenger, logistics, delivery, and field business trips.',
        useWhen: 'Use for gasoline or diesel used in company operations.',
        avoid: 'Do not use for repairs, private use, or parts replacement.'
    },
    {
        id: 'rental_service_supplies_expense',
        name: 'Rental Service Supplies Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Parts, toner, ink, and rental-package supplies already consumed for customer support.',
        useWhen: 'Use when the stock has already been issued and should now hit expense.',
        avoid: 'Do not use for inventory purchases that are still on hand or for machine assets.'
    },
    {
        id: 'bank_loans_payable',
        name: 'Bank Loans (Payable)',
        type: 'Liability',
        scope: 'apd',
        meaning: 'Outstanding bank loan principal still owed.',
        useWhen: 'Use for principal amortization against a bank loan.',
        avoid: 'Do not use for interest, penalties, or supplier installments.'
    },
    {
        id: 'accounts_payable_installment_arrangement',
        name: 'Accounts Payable - Installment Arrangement',
        type: 'Liability',
        scope: 'apd',
        meaning: 'Supplier balances being paid by installments after the original due date.',
        useWhen: 'Use when APD is tracking a supplier settlement with scheduled installments.',
        avoid: 'Do not use for bank loans or direct daily expenses with no payable schedule.'
    },
    {
        id: 'petty_cash_fund',
        name: 'Petty Cash Fund',
        type: 'Asset',
        scope: 'pettycash',
        meaning: 'Cash fund assigned to the petty cash custodian.',
        useWhen: 'Use when creating, replenishing, or transferring to petty cash.',
        avoid: 'Do not use as the final expense account before liquidation.'
    },
    {
        id: 'cash_in_bank_savings',
        name: 'Cash in Bank - Savings',
        type: 'Asset',
        scope: 'shared',
        meaning: 'Company funds deposited and held in the savings account.',
        useWhen: 'Use when moving money into savings or identifying funds currently held there.',
        avoid: 'Do not use for operating expenses or owner withdrawals.'
    },
    {
        id: 'owners_drawings',
        name: "Owner's Drawings",
        type: 'Equity',
        scope: 'shared',
        meaning: 'Business funds withdrawn by the owner for personal use.',
        useWhen: 'Use only for personal withdrawals by the owner.',
        avoid: 'Do not use for payroll, supplier bills, or operating expenses.'
    },
    {
        id: 'salaries_wages_expense',
        name: 'Salaries and Wages Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Employee compensation cost for payroll.',
        useWhen: 'Use for payroll expense and approved wage-related payouts.',
        avoid: 'Do not use for owner withdrawals or government contribution liabilities alone.'
    },
    {
        id: 'rental_machines_equipment',
        name: 'Rental Machines and Equipment',
        type: 'Fixed Asset',
        scope: 'apd',
        meaning: 'Machine units purchased for rental deployment or change-unit pool.',
        useWhen: 'Use when the company buys a machine unit that will stay as a business asset.',
        avoid: 'Do not use for toner, parts, repairs, or routine maintenance.'
    },
    {
        id: 'rent_expense',
        name: 'Rent Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Cost of leasing office or operating facilities.',
        useWhen: 'Use for monthly rental of office or premises.',
        avoid: 'Do not use for repair work or leasehold improvements.'
    },
    {
        id: 'electricity_expense',
        name: 'Electricity Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Power cost for business facilities.',
        useWhen: 'Use for electric utility bills.',
        avoid: 'Do not use for fuel or internet charges.'
    },
    {
        id: 'telephone_expense',
        name: 'Telephone Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Voice call or landline communication cost.',
        useWhen: 'Use for telephone-only subscriptions or call charges.',
        avoid: 'Do not use for internet-only service.'
    },
    {
        id: 'internet_expense',
        name: 'Internet Expense',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Internet connectivity cost for office operations.',
        useWhen: 'Use for broadband, fiber, or business internet subscriptions.',
        avoid: 'Do not use for telephone-only service or device purchases.'
    },
    {
        id: 'repairs_maintenance_leased_premises',
        name: 'Repairs and Maintenance - Leased Premises',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Repair and upkeep cost for rented business premises.',
        useWhen: 'Use for repair and maintenance of office or leased facility.',
        avoid: 'Do not use for rent, new construction, or motorcycle repairs.'
    },
    {
        id: 'repairs_maintenance_motorcycles',
        name: 'Repairs and Maintenance - Motorcycles',
        type: 'Expense',
        scope: 'shared',
        meaning: 'Repair and upkeep cost of motorcycles used by technicians or messengers.',
        useWhen: 'Use for tire replacement, oil change, tune-up, and similar maintenance.',
        avoid: 'Do not use for fuel or purchase of a new motorcycle.'
    },
    {
        id: 'employer_philhealth_contribution_expense',
        name: 'Employer PhilHealth Contribution Expense',
        type: 'Expense',
        scope: 'apd',
        meaning: 'Employer share of PhilHealth contribution cost.',
        useWhen: 'Use when recognizing the company share of PhilHealth contribution.',
        avoid: 'Do not use when recording the unpaid remittance liability.'
    },
    {
        id: 'philhealth_payable',
        name: 'PhilHealth Payable',
        type: 'Liability',
        scope: 'apd',
        meaning: 'Unpaid PhilHealth amount due for remittance.',
        useWhen: 'Use when recording or paying the PhilHealth balance still owed.',
        avoid: 'Do not use as the employer expense line.'
    },
    {
        id: 'employer_pagibig_contribution_expense',
        name: 'Employer Pag-IBIG Contribution Expense',
        type: 'Expense',
        scope: 'apd',
        meaning: 'Employer share of Pag-IBIG or HDMF contribution cost.',
        useWhen: 'Use when recognizing the company share of Pag-IBIG contribution.',
        avoid: 'Do not use for the unpaid balance still due to HDMF.'
    },
    {
        id: 'hdmf_payable',
        name: 'HDMF Payable',
        type: 'Liability',
        scope: 'apd',
        meaning: 'Unpaid Pag-IBIG or HDMF amount still owed for remittance.',
        useWhen: 'Use when recording or paying the HDMF balance due.',
        avoid: 'Do not use as the employer expense line.'
    }
];

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
    bills: [],
    checks: []
};

document.addEventListener('DOMContentLoaded', () => {
    loadUserHeader();
    hydrateState();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindFormControls();
    populateSelects();
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
    APD_STATE.bills = readStorage(APD_STORAGE_KEYS.bills, DEFAULT_BILLS).map(normalizeBill);
    APD_STATE.checks = readStorage(APD_STORAGE_KEYS.checks, DEFAULT_CHECKS).map(normalizeCheck);
}

function bindFormControls() {
    document.getElementById('billForm').addEventListener('submit', onBillSubmit);
    document.getElementById('checkForm').addEventListener('submit', onCheckSubmit);
    document.getElementById('billFormClearBtn').addEventListener('click', clearBillForm);
    document.getElementById('checkFormClearBtn').addEventListener('click', clearCheckForm);
    document.getElementById('accountSearchInput').addEventListener('input', renderAccountCards);
    document.getElementById('accountScopeFilter').addEventListener('change', renderAccountCards);
    document.getElementById('billSearchInput').addEventListener('input', renderBillsTable);
    document.getElementById('billStatusFilter').addEventListener('change', renderBillsTable);
    document.getElementById('checkStatusFilter').addEventListener('change', renderChecksTable);
    document.getElementById('checkBillSelect').addEventListener('change', syncCheckBillSelection);
    document.getElementById('resetDemoBtn').addEventListener('click', resetDemoData);
    document.getElementById('billsTableBody').addEventListener('click', onBillTableAction);
    document.getElementById('checksTableBody').addEventListener('click', onCheckTableAction);
}

function populateSelects() {
    const billAccountInput = document.getElementById('billAccountInput');
    billAccountInput.innerHTML = SHARED_ACCOUNTS.map((account) => (
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
    renderAccountCards();
    renderBillsTable();
    renderChecksTable();
    renderAlerts();
    populateBillSelect(document.getElementById('checkBillSelect').value);
}

function renderOverview() {
    const today = startOfDay(new Date());
    const nextWeek = addDays(today, 7);
    const openBills = APD_STATE.bills.filter((bill) => !['Released', 'Cleared', 'Voided'].includes(bill.status));
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

function renderAccountCards() {
    const grid = document.getElementById('accountGuideGrid');
    const search = String(document.getElementById('accountSearchInput').value || '').trim().toLowerCase();
    const scope = String(document.getElementById('accountScopeFilter').value || 'all').trim().toLowerCase();
    const accounts = SHARED_ACCOUNTS.filter((account) => {
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
            document.getElementById('billAccountInput').value = button.dataset.accountId;
            document.getElementById('billAccountInput').focus();
            MargaUtils.showToast('Account selected in payable form.', 'info');
        });
    });
}

function renderBillsTable() {
    const tbody = document.getElementById('billsTableBody');
    const search = String(document.getElementById('billSearchInput').value || '').trim().toLowerCase();
    const statusFilter = String(document.getElementById('billStatusFilter').value || 'all');
    const rows = APD_STATE.bills
        .filter((bill) => {
            const account = getAccountById(bill.accountId);
            const haystack = `${bill.id} ${bill.payee} ${bill.documentNumber} ${account?.name || ''}`.toLowerCase();
            return (!search || haystack.includes(search)) && (statusFilter === 'all' || bill.status === statusFilter);
        })
        .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No payable matched the current filters.</div></td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((bill) => {
        const account = getAccountById(bill.accountId);
        return `
            <tr>
                <td>
                    <div class="ref-cell">
                        <span class="ref-primary">${MargaUtils.escapeHtml(bill.id)}</span>
                        <span class="ref-secondary">${MargaUtils.escapeHtml(bill.documentType)} · ${MargaUtils.escapeHtml(bill.documentNumber)}</span>
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
    const next = normalizeBill({
        id: billId || createBillId(),
        payee: document.getElementById('billPayeeInput').value,
        documentType: document.getElementById('billDocTypeInput').value,
        documentNumber: document.getElementById('billDocNumberInput').value,
        dueDate: document.getElementById('billDueDateInput').value,
        accountId: document.getElementById('billAccountInput').value,
        amount: document.getElementById('billAmountInput').value,
        status: document.getElementById('billStatusInput').value,
        notes: document.getElementById('billNotesInput').value,
        createdAt: isoNow()
    });

    if (!next.payee || !next.documentNumber || !next.accountId || !next.dueDate || !(next.amount > 0)) {
        MargaUtils.showToast('Complete the payable form before saving.', 'error');
        return;
    }

    upsertById(APD_STATE.bills, next);
    persistState();
    clearBillForm();
    populateBillSelect();
    renderAll();
    MargaUtils.showToast('Payable saved in APD planner.', 'success');
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
        document.getElementById('billIdInput').value = bill.id;
        document.getElementById('billPayeeInput').value = bill.payee;
        document.getElementById('billDocTypeInput').value = bill.documentType;
        document.getElementById('billDocNumberInput').value = bill.documentNumber;
        document.getElementById('billDueDateInput').value = bill.dueDate;
        document.getElementById('billAccountInput').value = bill.accountId;
        document.getElementById('billAmountInput').value = Number(bill.amount || 0).toFixed(2);
        document.getElementById('billStatusInput').value = bill.status;
        document.getElementById('billNotesInput').value = bill.notes || '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    if (button.dataset.action === 'link-check') {
        document.getElementById('checkBillSelect').value = bill.id;
        syncCheckBillSelection();
        document.getElementById('checkNumberInput').focus();
        window.scrollTo({ top: document.body.scrollHeight * 0.52, behavior: 'smooth' });
    }
}

function onCheckTableAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const check = APD_STATE.checks.find((item) => item.id === button.dataset.id);
    if (!check) return;
    if (button.dataset.action === 'edit-check') {
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
        window.scrollTo({ top: document.body.scrollHeight * 0.52, behavior: 'smooth' });
    }
}

function clearBillForm() {
    document.getElementById('billForm').reset();
    document.getElementById('billIdInput').value = '';
    document.getElementById('billStatusInput').value = 'Draft';
    document.getElementById('billAccountInput').selectedIndex = 0;
}

function clearCheckForm() {
    document.getElementById('checkForm').reset();
    document.getElementById('checkIdInput').value = '';
    document.getElementById('checkStatusInput').value = 'For Check Printing';
    populateBillSelect();
}

function resetDemoData() {
    localStorage.removeItem(APD_STORAGE_KEYS.bills);
    localStorage.removeItem(APD_STORAGE_KEYS.checks);
    hydrateState();
    clearBillForm();
    clearCheckForm();
    renderAll();
    MargaUtils.showToast('APD demo data reset to defaults.', 'info');
}

function persistState() {
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
    return {
        id: String(bill.id || createBillId()).trim(),
        payee: String(bill.payee || '').trim(),
        documentType: String(bill.documentType || 'Invoice').trim(),
        documentNumber: String(bill.documentNumber || '').trim(),
        dueDate: String(bill.dueDate || '').trim(),
        accountId: String(bill.accountId || '').trim(),
        amount: Number(bill.amount || 0),
        status: BILL_STATUSES.includes(String(bill.status || '').trim()) ? String(bill.status).trim() : 'Draft',
        notes: String(bill.notes || '').trim(),
        createdAt: String(bill.createdAt || isoNow())
    };
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
    return SHARED_ACCOUNTS.find((account) => account.id === accountId) || null;
}

function upsertById(items, nextItem) {
    const index = items.findIndex((item) => item.id === nextItem.id);
    if (index === -1) {
        items.push(nextItem);
        return;
    }
    items[index] = nextItem;
}

function getDueClass(dateValue, status) {
    if (['Released', 'Cleared', 'Voided'].includes(status)) return 'on-schedule';
    const due = parseDateOnly(dateValue);
    if (!due) return 'on-schedule';
    const today = startOfDay(new Date());
    if (due < today) return 'overdue';
    if (due <= addDays(today, 7)) return 'due-soon';
    return 'on-schedule';
}

function getDueLabel(dateValue, status) {
    if (['Released', 'Cleared'].includes(status)) return 'Closed';
    if (status === 'Voided') return 'Voided';
    const due = parseDateOnly(dateValue);
    if (!due) return 'No Due Date';
    const today = startOfDay(new Date());
    if (due < today) return 'Overdue';
    if (due <= addDays(today, 7)) return 'Due Soon';
    return 'On Schedule';
}

function formatScope(scope) {
    if (scope === 'apd') return 'APD Only';
    if (scope === 'pettycash') return 'Petty Cash Relevant';
    return 'Shared';
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

function parseDateOnly(value) {
    if (!value) return null;
    const parts = String(value).split('-').map((item) => Number(item));
    if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
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

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;
