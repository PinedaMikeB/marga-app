/**
 * MARGA Collections Module - Collection Report
 * - Collection dashboard + report lists in one module
 * - Robust loading with defensive fallbacks
 * - In-page invoice detail modal with follow-up history
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;
let currentPriorityFilter = null;
let quickAgeFilter = 'all';
let dataMode = 'active';
let todayFollowups = [];
let collectionHistory = {};

// Lookup maps
let contractMap = {};
let branchMap = {};
let companyMap = {};
let paidInvoiceIds = new Set();
let machToBranchMap = {};
let invoiceIndexMap = new Map();
let lookupsLoaded = false;
let lastLoadSucceeded = false;

const dailyTips = [
    'Focus on URGENT (91-120 days) first - highest recovery potential.',
    'Best call times: 9-11 AM and 2-4 PM. Avoid lunch hours.',
    'Always log call attempts to track payment patterns.',
    'Work URGENT -> HIGH -> MEDIUM for maximum efficiency.',
    'For 120+ day accounts, escalate for machine pull-out recommendation.'
];

const PROMISE_REMARK_PATTERN = /\b(ok na|for signing|check|pickup|ready|release|promise|ptp|payment|paid)\b/i;

function getValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.stringValue !== undefined) return field.stringValue;
    return null;
}

function getField(fields, candidates) {
    for (const name of candidates) {
        const value = getValue(fields[name]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
}

function normalizeDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        const d = new Date(`${isoMatch[1]}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
        const month = String(slashMatch[1]).padStart(2, '0');
        const day = String(slashMatch[2]).padStart(2, '0');
        const d = new Date(`${slashMatch[3]}-${month}-${day}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function daysBetween(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    return Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function formatDate(value) {
    const d = normalizeDate(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyShort(amount) {
    const value = Number(amount || 0);
    if (value >= 1000000) return '₱' + (value / 1000000).toFixed(2) + 'M';
    if (value >= 1000) return '₱' + (value / 1000).toFixed(0) + 'K';
    return '₱' + value.toFixed(0);
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updateLoadingStatus(message) {
    const container = document.getElementById('table-container');
    if (!container) return;
    container.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div><span>${escapeHtml(message)}</span></div>`;
}

function showLoadError(message) {
    const errorBanner = document.getElementById('errorBanner');
    if (errorBanner) {
        errorBanner.textContent = message;
        errorBanner.classList.remove('hidden');
    }

    const container = document.getElementById('table-container');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Unable to load collection data</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }

    const pagination = document.getElementById('pagination');
    if (pagination) pagination.style.display = 'none';
}

function hideLoadError() {
    document.getElementById('errorBanner')?.classList.add('hidden');
}

async function firestoreGet(collection, pageSize = 300, pageToken = null, fieldMask = null) {
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    params.set('key', API_KEY);
    if (pageToken) params.set('pageToken', pageToken);

    if (Array.isArray(fieldMask)) {
        fieldMask.forEach((path) => {
            if (path) params.append('mask.fieldPaths', path);
        });
    }

    const url = `${BASE_URL}/${collection}?${params.toString()}`;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400));
        } finally {
            clearTimeout(timeout);
        }
    }
}

async function firestoreGetAll(collection, statusCallback = null, options = {}) {
    const {
        pageSize: requestPageSize = 300,
        maxPages = 150,
        fieldMask = null
    } = options;

    const allDocs = [];
    let pageToken = null;
    let page = 0;

    while (page < maxPages) {
        page += 1;
        const data = await firestoreGet(collection, requestPageSize, pageToken, fieldMask);
        if (Array.isArray(data.documents) && data.documents.length > 0) {
            allDocs.push(...data.documents);
        }

        if (statusCallback) statusCallback(`Loading ${collection}... ${allDocs.length.toLocaleString()}`);

        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }

    if (page >= maxPages && pageToken) {
        console.warn(`Reached max pages while loading ${collection}. Data may be incomplete.`);
    }

    return allDocs;
}

function monthNameToNumber(monthName) {
    const months = {
        january: 1,
        february: 2,
        march: 3,
        april: 4,
        may: 5,
        june: 6,
        july: 7,
        august: 8,
        september: 9,
        october: 10,
        november: 11,
        december: 12
    };
    return months[String(monthName || '').toLowerCase()] || 0;
}

function calculateAge(dueDate, month, year) {
    const due = normalizeDate(dueDate);
    if (due) return Math.max(0, daysBetween(due, new Date()));

    if (month && year) {
        const monthNum = monthNameToNumber(month);
        if (monthNum) {
            const date = new Date(Number(year), monthNum - 1, 1);
            if (!Number.isNaN(date.getTime())) return Math.max(0, daysBetween(date, new Date()));
        }
    }
    return 0;
}

function getPriority(age) {
    if (age >= 366) return { code: 'baddebt', label: 'Bad Debt', order: 5 };
    if (age >= 181) return { code: 'doubtful', label: 'Doubtful', order: 4 };
    if (age >= 121) return { code: 'review', label: 'For Review', order: 3 };
    if (age >= 91) return { code: 'urgent', label: 'Urgent', order: 0 };
    if (age >= 61) return { code: 'high', label: 'High', order: 1 };
    if (age >= 31) return { code: 'medium', label: 'Medium', order: 2 };
    return { code: 'current', label: 'Current', order: 6 };
}

function getAgeClass(days) {
    if (days >= 366) return 'age-365';
    if (days >= 180) return 'age-180';
    if (days >= 120) return 'age-120';
    if (days >= 90) return 'age-90';
    if (days >= 60) return 'age-60';
    if (days >= 30) return 'age-30';
    return 'age-current';
}

function getCategoryCode(categoryId) {
    const categories = { 1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC', 6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD' };
    return categories[Number(categoryId)] || '-';
}

function showWelcomeModal() {
    document.getElementById('welcomeModal')?.classList.remove('hidden');
}

function closeWelcomeModal() {
    document.getElementById('welcomeModal')?.classList.add('hidden');
    if (document.getElementById('dontShowAgain')?.checked) {
        localStorage.setItem('collections_hideWelcome', 'true');
    }
}

function checkWelcomeModal() {
    if (!localStorage.getItem('collections_hideWelcome')) showWelcomeModal();
}

function goToPriority(priority) {
    closeWelcomeModal();
    filterByPriority(priority);
}

function showRandomTip() {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    const tipText = document.getElementById('tipText');
    if (tipText) tipText.textContent = tip;
}

function closeTip() {
    const tipBanner = document.getElementById('tipBanner');
    if (tipBanner) tipBanner.style.display = 'none';
}

function closeFollowupModal() {
    document.getElementById('followupModal')?.classList.add('hidden');
}

function closeDetailModal() {
    document.getElementById('detailModal')?.classList.add('hidden');
}

function showTodayFollowups() {
    const followupList = document.getElementById('followupList');
    const modal = document.getElementById('followupModal');
    if (!followupList || !modal) return;

    const scheduled = getTodayScheduledInvoices();

    if (scheduled.length === 0) {
        followupList.innerHTML = '<div class="empty-followup">No scheduled collections for today.</div>';
    } else {
        followupList.innerHTML = `
            <div class="followup-list">
                ${scheduled
                    .map(
                        (inv) => `
                    <div class="followup-item" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <div class="followup-company">${escapeHtml(inv.company)}</div>
                        <div class="followup-invoice">Invoice #${escapeHtml(inv.invoiceNo)} • ${escapeHtml(formatCurrency(inv.amount))}</div>
                    </div>
                `
                    )
                    .join('')}
            </div>
        `;
    }

    modal.classList.remove('hidden');
}

function getHistoryForInvoice(...keys) {
    const merged = [];
    const seen = new Set();

    keys
        .filter((k) => k !== null && k !== undefined && k !== '')
        .map((k) => String(k).trim())
        .forEach((key) => {
            const entries = collectionHistory[key] || [];
            entries.forEach((entry) => {
                const token = `${entry.docId}|${entry.callDateKey || ''}|${entry.followupDateKey || ''}|${entry.remarks || ''}`;
                if (seen.has(token)) return;
                seen.add(token);
                merged.push(entry);
            });
        });

    merged.sort((a, b) => {
        const aTime = a.callDate ? a.callDate.getTime() : 0;
        const bTime = b.callDate ? b.callDate.getTime() : 0;
        return bTime - aTime;
    });

    return merged;
}

async function loadCollectionHistory() {
    const historyDocs = await firestoreGetAll('tbl_collectionhistory', null, {
        fieldMask: [
            'invoice_num',
            'invoice_id',
            'invoice_no',
            'invoiceno',
            'followup_datetime',
            'followup_date',
            'next_followup',
            'schedule_status',
            'remarks',
            'contact_person',
            'timestamp',
            'call_datetime',
            'created_at'
        ],
        maxPages: 60
    });

    collectionHistory = {};
    todayFollowups = [];

    const todayKey = toDateKey(new Date());

    historyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const invoiceRef = getField(f, ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno']);
        if (!invoiceRef) return;

        const invoiceKey = String(invoiceRef).trim();
        if (!invoiceKey) return;

        const followupDateRaw = getField(f, ['followup_datetime', 'followup_date', 'next_followup']);
        const callDateRaw = getField(f, ['timestamp', 'call_datetime', 'created_at']) || followupDateRaw;

        const followupDate = normalizeDate(followupDateRaw);
        const callDate = normalizeDate(callDateRaw);

        const entry = {
            docId: doc.name || String(Math.random()),
            remarks: getField(f, ['remarks']) || 'No remarks',
            contactPerson: getField(f, ['contact_person']) || '-',
            scheduleStatus: getField(f, ['schedule_status']),
            followupDate,
            followupDateRaw,
            followupDateKey: toDateKey(followupDate),
            callDate,
            callDateRaw,
            callDateKey: toDateKey(callDate)
        };

        if (!collectionHistory[invoiceKey]) collectionHistory[invoiceKey] = [];
        collectionHistory[invoiceKey].push(entry);

        if (entry.followupDateKey && entry.followupDateKey === todayKey) {
            todayFollowups.push({
                invoiceKey,
                followupDate: entry.followupDate,
                remarks: entry.remarks,
                contactPerson: entry.contactPerson,
                scheduleStatus: entry.scheduleStatus
            });
        }
    });

    Object.keys(collectionHistory).forEach((key) => {
        collectionHistory[key].sort((a, b) => {
            const aTime = a.callDate ? a.callDate.getTime() : 0;
            const bTime = b.callDate ? b.callDate.getTime() : 0;
            return bTime - aTime;
        });
    });

    const followupSeen = new Set();
    todayFollowups = todayFollowups.filter((item) => {
        const token = item.invoiceKey;
        if (followupSeen.has(token)) return false;
        followupSeen.add(token);
        return true;
    });
}

function updateFollowupBadge() {
    const badge = document.getElementById('followupBadge');
    if (!badge) return;

    if (todayFollowups.length > 0) {
        badge.textContent = todayFollowups.length.toLocaleString();
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

async function buildMachineToBranchMap() {
    const historyDocs = await firestoreGetAll('tbl_newmachinehistory', null, {
        fieldMask: ['mach_id', 'branch_id', 'status_id', 'datex'],
        maxPages: 120
    });

    const machineDeliveries = {};

    historyDocs.forEach((doc) => {
        const f = doc.fields || {};
        const machId = String(getField(f, ['mach_id']) || '').trim();
        const branchId = getField(f, ['branch_id']);
        const statusId = getField(f, ['status_id']);
        const datex = normalizeDate(getField(f, ['datex']));

        if (!machId || !branchId) return;
        if (Number(statusId) !== 2) return;

        if (!machineDeliveries[machId]) machineDeliveries[machId] = [];
        machineDeliveries[machId].push({
            branchId: String(branchId),
            date: datex
        });
    });

    machToBranchMap = {};

    Object.entries(machineDeliveries).forEach(([machId, deliveries]) => {
        deliveries.sort((a, b) => {
            const aTime = a.date ? a.date.getTime() : 0;
            const bTime = b.date ? b.date.getTime() : 0;
            return bTime - aTime;
        });
        machToBranchMap[machId] = deliveries[0].branchId;
    });
}

async function loadLookups() {
    if (lookupsLoaded) return;

    updateLoadingStatus('Loading company and branch data...');

    const [companyDocs, branchDocs, contractDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', null, {
            fieldMask: ['id', 'companyname'],
            maxPages: 20
        }),
        firestoreGetAll('tbl_branchinfo', null, {
            fieldMask: ['id', 'company_id', 'branchname'],
            maxPages: 30
        }),
        firestoreGetAll('tbl_contractmain', null, {
            fieldMask: ['id', 'contract_id', 'mach_id', 'category_id'],
            maxPages: 40
        })
    ]);

    companyMap = {};
    companyDocs.forEach((doc) => {
        const id = String(getField(doc.fields || {}, ['id']) || '').trim();
        if (!id) return;
        companyMap[id] = getField(doc.fields || {}, ['companyname']) || 'Unknown';
    });

    branchMap = {};
    branchDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;

        branchMap[id] = {
            name: getField(f, ['branchname']) || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim()
        };
    });

    contractMap = {};
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;

        contractMap[id] = {
            contractId: String(getField(f, ['contract_id']) || '').trim(),
            machId: String(getField(f, ['mach_id']) || '').trim(),
            categoryId: getField(f, ['category_id'])
        };
    });

    updateLoadingStatus('Loading machine location map...');
    await buildMachineToBranchMap();

    updateLoadingStatus('Loading payment records...');
    const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus, {
        fieldMask: ['invoice_id'],
        maxPages: 260
    });

    paidInvoiceIds = new Set();
    paymentDocs.forEach((doc) => {
        const invoiceId = getField(doc.fields || {}, ['invoice_id']);
        if (invoiceId !== null && invoiceId !== undefined && invoiceId !== '') {
            paidInvoiceIds.add(String(invoiceId).trim());
        }
    });

    updateLoadingStatus('Loading collection history...');
    await loadCollectionHistory();

    lookupsLoaded = true;
}

function processInvoice(doc) {
    const f = doc.fields || {};

    const invoiceId = getField(f, ['invoice_id', 'invoiceid']);
    const invoiceNo = getField(f, ['invoiceno', 'invoice_no', 'invoice_id', 'id']);

    const invoiceIdKey = invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '';
    const invoiceNoKey = invoiceNo !== null && invoiceNo !== undefined ? String(invoiceNo).trim() : '';

    if (!invoiceIdKey && !invoiceNoKey) return null;
    if (paidInvoiceIds.has(invoiceIdKey) || paidInvoiceIds.has(invoiceNoKey)) return null;

    const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
    const contract = contractMap[contractmainId] || {};

    let companyName = 'Unknown';
    let branchName = 'Main';

    let branchId = machToBranchMap[contract.machId];
    if (!branchId && contract.contractId) branchId = contract.contractId;

    const branch = branchMap[String(branchId || '').trim()];
    if (branch) {
        branchName = branch.name || 'Main';
        companyName = companyMap[branch.companyId] || 'Unknown';
    }

    const month = getField(f, ['month']);
    const year = getField(f, ['year']);
    const dueDate = getField(f, ['due_date']);
    const invoiceDateRaw = getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex']);
    const invoiceDate = normalizeDate(invoiceDateRaw);

    const age = calculateAge(dueDate, month, year);
    const totalAmount = Number(getField(f, ['totalamount', 'amount']) || 0);
    const vatAmount = Number(getField(f, ['vatamount']) || 0);

    const history = getHistoryForInvoice(invoiceIdKey, invoiceNoKey);
    const lastHistory = history.length > 0 ? history[0] : null;
    const lastContactDate = lastHistory ? lastHistory.callDate : null;
    const lastContactDays = lastContactDate ? Math.max(0, daysBetween(lastContactDate, new Date())) : null;

    return {
        id: getField(f, ['id']),
        invoiceId: invoiceIdKey || invoiceNoKey,
        invoiceNo: invoiceNoKey || invoiceIdKey,
        invoiceKey: invoiceNoKey || invoiceIdKey,
        amount: totalAmount + vatAmount,
        month,
        year,
        monthYear: month && year ? `${month} ${year}` : '-',
        invoiceDate,
        invoiceDateRaw,
        dueDate,
        age,
        priority: getPriority(age),
        company: companyName,
        branch: branchName,
        category: getCategoryCode(contract.categoryId),
        lastRemarks: lastHistory ? lastHistory.remarks : null,
        lastContactDate,
        lastContactDays,
        nextFollowup: lastHistory ? lastHistory.followupDate : null,
        historyCount: history.length,
        history
    };
}

function rebuildInvoiceIndex() {
    invoiceIndexMap = new Map();
    allInvoices.forEach((invoice) => {
        if (invoice.invoiceNo) invoiceIndexMap.set(String(invoice.invoiceNo), invoice);
        if (invoice.invoiceId) invoiceIndexMap.set(String(invoice.invoiceId), invoice);
        if (invoice.id !== null && invoice.id !== undefined) invoiceIndexMap.set(String(invoice.id), invoice);
    });
}

function findInvoiceByKey(key) {
    if (key === null || key === undefined) return null;
    return invoiceIndexMap.get(String(key).trim()) || null;
}

async function loadInvoices(mode) {
    dataMode = mode;
    const isAllMode = mode === 'all';
    lastLoadSucceeded = false;

    document.getElementById('btnShowBadDebt')?.classList.toggle('active', isAllMode);
    hideLoadError();

    try {
        await loadLookups();

        updateLoadingStatus(isAllMode ? 'Loading all billing records...' : 'Loading active billing records...');
        const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus, {
            fieldMask: [
                'id',
                'invoice_id',
                'invoiceid',
                'invoiceno',
                'invoice_no',
                'contractmain_id',
                'month',
                'year',
                'due_date',
                'totalamount',
                'amount',
                'vatamount',
                'dateprinted',
                'date_printed',
                'invdate',
                'invoice_date',
                'datex'
            ],
            maxPages: 320
        });

        allInvoices = [];
        const years = new Set();

        billingDocs.forEach((doc) => {
            const invoice = processInvoice(doc);
            if (!invoice) return;
            if (!isAllMode && invoice.age > 180) return;

            allInvoices.push(invoice);
            if (invoice.year) years.add(String(invoice.year));
        });

        allInvoices.sort((a, b) => {
            if (a.priority.order !== b.priority.order) return a.priority.order - b.priority.order;
            if (b.age !== a.age) return b.age - a.age;
            return b.amount - a.amount;
        });

        rebuildInvoiceIndex();
        populateYearFilter(years);

        currentPage = 1;
        recomputeFilteredInvoices();

        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        lastLoadSucceeded = true;
        return true;
    } catch (error) {
        console.error('Collections load failed:', error);
        showLoadError('Collection report loading failed. Please click Refresh and try again.');
        return false;
    }
}

async function loadActiveInvoices() {
    await loadInvoices('active');
}

async function loadAllInvoices() {
    await loadInvoices('all');
}

function toggleBadDebt() {
    if (dataMode === 'active') loadAllInvoices();
    else loadActiveInvoices();
}

async function loadUnpaidInvoices() {
    if (dataMode === 'all') await loadAllInvoices();
    else await loadActiveInvoices();
}

function populateYearFilter(years) {
    const select = document.getElementById('filter-year');
    if (!select) return;

    select.innerHTML = '<option value="">All</option>';
    Array.from(years)
        .sort((a, b) => Number(b) - Number(a))
        .forEach((year) => {
            select.innerHTML += `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`;
        });
}

function setQuickAgeFilter(bucket) {
    quickAgeFilter = bucket;

    document.querySelectorAll('.quick-age-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.bucket === bucket);
    });

    currentPage = 1;
    recomputeFilteredInvoices();
}

function ageMatchesQuickFilter(age) {
    if (quickAgeFilter === 'all') return true;
    if (quickAgeFilter === '30') return age >= 30;
    if (quickAgeFilter === '60') return age >= 60;
    if (quickAgeFilter === '90') return age >= 90;
    if (quickAgeFilter === '120') return age >= 120;
    return true;
}

function ageMatchesRangeFilter(age, filter) {
    if (!filter) return true;
    if (filter === '366+') return age >= 366;

    const [min, max] = filter.split('-').map(Number);
    if (Number.isNaN(min) || Number.isNaN(max)) return true;
    return age >= min && age <= max;
}

function invoiceDateInRange(invoice, fromDate, toDate) {
    if (!fromDate && !toDate) return true;

    const date = invoice.invoiceDate || normalizeDate(invoice.dueDate);
    if (!date) return false;

    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const inclusiveTo = new Date(toDate.getTime());
        inclusiveTo.setHours(23, 59, 59, 999);
        if (date > inclusiveTo) return false;
    }

    return true;
}

function recomputeFilteredInvoices() {
    const yearFilter = document.getElementById('filter-year')?.value || '';
    const monthFilter = document.getElementById('filter-month')?.value || '';
    const ageFilter = document.getElementById('filter-age')?.value || '';
    const categoryFilter = document.getElementById('filter-category')?.value || '';
    const searchTerm = (document.getElementById('search-input')?.value || '').trim().toLowerCase();

    const fromDate = normalizeDate(document.getElementById('filter-from-date')?.value);
    const toDate = normalizeDate(document.getElementById('filter-to-date')?.value);

    filteredInvoices = allInvoices.filter((invoice) => {
        if (currentPriorityFilter) {
            if (currentPriorityFilter === 'review') {
                if (invoice.priority.code !== 'review' && invoice.priority.code !== 'doubtful') return false;
            } else if (invoice.priority.code !== currentPriorityFilter) {
                return false;
            }
        }

        if (!ageMatchesQuickFilter(invoice.age)) return false;
        if (!ageMatchesRangeFilter(invoice.age, ageFilter)) return false;
        if (!invoiceDateInRange(invoice, fromDate, toDate)) return false;

        if (yearFilter && String(invoice.year || '') !== yearFilter) return false;
        if (monthFilter && String(invoice.month || '') !== monthFilter) return false;
        if (categoryFilter && invoice.category !== categoryFilter) return false;

        if (searchTerm) {
            const haystack = `${invoice.invoiceNo} ${invoice.company} ${invoice.branch}`.toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }

        return true;
    });

    updateAllStats();
    renderTable();
    showActiveFilters();
    renderTodayScheduleTable();
    renderPromiseDueTable();
    renderUrgentStaleTable();
    renderMissingContactTable();
    updateFollowupBadge();
    updateActionBrief();
}

function applyFilters() {
    currentPage = 1;
    recomputeFilteredInvoices();
}

function clearFilterInputs() {
    const ids = [
        'filter-year',
        'filter-month',
        'filter-age',
        'filter-category',
        'filter-from-date',
        'filter-to-date',
        'search-input'
    ];

    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = '';
    });
}

function clearFilters() {
    clearFilterInputs();
    currentPriorityFilter = null;

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    setQuickAgeFilter('all');
    currentPage = 1;
    recomputeFilteredInvoices();
}

function filterByPriority(priority) {
    if (currentPriorityFilter === priority) {
        currentPriorityFilter = null;
    } else {
        currentPriorityFilter = priority;
    }

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    if (currentPriorityFilter) {
        document.querySelector(`.priority-card.${currentPriorityFilter}`)?.classList.add('active');
    }

    currentPage = 1;
    recomputeFilteredInvoices();
}

function removeFilter(fieldId) {
    if (fieldId === 'priority') {
        currentPriorityFilter = null;
        document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
        currentPage = 1;
        recomputeFilteredInvoices();
        return;
    }

    if (fieldId === 'quick-age') {
        setQuickAgeFilter('all');
        return;
    }

    const element = document.getElementById(fieldId);
    if (element) {
        element.value = '';
        currentPage = 1;
        recomputeFilteredInvoices();
    }
}

function showActiveFilters() {
    const filters = [];

    if (currentPriorityFilter) {
        filters.push({ label: `Priority: ${currentPriorityFilter.toUpperCase()}`, field: 'priority' });
    }

    if (quickAgeFilter !== 'all') {
        filters.push({ label: `Age Quick: ${quickAgeFilter}+ days`, field: 'quick-age' });
    }

    const filterYear = document.getElementById('filter-year')?.value;
    const filterMonth = document.getElementById('filter-month')?.value;
    const filterAge = document.getElementById('filter-age')?.value;
    const filterCategory = document.getElementById('filter-category')?.value;
    const fromDate = document.getElementById('filter-from-date')?.value;
    const toDate = document.getElementById('filter-to-date')?.value;
    const search = document.getElementById('search-input')?.value?.trim();

    if (filterYear) filters.push({ label: `Year: ${filterYear}`, field: 'filter-year' });
    if (filterMonth) filters.push({ label: `Month: ${filterMonth}`, field: 'filter-month' });
    if (filterAge) filters.push({ label: `Age: ${filterAge}`, field: 'filter-age' });
    if (filterCategory) filters.push({ label: `Category: ${filterCategory}`, field: 'filter-category' });
    if (fromDate) filters.push({ label: `From: ${fromDate}`, field: 'filter-from-date' });
    if (toDate) filters.push({ label: `To: ${toDate}`, field: 'filter-to-date' });
    if (search) filters.push({ label: `Search: "${search}"`, field: 'search-input' });

    const container = document.getElementById('active-filters');
    if (!container) return;

    container.innerHTML =
        filters.length === 0
            ? ''
            : filters
                  .map(
                      (filter) =>
                          `<span class="filter-tag">${escapeHtml(filter.label)} <span class="remove" onclick="removeFilter('${escapeHtml(
                              filter.field
                          )}')">x</span></span>`
                  )
                  .join('');
}

function updateAllStats() {
    const counts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };
    const amounts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };

    allInvoices.forEach((invoice) => {
        counts[invoice.priority.code] = (counts[invoice.priority.code] || 0) + 1;
        amounts[invoice.priority.code] = (amounts[invoice.priority.code] || 0) + invoice.amount;
    });

    ['current', 'medium', 'high', 'urgent', 'review', 'baddebt'].forEach((key) => {
        const countEl = document.getElementById(`count-${key}`);
        const amountEl = document.getElementById(`amount-${key}`);

        if (countEl) countEl.textContent = Number(counts[key] || 0).toLocaleString();
        if (amountEl) amountEl.textContent = formatCurrencyShort(amounts[key] || 0);
    });

    const reviewCount = (counts.review || 0) + (counts.doubtful || 0);
    const reviewAmount = (amounts.review || 0) + (amounts.doubtful || 0);
    const reviewCountEl = document.getElementById('count-review');
    const reviewAmountEl = document.getElementById('amount-review');
    if (reviewCountEl) reviewCountEl.textContent = reviewCount.toLocaleString();
    if (reviewAmountEl) reviewAmountEl.textContent = formatCurrencyShort(reviewAmount);

    const totalPayables = allInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const activeAmount = allInvoices.filter((inv) => inv.age <= 120).reduce((sum, inv) => sum + inv.amount, 0);
    const collectibleCount = allInvoices.filter((inv) => inv.age <= 120).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(totalPayables);
    document.getElementById('total-active').textContent = formatCurrencyShort(activeAmount);
    document.getElementById('invoice-count').textContent = filteredInvoices.length.toLocaleString();
    document.getElementById('collectible-count').textContent = collectibleCount.toLocaleString();
    document.getElementById('dataMode').textContent = dataMode === 'all' ? '(All Data)' : '(Active 0-180 days)';

    const scheduledToday = getTodayScheduledInvoices();
    const scheduledTotal = scheduledToday.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('scheduled-count').textContent = scheduledToday.length.toLocaleString();
    document.getElementById('scheduled-amount').textContent = formatCurrencyShort(scheduledTotal);

    const staleUrgent = getUrgentNotCalledInvoices();
    const staleUrgentTotal = staleUrgent.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('stale-urgent-count').textContent = staleUrgent.length.toLocaleString();
    document.getElementById('stale-urgent-amount').textContent = formatCurrencyShort(staleUrgentTotal);
}

function getTodayScheduledInvoices() {
    const seen = new Set();
    const rows = [];

    todayFollowups.forEach((followup) => {
        const invoice = findInvoiceByKey(followup.invoiceKey);
        if (!invoice) return;

        const key = invoice.invoiceKey;
        if (seen.has(key)) return;
        seen.add(key);

        rows.push({
            ...invoice,
            scheduledFollowupDate: followup.followupDate,
            scheduledRemarks: followup.remarks,
            scheduledContactPerson: followup.contactPerson,
            scheduledStatus: followup.scheduleStatus
        });
    });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getUrgentNotCalledInvoices() {
    return allInvoices
        .filter((invoice) => {
            if (invoice.priority.code !== 'urgent') return false;
            if (invoice.lastContactDays === null) return true;
            return invoice.lastContactDays >= 20;
        })
        .sort((a, b) => {
            const daysA = a.lastContactDays === null ? 9999 : a.lastContactDays;
            const daysB = b.lastContactDays === null ? 9999 : b.lastContactDays;
            return daysB - daysA;
        });
}

function getPromiseDueTodayInvoices() {
    const rows = getTodayScheduledInvoices().filter((invoice) => {
        const remarks = String(invoice.scheduledRemarks || '');
        const status = Number(invoice.scheduleStatus || invoice.scheduledStatus || 0);
        if (status >= 5) return true;
        return PROMISE_REMARK_PATTERN.test(remarks);
    });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getHighValueDueThisWeekInvoices() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const weekEnd = new Date(now.getTime());
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);

    return allInvoices
        .filter((invoice) => {
            const dueDate = normalizeDate(invoice.dueDate);
            if (!dueDate) return false;
            if (dueDate < now || dueDate > weekEnd) return false;
            return invoice.amount >= 10000;
        })
        .sort((a, b) => b.amount - a.amount);
}

function hasMeaningfulContact(value) {
    const raw = String(value || '')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .trim()
        .toLowerCase();

    if (!raw) return false;
    if (raw === '-' || raw === 'none' || raw === 'n a' || raw === 'na') return false;
    return raw.length >= 2;
}

function getMissingContactInvoices() {
    return allInvoices
        .filter((invoice) => {
            if (invoice.history.length === 0) return true;
            return !invoice.history.some((entry) => hasMeaningfulContact(entry.contactPerson));
        })
        .sort((a, b) => {
            if (b.age !== a.age) return b.age - a.age;
            return b.amount - a.amount;
        });
}

function updateActionBrief() {
    const scheduled = getTodayScheduledInvoices();
    const promises = getPromiseDueTodayInvoices();
    const staleUrgent = getUrgentNotCalledInvoices();
    const highValueDue = getHighValueDueThisWeekInvoices();
    const missingContact = getMissingContactInvoices();

    const setText = (id, value) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.textContent = value;
    };

    setText('brief-scheduled-count', scheduled.length.toLocaleString());
    setText(
        'brief-scheduled-amount',
        `Amount: ${formatCurrencyShort(scheduled.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-promises-count', promises.length.toLocaleString());
    setText(
        'brief-promises-amount',
        `Amount: ${formatCurrencyShort(promises.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-urgent-stale-count', staleUrgent.length.toLocaleString());
    setText(
        'brief-urgent-stale-amount',
        `Amount: ${formatCurrencyShort(staleUrgent.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-high-value-count', highValueDue.length.toLocaleString());
    setText(
        'brief-high-value-amount',
        `Amount: ${formatCurrencyShort(highValueDue.reduce((sum, inv) => sum + inv.amount, 0))}`
    );

    setText('brief-missing-contact-count', missingContact.length.toLocaleString());
}

function renderTodayScheduleTable() {
    const container = document.getElementById('today-schedule-table');
    if (!container) return;

    const rows = getTodayScheduledInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No scheduled collection pick-up for today.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Inv Date</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map(
                        (inv) => `
                    <tr>
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(formatDate(inv.invoiceDate || inv.dueDate))}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td>${escapeHtml(inv.branch)}</td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                    </tr>
                `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderPromiseDueTable() {
    const container = document.getElementById('promise-due-table');
    if (!container) return;

    const rows = getPromiseDueTodayInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No promise-due account for today.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Age</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map(
                        (inv) => `
                    <tr>
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                    </tr>
                `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderUrgentStaleTable() {
    const container = document.getElementById('urgent-stale-table');
    if (!container) return;

    const rows = getUrgentNotCalledInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No urgent account pending call for 20+ days.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>Amount</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map((inv) => {
                        const lastCall =
                            inv.lastContactDays === null
                                ? 'Never called'
                                : `${inv.lastContactDays}d ago (${formatDate(inv.lastContactDate)})`;

                        return `
                            <tr>
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td>${escapeHtml(inv.branch)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderMissingContactTable() {
    const container = document.getElementById('missing-contact-table');
    if (!container) return;

    const rows = getMissingContactInvoices();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No missing-contact account in current queue.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Company</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .slice(0, 25)
                    .map((inv) => {
                        const lastCall =
                            inv.lastContactDays === null
                                ? 'No call yet'
                                : `${inv.lastContactDays}d ago (${formatDate(inv.lastContactDate)})`;

                        return `
                            <tr>
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderTable() {
    const container = document.getElementById('table-container');
    if (!container) return;

    if (filteredInvoices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No invoices found</h3>
                <p>Try changing filters or quick age buttons.</p>
            </div>
        `;

        const pagination = document.getElementById('pagination');
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIndex, endIndex);

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Invoice No</th>
                    <th>Inv Date</th>
                    <th>Company</th>
                    <th>Branch/Department</th>
                    <th>Amount</th>
                    <th>Age</th>
                    <th>Last Call</th>
                    <th>View</th>
                </tr>
            </thead>
            <tbody>
                ${pageInvoices
                    .map((invoice) => {
                        const lastCall =
                            invoice.lastContactDays === null
                                ? 'No call yet'
                                : `${invoice.lastContactDays}d ago (${formatDate(invoice.lastContactDate)})`;

                        return `
                            <tr class="${invoice.historyCount > 0 ? 'has-followup' : ''}" onclick="viewInvoiceDetail('${escapeHtml(invoice.invoiceKey)}')">
                                <td><strong>#${escapeHtml(invoice.invoiceNo)}</strong></td>
                                <td>${escapeHtml(formatDate(invoice.invoiceDate || invoice.dueDate))}</td>
                                <td>
                                    <div class="company-name">${escapeHtml(invoice.company)}</div>
                                </td>
                                <td><div class="branch-name">${escapeHtml(invoice.branch)}</div></td>
                                <td class="amount">${escapeHtml(formatCurrency(invoice.amount))}</td>
                                <td><span class="${escapeHtml(getAgeClass(invoice.age))}">${escapeHtml(String(invoice.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(
                                        invoice.invoiceKey
                                    )}')">View</button>
                                </td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;

    renderPagination();
}

function renderPagination() {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;

    const totalRecords = filteredInvoices.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

    if (totalRecords <= pageSize) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalRecords);

    document.getElementById('showing-start').textContent = String(start);
    document.getElementById('showing-end').textContent = String(end);
    document.getElementById('total-records').textContent = String(totalRecords);

    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function prevPage() {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderTable();
}

function nextPage() {
    const totalPages = Math.ceil(filteredInvoices.length / pageSize);
    if (currentPage >= totalPages) return;
    currentPage += 1;
    renderTable();
}

function viewInvoiceDetail(invoiceKey) {
    const invoice = findInvoiceByKey(invoiceKey);
    if (!invoice) {
        alert('Invoice details not found in current report data.');
        return;
    }

    const detailModal = document.getElementById('detailModal');
    const detailInvoiceNo = document.getElementById('detailInvoiceNo');
    const detailContent = document.getElementById('detailContent');

    if (!detailModal || !detailInvoiceNo || !detailContent) return;

    detailInvoiceNo.textContent = invoice.invoiceNo;

    const history = getHistoryForInvoice(invoice.invoiceNo, invoice.invoiceId);
    const lastHistory = history.length > 0 ? history[0] : null;

    const lastRemarks = lastHistory ? lastHistory.remarks : 'No conversation logged yet.';
    const lastFollowup = lastHistory && lastHistory.followupDate ? formatDate(lastHistory.followupDate) : '-';

    detailContent.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><label>Company</label><span>${escapeHtml(invoice.company)}</span></div>
            <div class="detail-item"><label>Branch/Department</label><span>${escapeHtml(invoice.branch)}</span></div>
            <div class="detail-item"><label>Invoice Date</label><span>${escapeHtml(formatDate(invoice.invoiceDate || invoice.dueDate))}</span></div>
            <div class="detail-item"><label>Due Date</label><span>${escapeHtml(formatDate(invoice.dueDate))}</span></div>
            <div class="detail-item"><label>Amount</label><span>${escapeHtml(formatCurrency(invoice.amount))}</span></div>
            <div class="detail-item"><label>Age</label><span>${escapeHtml(String(invoice.age))} days</span></div>
            <div class="detail-item"><label>Priority</label><span>${escapeHtml(invoice.priority.label)}</span></div>
            <div class="detail-item"><label>Next Follow-up</label><span>${escapeHtml(lastFollowup)}</span></div>
        </div>

        <div class="detail-last-remark">
            <h4>Last Conversation Remark</h4>
            <p>${escapeHtml(lastRemarks)}</p>
        </div>

        <div class="history-section">
            <h4>Follow-up History</h4>
            <div class="history-list">
                ${
                    history.length === 0
                        ? '<div class="no-history">No collection history found for this invoice.</div>'
                        : history
                              .map(
                                  (item) => `
                                <div class="history-item">
                                    <div class="history-date">Called: ${escapeHtml(formatDate(item.callDate))}</div>
                                    <div class="history-date">Contact: ${escapeHtml(item.contactPerson || '-')}</div>
                                    <div class="history-remarks">${escapeHtml(item.remarks)}</div>
                                    <div class="history-followup">Next Follow-up: ${escapeHtml(formatDate(item.followupDate))}</div>
                                </div>
                            `
                              )
                              .join('')
                }
            </div>
        </div>
    `;

    detailModal.classList.remove('hidden');
}

function exportToExcel() {
    if (filteredInvoices.length === 0) {
        alert('No records to export.');
        return;
    }

    const rows = [
        ['Invoice No', 'Invoice Date', 'Company', 'Branch/Department', 'Amount', 'Age (days)', 'Last Call', 'Last Remarks']
    ];

    filteredInvoices.forEach((invoice) => {
        const lastCall = invoice.lastContactDays === null ? 'No call yet' : `${invoice.lastContactDays}d ago`;
        rows.push([
            invoice.invoiceNo,
            formatDate(invoice.invoiceDate || invoice.dueDate),
            invoice.company,
            invoice.branch,
            Number(invoice.amount || 0).toFixed(2),
            String(invoice.age),
            lastCall,
            invoice.lastRemarks || ''
        ]);
    });

    const csv = rows
        .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collection-report-${toDateKey(new Date()) || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function setupModalEvents() {
    const followupModal = document.getElementById('followupModal');
    const detailModal = document.getElementById('detailModal');

    followupModal?.addEventListener('click', (event) => {
        if (event.target === followupModal) closeFollowupModal();
    });

    detailModal?.addEventListener('click', (event) => {
        if (event.target === detailModal) closeDetailModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFollowupModal();
            closeDetailModal();
            closeWelcomeModal();
        }
    });
}

function initQuickAgeButtons() {
    document.querySelectorAll('.quick-age-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const bucket = btn.dataset.bucket || 'all';
            setQuickAgeFilter(bucket);
        });
    });

    setQuickAgeFilter('all');
}

document.addEventListener('DOMContentLoaded', async () => {
    setupModalEvents();
    showRandomTip();
    initQuickAgeButtons();

    document.getElementById('search-input')?.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') applyFilters();
    });

    await loadActiveInvoices();
    if (lastLoadSucceeded) checkWelcomeModal();
});
