const ACCOUNTING_STATE = {
    activeTab: 'pettycash',
    loading: false,
    pettyCashRows: [],
    collectionRows: [],
    suppliers: new Map(),
    checksByPaymentId: new Map(),
    checksByInvoiceId: new Map(),
    invoices: new Map(),
    contracts: new Map(),
    contractDeps: new Map(),
    branches: new Map(),
    companies: new Map()
};

const PETTY_CASH_COLUMNS = [
    { key: 'net', label: 'NET', numeric: true },
    { key: 'vat', label: 'VAT', numeric: true },
    { key: 'totalAmount', label: 'TOTAL AMOUNT', numeric: true },
    { key: 'company', label: 'COMPANY' },
    { key: 'tinNumber', label: 'TIN NUMBER' },
    { key: 'address', label: 'ADDRESS' },
    { key: 'voucherNumber', label: 'VOUCHER NO.' },
    { key: 'date', label: 'DATE' },
    { key: 'itemNote', label: 'ITEM / REMARKS' },
    { key: 'status', label: 'STATUS' }
];

const COLLECTION_COLUMNS = [
    { key: 'id', label: 'ID' },
    { key: 'invoiceNo', label: 'INVOICE NO.' },
    { key: 'client', label: 'CLIENT' },
    { key: 'category', label: 'CTGRY' },
    { key: 'invoiceAmount', label: 'INV. AMOUNT', numeric: true },
    { key: 'invoiceDate', label: 'INVOICE DATE' },
    { key: 'printedOr', label: 'PRINTED OR #' },
    { key: 'assigned', label: 'ASSIGNED' },
    { key: 'datePaid', label: 'DATE PAID' },
    { key: 'dateDeposit', label: 'DATE DPST' },
    { key: 'paidAmount', label: 'PAID AMOUNT', numeric: true },
    { key: 'paymentType', label: 'PYMNT TY' },
    { key: 'status', label: 'STATUS' },
    { key: 'balance', label: 'BALANCE', numeric: true },
    { key: 'ewt', label: 'EWT', numeric: true },
    { key: 'checkNumber', label: 'CHECK #' },
    { key: 'checkAmount', label: 'CHECK AMOUNT', numeric: true },
    { key: 'checkDate', label: 'CHECK DATE' },
    { key: 'accountBank', label: 'ACCOUNT BANK' }
];

document.addEventListener('DOMContentLoaded', async () => {
    if (!MargaAuth.requireAuth()) return;
    loadUserHeader();
    bindControls();
    setDefaultDates();
    await loadAccountingData();
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

function bindControls() {
    document.querySelectorAll('[data-grid-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            ACCOUNTING_STATE.activeTab = button.dataset.gridTab;
            document.querySelectorAll('[data-grid-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
            renderAccountingGrid();
        });
    });
    document.getElementById('fromDateInput').addEventListener('change', renderAccountingGrid);
    document.getElementById('toDateInput').addEventListener('change', renderAccountingGrid);
    document.getElementById('accountingSearchInput').addEventListener('input', MargaUtils.debounce(renderAccountingGrid, 150));
    document.getElementById('refreshAccountingBtn').addEventListener('click', loadAccountingData);
    document.getElementById('exportAccountingBtn').addEventListener('click', exportActiveGrid);
}

function setDefaultDates() {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('fromDateInput').value = toDateKey(from);
    document.getElementById('toDateInput').value = toDateKey(today);
}

async function loadAccountingData() {
    if (ACCOUNTING_STATE.loading) return;
    ACCOUNTING_STATE.loading = true;
    setGridStatus('Loading accounting source tables...');

    try {
        const [
            entries,
            suppliers,
            companies,
            branches,
            contracts,
            contractDeps,
            billings,
            payments,
            checks
        ] = await Promise.all([
            fetchCollectionRows('tbl_pettycash_entries', 1000, 60),
            fetchCollectionRows('tbl_supplier', 1000, 80),
            fetchCollectionRows('tbl_companylist', 1000, 40, ['id', 'companyname', 'company_name']),
            fetchCollectionRows('tbl_branchinfo', 1000, 100, ['id', 'company_id', 'branchname', 'branch_name']),
            fetchCollectionRows('tbl_contractmain', 1000, 80, ['id', 'contract_id', 'category_id']),
            fetchCollectionRows('tbl_contractdep', 1000, 80, ['id', 'branch_id']),
            fetchCollectionRows('tbl_billing', 1000, 330, ['id', 'invoice_id', 'invoiceid', 'invoiceno', 'invoice_no', 'contractmain_id', 'totalamount', 'amount', 'dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date', 'assigned', 'assigned_to', 'category', 'ctgry']),
            fetchCollectionRows('tbl_paymentinfo', 1000, 270, ['id', 'invoice_id', 'invoice_num', 'invoice_no', 'payment_amt', 'payment_amount', 'balance_amt', 'date_deposit', 'date_paid', 'tax_date_paid', 'ornum', 'or_number', 'payment_type', 'tax_2307', 'deduction_amount', 'tax_form_status', 'checkpayment_id', 'check_number', 'check_date', 'bank']),
            fetchCollectionRows('tbl_checkpayments', 1000, 80, ['id', 'payments_id', 'payment_id', 'invoice_id', 'check_number', 'bank', 'account_bank', 'bank_name', 'check_amt', 'check_amount', 'check_date'])
        ]);

        indexLookups({ suppliers, companies, branches, contracts, contractDeps, billings, checks });
        ACCOUNTING_STATE.pettyCashRows = entries.map(buildPettyCashAccountingRow).filter(Boolean);
        ACCOUNTING_STATE.collectionRows = payments.map(buildCollectionAccountingRow).filter(Boolean);
        document.getElementById('summarySync').textContent = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        setGridStatus('Ready.');
        renderAccountingGrid();
    } catch (error) {
        console.error('Accounting load failed:', error);
        setGridStatus('Unable to load accounting data. Refresh and try again.');
    } finally {
        ACCOUNTING_STATE.loading = false;
    }
}

function indexLookups({ suppliers, companies, branches, contracts, contractDeps, billings, checks }) {
    ACCOUNTING_STATE.suppliers = new Map();
    suppliers.forEach((row) => {
        const name = normalizeSearch(row.supplier || row.supplier_name || row.companyname || row.company_name || row.name || row.payee);
        const id = normalizeId(row.id || row._docId);
        if (name) ACCOUNTING_STATE.suppliers.set(name, row);
        if (id) ACCOUNTING_STATE.suppliers.set(id, row);
    });

    ACCOUNTING_STATE.companies = new Map();
    companies.forEach((row) => {
        const id = normalizeId(row.id || row._docId);
        if (id) ACCOUNTING_STATE.companies.set(id, row);
    });

    ACCOUNTING_STATE.branches = new Map();
    branches.forEach((row) => {
        const id = normalizeId(row.id || row._docId);
        if (id) ACCOUNTING_STATE.branches.set(id, row);
    });

    ACCOUNTING_STATE.contracts = new Map();
    contracts.forEach((row) => {
        const id = normalizeId(row.id || row._docId);
        if (id) ACCOUNTING_STATE.contracts.set(id, row);
    });

    ACCOUNTING_STATE.contractDeps = new Map();
    contractDeps.forEach((row) => {
        const id = normalizeId(row.id || row._docId);
        if (id) ACCOUNTING_STATE.contractDeps.set(id, row);
    });

    ACCOUNTING_STATE.invoices = new Map();
    billings.forEach((row) => {
        const invoice = buildInvoiceLookupRow(row);
        [invoice.invoiceId, invoice.invoiceNo, invoice.id].map(normalizeId).filter(Boolean).forEach((key) => {
            ACCOUNTING_STATE.invoices.set(key, invoice);
        });
    });

    ACCOUNTING_STATE.checksByPaymentId = new Map();
    ACCOUNTING_STATE.checksByInvoiceId = new Map();
    checks.forEach((row) => {
        const paymentId = normalizeId(row.payments_id || row.payment_id || row.id || row._docId);
        const invoiceId = normalizeId(row.invoice_id || row.invoice_num);
        if (paymentId) ACCOUNTING_STATE.checksByPaymentId.set(paymentId, row);
        if (invoiceId) ACCOUNTING_STATE.checksByInvoiceId.set(invoiceId, row);
    });
}

function buildPettyCashAccountingRow(entry) {
    const totalAmount = Number(entry.amount || 0);
    if (!(totalAmount > 0)) return null;
    const supplierKey = normalizeSearch(entry.supplier || entry.payee);
    const supplier = ACCOUNTING_STATE.suppliers.get(supplierKey) || {};
    const company = firstValue(supplier.supplier, supplier.supplier_name, supplier.companyname, supplier.company_name, supplier.name, entry.supplier, entry.payee);
    const tinNumber = firstValue(supplier.tin, supplier.tin_number, supplier.tinno, supplier.tin_no, supplier.tax_id);
    const address = buildAddressText([
        supplier.address,
        supplier.supplier_address,
        supplier.company_address,
        supplier.branch_address,
        supplier.street,
        supplier.brgy,
        supplier.city
    ]);
    const net = roundMoney(totalAmount / 1.12);
    const vat = roundMoney(totalAmount - net);

    return {
        date: toDateKey(normalizeDate(entry.date)) || String(entry.date || ''),
        sortDate: normalizeDate(entry.date),
        net,
        vat,
        totalAmount,
        company,
        tinNumber,
        address,
        voucherNumber: entry.voucherNumber || entry.voucher_number || entry.id || '',
        itemNote: firstValue(entry.itemNote, entry.description),
        status: entry.status || ''
    };
}

function buildCollectionAccountingRow(payment) {
    const paidAmount = Number(payment.payment_amt || payment.payment_amount || 0);
    const ewt = Number(payment.tax_2307 || 0);
    const deductionAmount = Number(payment.deduction_amount || 0);
    if (!(paidAmount > 0) && !(ewt > 0) && !(deductionAmount > 0)) return null;

    const invoiceKey = normalizeId(payment.invoice_id || payment.invoice_num || payment.invoice_no);
    const invoice = ACCOUNTING_STATE.invoices.get(invoiceKey) || {};
    const check = ACCOUNTING_STATE.checksByPaymentId.get(normalizeId(payment.checkpayment_id))
        || ACCOUNTING_STATE.checksByPaymentId.get(normalizeId(payment.id || payment._docId))
        || ACCOUNTING_STATE.checksByInvoiceId.get(invoiceKey)
        || {};
    const paymentType = normalizePaymentType(payment.payment_type, check);
    const invoiceAmount = Number(invoice.invoiceAmount || payment.invoice_amt || payment.amount || 0);

    return {
        id: firstValue(payment.id, payment._docId),
        invoiceNo: firstValue(payment.invoice_num, payment.invoice_no, payment.invoice_id, invoice.invoiceNo),
        client: firstValue(invoice.client, payment.client, payment.company),
        category: firstValue(invoice.category, payment.category),
        invoiceAmount,
        invoiceDate: toDateKey(normalizeDate(invoice.invoiceDate)) || '',
        printedOr: firstValue(payment.ornum, payment.or_number, payment.printed_or),
        assigned: firstValue(payment.assigned, payment.assigned_to, invoice.assigned),
        datePaid: toDateKey(normalizeDate(firstValue(payment.date_paid, payment.tax_date_paid, payment.date_deposit))) || '',
        dateDeposit: toDateKey(normalizeDate(firstValue(payment.date_deposit, payment.date_paid))) || '',
        paidAmount,
        paymentType,
        status: buildPaymentStatus(payment),
        balance: Number(payment.balance_amt || 0),
        ewt,
        checkNumber: firstValue(check.check_number, payment.check_number),
        checkAmount: Number(check.check_amt || check.check_amount || (paymentType === 'CHECK' ? paidAmount : 0) || 0),
        checkDate: toDateKey(normalizeDate(firstValue(check.check_date, payment.check_date))) || '',
        accountBank: firstValue(check.bank, check.account_bank, check.bank_name, payment.bank),
        sortDate: normalizeDate(firstValue(payment.date_deposit, payment.date_paid, payment.tax_date_paid))
    };
}

function buildInvoiceLookupRow(row) {
    const contract = ACCOUNTING_STATE.contracts.get(normalizeId(row.contractmain_id)) || {};
    const contractDep = ACCOUNTING_STATE.contractDeps.get(normalizeId(contract.contract_id)) || {};
    const branch = ACCOUNTING_STATE.branches.get(normalizeId(contractDep.branch_id || contract.contract_id)) || {};
    const company = ACCOUNTING_STATE.companies.get(normalizeId(branch.company_id)) || {};
    const companyName = firstValue(company.companyname, company.company_name, row.company, row.client, 'Unknown');
    const branchName = firstValue(branch.branchname, branch.branch_name);

    return {
        id: firstValue(row.id, row._docId),
        invoiceId: firstValue(row.invoice_id, row.invoiceid),
        invoiceNo: firstValue(row.invoiceno, row.invoice_no, row.invoice_id, row.id),
        client: branchName && !normalizeSearch(branchName).includes(normalizeSearch(companyName))
            ? `${companyName} - ${branchName}`
            : companyName,
        category: firstValue(contract.category_id, row.category, row.ctgry),
        invoiceAmount: Number(row.totalamount || row.amount || 0),
        invoiceDate: firstValue(row.dateprinted, row.date_printed, row.invdate, row.invoice_date, row.datex, row.due_date),
        assigned: firstValue(row.assigned, row.assigned_to)
    };
}

async function fetchCollectionRows(collection, pageSize = 1000, maxPages = 100, fieldMask = null) {
    const rows = [];
    let pageToken = '';
    let page = 0;
    do {
        page += 1;
        const params = new URLSearchParams({ pageSize: String(pageSize), key: FIREBASE_CONFIG.apiKey });
        if (pageToken) params.set('pageToken', pageToken);
        if (Array.isArray(fieldMask)) {
            fieldMask.forEach((fieldPath) => params.append('mask.fieldPaths', fieldPath));
        }
        const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}?${params.toString()}`);
        if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
        const payload = await response.json();
        rows.push(...(payload.documents || []).map((doc) => MargaUtils.parseFirestoreDoc(doc)).filter(Boolean));
        pageToken = payload.nextPageToken || '';
    } while (pageToken && page < maxPages);
    return rows;
}

function renderAccountingGrid() {
    const columns = ACCOUNTING_STATE.activeTab === 'pettycash' ? PETTY_CASH_COLUMNS : COLLECTION_COLUMNS;
    const rows = getFilteredRows();
    document.getElementById('gridTitle').textContent = ACCOUNTING_STATE.activeTab === 'pettycash'
        ? 'Petty Cash VAT Extract'
        : 'Collections Paid Register';
    document.getElementById('gridSubtitle').textContent = ACCOUNTING_STATE.activeTab === 'pettycash'
        ? 'Supplier/store rows from saved petty cash vouchers.'
        : 'Paid Collections payment rows visible to Accounting after payment save.';

    document.getElementById('accountingGridHead').innerHTML = `<tr>${columns.map((column) => `
        <th class="${column.numeric ? 'numeric' : ''}">${escapeHtml(column.label)}</th>
    `).join('')}</tr>`;

    if (!rows.length) {
        document.getElementById('accountingGridBody').innerHTML = `<tr><td colspan="${columns.length}"><div class="empty-row">No rows matched the selected filters.</div></td></tr>`;
    } else {
        document.getElementById('accountingGridBody').innerHTML = rows.map((row) => `
            <tr>${columns.map((column) => `
                <td class="${column.numeric ? 'numeric' : ''}">${escapeHtml(formatCell(row[column.key], column))}</td>
            `).join('')}</tr>
        `).join('');
    }

    const totalKey = ACCOUNTING_STATE.activeTab === 'pettycash' ? 'totalAmount' : 'paidAmount';
    const taxKey = ACCOUNTING_STATE.activeTab === 'pettycash' ? 'vat' : 'ewt';
    document.getElementById('summaryRows').textContent = rows.length.toLocaleString();
    document.getElementById('summaryTotal').textContent = formatCurrency(sumBy(rows, totalKey));
    document.getElementById('summaryTax').textContent = formatCurrency(sumBy(rows, taxKey));
    setGridStatus(`${rows.length.toLocaleString()} row(s) ready.`);
}

function getFilteredRows() {
    const sourceRows = ACCOUNTING_STATE.activeTab === 'pettycash'
        ? ACCOUNTING_STATE.pettyCashRows
        : ACCOUNTING_STATE.collectionRows;
    const fromDate = normalizeDate(document.getElementById('fromDateInput').value);
    const toDate = normalizeDate(document.getElementById('toDateInput').value);
    if (toDate) toDate.setHours(23, 59, 59, 999);
    const search = normalizeSearch(document.getElementById('accountingSearchInput').value);

    return sourceRows
        .filter((row) => {
            const rowDate = row.sortDate || normalizeDate(row.datePaid || row.date);
            if (fromDate && rowDate && rowDate < fromDate) return false;
            if (toDate && rowDate && rowDate > toDate) return false;
            if (!search) return true;
            return normalizeSearch(Object.values(row).join(' ')).includes(search);
        })
        .sort((left, right) => {
            const leftTime = (left.sortDate || new Date(0)).getTime();
            const rightTime = (right.sortDate || new Date(0)).getTime();
            if (rightTime !== leftTime) return rightTime - leftTime;
            return String(left.company || left.client || '').localeCompare(String(right.company || right.client || ''));
        });
}

function exportActiveGrid() {
    const columns = ACCOUNTING_STATE.activeTab === 'pettycash' ? PETTY_CASH_COLUMNS : COLLECTION_COLUMNS;
    const rows = getFilteredRows();
    if (!rows.length) {
        MargaUtils.showToast('No accounting rows to export.', 'error');
        return;
    }
    const csvRows = [columns.map((column) => column.label)];
    rows.forEach((row) => {
        csvRows.push(columns.map((column) => formatCell(row[column.key], column)));
    });
    const csv = csvRows.map((row) => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `accounting-${ACCOUNTING_STATE.activeTab}-${toDateKey(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function normalizePaymentType(value, check) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (check && Object.keys(check).length) return 'CHECK';
    if (raw === '1' || raw.includes('check')) return 'CHECK';
    if (raw === '0' || raw.includes('cash')) return 'CASH';
    return raw ? raw.toUpperCase() : 'CASH';
}

function buildPaymentStatus(payment) {
    const taxStatus = String(payment.tax_form_status || '').trim();
    if (taxStatus) return `2307 ${taxStatus}`;
    return Number(payment.balance_amt || 0) <= 0.01 ? 'Paid' : 'Partial';
}

function formatCell(value, column) {
    if (column.numeric) return Number(value || 0).toFixed(2);
    return value ?? '';
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function setGridStatus(message) {
    document.getElementById('gridStatus').textContent = message;
}

function firstValue(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }
    return '';
}

function normalizeId(value) {
    return String(value ?? '').trim();
}

function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slash) return new Date(`${slash[3]}-${String(slash[1]).padStart(2, '0')}-${String(slash[2]).padStart(2, '0')}T00:00:00`);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(date) {
    const value = normalizeDate(date);
    if (!value) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function buildAddressText(parts) {
    const seen = new Set();
    return (parts || [])
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .filter((part) => {
            const key = part.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .join(', ');
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function sumBy(rows, key) {
    return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function formatCurrency(value) {
    return '₱' + Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}
