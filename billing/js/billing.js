const els = {
    endMonthInput: null,
    rowLimitInput: null,
    billingPagesInput: null,
    schedulePagesInput: null,
    apiKeyInput: null,
    refreshCacheInput: null,
    runBtn: null,
    copyCurlBtn: null,
    statusPill: null,
    selectionCard: null,
    selectionCopy: null,
    clearSelectionBtn: null,
    summarySubhead: null,
    sheetMeta: null,
    summaryTableWrap: null,
    matrixTableWrap: null,
    matrixSearchInput: null,
    matrixSortInput: null,
    matrixSearchMeta: null,
    rawJson: null,
    invoiceDetailModal: null,
    invoiceDetailTitle: null,
    invoiceDetailSubtitle: null,
    invoiceDetailContent: null,
    invoiceDetailCloseBtn: null,
    serialDetailModal: null,
    serialDetailTitle: null,
    serialDetailSubtitle: null,
    serialDetailContent: null,
    serialDetailCloseBtn: null,
    billingCalcModal: null,
    billingCalcTitle: null,
    billingCalcSubtitle: null,
    billingCalcContent: null,
    billingCalcCloseBtn: null
};

let lastPayload = null;
let renderedMatrixRows = [];
let searchReloadTimer = null;
const MATRIX_SORT_STORAGE_KEY = 'marga_billing_matrix_sort';
const CONTRACT_CATEGORY_META = {
    1: { code: 'RTP', label: 'Rental Per Page' },
    2: { code: 'RTF', label: 'Rental Fixed Rate' },
    3: { code: 'STP', label: 'Straight Per Page' },
    4: { code: 'MAT', label: 'Materials' },
    5: { code: 'RTC', label: 'Rental Toner Covered' },
    6: { code: 'STC', label: 'Straight Toner Covered' },
    7: { code: 'MAC', label: 'Machine Account' },
    8: { code: 'MAP', label: 'Metered Account Plan' },
    9: { code: 'REF', label: 'Refill' },
    10: { code: 'RD', label: 'Reading Only' }
};

function getMatrixSearchTerm() {
    return String(els.matrixSearchInput?.value || '').trim().toLowerCase();
}

function getMatrixSortValue() {
    return String(els.matrixSortInput?.value || 'rd').trim().toLowerCase();
}

function restoreMatrixSortValue() {
    if (!els.matrixSortInput) return;
    const saved = String(localStorage.getItem(MATRIX_SORT_STORAGE_KEY) || '').trim().toLowerCase();
    if (!saved) return;
    const hasOption = Array.from(els.matrixSortInput.options || []).some((option) => option.value === saved);
    if (hasOption) els.matrixSortInput.value = saved;
}

function cacheElements() {
    Object.keys(els).forEach((key) => {
        els[key] = document.getElementById(key);
    });
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-PH');
}

function formatAmount(value) {
    const amount = Number(value || 0);
    const hasCents = Math.abs(amount % 1) > 0.0001;
    return amount.toLocaleString('en-PH', {
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2
    });
}

function formatMetricCount(value, singular, plural = `${singular}s`) {
    const count = Number(value || 0);
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function getContractCategoryMeta(categoryId) {
    const normalized = Number(categoryId || 0) || 0;
    return CONTRACT_CATEGORY_META[normalized] || {
        code: normalized ? `CAT ${normalized}` : 'N/A',
        label: normalized ? 'Unclassified Contract' : 'Unclassified Contract'
    };
}

function getRowBillingProfile(row) {
    const profile = row?.billing_profile || null;
    if (profile) {
        const categoryMeta = getContractCategoryMeta(profile.category_id);
        return {
            ...profile,
            category_code: profile.category_code || categoryMeta.code,
            category_label: profile.category_label || categoryMeta.label
        };
    }

    const fallbackGroup = Object.values(row?.months || {})
        .flatMap((cell) => Array.isArray(cell?.reading_groups) ? cell.reading_groups : [])
        .sort((left, right) => String(right.task_date || '').localeCompare(String(left.task_date || '')))[0];
    if (!fallbackGroup) return null;

    const categoryMeta = getContractCategoryMeta(fallbackGroup.category_id);
    return {
        category_id: Number(fallbackGroup.category_id || 0) || 0,
        category_code: categoryMeta.code,
        category_label: categoryMeta.label,
        pricing_mode: Number(fallbackGroup.page_rate || 0) > 0 ? 'reading' : (Number(fallbackGroup.monthly_rate || 0) > 0 ? 'fixed' : 'other'),
        page_rate: Number(fallbackGroup.page_rate || 0) || 0,
        monthly_quota: Number(fallbackGroup.monthly_quota || 0) || 0,
        monthly_rate: Number(fallbackGroup.monthly_rate || 0) || 0,
        with_vat: Boolean(fallbackGroup.with_vat)
    };
}

function isReadingPricing(profile) {
    return String(profile?.pricing_mode || '').toLowerCase() === 'reading';
}

function formatMonthLabel(monthKey, fallback = '') {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return fallback || String(monthKey || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleString('en-PH', { month: 'short', year: '2-digit' });
}

function parseMonthInput(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2])
    };
}

function monthInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function setStatus(text, type = 'idle') {
    if (!els.statusPill) return;
    els.statusPill.textContent = text;
    els.statusPill.classList.remove('loading', 'error');
    if (type === 'loading') els.statusPill.classList.add('loading');
    if (type === 'error') els.statusPill.classList.add('error');
}

function initDefaults() {
    els.endMonthInput.value = monthInputValue(new Date());
}

function compareBillingRows(left, right, sortValue) {
    const leftAmountCount = Object.values(left?.months || {}).reduce((sum, cell) => sum + (Number(cell?.display_amount_total || 0) > 0 ? 1 : 0), 0);
    const rightAmountCount = Object.values(right?.months || {}).reduce((sum, cell) => sum + (Number(cell?.display_amount_total || 0) > 0 ? 1 : 0), 0);
    const leftLatestAmount = Object.values(left?.months || {}).reduce((max, cell) => Math.max(max, Number(cell?.display_amount_total || 0)), 0);
    const rightLatestAmount = Object.values(right?.months || {}).reduce((max, cell) => Math.max(max, Number(cell?.display_amount_total || 0)), 0);
    const leftRd = Number(left.reading_day || 0) || Number.MAX_SAFE_INTEGER;
    const rightRd = Number(right.reading_day || 0) || Number.MAX_SAFE_INTEGER;
    const leftCustomer = String(left.company_name || left.account_name || '').toLowerCase();
    const rightCustomer = String(right.company_name || right.account_name || '').toLowerCase();
    const leftBranch = String(left.branch_name || '').toLowerCase();
    const rightBranch = String(right.branch_name || '').toLowerCase();
    const leftSerial = String(left.serial_number || left.machine_label || '').toLowerCase();
    const rightSerial = String(right.serial_number || right.machine_label || '').toLowerCase();

    if (sortValue === 'customer') {
        return leftCustomer.localeCompare(rightCustomer)
            || leftBranch.localeCompare(rightBranch)
            || leftRd - rightRd
            || (rightAmountCount - leftAmountCount)
            || (rightLatestAmount - leftLatestAmount)
            || leftSerial.localeCompare(rightSerial);
    }

    return leftRd - rightRd
        || leftCustomer.localeCompare(rightCustomer)
        || leftBranch.localeCompare(rightBranch)
        || (rightAmountCount - leftAmountCount)
        || (rightLatestAmount - leftLatestAmount)
        || leftSerial.localeCompare(rightSerial);
}

function applyUserContext() {
    if (!MargaAuth.requireAccess('billing')) return false;

    const user = MargaAuth.getUser();
    if (user) {
        const avatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        if (avatar) avatar.textContent = (user.name || user.username || 'U').charAt(0).toUpperCase();
        if (userName) userName.textContent = user.name || user.username || 'User';
        if (userRole) userRole.textContent = MargaAuth.getDisplayRoles(user);
    }

    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    return true;
}

function buildRequestContext() {
    const end = parseMonthInput(els.endMonthInput.value);
    if (!end) throw new Error('Please set the last month.');

    const params = new URLSearchParams();
    params.set('end_year', String(end.year));
    params.set('end_month', String(end.month));
    params.set('months_back', '6');
    params.set('row_limit', String(Math.max(1, Math.min(1200, Number(els.rowLimitInput.value || 1000)))));
    params.set('latest_limit', '100');
    params.set('max_billing_pages', String(Math.max(10, Number(els.billingPagesInput.value || 10))));
    params.set('max_schedule_pages', String(Math.max(10, Number(els.schedulePagesInput.value || 10))));
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    params.set('refresh_cache', String(Boolean(els.refreshCacheInput.checked)));
    const search = String(els.matrixSearchInput?.value || '').trim();
    if (search.length >= 2) {
        params.set('search', search);
        params.set('include_machine_history', 'true');
    }

    const apiKey = String(els.apiKeyInput.value || '').trim();
    if (apiKey) localStorage.setItem('openclaw_api_key', apiKey);

    return {
        url: `/.netlify/functions/openclaw-billing-cohort?${params.toString()}`,
        apiKey
    };
}

function receiptLabel(status) {
    if (status === 'received') return 'Received';
    if (status === 'partial') return 'Partial';
    if (status === 'not_confirmed') return 'Not Confirmed';
    return 'Not Billed';
}

function receiptDot(status) {
    const label = receiptLabel(status);
    const className = status === 'received' ? 'received' : status === 'partial' ? 'partial' : 'not-confirmed';
    return `<span class="receipt-dot ${className}" title="${escapeHtml(label)}"></span>`;
}

function pendingHref(companyId, monthKey) {
    const url = new URL(MargaAuth.buildAppUrl('billing/index.html'), window.location.origin);
    url.searchParams.set('row_id', companyId);
    url.searchParams.set('month', monthKey);
    url.searchParams.set('action', 'create');
    return `${url.pathname}${url.search}`;
}

function updatePendingSelection(rowId, monthKey) {
    const url = new URL(window.location.href);
    url.searchParams.set('row_id', String(rowId));
    url.searchParams.set('month', String(monthKey));
    url.searchParams.set('action', 'create');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    if (lastPayload) {
        renderSelectionCard(lastPayload);
        renderMatrixTable(lastPayload);
    }
}

function clearPendingSelection() {
    const url = new URL(window.location.href);
    url.searchParams.delete('row_id');
    url.searchParams.delete('month');
    url.searchParams.delete('action');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    if (lastPayload) {
        renderSelectionCard(lastPayload);
        renderMatrixTable(lastPayload);
    }
}

function customerHref(row) {
    const url = new URL(MargaAuth.buildAppUrl('customers.html'), window.location.origin);
    if (row?.company_id) url.searchParams.set('company_id', String(row.company_id));
    if (row?.branch_id) url.searchParams.set('branch_id', String(row.branch_id));
    if (row?.machine_id) url.searchParams.set('machine_id', String(row.machine_id));
    if (row?.contractmain_id) url.searchParams.set('contractmain_id', String(row.contractmain_id));
    url.searchParams.set('tab', 'machines');
    return `${url.pathname}${url.search}`;
}

function renderSelectionCard(payload) {
    const selectedRowId = MargaUtils.getUrlParam('row_id');
    const selectedMonth = MargaUtils.getUrlParam('month');
    const selectedAction = MargaUtils.getUrlParam('action');

    if (!selectedRowId || !selectedMonth || selectedAction !== 'create') {
        els.selectionCard.classList.add('hidden');
        els.selectionCopy.textContent = 'No cell selected.';
        return;
    }

    const row = (payload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(selectedRowId));
    const readingDay = row?.reading_day ? `Reading day ${row.reading_day}` : 'Reading day not available';
    const message = row
        ? `${row.display_name || row.account_name || row.company_name} is selected for ${selectedMonth}. ${readingDay}. This came from a pending billing cell.`
        : `Pending billing context selected for account ${selectedRowId} in ${selectedMonth}.`;

    els.selectionCopy.textContent = message;
    els.selectionCard.classList.remove('hidden');
}

function renderSummaryTable(payload) {
    const rows = payload.billing_last_6_months || [];
    const current = rows[rows.length - 1] || null;
    const endLabel = payload.period?.end_month_label || '-';

    els.summarySubhead.textContent = current
        ? `${formatCount(current.to_bill_customers_total)} customers should be billed by ${endLabel}, ${formatCount(current.pending_customers_total)} are still pending.`
        : 'No monthly summary returned.';
    els.sheetMeta.textContent = payload.meta?.reading_day_source || '6-month billing carryover view';

    if (!rows.length) {
        els.summaryTableWrap.innerHTML = '<div class="empty-panel">No monthly summary returned.</div>';
        return;
    }

    const body = rows.slice().reverse().map((row) => `
        <tr>
            <td>${escapeHtml(row.month_label_short)}</td>
            <td>${formatCount(row.additional_customers_total)}</td>
            <td>${formatCount(row.inactive_customers_total)}</td>
            <td>${formatCount(row.balance_customers_total)}</td>
            <td>${formatCount(row.to_bill_customers_total)}</td>
            <td>${formatCount(row.billed_customers_total)}</td>
            <td class="pending-count">${formatCount(row.pending_customers_total)}</td>
        </tr>
    `).join('');

    els.summaryTableWrap.innerHTML = `
        <table class="billing-sheet summary-sheet">
            <thead>
                <tr>
                    <th>Month</th>
                    <th>Additional</th>
                    <th>Inactive</th>
                    <th>Balance</th>
                    <th>To Bill</th>
                    <th>Billed</th>
                    <th>Pending</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function summarizeReceiptStatus(cells) {
    const billedCells = cells.filter((cell) => cell && cell.billed);
    if (!billedCells.length) return 'not_billed';
    if (billedCells.every((cell) => cell.receipt_status === 'received')) return 'received';
    if (billedCells.some((cell) => cell.receipt_status === 'received' || cell.receipt_status === 'partial')) return 'partial';
    return 'not_confirmed';
}

function mergeInvoiceGroups(groups) {
    const merged = new Map();
    groups.forEach((group) => {
        const key = String(group?.invoice_ref || group?.invoice_no || group?.invoice_id || '').trim();
        if (!key) return;
        if (!merged.has(key)) {
            merged.set(key, {
                invoice_ref: key,
                invoice_no: group.invoice_no || group.invoice_ref || group.invoice_id || key,
                invoice_id: group.invoice_id || group.invoice_no || key,
                amount_total: 0,
                billing_line_count: 0,
                machine_ids: new Set(),
                contractmain_ids: new Set()
            });
        }
        const target = merged.get(key);
        target.amount_total += Number(group.amount_total || 0);
        target.billing_line_count += Number(group.billing_line_count || 0);
        (group.machine_ids || []).forEach((machineId) => {
            if (String(machineId || '').trim()) target.machine_ids.add(String(machineId).trim());
        });
        (group.contractmain_ids || []).forEach((contractId) => {
            if (String(contractId || '').trim()) target.contractmain_ids.add(String(contractId).trim());
        });
    });
    return Array.from(merged.values())
        .map((group) => ({
            invoice_ref: group.invoice_ref,
            invoice_no: group.invoice_no,
            invoice_id: group.invoice_id,
            amount_total: Number(group.amount_total.toFixed(2)),
            billing_line_count: group.billing_line_count,
            machine_count: group.machine_ids.size,
            contract_count: group.contractmain_ids.size,
            machine_ids: Array.from(group.machine_ids).sort((a, b) => a.localeCompare(b)),
            contractmain_ids: Array.from(group.contractmain_ids).sort((a, b) => a.localeCompare(b))
        }))
        .sort((a, b) => {
            if (b.amount_total !== a.amount_total) return b.amount_total - a.amount_total;
            return String(a.invoice_no || a.invoice_ref).localeCompare(String(b.invoice_no || b.invoice_ref));
        });
}

function mergeReadingGroups(groups) {
    return [...groups]
        .map((group) => ({
            schedule_id: group.schedule_id,
            invoice_num: group.invoice_num,
            task_date: group.task_date,
            machine_id: group.machine_id,
            contractmain_id: group.contractmain_id,
            previous_meter: Number(group.previous_meter || 0),
            present_meter: Number(group.present_meter || 0),
            total_consumed: Number(group.total_consumed || 0),
            pages: Number(group.pages || 0),
            page_rate: Number(group.page_rate || 0),
            monthly_quota: Number(group.monthly_quota || 0),
            monthly_rate: Number(group.monthly_rate || 0),
            amount_total: Number(group.amount_total || 0),
            net_amount: Number(group.net_amount || 0),
            vat_amount: Number(group.vat_amount || 0),
            with_vat: Boolean(group.with_vat),
            category_id: Number(group.category_id || 0),
            formula: group.formula || 'net_pages_times_page_rate'
        }))
        .sort((a, b) => {
            if (b.amount_total !== a.amount_total) return b.amount_total - a.amount_total;
            return String(a.task_date || '').localeCompare(String(b.task_date || ''));
        });
}

function buildCompanySummaryRows(rows, months) {
    const groups = new Map();
    rows.forEach((row) => {
        const key = String(row.company_id || row.company_name || row.account_name || row.row_id || '').trim();
        if (!key) return;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                company_id: row.company_id || null,
                company_name: row.company_name || row.account_name || 'Unknown',
                rows: []
            });
        }
        groups.get(key).rows.push(row);
    });

    const inserted = new Set();
    const displayRows = [];
    rows.forEach((row) => {
        const key = String(row.company_id || row.company_name || row.account_name || row.row_id || '').trim();
        const group = groups.get(key);
        const qualifies = group && group.rows.length > 1;

        if (qualifies && !inserted.has(key)) {
            inserted.add(key);
            const summaryMonths = {};
            months.forEach((monthKey) => {
                const childCells = group.rows.map((child) => child.months?.[monthKey] || {});
                const billedCells = childCells.filter((cell) => cell.billed);
                const pendingCount = childCells.filter((cell) => cell.pending).length;
                const mergedGroups = mergeInvoiceGroups(
                    childCells.flatMap((cell) => (Array.isArray(cell.invoice_groups) ? cell.invoice_groups : []))
                );
                const mergedReadingGroups = mergeReadingGroups(
                    childCells.flatMap((cell) => (Array.isArray(cell.reading_groups) ? cell.reading_groups : []))
                );
                const amountTotal = billedCells.reduce((sum, cell) => sum + Number(cell.amount_total || 0), 0);
                const readingAmountTotal = childCells.reduce((sum, cell) => sum + Number(cell.reading_amount_total || 0), 0);
                const displayAmountTotal = amountTotal > 0 ? amountTotal : readingAmountTotal;
                const readingPagesTotal = childCells.reduce((sum, cell) => sum + Number(cell.reading_pages_total || 0), 0);
                const readingTaskCount = childCells.reduce((sum, cell) => sum + Number(cell.reading_task_count || 0), 0);
                const billingLineCount = billedCells.reduce((sum, cell) => sum + Number(cell.billing_line_count || 0), 0);
                const invoiceCount = mergedGroups.length;
                const machineIds = new Set();
                mergedGroups.forEach((groupInvoice) => {
                    (groupInvoice.machine_ids || []).forEach((machineId) => machineIds.add(String(machineId)));
                });
                childCells.forEach((cell, index) => {
                    const machineId = String(group.rows[index]?.machine_id || '').trim();
                    if ((cell.billed || Number(cell.display_amount_total || cell.reading_amount_total || 0) > 0) && machineId) {
                        machineIds.add(machineId);
                    }
                });
                summaryMonths[monthKey] = {
                    month_key: monthKey,
                    month_label: childCells[0]?.month_label || monthKey,
                    month_label_short: childCells[0]?.month_label_short || monthKey,
                    billed: billedCells.length > 0,
                    pending: billedCells.length === 0 && pendingCount > 0,
                    skipped: billedCells.length === 0 && pendingCount > 0,
                    invoice_count: invoiceCount,
                    billing_line_count: billingLineCount,
                    machine_count: machineIds.size || billedCells.length,
                    amount_total: Number(amountTotal.toFixed(2)),
                    display_amount_total: Number(displayAmountTotal.toFixed(2)),
                    reading_amount_total: Number(readingAmountTotal.toFixed(2)),
                    reading_pages_total: readingPagesTotal,
                    reading_task_count: readingTaskCount,
                    billing_task_count: childCells.reduce((sum, cell) => sum + Number(cell.billing_task_count || 0), 0),
                    received_task_count: childCells.reduce((sum, cell) => sum + Number(cell.received_task_count || 0), 0),
                    receipt_status: summarizeReceiptStatus(childCells),
                    billed_basis: amountTotal > 0 && readingAmountTotal > 0
                        ? 'invoice_and_meter'
                        : (amountTotal > 0 ? 'invoice' : (readingAmountTotal > 0 ? 'meter_reading' : 'none')),
                    latest_invoice_date: childCells
                        .map((cell) => cell.latest_invoice_date)
                        .filter(Boolean)
                        .sort()
                        .slice(-1)[0] || null,
                    received_by_names: Array.from(new Set(childCells.flatMap((cell) => cell.received_by_names || []))).sort((a, b) => a.localeCompare(b)),
                    invoice_groups: mergedGroups,
                    reading_groups: mergedReadingGroups,
                    pending_count: pendingCount
                };
            });

            displayRows.push({
                row_id: `summary:${key}`,
                is_summary_row: true,
                company_id: group.company_id,
                company_name: group.company_name,
                account_name: group.company_name,
                branch_name: 'All branches / departments',
                serial_number: '',
                machine_id: '',
                contractmain_id: '',
                machine_label: `${formatCount(group.rows.length)} machine row${group.rows.length === 1 ? '' : 's'}`,
                display_name: `${group.company_name} • company subtotal`,
                reading_day: null,
                months: summaryMonths
            });
        }

        if (qualifies) {
            displayRows.push({ ...row, is_detail_row: true });
            return;
        }
        displayRows.push(row);
    });

    return displayRows;
}

function renderBranchMain(row) {
    if (row.is_summary_row) return escapeHtml(row.branch_name || 'Main');
    const profile = getRowBillingProfile(row);
    const badge = profile?.category_code
        ? `<span class="billing-code-badge" title="${escapeHtml(profile.category_label || profile.category_code)}">${escapeHtml(profile.category_code)}</span>`
        : '';
    return `
        <span class="branch-head">
            <span>${escapeHtml(row.branch_name || 'Main')}</span>
            ${badge}
        </span>
    `;
}

function renderBranchSub(row) {
    if (row.is_summary_row) return 'Search subtotal across loaded machine rows';
    const profile = getRowBillingProfile(row);
    if (profile?.category_label) {
        return `${profile.category_label} • ${row.account_name || row.company_name || ''}`;
    }
    return row.account_name || row.company_name || '';
}

function collectPriorReadingGroups(row, monthKey) {
    return Object.entries(row?.months || {})
        .filter(([key]) => key < monthKey)
        .flatMap(([key, cell]) => (
            Array.isArray(cell?.reading_groups)
                ? cell.reading_groups.map((group) => ({
                    ...group,
                    month_key: key,
                    month_label: cell.month_label_short || formatMonthLabel(key, key)
                }))
                : []
        ))
        .sort((left, right) => {
            const leftDate = String(left.task_date || left.month_key || '');
            const rightDate = String(right.task_date || right.month_key || '');
            return rightDate.localeCompare(leftDate);
        });
}

function buildBillingCalculationContext(row, monthKey) {
    if (!row || row.is_summary_row) return null;
    const profile = getRowBillingProfile(row);
    if (!profile) return null;

    const targetCell = row.months?.[monthKey] || {};
    const latestPriorGroup = collectPriorReadingGroups(row, monthKey)[0] || null;
    const previousMeter = latestPriorGroup
        ? Number(latestPriorGroup.present_meter || latestPriorGroup.previous_meter || 0) || 0
        : 0;

    return {
        row,
        monthKey,
        monthLabel: targetCell.month_label_short || formatMonthLabel(monthKey, monthKey),
        profile,
        latestPriorGroup,
        previousMeter,
        presentMeter: previousMeter,
        isReading: isReadingPricing(profile),
        isFixed: !isReadingPricing(profile) && Number(profile.monthly_rate || 0) > 0
    };
}

function calculateBillingEstimate(context, previousMeterValue, presentMeterValue) {
    const profile = context?.profile || {};
    const previousMeter = Math.max(0, Number(previousMeterValue || 0) || 0);
    const presentMeter = Math.max(0, Number(presentMeterValue || 0) || 0);
    const pageRate = Number(profile.page_rate || 0) || 0;
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const monthlyRate = Number(profile.monthly_rate || 0) || 0;
    const withVat = Boolean(profile.with_vat);
    let pages = 0;
    let amountDue = 0;
    let formula = 'not_available';
    let warning = '';

    if (context?.isReading) {
        if (presentMeter < previousMeter) {
            warning = 'Present meter cannot be lower than the previous meter.';
        } else {
            pages = presentMeter - previousMeter;
            if (pages > 0 && pageRate > 0) {
                amountDue = pages * pageRate;
                formula = 'pages_x_rate';
            } else if (monthlyRate > 0) {
                amountDue = monthlyRate;
                formula = 'monthly_rate_fallback';
            } else {
                formula = 'missing_rate';
            }
        }
    } else if (context?.isFixed) {
        amountDue = monthlyRate;
        formula = 'fixed_monthly_rate';
    }

    amountDue = Number(amountDue.toFixed(2));
    const netAmount = withVat ? Number((amountDue / 1.12).toFixed(2)) : amountDue;
    const vatAmount = withVat ? Number((amountDue - netAmount).toFixed(2)) : Number((amountDue * 0.12).toFixed(2));

    return {
        previousMeter,
        presentMeter,
        pages,
        amountDue,
        netAmount,
        vatAmount,
        quotaVariance: monthlyQuota > 0 ? pages - monthlyQuota : null,
        formula,
        warning
    };
}

function closeBillingCalcModal() {
    els.billingCalcModal?.classList.add('hidden');
}

function openBillingCalcModal(rowId, monthKey) {
    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload?.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    const context = buildBillingCalculationContext(row, monthKey);
    if (!context) {
        MargaUtils.showToast('No billing profile is available for this row yet.', 'error');
        return;
    }

    const profile = context.profile;
    const latest = context.latestPriorGroup;
    const estimate = calculateBillingEstimate(context, context.previousMeter, context.presentMeter);

    els.billingCalcTitle.textContent = `${row.display_name || row.account_name || row.company_name || 'Billing Calculation'}`;
    els.billingCalcSubtitle.textContent = `${context.monthLabel} • ${profile.category_code || 'N/A'} • ${profile.category_label || 'Billing profile'}`;

    els.billingCalcContent.innerHTML = `
        <div class="calc-layout">
            <div class="calc-flag-row">
                <span class="calc-flag">${escapeHtml(profile.category_code || 'N/A')} • ${escapeHtml(profile.category_label || 'Unclassified Contract')}</span>
                <span class="calc-flag">${escapeHtml(context.isReading ? 'Meter-Based Billing' : (context.isFixed ? 'Fixed Monthly Billing' : 'Reference Only'))}</span>
                <span class="calc-flag">${escapeHtml(profile.with_vat ? 'VAT Inclusive' : 'VAT Exclusive')}</span>
                ${latest ? `<span class="calc-flag">Latest meter context: ${escapeHtml(latest.month_label || latest.month_key || 'Previous month')}</span>` : ''}
            </div>
            <div class="calc-note">
                ${
                    context.isReading
                        ? `This estimate follows the current dashboard formula: pages x page rate, with monthly rate fallback when page rate is not available. Quota is shown as contract reference.`
                        : `This contract is currently treated as a fixed monthly bill. The estimate below uses the saved monthly rate for ${escapeHtml(context.monthLabel)}.`
                }
            </div>
            <div class="detail-summary-grid">
                <article class="detail-summary-card">
                    <span class="label">Page Rate</span>
                    <span class="value">${escapeHtml(formatAmount(profile.page_rate || 0))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Monthly Quota</span>
                    <span class="value">${escapeHtml(formatCount(profile.monthly_quota || 0))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Monthly Rate</span>
                    <span class="value">${escapeHtml(formatAmount(profile.monthly_rate || 0))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Latest Meter</span>
                    <span class="value">${escapeHtml(latest ? formatCount(latest.present_meter || latest.previous_meter || 0) : 'Not found')}</span>
                </article>
            </div>
            ${
                context.isReading
                    ? `
                        <div class="calc-form-grid">
                            <div class="calc-field">
                                <label for="calcPreviousMeterInput">Previous Meter</label>
                                <input type="number" id="calcPreviousMeterInput" min="0" step="1" value="${escapeHtml(String(context.previousMeter || 0))}">
                            </div>
                            <div class="calc-field">
                                <label for="calcPresentMeterInput">Present Meter</label>
                                <input type="number" id="calcPresentMeterInput" min="0" step="1" value="${escapeHtml(String(context.presentMeter || 0))}">
                            </div>
                            <div class="calc-field">
                                <label>Latest Month Used</label>
                                <input type="text" readonly value="${escapeHtml(latest ? (latest.month_label || latest.month_key || 'Previous month') : 'No prior reading in current window')}">
                            </div>
                        </div>
                    `
                    : ''
            }
            <div class="calc-inline-grid">
                <article class="calc-total-card">
                    <span class="label">Estimated Amount</span>
                    <span class="value" id="calcAmountValue">${escapeHtml(formatAmount(estimate.amountDue))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Net Pages</span>
                    <span class="value" id="calcPagesValue">${escapeHtml(formatCount(estimate.pages || 0))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">Net Amount</span>
                    <span class="value" id="calcNetValue">${escapeHtml(formatAmount(estimate.netAmount || 0))}</span>
                </article>
                <article class="detail-summary-card">
                    <span class="label">VAT Amount</span>
                    <span class="value" id="calcVatValue">${escapeHtml(formatAmount(estimate.vatAmount || 0))}</span>
                </article>
            </div>
            <div class="invoice-detail-card">
                <div class="invoice-detail-head">
                    <div class="invoice-detail-ref">Computation Detail</div>
                    <div class="invoice-detail-amount" id="calcFormulaValue">${escapeHtml(estimate.formula)}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Previous Meter Context</span>
                    <div class="detail-list-value" id="calcContextValue">
                        ${
                            latest
                                ? escapeHtml(`Previous ${formatCount(latest.previous_meter || 0)} • Present ${formatCount(latest.present_meter || 0)} • ${formatCount(latest.pages || latest.total_consumed || 0)} pages`)
                                : 'No previous meter reading was found in the current 6-month window.'
                        }
                    </div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Quota Reference</span>
                    <div class="detail-list-value" id="calcQuotaValue">${escapeHtml(
                        estimate.quotaVariance === null
                            ? 'No quota saved on this contract.'
                            : `${formatCount(profile.monthly_quota || 0)} quota • ${estimate.quotaVariance >= 0 ? '+' : ''}${formatCount(estimate.quotaVariance)} vs usage`
                    )}</div>
                </div>
                <div class="calc-warning" id="calcWarningValue">${escapeHtml(estimate.warning || '')}</div>
            </div>
        </div>
    `;

    const previousInput = document.getElementById('calcPreviousMeterInput');
    const presentInput = document.getElementById('calcPresentMeterInput');
    const amountValue = document.getElementById('calcAmountValue');
    const pagesValue = document.getElementById('calcPagesValue');
    const netValue = document.getElementById('calcNetValue');
    const vatValue = document.getElementById('calcVatValue');
    const formulaValue = document.getElementById('calcFormulaValue');
    const quotaValue = document.getElementById('calcQuotaValue');
    const warningValue = document.getElementById('calcWarningValue');

    const recompute = () => {
        const next = calculateBillingEstimate(
            context,
            previousInput ? previousInput.value : context.previousMeter,
            presentInput ? presentInput.value : context.presentMeter
        );
        if (amountValue) amountValue.textContent = formatAmount(next.amountDue || 0);
        if (pagesValue) pagesValue.textContent = formatCount(next.pages || 0);
        if (netValue) netValue.textContent = formatAmount(next.netAmount || 0);
        if (vatValue) vatValue.textContent = formatAmount(next.vatAmount || 0);
        if (formulaValue) formulaValue.textContent = next.formula;
        if (quotaValue) {
            quotaValue.textContent = next.quotaVariance === null
                ? 'No quota saved on this contract.'
                : `${formatCount(profile.monthly_quota || 0)} quota • ${next.quotaVariance >= 0 ? '+' : ''}${formatCount(next.quotaVariance)} vs usage`;
        }
        if (warningValue) warningValue.textContent = next.warning || '';
    };

    previousInput?.addEventListener('input', recompute);
    presentInput?.addEventListener('input', recompute);
    els.billingCalcModal.classList.remove('hidden');
}

function renderMatrixTable(payload) {
    const matrix = payload.month_matrix || {};
    const months = matrix.months || [];
    const rows = matrix.rows || [];
    const totals = matrix.totals || [];
    const payloadSearchTerm = String(payload?.filters?.search || '').trim().toLowerCase();
    const selectedRowId = MargaUtils.getUrlParam('row_id');
    const selectedMonth = MargaUtils.getUrlParam('month');
    const searchTerm = getMatrixSearchTerm();
    const payloadMatchesCurrentSearch = payloadSearchTerm === searchTerm;
    const matchedRowCount = payloadMatchesCurrentSearch
        ? Number(payload?.summary?.matrix_customers_total || rows.length)
        : rows.length;
    const isRowWindowed = matchedRowCount > rows.length;
    const filteredRows = searchTerm
        ? rows.filter((row) => {
              const haystack = [
                  row.serial_number,
                  row.account_name,
                  row.company_name,
                  row.branch_name,
                  row.machine_label,
                  row.machine_id,
                  row.reading_day
              ]
                  .filter(Boolean)
                  .join(' ')
                  .toLowerCase();
              return haystack.includes(searchTerm);
          })
        : rows;
    const sortedRows = [...filteredRows].sort((left, right) => compareBillingRows(left, right, getMatrixSortValue()));
    const rowsWithAmounts = filteredRows.filter((row) => (
        Object.values(row?.months || {}).some((cell) => Number(cell?.display_amount_total || 0) > 0)
    )).length;
    const sortValue = getMatrixSortValue();

    const displayRows = searchTerm ? buildCompanySummaryRows(sortedRows, months) : sortedRows;
    renderedMatrixRows = displayRows;

    if (els.matrixSearchMeta) {
        if (!rows.length) {
            els.matrixSearchMeta.textContent = 'No customers loaded yet.';
        } else if (searchTerm && !payloadMatchesCurrentSearch) {
            els.matrixSearchMeta.textContent = `Filtering ${formatCount(filteredRows.length)} loaded machine rows for "${els.matrixSearchInput.value.trim()}". Full search refresh starts at 2 characters.`;
        } else if (searchTerm) {
            const subtotalCount = displayRows.filter((row) => row.is_summary_row).length;
            const windowText = isRowWindowed
                ? ` Showing first ${formatCount(rows.length)} loaded rows out of ${formatCount(matchedRowCount)} matched rows.`
                : ` Showing all ${formatCount(matchedRowCount)} matched rows.`;
            const subtotalText = subtotalCount
                ? ` ${formatCount(subtotalCount)} company subtotal row${subtotalCount === 1 ? '' : 's'} added.`
                : '';
            const sortText = sortValue === 'customer'
                ? ` ${formatCount(rowsWithAmounts)} row${rowsWithAmounts === 1 ? '' : 's'} already have amounts and are shown first within each customer grouping.`
                : ' Rows follow Reading Day order first.';
            els.matrixSearchMeta.textContent = `Showing ${formatCount(filteredRows.length)} machine rows for "${els.matrixSearchInput.value.trim()}".${sortText}${windowText}${subtotalText} Footer totals reflect all matched rows.`;
        } else {
            els.matrixSearchMeta.textContent = isRowWindowed
                ? `Showing first ${formatCount(rows.length)} loaded machine rows out of ${formatCount(matchedRowCount)} matched rows. Footer totals reflect all matched rows.`
                : `Showing all ${formatCount(matchedRowCount)} matched machine rows. Footer totals reflect all matched rows.`;
        }
    }

    if (!months.length || !rows.length) {
        els.matrixTableWrap.innerHTML = '<div class="empty-panel">No month-to-month billing rows returned.</div>';
        return;
    }

    if (searchTerm && !filteredRows.length) {
        els.matrixTableWrap.innerHTML = `<div class="empty-panel">No billing rows matched "${escapeHtml(els.matrixSearchInput.value.trim())}".</div>`;
        return;
    }

    const header = months.map((monthKey) => {
        const total = totals.find((entry) => entry.month_key === monthKey);
        const label = total?.month_label_short || monthKey;
        return `<th>${escapeHtml(label)}</th>`;
    }).join('');

    const body = displayRows.map((row) => {
        const rowId = row.row_id || row.company_id;
        const trClass = [
            String(rowId) === String(selectedRowId) ? 'selected-row' : '',
            row.is_summary_row ? 'summary-row' : '',
            row.is_detail_row ? 'detail-row' : ''
        ].filter(Boolean).join(' ');
        const monthCells = months.map((monthKey) => {
            const cell = row.months?.[monthKey] || {};
            const isSelected = String(rowId) === String(selectedRowId) && monthKey === selectedMonth;
            const shownAmount = Number(cell.display_amount_total || cell.amount_total || 0);
            const hasReadingBreakdown = Number(cell.reading_amount_total || 0) > 0;
            const hasInvoiceAmount = Number(cell.amount_total || 0) > 0;
            const canOpenCalculator = !row.is_summary_row && Boolean(getRowBillingProfile(row));
            if (cell.billed || shownAmount > 0) {
                const invoiceMeta = `${formatCount(cell.invoice_count || 0)} inv`;
                const machineMeta = `${formatCount(cell.machine_count || 0)} mach`;
                const pendingMeta = row.is_summary_row && Number(cell.pending_count || 0) > 0
                    ? ` • ${formatCount(cell.pending_count || 0)} pending`
                    : '';
                const cellMeta = hasInvoiceAmount
                    ? `${invoiceMeta} • ${machineMeta}${pendingMeta}`
                    : `${formatCount(cell.reading_task_count || 0)} meter form • ${formatCount(cell.reading_pages_total || 0)} pg${pendingMeta}`;
                return `
                    <td class="month-cell billed-cell ${!hasInvoiceAmount && hasReadingBreakdown ? 'meter-cell' : ''} ${isSelected ? 'selected-cell' : ''}" title="${escapeHtml(hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter reading breakdown amount')}">
                        <button
                            class="billed-link ${row.is_summary_row ? 'summary-billed-link' : ''}"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            aria-label="Open invoice detail for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        >
                            <span class="amount-value">${escapeHtml(formatAmount(shownAmount))}</span>
                            <span class="cell-meta">${escapeHtml(cellMeta)}</span>
                        </button>
                        ${hasInvoiceAmount ? receiptDot(cell.receipt_status) : ''}
                    </td>
                `;
            }
            if (cell.pending) {
                if (!canOpenCalculator) {
                    return `<td class="month-cell pending-cell ${isSelected ? 'selected-cell' : ''}"></td>`;
                }
                return `
                    <td class="month-cell pending-cell ${isSelected ? 'selected-cell' : ''}">
                        <button
                            class="pending-link calc-link"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            title="Pending reading or billing. Open billing calculation."
                            aria-label="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        ></button>
                    </td>
                `;
            }
            if (canOpenCalculator) {
                return `
                    <td class="month-cell empty-cell ${isSelected ? 'selected-cell' : ''}">
                        <button
                            class="empty-link calc-link"
                            type="button"
                            data-row-id="${escapeHtml(String(rowId))}"
                            data-month-key="${escapeHtml(monthKey)}"
                            title="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                            aria-label="Open billing calculation for ${escapeHtml(row.account_name || row.company_name)} ${escapeHtml(monthKey)}"
                        ></button>
                    </td>
                `;
            }
            return `<td class="month-cell empty-cell"></td>`;
        }).join('');

        return `
            <tr class="${trClass}">
                <td class="rd-col">${row.is_summary_row ? '' : (row.reading_day ? escapeHtml(String(row.reading_day)) : '-')}</td>
                <td class="sn-col">
                    ${
                        row.is_summary_row
                            ? '<span class="subtotal-pill">Subtotal</span>'
                            : `
                                <button
                                    class="serial-link"
                                    type="button"
                                    data-row-id="${escapeHtml(String(rowId))}"
                                    aria-label="Open serial detail for ${escapeHtml(row.serial_number || row.machine_label || row.machine_id || 'machine')}"
                                >
                                    ${escapeHtml(row.serial_number || 'N/A')}
                                </button>
                            `
                    }
                </td>
                <td class="customer-col">
                    <div class="customer-main">${escapeHtml(row.company_name || row.account_name)}</div>
                    <div class="customer-sub">${escapeHtml(row.is_summary_row ? (row.machine_label || '') : (row.machine_label || row.machine_id || ''))}</div>
                </td>
                <td class="branch-col">
                    <div class="branch-main">${renderBranchMain(row)}</div>
                    <div class="branch-sub">${escapeHtml(renderBranchSub(row))}</div>
                </td>
                ${monthCells}
            </tr>
        `;
    }).join('');

    const footer = months.map((monthKey) => {
        const authoritativeTotal = payloadMatchesCurrentSearch
            ? totals.find((entry) => entry.month_key === monthKey)
            : null;
        const amount = authoritativeTotal
            ? Number(authoritativeTotal.amount_total || 0)
            : filteredRows.reduce((sum, row) => sum + Number(row.months?.[monthKey]?.amount_total || 0), 0);
        const totalTitle = authoritativeTotal
            ? 'Full matched billing total'
            : 'Loaded row subtotal';
        return `<td class="total-cell" title="${escapeHtml(totalTitle)}">${escapeHtml(formatAmount(amount))}</td>`;
    }).join('');

    els.matrixTableWrap.innerHTML = `
        <table class="billing-sheet matrix-sheet">
            <thead>
                <tr>
                    <th class="rd-col">RD</th>
                    <th class="sn-col">SN</th>
                    <th class="customer-col">Customer</th>
                    <th class="branch-col">Branch / Dept</th>
                    ${header}
                </tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot>
                <tr>
                    <th class="rd-col"></th>
                    <th class="sn-col"></th>
                    <th class="customer-col"></th>
                    <th class="branch-col"></th>
                    ${footer}
                </tr>
            </tfoot>
        </table>
    `;
}

function closeInvoiceDetailModal() {
    els.invoiceDetailModal?.classList.add('hidden');
}

function closeSerialDetailModal() {
    els.serialDetailModal?.classList.add('hidden');
}

function openSerialDetailModal(rowId) {
    if (!lastPayload) return;

    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    if (!row || row.is_summary_row) return;

    const openCustomersHref = customerHref(row);
    const latestBilledMonth = row.latest_billed_month || 'Not billed in current window';
    const readingDay = row.reading_day ? `RD ${row.reading_day}` : 'RD -';

    els.serialDetailTitle.textContent = row.serial_number || row.machine_label || 'Serial Detail';
    els.serialDetailSubtitle.textContent = `${row.company_name || row.account_name || 'Unknown'} • ${row.branch_name || 'Main'} • ${readingDay}`;

    els.serialDetailContent.innerHTML = `
        <div class="detail-action-row">
            <a class="detail-action-link" href="${escapeHtml(openCustomersHref)}">Open In Customers</a>
        </div>
        <div class="detail-summary-grid">
            <article class="detail-summary-card">
                <span class="label">Serial Number</span>
                <span class="value">${escapeHtml(row.serial_number || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Contract ID</span>
                <span class="value">${escapeHtml(row.contractmain_id || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Machine ID</span>
                <span class="value">${escapeHtml(row.machine_id || 'N/A')}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Latest Billed Month</span>
                <span class="value">${escapeHtml(latestBilledMonth)}</span>
            </article>
        </div>
        <div class="detail-section-title">Billing Context</div>
        <div class="invoice-detail-list">
            <article class="invoice-detail-card">
                <div class="detail-list-block">
                    <span class="detail-list-label">Customer</span>
                    <div class="detail-list-value">${escapeHtml(row.company_name || row.account_name || 'Unknown')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Branch / Department</span>
                    <div class="detail-list-value">${escapeHtml(row.branch_name || 'Main')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Account Label</span>
                    <div class="detail-list-value">${escapeHtml(row.account_name || row.company_name || 'Unknown')}</div>
                </div>
                <div class="detail-list-block">
                    <span class="detail-list-label">Machine Label</span>
                    <div class="detail-list-value">${escapeHtml(row.machine_label || row.machine_id || 'N/A')}</div>
                </div>
            </article>
        </div>
    `;

    els.serialDetailModal.classList.remove('hidden');
}

function openInvoiceDetailModal(rowId, monthKey) {
    if (!lastPayload) return;

    const row = renderedMatrixRows.find((entry) => String(entry.row_id || entry.company_id) === String(rowId))
        || (lastPayload.month_matrix?.rows || []).find((entry) => String(entry.row_id || entry.company_id) === String(rowId));
    const cell = row?.months?.[monthKey];
    if (!row || !cell || !(cell.billed || Number(cell.display_amount_total || cell.reading_amount_total || 0) > 0)) return;

    const title = row.display_name || row.account_name || row.company_name || 'Billing Detail';
    const readingDay = row.is_summary_row ? 'Company subtotal' : (row.reading_day ? `RD ${row.reading_day}` : 'RD -');
    const invoiceGroups = Array.isArray(cell.invoice_groups) ? cell.invoice_groups : [];
    const readingGroups = Array.isArray(cell.reading_groups) ? cell.reading_groups : [];
    const shownAmount = Number(cell.display_amount_total || cell.amount_total || cell.reading_amount_total || 0);
    const hasInvoiceAmount = Number(cell.amount_total || 0) > 0;

    els.invoiceDetailTitle.textContent = title;
    els.invoiceDetailSubtitle.textContent = `${monthKey} • ${readingDay} • ${hasInvoiceAmount ? receiptLabel(cell.receipt_status) : 'Meter breakdown amount'}`;

    els.invoiceDetailContent.innerHTML = `
        <div class="detail-summary-grid">
            <article class="detail-summary-card">
                <span class="label">Shown Amount</span>
                <span class="value">${escapeHtml(formatAmount(shownAmount))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Invoices</span>
                <span class="value">${escapeHtml(formatCount(cell.invoice_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Machines</span>
                <span class="value">${escapeHtml(formatCount(cell.machine_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Billing Lines</span>
                <span class="value">${escapeHtml(formatCount(cell.billing_line_count || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Meter Breakdown</span>
                <span class="value">${escapeHtml(formatAmount(cell.reading_amount_total || 0))}</span>
            </article>
            <article class="detail-summary-card">
                <span class="label">Net Pages</span>
                <span class="value">${escapeHtml(formatCount(cell.reading_pages_total || 0))}</span>
            </article>
            ${
                row.is_summary_row
                    ? `
                        <article class="detail-summary-card">
                            <span class="label">Pending Machine Rows</span>
                            <span class="value">${escapeHtml(formatCount(cell.pending_count || 0))}</span>
                        </article>
                    `
                    : ''
            }
        </div>
        ${
            !hasInvoiceAmount && Number(cell.reading_amount_total || 0) > 0
                ? `<div class="detail-empty">This row is showing the meter-reading amount for the branch or department. The official invoice may be consolidated under the mother account.</div>`
                : ''
        }
        <div class="detail-section-title">Invoice Breakdown</div>
        ${
            invoiceGroups.length
                ? `
                    <div class="invoice-detail-list">
                        ${invoiceGroups
                            .map(
                                (group) => `
                                    <article class="invoice-detail-card">
                                        <div class="invoice-detail-head">
                                            <div class="invoice-detail-ref">${escapeHtml(group.invoice_no || group.invoice_ref || 'Invoice')}</div>
                                            <div class="invoice-detail-amount">${escapeHtml(formatAmount(group.amount_total || 0))}</div>
                                        </div>
                                        <div class="invoice-detail-meta">
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.machine_count || 0, 'machine'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.contract_count || 0, 'contract'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.billing_line_count || 0, 'billing line'))}</span>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Machine IDs</span>
                                            <div class="detail-list-value">${escapeHtml((group.machine_ids || []).join(', ') || 'No machine IDs mapped')}${group.machine_ids_truncated ? ' ...' : ''}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Contractmain IDs</span>
                                            <div class="detail-list-value">${escapeHtml((group.contractmain_ids || []).join(', ') || 'No contract IDs mapped')}${group.contractmain_ids_truncated ? ' ...' : ''}</div>
                                        </div>
                                    </article>
                                `
                            )
                            .join('')}
                    </div>
                `
                : '<div class="detail-empty">No invoice-level detail was returned for this cell.</div>'
        }
        <div class="detail-section-title">Meter Reading Breakdown</div>
        ${
            readingGroups.length
                ? `
                    <div class="invoice-detail-list">
                        ${readingGroups
                            .map(
                                (group) => `
                                    <article class="invoice-detail-card">
                                        <div class="invoice-detail-head">
                                            <div class="invoice-detail-ref">${escapeHtml(group.invoice_num ? `Invoice ${group.invoice_num}` : `Schedule ${group.schedule_id || 'N/A'}`)}</div>
                                            <div class="invoice-detail-amount">${escapeHtml(formatAmount(group.amount_total || 0))}</div>
                                        </div>
                                        <div class="invoice-detail-meta">
                                            <span class="invoice-detail-chip">${escapeHtml(formatMetricCount(group.pages || 0, 'page'))}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(`Rate ${formatAmount(group.page_rate || 0)}`)}</span>
                                            <span class="invoice-detail-chip">${escapeHtml(group.with_vat ? 'VAT Inclusive' : 'VAT Exclusive')}</span>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Contract / Machine</span>
                                            <div class="detail-list-value">${escapeHtml(`Contract ${group.contractmain_id || 'N/A'} • Machine ${group.machine_id || 'N/A'}`)}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Quota / Monthly</span>
                                            <div class="detail-list-value">${escapeHtml(`${formatCount(group.monthly_quota || 0)} quota • ${formatAmount(group.monthly_rate || 0)} monthly`)}</div>
                                        </div>
                                        <div class="detail-list-block">
                                            <span class="detail-list-label">Computation</span>
                                            <div class="detail-list-value">${escapeHtml(`${formatCount(group.pages || 0)} pages × ${formatAmount(group.page_rate || 0)} = ${formatAmount(group.amount_total || 0)}`)}</div>
                                        </div>
                                    </article>
                                `
                            )
                            .join('')}
                    </div>
                `
                : '<div class="detail-empty">No meter-reading breakdown was returned for this cell.</div>'
        }
    `;

    els.invoiceDetailModal.classList.remove('hidden');
}

function renderAll(payload) {
    lastPayload = payload;
    renderSelectionCard(payload);
    renderSummaryTable(payload);
    renderMatrixTable(payload);
    els.rawJson.textContent = JSON.stringify(payload, null, 2);
}

function renderError(message) {
    els.selectionCard.classList.add('hidden');
    els.summaryTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    els.matrixTableWrap.innerHTML = '<div class="empty-panel">Request failed. Check API payload below.</div>';
    els.rawJson.textContent = String(message || 'Unknown error');
}

async function loadDashboard() {
    try {
        const { url, apiKey } = buildRequestContext();
        setStatus('Loading...', 'loading');
        els.runBtn.disabled = true;

        const headers = {};
        if (apiKey) headers['x-api-key'] = apiKey;

        const response = await fetch(url, { headers });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
            throw new Error(payload?.error || `Request failed (${response.status})`);
        }

        renderAll(payload);
        setStatus('Loaded');
    } catch (error) {
        renderError(error?.message || error);
        setStatus('Error', 'error');
    } finally {
        els.runBtn.disabled = false;
    }
}

async function copyCurl() {
    try {
        const { url, apiKey } = buildRequestContext();
        const headerPart = apiKey ? ` -H "x-api-key: ${apiKey}"` : '';
        await navigator.clipboard.writeText(`curl -s "${url}"${headerPart}`);
        MargaUtils.showToast('cURL copied to clipboard.', 'success');
    } catch (error) {
        MargaUtils.showToast(String(error?.message || 'Unable to copy cURL.'), 'error');
    }
}

function bindEvents() {
    els.runBtn?.addEventListener('click', loadDashboard);
    els.copyCurlBtn?.addEventListener('click', copyCurl);
    els.matrixSearchInput?.addEventListener('input', () => {
        if (lastPayload) renderMatrixTable(lastPayload);
        window.clearTimeout(searchReloadTimer);
        const search = String(els.matrixSearchInput?.value || '').trim();
        if (!search || search.length >= 2) {
            searchReloadTimer = window.setTimeout(() => {
                loadDashboard();
            }, 350);
        }
    });
    els.matrixSortInput?.addEventListener('change', () => {
        localStorage.setItem(MATRIX_SORT_STORAGE_KEY, getMatrixSortValue());
        if (lastPayload) renderMatrixTable(lastPayload);
    });
    els.matrixTableWrap?.addEventListener('click', (event) => {
        const calcTrigger = event.target.closest('.calc-link');
        if (calcTrigger) {
            event.preventDefault();
            openBillingCalcModal(calcTrigger.dataset.rowId, calcTrigger.dataset.monthKey);
            return;
        }
        const serialTrigger = event.target.closest('.serial-link');
        if (serialTrigger) {
            openSerialDetailModal(serialTrigger.dataset.rowId);
            return;
        }
        const trigger = event.target.closest('.billed-link');
        if (!trigger) return;
        openInvoiceDetailModal(trigger.dataset.rowId, trigger.dataset.monthKey);
    });
    els.invoiceDetailCloseBtn?.addEventListener('click', closeInvoiceDetailModal);
    els.invoiceDetailModal?.addEventListener('click', (event) => {
        if (event.target === els.invoiceDetailModal) closeInvoiceDetailModal();
    });
    els.billingCalcCloseBtn?.addEventListener('click', closeBillingCalcModal);
    els.billingCalcModal?.addEventListener('click', (event) => {
        if (event.target === els.billingCalcModal) closeBillingCalcModal();
    });
    els.clearSelectionBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        clearPendingSelection();
    });
    els.serialDetailCloseBtn?.addEventListener('click', closeSerialDetailModal);
    els.serialDetailModal?.addEventListener('click', (event) => {
        if (event.target === els.serialDetailModal) closeSerialDetailModal();
    });
    window.addEventListener('popstate', () => {
        if (lastPayload) {
            renderSelectionCard(lastPayload);
            renderMatrixTable(lastPayload);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeInvoiceDetailModal();
            closeSerialDetailModal();
            closeBillingCalcModal();
        }
    });
}

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('show');
}

window.toggleSidebar = toggleSidebar;

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    if (!applyUserContext()) return;

    const savedKey = String(localStorage.getItem('openclaw_api_key') || '').trim();
    if (savedKey) els.apiKeyInput.value = savedKey;

    restoreMatrixSortValue();
    initDefaults();
    bindEvents();
    loadDashboard();
});
