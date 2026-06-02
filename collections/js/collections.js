/**
 * MARGA Collections Module - Collection Report
 * - Collection dashboard + report lists in one module
 * - Robust loading with defensive fallbacks
 * - In-page invoice detail modal with follow-up history
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;
const COLLECTIONS_COMPARE_SNAPSHOT_KEY = 'marga_collections_compare_snapshots_v1';
const COLLECTIONS_LOAD_STARTED_AT = performance.now();

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;
let currentPriorityFilter = null;
let currentWorkQueueMode = 'all';
let currentPriorityWorklistView = 'list';
let quickAgeFilter = 'all';
let dataMode = 'active';
let todayFollowups = [];
let collectionHistory = {};
let collectionScheduleEntries = [];

// Lookup maps
let contractMap = {};
let contractDepMap = {};
let branchMap = {};
let companyMap = {};
let machineMap = {};
let paidInvoiceIds = new Set();
let machToBranchMap = {};
let invoiceIndexMap = new Map();
let lookupsLoaded = false;
let lastLoadSucceeded = false;
let currentDetailInvoice = null;
let isSavingConversation = false;
let paymentEntries = [];
let billingEntriesForDuration = [];
let billingMetaByInvoiceKey = new Map();
let collectorBillingRecords = [];
let collectorBillingRecordKeys = new Set();
let collectorCellMap = new Map();
let collectorCellsByRowId = new Map();
let collectionHistoryBulkLoaded = false;
let collectorViewportBound = false;
let analyticsDashboardVisible = false;
let collectorBillingMatrixCache = null;
let collectorBillingMatrixPromise = null;
let collectorDashboardData = null;
let collectorMatrixDragState = null;
let collectorScrollbarDragState = null;
let collectorDashboardRenderSeq = 0;
let collectorMatrixFilterFrame = 0;
let collectorInvoiceSearchSupplementTimer = null;
let collectorInvoiceSearchSupplementTerm = '';
let collectorInvoiceSearchSupplementPromise = null;
const collectorInvoiceSearchSupplementedTerms = new Set();
let collectorReturnBookmark = null;
let collectorMatrixTotalDetailMap = new Map();
let collectionWorkspaceLookupsLoaded = false;
let collectionWorkspaceLookupsPromise = null;
let collectionProfileByBranchId = new Map();
let collectionProfileOverrides = new Map();
let collectionStatusOptions = [];
let troubleLookupMap = new Map();
let employeeLookupMap = new Map();
let employeeRoleLookupMap = new Map();
let collectionPositionMap = new Map();
let collectionAssignableStaff = [];
let collectionActiveEmployeeEmails = new Set();
let collectionActiveEmployeeRosterPromise = null;
let serviceHistoryCache = new Map();
let collectionActivityCache = new Map();
let currentCollectorWorkspace = null;
let currentBranchEditorContext = null;
let isSavingCollectorFollowup = false;
let isSavingCollectorPayment = false;
let isSavingReceivePayment = false;
let isSavingCollector2307Status = false;
let isSavingCollectorProfileOverride = false;
let isSavingCollectorSchedule = false;
let isSavingBranchStatus = false;
let draftPaymentEntries = [];
const receivePaymentState = {
    selectedInvoices: [],
    selectedDraft: null,
    selectedDraftGroup: [],
    matchedDraftIds: new Set(),
    searchResults: []
};

const DEFAULT_COLLECTION_STATUSES = [
    { id: 1, label: 'Missing' },
    { id: 2, label: 'Consolidating' },
    { id: 3, label: 'For Approval' },
    { id: 4, label: 'Voucher Preparation' },
    { id: 5, label: 'For Signing' },
    { id: 6, label: 'Check for Pick-up' },
    { id: 7, label: 'On hold' },
    { id: 8, label: 'Others' }
];

const COLLECTION_LOCATION_OPTIONS = [
    { id: 1, key: 'end_user', label: 'End User' },
    { id: 2, key: 'accounting', label: 'Accounting' }
];

const COLLECTION_SCHEDULE_OPTIONS = [
    'Confirmed',
    'Promise to Pay',
    'Tentative',
    'Return cheque',
    'Acquire 2307',
    'Update Contact Number',
    'Service Issue / Payment Hold',
    'Shutdown Notice',
    'Deposit',
    'Start Up',
    'Refundable Deposit',
    'Pick up RFP'
];

const COLLECTION_TARGET_DEFAULTS = {
    minimumDailyTarget: 125000,
    goodDailyTarget: 150000,
    recoveryDailyTarget: 200000,
    weeklyTarget: 625000,
    weeklyTargetMin: 600000,
    weeklyTargetMax: 750000,
    monthlyTarget: 2500000,
    week1Cumulative: 625000,
    week2Cumulative: 1250000,
    week3Cumulative: 1875000,
    week4Cumulative: 2500000
};
const COLLECTION_ASSIGNMENT_ROLES = [
    {
        key: 'collection_head',
        label: 'Collection Head',
        description: 'View all collection accounts, assign/reassign collectors, monitor targets, and review performance.'
    },
    {
        key: 'priority_accounts',
        label: 'Collection - Priority Accounts',
        description: 'High-value, urgent, escalated, broken promise, and top collectible accounts.'
    },
    {
        key: 'regular_accounts',
        label: 'Collection - Regular Accounts',
        description: 'Regular follow-ups, newly received billings, for approval, and document concerns.'
    }
];
const COLLECTION_WORKFLOW_SETTINGS_DOC_ID = 'collections_workflow_settings_v1';
let collectionWorkflowSettings = {
    targets: { ...COLLECTION_TARGET_DEFAULTS },
    assignments: {},
    customerAssignments: {}
};
let collectionWorkflowSettingsLoaded = false;

const CONVERSATION_RESULT_OPTIONS = [
    'Successful Conversation',
    'No Answer',
    'Busy',
    'Unreachable',
    'No Reply to Message',
    'Left Message',
    'Wrong Contact',
    'Invalid Number',
    'Client Not Available',
    'For Callback'
];
const PROMISE_TO_PAY_OPTIONS = [
    'No Promise to Pay',
    'Promised to Pay',
    'For Approval Only',
    'For Payment Processing',
    'For Check Release',
    'For Bank Transfer',
    'Already Paid, For Verification',
    'Rescheduled Promise',
    'Broken Promise'
];
const PROMISE_DATE_REQUIRED_OPTIONS = new Set([
    'Promised to Pay',
    'For Payment Processing',
    'For Check Release',
    'For Bank Transfer',
    'Rescheduled Promise'
]);
const NEXT_FOLLOWUP_TIME_OPTIONS = [
    'Anytime',
    'Morning',
    'Afternoon',
    '9:00 AM',
    '10:00 AM',
    '11:00 AM',
    '1:00 PM',
    '2:00 PM',
    '3:00 PM',
    '4:00 PM'
];
const ISSUE_TYPE_OPTIONS = [
    'No Issue',
    'For Approval',
    'Waiting for Budget',
    'Waiting for Check Release',
    'Payment Processing',
    'Billing Not Received',
    'Needs SOA',
    'Needs Invoice Copy',
    'Needs Delivery Proof',
    'Needs Purchase Order',
    'Wrong Amount',
    'Meter Reading Concern',
    'Machine Issue',
    'Machine Not Working',
    'Print Quality Issue',
    'Toner Issue',
    'Service Concern',
    'Billing Dispute',
    'Payment Already Made',
    'Wrong Contact Person',
    'Authorized Person Not Available',
    'Client Requested Follow-up',
    'Other Concern'
];
const DOCUMENT_ISSUE_TYPES = new Set(['Billing Not Received', 'Needs SOA', 'Needs Invoice Copy', 'Needs Delivery Proof', 'Needs Purchase Order']);
const ISSUE_NOTE_SUGGESTIONS = [
    'Machine sira',
    'Needs service before payment',
    'Waiting approval from accounting',
    'Waiting approval from owner',
    'Client requested SOA',
    'Client requested invoice copy',
    'Client said billing was not received',
    'Client said payment already made',
    'Client disputed amount',
    'Client requested callback'
];
const COLLECTION_PRIORITY_CARD_DEFINITIONS = [
    { mode: 'promise_today', title: 'Promise-to-Pay Today', countLabel: 'accounts', amountLabel: 'projected' },
    { mode: 'broken_promise', title: 'Broken Promise-to-Pay', countLabel: 'accounts', amountLabel: 'at risk' },
    { mode: 'followup_today', title: 'Follow-up Scheduled Today', countLabel: 'accounts', amountLabel: 'potential' },
    { mode: 'needs_document', title: 'Needs Document', countLabel: 'accounts', amountLabel: 'affected' },
    { mode: 'billing_received_unfollowed', title: 'Billing Received Not Yet Followed Up', countLabel: 'accounts', amountLabel: 'receivable' },
    { mode: 'top_collectible', title: 'Top Collectible Accounts', countLabel: 'accounts', amountLabel: 'balance' },
    { mode: 'overdue_accounts', title: 'Overdue Accounts', countLabel: 'accounts', amountLabel: 'overdue' },
    { mode: 'for_approval', title: 'For Approval', countLabel: 'accounts', amountLabel: 'pending approval' }
];
const COLLECTION_ROLE_PRIORITY_MODES = {
    collection_head: COLLECTION_PRIORITY_CARD_DEFINITIONS.map((card) => card.mode),
    priority_accounts: ['promise_today', 'broken_promise', 'followup_today', 'top_collectible', 'overdue_accounts'],
    regular_accounts: ['billing_received_unfollowed', 'needs_document', 'for_approval']
};

const dailyTips = [
    'Focus on URGENT (91-120 days) first - highest recovery potential.',
    'Best call times: 9-11 AM and 2-4 PM. Avoid lunch hours.',
    'Always log call attempts to track payment patterns.',
    'Work URGENT -> HIGH -> MEDIUM for maximum efficiency.',
    'For 120+ day accounts, escalate for machine pull-out recommendation.'
];

const PROMISE_REMARK_PATTERN = /\b(ok na|for signing|check|pickup|ready|release|promise|ptp|payment|paid)\b/i;
const COLLECTOR_DASHBOARD_START = new Date(2025, 9, 1);
COLLECTOR_DASHBOARD_START.setHours(0, 0, 0, 0);
const COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION = 1;
let collectorMatrixSnapshotMeta = null;
let collectorMatrixSnapshotLoaded = false;
let collectorMatrixBuildInProgress = false;
let collectorMatrixSnapshotLoadSeq = 0;
let collectorMatrixSnapshotFetchPromise = null;
const COLLECTOR_MATRIX_SNAPSHOT_DB_NAME = 'marga_collections_matrix_snapshot_v1';
const COLLECTOR_MATRIX_SNAPSHOT_STORE = 'snapshots';
const COLLECTOR_MATRIX_SNAPSHOT_CACHE_ID = 'current';
const COLLECTOR_MATRIX_SNAPSHOT_FETCH_MS = 180000;
let collectionsFullScanAuthorized = false;
const MONTHLY_TREND_START = new Date(2025, 10, 1);
MONTHLY_TREND_START.setHours(0, 0, 0, 0);
const GROUPED_COLLECTION_COMPANIES = [
    {
        companyId: '72',
        parentName: 'China Bank Savings - Branches',
        groupName: 'CHINABANK'
    },
    {
        companyId: '553',
        parentName: 'Metalcast Corporation',
        groupName: 'METALCAST'
    }
];
const collectorExpandedGroupRows = new Set();
const COLLECTION_BILLING_FIELD_MASK = [
    'id',
    'invoice_id',
    'invoiceid',
    'invoiceno',
    'invoice_no',
    'invoice_num',
    'invoice_number',
    'contractmain_id',
    'month',
    'year',
    'due_date',
    'totalamount',
    'amount',
    'vatamount',
    'contact_number',
    'date_received',
    'receivedby',
    'isreceived',
    'status',
    'location',
    'remarks',
    'dateprinted',
    'date_printed',
    'invdate',
    'invoice_date',
    'datex',
    'company_id',
    'company_name',
    'branch_id',
    'branch_name',
    'account_name',
    'display_name',
    'machine_id',
    'machine_label',
    'machine_model',
    'printer_model',
    'serial_number',
    'category_id',
    'category_code',
    'billing_mode',
    'billing_lines_json',
    'billing_lines_count'
];
const COLLECTION_PAYMENT_FIELD_MASK = [
    'id',
    'invoice_id',
    'invoice_num',
    'client',
    'category',
    'invoice_amt',
    'invoice_date',
    'printed_or',
    'assigned',
    'payment_amt',
    'balance_amt',
    'date_deposit',
    'date_paid',
    'tax_date_paid',
    'ornum',
    'or_number',
    'payment_type',
    'payment_status',
    'tax_2307',
    'tax_status',
    'deduction_type',
    'deduction_amount',
    'other_deduction_amount',
    'tax_form_status',
    'tax_form_received_at',
    'tax_form_remarks',
    'checkpayment_id',
    'check_number',
    'check_amt',
    'check_date',
    'account_bank',
    'remarks',
    'iscancel',
    'cancelled_at',
    'cancelled_by',
    'source',
    'schedule_id',
    'schedule_doc_id',
    'field_confirmed_at',
    'field_confirmed_by'
];
const LEGACY_COLLECTION_SCHEDULE_FIELD_MASK = [
    'id',
    'source',
    'source_module',
    'request_origin',
    'collection_schedule_source',
    'collection_schedule_status',
    'schedule_status',
    'schedule_status_key',
    'purpose',
    'schedule_purpose',
    'purpose_id',
    'task_datetime',
    'original_sched',
    'commitment_date',
    'date_finished',
    'timestmp',
    'tmestamp',
    'created_at',
    'updated_at',
    'invoice_num',
    'invoice_id',
    'amt_collected',
    'company_id',
    'branch_id',
    'company_name',
    'branch_name',
    'customer',
    'branch',
    'tech_id',
    'assigned_to_id',
    'assigned_to',
    'field_billing_assigned_staff_id',
    'field_billing_assigned_staff_name',
    'assigned_role',
    'employee_id',
    'employee_name',
    'collector_name',
    'followed_up_by',
    'committed_by',
    'created_by',
    'created_by_id',
    'updated_by',
    'updated_by_id',
    'encoded_by',
    'encoded_by_id',
    'inserted_by',
    'inserted_by_id',
    'user_id',
    'userlog_id',
    'closedby',
    'collocutor',
    'caller',
    'phone_number',
    'pcname',
    'computer_name',
    'device_name',
    'ipadd',
    'remarks',
    'customer_request',
    'tl_remarks',
    'csr_remarks',
    'status',
    'iscancel',
    'iscancelled',
    'iscancelleddate'
];
const COLLECTION_HISTORY_FIELD_MASK = [
    'invoice_num',
    'invoice_id',
    'invoice_no',
    'invoiceno',
    'followup_datetime',
    'followup_date',
    'next_followup',
    'schedule_status',
    'status_id',
    'location_id',
    'location_label',
    'ischecksigned',
    'check_number',
    'payment_amount',
    'collection_id',
    'employee_id',
    'remarks',
    'contact_person',
    'contact_number',
    'conversation_result',
    'promise_to_pay',
    'promise_to_pay_amount',
    'promise_to_pay_date',
    'next_followup_date',
    'next_followup_time',
    'issue_type',
    'issue_notes',
    'collection_role_assignment',
    'customer_assignment_owner',
    'account_ref',
    'account_group_ref',
    'branch_id',
    'company_id',
    'contractmain_id',
    'machine_id',
    'month_key',
    'followed_up_by',
    'collector_name',
    'employee_name',
    'committed_by',
    'created_by',
    'updated_by',
    'encoded_by',
    'inserted_by',
    'pcname',
    'computer_name',
    'device_name',
    'ipadd',
    'timestamp',
    'call_datetime',
    'created_at',
    'updated_at',
    'timestmp',
    'tmestamp',
    'datex',
    'date_created'
];

function buildMonthColumns(startValue, endValue) {
    const monthColumns = [];
    let cursor = startOfMonth(startValue);
    const lastMonth = startOfMonth(endValue);

    while (cursor && lastMonth && cursor <= lastMonth) {
        monthColumns.push({
            key: getMonthKey(cursor),
            label: formatMonthLabelCompact(cursor),
            fullLabel: formatMonthLabel(cursor, true),
            monthStart: new Date(cursor.getTime()),
            isCurrentMonth: false
        });
        cursor = addMonths(cursor, 1);
    }

    return monthColumns;
}

function getValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.arrayValue !== undefined) return (field.arrayValue.values || []).map(getValue);
    if (field.mapValue !== undefined) {
        const mapped = {};
        Object.entries(field.mapValue.fields || {}).forEach(([key, value]) => {
            mapped[key] = getValue(value);
        });
        return mapped;
    }
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

function getActiveDatabaseBackend() {
    if (window.MargaBackendPreference?.read) return window.MargaBackendPreference.read();
    return 'firebase';
}

function getActiveDatabaseBackendLabel() {
    return 'Firebase';
}

function readCollectionsCompareSnapshots() {
    const fallback = window.__margaCollectionsCompareSnapshots || {};
    try {
        return JSON.parse(localStorage.getItem(COLLECTIONS_COMPARE_SNAPSHOT_KEY) || '{}') || fallback;
    } catch (err) {
        try {
            return JSON.parse(sessionStorage.getItem(COLLECTIONS_COMPARE_SNAPSHOT_KEY) || '{}') || fallback;
        } catch (sessionErr) {
            return fallback;
        }
    }
}

function writeCollectionsCompareSnapshots(snapshots) {
    window.__margaCollectionsCompareSnapshots = snapshots || {};
    const payload = JSON.stringify(snapshots || {});
    try {
        localStorage.setItem(COLLECTIONS_COMPARE_SNAPSHOT_KEY, payload);
        return true;
    } catch (err) {
        try {
            sessionStorage.setItem(COLLECTIONS_COMPARE_SNAPSHOT_KEY, payload);
            return true;
        } catch (sessionErr) {
            return false;
        }
    }
}

function formatSnapshotNumber(value) {
    const n = Number(value || 0);
    return n.toLocaleString('en-PH');
}

function formatSnapshotMoney(value) {
    return formatCurrency(Number(value || 0));
}

function formatSnapshotDelta(current, otherValue, otherLabel, money = false) {
    if (otherValue === null || otherValue === undefined || !otherLabel) return 'No comparison yet';
    const diff = Number(current || 0) - Number(otherValue || 0);
    if (Math.abs(diff) < 0.01) return 'Match';
    const sign = diff > 0 ? '+' : '';
    return `${sign}${money ? formatSnapshotMoney(diff) : formatSnapshotNumber(diff)} vs ${otherLabel}`;
}

function buildCollectionsCompareSnapshot() {
    const backend = getActiveDatabaseBackend();
    const totalUnpaid = allInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const activeAmount = allInvoices
        .filter((inv) => Number(inv.age || 0) <= 120)
        .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const durationBill = billingEntriesForDuration.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const durationCollections = paymentEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const customerRows = collectorDashboardData?.customerRows || [];
    const pendingCells = Number(collectorDashboardData?.pendingCellCount || 0);
    const monthColumns = collectorDashboardData?.monthColumns || [];
    const range = monthColumns.length
        ? `${monthColumns[0].fullLabel || monthColumns[0].label} to ${monthColumns[monthColumns.length - 1].fullLabel || monthColumns[monthColumns.length - 1].label}`
        : 'Preparing range';

    return {
        backend,
        backendLabel: 'Firebase',
        savedAt: new Date().toISOString(),
        loadSeconds: Math.max(0, (performance.now() - COLLECTIONS_LOAD_STARTED_AT) / 1000),
        filteredInvoices: filteredInvoices.length,
        allInvoices: allInvoices.length,
        totalUnpaid,
        activeAmount,
        durationBill,
        durationBillCount: billingEntriesForDuration.length,
        durationCollections,
        durationCollectionsCount: paymentEntries.length,
        customerRows: customerRows.length,
        pendingCells,
        range,
    };
}

function renderCollectionsCompareScorecard() {
    const grid = document.getElementById('collectionsCompareGrid');
    const subtitle = document.getElementById('collectionsCompareSubtitle');
    const saved = document.getElementById('collectionsCompareSaved');
    if (!grid) return;

    const current = buildCollectionsCompareSnapshot();
    const snapshots = readCollectionsCompareSnapshots();
    const currentSaved = snapshots[current.backend] || null;

    if (subtitle) {
        subtitle.textContent = `${current.backendLabel} render. Save this snapshot to compare against later Firebase runs.`;
    }

    const metrics = [
        ['Backend', current.backendLabel, `${current.loadSeconds.toFixed(1)}s since page load`],
        ['Filtered Invoices', formatSnapshotNumber(current.filteredInvoices), 'Firebase current render'],
        ['All Loaded Invoices', formatSnapshotNumber(current.allInvoices), 'Firebase current render'],
        ['Total Unpaid', formatSnapshotMoney(current.totalUnpaid), 'Firebase current render'],
        ['Customer Rows', formatSnapshotNumber(current.customerRows), 'Firebase current render'],
        ['Pending Cells', formatSnapshotNumber(current.pendingCells), 'Firebase current render'],
        ['Bill Records', formatSnapshotNumber(current.durationBillCount), `${formatSnapshotMoney(current.durationBill)} total`],
        ['Payment Records', formatSnapshotNumber(current.durationCollectionsCount), `${formatSnapshotMoney(current.durationCollections)} total`],
        ['Month Range', current.range, 'Collector matrix window'],
        ['Saved Snapshot', currentSaved ? new Date(currentSaved.savedAt).toLocaleString('en-PH') : 'Not saved', currentSaved ? `${currentSaved.backendLabel} baseline exists` : 'Click Save Snapshot']
    ];

    grid.innerHTML = metrics.map(([label, value, note]) => `
        <div class="collections-compare-metric">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(note)}</small>
        </div>
    `).join('');

    if (saved) {
        const firebaseSaved = snapshots.firebase ? `Firebase ${new Date(snapshots.firebase.savedAt).toLocaleString('en-PH')}` : 'Firebase not saved';
        saved.textContent = firebaseSaved;
    }
}

function saveCollectionsCompareSnapshot() {
    const snapshot = buildCollectionsCompareSnapshot();
    const snapshots = readCollectionsCompareSnapshots();
    snapshots[snapshot.backend] = snapshot;
    const persisted = writeCollectionsCompareSnapshots(snapshots);
    renderCollectionsCompareScorecard();
    const saved = document.getElementById('collectionsCompareSaved');
    if (saved) {
        const scope = persisted ? 'saved in this browser' : 'saved for this open tab only';
        saved.textContent = `Saved ${snapshot.backendLabel} snapshot at ${new Date(snapshot.savedAt).toLocaleString('en-PH')} (${scope}).`;
    }
}

function formatCurrencyShort(amount) {
    const value = Number(amount || 0);
    if (value >= 1000000) return '₱' + (value / 1000000).toFixed(2) + 'M';
    if (value >= 1000) return '₱' + (value / 1000).toFixed(0) + 'K';
    return '₱' + value.toFixed(0);
}

function formatPlainNumber(amount) {
    return Number(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function formatSignedCurrencyShort(amount) {
    const value = Number(amount || 0);
    if (value === 0) return '₱0';
    return `${value > 0 ? '+' : '-'}${formatCurrencyShort(Math.abs(value))}`;
}

function formatPercent(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return `${Number(value).toFixed(digits)}%`;
}

function getTodayInputValue(offsetDays = 0) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return toDateKey(d) || '';
}

function toTimestampString(date = new Date()) {
    const yyyyMmDd = toDateKey(date) || getTodayInputValue();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyyMmDd} ${hh}:${mm}:${ss}`;
}

function normalizePhone(value) {
    return String(value || '')
        .replace(/[^\d+]/g, '')
        .trim();
}

function formatRangeLabel(fromDate, toDate) {
    if (fromDate && toDate) return `${formatDate(fromDate)} to ${formatDate(toDate)}`;
    if (fromDate) return `${formatDate(fromDate)} onward`;
    if (toDate) return `Up to ${formatDate(toDate)}`;
    return 'All Dates';
}

function startOfMonth(value) {
    const d = normalizeDate(value);
    if (!d) return null;
    const normalized = new Date(d.getTime());
    normalized.setDate(1);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

function addMonths(value, months) {
    const d = startOfMonth(value);
    if (!d) return null;
    d.setMonth(d.getMonth() + months);
    return d;
}

function getMonthKey(value) {
    const d = startOfMonth(value);
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getBillingPeriodMonthKey(monthValue, yearValue, fallbackDate = null) {
    const monthNumber = monthNameToNumber(monthValue) || Number(monthValue || 0);
    const yearNumber = Number(yearValue || 0);
    if (monthNumber >= 1 && monthNumber <= 12 && yearNumber >= 2000) {
        return `${yearNumber}-${String(monthNumber).padStart(2, '0')}`;
    }
    return getMonthKey(fallbackDate);
}

function formatMonthLabel(value, longLabel = false) {
    const d = startOfMonth(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', {
        month: longLabel ? 'long' : 'short',
        year: 'numeric'
    });
}

function formatMonthLabelCompact(value) {
    const d = startOfMonth(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-PH', {
        month: 'short',
        year: '2-digit'
    });
}

function addDays(value, days) {
    const d = normalizeDate(value);
    if (!d) return null;
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

function isDateWithinRange(date, fromDate, toDate) {
    if (!date) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate) {
        const inclusiveEnd = new Date(toDate.getTime());
        inclusiveEnd.setHours(23, 59, 59, 999);
        if (date > inclusiveEnd) return false;
    }
    return true;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseMoneyInput(value) {
    const normalized = String(value || '').replace(/,/g, '').trim();
    if (!normalized) return 0;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : 0;
}

function formatInputDateTime(value) {
    const dateKey = String(value || '').trim();
    return dateKey ? `${dateKey} 00:00:00` : 'undefined 00:00:00';
}

function createWebDocId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactPersonName(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '-') return '';
    const parts = raw.split(/\s+/).filter(Boolean);
    return parts[0] || raw;
}

function getHistoryActor(entry) {
    if (!entry) return '';
    return compactPersonName(
        entry.committedBy
        || entry.followedUpBy
        || entry.collectorName
        || entry.employeeName
        || employeeLookupMap.get(normalizeLookupId(entry.employeeId))
        || entry.createdBy
        || entry.updatedBy
        || entry.encodedBy
        || entry.insertedBy
    );
}

function renderFollowupBadge(history) {
    const actor = getHistoryActor(history);
    if (!actor) return '';
    return `<span class="collector-followup-badge">Followed up by ${escapeHtml(actor)}</span>`;
}

function renderCellInvoicePaymentMeta(cell, options = {}) {
    const records = Array.isArray(cell?.records) ? cell.records : [];
    const paidOnly = Boolean(options.paidOnly);
    const relevantRecords = paidOnly
        ? records.filter((record) => (
            Number(record.collectedAmount || 0) > 0
            || Number(record.totalCollectedAmount || 0) > 0
            || (record.paymentOrNumbers || []).length
        ))
        : records;
    const invoiceNumbers = Array.from(new Set(
        relevantRecords
            .map((record) => String(record.invoiceNo || record.invoiceId || record.invoiceKey || '').trim())
            .filter(Boolean)
    ));
    const orNumbers = Array.from(new Set(
        relevantRecords
            .flatMap((record) => Array.isArray(record.paymentOrNumbers) ? record.paymentOrNumbers : [])
            .map((orNumber) => String(orNumber || '').trim())
            .filter(Boolean)
    ));
    const rows = [];

    if (invoiceNumbers.length) {
        rows.push(`<span>INV ${escapeHtml(invoiceNumbers[0])}${invoiceNumbers.length > 1 ? ` +${escapeHtml(String(invoiceNumbers.length - 1))}` : ''}</span>`);
    }
    if (orNumbers.length) {
        rows.push(`<span>OR ${escapeHtml(orNumbers[0])}${orNumbers.length > 1 ? ` +${escapeHtml(String(orNumbers.length - 1))}` : ''}</span>`);
    }

    return rows.length ? `<span class="collector-cell-meta">${rows.join('')}</span>` : '';
}

function renderBranchStatusBadge(branch, options = {}) {
    if (!branch || String(branch.id || '').startsWith('unlinked:')) return '';
    const inactive = Number(branch.inactive || 0) === 1;
    if (!inactive && options.showActive === false) return '';
    return `<span class="collector-branch-status ${inactive ? 'inactive' : 'active'}">${inactive ? 'Inactive' : 'Active'}</span>`;
}

function collectionEmployeeName(employee, fallbackId = '') {
    if (window.MargaUtils?.getEmployeeFullName) {
        return MargaUtils.getEmployeeFullName(employee, fallbackId);
    }
    return buildAddressText([
        `${employee?.firstname || ''} ${employee?.lastname || ''}`.trim(),
        employee?.name,
        employee?.nickname
    ]) || (fallbackId ? `Staff #${fallbackId}` : '');
}

function collectionEmployeeRole(employee) {
    if (window.MargaUtils?.getEmployeeDesignation) {
        return MargaUtils.getEmployeeDesignation(employee, collectionPositionMap);
    }
    const position = collectionPositionMap.get(normalizeLookupId(employee?.position_id));
    const label = [
        position?.position,
        position?.position_name,
        position?.name,
        employee?.position,
        employee?.position_name,
        employee?.position_label,
        employee?.marga_role,
        ...(Array.isArray(employee?.marga_roles) ? employee.marga_roles : [])
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
    const clue = label.toLowerCase();
    const positionId = Number(employee?.position_id || 0);
    if (positionId === 5 || clue.includes('technician') || clue.includes('tech')) return 'Technician';
    if (positionId === 9 || clue.includes('messenger') || clue.includes('driver')) return clue.includes('driver') ? 'Driver' : 'Messenger';
    if (clue.includes('production') || clue.includes('prod')) return 'Production';
    return label || 'Staff';
}

function isCollectionAssignableRole(role) {
    const roleKey = String(role || '').toLowerCase();
    return /collection|technician|messenger|driver|service|csr/i.test(roleKey);
}

function isCollectionFollowupRole(role) {
    const roleKey = String(role || '').toLowerCase();
    if (!roleKey) return false;
    return /collection|collector|csr|accounting|cashier|admin|office|billing/i.test(roleKey)
        && !/technician|messenger|driver|field|production|service/i.test(roleKey);
}

function isFieldPickupRole(role) {
    const roleKey = String(role || '').toLowerCase();
    if (!roleKey) return false;
    return /technician|messenger|driver|field|production|service/i.test(roleKey)
        && !/collection|collector|csr|accounting|cashier|admin|office|billing/i.test(roleKey);
}

function roleForEmployeeId(employeeId) {
    return employeeRoleLookupMap.get(normalizeLookupId(employeeId)) || '';
}

function roleForEmployeeName(name) {
    const normalizedName = String(name || '').trim().toLowerCase();
    if (!normalizedName) return '';
    const match = collectionAssignableStaff.find((staff) => String(staff.name || '').trim().toLowerCase() === normalizedName);
    return match?.role || '';
}

function normalizeCollectionEmail(value) {
    return String(value || '').trim().toLowerCase();
}

async function loadCollectionActiveEmployeeRoster() {
    if (collectionActiveEmployeeRosterPromise) return collectionActiveEmployeeRosterPromise;
    collectionActiveEmployeeRosterPromise = firestoreGetDocument('tbl_app_settings', 'active_employee_roster_v1')
        .then((doc) => {
            const row = doc ? documentFieldsToPlain(doc) : {};
            return new Set((row.active_emails || []).map(normalizeCollectionEmail).filter(Boolean));
        })
        .catch((error) => {
            console.warn('Unable to load collection active employee roster.', error);
            return new Set();
        });
    return collectionActiveEmployeeRosterPromise;
}

function isActiveCollectionEmployee(employee) {
    if (window.MargaUtils?.isOfficialActiveEmployee) return MargaUtils.isOfficialActiveEmployee(employee);
    if (!employee) return false;
    if (employee.active === false || employee.marga_active === false || employee.marga_account_active === false) return false;
    const hasActiveFlag = employee.active === true || employee.marga_active === true || employee.marga_account_active === true;
    const email = normalizeCollectionEmail(employee.email || employee.marga_login_email || employee.username);
    const inRoster = !collectionActiveEmployeeEmails.size || collectionActiveEmployeeEmails.has(email);
    return inRoster && hasActiveFlag && Number(employee.estatus ?? 1) > 0 && Number(employee.mstatus ?? 1) !== 0;
}

function collectionEmployeeRoleKey(employee) {
    if (window.MargaUtils?.getEmployeeRoleKey) return MargaUtils.getEmployeeRoleKey(employee, collectionPositionMap);
    return collectionEmployeeRole(employee).toLowerCase();
}

function rebuildCollectionAssignableStaff(employeeDocs = []) {
    const employeeRows = employeeDocs.map((doc) => documentFieldsToPlain(doc));
    employeeLookupMap = new Map();
    employeeRoleLookupMap = new Map();
    employeeRows.forEach((row) => {
        const id = normalizeLookupId(row.id);
        const name = collectionEmployeeName(row, id);
        const role = collectionEmployeeRole(row);
        if (id && name) employeeLookupMap.set(id, name);
        if (id) employeeRoleLookupMap.set(id, role);
    });

    if (window.MargaUtils?.filterEmployeeAssignmentOptions) {
        collectionAssignableStaff = MargaUtils.filterEmployeeAssignmentOptions(
            employeeRows.filter(isActiveCollectionEmployee),
            {
                positions: collectionPositionMap,
                includeRoleKeys: ['collection', 'technician', 'messenger', 'driver', 'service', 'production']
            }
        ).map((staff) => ({
            id: normalizeLookupId(staff.id),
            name: staff.name,
            role: staff.designation || staff.role || 'Staff'
        }));
    } else {
        collectionAssignableStaff = [];
        employeeRows.forEach((row) => {
            const id = normalizeLookupId(row.id);
            const name = collectionEmployeeName(row, id);
            const role = collectionEmployeeRole(row);
            const roleKey = collectionEmployeeRoleKey(row);
            if (id && name && isActiveCollectionEmployee(row) && isCollectionAssignableRole(roleKey)) {
                collectionAssignableStaff.push({ id, name, role });
            }
        });
    }

    collectionAssignableStaff.sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.role.localeCompare(b.role);
    });
}

function buildCollectionAssignableStaffOptions(selectedId = '') {
    const selected = normalizeLookupId(selectedId);
    const rows = collectionAssignableStaff;

    return [`<option value="">Unassigned</option>`]
        .concat(rows.map((staff) => `
            <option value="${escapeHtml(staff.id)}"${normalizeLookupId(staff.id) === selected ? ' selected' : ''}>
                ${escapeHtml(staff.name)}${staff.role ? ` - ${escapeHtml(staff.role)}` : ''}
            </option>
        `))
        .join('');
}

function getCollectionAssignee() {
    const id = normalizeLookupId(document.getElementById('collectorScheduleAssignee')?.value || '');
    const staff = collectionAssignableStaff.find((item) => normalizeLookupId(item.id) === id);
    return {
        id,
        name: staff?.name || employeeLookupMap.get(id) || '',
        role: staff?.role || ''
    };
}

function collectionAccountHistoryKeys(source = {}) {
    const monthKey = scheduleSlug(source.monthKey || source.label || '', '');
    const branchId = normalizeLookupId(source.branchId);
    const companyId = normalizeLookupId(source.companyId);
    const contractId = normalizeLookupId(source.contractmainId);
    const machineId = normalizeLookupId(source.machineId);
    const rowId = String(source.rowId || '').trim();
    const keys = [];

    if (branchId && !branchId.startsWith('unlinked:')) {
        keys.push(`account:branch:${branchId}`);
        if (monthKey) keys.push(`account:branch:${branchId}:${monthKey}`);
    }
    if (companyId) {
        keys.push(`account:company:${companyId}`);
        if (monthKey) keys.push(`account:company:${companyId}:${monthKey}`);
    }
    if (contractId) {
        keys.push(`account:contract:${contractId}`);
        if (monthKey) keys.push(`account:contract:${contractId}:${monthKey}`);
    }
    if (machineId) {
        keys.push(`account:machine:${machineId}`);
        if (monthKey) keys.push(`account:machine:${machineId}:${monthKey}`);
    }
    if (rowId) {
        keys.push(`account:row:${rowId}`);
        if (monthKey) keys.push(`account:row:${rowId}:${monthKey}`);
    }

    return Array.from(new Set(keys.filter(Boolean)));
}

function getCollectorSearchTerm() {
    return normalizeCollectorTextSearchValue(document.getElementById('collectorSearchInput')?.value || '');
}

function getCollectorInvoiceSearchTerm() {
    return String(document.getElementById('collectorInvoiceSearchInput')?.value || '').trim().toLowerCase();
}

function normalizeCollectorInvoiceSearchValue(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeCollectorTextSearchValue(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getCollectorSortValue() {
    return String(document.getElementById('collectorSortInput')?.value || 'rd').trim().toLowerCase();
}

function compareCollectorRows(left, right, sortValue) {
    const leftRd = Number(left.rd || 0) || Number.MAX_SAFE_INTEGER;
    const rightRd = Number(right.rd || 0) || Number.MAX_SAFE_INTEGER;
    const leftCustomer = left._collectorSortCustomer || normalizeCollectorTextSearchValue(left.customer);
    const rightCustomer = right._collectorSortCustomer || normalizeCollectorTextSearchValue(right.customer);
    const leftBranch = left._collectorSortBranch || normalizeCollectorTextSearchValue(left.branchName || left.accountLabel);
    const rightBranch = right._collectorSortBranch || normalizeCollectorTextSearchValue(right.branchName || right.accountLabel);
    const leftSerial = left._collectorSortSerial || normalizeCollectorTextSearchValue(left.serialNumber || left.machineLabel);
    const rightSerial = right._collectorSortSerial || normalizeCollectorTextSearchValue(right.serialNumber || right.machineLabel);

    if (sortValue === 'customer') {
        return leftCustomer.localeCompare(rightCustomer)
            || leftBranch.localeCompare(rightBranch)
            || leftRd - rightRd
            || leftSerial.localeCompare(rightSerial);
    }

    return leftRd - rightRd
        || leftCustomer.localeCompare(rightCustomer)
        || leftBranch.localeCompare(rightBranch)
        || leftSerial.localeCompare(rightSerial);
}

function getGroupedCollectionCompanyConfig(row) {
    const companyId = normalizeLookupId(row?.companyId);
    return GROUPED_COLLECTION_COMPANIES.find((config) => (
        companyId && companyId === normalizeLookupId(config.companyId)
    )) || null;
}

function collectorGroupRowId(config) {
    return `grouped-company:${normalizeLookupId(config.companyId)}`;
}

function isCollectorGroupExpanded(groupRowId) {
    return collectorExpandedGroupRows.has(String(groupRowId || '').trim());
}

function cloneCollectorRecordForGroupedParent(record, parentRow, childCell) {
    return {
        ...record,
        company: parentRow.customer,
        branch: record.branch || childCell.branchName || parentRow.branchName,
        accountLabel: parentRow.accountLabel,
        companyId: parentRow.companyId,
        branchId: record.branchId || childCell.branchId || '',
        machineId: record.machineId || childCell.machineId || '',
        contractmainId: record.contractmainId || childCell.contractmainId || '',
        serialNumber: record.serialNumber || childCell.serialNumber || '',
        modelName: record.modelName || childCell.modelName || '',
        machineLabel: record.machineLabel || childCell.machineLabel || ''
    };
}

function mergeCollectorChildCellIntoParent(parentCell, childCell, parentRow) {
    if (!childCell) return;

    parentCell.rdValues.push(...(childCell.rdValues || []));
    parentCell.missedReading = Boolean(parentCell.missedReading || childCell.missedReading);
    parentCell.catchUpBilling = Boolean(parentCell.catchUpBilling || childCell.catchUpBilling);
    parentCell.catchUpGapMonths = Math.max(Number(parentCell.catchUpGapMonths || 0), Number(childCell.catchUpGapMonths || 0));
    parentCell.pendingBilling = Boolean(parentCell.pendingBilling || childCell.pendingBilling);
    parentCell.pendingBillingProjectionTotal += Number(childCell.pendingBillingProjectionTotal || 0);
    parentCell.readingPagesTotal += Number(childCell.readingPagesTotal || 0);
    parentCell.readingTaskCount += Number(childCell.readingTaskCount || 0);
    if (parentCell.billedBasis === 'none' && childCell.billedBasis) parentCell.billedBasis = childCell.billedBasis;

    (childCell.records || []).forEach((record, index) => {
        const recordKey = String(record.invoiceKey || record.invoiceNo || record.invoiceId || `${childCell.id}:${index}`).trim();
        if (parentCell.recordMap.has(recordKey)) {
            const current = parentCell.recordMap.get(recordKey);
            (record.paymentOrNumbers || []).forEach((orNumber) => {
                if (orNumber) current.paymentOrNumbers.add(orNumber);
            });
            return;
        }
        upsertCollectorCellRecord(parentCell, recordKey, cloneCollectorRecordForGroupedParent(record, parentRow, childCell));
    });
}

function buildCollectorGroupedParentCell(parentRow, childRows, column) {
    const cell = ensureCollectorDisplayCell(collectorCellMap, parentRow, column);
    cell.branchName = parentRow.branchName;
    cell.accountLabel = parentRow.accountLabel;
    cell.isGroupedParentCell = true;
    cell.companyId = parentRow.companyId;
    cell.branchId = '';
    cell.machineId = '';
    cell.contractmainId = '';
    cell.serialNumber = '';
    cell.modelName = '';
    cell.machineLabel = parentRow.machineLabel;
    cell.rdValues = [];
    cell.billedTotal = 0;
    cell.displayBilledTotal = 0;
    cell.collectedTotal = 0;
    cell.outstandingBalance = 0;
    cell.billedBasis = 'none';
    cell.missedReading = false;
    cell.catchUpBilling = false;
    cell.catchUpGapMonths = 0;
    cell.pendingBilling = false;
    cell.pendingBillingProjectionTotal = 0;
    cell.readingPagesTotal = 0;
    cell.readingTaskCount = 0;
    cell.records = [];
    cell.recordMap = new Map();

    childRows.forEach((childRow) => {
        const childCell = collectorCellMap.get(childRow.months?.[column.key] || '');
        mergeCollectorChildCellIntoParent(cell, childCell, parentRow);
    });

    Array.from(cell.recordMap.values()).forEach((record) => {
        const billedAmount = Number(record.billedAmount || record.amount || 0);
        const collectedAmount = Number(record.collectedAmount || 0);
        const outstandingAmount = getCollectorRecordOutstandingBalance(record);
        cell.billedTotal += billedAmount;
        cell.displayBilledTotal += billedAmount;
        cell.collectedTotal += collectedAmount;
        if (outstandingAmount > 0) cell.outstandingBalance += outstandingAmount;
    });

    return cell;
}

function applyCollectorGroupedRows(rows, monthColumns) {
    const groupedRowsById = new Map();
    const passthroughRows = [];

    rows.forEach((row) => {
        const config = getGroupedCollectionCompanyConfig(row);
        if (!config) {
            passthroughRows.push(row);
            return;
        }

        const groupRowId = collectorGroupRowId(config);
        if (!groupedRowsById.has(groupRowId)) {
            groupedRowsById.set(groupRowId, {
                config,
                rows: []
            });
        }
        groupedRowsById.get(groupRowId).rows.push(row);
    });

    groupedRowsById.forEach((group) => {
        group.rows.sort((left, right) => compareCollectorRows(left, right, 'customer'));
        const firstRow = group.rows[0] || {};
        const groupRowId = collectorGroupRowId(group.config);
        const parentRow = {
            rowId: groupRowId,
            isGroupedParent: true,
            groupedCompanyId: normalizeLookupId(group.config.companyId),
            groupedCompanyName: group.config.parentName,
            branchCount: group.rows.length,
            customer: group.config.parentName,
            branchName: `${group.rows.length.toLocaleString()} branches / machines`,
            accountLabel: `${group.config.groupName || 'Grouped account'} one-invoice collection`,
            companyId: normalizeLookupId(group.config.companyId),
            branchId: '',
            serialNumber: '',
            modelName: '',
            machineLabel: 'Grouped branch reading account',
            machineId: '',
            contractmainId: '',
            branchInactive: 0,
            rd: firstRow.rd ?? null,
            latestHistory: null,
            months: {},
            totalCollected: 0
        };

        monthColumns.forEach((column) => {
            const hasChildCell = group.rows.some((childRow) => childRow.months?.[column.key]);
            if (!hasChildCell) return;
            const parentCell = buildCollectorGroupedParentCell(parentRow, group.rows, column);
            parentRow.months[column.key] = parentCell.id;
        });

        finalizeCollectorCellRecords(new Map(
            Object.values(parentRow.months)
                .map((cellId) => [cellId, collectorCellMap.get(cellId)])
                .filter(([, cell]) => Boolean(cell))
        ));

        monthColumns.forEach((column) => {
            const cell = collectorCellMap.get(parentRow.months[column.key] || '');
            if (!cell) return;
            parentRow.totalCollected += Number(cell.collectedTotal || 0);
            if (cell.latestHistory && (!parentRow.latestHistory || ((cell.latestHistory.callDate || new Date(0)).getTime() > (parentRow.latestHistory.callDate || new Date(0)).getTime()))) {
                parentRow.latestHistory = cell.latestHistory;
            }
        });

        passthroughRows.push(parentRow);
        group.rows.forEach((childRow) => {
            passthroughRows.push({
                ...childRow,
                isGroupedChild: true,
                groupedParentRowId: groupRowId,
                groupedParentName: group.config.parentName
            });
        });
    });

    return passthroughRows.sort((left, right) => {
        if (left.isGroupedParent && right.groupedParentRowId === left.rowId) return -1;
        if (right.isGroupedParent && left.groupedParentRowId === right.rowId) return 1;
        if (left.groupedParentRowId && left.groupedParentRowId === right.groupedParentRowId) {
            return compareCollectorRows(left, right, 'customer');
        }
        return compareCollectorRows(left, right, getCollectorSortValue());
    });
}

function prepareCollectorRows(rows) {
    const searchTerm = getCollectorSearchTerm();
    const invoiceSearchTerm = getCollectorInvoiceSearchTerm();
    const normalizedInvoiceSearch = normalizeCollectorInvoiceSearchValue(invoiceSearchTerm);
    const matrixPriorityRowIds = COLLECTION_PRIORITY_CARD_DEFINITIONS.some((card) => card.mode === currentWorkQueueMode)
        ? getMatrixPriorityRowIdSet(currentWorkQueueMode)
        : null;
    const filteredRows = rows
        .filter((row) => {
            if (!matrixPriorityRowIds) return true;
            return matrixPriorityRowIds.has(String(row.rowId || '').trim());
        })
        .filter((row) => {
            if (!searchTerm) return true;
            return (row._collectorAccountSearchText || '').includes(searchTerm);
        })
        .filter((row) => {
            if (!invoiceSearchTerm) return true;
            return collectorRowMatchesInvoiceSearch(row, invoiceSearchTerm, normalizedInvoiceSearch);
        });

    return [...filteredRows]
        .filter((row) => !row.isGroupedChild || isCollectorGroupExpanded(row.groupedParentRowId))
        .sort((left, right) => {
            if (left.isGroupedParent && right.groupedParentRowId === left.rowId) return -1;
            if (right.isGroupedParent && left.groupedParentRowId === right.rowId) return 1;
            if (left.groupedParentRowId && left.groupedParentRowId === right.groupedParentRowId) {
                return compareCollectorRows(left, right, 'customer');
            }
            return compareCollectorRows(left, right, getCollectorSortValue());
        });
}

function collectorRowMatchesInvoiceSearch(row, rawTerm, normalizedTerm) {
    const rawIndex = row?._collectorInvoiceSearchText || '';
    const normalizedIndex = row?._collectorInvoiceSearchNormalizedText || '';
    return rawIndex.includes(rawTerm) || (normalizedTerm && normalizedIndex.includes(normalizedTerm));
}

function ensureCollectorRowSearchIndexes(data) {
    const rows = Array.isArray(data?.customerRows) ? data.customerRows : [];
    rows.forEach((row) => {
        if (row?._collectorSearchIndexReady) return;

        row._collectorAccountSearchText = normalizeCollectorTextSearchValue([
            row.customer,
            row.branchName,
            row.accountLabel,
            row.serialNumber,
            row.machineLabel,
            row.machineId,
            row.contractmainId,
            row.companyId,
            row.branchId,
            row.rd,
            row.groupedParentName
        ].filter(Boolean).join(' '));
        row._collectorSortCustomer = normalizeCollectorTextSearchValue(row.customer);
        row._collectorSortBranch = normalizeCollectorTextSearchValue(row.branchName || row.accountLabel);
        row._collectorSortSerial = normalizeCollectorTextSearchValue(row.serialNumber || row.machineLabel);

        const invoiceValues = [];
        Object.values(row?.months || {}).forEach((cellId) => {
            const cell = collectorCellMap.get(cellId || '');
            (cell?.records || []).forEach((record) => {
                invoiceValues.push(
                    record.invoiceNo,
                    record.invoiceId,
                    record.invoiceKey
                );
            });
        });
        const invoiceSearchText = invoiceValues.filter(Boolean).join(' ');
        row._collectorInvoiceSearchText = normalizeCollectorTextSearchValue(invoiceSearchText);
        row._collectorInvoiceSearchNormalizedText = normalizeCollectorInvoiceSearchValue(invoiceSearchText);
        row._collectorSearchIndexReady = true;
    });
}

function ensureCollectorDisplayCell(cellMap, rowMeta, monthMeta) {
    const cellId = `${rowMeta.rowId}__${monthMeta.key}`;
    if (!cellMap.has(cellId)) {
        cellMap.set(cellId, {
            id: cellId,
            rowId: rowMeta.rowId,
            customer: rowMeta.customer,
            branchName: rowMeta.branchName,
            accountLabel: rowMeta.accountLabel,
            companyId: rowMeta.companyId || '',
            branchId: rowMeta.branchId || '',
            machineId: rowMeta.machineId,
            contractmainId: rowMeta.contractmainId,
            serialNumber: rowMeta.serialNumber,
            modelName: rowMeta.modelName || '',
            machineLabel: rowMeta.machineLabel,
            monthKey: monthMeta.key,
            label: monthMeta.fullLabel || monthMeta.label || monthMeta.key,
            rdValues: [],
            billedTotal: 0,
            displayBilledTotal: 0,
            collectedTotal: 0,
            outstandingBalance: 0,
            billedBasis: 'none',
            missedReading: false,
            catchUpBilling: false,
            catchUpGapMonths: 0,
            pendingBilling: false,
            pendingBillingProjectionTotal: 0,
            readingPagesTotal: 0,
            readingTaskCount: 0,
            records: [],
            recordMap: new Map()
        });
    }
    return cellMap.get(cellId);
}

function upsertCollectorCellRecord(cell, recordKey, payload) {
    const safeKey = String(recordKey || '').trim() || `record-${cell.recordMap.size + 1}`;
    if (!cell.recordMap.has(safeKey)) {
        cell.recordMap.set(safeKey, {
            invoiceId: payload.invoiceId || '',
            invoiceNo: payload.invoiceNo || payload.invoiceId || '',
            invoiceKey: payload.invoiceKey || safeKey,
            amount: Number(payload.amount || 0),
            billedAmount: Number(payload.billedAmount || payload.amount || 0),
            collectedAmount: Number(payload.collectedAmount || 0),
            totalCollectedAmount: Number(payload.totalCollectedAmount || payload.collectedAmount || 0),
            latestBalanceAmount: payload.latestBalanceAmount !== undefined && payload.latestBalanceAmount !== null ? Number(payload.latestBalanceAmount) : null,
            company: payload.company || cell.customer,
            branch: payload.branch || cell.branchName,
            accountLabel: payload.accountLabel || cell.accountLabel,
            companyId: payload.companyId || cell.companyId || '',
            branchId: payload.branchId || cell.branchId || '',
            machineId: payload.machineId || cell.machineId,
            contractmainId: payload.contractmainId || cell.contractmainId,
            serialNumber: payload.serialNumber || cell.serialNumber,
            modelName: payload.modelName || cell.modelName || '',
            machineLabel: payload.machineLabel || cell.machineLabel,
            invoiceDate: payload.invoiceDate || null,
            dueDate: payload.dueDate || null,
            dateReceived: payload.dateReceived || null,
            receivedBy: payload.receivedBy || '',
            billingStatus: payload.billingStatus ?? null,
            billingLocation: payload.billingLocation ?? null,
            billingRemarks: payload.billingRemarks ?? null,
            expectedCollectionDate: payload.expectedCollectionDate || null,
            firstPaymentDate: payload.firstPaymentDate || null,
            lastPaymentDate: payload.lastPaymentDate || null,
            paymentMonthKey: payload.paymentMonthKey || '',
            paymentOrNumbers: new Set(payload.paymentOrNumbers || []),
            rd: payload.rd ?? null
        });
    } else {
        const current = cell.recordMap.get(safeKey);
        current.amount = Number(current.amount || 0) || Number(payload.amount || 0);
        current.billedAmount = Number(current.billedAmount || 0) + Number(payload.billedAmount || 0);
        current.collectedAmount = Number(current.collectedAmount || 0) + Number(payload.collectedAmount || 0);
        current.totalCollectedAmount = Math.max(Number(current.totalCollectedAmount || 0), Number(payload.totalCollectedAmount || 0));
        if (payload.latestBalanceAmount !== undefined && payload.latestBalanceAmount !== null && Number.isFinite(Number(payload.latestBalanceAmount))) {
            current.latestBalanceAmount = Number(payload.latestBalanceAmount);
        }
        current.branch = current.branch || payload.branch || cell.branchName;
        current.accountLabel = current.accountLabel || payload.accountLabel || cell.accountLabel;
        current.companyId = current.companyId || payload.companyId || cell.companyId || '';
        current.branchId = current.branchId || payload.branchId || cell.branchId || '';
        current.serialNumber = current.serialNumber || payload.serialNumber || cell.serialNumber;
        current.modelName = current.modelName || payload.modelName || cell.modelName || '';
        current.machineLabel = current.machineLabel || payload.machineLabel || cell.machineLabel;
        current.rd = current.rd ?? payload.rd ?? null;
        if (!current.invoiceDate && payload.invoiceDate) current.invoiceDate = payload.invoiceDate;
        if (!current.dueDate && payload.dueDate) current.dueDate = payload.dueDate;
        if (!current.dateReceived && payload.dateReceived) current.dateReceived = payload.dateReceived;
        if (!current.receivedBy && payload.receivedBy) current.receivedBy = payload.receivedBy;
        if (!current.expectedCollectionDate && payload.expectedCollectionDate) current.expectedCollectionDate = payload.expectedCollectionDate;
        if (!current.firstPaymentDate || (payload.firstPaymentDate && payload.firstPaymentDate < current.firstPaymentDate)) {
            current.firstPaymentDate = payload.firstPaymentDate || current.firstPaymentDate;
        }
        if (!current.lastPaymentDate || (payload.lastPaymentDate && payload.lastPaymentDate > current.lastPaymentDate)) {
            current.lastPaymentDate = payload.lastPaymentDate || current.lastPaymentDate;
        }
        (payload.paymentOrNumbers || []).forEach((orNumber) => {
            if (orNumber) current.paymentOrNumbers.add(orNumber);
        });
    }

    return cell.recordMap.get(safeKey);
}

function finalizeCollectorCellRecords(cellMap) {
    cellMap.forEach((cell) => {
        cell.displayBilledTotal = Number(
            (Number(cell.displayBilledTotal || 0) > 0 ? cell.displayBilledTotal : cell.billedTotal) || 0
        );
        cell.records = Array.from(cell.recordMap.values())
            .map((record) => ({
                ...record,
                paymentOrNumbers: Array.from(record.paymentOrNumbers || []).sort()
            }))
            .sort((left, right) => {
                const leftTime = (left.lastPaymentDate || left.invoiceDate || left.dueDate || new Date(0)).getTime();
                const rightTime = (right.lastPaymentDate || right.invoiceDate || right.dueDate || new Date(0)).getTime();
                return rightTime - leftTime;
            });
        cell.latestHistory = latestHistoryForCell(cell);
        delete cell.recordMap;
    });
}

function getCollectorRecordOutstandingBalance(record) {
    if (!record) return 0;
    const billed = Number(record.billedAmount || record.amount || 0);
    if (billed <= 0) return 0;
    return Math.max(0, billed - Number(record.collectedAmount || 0));
}

function getCellOutstandingBalance(cell) {
    if (!cell) return 0;
    const records = Array.isArray(cell.records) ? cell.records : [];
    if (records.length) {
        return records.reduce((sum, record) => sum + getCollectorRecordOutstandingBalance(record), 0);
    }
    const explicit = Number(cell.outstandingBalance || 0);
    if (explicit > 0) return explicit;
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    const collected = Number(cell.collectedTotal || 0);
    if (collected > 0 && billedTarget > 0) return Math.max(0, billedTarget - collected);
    return billedTarget;
}

function getCollectorRecordKey(record) {
    return String(record?.invoiceKey || record?.invoiceNo || record?.invoiceId || '').trim();
}

function countCollectorCellInvoices(cell, predicate = null, fallbackCount = 1) {
    const records = Array.isArray(cell?.records) ? cell.records : [];
    const keys = new Set();
    records.forEach((record, index) => {
        if (predicate && !predicate(record)) return;
        keys.add(getCollectorRecordKey(record) || `${cell.id || 'cell'}:${index}`);
    });
    return keys.size || (cell ? fallbackCount : 0);
}

function makeCollectorMatrixDetail(row, column, cell, metricKey, amount, statusLabel) {
    const records = Array.isArray(cell?.records) ? cell.records : [];
    const record = metricKey === 'receivable'
        ? (records.find((item) => getCollectorRecordOutstandingBalance(item) > 0.01) || records[0] || {})
        : (records[0] || {});
    return {
        metricKey,
        monthKey: column.key,
        monthLabel: column.fullLabel || column.label || column.key,
        customer: row.customer || cell?.customer || '',
        branch: row.branchName || cell?.branchName || '',
        serial: displaySerialNumber(row.serialNumber || cell?.serialNumber),
        invoiceNo: record.invoiceNo || record.invoiceId || record.invoiceKey || '-',
        orNumber: Array.from(record.paymentOrNumbers || cell?.paymentOrNumbers || []).filter(Boolean).join(', '),
        date: record.lastPaymentDate || record.invoiceDate || record.dueDate || null,
        status: statusLabel,
        amount: Number(amount || 0),
        cellId: cell?.id || ''
    };
}

function addCollectorMatrixTotal(totalRows, metricKey, monthKey, amount, count = 1, detail = null) {
    const row = totalRows.find((item) => item.key === metricKey);
    if (!row) return;
    row.totals[monthKey] = Number(row.totals[monthKey] || 0) + Number(amount || 0);
    row.counts[monthKey] = Number(row.counts[monthKey] || 0) + Number(count || 0);
    if (detail) {
        if (!row.details[monthKey]) row.details[monthKey] = [];
        row.details[monthKey].push(detail);
    }
}

function getCollectorPendingBillingProjection(billingCell, billingRow) {
    if (!billingCell || !billingCell.pending) return 0;
    const readingAmount = Number(billingCell.reading_amount_total || 0);
    if (readingAmount > 0) return readingAmount;

    const displayAmount = Number(billingCell.display_amount_total || 0);
    const invoiceAmount = Number(billingCell.amount_total || 0);
    if (displayAmount > 0 && invoiceAmount <= 0) return displayAmount;

    const profile = billingRow?.billing_profile || {};
    const monthlyRate = Number(profile.monthly_rate || 0) || 0;
    const monthlyRate2 = Number(profile.monthly_rate2 || 0) || 0;
    const monthlyQuota = Number(profile.monthly_quota || 0) || 0;
    const monthlyQuota2 = Number(profile.monthly_quota2 || 0) || 0;
    const pageRate = Number(profile.page_rate || 0) || 0;
    const pageRate2 = Number(profile.page_rate2 || profile.page_rate_xtra || 0) || 0;
    const quotaAmount = monthlyQuota > 0 && pageRate > 0 ? monthlyQuota * pageRate : 0;
    const quotaAmount2 = monthlyQuota2 > 0 && pageRate2 > 0 ? monthlyQuota2 * pageRate2 : 0;
    return Math.max(0, monthlyRate + monthlyRate2, quotaAmount + quotaAmount2);
}

function getCollectorPaymentTotalDate(payment) {
    return normalizeDate(payment?.datePaid || payment?.taxDatePaid || payment?.paymentDate || payment?.dateDeposit);
}

function hasCollectorPaymentOfficialReceipt(payment) {
    return Boolean(String(payment?.orNumber || payment?.printedOr || '').trim());
}

function makeCollectorPaymentMonthDetail(payment, column, amount) {
    const invoiceKey = String(payment.invoiceId || payment.invoiceNo || '').trim();
    const meta = billingMetaByInvoiceKey.get(String(payment.invoiceId || '').trim())
        || billingMetaByInvoiceKey.get(String(payment.invoiceNo || '').trim())
        || {};
    return {
        metricKey: 'payment_month',
        monthKey: column.key,
        monthLabel: column.fullLabel || column.label || column.key,
        customer: payment.client || meta.company || 'Unknown',
        branch: meta.branch || payment.category || '',
        serial: '-',
        invoiceNo: payment.invoiceNo || payment.invoiceId || '-',
        orNumber: payment.orNumber || payment.printedOr || '-',
        date: getCollectorPaymentTotalDate(payment),
        status: payment.paymentStatus || payment.paymentType || 'Payment dated this month',
        amount: Number(amount || 0),
        cellId: invoiceKey
    };
}

function getInvoiceOutstandingFromPaymentSummary(invoiceAmount, paymentSummary) {
    const billedAmount = Number(invoiceAmount || 0);
    if (billedAmount <= 0) return 0;
    if (paymentSummary?.isSettled) return 0;

    const paidAgainstInvoice = Math.min(Number(paymentSummary?.amount || 0), billedAmount);
    return Math.max(0, billedAmount - paidAgainstInvoice);
}

function buildCollectorMatrixTotalRows(monthColumns, customerRows) {
    const totalRows = [
        { key: 'projected', label: 'Projected Monthly Billing', totals: {}, counts: {}, details: {} },
        { key: 'billed', label: 'Invoice/Billed Total', totals: {}, counts: {}, details: {} },
        { key: 'collected', label: 'Collected Against Billed', totals: {}, counts: {}, details: {} },
        { key: 'receivable', label: 'Unpaid Receivables', totals: {}, counts: {}, details: {} },
        { key: 'pending_billing', label: 'Pending Billing Projection', totals: {}, counts: {}, details: {} },
        { key: 'payment_month', label: 'Payments Dated This Month', totals: {}, counts: {}, details: {} }
    ];

    monthColumns.forEach((column) => {
        totalRows.forEach((row) => {
            row.totals[column.key] = 0;
            row.counts[column.key] = 0;
            row.details[column.key] = [];
        });
    });

    paymentEntries.forEach((payment) => {
        if (!hasCollectorPaymentOfficialReceipt(payment)) return;
        const paymentDate = getCollectorPaymentTotalDate(payment);
        const paymentMonthKey = getMonthKey(paymentDate);
        const column = monthColumns.find((item) => item.key === paymentMonthKey);
        if (!column) return;
        const amount = Number(payment.amount || 0);
        if (amount <= 0) return;
        addCollectorMatrixTotal(
            totalRows,
            'payment_month',
            column.key,
            amount,
            1,
            makeCollectorPaymentMonthDetail(payment, column, amount)
        );
    });

    customerRows
        .filter((row) => !row.isGroupedChild)
        .forEach((row) => {
            monthColumns.forEach((column) => {
                const cell = collectorCellMap.get(row.months?.[column.key] || '');
                if (!cell) return;
                const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                const outstandingBalance = getCellOutstandingBalance(cell);
                const pendingProjection = cell.pendingBilling ? Number(cell.pendingBillingProjectionTotal || 0) : 0;
                const hasPendingProjection = cell.pendingBilling && pendingProjection > 0;
                const invoiceCount = row.isGroupedParent
                    ? (billedTarget > 0 ? 1 : 0)
                    : countCollectorCellInvoices(cell, (record) => Number(record.billedAmount || record.amount || 0) > 0, 0);
                const pendingCount = row.isGroupedParent
                    ? (hasPendingProjection ? 1 : 0)
                    : (hasPendingProjection ? 1 : 0);

                if (billedTarget > 0 || hasPendingProjection) {
                    const projectedAmount = billedTarget + pendingProjection;
                    const projectedCount = invoiceCount + pendingCount;
                    addCollectorMatrixTotal(
                        totalRows,
                        'projected',
                        column.key,
                        projectedAmount,
                        projectedCount || 1,
                        makeCollectorMatrixDetail(row, column, cell, 'projected', projectedAmount, cell.pendingBilling ? 'Projected: billed + pending billing' : 'Projected: billed')
                    );
                }

                if (billedTarget > 0) {
                    addCollectorMatrixTotal(
                        totalRows,
                        'billed',
                        column.key,
                        billedTarget,
                        invoiceCount || 1,
                        makeCollectorMatrixDetail(row, column, cell, 'billed', billedTarget, 'Invoice billed')
                    );
                }

                if (billedTarget > 0 && Number(cell.collectedTotal || 0) > 0) {
                    addCollectorMatrixTotal(
                        totalRows,
                        'collected',
                        column.key,
                        Number(cell.collectedTotal || 0),
                        row.isGroupedParent
                            ? 1
                            : countCollectorCellInvoices(cell, (record) => Number(record.collectedAmount || 0) > 0, 0),
                        makeCollectorMatrixDetail(row, column, cell, 'collected', Number(cell.collectedTotal || 0), 'Collected against billed invoice')
                    );
                }

                if (billedTarget > 0 && outstandingBalance > 0.01) {
                    addCollectorMatrixTotal(
                        totalRows,
                        'receivable',
                        column.key,
                        outstandingBalance,
                        row.isGroupedParent
                            ? 1
                            : countCollectorCellInvoices(cell, (record) => {
                                return getCollectorRecordOutstandingBalance(record) > 0.01;
                            }),
                        makeCollectorMatrixDetail(row, column, cell, 'receivable', outstandingBalance, 'Unpaid balance')
                    );
                }

                if (hasPendingProjection) {
                    addCollectorMatrixTotal(
                        totalRows,
                        'pending_billing',
                        column.key,
                        pendingProjection,
                        1,
                        makeCollectorMatrixDetail(row, column, cell, 'pending_billing', pendingProjection, 'Pending billing')
                    );
                }
            });
        });

    return totalRows;
}

async function loadCollectorBillingMatrix(windowStart, endMonthDate) {
    const startKey = getMonthKey(windowStart);
    const endKey = getMonthKey(endMonthDate);
    const cacheKey = `${startKey}:${endKey}`;

    if (collectorBillingMatrixCache?.cacheKey === cacheKey) return collectorBillingMatrixCache;
    if (collectorBillingMatrixPromise?.cacheKey === cacheKey) return collectorBillingMatrixPromise.promise;

    const params = new URLSearchParams();
    params.set('start_year', String(windowStart.getFullYear()));
    params.set('start_month', String(windowStart.getMonth() + 1));
    params.set('end_year', String(endMonthDate.getFullYear()));
    params.set('end_month', String(endMonthDate.getMonth() + 1));
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    params.set('row_limit', '5000');
    params.set('latest_limit', '100');
    params.set('max_billing_pages', '10');
    params.set('max_schedule_pages', '10');
    params.set('cell_detail_scope', 'all');
    params.set('response_mode', 'collection');

    const request = fetch(`/.netlify/functions/openclaw-billing-cohort?${params.toString()}`)
        .then(async (response) => {
            if (!response.ok) throw new Error(`Billing cohort request failed: ${response.status}`);
            const payload = await response.json();
            const rows = Array.isArray(payload?.month_matrix?.rows) ? payload.month_matrix.rows : [];
            const rowMap = new Map();
            rows.forEach((row) => {
                if (!row || row.is_summary_row) return;
                const rowId = String(row.row_id || '').trim();
                if (rowId) rowMap.set(rowId, row);
                const contractId = String(row.contractmain_id || '').trim();
                if (contractId) rowMap.set(`contract:${contractId}`, row);
                const machineId = String(row.machine_id || '').trim();
                if (machineId && !contractId) rowMap.set(`machine:${machineId}`, row);
            });
            const result = { cacheKey, payload, rowMap };
            collectorBillingMatrixCache = result;
            return result;
        })
        .catch((error) => {
            console.warn('Unable to load billing cohort for collections:', error);
            const result = { cacheKey, payload: null, rowMap: new Map() };
            collectorBillingMatrixCache = result;
            return result;
        })
        .finally(() => {
            if (collectorBillingMatrixPromise?.cacheKey === cacheKey) collectorBillingMatrixPromise = null;
        });

    collectorBillingMatrixPromise = { cacheKey, promise: request };
    return request;
}

function updateCollectorViewportRange() {
    const chips = [
        document.getElementById('collector-visible-range'),
        document.getElementById('collector-visible-range-inline')
    ].filter(Boolean);
    const container = document.getElementById('collector-matrix-table');
    if (!chips.length || !container) return;

    const monthHeaders = Array.from(container.querySelectorAll('thead th[data-month-key]'));
    if (!monthHeaders.length) {
        chips.forEach((chip) => { chip.textContent = 'Viewing current months'; });
        return;
    }

    const containerRect = container.getBoundingClientRect();
    const stickyOffset = Array.from(container.querySelectorAll('thead th.sticky-col'))
        .filter((header) => window.getComputedStyle(header).position === 'sticky')
        .reduce((maxOffset, header) => {
            const rect = header.getBoundingClientRect();
            return Math.max(maxOffset, rect.right - containerRect.left);
        }, 0);
    const visibleLeft = containerRect.left + Math.max(0, stickyOffset);
    const visibleRight = containerRect.right;

    const visibleHeaders = monthHeaders.filter((header) => {
        const rect = header.getBoundingClientRect();
        return rect.right > visibleLeft && rect.left < visibleRight;
    });

    const firstVisible = visibleHeaders[0] || monthHeaders[0];
    const lastVisible = visibleHeaders[visibleHeaders.length - 1] || monthHeaders[monthHeaders.length - 1];
    const firstLabel = firstVisible?.dataset.monthFullLabel || firstVisible?.dataset.monthLabel || '';
    const lastLabel = lastVisible?.dataset.monthFullLabel || lastVisible?.dataset.monthLabel || '';
    const text = firstLabel && lastLabel && firstLabel !== lastLabel
        ? `Viewing ${firstLabel} to ${lastLabel}`
        : `Viewing ${firstLabel || lastLabel || 'current month'}`;
    chips.forEach((chip) => { chip.textContent = text; });
}

function captureCollectorReturnBookmark(cellId = '') {
    const container = document.getElementById('collector-matrix-table');
    collectorReturnBookmark = {
        cellId: String(cellId || '').trim(),
        windowScrollY: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
        matrixScrollLeft: container?.scrollLeft || 0,
        matrixScrollTop: container?.scrollTop || 0,
        createdAt: Date.now()
    };
}

function findCollectorBookmarkedCell(cellId) {
    const key = String(cellId || '').trim();
    if (!key) return null;
    return Array.from(document.querySelectorAll('[data-collector-cell-id]'))
        .find((node) => node.dataset.collectorCellId === key) || null;
}

function applyCollectorReturnBookmark(bookmark) {
    if (!bookmark) return;
    fitCollectorMatrixViewport();
    const container = document.getElementById('collector-matrix-table');
    if (container) {
        container.scrollLeft = Number(bookmark.matrixScrollLeft || 0);
        container.scrollTop = Number(bookmark.matrixScrollTop || 0);
    }

    const cellNode = findCollectorBookmarkedCell(bookmark.cellId);
    const rowNode = cellNode?.closest('tr');
    if (rowNode) {
        rowNode.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (container) {
            container.scrollLeft = Number(bookmark.matrixScrollLeft || 0);
            container.scrollTop = Number(bookmark.matrixScrollTop || 0);
        }
    }

    window.scrollTo({
        top: Number(bookmark.windowScrollY || 0),
        left: 0,
        behavior: 'auto'
    });
    updateCollectorViewportRange();
    updateCollectorHorizontalScrollbar();
}

function restoreCollectorReturnBookmark(options = {}) {
    const bookmark = collectorReturnBookmark;
    if (!bookmark) return;
    const delays = Array.isArray(options.delays) ? options.delays : [0, 80, 240, 520, 940];
    delays.forEach((delay) => {
        window.setTimeout(() => {
            if (collectorReturnBookmark === bookmark) applyCollectorReturnBookmark(bookmark);
        }, delay);
    });
    if (options.clear) {
        window.setTimeout(() => {
            if (collectorReturnBookmark === bookmark) collectorReturnBookmark = null;
        }, Math.max(...delays, 0) + 60);
    }
}

function getCollectorScrollbarParts() {
    return {
        shell: document.getElementById('collectorHorizontalScrollbar'),
        track: document.getElementById('collectorHorizontalTrack'),
        thumb: document.getElementById('collectorHorizontalThumb')
    };
}

function updateCollectorHorizontalScrollbar() {
    const container = document.getElementById('collector-matrix-table');
    const { shell, track, thumb } = getCollectorScrollbarParts();
    if (!container || !shell || !track || !thumb) return;

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    if (maxScroll <= 2) {
        shell.classList.add('is-disabled');
        track.setAttribute('aria-valuenow', '0');
        thumb.style.width = '100%';
        thumb.style.transform = 'translateX(0px)';
        return;
    }

    shell.classList.remove('is-disabled');
    const trackWidth = track.clientWidth || 1;
    const thumbWidth = Math.max(44, Math.round(trackWidth * (container.clientWidth / container.scrollWidth)));
    const thumbTravel = Math.max(1, trackWidth - thumbWidth);
    const thumbLeft = Math.round((container.scrollLeft / maxScroll) * thumbTravel);
    const percent = Math.round((container.scrollLeft / maxScroll) * 100);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${thumbLeft}px)`;
    track.setAttribute('aria-valuenow', String(percent));
}

function fitCollectorMatrixViewport() {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rightGutter = window.innerWidth <= 900 ? 12 : 28;
    const availableWidth = Math.max(320, Math.floor(window.innerWidth - rect.left - rightGutter));
    container.style.width = `${availableWidth}px`;
    container.style.maxWidth = `${availableWidth}px`;
}

function setCollectorScrollFromTrack(clientX) {
    const container = document.getElementById('collector-matrix-table');
    const { track, thumb } = getCollectorScrollbarParts();
    if (!container || !track || !thumb) return;

    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const rect = track.getBoundingClientRect();
    const thumbWidth = thumb.offsetWidth || 44;
    const thumbTravel = Math.max(1, rect.width - thumbWidth);
    const rawLeft = clientX - rect.left - thumbWidth / 2;
    const clampedLeft = Math.max(0, Math.min(thumbTravel, rawLeft));
    container.scrollLeft = Math.round((clampedLeft / thumbTravel) * maxScroll);
    updateCollectorViewportRange();
    updateCollectorHorizontalScrollbar();
}

function scrollCollectorMatrix(direction) {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    fitCollectorMatrixViewport();
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const delta = Math.max(220, Math.round(container.clientWidth * 0.72)) * direction;
    const nextLeft = Math.max(0, Math.min(maxScroll, container.scrollLeft + delta));
    container.scrollTo({ left: nextLeft, behavior: 'smooth' });
    window.setTimeout(updateCollectorViewportRange, 220);
    window.setTimeout(updateCollectorHorizontalScrollbar, 220);
}

function getCollectorLatestMonthKey(data) {
    const columns = Array.isArray(data?.monthColumns) ? data.monthColumns : [];
    const current = columns.find((column) => column.isCurrentMonth);
    return current?.key || columns[columns.length - 1]?.key || '';
}

function scrollCollectorMatrixToMonth(monthKey, options = {}) {
    const container = document.getElementById('collector-matrix-table');
    if (!container || !monthKey) return;
    fitCollectorMatrixViewport();
    const header = Array.from(container.querySelectorAll('thead th[data-month-key]'))
        .find((node) => node.dataset.monthKey === monthKey);
    if (!header) return;

    const monthWidth = header.offsetWidth || 110;
    const leadInMonths = Number(options.leadInMonths ?? 2);
    const targetLeft = Math.max(0, header.offsetLeft - (monthWidth * leadInMonths));
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const nextLeft = Math.min(targetLeft, maxScroll);

    if (options.behavior === 'auto') {
        container.scrollLeft = nextLeft;
    } else {
        container.scrollTo({
            left: nextLeft,
            behavior: options.behavior || 'smooth'
        });
    }

    window.setTimeout(updateCollectorViewportRange, options.behavior === 'auto' ? 0 : 220);
    window.setTimeout(updateCollectorHorizontalScrollbar, options.behavior === 'auto' ? 0 : 220);
}

function scrollCollectorMatrixToLatest(options = {}) {
    const data = options.data || collectorDashboardData;
    scrollCollectorMatrixToMonth(getCollectorLatestMonthKey(data), options);
}

function scheduleCollectorLatestScroll(data) {
    if (collectorReturnBookmark) {
        restoreCollectorReturnBookmark({ delays: [0, 80, 240, 520, 940] });
        return;
    }
    [0, 80, 220, 500, 900].forEach((delay) => {
        window.setTimeout(() => {
            scrollCollectorMatrixToLatest({ data, behavior: 'auto' });
        }, delay);
    });
}

function bindCollectorMatrixViewport() {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;

    if (!collectorViewportBound) {
        container.addEventListener('scroll', () => {
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        }, { passive: true });
        document.getElementById('collectorScrollLeft')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollRight')?.addEventListener('click', () => scrollCollectorMatrix(1));
        document.getElementById('collectorScrollLeftInline')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollRightInline')?.addEventListener('click', () => scrollCollectorMatrix(1));
        document.getElementById('collectorScrollLatest')?.addEventListener('click', () => scrollCollectorMatrixToLatest({ behavior: 'smooth' }));
        document.getElementById('collectorScrollLatestInline')?.addEventListener('click', () => scrollCollectorMatrixToLatest({ behavior: 'smooth' }));
        document.getElementById('collectorScrollbarLeft')?.addEventListener('click', () => scrollCollectorMatrix(-1));
        document.getElementById('collectorScrollbarRight')?.addEventListener('click', () => scrollCollectorMatrix(1));

        container.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('button, a, input, select, textarea')) return;
            collectorMatrixDragState = {
                startX: event.clientX,
                startScrollLeft: container.scrollLeft
            };
            container.classList.add('dragging');
        });

        window.addEventListener('mousemove', (event) => {
            if (!collectorMatrixDragState) return;
            const delta = event.clientX - collectorMatrixDragState.startX;
            container.scrollLeft = collectorMatrixDragState.startScrollLeft - delta;
            updateCollectorHorizontalScrollbar();
        });

        window.addEventListener('mouseup', () => {
            if (!collectorMatrixDragState) return;
            collectorMatrixDragState = null;
            container.classList.remove('dragging');
            updateCollectorViewportRange();
        });

        container.addEventListener('mouseleave', () => {
            if (!collectorMatrixDragState) return;
            collectorMatrixDragState = null;
            container.classList.remove('dragging');
        });

        const { track, thumb } = getCollectorScrollbarParts();
        track?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            collectorScrollbarDragState = true;
            thumb?.classList.add('dragging');
            track.setPointerCapture?.(event.pointerId);
            setCollectorScrollFromTrack(event.clientX);
        });

        track?.addEventListener('pointermove', (event) => {
            if (!collectorScrollbarDragState) return;
            event.preventDefault();
            setCollectorScrollFromTrack(event.clientX);
        });

        const stopScrollbarDrag = (event) => {
            if (!collectorScrollbarDragState) return;
            collectorScrollbarDragState = null;
            thumb?.classList.remove('dragging');
            if (event?.pointerId !== undefined) track?.releasePointerCapture?.(event.pointerId);
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        };

        track?.addEventListener('pointerup', stopScrollbarDrag);
        track?.addEventListener('pointercancel', stopScrollbarDrag);
        track?.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                scrollCollectorMatrix(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                scrollCollectorMatrix(1);
            }
        });

        window.addEventListener('resize', () => {
            fitCollectorMatrixViewport();
            updateCollectorViewportRange();
            updateCollectorHorizontalScrollbar();
        });

        collectorViewportBound = true;
    }

    fitCollectorMatrixViewport();
    updateCollectorViewportRange();
    updateCollectorHorizontalScrollbar();
}

function getMargabaseAdminUrl(path) {
    const baseUrl = String(BASE_URL || window.MARGABASE_CONFIG?.baseUrl || '').trim();
    if (baseUrl.startsWith('/margabase-api/')) return `/margabase-api${path}`;
    if (baseUrl.includes('/v1/projects/')) {
        const origin = new URL(baseUrl, window.location.href).origin;
        return `${origin}${path}`;
    }
    return `http://127.0.0.1:8787${path}`;
}

function collectorSnapshotJsonReplacer(_key, value) {
    if (value instanceof Date) return { __margaDate: value.toISOString() };
    if (value instanceof Set) return { __margaSet: Array.from(value) };
    return value;
}

function collectorSnapshotJsonReviver(_key, value) {
    if (value && typeof value === 'object') {
        if (value.__margaDate) return new Date(value.__margaDate);
        if (value.__margaSet) return new Set(value.__margaSet);
    }
    return value;
}

function packCollectorDashboardSnapshot(data) {
    const cells = [];
    collectorCellMap.forEach((cell) => {
        cells.push({
            ...cell,
            records: (cell.records || []).map((record) => ({
                ...record,
                paymentOrNumbers: Array.from(record.paymentOrNumbers || [])
            }))
        });
    });
    return JSON.parse(JSON.stringify({
        schemaVersion: COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION,
        dashboard: data,
        cells
    }, collectorSnapshotJsonReplacer));
}

function unpackCollectorDashboardSnapshot(payload) {
    const parsed = typeof payload === 'string'
        ? JSON.parse(payload, collectorSnapshotJsonReviver)
        : JSON.parse(JSON.stringify(payload), collectorSnapshotJsonReviver);
    if (!parsed?.dashboard) return null;
    collectorCellMap = new Map();
    (parsed.cells || []).forEach((cell) => {
        const records = (cell.records || []).map((record) => ({
            ...record,
            paymentOrNumbers: new Set(record.paymentOrNumbers || [])
        }));
        collectorCellMap.set(cell.id, { ...cell, records });
    });
    rebuildCollectorCellsByRowId();
    return ensureCollectorDashboardDerivedFields(parsed.dashboard);
}

function rebuildCollectorCellsByRowId() {
    collectorCellsByRowId = new Map();
    collectorCellMap.forEach((cell) => {
        const rowId = String(cell.rowId || '').trim();
        if (!rowId) return;
        if (!collectorCellsByRowId.has(rowId)) collectorCellsByRowId.set(rowId, []);
        collectorCellsByRowId.get(rowId).push(cell);
    });
}

function buildCollectorAccountSetByMonth(customerRows, summaryMonthColumns) {
    const accountSetByMonth = new Map();
    (summaryMonthColumns || []).forEach((column) => {
        accountSetByMonth.set(column.key, new Set());
    });

    (customerRows || [])
        .filter((row) => !row.isGroupedChild)
        .forEach((row) => {
            (summaryMonthColumns || []).forEach((column) => {
                const cell = collectorCellMap.get(String(row.months?.[column.key] || '').trim());
                if (!cell) return;
                const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                if (billedTarget > 0 || cell.missedReading || cell.pendingBilling || cell.collectedTotal > 0) {
                    accountSetByMonth.get(column.key).add(row.rowId);
                }
            });
        });

    return accountSetByMonth;
}

function buildCollectorMonthlySummaryRows(dashboard, accountSetByMonth) {
    const summaryMonthColumns = dashboard.summaryMonthColumns || [];
    const summaryCustomerRows = (dashboard.customerRows || []).filter((row) => !row.isGroupedChild);

    return summaryMonthColumns
        .map((column) => {
            const previousCustomers = accountSetByMonth.get(getMonthKey(addMonths(column.monthStart, -1))) || new Set();
            const currentCustomers = accountSetByMonth.get(column.key) || new Set();
            const additional = Array.from(currentCustomers).filter((rowId) => !previousCustomers.has(rowId)).length;
            const inactive = Array.from(previousCustomers).filter((rowId) => !currentCustomers.has(rowId)).length;
            const toCollect = currentCustomers.size;
            const collected = summaryCustomerRows.filter((row) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                return cell && cell.collectedTotal > 0;
            }).length;

            return {
                monthKey: column.key,
                monthLabel: column.label,
                balance: previousCustomers.size,
                additional,
                inactive,
                toCollect,
                collected,
                pending: Math.max(0, toCollect - collected)
            };
        })
        .reverse();
}

function ensureCollectorDashboardDerivedFields(dashboard) {
    if (!dashboard || !Array.isArray(dashboard.customerRows)) return dashboard;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = normalizeDate(dashboard.windowStart) || COLLECTOR_DASHBOARD_START;
    const summaryEnd = startOfMonth(normalizeDate(dashboard.windowEnd) || today);
    const matrixEnd = startOfMonth(normalizeDate(dashboard.matrixEnd) || new Date(today.getFullYear(), 11, 1));

    if (!Array.isArray(dashboard.summaryMonthColumns) || !dashboard.summaryMonthColumns.length) {
        dashboard.summaryMonthColumns = buildMonthColumns(windowStart, summaryEnd);
    }
    if (!Array.isArray(dashboard.monthColumns) || !dashboard.monthColumns.length) {
        dashboard.monthColumns = buildMonthColumns(windowStart, matrixEnd);
        const currentMonthKey = getMonthKey(today);
        dashboard.monthColumns.forEach((column) => {
            column.isCurrentMonth = column.key === currentMonthKey;
        });
    }

    if (collectorCellMap.size) {
        const needsSummaryRows = !Array.isArray(dashboard.monthlySummaryRows) || !dashboard.monthlySummaryRows.length;
        if (needsSummaryRows) {
            const accountSetByMonth = buildCollectorAccountSetByMonth(dashboard.customerRows, dashboard.summaryMonthColumns);
            dashboard.monthlySummaryRows = buildCollectorMonthlySummaryRows(dashboard, accountSetByMonth);
        }
        if (!Array.isArray(dashboard.matrixTotalRows) || !dashboard.matrixTotalRows.length) {
            dashboard.matrixTotalRows = buildCollectorMatrixTotalRows(dashboard.monthColumns, dashboard.customerRows);
        }
    }

    return dashboard;
}

function canUseCollectorMatrixSnapshot() {
    return Boolean(collectorMatrixSnapshotLoaded && collectorDashboardData && collectorCellMap.size);
}

function buildCollectorSnapshotCellWorkspace(cell) {
    const context = resolveCollectorCellContext(cell);
    return {
        snapshot: true,
        cell,
        context,
        latestHistory: cell.latestHistory || null,
        records: Array.isArray(cell.records) ? cell.records : []
    };
}

function renderCollectorSnapshotCellWorkspace(workspace) {
    const { cell, context, latestHistory, records } = workspace;
    const builtLabel = collectorMatrixSnapshotMeta?.builtAt
        ? new Date(collectorMatrixSnapshotMeta.builtAt).toLocaleString('en-PH')
        : 'the last matrix build';
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    const pendingAmount = getCellOutstandingBalance(cell);
    const invoiceRows = records
        .filter((record) => String(record.invoiceNo || record.invoiceId || record.invoiceKey || '').trim())
        .slice(0, 12)
        .map((record) => `
            <tr>
                <td>${escapeHtml(record.invoiceNo || record.invoiceId || '-')}</td>
                <td class="text-right">${escapeHtml(formatCurrency(record.billedAmount || record.amount || 0))}</td>
                <td class="text-right">${escapeHtml(formatCurrency(record.collectedAmount || 0))}</td>
            </tr>
        `)
        .join('');

    return `
        <div class="collection-followup-shell collection-followup-lite">
            <section class="collection-followup-hero">
                <div>
                    <div class="collection-followup-kicker">Saved matrix snapshot • ${escapeHtml(cell.label || context.label || '')}</div>
                    <h3>${escapeHtml(context.customer)}</h3>
                    <p>${escapeHtml(context.branchName || context.accountLabel || 'Main')} • ${escapeHtml(displaySerialNumber(context.serialNumber))}</p>
                </div>
                <div class="collection-balance-card">
                    <span>Cell totals</span>
                    <strong>${escapeHtml(formatCurrency(pendingAmount || billedTarget))}</strong>
                    <em>Billed ${escapeHtml(formatCurrency(billedTarget))} • Collected ${escapeHtml(formatCurrency(cell.collectedTotal || 0))}</em>
                </div>
            </section>
            <div class="collection-followup-panel">
                <div class="collection-followup-panel-title">Saved collection detail</div>
                <p>Matrix colors and <strong>Followed up by …</strong> badges come from the summary saved ${escapeHtml(builtLabel)}. No live reload is required just to review this cell.</p>
                ${renderFollowupBadge(latestHistory)}
                ${invoiceRows ? `
                    <table class="collection-followup-table">
                        <thead><tr><th>Invoice</th><th>Billed</th><th>Collected</th></tr></thead>
                        <tbody>${invoiceRows}</tbody>
                    </table>
                ` : '<div class="collection-followup-empty">No invoice rows were linked in this saved cell.</div>'}
                <p class="collector-settings-help">Temporary mode: collectors can review saved customer details from the permanent summary. Live follow-up tools will be restored after the local summary table catch-up.</p>
            </div>
        </div>
    `;
}

function patchCollectorCellFollowupDisplay(cellId, historyEntry) {
    const cell = collectorCellMap.get(String(cellId || '').trim());
    if (!cell || !historyEntry || !collectorDashboardData) return;

    cell.latestHistory = historyEntry;
    const rowId = String(cell.rowId || '').trim();
    if (rowId) {
        const row = (collectorDashboardData.customerRows || []).find((item) => String(item.rowId) === rowId);
        if (row) {
            row.latestHistory = historyEntry;
        }
    }

    renderCollectorDashboardFromData(collectorDashboardData, { matrixOnly: true });
    void persistCollectorMatrixSnapshotFromCurrentData('followup-save');
}

function getCollectorMatrixBuiltByLabel() {
    try {
        const user = JSON.parse(window.localStorage?.getItem('marga_user') || window.sessionStorage?.getItem('marga_user') || 'null');
        return String(user?.email || user?.name || user?.username || 'collections-ui').trim();
    } catch (error) {
        return 'collections-ui';
    }
}

function updateCollectorMatrixHeaderStatus() {
    const lastUpdated = document.getElementById('last-updated');
    if (!lastUpdated) return;
    if (collectorMatrixBuildInProgress) {
        lastUpdated.textContent = 'Building matrix snapshot...';
        return;
    }
    if (collectorMatrixSnapshotMeta?.builtAt) {
        const builtAt = new Date(collectorMatrixSnapshotMeta.builtAt);
        const label = Number.isNaN(builtAt.getTime())
            ? collectorMatrixSnapshotMeta.builtAt
            : builtAt.toLocaleString('en-PH');
        lastUpdated.textContent = `Matrix ${label}`;
        return;
    }
    lastUpdated.textContent = 'Matrix not built yet';
}

function openCollectorMatrixSnapshotDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const request = indexedDB.open(COLLECTOR_MATRIX_SNAPSHOT_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(COLLECTOR_MATRIX_SNAPSHOT_STORE)) {
                db.createObjectStore(COLLECTOR_MATRIX_SNAPSHOT_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Unable to open matrix snapshot cache.'));
    });
}

async function readCollectorMatrixSnapshotCache() {
    try {
        const db = await openCollectorMatrixSnapshotDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(COLLECTOR_MATRIX_SNAPSHOT_STORE, 'readonly');
            const store = tx.objectStore(COLLECTOR_MATRIX_SNAPSHOT_STORE);
            const request = store.get(COLLECTOR_MATRIX_SNAPSHOT_CACHE_ID);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('Collector matrix snapshot cache read failed:', error);
        return null;
    }
}

async function writeCollectorMatrixSnapshotCache(serverPayload) {
    if (!serverPayload?.exists || !serverPayload?.payload) return;
    try {
        const db = await openCollectorMatrixSnapshotDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(COLLECTOR_MATRIX_SNAPSHOT_STORE, 'readwrite');
            const store = tx.objectStore(COLLECTOR_MATRIX_SNAPSHOT_STORE);
            const request = store.put({
                id: COLLECTOR_MATRIX_SNAPSHOT_CACHE_ID,
                schemaVersion: Number(serverPayload.schemaVersion || COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION),
                savedAt: new Date().toISOString(),
                builtAt: serverPayload.builtAt || null,
                builtBy: serverPayload.builtBy || '',
                buildSource: serverPayload.buildSource || 'manual',
                rowCount: Number(serverPayload.rowCount || 0),
                pendingCellCount: Number(serverPayload.pendingCellCount || 0),
                windowStart: serverPayload.windowStart || '',
                windowEnd: serverPayload.windowEnd || '',
                payload: serverPayload.payload
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('Collector matrix snapshot cache write failed:', error);
    }
}

function collectorMatrixCacheRecordToServerPayload(record) {
    if (!record?.payload) return null;
    return {
        exists: true,
        schemaVersion: Number(record.schemaVersion || COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION),
        builtAt: record.builtAt || record.savedAt || null,
        builtBy: record.builtBy || '',
        buildSource: record.buildSource || 'cached',
        rowCount: Number(record.rowCount || 0),
        pendingCellCount: Number(record.pendingCellCount || 0),
        windowStart: record.windowStart || '',
        windowEnd: record.windowEnd || '',
        payload: record.payload
    };
}

function setCollectorMatrixLoadingOverlay(message) {
    const matrixNode = document.getElementById('collector-matrix-table');
    if (!matrixNode) return;
    matrixNode.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div><span>${escapeHtml(message)}</span></div>`;
}

function applyCollectorMatrixSnapshotResponse(serverPayload, options = {}) {
    if (!serverPayload?.exists || !serverPayload?.payload) {
        collectorMatrixSnapshotMeta = null;
        collectorMatrixSnapshotLoaded = false;
        collectorDashboardData = null;
        collectorCellMap = new Map();
        collectorCellsByRowId = new Map();
        return false;
    }
    const dashboard = unpackCollectorDashboardSnapshot(serverPayload.payload);
    if (!dashboard) throw new Error('Saved matrix summary is unreadable.');
    collectorDashboardData = dashboard;
    collectorMatrixSnapshotMeta = {
        builtAt: serverPayload.builtAt,
        builtBy: serverPayload.builtBy,
        buildSource: serverPayload.buildSource,
        rowCount: serverPayload.rowCount,
        pendingCellCount: serverPayload.pendingCellCount
    };
    collectorMatrixSnapshotLoaded = true;
    renderCollectorDashboardFromData(collectorDashboardData);
    updateCollectorMatrixHeaderStatus();
    const noteNode = document.getElementById('collector-dashboard-note');
    if (noteNode && options.fromCache && collectorMatrixSnapshotMeta?.builtAt) {
        const builtAt = new Date(collectorMatrixSnapshotMeta.builtAt);
        const builtLabel = Number.isNaN(builtAt.getTime())
            ? collectorMatrixSnapshotMeta.builtAt
            : builtAt.toLocaleString('en-PH');
        noteNode.textContent = `Showing saved summary from ${builtLabel} (this device). Checking server for a newer build...`;
    }
    return true;
}

async function fetchCollectorMatrixSnapshot() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), COLLECTOR_MATRIX_SNAPSHOT_FETCH_MS);
    try {
        const response = await fetch(getMargabaseAdminUrl('/admin/collections-matrix-snapshot'), {
            cache: 'no-store',
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Snapshot HTTP ${response.status}`);
        }
        return payload;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Saved month comparison took too long to download. Try Refresh or use a faster connection.');
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function fetchCollectorMatrixSnapshotDeduped() {
    if (!collectorMatrixSnapshotFetchPromise) {
        collectorMatrixSnapshotFetchPromise = fetchCollectorMatrixSnapshot()
            .finally(() => {
                collectorMatrixSnapshotFetchPromise = null;
            });
    }
    return collectorMatrixSnapshotFetchPromise;
}

async function persistCollectorMatrixSnapshotFromCurrentData(buildSource = 'manual') {
    if (!collectorDashboardData) return null;
    const packed = packCollectorDashboardSnapshot(collectorDashboardData);
    const body = {
        payload: packed,
        meta: {
            builtBy: getCollectorMatrixBuiltByLabel(),
            buildSource,
            schemaVersion: COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION,
            rowCount: collectorDashboardData.customerRows?.length || 0,
            pendingCellCount: collectorDashboardData.pendingCellCount || 0,
            windowStart: collectorDashboardData.windowStart instanceof Date
                ? collectorDashboardData.windowStart.toISOString().slice(0, 10)
                : String(collectorDashboardData.windowStart || ''),
            windowEnd: collectorDashboardData.matrixEnd instanceof Date
                ? collectorDashboardData.matrixEnd.toISOString().slice(0, 10)
                : String(collectorDashboardData.matrixEnd || collectorDashboardData.windowEnd || '')
        }
    };
    const response = await fetch(getMargabaseAdminUrl('/admin/collections-matrix-snapshot'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok || saved?.error) {
        throw new Error(saved?.error?.message || `Snapshot save HTTP ${response.status}`);
    }
    collectorMatrixSnapshotMeta = {
        builtAt: saved.builtAt,
        builtBy: saved.builtBy,
        buildSource: saved.buildSource,
        rowCount: saved.rowCount,
        pendingCellCount: saved.pendingCellCount
    };
    collectorMatrixSnapshotLoaded = true;
    updateCollectorMatrixHeaderStatus();
    void writeCollectorMatrixSnapshotCache({
        exists: true,
        schemaVersion: COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION,
        builtAt: saved.builtAt,
        builtBy: saved.builtBy,
        buildSource: saved.buildSource,
        rowCount: saved.rowCount,
        pendingCellCount: saved.pendingCellCount,
        windowStart: collectorDashboardData?.windowStart instanceof Date
            ? collectorDashboardData.windowStart.toISOString().slice(0, 10)
            : String(collectorDashboardData?.windowStart || ''),
        windowEnd: collectorDashboardData?.matrixEnd instanceof Date
            ? collectorDashboardData.matrixEnd.toISOString().slice(0, 10)
            : String(collectorDashboardData?.matrixEnd || collectorDashboardData?.windowEnd || ''),
        payload: packCollectorDashboardSnapshot(collectorDashboardData)
    });
    return saved;
}

async function refreshCollectorMatrixFromSnapshot(options = {}) {
    const loadSeq = ++collectorMatrixSnapshotLoadSeq;
    const matrixNode = document.getElementById('collector-matrix-table');
    const noteNode = document.getElementById('collector-dashboard-note');
    const hadRenderedMatrix = Boolean(collectorMatrixSnapshotLoaded && collectorDashboardData);
    if (!options.quiet && !hadRenderedMatrix) {
        setCollectorMatrixLoadingOverlay('Loading month comparison from summary...');
    } else if (!options.quiet && noteNode) {
        noteNode.textContent = 'Refreshing saved month-to-month summary...';
    }

    try {
        const payload = await fetchCollectorMatrixSnapshotDeduped();
        if (loadSeq !== collectorMatrixSnapshotLoadSeq) {
            return { loaded: false, cancelled: true };
        }
        if (!payload?.exists || !payload?.payload) {
            collectorMatrixSnapshotMeta = null;
            collectorMatrixSnapshotLoaded = false;
            collectorDashboardData = null;
            collectorCellMap = new Map();
            collectorCellsByRowId = new Map();
            updateCollectorMatrixHeaderStatus();
            if (!hadRenderedMatrix) renderCollectorMatrixEmptyState();
            return { loaded: false, payload };
        }

        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (loadSeq !== collectorMatrixSnapshotLoadSeq) {
            return { loaded: false, cancelled: true };
        }

        applyCollectorMatrixSnapshotResponse(payload);
        void writeCollectorMatrixSnapshotCache(payload);
        return { loaded: true, payload };
    } catch (error) {
        console.error('Collector matrix snapshot load failed:', error);
        if (!hadRenderedMatrix) {
            if (noteNode) {
                noteNode.textContent = error?.message || 'Unable to load the saved month comparison. Try Refresh.';
            }
            if (matrixNode) {
                matrixNode.innerHTML = '<div class="empty-followup">Unable to load saved month comparison.</div>';
            }
        } else if (noteNode) {
            noteNode.textContent = 'Server refresh failed. Showing the last saved summary stored on this device.';
        }
        return { loaded: false, error };
    }
}

async function hydrateCollectorMatrixFromDeviceCache() {
    const cached = await readCollectorMatrixSnapshotCache();
    const payload = collectorMatrixCacheRecordToServerPayload(cached);
    if (!payload) return false;
    if (Number(payload.schemaVersion) !== COLLECTOR_MATRIX_SNAPSHOT_SCHEMA_VERSION) return false;
    try {
        return applyCollectorMatrixSnapshotResponse(payload, { fromCache: true });
    } catch (error) {
        console.warn('Collector matrix device cache unreadable:', error);
        return false;
    }
}

function renderCollectorMatrixEmptyState() {
    const matrixNode = document.getElementById('collector-matrix-table');
    const noteNode = document.getElementById('collector-dashboard-note');
    const summaryNode = document.getElementById('collector-summary-table');
    if (summaryNode) summaryNode.innerHTML = '';
    if (noteNode) {
        noteNode.textContent = 'No month comparison in the permanent summary table yet. A controlled backend rebuild must create it before staff browsers load this grid.';
    }
    if (matrixNode) {
        matrixNode.innerHTML = '<div class="empty-followup">No saved month comparison yet. The backend rebuild job must create the permanent summary first.</div>';
    }
    const rangeNode = document.getElementById('collector-dashboard-range');
    if (rangeNode) rangeNode.textContent = 'Not built yet';
    const pendingNode = document.getElementById('collector-dashboard-pending');
    if (pendingNode) pendingNode.textContent = 'Pending cells: —';
}

function renderDeferredCollectionsWorkspaceNote() {
    if (lastLoadSucceeded) return;
    const container = document.getElementById('table-container');
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <h3>Invoice work queue not loaded</h3>
            <p>Priority buckets and the invoice list use live billing data when loaded separately. The month-to-month matrix and summary table always come from the permanent Postgres summary—not from a browser scan.</p>
        </div>
    `;
    filteredInvoices = [];
    updateAllStats();
    updateDurationSummary();
    renderTable();
}

async function loadCollectionsDataAndBuildMatrixSnapshot() {
    if (collectorMatrixBuildInProgress) return false;

    collectorMatrixBuildInProgress = true;
    updateCollectorMatrixHeaderStatus();
    const loadBtn = document.getElementById('btnLoadCollectionsData');
    const refreshBtn = document.getElementById('btnRefreshCollectorMatrix');
    if (loadBtn) loadBtn.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        hideLoadError();
        const hydratedFromCache = await hydrateCollectorMatrixFromDeviceCache();
        const result = await refreshCollectorMatrixFromSnapshot({ quiet: false });
        if (!result?.loaded && !collectorMatrixSnapshotLoaded) {
            if (!hydratedFromCache) {
                renderCollectorMatrixEmptyState();
            }
            showLoadError('No saved month comparison is available yet. Run the controlled full summary build only when the office is idle.');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Collections matrix summary load failed:', error);
        showLoadError(error.message || 'Unable to load the permanent month comparison summary.');
        return false;
    } finally {
        collectorMatrixBuildInProgress = false;
        if (loadBtn) loadBtn.disabled = false;
        if (refreshBtn) refreshBtn.disabled = false;
        updateCollectorMatrixHeaderStatus();
    }
}

async function fetchCollectorMatrixSettings() {
    const response = await fetch(getMargabaseAdminUrl('/admin/collections-matrix-settings'), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Settings HTTP ${response.status}`);
    }
    return payload;
}

async function saveCollectorMatrixSettings(settings) {
    const response = await fetch(getMargabaseAdminUrl('/admin/collections-matrix-settings'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Settings save HTTP ${response.status}`);
    }
    return payload;
}

function renderCollectorMatrixSettingsModal() {
    const modal = document.getElementById('collectorMatrixSettingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
}

function closeCollectorMatrixSettingsModal() {
    document.getElementById('collectorMatrixSettingsModal')?.classList.add('hidden');
}

async function openCollectorMatrixSettingsModal() {
    const statusNode = document.getElementById('collectorMatrixSettingsStatus');
    const enabledNode = document.getElementById('collectorMatrixAutoRebuildEnabled');
    const timeNode = document.getElementById('collectorMatrixAutoRebuildTime');
    const lastBuiltNode = document.getElementById('collectorMatrixLastBuiltAt');
    if (statusNode) statusNode.textContent = 'Loading settings...';
    renderCollectorMatrixSettingsModal();
    try {
        const [payload] = await Promise.all([
            fetchCollectorMatrixSettings(),
            loadCollectionWorkflowSettings()
        ]);
        const settings = payload.settings || {};
        if (enabledNode) enabledNode.checked = settings.autoRebuildEnabled !== false;
        if (timeNode) timeNode.value = settings.autoRebuildTime || '00:00';
        fillCollectionTargetInputs();
        renderCollectionAssignmentSettings();
        const builtParts = [];
        if (collectorMatrixSnapshotMeta?.builtAt) {
            builtParts.push(`Last matrix build: ${new Date(collectorMatrixSnapshotMeta.builtAt).toLocaleString('en-PH')}`);
        }
        if (payload.lastAutoBuiltAt) {
            builtParts.push(`Last scheduled run: ${new Date(payload.lastAutoBuiltAt).toLocaleString('en-PH')}`);
        }
        if (lastBuiltNode) {
            lastBuiltNode.textContent = builtParts.length
                ? builtParts.join(' • ')
                : 'No saved matrix build yet. A controlled backend rebuild must create the permanent summary.';
        }
        if (statusNode) {
            statusNode.textContent = `Automatic rebuild uses ${settings.timezone || 'Asia/Manila'} time. Server jobs rebuild the summary; staff browsers only read the saved result.`;
        }
    } catch (error) {
        if (statusNode) statusNode.textContent = error.message || 'Unable to load matrix settings.';
    }
}

async function saveCollectorMatrixSettingsFromModal() {
    const statusNode = document.getElementById('collectorMatrixSettingsStatus');
    const enabledNode = document.getElementById('collectorMatrixAutoRebuildEnabled');
    const timeNode = document.getElementById('collectorMatrixAutoRebuildTime');
    if (statusNode) statusNode.textContent = 'Saving...';
    try {
        collectionWorkflowSettings.targets = collectCollectionTargetInputs();
        collectionWorkflowSettings.assignments = collectCollectionAssignmentInputs();
        await saveCollectionWorkflowSettings();
        await saveCollectorMatrixSettings({
            autoRebuildEnabled: Boolean(enabledNode?.checked),
            autoRebuildTime: String(timeNode?.value || '00:00').trim(),
            timezone: 'Asia/Manila'
        });
        if (statusNode) statusNode.textContent = 'Saved. Targets and open assignments are available inside Collections.';
        setTimeout(() => closeCollectorMatrixSettingsModal(), 900);
    } catch (error) {
        if (statusNode) statusNode.textContent = error.message || 'Unable to save settings.';
    }
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
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);

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
        pageSize: requestPageSize = 1000,
        maxPages = 200,
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

async function firestoreCreate(collection, fields) {
    const url = `${BASE_URL}/${collection}?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to write ${collection}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreSetDocument(collection, docId, fields) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    if (!safeDocId) throw new Error(`Missing document id for ${collection}`);

    const url = `${BASE_URL}/${collection}/${safeDocId}?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to save ${collection}/${docId}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreUpdateDocumentFields(collection, docId, fields) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    if (!safeDocId) throw new Error(`Missing document id for ${collection}`);

    const params = new URLSearchParams({ key: API_KEY });
    Object.keys(fields || {}).forEach((fieldPath) => params.append('updateMask.fieldPaths', fieldPath));
    const response = await fetch(`${BASE_URL}/${collection}/${safeDocId}?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to update ${collection}/${docId}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreGetDocument(collection, docId) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    if (!safeDocId) return null;

    const response = await fetch(`${BASE_URL}/${collection}/${safeDocId}?key=${encodeURIComponent(API_KEY)}`);
    if (response.status === 404) return null;
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to load ${collection}/${docId}: ${response.status} ${message.slice(0, 140)}`);
    }

    return response.json();
}

async function firestoreRunQuery(structuredQuery) {
    const url = `${BASE_URL}:runQuery?key=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Failed to query Firestore: ${response.status} ${message.slice(0, 140)}`);
    }

    const rows = await response.json();
    return rows
        .map((row) => row.document)
        .filter(Boolean);
}

async function firestoreQueryEquals(collection, fieldPath, value, options = {}) {
    if (value === null || value === undefined || value === '') return [];

    const structuredQuery = {
        from: [{ collectionId: collection }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: toFirestoreWriteValue(value)
            }
        }
    };

    if (Array.isArray(options.fieldMask) && options.fieldMask.length) {
        structuredQuery.select = {
            fields: options.fieldMask.map((selectedFieldPath) => ({ fieldPath: selectedFieldPath }))
        };
    }

    if (Number(options.limit || 0) > 0) {
        structuredQuery.limit = Number(options.limit || 0);
    }

    return firestoreRunQuery(structuredQuery);
}

async function firestoreRunOrderedQuery(collectionId, limit = 1) {
    return firestoreRunQuery({
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: 'id' }, direction: 'DESCENDING' }],
        limit
    });
}

async function loadSupplementalCollectionPaymentDocs() {
    const today = new Date();
    const startKey = toDateKey(COLLECTOR_DASHBOARD_START);
    const endKey = toDateKey(addMonths(new Date(today.getFullYear(), 11, 1), 1));
    const fieldMask = COLLECTION_PAYMENT_FIELD_MASK;
    const querySpecs = [
        ['date_paid', startKey, endKey],
        ['tax_date_paid', startKey, endKey],
        ['date_deposit', startKey, endKey]
    ];
    const rangeQueries = querySpecs.map(([fieldPath, startValue, endValue]) => (
        firestoreRunRangeQuery('tbl_paymentinfo', fieldPath, startValue, endValue, fieldMask)
            .catch((error) => {
                console.warn(`Unable to load supplemental payment rows by ${fieldPath}:`, error);
                return [];
            })
    ));
    const sourceQuery = firestoreRunQuery({
        from: [{ collectionId: 'tbl_paymentinfo' }],
        where: {
            fieldFilter: {
                field: { fieldPath: 'source' },
                op: 'EQUAL',
                value: { stringValue: 'collections_web_payment' }
            }
        },
        select: { fields: fieldMask.map((fieldPath) => ({ fieldPath })) },
        limit: 1000
    }).catch((error) => {
        console.warn('Unable to load supplemental web payment records:', error);
        return [];
    });

    const docsByKey = new Map();
    const groups = await Promise.all([...rangeQueries, sourceQuery]);
    groups.flat().forEach((doc) => {
        const key = getFirestoreDocumentId(doc) || doc.name;
        if (key) docsByKey.set(key, doc);
    });
    return Array.from(docsByKey.values());
}

async function allocateNextNumericId(collection) {
    const latestDocs = await firestoreRunOrderedQuery(collection, 1);
    const latestRow = latestDocs.map(documentFieldsToPlain).filter(Boolean)[0] || {};
    const nextId = Number(latestRow.id || 0) + 1;
    if (!Number.isFinite(nextId) || nextId <= 0) {
        throw new Error(`Unable to allocate new ${collection} id.`);
    }
    return nextId;
}

async function safeFirestoreGetAll(collection, statusCallback = null, options = {}) {
    try {
        return await firestoreGetAll(collection, statusCallback, options);
    } catch (error) {
        console.warn(`Unable to load optional collection ${collection}:`, error);
        return [];
    }
}

function toFirestoreWriteValue(value) {
    if (value === null || value === undefined) return { stringValue: '' };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return { stringValue: '' };
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    return { stringValue: String(value) };
}

function toFirestoreQueryValue(value) {
    const raw = String(value || '').trim();
    if (/^-?\d+$/.test(raw)) return { integerValue: raw };
    return { stringValue: raw };
}

function getFirestoreDocumentId(doc) {
    return String(doc?.name || '').split('/').pop() || '';
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
    currentDetailInvoice = null;
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
                    <div class="followup-item" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
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

function collectionHistoryToken(entry) {
    return `${entry.docId}|${entry.callDateKey || ''}|${entry.followupDateKey || ''}|${entry.remarks || ''}`;
}

function collectionHistoryDocToEntry(doc) {
    const f = doc.fields || {};
    const invoiceRef = getField(f, ['invoice_num', 'invoice_id', 'invoice_no', 'invoiceno']);
    const invoiceKey = String(invoiceRef || '').trim();
    const accountRef = String(getField(f, ['account_ref']) || '').trim();
    const accountGroupRef = String(getField(f, ['account_group_ref']) || '').trim();
    if (!invoiceKey && !accountRef && !accountGroupRef) return null;

    const followupDateRaw = getField(f, ['followup_datetime', 'followup_date', 'next_followup_date', 'next_followup']);
    const callDateRaw = getField(f, ['timestamp', 'call_datetime', 'created_at', 'updated_at', 'timestmp', 'tmestamp', 'datex', 'date_created']) || followupDateRaw;
    const followupDate = normalizeDate(followupDateRaw);
    const callDate = normalizeDate(callDateRaw);

    return {
        docId: doc.name || getFirestoreDocumentId(doc) || String(Math.random()),
        invoiceKey,
        accountRef,
        accountGroupRef,
        branchId: getField(f, ['branch_id']),
        companyId: getField(f, ['company_id']),
        contractmainId: getField(f, ['contractmain_id']),
        machineId: getField(f, ['machine_id']),
        monthKey: getField(f, ['month_key']),
        remarks: getField(f, ['remarks']) || 'No remarks',
        contactPerson: getField(f, ['contact_person']) || '-',
        contactNumber: getField(f, ['contact_number']) || '',
        conversationResult: getField(f, ['conversation_result']) || '',
        promiseToPay: getField(f, ['promise_to_pay']) || '',
        promiseToPayAmount: Number(getField(f, ['promise_to_pay_amount']) || getField(f, ['payment_amount']) || 0),
        promiseToPayDate: normalizeDate(getField(f, ['promise_to_pay_date'])),
        promiseToPayDateKey: toDateKey(getField(f, ['promise_to_pay_date'])),
        nextFollowupTime: getField(f, ['next_followup_time']) || '',
        issueType: getField(f, ['issue_type']) || '',
        issueNotes: getField(f, ['issue_notes']) || '',
        collectionRoleAssignment: getField(f, ['collection_role_assignment']) || '',
        customerAssignmentOwner: getField(f, ['customer_assignment_owner']) || '',
        scheduleStatus: getField(f, ['schedule_status']),
        statusId: getField(f, ['status_id']),
        locationId: getField(f, ['location_id']),
        locationLabel: getField(f, ['location_label']),
        isCheckSigned: Boolean(getField(f, ['ischecksigned'])),
        checkNumber: getField(f, ['check_number']) || '',
        paymentAmount: Number(getField(f, ['payment_amount']) || 0),
        collectionId: getField(f, ['collection_id']),
        employeeId: getField(f, ['employee_id']),
        followedUpBy: getField(f, ['followed_up_by']),
        collectorName: getField(f, ['collector_name']),
        employeeName: getField(f, ['employee_name']),
        committedBy: getField(f, ['committed_by']),
        createdBy: getField(f, ['created_by']),
        updatedBy: getField(f, ['updated_by']),
        encodedBy: getField(f, ['encoded_by']),
        insertedBy: getField(f, ['inserted_by']),
        computer: getField(f, ['pcname', 'computer_name', 'device_name', 'ipadd']),
        followupDate,
        followupDateRaw,
        followupDateKey: toDateKey(followupDate),
        callDate,
        callDateRaw,
        callDateKey: toDateKey(callDate)
    };
}

function indexCollectionHistoryEntry(entry) {
    if (!entry) return;

    const keys = [
        entry.invoiceKey,
        entry.accountRef,
        entry.accountGroupRef,
        ...collectionAccountHistoryKeys(entry)
    ].filter(Boolean);

    Array.from(new Set(keys)).forEach((historyKey) => {
        if (!collectionHistory[historyKey]) collectionHistory[historyKey] = [];
        const token = collectionHistoryToken(entry);
        if (!collectionHistory[historyKey].some((existing) => collectionHistoryToken(existing) === token)) {
            collectionHistory[historyKey].push(entry);
        }
        collectionHistory[historyKey].sort((a, b) => {
            const aTime = a.callDate ? a.callDate.getTime() : 0;
            const bTime = b.callDate ? b.callDate.getTime() : 0;
            return bTime - aTime;
        });
    });
}

async function loadCollectionHistoryForKeys(keys = []) {
    if (collectionHistoryBulkLoaded) return;

    const uniqueKeys = Array.from(new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)));
    if (!uniqueKeys.length) return;

    const fields = ['invoice_num', 'invoice_id', 'account_ref', 'account_group_ref'];
    const queries = [];
    uniqueKeys.forEach((key) => {
        fields.forEach((fieldPath) => {
            queries.push(
                firestoreRunQuery({
                    from: [{ collectionId: 'tbl_collectionhistory' }],
                    where: {
                        fieldFilter: {
                            field: { fieldPath },
                            op: 'EQUAL',
                            value: { stringValue: key }
                        }
                    },
                    select: { fields: COLLECTION_HISTORY_FIELD_MASK.map((fieldPath) => ({ fieldPath })) },
                    limit: 40
                }).catch((error) => {
                    console.warn(`Collection history lookup failed for ${fieldPath}=${key}:`, error);
                    return [];
                })
            );
        });
    });

    const docs = (await Promise.all(queries)).flat();
    docs.forEach((doc) => indexCollectionHistoryEntry(collectionHistoryDocToEntry(doc)));
}

function firestoreRunRangeQuery(collectionId, fieldPath, startValue, endValue, fieldMask = []) {
    if (!collectionId || !fieldPath || !startValue || !endValue) return Promise.resolve([]);
    return firestoreRunQuery({
        from: [{ collectionId }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: startValue } } },
                    { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN', value: { stringValue: endValue } } }
                ]
            }
        },
        select: { fields: fieldMask.map((maskPath) => ({ fieldPath: maskPath })) }
    });
}

function getHistoryForRecords(records = []) {
    const keys = [];
    records.forEach((record) => {
        keys.push(record.invoiceNo, record.invoiceId, record.invoiceKey, record.id);
    });
    return getHistoryForInvoice(...keys);
}

function latestHistoryForRecords(records = []) {
    return getHistoryForRecords(records)[0] || null;
}

function getHistoryForCell(cell = {}) {
    return mergeHistoryLists(
        getHistoryForRecords(cell.records || []),
        getHistoryForInvoice(...collectionAccountHistoryKeys(cell))
    );
}

function latestHistoryForCell(cell = {}) {
    return getHistoryForCell(cell)[0] || null;
}

function getHistoryForCollectorRow(rowId) {
    const safeRowId = String(rowId || '').trim();
    if (!safeRowId) return [];
    const rowCells = collectorCellsByRowId.get(safeRowId) || [];
    if (!rowCells.length) return [];
    return mergeHistoryLists(...rowCells.map((cell) => getHistoryForCell(cell)));
}

function isCancelledLegacySchedule(row = {}) {
    const statusText = String(row.status || row.master_schedule_status || row.collection_schedule_status || '').trim().toLowerCase();
    return Number(row.iscancel || 0) === 1
        || Number(row.iscancelled || 0) === 1
        || Boolean(String(row.iscancelleddate || '').trim())
        || statusText === 'cancelled'
        || statusText === 'canceled';
}

function isLegacyCollectionSchedule(row = {}) {
    const purposeId = Number(row.purpose_id || 0);
    const sourceText = [
        row.source,
        row.source_module,
        row.request_origin,
        row.collection_schedule_source,
        row.collection_schedule_status,
        row.schedule_status,
        row.schedule_status_key,
        row.purpose,
        row.schedule_purpose,
        row.remarks,
        row.customer_request
    ].join(' ').toLowerCase();
    return purposeId === 2 || /collection|collect|pickup|pick up/.test(sourceText);
}

function normalizeLegacyCollectionScheduleEntry(row = {}) {
    const taskDateRaw = row.task_datetime || row.original_sched || row.schedule_date || '';
    const committedDateRaw = row.commitment_date || row.followup_date || taskDateRaw;
    const updatedAt = normalizeDate(row.updated_at || row.created_at || row.timestmp || row.tmestamp || row.date_finished || taskDateRaw);
    const pickupEmployeeId = normalizeLookupId(row.assigned_to_id || row.tech_id || row.field_billing_assigned_staff_id || '');
    const followupEmployeeId = normalizeLookupId(
        row.employee_id
        || row.followed_up_by_id
        || row.collector_id
        || row.created_by_id
        || row.updated_by_id
        || row.encoded_by_id
        || row.inserted_by_id
        || row.user_id
        || row.closedby
        || row.userlog_id
    );
    const pickupName = String(row.assigned_to || row.field_billing_assigned_staff_name || employeeLookupMap.get(pickupEmployeeId) || '').trim();
    const followupName = String(
        row.committed_by
        || row.collector_name
        || row.followed_up_by
        || row.employee_name
        || row.created_by
        || row.updated_by
        || row.encoded_by
        || row.inserted_by
        || employeeLookupMap.get(followupEmployeeId)
        || ''
    ).trim();
    const pickupRole = String(row.assigned_role || roleForEmployeeId(pickupEmployeeId) || roleForEmployeeName(pickupName) || '').trim();
    const followupRole = String(roleForEmployeeId(followupEmployeeId) || roleForEmployeeName(followupName) || '').trim();
    const canUsePickupAsCaller = Boolean(pickupName) && !followupName && isCollectionFollowupRole(pickupRole);
    const callerName = followupName || (canUsePickupAsCaller ? pickupName : '');
    const callerEmployeeId = followupEmployeeId || (canUsePickupAsCaller ? pickupEmployeeId : '');
    const remarks = buildAddressText([row.remarks, row.customer_request, row.tl_remarks, row.csr_remarks]);

    return {
        docId: row._docId || row._docName || String(row.id || '').trim(),
        invoiceKey: String(row.invoice_no || row.invoice_num || row.invoice_id || '').trim(),
        scheduleStatus: String(row.collection_schedule_status || row.schedule_status || row.purpose || row.schedule_purpose || 'Confirmed').trim(),
        scheduleStatusKey: String(row.schedule_status_key || scheduleSlug(row.collection_schedule_status || row.schedule_status || row.purpose || row.schedule_purpose || 'Confirmed')).trim(),
        purpose: String(row.purpose || row.schedule_purpose || '').trim(),
        scheduleDate: normalizeDate(taskDateRaw),
        scheduleDateKey: toDateKey(taskDateRaw),
        scheduleTime: normalizeTimeInput(taskDateRaw),
        amount: Number(row.balance || row.amount || row.amt_collected || 0) || 0,
        customer: String(row.customer || row.company_name || '').trim(),
        branch: String(row.branch || row.branch_name || '').trim(),
        assignedTo: callerName,
        assignedToId: callerEmployeeId,
        assignedRole: followupRole || (canUsePickupAsCaller ? pickupRole : ''),
        pickupAssignedTo: pickupName,
        pickupAssignedToId: pickupEmployeeId,
        pickupAssignedRole: pickupRole,
        committedBy: String(row.committed_by || '').trim(),
        collectorName: String(row.collector_name || '').trim(),
        followedUpBy: String(row.followed_up_by || '').trim(),
        employeeName: String(row.employee_name || '').trim(),
        createdBy: String(row.created_by || '').trim(),
        updatedBy: String(row.updated_by || '').trim(),
        encodedBy: String(row.encoded_by || '').trim(),
        insertedBy: String(row.inserted_by || '').trim(),
        computer: String(row.pcname || row.computer_name || row.device_name || row.ipadd || '').trim(),
        remarks,
        updatedAt,
        callDate: normalizeDate(row.date_finished || row.timestmp || row.tmestamp || row.updated_at || row.created_at || taskDateRaw),
        callDateKey: toDateKey(row.date_finished || row.timestmp || row.tmestamp || row.updated_at || row.created_at || taskDateRaw),
        followupDate: normalizeDate(committedDateRaw),
        followupDateKey: toDateKey(committedDateRaw),
        source: 'tbl_schedule'
    };
}

async function loadLegacyCollectionScheduleEntries() {
    const todayKey = toDateKey(new Date());
    const tomorrowKey = getTodayInputValue(1);
    const afterTomorrowKey = getTodayInputValue(2);
    const querySpecs = [
        ['task_datetime', todayKey, afterTomorrowKey],
        ['original_sched', todayKey, afterTomorrowKey],
        ['commitment_date', todayKey, afterTomorrowKey],
        ['date_finished', todayKey, tomorrowKey],
        ['timestmp', todayKey, tomorrowKey],
        ['tmestamp', todayKey, tomorrowKey],
        ['updated_at', todayKey, tomorrowKey],
        ['created_at', todayKey, tomorrowKey]
    ];

    const groups = await Promise.all(querySpecs.map(([fieldPath, startValue, endValue]) => (
        firestoreRunRangeQuery('tbl_schedule', fieldPath, startValue, endValue, LEGACY_COLLECTION_SCHEDULE_FIELD_MASK)
            .catch((error) => {
                console.warn(`Unable to load collection tbl_schedule rows by ${fieldPath}:`, error);
                return [];
            })
    )));

    const byDoc = new Map();
    groups.flat().forEach((doc) => {
        const key = doc.name || getFirestoreDocumentId(doc);
        if (key && !byDoc.has(key)) byDoc.set(key, doc);
    });

    return Array.from(byDoc.values())
        .map(documentFieldsToPlain)
        .filter((row) => !isCancelledLegacySchedule(row))
        .filter(isLegacyCollectionSchedule)
        .map(normalizeLegacyCollectionScheduleEntry)
        .filter((row) => row.invoiceKey || row.customer || row.branch || row.remarks);
}

function mergeHistoryLists(...lists) {
    const merged = [];
    const seen = new Set();
    lists.flat().filter(Boolean).forEach((entry) => {
        const token = `${entry.docId}|${entry.callDateKey || ''}|${entry.followupDateKey || ''}|${entry.remarks || ''}`;
        if (seen.has(token)) return;
        seen.add(token);
        merged.push(entry);
    });
    return merged.sort((a, b) => {
        const aTime = a.callDate ? a.callDate.getTime() : 0;
        const bTime = b.callDate ? b.callDate.getTime() : 0;
        return bTime - aTime;
    });
}

async function loadCollectionEmployeeLookup() {
    if (employeeLookupMap.size > 0) return;

    const [activeRoster, employeeDocs, positionDocs] = await Promise.all([
        loadCollectionActiveEmployeeRoster(),
        safeFirestoreGetAll('tbl_employee', null, {
            fieldMask: [
                'id',
                'email',
                'marga_login_email',
                'username',
                'firstname',
                'lastname',
                'nickname',
                'name',
                'position_id',
                'position',
                'position_name',
                'position_label',
                'marga_role',
                'marga_roles',
                'active',
                'marga_active',
                'marga_account_active',
                'mstatus',
                'estatus'
            ],
            maxPages: 40
        }),
        safeFirestoreGetAll('tbl_empos', null, {
            fieldMask: ['id', 'position', 'position_name', 'name'],
            maxPages: 10
        })
    ]);
    collectionActiveEmployeeEmails = activeRoster;

    collectionPositionMap = new Map();
    positionDocs.forEach((doc) => {
        const row = documentFieldsToPlain(doc);
        const id = normalizeLookupId(row.id);
        if (id) collectionPositionMap.set(id, row);
    });

    rebuildCollectionAssignableStaff(employeeDocs);
}

async function loadTodayCollectionHistoryDocs() {
    const todayKey = toDateKey(new Date());
    const tomorrowKey = getTodayInputValue(1);
    const querySpecs = [
        ['timestamp', todayKey, tomorrowKey],
        ['updated_at', todayKey, tomorrowKey],
        ['tmestamp', todayKey, tomorrowKey],
        ['datex', todayKey, tomorrowKey],
        ['date_created', todayKey, tomorrowKey],
        ['followup_datetime', todayKey, tomorrowKey],
        ['followup_date', todayKey, tomorrowKey],
        ['next_followup', todayKey, tomorrowKey]
    ];

    const groups = await Promise.all(querySpecs.map(([fieldPath, startValue, endValue]) => (
        firestoreRunRangeQuery('tbl_collectionhistory', fieldPath, startValue, endValue, COLLECTION_HISTORY_FIELD_MASK)
            .catch((error) => {
                console.warn(`Unable to load today's collection history rows by ${fieldPath}:`, error);
                return [];
            })
    )));

    const byDoc = new Map();
    groups.flat().forEach((doc) => {
        const key = doc.name || getFirestoreDocumentId(doc);
        if (key && !byDoc.has(key)) byDoc.set(key, doc);
    });
    return Array.from(byDoc.values());
}

async function loadCollectionHistory() {
    collectionHistoryBulkLoaded = false;
    await loadCollectionEmployeeLookup();

    const [historyDocs, todayHistoryDocs] = await Promise.all([
        firestoreGetAll('tbl_collectionhistory', null, {
            fieldMask: COLLECTION_HISTORY_FIELD_MASK,
            maxPages: 320
        }),
        loadTodayCollectionHistoryDocs()
    ]);

    collectionHistory = {};
    todayFollowups = [];

    const todayKey = toDateKey(new Date());

    const docsByKey = new Map();
    [...historyDocs, ...todayHistoryDocs].forEach((doc) => {
        const key = doc.name || getFirestoreDocumentId(doc);
        if (key) docsByKey.set(key, doc);
    });

    docsByKey.forEach((doc) => {
        const entry = collectionHistoryDocToEntry(doc);
        if (!entry) return;

        indexCollectionHistoryEntry(entry);

        if (entry.followupDateKey && entry.followupDateKey === todayKey) {
            todayFollowups.push({
                invoiceKey: entry.invoiceKey || entry.accountRef || entry.accountGroupRef,
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

    collectionHistoryBulkLoaded = true;
}

function updateFollowupBadge() {
    const badge = document.getElementById('followupBadge');
    if (!badge) return;

    const scheduledCount = getTodayScheduledInvoices().length;
    if (scheduledCount > 0) {
        badge.textContent = scheduledCount.toLocaleString();
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

async function loadCollectionScheduleEntries() {
    const [mirrorDocs, legacyRows] = await Promise.all([
        safeFirestoreGetAll('marga_master_schedule', null, {
            fieldMask: [
                'source',
                'request_origin',
                'collection_schedule_source',
                'invoice_no',
                'invoice_id',
                'schedule_status',
                'schedule_status_key',
                'schedule_date',
                'schedule_time',
                'followup_date',
                'collection_time',
                'amount',
                'balance',
                'customer',
                'branch',
                'assigned_to',
                'assigned_to_id',
                'assigned_role',
                'committed_by',
                'collector_name',
                'followed_up_by',
                'employee_name',
                'created_by',
                'updated_by',
                'encoded_by',
                'inserted_by',
                'pcname',
                'computer_name',
                'device_name',
                'ipadd',
                'status',
                'purpose',
                'remarks',
                'updated_at',
                'created_at'
            ],
            maxPages: 320
        }),
        loadLegacyCollectionScheduleEntries()
    ]);

    const mirrorRows = mirrorDocs
        .map(documentFieldsToPlain)
        .filter((row) => {
            const sourceText = `${row.source || ''} ${row.request_origin || ''} ${row.collection_schedule_source || ''}`.toLowerCase();
            return sourceText.includes('collection');
        })
        .filter((row) => String(row.status || 'Active').toLowerCase() !== 'cancelled')
        .map((row) => {
            const assigneeId = normalizeLookupId(row.assigned_to_id || '');
            const assigneeName = String(row.assigned_to || employeeLookupMap.get(assigneeId) || '').trim();
            const assigneeRole = String(row.assigned_role || roleForEmployeeId(assigneeId) || roleForEmployeeName(assigneeName) || '').trim();
            const explicitCaller = String(
                row.committed_by
                || row.collector_name
                || row.followed_up_by
                || row.employee_name
                || row.created_by
                || row.updated_by
                || row.encoded_by
                || row.inserted_by
                || ''
            ).trim();
            const canUseAssigneeAsCaller = !explicitCaller && assigneeName && isCollectionFollowupRole(assigneeRole);
            const callerName = explicitCaller || (canUseAssigneeAsCaller ? assigneeName : '');
            return {
                docId: row._docId || row._docName || '',
                invoiceKey: String(row.invoice_no || row.invoice_id || '').trim(),
                scheduleStatus: String(row.schedule_status || row.purpose || '').trim(),
                scheduleStatusKey: String(row.schedule_status_key || scheduleSlug(row.schedule_status || row.purpose || '')).trim(),
                purpose: String(row.purpose || '').trim(),
                scheduleDate: normalizeDate(row.schedule_date || row.followup_date),
                scheduleDateKey: toDateKey(row.schedule_date || row.followup_date),
                scheduleTime: normalizeTimeInput(row.schedule_time || row.collection_time || ''),
                amount: Number(row.balance || row.amount || 0) || 0,
                customer: String(row.customer || '').trim(),
                branch: String(row.branch || '').trim(),
                assignedTo: callerName,
                assignedToId: canUseAssigneeAsCaller ? assigneeId : '',
                assignedRole: canUseAssigneeAsCaller ? assigneeRole : '',
                pickupAssignedTo: assigneeName,
                pickupAssignedToId: assigneeId,
                pickupAssignedRole: assigneeRole,
                committedBy: String(row.committed_by || '').trim(),
                collectorName: String(row.collector_name || '').trim(),
                followedUpBy: String(row.followed_up_by || '').trim(),
                employeeName: String(row.employee_name || '').trim(),
                createdBy: String(row.created_by || '').trim(),
                updatedBy: String(row.updated_by || '').trim(),
                encodedBy: String(row.encoded_by || '').trim(),
                insertedBy: String(row.inserted_by || '').trim(),
                remarks: String(row.remarks || '').trim(),
                computer: String(row.pcname || row.computer_name || row.device_name || row.ipadd || '').trim(),
                updatedAt: normalizeDate(row.updated_at || row.created_at)
            };
        })
        .filter((row) => row.invoiceKey || row.customer || row.branch);

    const byKey = new Map();
    [...mirrorRows, ...legacyRows].forEach((row) => {
        const businessKey = [
            row.invoiceKey || '',
            row.scheduleDateKey || '',
            row.customer || '',
            row.branch || '',
            row.remarks || ''
        ].join(':');
        const key = businessKey.replace(/:+/g, ':').trim() || (row.docId ? `doc:${row.docId}` : '');
        if (key) byKey.set(key, row);
    });
    collectionScheduleEntries = Array.from(byKey.values());
}

function normalizeCollectionScheduleEntry(row = {}) {
    const assigneeId = normalizeLookupId(row.assigned_to_id || row.assignedToId || '');
    const assigneeName = String(row.assigned_to || row.assignedTo || '').trim();
    const assigneeRole = String(row.assigned_role || row.assignedRole || roleForEmployeeId(assigneeId) || roleForEmployeeName(assigneeName) || '').trim();
    const explicitCaller = String(
        row.committed_by
        || row.committedBy
        || row.collector_name
        || row.collectorName
        || row.followed_up_by
        || row.followedUpBy
        || row.employee_name
        || row.employeeName
        || row.created_by
        || row.createdBy
        || row.updated_by
        || row.updatedBy
        || row.encoded_by
        || row.encodedBy
        || row.inserted_by
        || row.insertedBy
        || ''
    ).trim();
    const canUseAssigneeAsCaller = !explicitCaller && assigneeName && isCollectionFollowupRole(assigneeRole);
    return {
        docId: row._docId || row.docId || row._docName || '',
        invoiceKey: String(row.invoice_no || row.invoice_id || row.invoiceKey || '').trim(),
        scheduleStatus: String(row.schedule_status || row.scheduleStatus || row.purpose || '').trim(),
        scheduleStatusKey: String(row.schedule_status_key || row.scheduleStatusKey || scheduleSlug(row.schedule_status || row.scheduleStatus || row.purpose || '')).trim(),
        purpose: String(row.purpose || '').trim(),
        scheduleDate: normalizeDate(row.schedule_date || row.scheduleDate || row.followup_date),
        scheduleDateKey: toDateKey(row.schedule_date || row.scheduleDate || row.followup_date),
        scheduleTime: normalizeTimeInput(row.schedule_time || row.scheduleTime || row.collection_time || ''),
        amount: Number(row.balance || row.amount || 0) || 0,
        customer: String(row.customer || '').trim(),
        branch: String(row.branch || '').trim(),
        assignedTo: explicitCaller || (canUseAssigneeAsCaller ? assigneeName : ''),
        assignedToId: canUseAssigneeAsCaller ? assigneeId : '',
        assignedRole: canUseAssigneeAsCaller ? assigneeRole : '',
        pickupAssignedTo: assigneeName,
        pickupAssignedToId: assigneeId,
        pickupAssignedRole: assigneeRole,
        committedBy: String(row.committed_by || row.committedBy || '').trim(),
        collectorName: String(row.collector_name || row.collectorName || '').trim(),
        followedUpBy: String(row.followed_up_by || row.followedUpBy || '').trim(),
        employeeName: String(row.employee_name || row.employeeName || '').trim(),
        createdBy: String(row.created_by || row.createdBy || '').trim(),
        updatedBy: String(row.updated_by || row.updatedBy || '').trim(),
        encodedBy: String(row.encoded_by || row.encodedBy || '').trim(),
        insertedBy: String(row.inserted_by || row.insertedBy || '').trim(),
        remarks: String(row.remarks || '').trim(),
        computer: String(row.pcname || row.computer_name || row.device_name || row.ipadd || row.computer || '').trim(),
        updatedAt: normalizeDate(row.updated_at || row.updatedAt || row.created_at)
    };
}

function upsertCollectionScheduleEntry(row = {}) {
    const entry = normalizeCollectionScheduleEntry(row);
    if (!entry.invoiceKey && !entry.customer && !entry.branch) return;

    collectionScheduleEntries = collectionScheduleEntries.filter((existing) => {
        if (entry.docId && existing.docId === entry.docId) return false;
        if (entry.invoiceKey && existing.invoiceKey === entry.invoiceKey) return false;
        return true;
    });
    collectionScheduleEntries.push(entry);
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

    const [companyDocs, branchDocs, contractDocs, contractDepDocs, machineDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', null, {
            fieldMask: ['id', 'companyname'],
            maxPages: 20
        }),
        firestoreGetAll('tbl_branchinfo', null, {
            fieldMask: ['id', 'company_id', 'branchname', 'branch_address', 'bldg', 'floor', 'street', 'brgy', 'city', 'email', 'inactive'],
            maxPages: 30
        }),
        firestoreGetAll('tbl_contractmain', null, {
            fieldMask: ['id', 'contract_id', 'mach_id', 'category_id', 'xserial'],
            maxPages: 40
        }),
        firestoreGetAll('tbl_contractdep', null, {
            fieldMask: ['id', 'branch_id', 'departmentname'],
            maxPages: 40
        }),
        firestoreGetAll('tbl_machine', null, {
            fieldMask: ['id', 'serial', 'model_id', 'description'],
            maxPages: 80
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
            id,
            name: getField(f, ['branchname']) || 'Main',
            companyId: String(getField(f, ['company_id']) || '').trim(),
            address: buildAddressText([
                getField(f, ['branch_address']),
                getField(f, ['bldg']),
                getField(f, ['floor']),
                getField(f, ['street']),
                getField(f, ['brgy']),
                getField(f, ['city'])
            ]),
            email: String(getField(f, ['email']) || '').trim(),
            inactive: Number(getField(f, ['inactive']) || 0) || 0
        };
    });

    contractDepMap = {};
    contractDepDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        contractDepMap[id] = {
            id,
            branchId: String(getField(f, ['branch_id']) || '').trim(),
            departmentName: String(getField(f, ['departmentname']) || '').trim()
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
            categoryId: getField(f, ['category_id']),
            xserial: String(getField(f, ['xserial']) || '').trim()
        };
    });

    machineMap = {};
    machineDocs.forEach((doc) => {
        const f = doc.fields || {};
        const id = String(getField(f, ['id']) || '').trim();
        if (!id) return;
        machineMap[id] = {
            serial: String(getField(f, ['serial']) || '').trim(),
            modelId: String(getField(f, ['model_id']) || '').trim(),
            description: String(getField(f, ['description']) || '').trim()
        };
    });

    updateLoadingStatus('Loading machine location map...');
    await buildMachineToBranchMap();

    updateLoadingStatus('Loading payment records...');
    const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus, {
        fieldMask: COLLECTION_PAYMENT_FIELD_MASK,
        maxPages: 260
    });
    const supplementalPaymentDocs = await loadSupplementalCollectionPaymentDocs();
    const mergedPaymentDocs = new Map();
    paymentDocs.concat(supplementalPaymentDocs).forEach((doc) => {
        const docKey = getFirestoreDocumentId(doc) || doc.name || JSON.stringify(doc.fields || {});
        mergedPaymentDocs.set(docKey, doc);
    });

    paidInvoiceIds = new Set();
    paymentEntries = [];
    draftPaymentEntries = [];
    const seenPaymentTokens = new Set();
    Array.from(mergedPaymentDocs.values()).forEach((doc) => {
        const f = doc.fields || {};
        const invoiceId = getField(f, ['invoice_id']);
        const invoiceNo = String(getField(f, ['invoice_num']) || '').trim();

        const amount = Number(getField(f, ['payment_amt']) || 0);
        const tax2307 = Number(getField(f, ['tax_2307']) || 0);
        const paymentStatus = String(getField(f, ['payment_status']) || '').trim();
        const isCancelled = Boolean(Number(getField(f, ['iscancel']) || 0)) || /^cancel/i.test(paymentStatus);
        if (isCancelled) return;
        const source = String(getField(f, ['source']) || '').trim();
        const isDraftPayment = /^draft/i.test(paymentStatus) || source === 'field_app_collection_payment_draft';
        const deductionType = String(getField(f, ['deduction_type']) || (tax2307 > 0 ? '2307' : '')).trim().toLowerCase();
        const deductionAmount = Number(getField(f, ['deduction_amount']) || tax2307 || 0);
        const otherDeductionAmount = Number(getField(f, ['other_deduction_amount']) || (deductionType && deductionType !== '2307' ? deductionAmount : 0) || 0);
        const taxStatus = String(getField(f, ['tax_status']) || '').trim();
        const taxFormStatus = String(getField(f, ['tax_form_status']) || '').trim().toLowerCase();
        const balanceAmountRaw = getField(f, ['balance_amt']);
        const balanceAmount = balanceAmountRaw !== null && balanceAmountRaw !== undefined ? Number(balanceAmountRaw) : null;
        const datePaid = normalizeDate(getField(f, ['date_paid']));
        const dateDeposit = normalizeDate(getField(f, ['date_deposit']));
        const taxDatePaid = normalizeDate(getField(f, ['tax_date_paid']));
        const paymentDate = datePaid || taxDatePaid || dateDeposit;
        const invoiceIdKey = invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '';
        const orNumber = String(getField(f, ['ornum', 'or_number']) || '').trim();
        if (isDraftPayment) {
            draftPaymentEntries.push({
                docId: getFirestoreDocumentId(doc),
                id: String(getField(f, ['id']) || getFirestoreDocumentId(doc) || '').trim(),
                invoiceId: invoiceIdKey,
                invoiceNo,
                client: String(getField(f, ['client']) || '').trim(),
                category: String(getField(f, ['category']) || '').trim(),
                invoiceAmount: Number(getField(f, ['invoice_amt']) || 0),
                invoiceDate: normalizeDate(getField(f, ['invoice_date'])),
                printedOr: String(getField(f, ['printed_or']) || '').trim(),
                assigned: String(getField(f, ['assigned']) || '').trim(),
                amount,
                balanceAmount,
                deductionType,
                deductionAmount,
                otherDeductionAmount,
                paymentDate,
                datePaid,
                dateDeposit,
                taxDatePaid,
                orNumber,
                paymentType: String(getField(f, ['payment_type']) || '').trim(),
                paymentStatus,
                tax2307,
                taxStatus,
                taxFormStatus,
                checkpaymentId: String(getField(f, ['checkpayment_id']) || '').trim(),
                checkNumber: String(getField(f, ['check_number']) || '').trim(),
                checkAmount: Number(getField(f, ['check_amt']) || 0),
                checkDate: normalizeDate(getField(f, ['check_date'])),
                accountBank: String(getField(f, ['account_bank']) || '').trim(),
                remarks: String(getField(f, ['remarks']) || '').trim(),
                source,
                scheduleId: String(getField(f, ['schedule_id']) || '').trim(),
                scheduleDocId: String(getField(f, ['schedule_doc_id']) || '').trim()
            });
            return;
        }
        if (balanceAmount !== null && Number(balanceAmount) <= 0.01 && (invoiceIdKey || invoiceNo)) {
            paidInvoiceIds.add(invoiceIdKey || invoiceNo);
        }
        if ((amount > 0 || tax2307 > 0 || deductionAmount > 0) && paymentDate) {
            const token = [
                invoiceIdKey,
                invoiceNo,
                amount.toFixed(2),
                tax2307.toFixed(2),
                deductionAmount.toFixed(2),
                balanceAmount !== null && Number.isFinite(Number(balanceAmount)) ? Number(balanceAmount).toFixed(2) : '',
                toDateKey(paymentDate),
                orNumber
            ].join('|');
            if (seenPaymentTokens.has(token)) return;
            seenPaymentTokens.add(token);
            paymentEntries.push({
                docId: getFirestoreDocumentId(doc),
                id: String(getField(f, ['id']) || getFirestoreDocumentId(doc) || '').trim(),
                invoiceId: invoiceIdKey,
                invoiceNo,
                client: String(getField(f, ['client']) || '').trim(),
                category: String(getField(f, ['category']) || '').trim(),
                invoiceAmount: Number(getField(f, ['invoice_amt']) || 0),
                invoiceDate: normalizeDate(getField(f, ['invoice_date'])),
                printedOr: String(getField(f, ['printed_or']) || '').trim(),
                assigned: String(getField(f, ['assigned']) || '').trim(),
                amount,
                balanceAmount,
                deductionType,
                deductionAmount,
                otherDeductionAmount,
                paymentDate,
                datePaid,
                dateDeposit,
                taxDatePaid,
                orNumber,
                paymentType: String(getField(f, ['payment_type']) || '').trim(),
                paymentStatus,
                tax2307,
                taxStatus,
                taxFormStatus,
                taxFormReceivedAt: normalizeDate(getField(f, ['tax_form_received_at'])),
                taxFormRemarks: String(getField(f, ['tax_form_remarks']) || '').trim(),
                checkpaymentId: String(getField(f, ['checkpayment_id']) || '').trim(),
                checkNumber: String(getField(f, ['check_number']) || '').trim(),
                checkAmount: Number(getField(f, ['check_amt']) || 0),
                checkDate: normalizeDate(getField(f, ['check_date'])),
                accountBank: String(getField(f, ['account_bank']) || '').trim(),
                remarks: String(getField(f, ['remarks']) || '').trim()
            });
        }
    });

    updateLoadingStatus('Loading collection history...');
    await loadCollectionHistory();
    updateLoadingStatus('Loading collection schedules...');
    await loadCollectionScheduleEntries();

    lookupsLoaded = true;
}

function buildMachineLabel(machineId, contractmainId) {
    const machine = String(machineId || '').trim();
    if (machine) return `Machine ${machine}`;
    return `Contract ${String(contractmainId || '').trim()}`;
}

function isMachineFallbackSerial(value) {
    return /^machine\s+\S+/i.test(String(value || '').trim());
}

function normalizeSerialNumber(value) {
    const serial = String(value || '').trim();
    if (!serial || isMachineFallbackSerial(serial)) return '';
    return serial;
}

function displaySerialNumber(value) {
    return normalizeSerialNumber(value) || 'No serial on file';
}

function buildCollectorRowKey(machineId, contractmainId) {
    const contractId = String(contractmainId || '').trim();
    if (contractId) return `contract:${contractId}`;
    const machine = String(machineId || '').trim();
    if (machine) return `machine:${machine}`;
    return `contract:unknown`;
}

function resolveSerialLabel(contract) {
    const contractSerial = normalizeSerialNumber(contract?.xserial);
    if (contractSerial) return contractSerial;
    const machId = String(contract?.machId || '').trim();
    const machineSerial = normalizeSerialNumber(machineMap[machId]?.serial);
    if (machineSerial) return machineSerial;
    return '';
}

function resolveContractBranch(contract) {
    const contractDepId = String(contract?.contractId || '').trim();
    const contractDep = contractDepMap[contractDepId] || null;
    const directBranchId = String(contractDep?.branchId || contract?.contractId || '').trim();
    const directBranch = branchMap[directBranchId];

    if (directBranch) {
        const departmentName = String(contractDep?.departmentName || '').trim();
        if (!departmentName) return directBranch;

        const baseName = String(directBranch.name || 'Main').trim() || 'Main';
        const normalizedBase = baseName.toLowerCase();
        const normalizedDept = departmentName.toLowerCase();
        return {
            ...directBranch,
            name: normalizedBase.includes(normalizedDept)
                ? baseName
                : `${baseName} - ${departmentName}`
        };
    }

    const machId = String(contract?.machId || '').trim();
    const fallbackBranchId = String(machToBranchMap[machId] || '').trim();
    const fallbackBranch = fallbackBranchId ? branchMap[fallbackBranchId] : null;
    if (fallbackBranch) return fallbackBranch;

    const unresolvedBranchId = directBranchId || fallbackBranchId || contractDepId;
    if (unresolvedBranchId) {
        return {
            id: `unlinked:${unresolvedBranchId}`,
            companyId: `unlinked:${unresolvedBranchId}`,
            name: `Unlinked Branch ${unresolvedBranchId}`,
            companyNameOverride: 'Unlinked in Firebase'
        };
    }

    return null;
}

function getBillingLocation(contractmainId) {
    const contract = contractMap[String(contractmainId || '').trim()] || {};
    const branch = resolveContractBranch(contract);
    const companyName = branch?.companyNameOverride || companyMap[String(branch?.companyId || '').trim()] || 'Unknown';
    const branchName = branch?.name || 'Main';
    const machId = String(contract.machId || '').trim();
    const machine = machineMap[machId] || {};

    return {
        companyName,
        branchName,
        accountLabel: buildAccountLabel(companyName, branchName),
        categoryCode: getCategoryCode(contract.categoryId),
        companyId: String(branch?.companyId || '').trim(),
        branchId: String(branch?.id || '').trim(),
        machineId: machId,
        contractmainId: String(contractmainId || '').trim(),
        serialNumber: resolveSerialLabel({ ...contract, id: contractmainId }),
        modelName: String(machine.description || '').trim(),
        machineLabel: buildMachineLabel(contract.machId, contractmainId)
    };
}

function getBillingLocationFromFields(fields, contractmainId) {
    const base = getBillingLocation(contractmainId);
    const companyName = String(getField(fields, ['company_name', 'account_name']) || base.companyName || 'Unknown').trim() || 'Unknown';
    const branchName = String(getField(fields, ['branch_name']) || base.branchName || 'Main').trim() || 'Main';
    const machineId = String(getField(fields, ['machine_id']) || base.machineId || '').trim();
    const serialNumber = String(getField(fields, ['serial_number']) || base.serialNumber || '').trim();
    const modelName = String(getField(fields, ['machine_model', 'printer_model']) || base.modelName || '').trim();

    return {
        ...base,
        companyName,
        branchName,
        accountLabel: String(getField(fields, ['account_name', 'display_name']) || buildAccountLabel(companyName, branchName)).trim(),
        categoryCode: String(getField(fields, ['category_code']) || base.categoryCode || getCategoryCode(getField(fields, ['category_id']))).trim(),
        companyId: String(getField(fields, ['company_id']) || base.companyId || '').trim(),
        branchId: String(getField(fields, ['branch_id']) || base.branchId || '').trim(),
        machineId,
        contractmainId: String(contractmainId || '').trim(),
        serialNumber,
        modelName,
        machineLabel: String(getField(fields, ['machine_label']) || base.machineLabel || buildMachineLabel(machineId, contractmainId)).trim()
    };
}

function buildAccountLabel(companyName, branchName) {
    const company = String(companyName || '').trim();
    const branch = String(branchName || '').trim();

    if (!branch || branch.toLowerCase() === 'main') return company || 'Unknown';
    if (!company) return branch;

    const normalize = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const companyLower = normalize(company);
    const branchLower = normalize(branch);

    if (branchLower.includes(companyLower) || companyLower.includes(branchLower)) {
        return branch;
    }

    return `${company} - ${branch}`;
}

function processInvoice(doc) {
    const f = doc.fields || {};

    const invoiceId = getField(f, ['invoice_id', 'invoiceid']);
    const invoiceNo = getField(f, ['invoiceno', 'invoice_no', 'invoice_num', 'invoice_number', 'invoice_id', 'id']);

    const invoiceIdKey = invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '';
    const invoiceNoKey = invoiceNo !== null && invoiceNo !== undefined ? String(invoiceNo).trim() : '';

    if (!invoiceIdKey && !invoiceNoKey) return null;
    if (paidInvoiceIds.has(invoiceIdKey) || paidInvoiceIds.has(invoiceNoKey)) return null;

    const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
    const location = getBillingLocationFromFields(f, contractmainId);

    const month = getField(f, ['month']);
    const year = getField(f, ['year']);
    const dueDate = getField(f, ['due_date']);
    const invoiceDateRaw = getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex']);
    const invoiceDate = normalizeDate(invoiceDateRaw);
    const dateReceived = normalizeDate(getField(f, ['date_received']));
    const receivedBy = String(getField(f, ['receivedby']) || '').trim();
    const billingContactNumber = getField(f, ['contact_number']) || '';

    const age = calculateAge(dueDate, month, year);
    const totalAmount = Number(getField(f, ['totalamount', 'amount']) || 0);

    const history = getHistoryForInvoice(invoiceIdKey, invoiceNoKey);
    const lastHistory = history.length > 0 ? history[0] : null;
    const historyContact = history.find((entry) => hasMeaningfulContact(entry.contactNumber))?.contactNumber || '';
    const lastContactDate = lastHistory ? lastHistory.callDate : null;
    const lastContactDays = lastContactDate ? Math.max(0, daysBetween(lastContactDate, new Date())) : null;

    return {
        id: getField(f, ['id']),
        invoiceId: invoiceIdKey || invoiceNoKey,
        invoiceNo: invoiceNoKey || invoiceIdKey,
        invoiceKey: invoiceNoKey || invoiceIdKey,
        amount: totalAmount,
        month,
        year,
        monthYear: month && year ? `${month} ${year}` : '-',
        invoiceDate,
        invoiceDateRaw,
        dueDate,
        dateReceived,
        receivedBy,
        billingStatus: getField(f, ['status']),
        billingLocation: getField(f, ['location']),
        billingRemarks: getField(f, ['remarks']),
        age,
        priority: getPriority(age),
        company: location.companyName,
        branch: location.branchName,
        accountLabel: location.accountLabel,
        companyId: location.companyId,
        branchId: location.branchId,
        machineId: location.machineId,
        contractmainId: location.contractmainId,
        serialNumber: location.serialNumber,
        modelName: location.modelName,
        machineLabel: location.machineLabel,
        contactNumber: billingContactNumber || historyContact || '',
        category: location.categoryCode,
        lastRemarks: lastHistory ? lastHistory.remarks : null,
        lastContactDate,
        lastContactDays,
        nextFollowup: lastHistory ? lastHistory.followupDate : null,
        historyCount: history.length,
        history
    };
}

function rebuildPaidInvoiceIdsFromPayments() {
    paidInvoiceIds = new Set();
    paymentEntries.forEach((payment) => {
        if (Number(payment.balanceAmount || 0) > 0.01) return;
        const invoiceId = String(payment.invoiceId || '').trim();
        const invoiceNo = String(payment.invoiceNo || '').trim();
        if (invoiceId) paidInvoiceIds.add(invoiceId);
        if (invoiceNo) paidInvoiceIds.add(invoiceNo);
    });
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

function getCollectionBillingYearsToQuery() {
    const years = new Set();
    const today = new Date();
    const matrixEnd = startOfMonth(new Date(today.getFullYear(), 11, 1));
    let cursor = startOfMonth(COLLECTOR_DASHBOARD_START);

    while (cursor && matrixEnd && cursor <= matrixEnd) {
        years.add(String(cursor.getFullYear()));
        cursor = addMonths(cursor, 1);
    }

    return Array.from(years);
}

function mergeFirestoreDocsByName(docGroups = []) {
    const byName = new Map();
    docGroups.flat().forEach((doc) => {
        const key = String(doc?.name || getFirestoreDocumentId(doc) || '').trim();
        if (!key) return;
        byName.set(key, doc);
    });
    return Array.from(byName.values());
}

function collectionBillingDocKey(doc) {
    const f = doc?.fields || {};
    const docId = String(doc?.name || getFirestoreDocumentId(doc) || '').trim();
    const invoiceNo = String(getField(f, ['invoiceno', 'invoice_no', 'invoice_num', 'invoice_number']) || '').trim();
    const invoiceId = String(getField(f, ['invoice_id', 'invoiceid', 'id']) || '').trim();
    return docId || invoiceNo || invoiceId;
}

function buildCollectorBillingRecordFromDoc(doc) {
    const f = doc?.fields || {};
    const invoiceIdRaw = getField(f, ['invoice_id', 'invoiceid']);
    const invoiceId = invoiceIdRaw !== null && invoiceIdRaw !== undefined ? String(invoiceIdRaw).trim() : '';
    const invoiceNoRaw = getField(f, ['invoiceno', 'invoice_no', 'invoice_num', 'invoice_number', 'invoice_id', 'id']);
    const invoiceNo = invoiceNoRaw !== null && invoiceNoRaw !== undefined ? String(invoiceNoRaw).trim() : '';
    const billingMonth = getField(f, ['month']);
    const billingYear = getField(f, ['year']);
    const invoiceDate = normalizeDate(getField(f, ['dateprinted', 'date_printed', 'invdate', 'invoice_date', 'datex', 'due_date']));
    const dueDate = normalizeDate(getField(f, ['due_date']));
    const billingPeriodMonthKey = getBillingPeriodMonthKey(billingMonth, billingYear, invoiceDate);
    const dateReceived = normalizeDate(getField(f, ['date_received']));
    const receivedBy = String(getField(f, ['receivedby']) || '').trim();
    const amount = Number(getField(f, ['totalamount', 'amount']) || 0);
    const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
    const location = getBillingLocationFromFields(f, contractmainId);
    const billingMeta = {
        company: location.companyName,
        branch: location.branchName,
        accountLabel: location.accountLabel,
        invoiceDate,
        dueDate,
        month: billingMonth,
        year: billingYear
    };

    const record = invoiceDate && amount > 0 ? {
        docKey: collectionBillingDocKey(doc),
        invoiceId,
        invoiceNo: invoiceNo || invoiceId,
        invoiceKey: invoiceNo || invoiceId,
        company: location.companyName,
        branch: location.branchName,
        accountLabel: location.accountLabel,
        companyId: location.companyId,
        branchId: location.branchId,
        machineId: location.machineId,
        contractmainId: location.contractmainId,
        serialNumber: location.serialNumber,
        modelName: location.modelName,
        machineLabel: location.machineLabel,
        invoiceDate,
        dueDate,
        dateReceived,
        receivedBy,
        billingStatus: getField(f, ['status']),
        billingLocation: getField(f, ['location']),
        billingRemarks: getField(f, ['remarks']),
        amount,
        rd: invoiceDate.getDate(),
        monthKey: billingPeriodMonthKey
    } : null;

    return {
        invoiceId,
        invoiceNo,
        billingMeta,
        billingMonth,
        billingYear,
        invoiceDate,
        amount,
        record
    };
}

function ingestCollectorBillingRecord(record) {
    if (!record) return false;
    const key = [
        record.docKey,
        record.invoiceNo,
        record.invoiceId,
        record.contractmainId,
        record.machineId,
        record.monthKey,
        record.amount
    ].filter(Boolean).join('|');
    if (!key || collectorBillingRecordKeys.has(key)) return false;
    collectorBillingRecordKeys.add(key);
    collectorBillingRecords.push(record);
    billingEntriesForDuration.push({
        invoiceDate: record.invoiceDate,
        amount: record.amount,
        isPaid: record.invoiceId ? paidInvoiceIds.has(record.invoiceId) : false
    });
    return true;
}

async function queryCollectionBillingDocsByInvoice(invoiceNo) {
    const normalizedInvoice = normalizeCollectorInvoiceSearchValue(invoiceNo);
    if (!normalizedInvoice) return [];

    const queryPairs = [
        ['invoice_no', normalizedInvoice],
        ['invoiceno', normalizedInvoice],
        ['invoice_num', normalizedInvoice],
        ['invoice_number', normalizedInvoice],
        ['invoice_id', normalizedInvoice],
        ['invoiceid', normalizedInvoice],
        ['id', normalizedInvoice]
    ];

    if (/^\d+$/.test(normalizedInvoice)) {
        const numericInvoice = Number(normalizedInvoice);
        queryPairs.push(
            ['invoice_id', numericInvoice],
            ['invoiceid', numericInvoice],
            ['id', numericInvoice]
        );
    }

    const byKey = new Map();
    const settled = await Promise.allSettled(queryPairs.map(([fieldPath, value]) => (
        firestoreQueryEquals('tbl_billing', fieldPath, value, {
            fieldMask: COLLECTION_BILLING_FIELD_MASK,
            limit: 24
        })
    )));
    settled.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.forEach((doc) => {
            const key = collectionBillingDocKey(doc);
            if (key) byKey.set(key, doc);
        });
    });
    return Array.from(byKey.values());
}

function collectionPaymentEntryToken(entry) {
    return [
        entry.docId,
        entry.invoiceId,
        entry.invoiceNo,
        Number(entry.amount || 0).toFixed(2),
        Number(entry.tax2307 || 0).toFixed(2),
        entry.paymentDate ? toDateKey(entry.paymentDate) : '',
        entry.orNumber
    ].join('|');
}

function buildCollectionPaymentEntryFromDoc(doc) {
    const f = doc.fields || {};
    const paymentStatus = String(getField(f, ['payment_status']) || '').trim();
    const isCancelled = Boolean(Number(getField(f, ['iscancel']) || 0)) || /^cancel/i.test(paymentStatus);
    if (isCancelled) return null;

    const source = String(getField(f, ['source']) || '').trim();
    const isDraftPayment = /^draft/i.test(paymentStatus) || source === 'field_app_collection_payment_draft';
    if (isDraftPayment) return null;

    const invoiceId = getField(f, ['invoice_id']);
    const invoiceIdKey = invoiceId !== null && invoiceId !== undefined ? String(invoiceId).trim() : '';
    const invoiceNo = String(getField(f, ['invoice_num']) || '').trim();
    const amount = Number(getField(f, ['payment_amt']) || 0);
    const tax2307 = Number(getField(f, ['tax_2307']) || 0);
    const deductionType = String(getField(f, ['deduction_type']) || (tax2307 > 0 ? '2307' : '')).trim().toLowerCase();
    const deductionAmount = Number(getField(f, ['deduction_amount']) || tax2307 || 0);
    const otherDeductionAmount = Number(getField(f, ['other_deduction_amount']) || (deductionType && deductionType !== '2307' ? deductionAmount : 0) || 0);
    const balanceAmountRaw = getField(f, ['balance_amt']);
    const balanceAmount = balanceAmountRaw !== null && balanceAmountRaw !== undefined ? Number(balanceAmountRaw) : null;
    const datePaid = normalizeDate(getField(f, ['date_paid']));
    const dateDeposit = normalizeDate(getField(f, ['date_deposit']));
    const taxDatePaid = normalizeDate(getField(f, ['tax_date_paid']));
    const paymentDate = datePaid || taxDatePaid || dateDeposit;
    if (!(amount > 0 || tax2307 > 0 || deductionAmount > 0) && !paymentDate) return null;

    return {
        docId: getFirestoreDocumentId(doc),
        id: String(getField(f, ['id']) || getFirestoreDocumentId(doc) || '').trim(),
        invoiceId: invoiceIdKey,
        invoiceNo,
        client: String(getField(f, ['client']) || '').trim(),
        category: String(getField(f, ['category']) || '').trim(),
        invoiceAmount: Number(getField(f, ['invoice_amt']) || 0),
        invoiceDate: normalizeDate(getField(f, ['invoice_date'])),
        printedOr: String(getField(f, ['printed_or']) || '').trim(),
        assigned: String(getField(f, ['assigned']) || '').trim(),
        amount,
        balanceAmount,
        deductionType,
        deductionAmount,
        otherDeductionAmount,
        paymentDate,
        datePaid,
        dateDeposit,
        taxDatePaid,
        orNumber: String(getField(f, ['ornum', 'or_number']) || '').trim(),
        paymentType: String(getField(f, ['payment_type']) || '').trim(),
        paymentStatus,
        tax2307,
        taxStatus: String(getField(f, ['tax_status']) || '').trim(),
        taxFormStatus: String(getField(f, ['tax_form_status']) || '').trim().toLowerCase(),
        taxFormReceivedAt: normalizeDate(getField(f, ['tax_form_received_at'])),
        taxFormRemarks: String(getField(f, ['tax_form_remarks']) || '').trim(),
        checkpaymentId: String(getField(f, ['checkpayment_id']) || '').trim(),
        checkNumber: String(getField(f, ['check_number']) || '').trim(),
        checkAmount: Number(getField(f, ['check_amt']) || 0),
        checkDate: normalizeDate(getField(f, ['check_date'])),
        accountBank: String(getField(f, ['account_bank']) || '').trim(),
        remarks: String(getField(f, ['remarks']) || '').trim(),
        source,
        scheduleId: String(getField(f, ['schedule_id']) || '').trim(),
        scheduleDocId: String(getField(f, ['schedule_doc_id']) || '').trim()
    };
}

async function queryCollectionPaymentDocsByInvoice(invoiceKey) {
    const normalizedInvoice = normalizeCollectorInvoiceSearchValue(invoiceKey);
    if (!normalizedInvoice) return [];
    const queryPairs = [
        ['invoice_num', normalizedInvoice],
        ['invoice_id', normalizedInvoice]
    ];
    if (/^\d+$/.test(normalizedInvoice)) {
        queryPairs.push(['invoice_id', Number(normalizedInvoice)]);
    }

    const byKey = new Map();
    const settled = await Promise.allSettled(queryPairs.map(([fieldPath, value]) => (
        firestoreQueryEquals('tbl_paymentinfo', fieldPath, value, {
            fieldMask: COLLECTION_PAYMENT_FIELD_MASK,
            limit: 40
        })
    )));
    settled.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.forEach((doc) => {
            const key = getFirestoreDocumentId(doc) || doc.name || JSON.stringify(doc.fields || {});
            if (key) byKey.set(key, doc);
        });
    });
    return Array.from(byKey.values());
}

async function ensureCollectorCellDetailData(cell) {
    if (!cell) return;
    const invoiceKeys = Array.from(new Set((cell.records || [])
        .flatMap((record) => [record.invoiceNo, record.invoiceId, record.invoiceKey, record.id])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
    if (!invoiceKeys.length) return;

    const billingDocs = (await Promise.all(invoiceKeys.map((key) => queryCollectionBillingDocsByInvoice(key)))).flat();
    let changedInvoices = false;
    billingDocs.forEach((doc) => {
        const detail = buildCollectorBillingRecordFromDoc(doc);
        if (detail.invoiceId) billingMetaByInvoiceKey.set(detail.invoiceId, detail.billingMeta);
        if (detail.invoiceNo) billingMetaByInvoiceKey.set(detail.invoiceNo, detail.billingMeta);
        changedInvoices = ingestCollectorBillingRecord(detail.record) || changedInvoices;

        const invoice = processInvoice(doc);
        if (invoice && !allInvoices.some((item) => (
            item.invoiceKey === invoice.invoiceKey
            || item.invoiceNo === invoice.invoiceNo
            || item.invoiceId === invoice.invoiceId
        ))) {
            allInvoices.push(invoice);
            changedInvoices = true;
        }
    });

    const paymentDocs = (await Promise.all(invoiceKeys.map((key) => queryCollectionPaymentDocsByInvoice(key)))).flat();
    const existingPaymentTokens = new Set(paymentEntries.map(collectionPaymentEntryToken));
    paymentDocs.forEach((doc) => {
        const entry = buildCollectionPaymentEntryFromDoc(doc);
        if (!entry) return;
        const token = collectionPaymentEntryToken(entry);
        if (existingPaymentTokens.has(token)) return;
        existingPaymentTokens.add(token);
        paymentEntries.push(entry);
        if (entry.balanceAmount !== null && Number(entry.balanceAmount) <= 0.01) {
            if (entry.invoiceId) paidInvoiceIds.add(entry.invoiceId);
            if (entry.invoiceNo) paidInvoiceIds.add(entry.invoiceNo);
        }
    });

    if (changedInvoices) rebuildInvoiceIndex();
}

async function ensureCollectorInvoiceSearchSupplement() {
    const term = getCollectorInvoiceSearchTerm();
    const normalizedTerm = normalizeCollectorInvoiceSearchValue(term);
    if (!lastLoadSucceeded || !normalizedTerm || normalizedTerm.length < 3) return;
    if (collectorInvoiceSearchSupplementedTerms.has(normalizedTerm)) return;
    if (collectorInvoiceSearchSupplementPromise && collectorInvoiceSearchSupplementTerm === normalizedTerm) {
        await collectorInvoiceSearchSupplementPromise;
        return;
    }

    collectorInvoiceSearchSupplementTerm = normalizedTerm;
    collectorInvoiceSearchSupplementPromise = (async () => {
        const docs = await queryCollectionBillingDocsByInvoice(normalizedTerm);
        let changed = false;
        docs.forEach((doc) => {
            const detail = buildCollectorBillingRecordFromDoc(doc);
            if (detail.invoiceId) billingMetaByInvoiceKey.set(detail.invoiceId, detail.billingMeta);
            if (detail.invoiceNo) billingMetaByInvoiceKey.set(detail.invoiceNo, detail.billingMeta);
            changed = ingestCollectorBillingRecord(detail.record) || changed;

            const invoice = processInvoice(doc);
            if (invoice && !allInvoices.some((item) => item.invoiceKey === invoice.invoiceKey || item.invoiceNo === invoice.invoiceNo)) {
                allInvoices.push(invoice);
                changed = true;
            }
        });
        collectorInvoiceSearchSupplementedTerms.add(normalizedTerm);
        if (changed) {
            rebuildInvoiceIndex();
            collectorDashboardData = null;
            await renderCollectorDashboard({ recompute: true });
        }
    })().catch((error) => {
        console.warn(`Unable to supplement collection invoice search for ${normalizedTerm}.`, error);
    }).finally(() => {
        collectorInvoiceSearchSupplementPromise = null;
    });

    await collectorInvoiceSearchSupplementPromise;
}

function queueCollectorInvoiceSearchSupplement() {
    window.clearTimeout(collectorInvoiceSearchSupplementTimer);
    collectorInvoiceSearchSupplementTimer = window.setTimeout(() => {
        void ensureCollectorInvoiceSearchSupplement();
    }, 300);
}

async function loadCollectionBillingDocs(statusCallback = null) {
    const baseDocs = await firestoreGetAll('tbl_billing', statusCallback, {
        fieldMask: COLLECTION_BILLING_FIELD_MASK,
        maxPages: 320
    });

    const years = getCollectionBillingYearsToQuery();
    const supplementalQueries = years.flatMap((year) => ([
        firestoreQueryEquals('tbl_billing', 'year', year, { fieldMask: COLLECTION_BILLING_FIELD_MASK }).catch((error) => {
            console.warn(`Unable to load supplemental billing year ${year}.`, error);
            return [];
        }),
        firestoreQueryEquals('tbl_billing', 'year', Number(year), { fieldMask: COLLECTION_BILLING_FIELD_MASK }).catch((error) => {
            console.warn(`Unable to load supplemental billing numeric year ${year}.`, error);
            return [];
        })
    ]));

    if (statusCallback) statusCallback('Loading supplemental billing records for active collection years...');
    const supplementalDocs = await Promise.all(supplementalQueries);
    const merged = mergeFirestoreDocsByName([baseDocs, ...supplementalDocs]);
    if (statusCallback && merged.length > baseDocs.length) {
        statusCallback(`Loading tbl_billing... ${merged.length.toLocaleString()} including year query supplement`);
    }
    return merged;
}

async function loadInvoices(mode) {
    if (!collectionsFullScanAuthorized) {
        console.warn('Collections full scan blocked until Load Data is clicked.');
        renderDeferredCollectionsWorkspaceNote();
        return false;
    }

    dataMode = mode;
    const isAllMode = mode === 'all';
    lastLoadSucceeded = false;

    document.getElementById('btnShowBadDebt')?.classList.toggle('active', isAllMode);
    hideLoadError();

    try {
        await loadLookups();

        updateLoadingStatus(isAllMode ? 'Loading all billing records...' : 'Loading active billing records...');
        const billingDocs = await loadCollectionBillingDocs(updateLoadingStatus);

        allInvoices = [];
        billingEntriesForDuration = [];
        billingMetaByInvoiceKey = new Map();
        collectorBillingRecords = [];
        collectorBillingRecordKeys = new Set();
        collectorInvoiceSearchSupplementedTerms.clear();
        const years = new Set();

        billingDocs.forEach((doc) => {
            const detail = buildCollectorBillingRecordFromDoc(doc);

            if (detail.invoiceId) billingMetaByInvoiceKey.set(detail.invoiceId, detail.billingMeta);
            if (detail.invoiceNo) billingMetaByInvoiceKey.set(detail.invoiceNo, detail.billingMeta);
            ingestCollectorBillingRecord(detail.record);

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

        collectorDashboardData = null;
        currentPage = 1;
        await recomputeFilteredInvoices();

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
    if (!collectionsFullScanAuthorized) {
        window.alert('Click Load Data first to scan billing and payment records.');
        return;
    }
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

function getWorkQueueModeLabel(mode) {
    const labels = {
        scheduled_today: 'Scheduled Today',
        promise_due: 'Promise Due Today',
        urgent_stale: 'Urgent 20+ Days No Call',
        missing_contact: 'Missing Contact / No Call Log',
        promise_today: 'Promise-to-Pay Today',
        broken_promise: 'Broken Promise-to-Pay',
        followup_today: 'Follow-up Scheduled Today',
        needs_document: 'Needs Document',
        billing_received_unfollowed: 'Billing Received Not Yet Followed Up',
        top_collectible: 'Top Collectible Accounts',
        overdue_accounts: 'Overdue Accounts',
        for_approval: 'For Approval'
    };
    return labels[mode] || 'All priorities';
}

function invoiceKeySetFromRows(rows = []) {
    return new Set(rows.map((invoice) => String(invoice.invoiceKey || invoice.invoiceNo || invoice.invoiceId || '').trim()).filter(Boolean));
}

function getLatestHistoryForInvoice(invoice) {
    const history = Array.isArray(invoice?.history) && invoice.history.length
        ? invoice.history
        : getHistoryForInvoice(invoice?.invoiceNo, invoice?.invoiceId, invoice?.invoiceKey);
    return history[0] || null;
}

function getHistoryPromisedAmount(entry, invoice) {
    const amount = Number(entry?.promiseToPayAmount || entry?.paymentAmount || 0);
    return amount > 0 ? amount : Number(invoice?.amount || 0) || 0;
}

function hasRealReceivedDate(value) {
    return Boolean(toDateKey(value));
}

function cellHasRealReceivedInvoice(cell = {}) {
    const records = Array.isArray(cell.records) ? cell.records : [];
    if (records.some((record) => hasRealReceivedDate(record.dateReceived))) return true;
    return hasRealReceivedDate(cell.dateReceived);
}

function getCollectorRowOpenCells(row = {}) {
    return Object.values(row.months || {})
        .map((cellId) => collectorCellMap.get(String(cellId || '').trim()))
        .filter((cell) => {
            if (!cell) return false;
            const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
            const outstanding = getCellOutstandingBalance(cell);
            return (billedTarget > 0 || cell.pendingBilling || cell.missedReading) && Number(cell.collectedTotal || 0) <= 0 && outstanding > 0.01;
        });
}

function getCollectorRowOpenAmount(row = {}) {
    return getCollectorRowOpenCells(row).reduce((sum, cell) => {
        const outstanding = getCellOutstandingBalance(cell);
        const projected = Number(cell.pendingBillingProjectionTotal || 0);
        const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
        return sum + Math.max(outstanding, projected, billedTarget, 0);
    }, 0);
}

function getCollectorRowLatestHistory(row = {}) {
    const histories = [
        row.latestHistory,
        ...Object.values(row.months || {}).map((cellId) => collectorCellMap.get(String(cellId || '').trim())?.latestHistory)
    ].filter(Boolean);
    histories.sort((left, right) => {
        const leftDate = normalizeDate(left.callDate || left.callDateRaw) || new Date(0);
        const rightDate = normalizeDate(right.callDate || right.callDateRaw) || new Date(0);
        const leftTime = leftDate.getTime();
        const rightTime = rightDate.getTime();
        return rightTime - leftTime;
    });
    return histories[0] || null;
}

function getCollectorRowsForPriorityCards() {
    return (collectorDashboardData?.customerRows || []).filter((row) => !row.isGroupedChild);
}

function getMatrixPriorityRowsForMode(mode) {
    const todayKey = toDateKey(new Date());
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const rows = getCollectorRowsForPriorityCards();

    if (mode === 'promise_today') {
        return rows.filter((row) => {
            const entry = getCollectorRowLatestHistory(row);
            return entry?.promiseToPay === 'Promised to Pay' && (entry.promiseToPayDateKey || entry.followupDateKey) === todayKey;
        });
    }

    if (mode === 'broken_promise') {
        return rows.filter((row) => {
            const entry = getCollectorRowLatestHistory(row);
            if (!entry) return false;
            if (entry.promiseToPay === 'Broken Promise') return true;
            const promiseDate = entry.promiseToPayDate || entry.followupDate;
            return ['Promised to Pay', 'Rescheduled Promise'].includes(entry.promiseToPay) && promiseDate && promiseDate < now;
        });
    }

    if (mode === 'followup_today') {
        return rows.filter((row) => getCollectorRowLatestHistory(row)?.followupDateKey === todayKey);
    }

    if (mode === 'needs_document') {
        return rows.filter((row) => DOCUMENT_ISSUE_TYPES.has(getCollectorRowLatestHistory(row)?.issueType || ''));
    }

    if (mode === 'billing_received_unfollowed') {
        return rows.filter((row) => {
            return getCollectorRowOpenCells(row).some((cell) => cellHasRealReceivedInvoice(cell) && !cell.latestHistory?.callDate);
        });
    }

    if (mode === 'top_collectible') {
        return rows
            .map((row) => ({ row, amount: getCollectorRowOpenAmount(row) }))
            .filter((item) => item.amount > 0.01)
            .sort((left, right) => right.amount - left.amount)
            .slice(0, 25)
            .map((item) => item.row);
    }

    if (mode === 'overdue_accounts') {
        return rows
            .filter((row) => getCollectorRowOpenAmount(row) > 0.01)
            .sort((left, right) => getCollectorRowOpenAmount(right) - getCollectorRowOpenAmount(left));
    }

    if (mode === 'for_approval') {
        return rows.filter((row) => {
            const entry = getCollectorRowLatestHistory(row);
            return entry?.promiseToPay === 'For Approval Only' || entry?.issueType === 'For Approval';
        });
    }

    return [];
}

function getPriorityRowsForMode(mode) {
    if (!allInvoices.length && collectorDashboardData) return getMatrixPriorityRowsForMode(mode);

    const todayKey = toDateKey(new Date());
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (mode === 'promise_today') {
        return allInvoices.filter((invoice) => {
            const entry = getLatestHistoryForInvoice(invoice);
            return entry?.promiseToPay === 'Promised to Pay' && (entry.promiseToPayDateKey || entry.followupDateKey) === todayKey;
        });
    }

    if (mode === 'broken_promise') {
        return allInvoices.filter((invoice) => {
            const entry = getLatestHistoryForInvoice(invoice);
            if (!entry) return false;
            if (entry.promiseToPay === 'Broken Promise') return true;
            const promiseDate = entry.promiseToPayDate || entry.followupDate;
            return ['Promised to Pay', 'Rescheduled Promise'].includes(entry.promiseToPay) && promiseDate && promiseDate < now;
        });
    }

    if (mode === 'followup_today') {
        return allInvoices.filter((invoice) => getLatestHistoryForInvoice(invoice)?.followupDateKey === todayKey);
    }

    if (mode === 'needs_document') {
        return allInvoices.filter((invoice) => DOCUMENT_ISSUE_TYPES.has(getLatestHistoryForInvoice(invoice)?.issueType || ''));
    }

    if (mode === 'billing_received_unfollowed') {
        return allInvoices.filter((invoice) => {
            const entry = getLatestHistoryForInvoice(invoice);
            return hasRealReceivedDate(invoice.dateReceived) && (!entry || !entry.callDate);
        });
    }

    if (mode === 'top_collectible') {
        return [...allInvoices].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 25);
    }

    if (mode === 'overdue_accounts') {
        return allInvoices.filter((invoice) => Number(invoice.age || 0) > 0).sort((a, b) => b.age - a.age || b.amount - a.amount);
    }

    if (mode === 'for_approval') {
        return allInvoices.filter((invoice) => {
            const entry = getLatestHistoryForInvoice(invoice);
            return entry?.promiseToPay === 'For Approval Only' || entry?.issueType === 'For Approval';
        });
    }

    return [];
}

function getPriorityMetricAmount(mode, invoice) {
    if (invoice?.rowId && collectorDashboardData) {
        const entry = getCollectorRowLatestHistory(invoice);
        if (mode === 'promise_today' || mode === 'broken_promise') {
            const promised = Number(entry?.promiseToPayAmount || entry?.paymentAmount || 0);
            return promised > 0 ? promised : getCollectorRowOpenAmount(invoice);
        }
        return getCollectorRowOpenAmount(invoice);
    }
    const entry = getLatestHistoryForInvoice(invoice);
    if (mode === 'promise_today' || mode === 'broken_promise') return getHistoryPromisedAmount(entry, invoice);
    return Number(invoice?.amount || 0) || 0;
}

function isCollectionPriorityCardMode(mode) {
    return COLLECTION_PRIORITY_CARD_DEFINITIONS.some((card) => card.mode === mode);
}

function getAllowedPriorityModesForCurrentLane() {
    const role = getCurrentCollectionRoleAssignment();
    const modes = COLLECTION_ROLE_PRIORITY_MODES[role];
    return new Set(modes || COLLECTION_ROLE_PRIORITY_MODES.collection_head);
}

function isPriorityModeAllowedForCurrentLane(mode) {
    if (!isCollectionPriorityCardMode(mode)) return true;
    return getAllowedPriorityModesForCurrentLane().has(mode);
}

function getPriorityCardDefinition(mode) {
    return COLLECTION_PRIORITY_CARD_DEFINITIONS.find((card) => card.mode === mode) || null;
}

function getPriorityWorklistCellsForRow(row = {}, mode = currentWorkQueueMode) {
    const cells = getCollectorRowOpenCells(row);
    if (mode === 'billing_received_unfollowed') {
        return cells.filter((cell) => cellHasRealReceivedInvoice(cell) && !cell.latestHistory?.callDate);
    }
    return cells;
}

function getPriorityCellAmount(cell = {}) {
    const outstanding = getCellOutstandingBalance(cell);
    const projected = Number(cell.pendingBillingProjectionTotal || 0);
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    return Math.max(outstanding, projected, billedTarget, 0);
}

function getPriorityRecordAmount(record = {}, cell = {}) {
    const latestBalance = record.latestBalanceAmount !== null && record.latestBalanceAmount !== undefined
        ? Number(record.latestBalanceAmount)
        : 0;
    const recordBalance = latestBalance > 0 ? latestBalance : getCollectorRecordOutstandingBalance(record);
    if (recordBalance > 0) return recordBalance;
    return Number(record.billedAmount || record.amount || 0) || getPriorityCellAmount(cell);
}

function getPriorityWorklistMonthColumns(items = []) {
    const available = new Map((collectorDashboardData?.monthColumns || []).map((column) => [column.key, column]));
    const activeKeys = new Set(items.map((item) => item.monthKey).filter(Boolean));
    const columns = (collectorDashboardData?.monthColumns || [])
        .filter((column) => activeKeys.has(column.key))
        .slice(-4);

    if (columns.length) return columns;

    return Array.from(activeKeys)
        .slice(-4)
        .map((key) => available.get(key) || { key, label: key, fullLabel: key });
}

function buildPriorityWorklistFromMatrix(mode = currentWorkQueueMode) {
    if (!collectorDashboardData || !isCollectionPriorityCardMode(mode)) {
        return { groups: [], monthColumns: [], total: 0, rowCount: 0, invoiceCount: 0 };
    }

    const sourceRows = getMatrixPriorityRowsForMode(mode);
    const items = [];

    sourceRows.forEach((row) => {
        getPriorityWorklistCellsForRow(row, mode).forEach((cell) => {
            const records = Array.isArray(cell.records) ? cell.records : [];
            const openRecords = records
                .filter((record) => getPriorityRecordAmount(record, cell) > 0.01)
                .filter((record) => mode !== 'billing_received_unfollowed' || hasRealReceivedDate(record.dateReceived));

            if (openRecords.length) {
                openRecords.forEach((record, index) => {
                    items.push({
                        groupKey: `${cell.customer || row.customer || ''}|${cell.branchName || row.branchName || ''}`,
                        cellId: cell.id,
                        rowId: row.rowId,
                        customer: cell.customer || row.customer || record.company || '',
                        branch: cell.branchName || row.branchName || record.branch || 'Main',
                        accountLabel: cell.accountLabel || row.accountLabel || record.accountLabel || '',
                        invoiceNo: record.invoiceNo || record.invoiceId || record.invoiceKey || '-',
                        invoiceDate: record.invoiceDate || record.dueDate || null,
                        dateReceived: record.dateReceived || null,
                        monthKey: cell.monthKey,
                        monthLabel: cell.label,
                        amount: getPriorityRecordAmount(record, cell),
                        history: cell.latestHistory || row.latestHistory || null,
                        serialNumber: record.serialNumber || cell.serialNumber || row.serialNumber || '',
                        modelName: record.modelName || cell.modelName || row.modelName || '',
                        sortKey: `${String(cell.customer || row.customer || '').toLowerCase()}|${String(cell.branchName || row.branchName || '').toLowerCase()}|${cell.monthKey}|${index}`
                    });
                });
            } else {
                const amount = getPriorityCellAmount(cell);
                if (amount <= 0.01) return;
                items.push({
                    groupKey: `${cell.customer || row.customer || ''}|${cell.branchName || row.branchName || ''}`,
                    cellId: cell.id,
                    rowId: row.rowId,
                    customer: cell.customer || row.customer || '',
                    branch: cell.branchName || row.branchName || 'Main',
                    accountLabel: cell.accountLabel || row.accountLabel || '',
                    invoiceNo: cell.pendingBilling ? 'Pending billing' : 'No invoice linked',
                    invoiceDate: null,
                    dateReceived: null,
                    monthKey: cell.monthKey,
                    monthLabel: cell.label,
                    amount,
                    history: cell.latestHistory || row.latestHistory || null,
                    serialNumber: cell.serialNumber || row.serialNumber || '',
                    modelName: cell.modelName || row.modelName || '',
                    sortKey: `${String(cell.customer || row.customer || '').toLowerCase()}|${String(cell.branchName || row.branchName || '').toLowerCase()}|${cell.monthKey}`
                });
            }
        });
    });

    const monthColumns = getPriorityWorklistMonthColumns(items);
    const groups = [];
    const groupMap = new Map();

    items
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey) || right.amount - left.amount)
        .forEach((item) => {
            if (!groupMap.has(item.groupKey)) {
                const group = {
                    key: item.groupKey,
                    customer: item.customer,
                    branch: item.branch,
                    accountLabel: item.accountLabel,
                    items: [],
                    monthTotals: {},
                    total: 0
                };
                groupMap.set(item.groupKey, group);
                groups.push(group);
            }
            const group = groupMap.get(item.groupKey);
            group.items.push(item);
            group.monthTotals[item.monthKey] = Number(group.monthTotals[item.monthKey] || 0) + Number(item.amount || 0);
            group.total += Number(item.amount || 0);
        });

    groups.sort((left, right) => right.total - left.total || left.customer.localeCompare(right.customer));

    return {
        groups,
        monthColumns,
        total: groups.reduce((sum, group) => sum + group.total, 0),
        rowCount: groups.length,
        invoiceCount: items.length
    };
}

function renderPriorityWorklist() {
    const titleNode = document.getElementById('priorityWorklistTitle');
    const subtitleNode = document.getElementById('priorityWorklistSubtitle');
    const bodyNode = document.getElementById('priorityWorklistBody');
    const listBtn = document.getElementById('priorityViewListBtn');
    const gridBtn = document.getElementById('priorityViewGridBtn');
    if (!bodyNode) return;

    if (listBtn) listBtn.classList.toggle('active', currentPriorityWorklistView === 'list');
    if (gridBtn) gridBtn.classList.toggle('active', currentPriorityWorklistView === 'grid');
    syncPriorityCardsForCurrentLane();

    const definition = getPriorityCardDefinition(currentWorkQueueMode);
    const title = definition?.title || 'Priority Worklist';
    if (titleNode) titleNode.textContent = title;

    if (!definition) {
        if (subtitleNode) subtitleNode.textContent = 'Click a priority card to see accounts as a fast list, or switch to the filtered grid cells.';
        bodyNode.innerHTML = '<div class="priority-worklist-empty">Choose a priority card above to load the collector list.</div>';
        return;
    }

    const worklist = buildPriorityWorklistFromMatrix(currentWorkQueueMode);
    if (subtitleNode) {
        subtitleNode.textContent = `${worklist.rowCount.toLocaleString()} account group(s), ${worklist.invoiceCount.toLocaleString()} invoice row(s), ${formatCurrency(worklist.total)} ${definition.amountLabel}.`;
    }

    if (currentPriorityWorklistView === 'grid') {
        bodyNode.innerHTML = `
            <div class="priority-worklist-summary">
                <span class="priority-worklist-chip">${escapeHtml(title)}</span>
                <span class="priority-worklist-chip">${escapeHtml(worklist.rowCount.toLocaleString())} account group(s)</span>
                <span class="priority-worklist-chip">${escapeHtml(formatCurrency(worklist.total))}</span>
            </div>
            <div class="priority-worklist-empty">Filtered grid cells are shown in the Collector Dashboard below. Switch back to List when scrolling the matrix takes too long.</div>
        `;
        return;
    }

    if (!worklist.groups.length) {
        bodyNode.innerHTML = `<div class="priority-worklist-empty">No accounts match ${escapeHtml(title)} right now.</div>`;
        return;
    }

    const monthHeaders = worklist.monthColumns
        .map((column) => `<th class="text-right">${escapeHtml(column.label || column.fullLabel || column.key)}</th>`)
        .join('');
    const totalColspan = 3 + worklist.monthColumns.length;
    const limitedGroups = worklist.groups.slice(0, 80);

    bodyNode.innerHTML = `
        <div class="priority-worklist-summary">
            <span class="priority-worklist-chip">${escapeHtml(title)}</span>
            <span class="priority-worklist-chip">${escapeHtml(worklist.rowCount.toLocaleString())} account group(s)</span>
            <span class="priority-worklist-chip">${escapeHtml(formatCurrency(worklist.total))}</span>
        </div>
        <div class="priority-worklist-table-wrap">
            <table class="priority-worklist-table">
                <thead>
                    <tr>
                        <th>Invoice Date</th>
                        <th>Account</th>
                        <th>Branch</th>
                        ${monthHeaders}
                        <th class="text-right">Total</th>
                        <th>Status / Promise</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${limitedGroups.map((group) => {
                        const groupRows = group.items.slice(0, 12).map((item) => {
                            const monthCells = worklist.monthColumns.map((column) => `
                                <td class="text-right">${column.key === item.monthKey ? escapeHtml(formatCurrency(item.amount)) : ''}</td>
                            `).join('');
                            const historyText = [
                                item.history?.conversationResult,
                                item.history?.promiseToPay,
                                item.history?.issueType
                            ].filter(Boolean).join(' / ') || '-';
                            return `
                                <tr>
                                    <td>${escapeHtml(formatDate(item.invoiceDate))}</td>
                                    <td>
                                        <div class="priority-worklist-account">
                                            <strong>${escapeHtml(item.invoiceNo)}</strong>
                                            <span>${escapeHtml(item.modelName || displaySerialNumber(item.serialNumber) || item.monthLabel || '-')}</span>
                                            ${item.dateReceived ? `<span>Received ${escapeHtml(formatDate(item.dateReceived))}</span>` : ''}
                                        </div>
                                    </td>
                                    <td>${escapeHtml(item.branch || 'Main')}</td>
                                    ${monthCells}
                                    <td class="text-right"><strong>${escapeHtml(formatCurrency(item.amount))}</strong></td>
                                    <td>${escapeHtml(historyText)}</td>
                                    <td>
                                        <div class="priority-worklist-actions">
                                            <button type="button" class="btn btn-primary btn-sm" onclick="openCollectorPriorityCell('${encodeURIComponent(item.cellId)}', 'followup')">Follow-up</button>
                                            <button type="button" class="btn btn-secondary btn-sm" onclick="openCollectorPriorityCell('${encodeURIComponent(item.cellId)}', 'payment')">Payment</button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('');
                        const totalCells = worklist.monthColumns.map((column) => `
                            <td class="text-right">${group.monthTotals[column.key] ? escapeHtml(formatCurrency(group.monthTotals[column.key])) : ''}</td>
                        `).join('');
                        return `
                            <tr class="priority-group-row">
                                <td colspan="3">
                                    <div class="priority-worklist-account">
                                        <strong>${escapeHtml(group.customer || 'Unnamed account')}</strong>
                                        <span>${escapeHtml(group.branch || group.accountLabel || 'Main')}</span>
                                    </div>
                                </td>
                                ${totalCells}
                                <td class="text-right">${escapeHtml(formatCurrency(group.total))}</td>
                                <td colspan="2">${escapeHtml(group.items.length.toLocaleString())} row(s)</td>
                            </tr>
                            ${groupRows}
                        `;
                    }).join('')}
                    <tr class="priority-total-row">
                        <td colspan="${escapeHtml(String(totalColspan))}">Total</td>
                        <td class="text-right">${escapeHtml(formatCurrency(worklist.total))}</td>
                        <td colspan="2">${limitedGroups.length < worklist.groups.length ? `Showing ${escapeHtml(limitedGroups.length.toLocaleString())} of ${escapeHtml(worklist.groups.length.toLocaleString())} groups` : 'Complete list'}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function setPriorityWorklistView(viewMode) {
    currentPriorityWorklistView = viewMode === 'grid' ? 'grid' : 'list';
    renderPriorityWorklist();
    if (currentPriorityWorklistView === 'grid') {
        document.getElementById('collector-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        document.getElementById('priorityWorklistPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function getMatrixPriorityRowIdSet(mode) {
    return new Set(getMatrixPriorityRowsForMode(mode).map((row) => String(row.rowId || '').trim()).filter(Boolean));
}

function invoiceMatchesWorkQueueMode(invoice) {
    if (currentWorkQueueMode === 'all') return true;
    const invoiceKey = String(invoice?.invoiceKey || invoice?.invoiceNo || invoice?.invoiceId || '').trim();
    if (!invoiceKey) return false;
    if (currentWorkQueueMode === 'scheduled_today') return invoiceKeySetFromRows(getTodayScheduledInvoices()).has(invoiceKey);
    if (currentWorkQueueMode === 'promise_due') return invoiceKeySetFromRows(getPromiseDueTodayInvoices()).has(invoiceKey);
    if (currentWorkQueueMode === 'urgent_stale') return invoiceKeySetFromRows(getUrgentNotCalledInvoices()).has(invoiceKey);
    if (currentWorkQueueMode === 'missing_contact') return invoiceKeySetFromRows(getMissingContactInvoices()).has(invoiceKey);
    if (COLLECTION_PRIORITY_CARD_DEFINITIONS.some((card) => card.mode === currentWorkQueueMode)) {
        return invoiceKeySetFromRows(getPriorityRowsForMode(currentWorkQueueMode)).has(invoiceKey);
    }
    return true;
}

function setWorkQueueMode(mode) {
    if (!isPriorityModeAllowedForCurrentLane(mode)) {
        currentWorkQueueMode = 'all';
        renderPriorityWorklist();
        scrollToWorkQueue();
        return;
    }
    currentWorkQueueMode = currentWorkQueueMode === mode ? 'all' : mode;
    if (isCollectionPriorityCardMode(currentWorkQueueMode)) {
        currentPriorityWorklistView = 'list';
    }
    currentPriorityFilter = null;
    currentPage = 1;
    clearFilterInputs();
    setQuickAgeFilter('all');
    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    document.querySelectorAll('[data-work-queue-mode]').forEach((card) => {
        card.classList.toggle('active', currentWorkQueueMode !== 'all' && card.dataset.workQueueMode === currentWorkQueueMode);
    });
    recomputeFilteredInvoices();
    renderPriorityWorklist();
    scrollToWorkQueue();
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

        if (!invoiceMatchesWorkQueueMode(invoice)) return false;

        return true;
    });

    updateAllStats();
    updateDurationSummary();
    const collectorDashboardPromise = collectorDashboardData
        ? renderCollectorDashboardFromData(collectorDashboardData)
        : Promise.resolve(renderCollectorMatrixEmptyState());
    renderTrendDashboard();
    renderTable();
    showActiveFilters();
    renderTodayScheduleTable();
    renderPromiseDueTable();
    renderUrgentStaleTable();
    renderMissingContactTable();
    renderCollectorActivityTable();
    updateFollowupBadge();
    updateActionBrief();
    updateQueueContext();
    return collectorDashboardPromise;
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
    currentWorkQueueMode = 'all';

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    document.querySelectorAll('[data-work-queue-mode]').forEach((card) => card.classList.remove('active'));
    setQuickAgeFilter('all');
    currentPage = 1;
    recomputeFilteredInvoices();
}

function filterByPriority(priority) {
    currentWorkQueueMode = 'all';
    clearFilterInputs();
    setQuickAgeFilter('all');
    if (currentPriorityFilter === priority) {
        currentPriorityFilter = null;
    } else {
        currentPriorityFilter = priority;
    }

    document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
    document.querySelectorAll('[data-work-queue-mode]').forEach((card) => card.classList.remove('active'));
    if (currentPriorityFilter) {
        document.querySelector(`.priority-card.${currentPriorityFilter}`)?.classList.add('active');
    }

    currentPage = 1;
    recomputeFilteredInvoices();
    scrollToWorkQueue();
}

function removeFilter(fieldId) {
    if (fieldId === 'priority') {
        currentPriorityFilter = null;
        currentWorkQueueMode = 'all';
        document.querySelectorAll('.priority-card').forEach((card) => card.classList.remove('active'));
        document.querySelectorAll('[data-work-queue-mode]').forEach((card) => card.classList.remove('active'));
        currentPage = 1;
        recomputeFilteredInvoices();
        return;
    }

    if (fieldId === 'work-queue') {
        currentWorkQueueMode = 'all';
        document.querySelectorAll('[data-work-queue-mode]').forEach((card) => card.classList.remove('active'));
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

    if (currentWorkQueueMode !== 'all') {
        filters.push({ label: `Queue: ${getWorkQueueModeLabel(currentWorkQueueMode)}`, field: 'work-queue' });
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

function updateQueueContext() {
    const node = document.getElementById('queue-context');
    if (!node) return;

    const queueText = currentWorkQueueMode !== 'all'
        ? getWorkQueueModeLabel(currentWorkQueueMode)
        : (currentPriorityFilter ? `Priority: ${currentPriorityFilter.toUpperCase()}` : 'All priorities');
    const matrixCount = currentWorkQueueMode !== 'all' && !allInvoices.length && collectorDashboardData
        ? getMatrixPriorityRowsForMode(currentWorkQueueMode).length
        : null;
    node.textContent = `${queueText} • ${(matrixCount ?? filteredInvoices.length).toLocaleString()} account(s) in queue`;
}

function scrollToWorkQueue() {
    const node = isCollectionPriorityCardMode(currentWorkQueueMode)
        ? document.getElementById('priorityWorklistPanel')
        : !allInvoices.length && collectorDashboardData
        ? document.getElementById('collector-dashboard')
        : document.getElementById('collector-work-queue');
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    updatePriorityCardsFromCurrentData();

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
    const tomorrowConfirmed = getTomorrowConfirmedCollectionInvoices();
    const tomorrowConfirmedTotal = tomorrowConfirmed.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('scheduled-count').textContent = scheduledToday.length.toLocaleString();
    document.getElementById('scheduled-amount').textContent = formatCurrencyShort(scheduledTotal);
    const tomorrowCountNode = document.getElementById('tomorrow-confirmed-count');
    const tomorrowAmountNode = document.getElementById('tomorrow-confirmed-amount');
    if (tomorrowCountNode) tomorrowCountNode.textContent = tomorrowConfirmed.length.toLocaleString();
    if (tomorrowAmountNode) tomorrowAmountNode.textContent = formatCurrencyShort(tomorrowConfirmedTotal);

    const staleUrgent = getUrgentNotCalledInvoices();
    const staleUrgentTotal = staleUrgent.reduce((sum, inv) => sum + inv.amount, 0);

    document.getElementById('stale-urgent-count').textContent = staleUrgent.length.toLocaleString();
    document.getElementById('stale-urgent-amount').textContent = formatCurrencyShort(staleUrgentTotal);
    renderCollectionsCompareScorecard();
}

function updatePriorityCardsFromCurrentData() {
    COLLECTION_PRIORITY_CARD_DEFINITIONS.forEach((card) => {
        const rows = getPriorityRowsForMode(card.mode);
        const amount = rows.reduce((sum, invoice) => sum + getPriorityMetricAmount(card.mode, invoice), 0);
        const safeId = card.mode.replace(/_/g, '-');
        const countEl = document.getElementById(`count-${safeId}`);
        const amountEl = document.getElementById(`amount-${safeId}`);
        if (countEl) countEl.textContent = rows.length.toLocaleString();
        if (amountEl) amountEl.textContent = `${formatCurrencyShort(amount)} ${card.amountLabel}`;
    });
}

function updateDurationSummary() {
    const rangeLabelNode = document.getElementById('duration-range-label');
    const rangeHelpNode = document.getElementById('duration-range-help');
    const totalBillNode = document.getElementById('duration-total-bill');
    const totalBillCountNode = document.getElementById('duration-total-bill-count');
    const totalCollectionsNode = document.getElementById('duration-total-collections');
    const totalCollectionsCountNode = document.getElementById('duration-total-collections-count');
    const needCollectNode = document.getElementById('duration-need-collect');
    const needCollectCountNode = document.getElementById('duration-need-collect-count');

    if (!rangeLabelNode || !rangeHelpNode || !totalBillNode || !totalBillCountNode || !totalCollectionsNode || !totalCollectionsCountNode || !needCollectNode || !needCollectCountNode) {
        return;
    }

    const fromDate = normalizeDate(document.getElementById('filter-from-date')?.value);
    const toDate = normalizeDate(document.getElementById('filter-to-date')?.value);

    let totalBill = 0;
    let totalBillCount = 0;
    let needCollect = 0;
    let needCollectCount = 0;

    billingEntriesForDuration.forEach((entry) => {
        if (!isDateWithinRange(entry.invoiceDate, fromDate, toDate)) return;
        totalBill += entry.amount;
        totalBillCount += 1;
        if (!entry.isPaid) {
            needCollect += entry.amount;
            needCollectCount += 1;
        }
    });

    let totalCollections = 0;
    let totalCollectionsCount = 0;
    paymentEntries.forEach((entry) => {
        if (!hasCollectorPaymentOfficialReceipt(entry)) return;
        if (!isDateWithinRange(getCollectorPaymentTotalDate(entry), fromDate, toDate)) return;
        totalCollections += entry.amount;
        totalCollectionsCount += 1;
    });

    rangeLabelNode.textContent = formatRangeLabel(fromDate, toDate);
    rangeHelpNode.textContent = fromDate || toDate
        ? 'Duration based on date picker. Totals update when you Filter or change dates.'
        : 'Showing all available records. Set from/to date for focused analysis.';

    totalBillNode.textContent = formatCurrency(totalBill);
    totalBillCountNode.textContent = `${totalBillCount.toLocaleString()} invoice(s)`;

    totalCollectionsNode.textContent = formatCurrency(totalCollections);
    totalCollectionsCountNode.textContent = `${totalCollectionsCount.toLocaleString()} payment(s)`;

    needCollectNode.textContent = formatCurrency(needCollect);
    needCollectCountNode.textContent = `${needCollectCount.toLocaleString()} unpaid invoice(s)`;
    renderCollectionsCompareScorecard();
}

function computeMonthlyTrendData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowStart = new Date(MONTHLY_TREND_START.getTime());
    const windowEnd = today < windowStart ? windowStart : today;
    const monthRows = [];

    let cursor = startOfMonth(windowStart);
    const lastMonth = startOfMonth(windowEnd);

    while (cursor && lastMonth && cursor <= lastMonth) {
        monthRows.push({
            key: getMonthKey(cursor),
            monthStart: new Date(cursor.getTime()),
            label: formatMonthLabel(cursor),
            fullLabel: formatMonthLabel(cursor, true),
            billed: 0,
            billedCount: 0,
            collected: 0,
            paymentCount: 0,
            needCollect: 0,
            needCollectCount: 0,
            variance: 0,
            recoveryRate: null,
            momAmount: null,
            momPercent: null,
            isCurrentMonth: false
        });
        cursor = addMonths(cursor, 1);
    }

    const rowMap = new Map(monthRows.map((row) => [row.key, row]));

    billingEntriesForDuration.forEach((entry) => {
        const invoiceDate = normalizeDate(entry.invoiceDate);
        const amount = Number(entry.amount || 0);
        if (!invoiceDate || amount <= 0) return;
        if (invoiceDate < windowStart || invoiceDate > windowEnd) return;

        const row = rowMap.get(getMonthKey(invoiceDate));
        if (!row) return;

        row.billed += amount;
        row.billedCount += 1;

        if (!entry.isPaid) {
            row.needCollect += amount;
            row.needCollectCount += 1;
        }
    });

    paymentEntries.forEach((entry) => {
        if (!hasCollectorPaymentOfficialReceipt(entry)) return;
        const paymentDate = getCollectorPaymentTotalDate(entry);
        const amount = Number(entry.amount || 0);
        if (!paymentDate || amount <= 0) return;
        if (paymentDate < windowStart || paymentDate > windowEnd) return;

        const row = rowMap.get(getMonthKey(paymentDate));
        if (!row) return;

        row.collected += amount;
        row.paymentCount += 1;
    });

    const currentMonthKey = getMonthKey(today);
    monthRows.forEach((row, index) => {
        row.variance = row.collected - row.billed;
        row.recoveryRate = row.billed > 0 ? (row.collected / row.billed) * 100 : null;
        row.isCurrentMonth = row.key === currentMonthKey;

        if (index === 0) return;

        const prev = monthRows[index - 1];
        row.momAmount = row.collected - prev.collected;
        if (prev.collected > 0) {
            row.momPercent = (row.momAmount / prev.collected) * 100;
        }
    });

    const activeRows = monthRows.filter((row) => row.billed > 0 || row.collected > 0 || row.needCollect > 0);
    const rowsForSummary = activeRows.length ? activeRows : monthRows;
    const maxAmount = Math.max(
        1,
        ...rowsForSummary.flatMap((row) => [row.billed, row.collected, row.needCollect])
    );

    const totals = rowsForSummary.reduce(
        (acc, row) => {
            acc.billed += row.billed;
            acc.billedCount += row.billedCount;
            acc.collected += row.collected;
            acc.paymentCount += row.paymentCount;
            acc.needCollect += row.needCollect;
            acc.needCollectCount += row.needCollectCount;
            return acc;
        },
        {
            billed: 0,
            billedCount: 0,
            collected: 0,
            paymentCount: 0,
            needCollect: 0,
            needCollectCount: 0
        }
    );

    totals.recoveryRate = totals.billed > 0 ? (totals.collected / totals.billed) * 100 : null;

    return {
        monthRows,
        rowsForSummary,
        activeRows,
        totals,
        maxAmount,
        windowStart,
        windowEnd
    };
}

function buildTrendInsights(rows) {
    if (!rows.length || rows.every((row) => row.billed === 0 && row.collected === 0 && row.needCollect === 0)) {
        return [
            {
                label: 'Trend Insight',
                text: 'No billing or collection activity is available yet for the selected trend window.'
            }
        ];
    }

    const comparisons = rows.filter((row) => row.momAmount !== null);
    const bestMonth = rows.reduce((best, row) => (row.collected > best.collected ? row : best), rows[0]);
    const largestShortfall = rows.reduce((worst, row) => (row.variance < worst.variance ? row : worst), rows[0]);
    const largestSurplus = rows.reduce((best, row) => (row.variance > best.variance ? row : best), rows[0]);
    const strongestLift = comparisons.length
        ? comparisons.reduce((best, row) => (row.momAmount > best.momAmount ? row : best), comparisons[0])
        : null;

    const improvedCount = comparisons.filter((row) => row.momAmount > 0).length;
    const outperformedBillingCount = rows.filter((row) => row.variance >= 0).length;

    return [
        {
            label: 'Best Collection Month',
            text: `${bestMonth.fullLabel} led the window with ${formatCurrency(bestMonth.collected)} collected across ${bestMonth.paymentCount.toLocaleString()} payment(s).`
        },
        {
            label: 'Momentum',
            text: comparisons.length
                ? `${improvedCount} of ${comparisons.length} month-to-month comparisons improved. Sharpest lift was ${strongestLift.fullLabel} at ${formatSignedCurrencyShort(
                      strongestLift.momAmount
                  )} versus the previous month.`
                : 'Only one month is currently in the trend window, so month-over-month momentum starts after the next month closes.'
        },
        {
            label: 'Billing vs Collections',
            text:
                largestShortfall.variance === 0 && largestSurplus.variance === 0
                    ? 'Billing and collections are currently balanced month by month in this window.'
                    : `Collections matched or beat new billing in ${outperformedBillingCount} of ${rows.length} month(s). Largest shortfall was ${largestShortfall.fullLabel} at ${formatSignedCurrencyShort(
                          largestShortfall.variance
                      )}, while the strongest catch-up month was ${largestSurplus.fullLabel} at ${formatSignedCurrencyShort(largestSurplus.variance)}.`
        }
    ];
}

function renderTrendSummaryCards(trendData) {
    const { rowsForSummary, totals, windowStart, windowEnd } = trendData;
    const grid = document.getElementById('trend-summary-grid');
    const subtitle = document.getElementById('trend-window-subtitle');
    if (!grid || !subtitle) return;

    subtitle.textContent = `Month-by-month comparison from ${formatMonthLabel(windowStart, true)} to ${formatMonthLabel(
        windowEnd,
        true
    )}. Uses invoice posting month for billing and payment posting month for collections. This dashboard stays portfolio-wide even when work queue filters change.`;

    grid.innerHTML = `
        <article class="trend-card primary">
            <span class="eyebrow">Trend Window</span>
            <div class="value">${rowsForSummary.length.toLocaleString()}</div>
            <div class="meta">${formatMonthLabel(windowStart, true)} to ${formatMonthLabel(windowEnd, true)}${getMonthKey(windowEnd) === getMonthKey(new Date()) ? ' • current month is partial' : ''}</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Total Billed</span>
            <div class="value">${formatCurrencyShort(totals.billed)}</div>
            <div class="meta">${formatCurrency(totals.billed)} across ${totals.billedCount.toLocaleString()} invoice(s).</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Total Collected</span>
            <div class="value">${formatCurrencyShort(totals.collected)}</div>
            <div class="meta">${formatCurrency(totals.collected)} across ${totals.paymentCount.toLocaleString()} payment(s).</div>
        </article>
        <article class="trend-card">
            <span class="eyebrow">Recovery Rate</span>
            <div class="value">${formatPercent(totals.recoveryRate)}</div>
            <div class="meta">${formatCurrency(totals.needCollect)} from this billing window still appears unpaid (${totals.needCollectCount.toLocaleString()} invoice(s)).</div>
        </article>
    `;
}

function renderTrendInsights(trendData) {
    const container = document.getElementById('trend-insights');
    if (!container) return;

    const insights = buildTrendInsights(trendData.rowsForSummary);
    container.innerHTML = insights
        .map(
            (item) => `
                <article class="trend-insight">
                    <span class="label">${escapeHtml(item.label)}</span>
                    <div class="text">${escapeHtml(item.text)}</div>
                </article>
            `
        )
        .join('');
}

function renderTrendStrip(trendData) {
    const container = document.getElementById('trend-strip');
    if (!container) return;

    if (!trendData.rowsForSummary.length) {
        container.innerHTML = '<div class="empty-followup">No month-by-month activity found yet for this trend window.</div>';
        return;
    }

    container.innerHTML = trendData.rowsForSummary
        .map((row, index) => {
            const billedWidth = row.billed > 0 ? `${Math.max(4, (row.billed / trendData.maxAmount) * 100)}%` : '0%';
            const collectedWidth = row.collected > 0 ? `${Math.max(4, (row.collected / trendData.maxAmount) * 100)}%` : '0%';
            const varianceClass = row.variance > 0 ? 'positive' : row.variance < 0 ? 'negative' : 'neutral';
            let momHtml = '<span class="neutral">Baseline month</span>';

            if (index > 0) {
                if (row.momPercent === null && row.momAmount > 0) {
                    momHtml = `<span class="positive">New inflow ${formatSignedCurrencyShort(row.momAmount)}</span>`;
                } else if (row.momPercent === null && row.momAmount < 0) {
                    momHtml = `<span class="negative">${formatSignedCurrencyShort(row.momAmount)}</span>`;
                } else if (row.momAmount > 0) {
                    momHtml = `<span class="positive">${formatPercent(row.momPercent)} MoM</span>`;
                } else if (row.momAmount < 0) {
                    momHtml = `<span class="negative">${formatPercent(row.momPercent)} MoM</span>`;
                } else {
                    momHtml = '<span class="neutral">Flat vs prior month</span>';
                }
            }

            return `
                <article class="trend-month-card${row.isCurrentMonth ? ' current' : ''}">
                    <div class="trend-month-head">
                        <div class="trend-month">${escapeHtml(row.label)}</div>
                        ${row.isCurrentMonth ? '<div class="trend-month-tag">MTD</div>' : ''}
                    </div>
                    <div class="trend-metric-row">
                        <span class="name">Billed</span>
                        <span class="amount">${escapeHtml(formatCurrencyShort(row.billed))}</span>
                    </div>
                    <div class="trend-metric-row">
                        <span class="name">Collected</span>
                        <span class="amount">${escapeHtml(formatCurrencyShort(row.collected))}</span>
                    </div>
                    <div class="trend-bar-stack">
                        <div class="trend-bar-line">
                            <span class="bar-label">Bill</span>
                            <div class="trend-bar-track"><div class="trend-bar-fill billed" style="--bar-width:${billedWidth}"></div></div>
                        </div>
                        <div class="trend-bar-line">
                            <span class="bar-label">Collect</span>
                            <div class="trend-bar-track"><div class="trend-bar-fill collected" style="--bar-width:${collectedWidth}"></div></div>
                        </div>
                    </div>
                    <div class="trend-foot">
                        <span class="${varianceClass}">${escapeHtml(formatSignedCurrencyShort(row.variance))}</span>
                        <span class="neutral">${escapeHtml(formatPercent(row.recoveryRate))} recovery</span>
                    </div>
                    <div class="trend-foot">
                        ${momHtml}
                        <span class="neutral">${row.paymentCount.toLocaleString()} pay</span>
                    </div>
                </article>
            `;
        })
        .join('');
}

function buildCustomerCollectionComparison(trendData) {
    const monthColumns = trendData.monthRows.map((row) => ({
        key: row.key,
        label: row.label,
        isCurrentMonth: row.isCurrentMonth
    }));

    const customerMap = new Map();
    const monthTotals = {};
    monthColumns.forEach((column) => {
        monthTotals[column.key] = 0;
    });

    paymentEntries.forEach((entry) => {
        if (!hasCollectorPaymentOfficialReceipt(entry)) return;
        const paymentMonthKey = getMonthKey(getCollectorPaymentTotalDate(entry));
        if (!paymentMonthKey || !monthTotals.hasOwnProperty(paymentMonthKey)) return;

        const billingMeta = billingMetaByInvoiceKey.get(String(entry.invoiceId || '').trim()) || {};
        const customer = String(billingMeta.company || 'Unknown').trim() || 'Unknown';

        if (!customerMap.has(customer)) {
            customerMap.set(customer, {
                customer,
                total: 0,
                months: {}
            });
        }

        const row = customerMap.get(customer);
        row.months[paymentMonthKey] = (row.months[paymentMonthKey] || 0) + Number(entry.amount || 0);
        row.total += Number(entry.amount || 0);
        monthTotals[paymentMonthKey] += Number(entry.amount || 0);
    });

    const customerRows = Array.from(customerMap.values()).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.customer.localeCompare(b.customer);
    });

    const unpaidMap = new Map();
    allInvoices.forEach((invoice) => {
        const customer = String(invoice.company || 'Unknown').trim() || 'Unknown';
        if (!unpaidMap.has(customer)) {
            unpaidMap.set(customer, {
                customer,
                count: 0,
                oldestDate: null
            });
        }

        const row = unpaidMap.get(customer);
        row.count += 1;

        const invoiceDate = invoice.invoiceDate || normalizeDate(invoice.dueDate);
        if (invoiceDate && (!row.oldestDate || invoiceDate < row.oldestDate)) {
            row.oldestDate = invoiceDate;
        }
    });

    const unpaidRows = Array.from(unpaidMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const aTime = a.oldestDate ? a.oldestDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.oldestDate ? b.oldestDate.getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.customer.localeCompare(b.customer);
    });

    return {
        monthColumns,
        customerRows,
        monthTotals,
        grandTotal: customerRows.reduce((sum, row) => sum + row.total, 0),
        unpaidRows
    };
}

function renderTrendComparisonTable(trendData) {
    const container = document.getElementById('trend-comparison-table');
    if (!container) return;

    const comparison = buildCustomerCollectionComparison(trendData);
    if (!comparison.customerRows.length && !comparison.unpaidRows.length) {
        container.innerHTML = '<div class="empty-followup">No month-by-month comparison is available yet.</div>';
        return;
    }

    container.innerHTML = `
        <div class="comparison-layout">
            <section class="comparison-panel">
                <div class="comparison-panel-head">
                    <div>
                        <div class="comparison-title">Collection Comparison</div>
                        <div class="comparison-subtitle">Customer by month, matching the spreadsheet-style view.</div>
                    </div>
                    <div class="comparison-total-chip">${escapeHtml(formatCurrency(comparison.grandTotal))}</div>
                </div>
                <div class="comparison-sheet-scroll">
                    <table class="comparison-sheet">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                ${comparison.monthColumns
                                    .map(
                                        (column) => `<th>${escapeHtml(column.label)}${column.isCurrentMonth ? ' <span class="trend-recovery-chip">MTD</span>' : ''}</th>`
                                    )
                                    .join('')}
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${comparison.customerRows
                                .map(
                                    (row) => `
                                        <tr>
                                            <td class="customer-cell">${escapeHtml(row.customer)}</td>
                                            ${comparison.monthColumns
                                                .map((column) => {
                                                    const value = Number(row.months[column.key] || 0);
                                                    return `<td class="amount-cell${value ? '' : ' empty'}">${value ? escapeHtml(formatCurrencyShort(value)) : ''}</td>`;
                                                })
                                                .join('')}
                                            <td class="amount-cell total">${escapeHtml(formatCurrencyShort(row.total))}</td>
                                        </tr>
                                    `
                                )
                                .join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td class="customer-cell total-label">Total</td>
                                ${comparison.monthColumns
                                    .map((column) => `<td class="amount-cell total">${escapeHtml(formatCurrencyShort(comparison.monthTotals[column.key] || 0))}</td>`)
                                    .join('')}
                                <td class="amount-cell total">${escapeHtml(formatCurrencyShort(comparison.grandTotal))}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
            <section class="comparison-panel unpaid">
                <div class="comparison-panel-head">
                    <div>
                        <div class="comparison-title">Unpaid</div>
                        <div class="comparison-subtitle">Customer, open invoice count, and oldest unpaid month.</div>
                    </div>
                </div>
                <div class="comparison-sheet-scroll compact">
                    <table class="comparison-sheet unpaid-sheet">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>No</th>
                                <th>Month</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                comparison.unpaidRows.length
                                    ? comparison.unpaidRows
                                          .map(
                                              (row) => `
                                                <tr>
                                                    <td class="customer-cell">${escapeHtml(row.customer)}</td>
                                                    <td class="amount-cell">${row.count.toLocaleString()}</td>
                                                    <td>${row.oldestDate ? escapeHtml(formatMonthLabel(row.oldestDate)) : '-'}</td>
                                                </tr>
                                            `
                                          )
                                          .join('')
                                    : '<tr><td colspan="3" class="empty-followup">No unpaid invoices in the current queue.</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `;
}

async function computeCollectorDashboardData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowStart = new Date(COLLECTOR_DASHBOARD_START.getTime());
    const summaryEnd = startOfMonth(today);
    const matrixEnd = startOfMonth(new Date(today.getFullYear(), 11, 1));
    const summaryMonthColumns = buildMonthColumns(windowStart, summaryEnd);
    const monthColumns = buildMonthColumns(windowStart, matrixEnd);
    const currentMonthKey = getMonthKey(today);
    monthColumns.forEach((column) => {
        column.isCurrentMonth = column.key === currentMonthKey;
    });

    const previousMonthStart = addMonths(windowStart, -1);
    const monthColumnKeys = new Set(monthColumns.map((column) => column.key));
    const billingMatrix = await loadCollectorBillingMatrix(windowStart, summaryEnd);

    const monthMetaMap = new Map(monthColumns.map((column) => [column.key, column]));
    const paymentMap = new Map();
    paymentEntries.forEach((entry) => {
        if (!hasCollectorPaymentOfficialReceipt(entry)) return;
        const paymentKeys = Array.from(new Set([
            entry.invoiceId,
            entry.invoiceNo
        ].map((value) => String(value || '').trim()).filter(Boolean)));
        if (!paymentKeys.length) return;

        let summary = paymentKeys.map((key) => paymentMap.get(key)).find(Boolean);
        if (!summary) {
            summary = {
                amount: 0,
                isSettled: false,
                latestBalanceAmount: null,
                firstPaymentDate: null,
                lastPaymentDate: null,
                orNumbers: new Set(),
                months: new Map()
            };
        }
        paymentKeys.forEach((key) => paymentMap.set(key, summary));

        const paymentDate = getCollectorPaymentTotalDate(entry);
        summary.amount += Number(entry.amount || 0);
        if (entry.balanceAmount !== null && entry.balanceAmount !== undefined && Number.isFinite(Number(entry.balanceAmount))) {
            summary.latestBalanceAmount = Number(entry.balanceAmount);
            if (Number(entry.balanceAmount) <= 0.01) summary.isSettled = true;
        }
        if (entry.orNumber) {
            summary.orNumbers.add(String(entry.orNumber).trim());
        }

        if (paymentDate && (!summary.firstPaymentDate || paymentDate < summary.firstPaymentDate)) {
            summary.firstPaymentDate = paymentDate;
        }

        if (paymentDate && (!summary.lastPaymentDate || paymentDate > summary.lastPaymentDate)) {
            summary.lastPaymentDate = paymentDate;
        }

        const paymentMonthKey = getMonthKey(paymentDate);
        if (!paymentMonthKey) return;

        if (!summary.months.has(paymentMonthKey)) {
            summary.months.set(paymentMonthKey, {
                amount: 0,
                firstPaymentDate: null,
                lastPaymentDate: null,
                orNumbers: new Set()
            });
        }

        const monthSummary = summary.months.get(paymentMonthKey);
        monthSummary.amount += Number(entry.amount || 0);
        if (paymentDate && (!monthSummary.firstPaymentDate || paymentDate < monthSummary.firstPaymentDate)) {
            monthSummary.firstPaymentDate = paymentDate;
        }
        if (paymentDate && (!monthSummary.lastPaymentDate || paymentDate > monthSummary.lastPaymentDate)) {
            monthSummary.lastPaymentDate = paymentDate;
        }
        if (entry.orNumber) {
            monthSummary.orNumbers.add(String(entry.orNumber).trim());
        }
    });

    const accountSetByMonth = new Map();
    const accountRowsMap = new Map();
    const monthTotals = {};
    const paymentMonthTotals = {};
    const receivableMonthTotals = {};
    const pendingBillingMonthTotals = {};
    const pendingCountsByMonth = {};
    collectorCellMap = new Map();

    monthColumns.forEach((column) => {
        monthTotals[column.key] = 0;
        paymentMonthTotals[column.key] = 0;
        receivableMonthTotals[column.key] = 0;
        pendingBillingMonthTotals[column.key] = 0;
        pendingCountsByMonth[column.key] = 0;
    });

    paymentEntries.forEach((entry) => {
        if (!hasCollectorPaymentOfficialReceipt(entry)) return;
        const paymentMonthKey = getMonthKey(getCollectorPaymentTotalDate(entry));
        if (!paymentMonthKey || !Object.prototype.hasOwnProperty.call(paymentMonthTotals, paymentMonthKey)) return;
        paymentMonthTotals[paymentMonthKey] += Number(entry.amount || 0);
    });

    collectorBillingRecords.forEach((record) => {
        const rowId = buildCollectorRowKey(record.machineId, record.contractmainId);
        if (!rowId) return;

        const paymentSummary = getPaymentSummaryForInvoiceKeys(paymentMap, record.invoiceId, record.invoiceNo, record.invoiceKey);

        const invoiceDateInBalanceWindow = record.invoiceDate && record.invoiceDate >= previousMonthStart && record.invoiceDate <= today;
        const paymentMonthsInWindow = Array.from(paymentSummary.months.keys()).filter((key) => monthColumnKeys.has(key));
        const invoiceMonthVisible = monthColumnKeys.has(record.monthKey);
        const unpaidBalance = getInvoiceOutstandingFromPaymentSummary(record.amount, paymentSummary);
        const hasUnpaidBalance = unpaidBalance > 0.01;
        const carryoverMonthKey = hasUnpaidBalance && !invoiceMonthVisible ? monthColumns[0]?.key : null;

        if (!invoiceDateInBalanceWindow && !paymentMonthsInWindow.length && !hasUnpaidBalance) return;

        if (!accountRowsMap.has(rowId)) {
            accountRowsMap.set(rowId, {
                rowId,
                customer: record.company || 'Unknown',
                branchName: record.branch || 'Main',
                accountLabel: record.accountLabel || record.company || 'Unknown',
                companyId: record.companyId || '',
                branchId: record.branchId || '',
                serialNumber: normalizeSerialNumber(record.serialNumber),
                modelName: record.modelName || '',
                machineLabel: record.machineLabel || buildMachineLabel(record.machineId, record.contractmainId),
                machineId: record.machineId || '',
                contractmainId: record.contractmainId || '',
                rdCounts: new Map(),
                months: {},
                totalCollected: 0
            });
        }

        const accountRow = accountRowsMap.get(rowId);
        if (!accountRow.serialNumber) accountRow.serialNumber = normalizeSerialNumber(record.serialNumber);
        if (!accountRow.companyId) accountRow.companyId = record.companyId || '';
        if (!accountRow.branchId) accountRow.branchId = record.branchId || '';
        if (!accountRow.modelName) accountRow.modelName = record.modelName || '';
        accountRow.rdCounts.set(record.rd, (accountRow.rdCounts.get(record.rd) || 0) + 1);

        if (invoiceDateInBalanceWindow) {
            if (!accountSetByMonth.has(record.monthKey)) {
                accountSetByMonth.set(record.monthKey, new Set());
            }
            accountSetByMonth.get(record.monthKey).add(rowId);
        }

        if (invoiceMonthVisible) {
            const invoiceCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(record.monthKey));
            const paidAgainstInvoice = paymentSummary.isSettled
                ? Number(record.amount || 0)
                : Math.min(Number(paymentSummary.amount || 0), Number(record.amount || 0));
            const invoiceOutstanding = getInvoiceOutstandingFromPaymentSummary(record.amount, paymentSummary);
            invoiceCell.rdValues.push(record.rd);
            invoiceCell.billedTotal += Number(record.amount || 0);
            invoiceCell.collectedTotal += paidAgainstInvoice;
            if (invoiceOutstanding > 0) invoiceCell.outstandingBalance += invoiceOutstanding;
            invoiceCell.displayBilledTotal = Math.max(Number(invoiceCell.displayBilledTotal || 0), Number(invoiceCell.billedTotal || 0));
            upsertCollectorCellRecord(invoiceCell, record.invoiceKey, {
                ...record,
                amount: Number(record.amount || 0),
                billedAmount: Number(record.amount || 0),
                collectedAmount: paidAgainstInvoice,
                totalCollectedAmount: Number(paymentSummary.amount || 0),
                latestBalanceAmount: invoiceOutstanding,
                expectedCollectionDate: addDays(record.invoiceDate, 30),
                firstPaymentDate: paymentSummary.firstPaymentDate,
                lastPaymentDate: paymentSummary.lastPaymentDate,
                paymentOrNumbers: Array.from(paymentSummary.orNumbers || []),
                rd: record.rd
            });
            accountRow.months[record.monthKey] = invoiceCell.id;
        } else if (carryoverMonthKey && monthMetaMap.has(carryoverMonthKey)) {
            const carryoverCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(carryoverMonthKey));
            carryoverCell.rdValues.push(record.rd);
            carryoverCell.billedTotal += unpaidBalance;
            carryoverCell.displayBilledTotal = Math.max(Number(carryoverCell.displayBilledTotal || 0), Number(carryoverCell.billedTotal || 0));
            carryoverCell.billedBasis = carryoverCell.billedBasis || 'unpaid_carryover';
            upsertCollectorCellRecord(carryoverCell, record.invoiceKey, {
                ...record,
                amount: Number(record.amount || 0),
                billedAmount: unpaidBalance,
                collectedAmount: 0,
                totalCollectedAmount: Number(paymentSummary.amount || 0),
                latestBalanceAmount: unpaidBalance,
                paymentOrNumbers: Array.from(paymentSummary.orNumbers || []),
                expectedCollectionDate: addDays(record.invoiceDate, 30),
                firstPaymentDate: paymentSummary.firstPaymentDate,
                lastPaymentDate: paymentSummary.lastPaymentDate,
                rd: record.rd,
                carriedForward: true
            });
            accountRow.months[carryoverMonthKey] = carryoverCell.id;
        }

        paymentMonthsInWindow
            .filter(() => !invoiceMonthVisible)
            .forEach((monthKey) => {
                const monthSummary = paymentSummary.months.get(monthKey);
                const paymentCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(monthKey));
                paymentCell.rdValues.push(record.rd);
                paymentCell.collectedTotal += Number(monthSummary?.amount || 0);
                upsertCollectorCellRecord(paymentCell, record.invoiceKey, {
                    ...record,
                    amount: Number(record.amount || 0),
                    billedAmount: 0,
                    collectedAmount: Number(monthSummary?.amount || 0),
                    totalCollectedAmount: Number(paymentSummary.amount || 0),
                    expectedCollectionDate: addDays(record.invoiceDate, 30),
                    firstPaymentDate: monthSummary?.firstPaymentDate || paymentSummary.firstPaymentDate,
                    lastPaymentDate: monthSummary?.lastPaymentDate || paymentSummary.lastPaymentDate,
                    paymentMonthKey: monthKey,
                    paymentOrNumbers: Array.from(monthSummary?.orNumbers || []),
                    rd: record.rd
                });
                accountRow.months[monthKey] = paymentCell.id;
            });
    });

    billingMatrix.rowMap.forEach((billingRow) => {
        const rowId = String(billingRow?.row_id || '').trim();
        if (!rowId) return;

        if (!accountRowsMap.has(rowId)) {
            accountRowsMap.set(rowId, {
                rowId,
                customer: billingRow.company_name || billingRow.account_name || 'Unknown',
                branchName: billingRow.branch_name || 'Main',
                accountLabel: billingRow.account_name || billingRow.company_name || 'Unknown',
                companyId: String(billingRow.company_id || '').trim(),
                branchId: String(billingRow.branch_id || '').trim(),
                serialNumber: normalizeSerialNumber(billingRow.serial_number),
                modelName: String(billingRow.billing_profile?.model_name || billingRow.billing_profile?.model || '').trim(),
                machineLabel: billingRow.machine_label || buildMachineLabel(billingRow.machine_id, billingRow.contractmain_id),
                machineId: String(billingRow.machine_id || '').trim(),
                contractmainId: String(billingRow.contractmain_id || '').trim(),
                rdCounts: new Map(),
                months: {},
                totalCollected: 0
            });
        }

        const accountRow = accountRowsMap.get(rowId);
        if (!accountRow.serialNumber) accountRow.serialNumber = normalizeSerialNumber(billingRow.serial_number);
        if (!accountRow.companyId) accountRow.companyId = String(billingRow.company_id || '').trim();
        if (!accountRow.branchId) accountRow.branchId = String(billingRow.branch_id || '').trim();
        if (!accountRow.modelName) accountRow.modelName = String(billingRow.billing_profile?.model_name || billingRow.billing_profile?.model || '').trim();
        const readingDay = Number(billingRow.reading_day || 0) || null;
        if (readingDay) accountRow.rdCounts.set(readingDay, (accountRow.rdCounts.get(readingDay) || 0) + 1);

        monthColumns.forEach((column) => {
            const billingCell = billingRow.months?.[column.key];
            if (!billingCell) return;
            const invoiceBilledTotal = Number(billingCell.amount_total || 0);
            const hasBillingState = invoiceBilledTotal > 0 || billingCell.pending || billingCell.missed_reading || billingCell.catch_up_billing;
            if (!hasBillingState) return;

            const collectorCell = ensureCollectorDisplayCell(collectorCellMap, accountRow, monthMetaMap.get(column.key));
            collectorCell.rdValues.push(readingDay);
            collectorCell.displayBilledTotal = Math.max(Number(collectorCell.displayBilledTotal || 0), invoiceBilledTotal);
            collectorCell.billedTotal = Math.max(Number(collectorCell.billedTotal || 0), invoiceBilledTotal);
            collectorCell.billedBasis = billingCell.billed_basis || collectorCell.billedBasis || 'none';
            collectorCell.missedReading = Boolean(collectorCell.missedReading || billingCell.missed_reading);
            collectorCell.catchUpBilling = Boolean(collectorCell.catchUpBilling || billingCell.catch_up_billing);
            collectorCell.catchUpGapMonths = Math.max(Number(collectorCell.catchUpGapMonths || 0), Number(billingCell.catch_up_gap_months || 0));
            collectorCell.pendingBilling = Boolean(collectorCell.pendingBilling || billingCell.pending);
            collectorCell.pendingBillingProjectionTotal = Math.max(
                Number(collectorCell.pendingBillingProjectionTotal || 0),
                getCollectorPendingBillingProjection(billingCell, billingRow)
            );
            collectorCell.readingPagesTotal = Math.max(Number(collectorCell.readingPagesTotal || 0), Number(billingCell.reading_pages_total || 0));
            collectorCell.readingTaskCount = Math.max(Number(collectorCell.readingTaskCount || 0), Number(billingCell.reading_task_count || 0));
            const detailInvoiceDate = normalizeDate(billingCell.latest_invoice_date);
            let groupedPaidTotal = 0;
            (billingCell.invoice_groups || []).forEach((group) => {
                const invoiceNo = String(group.invoice_no || group.invoice_ref || group.invoice_id || '').trim();
                const invoiceId = String(group.invoice_id || group.invoice_no || group.invoice_ref || '').trim();
                if (!invoiceNo && !invoiceId) return;
                const groupAmount = Number(group.amount_total || invoiceBilledTotal || 0);
                const paymentSummary = getPaymentSummaryForInvoiceKeys(paymentMap, invoiceId, invoiceNo, group.invoice_ref);
                const paidAgainstInvoice = paymentSummary.isSettled
                    ? groupAmount
                    : Math.min(Number(paymentSummary.amount || 0), groupAmount);
                const invoiceOutstanding = getInvoiceOutstandingFromPaymentSummary(groupAmount, paymentSummary);
                groupedPaidTotal += paidAgainstInvoice;
                if (invoiceOutstanding > 0) collectorCell.outstandingBalance += invoiceOutstanding;
                upsertCollectorCellRecord(collectorCell, group.invoice_ref || invoiceNo || invoiceId, {
                    invoiceId,
                    invoiceNo: invoiceNo || invoiceId,
                    invoiceKey: String(group.invoice_ref || invoiceNo || invoiceId).trim(),
                    amount: groupAmount,
                    billedAmount: groupAmount,
                    collectedAmount: paidAgainstInvoice,
                    totalCollectedAmount: Number(paymentSummary.amount || 0),
                    latestBalanceAmount: invoiceOutstanding,
                    company: accountRow.customer,
                    branch: accountRow.branchName,
                    accountLabel: accountRow.accountLabel,
                    companyId: accountRow.companyId,
                    branchId: accountRow.branchId,
                    machineId: String((group.machine_ids || [])[0] || accountRow.machineId || '').trim(),
                    contractmainId: String((group.contractmain_ids || [])[0] || accountRow.contractmainId || '').trim(),
                    serialNumber: accountRow.serialNumber,
                    modelName: accountRow.modelName,
                    machineLabel: accountRow.machineLabel,
                    invoiceDate: detailInvoiceDate,
                    firstPaymentDate: paymentSummary.firstPaymentDate,
                    lastPaymentDate: paymentSummary.lastPaymentDate,
                    paymentOrNumbers: Array.from(paymentSummary.orNumbers || []),
                    rd: readingDay
                });
            });
            if (groupedPaidTotal > 0) {
                collectorCell.collectedTotal = Math.max(Number(collectorCell.collectedTotal || 0), groupedPaidTotal);
            }
            accountRow.months[column.key] = collectorCell.id;
        });
    });

    finalizeCollectorCellRecords(collectorCellMap);
    rebuildCollectorCellsByRowId();

    let customerRows = Array.from(accountRowsMap.values())
        .map((row) => {
            let rd = null;
            let rowLatestHistory = null;
            Array.from(row.rdCounts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return a[0] - b[0];
                })
                .slice(0, 1)
                .forEach(([rdValue]) => {
                    rd = rdValue;
                });

            monthColumns.forEach((column) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                if (cell) {
                    row.totalCollected += cell.collectedTotal;
                    monthTotals[column.key] += cell.collectedTotal;
                    if (cell.latestHistory && (!rowLatestHistory || ((cell.latestHistory.callDate || new Date(0)).getTime() > (rowLatestHistory.callDate || new Date(0)).getTime()))) {
                        rowLatestHistory = cell.latestHistory;
                    }
                    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                    if ((billedTarget > 0 || cell.missedReading || cell.pendingBilling) && cell.collectedTotal <= 0) {
                        pendingCountsByMonth[column.key] += 1;
                    }
                }
            });

            return {
            rowId: row.rowId,
            customer: row.customer,
            branchName: row.branchName,
            accountLabel: row.accountLabel,
            companyId: row.companyId,
            branchId: row.branchId,
            serialNumber: normalizeSerialNumber(row.serialNumber),
            modelName: row.modelName,
            machineLabel: row.machineLabel,
                machineId: row.machineId,
                contractmainId: row.contractmainId,
                branchInactive: Number(branchMap[normalizeLookupId(row.branchId)]?.inactive || 0) || 0,
                rd,
                latestHistory: rowLatestHistory,
                months: row.months,
                totalCollected: row.totalCollected
            };
        })
        .sort((a, b) => {
            const rdA = a.rd === null || a.rd === undefined ? Number.MAX_SAFE_INTEGER : a.rd;
            const rdB = b.rd === null || b.rd === undefined ? Number.MAX_SAFE_INTEGER : b.rd;
            if (rdA !== rdB) return rdA - rdB;
            return a.customer.localeCompare(b.customer);
        });

    customerRows = applyCollectorGroupedRows(customerRows, monthColumns);

    const summaryCustomerRows = customerRows.filter((row) => !row.isGroupedChild);

    const monthlySummaryRows = summaryMonthColumns
        .map((column) => {
            const previousCustomers = accountSetByMonth.get(getMonthKey(addMonths(column.monthStart, -1))) || new Set();
            const currentCustomers = accountSetByMonth.get(column.key) || new Set();

            const additional = Array.from(currentCustomers).filter((customer) => !previousCustomers.has(customer)).length;
            const inactive = Array.from(previousCustomers).filter((customer) => !currentCustomers.has(customer)).length;
            const toCollect = currentCustomers.size;
            const collected = summaryCustomerRows.filter((row) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                return cell && cell.collectedTotal > 0;
            }).length;

            return {
                monthKey: column.key,
                monthLabel: column.label,
                balance: previousCustomers.size,
                additional,
                inactive,
                toCollect,
                collected,
                pending: Math.max(0, toCollect - collected)
            };
        })
        .reverse();

    const groupedChildRowIds = new Set(customerRows.filter((row) => row.isGroupedChild).map((row) => row.rowId));
    customerRows
        .filter((row) => !row.isGroupedChild)
        .forEach((row) => {
            monthColumns.forEach((column) => {
                const cell = collectorCellMap.get(row.months[column.key] || '');
                if (!cell) return;
                const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                const outstandingBalance = getCellOutstandingBalance(cell);
                if (billedTarget > 0 && outstandingBalance > 0.01) {
                    receivableMonthTotals[column.key] += outstandingBalance;
                }
                if (cell.pendingBilling) {
                    pendingBillingMonthTotals[column.key] += Number(cell.pendingBillingProjectionTotal || 0);
                }
            });
        });
    const pendingCellCount = Array.from(collectorCellMap.values()).filter((cell) => {
        if (groupedChildRowIds.has(cell.rowId)) return false;
        const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
        return (billedTarget > 0 || cell.missedReading || cell.pendingBilling) && cell.collectedTotal <= 0;
    }).length;
    const matrixTotalRows = buildCollectorMatrixTotalRows(monthColumns, customerRows);

    return {
        monthColumns,
        summaryMonthColumns,
        customerRows,
        monthlySummaryRows,
        monthTotals,
        paymentMonthTotals,
        receivableMonthTotals,
        pendingBillingMonthTotals,
        matrixTotalRows,
        pendingCountsByMonth,
        pendingCellCount,
        windowStart,
        windowEnd: today,
        matrixEnd
    };
}

function renderCollectorSummaryTable(data) {
    const container = document.getElementById('collector-summary-table');
    if (!container) return;

    ensureCollectorDashboardDerivedFields(data);
    const summaryRows = Array.isArray(data.monthlySummaryRows) ? data.monthlySummaryRows : [];
    if (!summaryRows.length) {
        container.innerHTML = '<div class="empty-followup">No summary counts in this saved build yet. The controlled backend job must rebuild the month summary.</div>';
        return;
    }

    container.innerHTML = `
        <table class="collector-sheet">
            <thead>
                <tr>
                    <th class="text-left">Month</th>
                    <th>Balance</th>
                    <th>Additional</th>
                    <th>Inactive</th>
                    <th>To Collect</th>
                    <th>Collected</th>
                    <th>Pending</th>
                </tr>
            </thead>
            <tbody>
                ${summaryRows
                    .map(
                        (row) => `
                            <tr>
                                <td class="text-left">${escapeHtml(row.monthLabel)}</td>
                                <td>${row.balance.toLocaleString()}</td>
                                <td>${row.additional.toLocaleString()}</td>
                                <td>${row.inactive.toLocaleString()}</td>
                                <td>${row.toCollect.toLocaleString()}</td>
                                <td>${row.collected.toLocaleString()}</td>
                                <td>${row.pending.toLocaleString()}</td>
                            </tr>
                        `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderCollectorMatrixTotalRows(data, cellTag = 'td') {
    const tag = cellTag === 'th' ? 'th' : 'td';
    const rows = Array.isArray(data.matrixTotalRows) ? data.matrixTotalRows : [];

    return rows.map((row) => {
        const monthCells = data.monthColumns
            .map((column) => {
                const count = Number(row.counts?.[column.key] || 0);
                const amount = Number(row.totals?.[column.key] || 0);
                return `
                    <${tag} class="total-cell text-right collector-total-drilldown-cell">
                        <button type="button" class="collector-total-button" onclick="openCollectorMatrixTotal('${escapeHtml(row.key)}', '${escapeHtml(column.key)}')">
                            <span class="collector-total-count">${escapeHtml(formatPlainNumber(count))}</span>
                            <span class="collector-total-divider">/</span>
                            <span class="collector-total-amount">${escapeHtml(formatPlainNumber(amount))}</span>
                        </button>
                    </${tag}>
                `;
            })
            .join('');
        const grandTotal = data.monthColumns.reduce((sum, column) => sum + Number(row.totals?.[column.key] || 0), 0);
        const grandCount = data.monthColumns.reduce((sum, column) => sum + Number(row.counts?.[column.key] || 0), 0);
        return `
            <tr class="collector-matrix-total-row">
                <${tag} class="sticky-col rd total-cell"></${tag}>
                <${tag} class="sticky-col sn total-cell"></${tag}>
                <${tag} class="sticky-col customer total-cell text-left">${escapeHtml(row.label)}</${tag}>
                <${tag} class="sticky-col branch total-cell"></${tag}>
                ${monthCells}
                <${tag} class="total-cell text-right">
                    <span class="collector-total-count">${escapeHtml(formatPlainNumber(grandCount))}</span>
                    <span class="collector-total-divider">/</span>
                    <span class="collector-total-amount">${escapeHtml(formatPlainNumber(grandTotal))}</span>
                </${tag}>
            </tr>
        `;
    }).join('');
}

function getCollectorMatrixTotalLabel(metricKey) {
    const row = (collectorDashboardData?.matrixTotalRows || []).find((item) => item.key === metricKey);
    return row?.label || 'Matrix Total';
}

function renderCollectorMatrixTotalDetails(details) {
    if (!details.length) return '<div class="collection-followup-empty">No detail rows found for this total.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table collector-total-detail-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Branch / Dept</th>
                        <th>SN</th>
                        <th>Invoice / Ref</th>
                        <th>OR No.</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Open</th>
                    </tr>
                </thead>
                <tbody>
                    ${details
                        .slice()
                        .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))
                        .map((detail) => `
                            <tr>
                                <td>${escapeHtml(detail.customer || '-')}</td>
                                <td>${escapeHtml(detail.branch || '-')}</td>
                                <td>${escapeHtml(detail.serial || '-')}</td>
                                <td>${escapeHtml(detail.invoiceNo || '-')}</td>
                                <td>${escapeHtml(detail.orNumber || '-')}</td>
                                <td>${escapeHtml(formatDate(detail.date))}</td>
                                <td>${escapeHtml(detail.status || '-')}</td>
                                <td class="text-right">${escapeHtml(formatCurrency(detail.amount || 0))}</td>
                                <td>${detail.cellId ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openCollectorMatrixTotalDetailCell('${encodeURIComponent(detail.cellId)}')">Open</button>` : '-'}</td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openCollectorMatrixTotal(metricKey, monthKey) {
    const safeMetricKey = String(metricKey || '').trim();
    const safeMonthKey = String(monthKey || '').trim();
    const modal = document.getElementById('collectorTotalModal');
    const title = document.getElementById('collectorTotalTitle');
    const subtitle = document.getElementById('collectorTotalSubtitle');
    const content = document.getElementById('collectorTotalContent');
    if (!modal || !title || !subtitle || !content) return;

    const monthColumn = (collectorDashboardData?.monthColumns || []).find((column) => column.key === safeMonthKey);
    const details = collectorMatrixTotalDetailMap.get(`${safeMetricKey}:${safeMonthKey}`) || [];
    const amountTotal = details.reduce((sum, detail) => sum + Number(detail.amount || 0), 0);
    title.textContent = getCollectorMatrixTotalLabel(safeMetricKey);
    subtitle.textContent = `${monthColumn?.fullLabel || safeMonthKey || 'Month'} • ${details.length.toLocaleString()} detail row(s) • ${formatCurrency(amountTotal)}`;
    content.innerHTML = renderCollectorMatrixTotalDetails(details);
    modal.classList.remove('hidden');
}

function closeCollectorTotalModal() {
    document.getElementById('collectorTotalModal')?.classList.add('hidden');
}

function openCollectorMatrixTotalDetailCell(cellId) {
    closeCollectorTotalModal();
    void openCollectorCell(decodeURIComponent(String(cellId || '')));
}

function renderCollectorMatrixTable(data, visibleRows) {
    const container = document.getElementById('collector-matrix-table');
    if (!container) return;
    collectorMatrixTotalDetailMap = new Map();
    (data.matrixTotalRows || []).forEach((row) => {
        Object.entries(row.details || {}).forEach(([monthKey, details]) => {
            collectorMatrixTotalDetailMap.set(`${row.key}:${monthKey}`, Array.isArray(details) ? details : []);
        });
    });
    const visibleCount = Array.isArray(visibleRows) ? visibleRows.length : 0;
    const totalCount = Array.isArray(data?.customerRows) ? data.customerRows.length : visibleCount;
    const rdCountLabel = visibleCount === totalCount
        ? `${visibleCount.toLocaleString()}`
        : `${visibleCount.toLocaleString()} / ${totalCount.toLocaleString()}`;

    if (!visibleRows.length) {
        const searchTerm = getCollectorSearchTerm();
        const invoiceSearchTerm = getCollectorInvoiceSearchTerm();
        const filterLabel = [
            searchTerm ? `account "${searchTerm}"` : '',
            invoiceSearchTerm ? `invoice "${invoiceSearchTerm}"` : ''
        ].filter(Boolean).join(' and ');
        container.innerHTML = filterLabel
            ? `<div class="empty-followup">No collection rows matched ${escapeHtml(filterLabel)}.</div>`
            : '<div class="empty-followup">No collection rows available.</div>';
        return;
    }

    container.innerHTML = `
        <table class="collector-sheet">
            <thead>
                <tr>
                    <th class="sticky-col rd">RD <span class="collector-rd-count">${escapeHtml(rdCountLabel)}</span></th>
                    <th class="sticky-col sn">SN</th>
                    <th class="sticky-col customer text-left">Customer</th>
                    <th class="sticky-col branch text-left">Branch / Dept</th>
                    ${data.monthColumns
                        .map(
                            (column) =>
                                `<th data-month-key="${escapeHtml(column.key)}" data-month-label="${escapeHtml(column.label)}" data-month-full-label="${escapeHtml(column.fullLabel)}">${escapeHtml(column.label)}${column.isCurrentMonth ? ' <span class="trend-recovery-chip">MTD</span>' : ''}</th>`
                        )
                        .join('')}
                    <th>Total</th>
                </tr>
                ${renderCollectorMatrixTotalRows(data, 'th')}
            </thead>
            <tbody>
                ${visibleRows
                    .map((row) => {
                        const cells = data.monthColumns
                            .map((column) => {
                                const cell = collectorCellMap.get(row.months[column.key] || '');
                                if (!cell) {
                                    return '<td class="month-cell no-bill"></td>';
                                }

                                const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
                                const outstandingBalance = getCellOutstandingBalance(cell);
                                const missedReading = Boolean(cell.missedReading);
                                const catchUpBilling = Boolean(cell.catchUpBilling);
                                const showBillingAmount = billedTarget > 0;
                                const followupBadge = renderFollowupBadge(cell.latestHistory || row.latestHistory);
                                const invoiceMeta = renderCellInvoicePaymentMeta(cell);
                                const paidMeta = renderCellInvoicePaymentMeta(cell, { paidOnly: true });
                                let cellClass = 'month-cell pending';
                                let cellText = '<span class="collector-empty-dot"></span>';

                                if (cell.collectedTotal > 0 && billedTarget > 0 && cell.collectedTotal < billedTarget) {
                                    cellClass = 'month-cell partial';
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(outstandingBalance))}</span>
                                        <span class="collector-state-label partial">Balance</span>
                                        ${paidMeta || invoiceMeta}
                                        ${followupBadge}
                                    `;
                                } else if (cell.collectedTotal > 0 && billedTarget > 0 && cell.collectedTotal >= billedTarget) {
                                    cellClass = 'month-cell collected';
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(cell.collectedTotal))}</span>
                                        <span class="collector-state-label collected">Collected</span>
                                        ${paidMeta || invoiceMeta}
                                        ${followupBadge}
                                    `;
                                } else if (showBillingAmount) {
                                    cellClass = `month-cell pending${catchUpBilling ? ' catch-up' : ''}`;
                                    cellText = `
                                        <span class="collector-amount">${escapeHtml(formatPlainNumber(billedTarget))}</span>
                                        ${catchUpBilling
                                            ? `<span class="collector-state-label catch-up">Catch-up Billing${cell.catchUpGapMonths > 1 ? ` (${escapeHtml(String(cell.catchUpGapMonths))})` : ''}</span>`
                                            : '<span class="collector-state-label unpaid">No Payment</span>'}
                                        ${invoiceMeta}
                                        ${followupBadge}
                                    `;
                                } else if (missedReading || cell.pendingBilling) {
                                    cellClass = `month-cell missed-reading${cell.pendingBilling ? ' pending-billing' : ''}`;
                                    cellText = `<span class="collector-state-label missed">${escapeHtml(missedReading ? 'Missed Reading' : 'Pending Billing')}</span>${followupBadge}`;
                                }

                                return `<td class="${cellClass}" data-collector-cell-id="${escapeHtml(cell.id)}" onclick="openCollectorCellByToken('${encodeURIComponent(cell.id)}')">${cellText}</td>`;
                            })
                            .join('');

                        return `
                            <tr class="${row.isGroupedParent ? 'collector-group-parent-row' : ''}${row.isGroupedChild ? ' collector-group-child-row' : ''}">
                                <td class="sticky-col rd">${row.isGroupedParent ? 'Group' : (row.rd !== null && row.rd !== undefined ? escapeHtml(String(row.rd)) : '-')}</td>
                                <td class="sticky-col sn">
                                    <div class="collector-primary">${escapeHtml(row.isGroupedParent ? 'Multiple' : displaySerialNumber(row.serialNumber))}</div>
                                </td>
                                <td class="sticky-col customer text-left">
                                    <div class="collector-primary">${escapeHtml(row.customer)}</div>
                                    <div class="collector-sub">${escapeHtml(row.machineLabel || buildMachineLabel(row.machineId, row.contractmainId))}</div>
                                </td>
                                <td class="sticky-col branch text-left">
                                    ${row.isGroupedParent
                                        ? `<button type="button" class="collector-group-toggle" onclick="event.stopPropagation(); toggleCollectorGroupedRows('${encodeURIComponent(row.rowId || '')}')">
                                            <span class="collector-primary">${escapeHtml(isCollectorGroupExpanded(row.rowId) ? 'Hide Branches' : 'View Branches')}</span>
                                            <span class="collector-sub">${escapeHtml(row.branchName || 'Grouped branches')}</span>
                                        </button>`
                                        : `<button type="button" class="collector-branch-edit" onclick="event.stopPropagation(); openCollectorBranchEditor('${encodeURIComponent(row.branchId || '')}', '${encodeURIComponent(row.rowId || '')}')">
                                            <span class="collector-primary">${escapeHtml(row.branchName || 'Main')}</span>
                                            <span class="collector-sub">${escapeHtml(row.accountLabel || row.customer)}</span>
                                            ${renderBranchStatusBadge({ id: row.branchId, inactive: row.branchInactive }, { showActive: false })}
                                        </button>`}
                                </td>
                                ${cells}
                                <td class="total-cell text-right">${escapeHtml(formatPlainNumber(row.totalCollected))}</td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
            <tfoot>
                ${renderCollectorMatrixTotalRows(data, 'td')}
            </tfoot>
        </table>
    `;

    bindCollectorMatrixViewport();
    scheduleCollectorLatestScroll(data);
}

function updateCollectorDashboardMatrixStatus(data, visibleRows) {
    if (!data) return;

    const noteNode = document.getElementById('collector-dashboard-note');
    if (noteNode) {
        const searchTerm = getCollectorSearchTerm();
        const invoiceSearchTerm = getCollectorInvoiceSearchTerm();
        const filterParts = [
            searchTerm ? `account "${searchTerm}"` : '',
            invoiceSearchTerm ? `invoice "${invoiceSearchTerm}"` : ''
        ].filter(Boolean);
        const filterText = filterParts.length
            ? `Showing ${visibleRows.length.toLocaleString()} of ${data.customerRows.length.toLocaleString()} account row(s) for ${filterParts.join(' and ')}.`
            : `${data.customerRows.length.toLocaleString()} account row(s) across ${data.monthColumns.length.toLocaleString()} month(s).`;
        noteNode.textContent = `${filterText} Collected Against Billed follows the invoice billing month. Payments Dated This Month follows the payment/OR date for bank reconciliation, regardless of what billing month the invoice belongs to. Pending billing counts only rows with a contract or meter-reading peso estimate.`;
    }

    const rangeNode = document.getElementById('collector-dashboard-range');
    if (rangeNode) {
        rangeNode.textContent = `${formatMonthLabel(data.windowStart, true)} to ${formatMonthLabel(data.matrixEnd, true)}`;
    }

    const pendingNode = document.getElementById('collector-dashboard-pending');
    if (pendingNode) {
        pendingNode.textContent = `Pending cells: ${data.pendingCellCount.toLocaleString()}`;
    }
}

function renderCollectorDashboardFromData(data, options = {}) {
    if (!data) return null;

    ensureCollectorDashboardDerivedFields(data);
    ensureCollectorRowSearchIndexes(data);
    const visibleRows = prepareCollectorRows(data.customerRows);
    if (!options.matrixOnly) renderCollectorSummaryTable(data);
    renderCollectorMatrixTable(data, visibleRows);
    updateCollectorDashboardMatrixStatus(data, visibleRows);
    updatePriorityCardsFromCurrentData();
    renderPriorityWorklist();

    if (!options.matrixOnly) {
        updateCollectorTodaySummaryCard();
        renderCollectionsCompareScorecard();
    }
    return data;
}

function queueCollectorMatrixFilterRender() {
    if (!collectorDashboardData) {
        if (lastLoadSucceeded) void renderCollectorDashboard();
        return;
    }

    if (collectorMatrixFilterFrame) window.cancelAnimationFrame(collectorMatrixFilterFrame);
    collectorMatrixFilterFrame = window.requestAnimationFrame(() => {
        collectorMatrixFilterFrame = 0;
        renderCollectorDashboardFromData(collectorDashboardData, { matrixOnly: true });
    });
}

function toggleCollectorGroupedRows(groupRowId) {
    const safeRowId = decodeURIComponent(String(groupRowId || '')).trim();
    if (!safeRowId) return;
    if (collectorExpandedGroupRows.has(safeRowId)) {
        collectorExpandedGroupRows.delete(safeRowId);
    } else {
        collectorExpandedGroupRows.add(safeRowId);
    }
    if (collectorDashboardData) {
        renderCollectorDashboardFromData(collectorDashboardData, { matrixOnly: true });
    }
}

function getBranchEditorContext(branchId, rowId = '') {
    const normalizedBranchId = normalizeLookupId(branchId);
    if (!normalizedBranchId || normalizedBranchId.startsWith('unlinked:')) return null;
    const branch = branchMap[normalizedBranchId];
    if (!branch) return null;
    const row = (collectorDashboardData?.customerRows || []).find((item) => (
        String(item.branchId || '') === normalizedBranchId
        && (!rowId || String(item.rowId || '') === String(rowId))
    )) || (collectorDashboardData?.customerRows || []).find((item) => String(item.branchId || '') === normalizedBranchId) || {};
    const companyName = companyMap[String(branch.companyId || row.companyId || '').trim()] || row.customer || 'Unknown';

    return {
        branchId: normalizedBranchId,
        rowId: String(rowId || row.rowId || '').trim(),
        branch,
        companyName,
        row
    };
}

function renderCollectorBranchEditor(context) {
    const branch = context.branch || {};
    const inactive = Number(branch.inactive || 0) === 1;
    const address = branch.address || 'No branch address saved.';
    const email = branch.email || '-';

    return `
        <div class="branch-editor-shell">
            <section class="branch-editor-summary">
                <div>
                    <div class="eyebrow">Customer</div>
                    <strong>${escapeHtml(context.companyName)}</strong>
                </div>
                <div>
                    <div class="eyebrow">Branch ID</div>
                    <strong>${escapeHtml(context.branchId)}</strong>
                </div>
                <div>
                    <div class="eyebrow">Current Status</div>
                    ${renderBranchStatusBadge(branch)}
                </div>
            </section>

            <section class="branch-editor-panel">
                <label>Branch / Dept Name</label>
                <input id="collectorBranchNameView" type="text" value="${escapeHtml(branch.name || 'Main')}" readonly>

                <label>Address</label>
                <textarea id="collectorBranchAddressView" readonly>${escapeHtml(address)}</textarea>

                <label>Email</label>
                <input id="collectorBranchEmailView" type="text" value="${escapeHtml(email)}" readonly>

                <label>Status</label>
                <select id="collectorBranchInactive">
                    <option value="0"${inactive ? '' : ' selected'}>Active</option>
                    <option value="1"${inactive ? ' selected' : ''}>Inactive</option>
                </select>

                <div class="branch-editor-actions">
                    <button type="button" class="btn btn-primary" onclick="saveCollectorBranchStatus()">Save Status</button>
                    <span class="detail-save-status" id="collectorBranchSaveStatus">Ready.</span>
                </div>
            </section>
        </div>
    `;
}

function openCollectorBranchEditor(branchId, rowId = '') {
    const context = getBranchEditorContext(decodeURIComponent(String(branchId || '')), decodeURIComponent(String(rowId || '')));
    const modal = document.getElementById('collectorBranchModal');
    const title = document.getElementById('collectorBranchTitle');
    const subtitle = document.getElementById('collectorBranchSubtitle');
    const content = document.getElementById('collectorBranchContent');
    if (!modal || !title || !subtitle || !content) return;

    if (!context) {
        title.textContent = 'Branch Details';
        subtitle.textContent = 'This row is not linked to an editable branch record.';
        content.innerHTML = '<div class="collection-followup-empty">No editable branch ID found for this row.</div>';
        currentBranchEditorContext = null;
        modal.classList.remove('hidden');
        return;
    }

    currentBranchEditorContext = context;
    title.textContent = context.branch.name || 'Branch Details';
    subtitle.textContent = `${context.companyName} • Branch ID ${context.branchId}`;
    content.innerHTML = renderCollectorBranchEditor(context);
    modal.classList.remove('hidden');
}

function closeCollectorBranchModal() {
    document.getElementById('collectorBranchModal')?.classList.add('hidden');
    currentBranchEditorContext = null;
}

async function saveCollectorBranchStatus() {
    if (!currentBranchEditorContext || isSavingBranchStatus) return;

    const statusNode = document.getElementById('collectorBranchSaveStatus');
    const branchId = currentBranchEditorContext.branchId;
    const inactive = Number(document.getElementById('collectorBranchInactive')?.value || 0) === 1 ? 1 : 0;

    isSavingBranchStatus = true;
    if (statusNode) statusNode.textContent = 'Saving branch status...';

    try {
        await firestoreUpdateDocumentFields('tbl_branchinfo', branchId, {
            inactive: toFirestoreWriteValue(inactive),
            updated_at: toFirestoreWriteValue(toTimestampString(new Date())),
            status_updated_source: toFirestoreWriteValue('collections_branch_editor')
        });

        if (branchMap[branchId]) branchMap[branchId].inactive = inactive;
        currentBranchEditorContext.branch = {
            ...currentBranchEditorContext.branch,
            inactive
        };
        collectorBillingMatrixCache = null;
        collectorBillingMatrixPromise = null;
        collectorDashboardData = null;
        if (statusNode) statusNode.textContent = 'Saved. Refreshing Collections list...';
        await renderCollectorDashboard({ recompute: true });
        openCollectorBranchEditor(branchId, currentBranchEditorContext.rowId);
        const refreshedStatusNode = document.getElementById('collectorBranchSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Branch status updated.';
    } catch (error) {
        console.error('Failed to save branch status:', error);
        if (statusNode) statusNode.textContent = 'Save failed. Please try again.';
    } finally {
        isSavingBranchStatus = false;
    }
}

async function renderCollectorDashboard(options = {}) {
    const renderSeq = ++collectorDashboardRenderSeq;

    if (options.fromSnapshot && collectorDashboardData) {
        return renderCollectorDashboardFromData(collectorDashboardData);
    }

    if (!options.recompute && collectorDashboardData) {
        return renderCollectorDashboardFromData(collectorDashboardData);
    }

    if (!lastLoadSucceeded) {
        return refreshCollectorMatrixFromSnapshot({ quiet: Boolean(options.quiet) });
    }

    const noteNode = document.getElementById('collector-dashboard-note');
    const matrixNode = document.getElementById('collector-matrix-table');
    if (noteNode) {
        noteNode.textContent = 'Finalizing billing and payment status for the month matrix...';
    }
    if (matrixNode) {
        matrixNode.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div><span>Finalizing payment status...</span></div>';
    }

    try {
        const data = await computeCollectorDashboardData();
        if (renderSeq !== collectorDashboardRenderSeq) return null;

        collectorDashboardData = data;
        return renderCollectorDashboardFromData(data);
    } catch (error) {
        if (renderSeq !== collectorDashboardRenderSeq) return null;
        console.error('Collector dashboard render failed:', error);
        if (noteNode) {
            noteNode.textContent = 'Unable to finalize the collection month matrix. Please refresh and try again.';
        }
        if (matrixNode) {
            matrixNode.innerHTML = '<div class="empty-followup">Unable to finalize payment status. Please refresh Collections.</div>';
        }
        return null;
    }
}

async function refreshCollectorMatrixAfterStaffWrite() {
    await refreshCollectorMatrixFromSnapshot({ quiet: true });
    updateCollectorMatrixHeaderStatus();
}

async function refreshCollectorMatrixOnly() {
    const refreshBtn = document.getElementById('btnRefreshCollectorMatrix');
    if (refreshBtn) refreshBtn.disabled = true;
    try {
        await refreshCollectorMatrixFromSnapshot({ quiet: true });
        if (!collectorMatrixSnapshotLoaded) {
            renderCollectorMatrixEmptyState();
        }
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
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

function documentFieldsToPlain(doc) {
    const plain = {
        _docId: getFirestoreDocumentId(doc),
        _docName: doc?.name || ''
    };

    Object.entries(doc?.fields || {}).forEach(([key, value]) => {
        plain[key] = getValue(value);
    });

    return plain;
}

function normalizeLookupId(value) {
    const raw = String(value || '').trim();
    return raw || '';
}

function collectionProfileOverrideDocId(context) {
    const branchId = normalizeLookupId(context?.branchId);
    if (branchId && !branchId.startsWith('unlinked:')) return `branch_${branchId}`;

    const contractId = normalizeLookupId(context?.contractmainId);
    if (contractId) return `contract_${contractId}`;

    return `account_${String(context?.rowId || context?.accountLabel || context?.customer || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 90) || 'unknown'}`;
}

function scheduleSlug(value, fallback = 'unknown') {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 90) || fallback;
}

function collectionScheduleDocId(context, selectedInvoice) {
    const invoiceNo = String(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    if (invoiceNo) return `collection_invoice_${scheduleSlug(invoiceNo)}`;

    const branchId = normalizeLookupId(context?.branchId);
    const monthKey = scheduleSlug(context?.monthKey || context?.label || 'month');
    if (branchId && !branchId.startsWith('unlinked:')) return `collection_branch_${scheduleSlug(branchId)}_${monthKey}`;

    const contractId = normalizeLookupId(context?.contractmainId);
    if (contractId) return `collection_contract_${scheduleSlug(contractId)}_${monthKey}`;

    return `collection_account_${scheduleSlug(context?.accountLabel || context?.customer)}_${monthKey}`;
}

async function loadCollectionScheduleForWorkspace(context, selectedInvoice) {
    const docId = collectionScheduleDocId(context, selectedInvoice);
    try {
        const doc = await firestoreGetDocument('marga_master_schedule', docId);
        return doc ? documentFieldsToPlain(doc) : null;
    } catch (error) {
        console.warn('Unable to load collection schedule override:', error);
        return null;
    }
}

function getCurrentCollectorName() {
    let storedUser = null;
    try {
        storedUser = JSON.parse(localStorage.getItem('marga_user') || sessionStorage.getItem('marga_user') || 'null');
    } catch {
        storedUser = null;
    }
    return String(
        window.MargaAuth?.getUser?.()?.name
        || window.MargaAuth?.getUser?.()?.username
        || storedUser?.name
        || storedUser?.username
        || document.getElementById('current-user')?.textContent
        || localStorage.getItem('marga_current_user')
        || 'Collector'
    ).trim() || 'Collector';
}

function getCollectionRoleLabel(roleKey) {
    return COLLECTION_ASSIGNMENT_ROLES.find((role) => role.key === roleKey)?.label || '';
}

function getCurrentCollectionRoleAssignment() {
    const collectorName = getCurrentCollectorName();
    const assignments = collectionWorkflowSettings.assignments || {};
    return String(assignments[collectorName] || '').trim();
}

function collectionCustomerAssignmentKey(context = {}) {
    const branchId = normalizeLookupId(context.branchId);
    if (branchId && !branchId.startsWith('unlinked:')) return `branch_${branchId}`;
    const companyId = normalizeLookupId(context.companyId);
    if (companyId) return `company_${companyId}`;
    return scheduleSlug(context.accountLabel || context.customer || 'unknown');
}

function getCustomerAssignmentOwner(context = {}) {
    const key = collectionCustomerAssignmentKey(context);
    return String(collectionWorkflowSettings.customerAssignments?.[key] || '').trim();
}

async function loadCollectionWorkflowSettings() {
    if (collectionWorkflowSettingsLoaded) return collectionWorkflowSettings;
    try {
        const doc = await firestoreGetDocument('tbl_app_settings', COLLECTION_WORKFLOW_SETTINGS_DOC_ID);
        const row = doc ? documentFieldsToPlain(doc) : {};
        const parsedTargets = safeParseJson(row.targets_json, {});
        const parsedAssignments = safeParseJson(row.assignments_json, {});
        const parsedCustomerAssignments = safeParseJson(row.customer_assignments_json, {});
        collectionWorkflowSettings = {
            targets: { ...COLLECTION_TARGET_DEFAULTS, ...parsedTargets },
            assignments: parsedAssignments && typeof parsedAssignments === 'object' ? parsedAssignments : {},
            customerAssignments: parsedCustomerAssignments && typeof parsedCustomerAssignments === 'object' ? parsedCustomerAssignments : {}
        };
    } catch (error) {
        console.warn('Unable to load collection workflow settings:', error);
        collectionWorkflowSettings = {
            targets: { ...COLLECTION_TARGET_DEFAULTS },
            assignments: {},
            customerAssignments: {}
        };
    }
    collectionWorkflowSettingsLoaded = true;
    renderDashboardCollectionAssignment();
    return collectionWorkflowSettings;
}

async function saveCollectionWorkflowSettings() {
    const now = toTimestampString(new Date());
    await firestoreSetDocument('tbl_app_settings', COLLECTION_WORKFLOW_SETTINGS_DOC_ID, {
        id: toFirestoreWriteValue(COLLECTION_WORKFLOW_SETTINGS_DOC_ID),
        targets_json: toFirestoreWriteValue(JSON.stringify(collectionWorkflowSettings.targets || {})),
        assignments_json: toFirestoreWriteValue(JSON.stringify(collectionWorkflowSettings.assignments || {})),
        customer_assignments_json: toFirestoreWriteValue(JSON.stringify(collectionWorkflowSettings.customerAssignments || {})),
        updated_at: toFirestoreWriteValue(now),
        updated_by: toFirestoreWriteValue(getCurrentCollectorName()),
        source: toFirestoreWriteValue('collections_module_settings')
    });
}

function safeParseJson(value, fallback) {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function renderCollectionAssignmentSettings() {
    const container = document.getElementById('collectionAssignmentSettings');
    if (!container) return;
    const collectorName = getCurrentCollectorName();
    const currentRole = getCurrentCollectionRoleAssignment();
    container.innerHTML = COLLECTION_ASSIGNMENT_ROLES.map((role) => `
        <div class="collection-settings-role-card">
            <strong>${escapeHtml(role.label)}</strong>
            <p>${escapeHtml(role.description)}</p>
            <label>
                Collector Name
                <input type="text" data-collection-role="${escapeHtml(role.key)}" value="${escapeHtml(getAssignmentNameForRole(role.key, collectorName, currentRole))}" placeholder="Open / collector name">
            </label>
        </div>
    `).join('');
}

function renderDashboardCollectionAssignment() {
    const select = document.getElementById('collectionDashboardAssignmentRole');
    const statusNode = document.getElementById('collectionDashboardAssignmentStatus');
    const textNode = document.getElementById('collectionAssignmentToolbarText');
    if (!select && !statusNode && !textNode) return;

    const collectorName = getCurrentCollectorName();
    const currentRole = getCurrentCollectionRoleAssignment();
    if (select) select.value = currentRole;
    if (statusNode) {
        statusNode.textContent = currentRole
            ? `${collectorName}: ${getCollectionRoleLabel(currentRole)}`
            : `${collectorName}: Open / not set`;
    }
    if (textNode) {
        const assignments = collectionWorkflowSettings.assignments || {};
        const assignedText = Object.entries(assignments)
            .map(([name, role]) => `${name} - ${getCollectionRoleLabel(role) || role}`)
            .join(' | ');
        textNode.textContent = assignedText || 'Choose the lane you are handling today. This is coordination only, not an access lock.';
    }
    syncPriorityCardsForCurrentLane();
}

function syncPriorityCardsForCurrentLane() {
    const allowedModes = getAllowedPriorityModesForCurrentLane();
    const role = getCurrentCollectionRoleAssignment();
    document.querySelectorAll('.priority-card[data-work-queue-mode]').forEach((card) => {
        const mode = String(card.dataset.workQueueMode || '');
        card.classList.toggle('lane-hidden', isCollectionPriorityCardMode(mode) && !allowedModes.has(mode));
    });

    if (currentWorkQueueMode !== 'all' && isCollectionPriorityCardMode(currentWorkQueueMode) && !allowedModes.has(currentWorkQueueMode)) {
        currentWorkQueueMode = 'all';
        currentPriorityWorklistView = 'list';
        document.querySelectorAll('[data-work-queue-mode]').forEach((card) => card.classList.remove('active'));
        recomputeFilteredInvoices();
    }

    const titleNode = document.getElementById('priorityWorklistTitle');
    const subtitleNode = document.getElementById('priorityWorklistSubtitle');
    if (titleNode && currentWorkQueueMode === 'all') {
        const label = role ? getCollectionRoleLabel(role) : 'All collection lanes';
        titleNode.textContent = `${label} Worklist`;
    }
    if (subtitleNode && currentWorkQueueMode === 'all') {
        subtitleNode.textContent = role === 'priority_accounts'
            ? 'Priority lane shows promise, broken promise, high-value, overdue, and due follow-up accounts.'
            : role === 'regular_accounts'
                ? 'Regular lane shows billing received, document concerns, and approval follow-ups.'
                : 'Collection Head sees every priority card and can monitor all lanes.';
    }
}

async function saveDashboardCollectionAssignment() {
    const select = document.getElementById('collectionDashboardAssignmentRole');
    const statusNode = document.getElementById('collectionDashboardAssignmentStatus');
    const collectorName = getCurrentCollectorName();
    const role = String(select?.value || '').trim();
    collectionWorkflowSettings.assignments = {
        ...(collectionWorkflowSettings.assignments || {})
    };

    if (role) {
        collectionWorkflowSettings.assignments[collectorName] = role;
    } else {
        delete collectionWorkflowSettings.assignments[collectorName];
    }

    try {
        if (statusNode) statusNode.textContent = 'Saving lane...';
        await saveCollectionWorkflowSettings();
        renderDashboardCollectionAssignment();
        renderCollectionAssignmentSettings();
        renderPriorityWorklist();
        updatePriorityCardsFromCurrentData();
        if (statusNode) statusNode.textContent = role
            ? `Saved: ${getCollectionRoleLabel(role)}`
            : 'Saved: Open / not set';
    } catch (error) {
        console.warn('Unable to save collection dashboard assignment:', error);
        if (statusNode) statusNode.textContent = 'Lane save failed.';
    }
}

function getAssignmentNameForRole(roleKey, collectorName, currentRole) {
    const assignments = collectionWorkflowSettings.assignments || {};
    const found = Object.entries(assignments).find(([, assignedRole]) => assignedRole === roleKey);
    if (found) return found[0];
    return currentRole === roleKey ? collectorName : '';
}

function fillCollectionTargetInputs() {
    const targets = { ...COLLECTION_TARGET_DEFAULTS, ...(collectionWorkflowSettings.targets || {}) };
    const map = {
        collectionTargetMinimumDaily: 'minimumDailyTarget',
        collectionTargetGoodDaily: 'goodDailyTarget',
        collectionTargetRecoveryDaily: 'recoveryDailyTarget',
        collectionTargetWeekly: 'weeklyTarget',
        collectionTargetWeeklyMin: 'weeklyTargetMin',
        collectionTargetWeeklyMax: 'weeklyTargetMax',
        collectionTargetMonthly: 'monthlyTarget',
        collectionTargetWeek1: 'week1Cumulative',
        collectionTargetWeek2: 'week2Cumulative',
        collectionTargetWeek3: 'week3Cumulative',
        collectionTargetWeek4: 'week4Cumulative'
    };
    Object.entries(map).forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (input) input.value = String(Number(targets[key] || 0));
    });
}

function collectCollectionTargetInputs() {
    const map = {
        minimumDailyTarget: 'collectionTargetMinimumDaily',
        goodDailyTarget: 'collectionTargetGoodDaily',
        recoveryDailyTarget: 'collectionTargetRecoveryDaily',
        weeklyTarget: 'collectionTargetWeekly',
        weeklyTargetMin: 'collectionTargetWeeklyMin',
        weeklyTargetMax: 'collectionTargetWeeklyMax',
        monthlyTarget: 'collectionTargetMonthly',
        week1Cumulative: 'collectionTargetWeek1',
        week2Cumulative: 'collectionTargetWeek2',
        week3Cumulative: 'collectionTargetWeek3',
        week4Cumulative: 'collectionTargetWeek4'
    };
    const targets = {};
    Object.entries(map).forEach(([key, id]) => {
        targets[key] = Number(document.getElementById(id)?.value || COLLECTION_TARGET_DEFAULTS[key] || 0) || 0;
    });
    return targets;
}

function collectCollectionAssignmentInputs() {
    const assignments = {};
    document.querySelectorAll('[data-collection-role]').forEach((input) => {
        const name = String(input.value || '').trim();
        const role = String(input.dataset.collectionRole || '').trim();
        if (name && role) assignments[name] = role;
    });
    return assignments;
}

async function saveCurrentCustomerAssignment() {
    if (!currentCollectorWorkspace?.context) return;
    const owner = String(document.getElementById('collectorCustomerOwner')?.value || getCurrentCollectorName()).trim();
    const role = String(document.getElementById('collectorCustomerOwnerRole')?.value || getCurrentCollectionRoleAssignment() || '').trim();
    const statusNode = document.getElementById('collectorCustomerAssignmentStatus');
    const key = collectionCustomerAssignmentKey(currentCollectorWorkspace.context);
    collectionWorkflowSettings.customerAssignments = {
        ...(collectionWorkflowSettings.customerAssignments || {}),
        [key]: owner
    };
    if (owner && role) {
        collectionWorkflowSettings.assignments = {
            ...(collectionWorkflowSettings.assignments || {}),
            [owner]: role
        };
    }
    try {
        if (statusNode) statusNode.textContent = 'Saving customer assignment...';
        await saveCollectionWorkflowSettings();
        if (statusNode) statusNode.textContent = 'Saved. This is coordination only; access stays open.';
        const content = document.getElementById('collectorCellContent');
        if (content && currentCollectorWorkspace) content.innerHTML = renderCollectorFollowupWorkspace(currentCollectorWorkspace);
        bindCollectorPaymentForm();
    } catch (error) {
        console.warn('Unable to save customer assignment:', error);
        if (statusNode) statusNode.textContent = 'Assignment save failed.';
    }
}

function getSchedulePurposeLabel(scheduleStatus) {
    const label = String(scheduleStatus || '').trim();
    if (/promise/i.test(label)) return 'Promise to Pay';
    if (/contact|number/i.test(label)) return 'Update Contact Number';
    if (/confirmed/i.test(label)) return 'Confirmed Collection';
    if (/toner|ink/i.test(label)) return 'Toner / Ink Delivery';
    if (/shutdown|start up/i.test(label)) return 'Service / Preventive Maintenance';
    if (label) return label;
    return 'Collection';
}

function getCollectionOverrideForContext(context) {
    return collectionProfileOverrides.get(collectionProfileOverrideDocId(context)) || null;
}

function upsertCollectionProfileOverride(context, override) {
    const docId = collectionProfileOverrideDocId(context);
    collectionProfileOverrides.set(docId, {
        ...(collectionProfileOverrides.get(docId) || {}),
        ...override,
        _docId: docId
    });
}

function getCollectionProfileForContext(context) {
    const branchId = normalizeLookupId(context?.branchId);
    if (branchId && collectionProfileByBranchId.has(branchId)) return collectionProfileByBranchId.get(branchId);
    return null;
}

function getProfileField(profile, override, overrideField, legacyFields, fallback = '') {
    const overrideValue = override && override[overrideField];
    if (overrideValue !== null && overrideValue !== undefined && String(overrideValue).trim() !== '') {
        return overrideValue;
    }

    for (const field of legacyFields) {
        const value = profile && profile[field];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }

    return fallback;
}

function getCollectionAddress(context, profile, override) {
    const branch = branchMap[normalizeLookupId(context?.branchId)] || {};
    return getProfileField(profile, override, 'collection_address', ['releaseadd', 'collection_address'], branch.address || '');
}

function getCollectionLocationLabel(locationId, locationLabel = '') {
    const explicit = String(locationLabel || '').trim();
    if (explicit) return explicit;
    const found = COLLECTION_LOCATION_OPTIONS.find((option) => Number(option.id) === Number(locationId));
    return found ? found.label : '-';
}

function getCollectionStatusLabel(statusId) {
    const found = collectionStatusOptions.find((status) => Number(status.id) === Number(statusId));
    return found ? found.label : '-';
}

function getCollectionContactRows(profile, override) {
    const rows = [
        ['ACCOUNTING', 'acctcon', 'acctnum'],
        ['CASHIER', 'cashcon', 'cashnum'],
        ['TREASURY', 'treascon', 'treasnum'],
        ['RELEASING', 'releasecon', 'releasenum']
    ].map(([location, nameField, numberField]) => ({
        location,
        name: String(profile?.[nameField] || '').trim(),
        number: String(profile?.[numberField] || '').trim()
    }));

    const overrideName = String(override?.contact_person || '').trim();
    const overrideNumber = String(override?.contact_number || '').trim();
    if (overrideName || overrideNumber) {
        rows.unshift({
            location: 'WEB OVERRIDE',
            name: overrideName,
            number: overrideNumber
        });
    }

    return rows.filter((row) => row.name || row.number);
}

async function loadCollectionWorkspaceLookups() {
    if (collectionWorkspaceLookupsLoaded) return;
    if (collectionWorkspaceLookupsPromise) return collectionWorkspaceLookupsPromise;

    collectionWorkspaceLookupsPromise = (async () => {
        const [profileDocs, statusDocs, overrideDocs, troubleDocs, activeRoster, employeeDocs, positionDocs] = await Promise.all([
            safeFirestoreGetAll('tbl_collectioninfo', null, {
                fieldMask: [
                    'id',
                    'branch_id',
                    'acctcon',
                    'acctnum',
                    'cashcon',
                    'cashnum',
                    'treascon',
                    'treasnum',
                    'releasecon',
                    'releasenum',
                    'releaseadd',
                    'collection_days',
                    'collection_hours',
                    'followup_days',
                    'followup_time',
                    'time_from',
                    'time_to',
                    'last_contact'
                ],
                maxPages: 80
            }),
            safeFirestoreGetAll('tbl_collectionstatus', null, {
                fieldMask: ['id', 'status', 'statusname', 'description', 'name'],
                maxPages: 10
            }),
            safeFirestoreGetAll('marga_collection_profiles', null, {
                maxPages: 20
            }),
            safeFirestoreGetAll('tbl_trouble', null, {
                fieldMask: ['id', 'trouble', 'description', 'trouble_name', 'name'],
                maxPages: 20
            }),
            loadCollectionActiveEmployeeRoster(),
            safeFirestoreGetAll('tbl_employee', null, {
                fieldMask: [
                    'id',
                    'email',
                    'marga_login_email',
                    'username',
                    'firstname',
                    'lastname',
                    'nickname',
                    'name',
                    'position_id',
                    'position',
                    'position_name',
                    'position_label',
                    'marga_role',
                    'marga_roles',
                    'active',
                    'marga_active',
                    'marga_account_active',
                    'mstatus',
                    'estatus'
                ],
                maxPages: 40
            }),
            safeFirestoreGetAll('tbl_empos', null, {
                fieldMask: ['id', 'position', 'position_name', 'name'],
                maxPages: 10
            })
        ]);

        collectionProfileByBranchId = new Map();
        profileDocs.forEach((doc) => {
            const profile = documentFieldsToPlain(doc);
            const branchId = normalizeLookupId(profile.branch_id);
            if (!branchId) return;
            collectionProfileByBranchId.set(branchId, profile);
        });

        collectionStatusOptions = statusDocs
            .map((doc) => {
                const row = documentFieldsToPlain(doc);
                return {
                    id: Number(row.id || 0),
                    label: String(row.status || row.statusname || row.description || row.name || '').trim()
                };
            })
            .filter((row) => row.id && row.label)
            .sort((a, b) => a.id - b.id);
        if (!collectionStatusOptions.length) collectionStatusOptions = [...DEFAULT_COLLECTION_STATUSES];

        collectionProfileOverrides = new Map();
        overrideDocs.forEach((doc) => {
            const override = documentFieldsToPlain(doc);
            const docId = override._docId;
            if (docId) collectionProfileOverrides.set(docId, override);
        });

        troubleLookupMap = new Map();
        troubleDocs.forEach((doc) => {
            const row = documentFieldsToPlain(doc);
            const id = normalizeLookupId(row.id);
            const label = String(row.trouble || row.description || row.trouble_name || row.name || '').trim();
            if (id && label) troubleLookupMap.set(id, label);
        });

        collectionPositionMap = new Map();
        positionDocs.forEach((doc) => {
            const row = documentFieldsToPlain(doc);
            const id = normalizeLookupId(row.id);
            if (id) collectionPositionMap.set(id, row);
        });

        collectionActiveEmployeeEmails = activeRoster;
        rebuildCollectionAssignableStaff(employeeDocs);

        collectionWorkspaceLookupsLoaded = true;
        collectionWorkspaceLookupsPromise = null;
    })();

    return collectionWorkspaceLookupsPromise;
}

function resolveCollectorCellContext(cell) {
    const firstRecord = (cell.records || [])[0] || {};
    return {
        cellId: cell.id,
        rowId: cell.rowId,
        customer: cell.customer || firstRecord.company || 'Unknown',
        branchName: cell.branchName || firstRecord.branch || 'Main',
        accountLabel: cell.accountLabel || firstRecord.accountLabel || cell.customer || 'Unknown',
        companyId: normalizeLookupId(cell.companyId || firstRecord.companyId),
        branchId: normalizeLookupId(cell.branchId || firstRecord.branchId),
        contractmainId: normalizeLookupId(cell.contractmainId || firstRecord.contractmainId),
        machineId: normalizeLookupId(cell.machineId || firstRecord.machineId),
        serialNumber: normalizeSerialNumber(cell.serialNumber || firstRecord.serialNumber),
        modelName: String(cell.modelName || firstRecord.modelName || '').trim(),
        machineLabel: cell.machineLabel || firstRecord.machineLabel || '',
        monthKey: cell.monthKey,
        label: cell.label
    };
}

function sameBranch(invoice, context) {
    if (context.branchId && invoice.branchId && String(invoice.branchId) === String(context.branchId)) return true;
    return normalizeText(invoice.branch) === normalizeText(context.branchName)
        && normalizeText(invoice.company) === normalizeText(context.customer);
}

function sameCompany(invoice, context) {
    if (context.companyId && invoice.companyId && String(invoice.companyId) === String(context.companyId)) return true;
    return normalizeText(invoice.company) === normalizeText(context.customer);
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeTimeInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const amPmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (amPmMatch) {
        let hour = Number(amPmMatch[1]);
        const minute = amPmMatch[2];
        const period = amPmMatch[3].toUpperCase();
        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        return `${String(hour).padStart(2, '0')}:${minute}`;
    }

    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';

    const hour = Math.min(23, Math.max(0, Number(match[1])));
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function getRelatedUnpaidInvoices(context, scope) {
    const matcher = scope === 'company' ? sameCompany : sameBranch;
    return allInvoices
        .filter((invoice) => matcher(invoice, context))
        .sort((a, b) => {
            const aTime = (a.invoiceDate || normalizeDate(a.dueDate) || new Date(0)).getTime();
            const bTime = (b.invoiceDate || normalizeDate(b.dueDate) || new Date(0)).getTime();
            return aTime - bTime;
        });
}

function getSelectedInvoiceForCell(cell, context, branchInvoices) {
    const candidateKeys = new Set();
    (cell.records || []).forEach((record) => {
        if (record.invoiceNo) candidateKeys.add(String(record.invoiceNo));
        if (record.invoiceId) candidateKeys.add(String(record.invoiceId));
        if (record.invoiceKey) candidateKeys.add(String(record.invoiceKey));
    });

    const exact = branchInvoices.find((invoice) => (
        candidateKeys.has(String(invoice.invoiceNo))
        || candidateKeys.has(String(invoice.invoiceId))
        || candidateKeys.has(String(invoice.invoiceKey))
    ));
    if (exact) return exact;

    if (cell.records?.length) {
        const record = cell.records[0];
        return {
            ...record,
            amount: Number(record.amount || record.billedAmount || 0),
            company: record.company || context.customer,
            branch: record.branch || context.branchName
        };
    }

    return branchInvoices[0] || null;
}

function getOutstandingInvoiceAmount(invoice) {
    const baseAmount = Number(invoice?.amount || invoice?.billedAmount || 0);
    const payments = getPaymentsForSelectedInvoice(invoice);
    if (!payments.length) return baseAmount;

    const latestWithBalance = payments
        .filter((payment) => payment.balanceAmount !== null && payment.balanceAmount !== undefined && Number.isFinite(Number(payment.balanceAmount)))
        .sort((left, right) => {
            const leftTime = (left.paymentDate || new Date(0)).getTime();
            const rightTime = (right.paymentDate || new Date(0)).getTime();
            return rightTime - leftTime;
        })[0];
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0) + getPaymentDeductionAmount(payment), 0);
    const computedBalance = Math.max(0, baseAmount - paidTotal);
    if (latestWithBalance) {
        return Math.min(Math.max(0, Number(latestWithBalance.balanceAmount || 0)), computedBalance);
    }
    return computedBalance;
}

function mergeInvoiceHistories(invoices, records = []) {
    const keys = [];
    invoices.forEach((invoice) => {
        keys.push(invoice.invoiceNo, invoice.invoiceId, invoice.invoiceKey);
    });
    records.forEach((record) => {
        keys.push(record.invoiceNo, record.invoiceId, record.invoiceKey);
    });
    return getHistoryForInvoice(...keys);
}

function queryScheduleByField(fieldPath, value) {
    if (!value) return Promise.resolve([]);
    return firestoreRunQuery({
        from: [{ collectionId: 'tbl_schedule' }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: toFirestoreQueryValue(value)
            }
        },
        limit: 120
    });
}

async function loadServiceDeliveryHistory(context) {
    const cacheKey = `${context.branchId || 'branchless'}:${context.companyId || 'companyless'}`;
    if (serviceHistoryCache.has(cacheKey)) return serviceHistoryCache.get(cacheKey);

    const [branchDocs, companyDocs] = await Promise.all([
        queryScheduleByField('branch_id', context.branchId).catch((error) => {
            console.warn('Branch service history query failed:', error);
            return [];
        }),
        queryScheduleByField('company_id', context.companyId).catch((error) => {
            console.warn('Company service history query failed:', error);
            return [];
        })
    ]);

    const seen = new Set();
    const rows = [...branchDocs, ...companyDocs]
        .filter((doc) => {
            const id = doc.name || '';
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .map((doc) => {
            const row = documentFieldsToPlain(doc);
            const purposeId = Number(row.purpose_id || 0);
            return {
                scheduleId: row.id || getFirestoreDocumentId(doc),
                purposeId,
                trouble: troubleLookupMap.get(normalizeLookupId(row.trouble_id)) || row.trouble || row.problem || '-',
                tech: employeeLookupMap.get(normalizeLookupId(row.tech_id)) || row.tech || '-',
                taskDate: normalizeDate(row.task_datetime || row.task_date || row.scheduled || row.schedule_date || row.datex),
                dateFinished: normalizeDate(row.date_finished || row.datefinished || row.finished_date),
                remarks: row.remarks || row.action_taken || row.findings || ''
            };
        })
        .filter((row) => row.purposeId !== 1)
        .sort((a, b) => {
            const aTime = (a.dateFinished || a.taskDate || new Date(0)).getTime();
            const bTime = (b.dateFinished || b.taskDate || new Date(0)).getTime();
            return bTime - aTime;
        })
        .slice(0, 20);

    serviceHistoryCache.set(cacheKey, rows);
    return rows;
}

async function loadCollectionActivityHistory(context) {
    const cacheKey = `${context.branchId || 'branchless'}:${context.companyId || 'companyless'}`;
    if (collectionActivityCache.has(cacheKey)) return collectionActivityCache.get(cacheKey);

    const [branchDocs, companyDocs] = await Promise.all([
        queryScheduleByField('branch_id', context.branchId).catch((error) => {
            console.warn('Branch collection activity query failed:', error);
            return [];
        }),
        queryScheduleByField('company_id', context.companyId).catch((error) => {
            console.warn('Company collection activity query failed:', error);
            return [];
        })
    ]);

    const seen = new Set();
    const rows = [...branchDocs, ...companyDocs]
        .filter((doc) => {
            const id = doc.name || '';
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .map((doc) => {
            const row = documentFieldsToPlain(doc);
            const purposeId = Number(row.purpose_id || 0);
            const remarks = buildAddressText([row.remarks, row.tl_remarks, row.csr_remarks, row.customer_request]);
            const callDate = normalizeDate(row.date_finished || row.timestmp || row.task_datetime || row.original_sched);
            const employeeId = normalizeLookupId(row.tech_id || row.user_id || row.closedby || row.userlog_id);
            return {
                docId: row._docName || row._docId || '',
                purposeId,
                invoiceKey: String(row.invoice_num || row.invoice_id || '').trim(),
                remarks: remarks || 'Collection follow-up logged.',
                contactPerson: row.caller || row.collocutor || '-',
                contactNumber: row.phone_number || '',
                scheduleStatus: row.status || '',
                statusId: row.status || '',
                locationId: '',
                locationLabel: '',
                isCheckSigned: false,
                checkNumber: '',
                paymentAmount: Number(row.amt_collected || 0) || 0,
                collectionId: row.collectioninfo_id || '',
                employeeId,
                followedUpBy: employeeLookupMap.get(employeeId) || '',
                followupDate: normalizeDate(row.commitment_date || row.task_datetime),
                followupDateRaw: row.commitment_date || row.task_datetime || '',
                followupDateKey: toDateKey(normalizeDate(row.commitment_date || row.task_datetime)),
                callDate,
                callDateRaw: row.date_finished || row.timestmp || row.task_datetime || '',
                callDateKey: toDateKey(callDate),
                source: 'collection_schedule'
            };
        })
        .filter((row) => Number(row.purposeId || 0) === 1)
        .filter((row) => row.callDate && row.remarks && row.remarks !== 'Collection follow-up logged.')
        .sort((a, b) => {
            const aTime = (a.callDate || new Date(0)).getTime();
            const bTime = (b.callDate || new Date(0)).getTime();
            return bTime - aTime;
        })
        .slice(0, 30);

    collectionActivityCache.set(cacheKey, rows);
    return rows;
}

function isCollectorProjectionOnlyCell(cell) {
    if (!cell?.pendingBilling && !cell?.missedReading) return false;
    const records = Array.isArray(cell.records) ? cell.records : [];
    const hasInvoiceRecord = records.some((record) => {
        const key = String(record.invoiceNo || record.invoiceId || record.invoiceKey || '').trim();
        return Boolean(key);
    });
    return !hasInvoiceRecord;
}

function buildCollectorProjectionOnlyWorkspace(cell) {
    const context = resolveCollectorCellContext(cell);
    const projectionAmount = Number(cell.pendingBillingProjectionTotal || cell.displayBilledTotal || cell.billedTotal || 0);
    return {
        lite: true,
        cell,
        context,
        projectionAmount,
        statusLabel: cell.missedReading ? 'Missed Reading' : 'Pending Billing'
    };
}

function renderCollectorProjectionOnlyWorkspace(workspace) {
    const { cell, context, projectionAmount, statusLabel } = workspace;
    return `
        <div class="collection-followup-shell collection-followup-lite">
            <section class="collection-followup-hero">
                <div>
                    <div class="collection-followup-kicker">${escapeHtml(statusLabel)} • ${escapeHtml(cell.label || context.label || '')}</div>
                    <h3>${escapeHtml(context.customer)}</h3>
                    <p>${escapeHtml(context.branchName || context.accountLabel || 'Main')} • ${escapeHtml(displaySerialNumber(context.serialNumber))}</p>
                </div>
            </section>
            <div class="collection-followup-panel">
                <div class="collection-followup-panel-title">Matrix Projection</div>
                <p>This month cell is a <strong>${escapeHtml(statusLabel)}</strong> projection from the saved matrix summary. There is no saved invoice row linked yet, so invoice history, schedules, and service records were not loaded.</p>
                <div class="collection-followup-facts">
                    <div><span>Estimated amount</span><strong>${escapeHtml(formatCurrency(projectionAmount))}</strong></div>
                    <div><span>Reading tasks</span><strong>${escapeHtml(String(cell.readingTaskCount || 0))}</strong></div>
                </div>
            </div>
        </div>
    `;
}

function decodeCollectorCellToken(cellId) {
    try {
        return decodeURIComponent(String(cellId || '').trim());
    } catch (error) {
        return String(cellId || '').trim();
    }
}

async function openCollectorCellFullWorkspace(cellId) {
    const safeCellId = decodeCollectorCellToken(cellId);
    const cell = collectorCellMap.get(safeCellId);
    if (!cell) {
        console.warn('Collection cell not found for follow-up workspace:', safeCellId);
        window.alert('Unable to open this cell. Refresh the matrix and try again.');
        return;
    }
    const modal = document.getElementById('collectorCellModal');
    const subtitle = document.getElementById('collectorCellSubtitle');
    const content = document.getElementById('collectorCellContent');
    if (subtitle) subtitle.textContent = 'Loading full invoice detail, history, and schedules...';
    if (content) {
        content.innerHTML = `
            <div class="loading-overlay"><div class="loading-spinner"></div><span>Loading full follow-up workspace...</span></div>
        `;
    }
    if (modal) modal.classList.remove('hidden');
    currentCollectorWorkspace = {
        cell,
        context: resolveCollectorCellContext(cell),
        cellId: cell.id
    };

    try {
        if (!lastLoadSucceeded) await ensureCollectorCellDetailData(cell);
        const workspace = await buildCollectorFollowupWorkspace(cell, { forceFull: true });
        if (currentCollectorWorkspace?.cellId !== cell.id) return;
        currentCollectorWorkspace = { ...workspace, cellId: cell.id };
        const title = document.getElementById('collectorCellTitle');
        if (title) {
            title.textContent = `${workspace.context.customer} • ${workspace.context.branchName || 'Main'} • ${workspace.context.label}`;
        }
        if (subtitle) {
            subtitle.textContent = workspace.selectedInvoice
                ? `Invoice #${workspace.selectedInvoice.invoiceNo || workspace.selectedInvoice.invoiceId || '-'} follow-up`
                : 'Follow-up workspace';
        }
        if (content) {
            content.innerHTML = renderCollectorFollowupWorkspace(workspace);
            bindCollectorPaymentForm();
        }
    } catch (error) {
        console.error('Failed to open full collection follow-up workspace:', error);
        if (subtitle) subtitle.textContent = 'Full follow-up workspace could not load.';
    }
}

async function buildCollectorFollowupWorkspace(cell, options = {}) {
    if (!options.forceFull && isCollectorProjectionOnlyCell(cell)) {
        return buildCollectorProjectionOnlyWorkspace(cell);
    }

    await Promise.all([loadCollectionWorkspaceLookups(), loadCollectionWorkflowSettings()]);

    const context = resolveCollectorCellContext(cell);
    const profile = getCollectionProfileForContext(context);
    const override = getCollectionOverrideForContext(context);
    const branchInvoices = getRelatedUnpaidInvoices(context, 'branch');
    const companyInvoices = getRelatedUnpaidInvoices(context, 'company');
    const selectedInvoice = getSelectedInvoiceForCell(cell, context, branchInvoices);
    await loadCollectionHistoryForKeys([
        selectedInvoice?.invoiceNo,
        selectedInvoice?.invoiceId,
        selectedInvoice?.invoiceKey,
        ...(cell.records || []).flatMap((record) => [record.invoiceNo, record.invoiceId, record.invoiceKey, record.id]),
        ...collectionAccountHistoryKeys(context),
        ...collectionAccountHistoryKeys(cell)
    ]);
    const directInvoiceHistory = mergeInvoiceHistories(
        selectedInvoice ? [selectedInvoice, ...branchInvoices] : branchInvoices,
        cell.records || []
    );
    const accountHistory = getHistoryForCollectorRow(cell.rowId);
    const [serviceHistory, activeSchedule, collectionActivityHistory] = await Promise.all([
        loadServiceDeliveryHistory(context),
        loadCollectionScheduleForWorkspace(context, selectedInvoice),
        loadCollectionActivityHistory(context)
    ]);
    const invoiceHistory = mergeHistoryLists(directInvoiceHistory, accountHistory, collectionActivityHistory);
    const lastHistory = invoiceHistory[0] || null;

    const branchBalance = branchInvoices.reduce((sum, invoice) => sum + getOutstandingInvoiceAmount(invoice), 0);
    const companyBalance = companyInvoices.reduce((sum, invoice) => sum + getOutstandingInvoiceAmount(invoice), 0);
    const selectedContact = lastHistory && hasMeaningfulContact(lastHistory.contactPerson)
        ? lastHistory.contactPerson
        : getCollectionContactRows(profile, override)[0]?.name || '';
    const selectedContactNumber = lastHistory?.contactNumber
        || getCollectionContactRows(profile, override)[0]?.number
        || selectedInvoice?.contactNumber
        || '';

    return {
        cell,
        context,
        profile,
        override,
        selectedInvoice,
        branchInvoices,
        companyInvoices,
        invoiceHistory,
        lastHistory,
        serviceHistory,
        activeSchedule,
        branchBalance,
        companyBalance,
        selectedContact,
        selectedContactNumber,
        address: getCollectionAddress(context, profile, override)
    };
}

function renderMiniInvoiceRows(invoices, emptyText) {
    if (!invoices.length) {
        return `<div class="collection-followup-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Invoice #</th>
                        <th>Branch</th>
                        <th>Amount</th>
                        <th>Month / Yr</th>
                        <th>Rcvd By</th>
                        <th>Date Rcvd</th>
                    </tr>
                </thead>
                <tbody>
                    ${invoices.slice(0, 28).map((invoice) => `
                        <tr>
                            <td><input type="checkbox" checked aria-label="Selected invoice ${escapeHtml(invoice.invoiceNo || '')}"></td>
                            <td>${escapeHtml(invoice.invoiceNo || invoice.invoiceId || '-')}</td>
                            <td>${escapeHtml(invoice.branch || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(invoice.amount || 0))}</td>
                            <td>${escapeHtml(invoice.monthYear || '-')}</td>
                            <td>${escapeHtml(invoice.receivedBy || '-')}</td>
                            <td>${escapeHtml(formatDate(invoice.dateReceived))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCollectorWorkspaceInvoiceList(workspace, selectedInvoice) {
    const invoices = getCollectorSoaCandidateInvoices(workspace);
    if (!invoices.length) {
        return `
            <section class="collection-account-invoices-panel">
                <div class="collection-account-invoices-head">
                    <div class="collection-account-invoices-title">Unpaid Invoices In This List</div>
                    <div class="collection-account-invoices-total">No linked unpaid invoices</div>
                </div>
                <div class="collection-followup-empty">No unpaid invoice list is available for this account row yet.</div>
            </section>
        `;
    }

    const selectedKeys = new Set([
        selectedInvoice?.invoiceKey,
        selectedInvoice?.invoiceNo,
        selectedInvoice?.invoiceId
    ].map((value) => String(value || '').trim()).filter(Boolean));
    const totalBalance = invoices.reduce((sum, invoice) => sum + getOutstandingInvoiceAmount(invoice), 0);
    const sortedInvoices = [...invoices].sort((left, right) => {
        const leftTime = (left.invoiceDate || normalizeDate(left.dueDate) || new Date(0)).getTime();
        const rightTime = (right.invoiceDate || normalizeDate(right.dueDate) || new Date(0)).getTime();
        if (leftTime !== rightTime) return leftTime - rightTime;
        return String(left.invoiceNo || '').localeCompare(String(right.invoiceNo || ''));
    });

    return `
        <section class="collection-account-invoices-panel">
            <div class="collection-account-invoices-head">
                <div class="collection-account-invoices-title">Unpaid Invoices In This List</div>
                <div class="collection-account-invoices-total">${escapeHtml(sortedInvoices.length.toLocaleString())} row(s) • ${escapeHtml(formatCurrency(totalBalance))}</div>
            </div>
            <div class="collection-followup-table-wrap">
                <table class="collection-followup-table">
                    <thead>
                        <tr>
                            <th>Invoice Date</th>
                            <th>Invoice #</th>
                            <th>Branch</th>
                            <th class="text-right">Amount</th>
                            <th class="text-right">Balance</th>
                            <th>Received</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedInvoices.map((invoice) => {
                            const key = String(invoice.invoiceKey || invoice.invoiceNo || invoice.invoiceId || '').trim();
                            const isSelected = key && selectedKeys.has(key);
                            return `
                                <tr class="${isSelected ? 'selected' : ''}">
                                    <td>${escapeHtml(formatDate(invoice.invoiceDate || invoice.dueDate))}</td>
                                    <td>${escapeHtml(invoice.invoiceNo || invoice.invoiceId || invoice.invoiceKey || '-')}</td>
                                    <td>${escapeHtml(invoice.branch || '-')}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(invoice.amount || invoice.billedAmount || 0))}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(getOutstandingInvoiceAmount(invoice)))}</td>
                                    <td>${escapeHtml(formatDate(invoice.dateReceived))}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function closeCollectorSoaPeriodModal() {
    document.getElementById('collectorSoaPeriodModal')?.classList.add('hidden');
}

function openCollectorSoaPeriodModal() {
    const modal = document.getElementById('collectorSoaPeriodModal');
    if (!modal || !currentCollectorWorkspace) return;

    const fromInput = document.getElementById('collectorSoaFromDate');
    const toInput = document.getElementById('collectorSoaToDate');
    const subtitle = document.getElementById('collectorSoaSubtitle');
    const note = document.getElementById('collectorSoaPeriodNote');
    const status = document.getElementById('collectorSoaStatus');
    const context = currentCollectorWorkspace.context || {};
    const accountLabel = context.accountLabel || context.customer || 'this account';
    const defaultFromDate = getCollectorSoaDefaultFromDate(currentCollectorWorkspace);
    const defaultFromKey = toDateKey(defaultFromDate) || '2026-01-01';

    if (fromInput) fromInput.value = defaultFromKey;
    if (toInput) toInput.value = getTodayInputValue(0);
    if (subtitle) subtitle.textContent = `Choose the SOA period for ${accountLabel}.`;
    if (note) note.textContent = `Default starts ${formatDate(defaultFromDate)} based on the earliest unpaid invoice in this workspace.`;
    if (status) status.textContent = 'Ready.';

    modal.classList.remove('hidden');
}

function getCollectorSoaCandidateInvoices(workspace) {
    const context = workspace?.context || {};
    const candidates = [];
    const append = (invoice, source = 'workspace', cell = null) => {
        if (!invoice) return;
        const cellAmount = cell ? getPriorityCellAmount(cell) : 0;
        candidates.push({
            ...invoice,
            source,
            invoiceDate: normalizeDate(invoice.invoiceDate || invoice.dueDate) || null,
            amount: Number(invoice.amount || invoice.billedAmount || invoice.displayBilledTotal || cellAmount || 0) || 0,
            company: invoice.company || cell?.customer || context.customer,
            branch: invoice.branch || cell?.branchName || context.branchName,
            companyId: invoice.companyId || cell?.companyId || context.companyId,
            branchId: invoice.branchId || cell?.branchId || context.branchId
        });
    };

    getCollectorSoaListGroupCells(workspace).forEach((cell) => {
        const records = Array.isArray(cell.records) ? cell.records : [];
        if (records.length) {
            records.forEach((record) => append(record, 'list_group', cell));
        } else {
            append({
                invoiceNo: cell.pendingBilling ? 'Pending billing' : cell.id,
                invoiceId: cell.id,
                invoiceKey: cell.id,
                invoiceDate: normalizeDate(cell.monthKey ? `${cell.monthKey}-01` : ''),
                amount: getPriorityCellAmount(cell),
                company: cell.customer,
                branch: cell.branchName,
                companyId: cell.companyId,
                branchId: cell.branchId
            }, 'list_group_cell', cell);
        }
    });

    (workspace?.branchInvoices || []).forEach((invoice) => append(invoice, 'branch'));
    if (!candidates.length && workspace?.selectedInvoice) append(workspace.selectedInvoice, 'selected');
    if (!candidates.length) {
        (workspace?.cell?.records || []).forEach((record) => append(record, 'cell', workspace?.cell));
    }

    collectorBillingRecords
        .filter((record) => isCollectorSoaRecordMatch(record, context))
        .forEach((record) => append(record, 'loaded_billing'));

    const seen = new Set();
    return candidates
        .filter((invoice) => {
            const key = String(invoice.invoiceKey || invoice.invoiceNo || invoice.invoiceId || '').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .filter((invoice) => Number(invoice.amount || invoice.billedAmount || 0) > 0);
}

function getCollectorSoaListGroupCells(workspace) {
    const context = workspace?.context || {};
    const selectedCell = workspace?.cell || null;
    const selectedRowId = String(selectedCell?.rowId || context.rowId || '').trim();
    const rows = selectedRowId
        ? (collectorDashboardData?.customerRows || []).filter((row) => String(row.rowId || '').trim() === selectedRowId)
        : [];
    const cells = rows.flatMap((row) => getCollectorRowOpenCells(row));
    if (selectedCell) cells.push(selectedCell);

    const seen = new Set();
    return cells
        .filter((cell) => {
            const id = String(cell?.id || '').trim();
            if (!cell || !id || seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .filter((cell) => isCollectorSoaRecordMatch({
            company: cell.customer,
            branch: cell.branchName,
            companyId: cell.companyId,
            branchId: cell.branchId
        }, context));
}

function getCollectorSoaDefaultFromDate(workspace) {
    const dates = getCollectorSoaCandidateInvoices(workspace)
        .map((invoice) => normalizeDate(invoice.invoiceDate || invoice.dueDate))
        .filter(Boolean)
        .sort((left, right) => left.getTime() - right.getTime());
    return dates[0] || normalizeDate('2026-01-01') || new Date();
}

function isCollectorSoaRecordMatch(record, context) {
    const companyId = normalizeLookupId(context?.companyId);
    const branchId = normalizeLookupId(context?.branchId);
    const recordCompanyId = normalizeLookupId(record?.companyId);
    const recordBranchId = normalizeLookupId(record?.branchId);

    if (companyId && recordCompanyId && companyId !== recordCompanyId) return false;
    if (branchId && recordBranchId) return branchId === recordBranchId;
    if (companyId && recordCompanyId) return companyId === recordCompanyId;

    return normalizeText(record?.company) === normalizeText(context?.customer);
}

function getPaymentsForInvoiceKeys(invoice) {
    const keys = new Set([
        invoice?.invoiceId,
        invoice?.invoiceNo,
        invoice?.invoiceKey
    ].map((value) => String(value || '').trim()).filter(Boolean));
    if (!keys.size) return [];
    return paymentEntries.filter((entry) => (
        keys.has(String(entry.invoiceId || '').trim())
        || keys.has(String(entry.invoiceNo || '').trim())
    ));
}

function buildCollectorSoaRows(workspace, fromDate, toDate) {
    const matchedInvoices = getCollectorSoaCandidateInvoices(workspace)
        .filter((record) => record.invoiceDate && isDateWithinRange(record.invoiceDate, fromDate, toDate))
        .sort((left, right) => {
            const leftTime = (left.invoiceDate || new Date(0)).getTime();
            const rightTime = (right.invoiceDate || new Date(0)).getTime();
            if (leftTime !== rightTime) return leftTime - rightTime;
            return String(left.invoiceNo || '').localeCompare(String(right.invoiceNo || ''));
        });

    let finalBalance = 0;
    const rows = matchedInvoices.map((invoice) => {
        const payments = getPaymentsForInvoiceKeys(invoice).filter((payment) => isDateWithinRange(getCollectorPaymentTotalDate(payment), fromDate, toDate));
        const paymentAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0) + getPaymentDeductionAmount(payment), 0);
        const latestBalance = payments
            .filter((payment) => payment.balanceAmount !== null && payment.balanceAmount !== undefined && Number.isFinite(Number(payment.balanceAmount)))
            .sort((left, right) => {
                const leftTime = (left.paymentDate || new Date(0)).getTime();
                const rightTime = (right.paymentDate || new Date(0)).getTime();
                return rightTime - leftTime;
            })[0]?.balanceAmount;
        const workspaceBalance = getOutstandingInvoiceAmount(invoice);
        const computedBalance = Math.max(0, Number(invoice.amount || invoice.billedAmount || 0) - paymentAmount);
        const balance = latestBalance !== undefined
            ? Math.min(Math.max(0, Number(latestBalance || 0)), computedBalance)
            : (workspaceBalance > 0 ? workspaceBalance : computedBalance);
        finalBalance += balance;

        return {
            date: invoice.invoiceDate,
            invoiceNo: invoice.invoiceNo || invoice.invoiceId || invoice.invoiceKey || '-',
            amountBilled: Number(invoice.amount || invoice.billedAmount || 0),
            payment: paymentAmount,
            balance
        };
    });

    return {
        rows,
        totals: {
            amountBilled: rows.reduce((sum, row) => sum + row.amountBilled, 0),
            payment: rows.reduce((sum, row) => sum + row.payment, 0),
            finalBalance
        }
    };
}

function renderCollectorSoaPrintHtml(workspace, fromDate, toDate, soa) {
    const context = workspace.context || {};
    const rows = soa.rows.length
        ? soa.rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatDate(row.date))}</td>
                <td>${escapeHtml(row.invoiceNo)}</td>
                <td class="num">${escapeHtml(formatCurrency(row.amountBilled))}</td>
                <td class="num">${escapeHtml(formatCurrency(row.payment))}</td>
                <td class="num">${escapeHtml(formatCurrency(row.balance))}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="5" class="empty">No SOA rows found for the selected period.</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SOA - ${escapeHtml(context.customer || 'Collection Account')}</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 28px; color: #112f4e; font-family: Arial, sans-serif; }
        .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #1e4976; padding-bottom: 14px; margin-bottom: 18px; }
        h1 { margin: 0; font-size: 24px; letter-spacing: 0.02em; }
        .meta { color: #4b6580; font-size: 12px; line-height: 1.45; margin-top: 6px; }
        .printed { text-align: right; color: #4b6580; font-size: 12px; line-height: 1.45; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px 9px; }
        th { background: #eaf2ff; color: #294e73; text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
        .num { text-align: right; white-space: nowrap; }
        tfoot td { font-weight: 700; background: #f8fafc; }
        .final { margin-top: 18px; display: flex; justify-content: flex-end; }
        .final-box { min-width: 260px; border: 2px solid #1e4976; padding: 12px 14px; text-align: right; }
        .final-box span { display: block; color: #4b6580; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .final-box strong { display: block; margin-top: 5px; font-size: 24px; color: #12395f; }
        .empty { text-align: center; color: #64748b; font-weight: 700; padding: 22px; }
        @media print { body { padding: 18mm; } }
    </style>
</head>
<body>
    <section class="head">
        <div>
            <h1>Statement of Account</h1>
            <div class="meta">
                <strong>${escapeHtml(context.customer || '-')}</strong><br>
                ${escapeHtml(context.branchName || context.accountLabel || '')}<br>
                Period: ${escapeHtml(formatRangeLabel(fromDate, toDate))}
            </div>
        </div>
        <div class="printed">
            MARGA Collections<br>
            Printed: ${escapeHtml(new Date().toLocaleString('en-PH'))}
        </div>
    </section>
    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Inv No.</th>
                <th class="num">Amount Billed</th>
                <th class="num">Payment</th>
                <th class="num">Balance</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
            <tr>
                <td colspan="2">Totals</td>
                <td class="num">${escapeHtml(formatCurrency(soa.totals.amountBilled))}</td>
                <td class="num">${escapeHtml(formatCurrency(soa.totals.payment))}</td>
                <td class="num">${escapeHtml(formatCurrency(soa.totals.finalBalance))}</td>
            </tr>
        </tfoot>
    </table>
    <div class="final">
        <div class="final-box">
            <span>Final Balance</span>
            <strong>${escapeHtml(formatCurrency(soa.totals.finalBalance))}</strong>
        </div>
    </div>
    <script>
        window.addEventListener('load', () => {
            window.focus();
            window.print();
        });
    <\/script>
</body>
</html>`;
}

function getCollectorSoaPayloadFromModal() {
    const status = document.getElementById('collectorSoaStatus');
    if (!currentCollectorWorkspace) {
        if (status) status.textContent = 'Open a collection follow-up first.';
        return null;
    }

    const fromDate = normalizeDate(document.getElementById('collectorSoaFromDate')?.value || '2026-01-01');
    const toDate = normalizeDate(document.getElementById('collectorSoaToDate')?.value || getTodayInputValue(0));
    if (!fromDate || !toDate || fromDate > toDate) {
        if (status) status.textContent = 'Please choose a valid from/to period.';
        return null;
    }

    const soa = buildCollectorSoaRows(currentCollectorWorkspace, fromDate, toDate);
    return {
        status,
        workspace: currentCollectorWorkspace,
        fromDate,
        toDate,
        soa
    };
}

function printCollectorSoaFromModal() {
    const payload = getCollectorSoaPayloadFromModal();
    if (!payload) return;
    const { status, workspace, fromDate, toDate, soa } = payload;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        if (status) status.textContent = 'Print popup was blocked. Allow popups and try again.';
        return;
    }

    printWindow.document.open();
    printWindow.document.write(renderCollectorSoaPrintHtml(workspace, fromDate, toDate, soa));
    printWindow.document.close();
    if (status) status.textContent = `Prepared ${soa.rows.length.toLocaleString()} SOA row(s).`;
    closeCollectorSoaPeriodModal();
}

function safePdfFilePart(value) {
    return String(value || 'collection-account')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        || 'collection-account';
}

function buildCollectorSoaPdfDefinition(workspace, fromDate, toDate, soa) {
    const context = workspace.context || {};
    const tableBody = [
        [
            { text: 'Date', style: 'tableHeader' },
            { text: 'Inv No.', style: 'tableHeader' },
            { text: 'Amount Billed', style: 'tableHeader', alignment: 'right' },
            { text: 'Payment', style: 'tableHeader', alignment: 'right' },
            { text: 'Balance', style: 'tableHeader', alignment: 'right' }
        ],
        ...(soa.rows.length
            ? soa.rows.map((row) => [
                formatDate(row.date),
                String(row.invoiceNo || '-'),
                { text: formatCurrency(row.amountBilled), alignment: 'right' },
                { text: formatCurrency(row.payment), alignment: 'right' },
                { text: formatCurrency(row.balance), alignment: 'right' }
            ])
            : [[
                { text: 'No SOA rows found for the selected period.', colSpan: 5, alignment: 'center', color: '#64748b', bold: true },
                {}, {}, {}, {}
            ]]),
        [
            { text: 'Totals', colSpan: 2, bold: true, fillColor: '#f8fafc' },
            {},
            { text: formatCurrency(soa.totals.amountBilled), alignment: 'right', bold: true, fillColor: '#f8fafc' },
            { text: formatCurrency(soa.totals.payment), alignment: 'right', bold: true, fillColor: '#f8fafc' },
            { text: formatCurrency(soa.totals.finalBalance), alignment: 'right', bold: true, fillColor: '#f8fafc' }
        ]
    ];

    return {
        pageSize: 'LETTER',
        pageMargins: [36, 32, 36, 36],
        defaultStyle: {
            fontSize: 9,
            color: '#112f4e'
        },
        content: [
            {
                columns: [
                    {
                        width: '*',
                        stack: [
                            { text: 'Statement of Account', style: 'title' },
                            { text: context.customer || '-', style: 'accountName' },
                            { text: context.branchName || context.accountLabel || '', style: 'meta' },
                            { text: `Period: ${formatRangeLabel(fromDate, toDate)}`, style: 'meta' }
                        ]
                    },
                    {
                        width: 170,
                        stack: [
                            { text: 'MARGA Collections', alignment: 'right', style: 'metaStrong' },
                            { text: `Generated: ${new Date().toLocaleString('en-PH')}`, alignment: 'right', style: 'meta' }
                        ]
                    }
                ],
                margin: [0, 0, 0, 12]
            },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 540, y2: 0, lineWidth: 1.4, lineColor: '#1e4976' }], margin: [0, 0, 0, 12] },
            {
                table: {
                    headerRows: 1,
                    widths: [78, 78, '*', '*', '*'],
                    body: tableBody
                },
                layout: {
                    hLineColor: () => '#cbd5e1',
                    vLineColor: () => '#cbd5e1',
                    hLineWidth: () => 0.7,
                    vLineWidth: () => 0.7,
                    paddingTop: () => 5,
                    paddingBottom: () => 5,
                    paddingLeft: () => 6,
                    paddingRight: () => 6
                }
            },
            {
                columns: [
                    { width: '*', text: '' },
                    {
                        width: 190,
                        margin: [0, 18, 0, 0],
                        table: {
                            widths: ['*'],
                            body: [[
                                {
                                    stack: [
                                        { text: 'FINAL BALANCE', alignment: 'right', style: 'finalLabel' },
                                        { text: formatCurrency(soa.totals.finalBalance), alignment: 'right', style: 'finalValue' }
                                    ],
                                    margin: [8, 8, 8, 8]
                                }
                            ]]
                        },
                        layout: {
                            hLineColor: () => '#1e4976',
                            vLineColor: () => '#1e4976',
                            hLineWidth: () => 1.2,
                            vLineWidth: () => 1.2
                        }
                    }
                ]
            }
        ],
        styles: {
            title: { fontSize: 18, bold: true, color: '#12395f', margin: [0, 0, 0, 4] },
            accountName: { fontSize: 10, bold: true, color: '#12395f', margin: [0, 0, 0, 2] },
            meta: { fontSize: 8, color: '#4b6580', lineHeight: 1.2 },
            metaStrong: { fontSize: 8, bold: true, color: '#4b6580' },
            tableHeader: { bold: true, color: '#294e73', fillColor: '#eaf2ff', fontSize: 8 },
            finalLabel: { fontSize: 8, bold: true, color: '#4b6580' },
            finalValue: { fontSize: 17, bold: true, color: '#12395f', margin: [0, 3, 0, 0] }
        }
    };
}

function downloadCollectorSoaPdfFromModal() {
    const payload = getCollectorSoaPayloadFromModal();
    if (!payload) return;
    const { status, workspace, fromDate, toDate, soa } = payload;

    if (!window.pdfMake?.createPdf) {
        if (status) status.textContent = 'PDF download library is still loading. Opening print view instead.';
        printCollectorSoaFromModal();
        return;
    }

    const context = workspace.context || {};
    const fileName = `SOA-${safePdfFilePart(context.customer)}-${toDateKey(fromDate) || 'from'}-to-${toDateKey(toDate) || 'today'}.pdf`;
    const definition = buildCollectorSoaPdfDefinition(workspace, fromDate, toDate, soa);
    window.pdfMake.createPdf(definition).download(fileName);
    if (status) status.textContent = `Downloading PDF with ${soa.rows.length.toLocaleString()} SOA row(s).`;
    closeCollectorSoaPeriodModal();
}

function renderHistoryRows(history) {
    if (!history.length) return '<div class="collection-followup-empty">No conversation history yet.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Invoice No.</th>
                        <th>Date / Time</th>
	                        <th>Followed Up By</th>
	                        <th>Conversation Result</th>
	                        <th>Promise To Pay</th>
	                        <th>Issue</th>
	                        <th>Status</th>
                        <th>Location</th>
                        <th>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.slice(0, 30).map((item) => `
                        <tr>
	                            <td>${escapeHtml(item.invoiceKey || item.collectionId || '-')}</td>
	                            <td>${escapeHtml(formatDate(item.callDate))}</td>
	                            <td>${escapeHtml(getHistoryActor(item) || '-')}</td>
	                            <td>${escapeHtml(item.conversationResult || '-')}</td>
	                            <td>${escapeHtml(item.promiseToPay || '-')}</td>
	                            <td>${escapeHtml(item.issueType || '-')}</td>
	                            <td>${escapeHtml(getCollectionStatusLabel(item.statusId) || item.scheduleStatus || '-')}</td>
                            <td>${escapeHtml(getCollectionLocationLabel(item.locationId, item.locationLabel))}</td>
                            <td>${escapeHtml(item.remarks || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderServiceRows(rows) {
    if (!rows.length) return '<div class="collection-followup-empty">No recent service or delivery history found for this branch/company.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Sched ID</th>
                        <th>Trouble</th>
                        <th>Tech</th>
                        <th>Task Date</th>
                        <th>Date Fnshd</th>
                        <th>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.scheduleId || '-')}</td>
                            <td>${escapeHtml(row.trouble || '-')}</td>
                            <td>${escapeHtml(row.tech || '-')}</td>
                            <td>${escapeHtml(formatDate(row.taskDate))}</td>
                            <td>${escapeHtml(formatDate(row.dateFinished))}</td>
                            <td>${escapeHtml(row.remarks || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getInvoicePaymentMatchKeys(invoice) {
    if (!invoice) return new Set();
    const keys = new Set([
        invoice.invoiceId,
        invoice.invoiceNo,
        invoice.invoiceKey
    ].map((value) => String(value || '').trim()).filter(Boolean));
    const documentId = String(invoice.id || '').trim();
    if (documentId && (!keys.size || keys.has(documentId))) {
        keys.add(documentId);
    }
    return keys;
}

function getPaymentsForSelectedInvoice(invoice) {
    const keys = getInvoicePaymentMatchKeys(invoice);
    if (!keys.size) return [];

    return paymentEntries
        .filter((entry) => keys.has(String(entry.invoiceId || '').trim()) || keys.has(String(entry.invoiceNo || '').trim()))
        .sort((left, right) => {
            const leftTime = (left.paymentDate || new Date(0)).getTime();
            const rightTime = (right.paymentDate || new Date(0)).getTime();
            return rightTime - leftTime;
        });
}

function getPaymentDeductionAmount(payment) {
    const explicit = Number(payment?.deductionAmount || 0);
    if (explicit > 0) return explicit;
    return Number(payment?.tax2307 || 0) + Number(payment?.otherDeductionAmount || 0);
}

function is2307DeductionPayment(payment) {
    return String(payment?.deductionType || '').toLowerCase() === '2307' || Number(payment?.tax2307 || 0) > 0;
}

function is2307FormSubmitted(payment) {
    const formStatus = String(payment?.taxFormStatus || '').toLowerCase();
    const taxStatus = String(payment?.taxStatus || '').trim().toLowerCase();
    return formStatus === 'submitted' || taxStatus === '2' || taxStatus === 'submitted';
}

function is2307FormPending(payment) {
    return is2307DeductionPayment(payment) && !is2307FormSubmitted(payment);
}

function get2307FormStatusLabel(payment) {
    if (!is2307DeductionPayment(payment)) return '-';
    return is2307FormSubmitted(payment) ? 'Submitted' : 'Pending Form';
}

function get2307PendingPayments(payments = []) {
    return payments.filter(is2307FormPending);
}

function render2307PendingPanel(payments = []) {
    const pending = get2307PendingPayments(payments);
    if (!pending.length) {
        return '<div class="collection-followup-empty">No pending 2307 form for this invoice.</div>';
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Invoice No.</th>
                        <th>Payment Date</th>
                        <th>2307 Amount</th>
                        <th>Status</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${pending.map((payment) => `
                        <tr>
                            <td>${escapeHtml(payment.invoiceNo || payment.invoiceId || '-')}</td>
                            <td>${escapeHtml(formatDate(payment.datePaid || payment.paymentDate))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.tax2307 || getPaymentDeductionAmount(payment)))}</td>
                            <td><span class="collector-tax-status pending">Pending Form</span></td>
                            <td><button type="button" class="btn btn-secondary btn-sm" onclick="markCollector2307Submitted('${encodeURIComponent(payment.docId || payment.id || '')}')">Mark Submitted</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function buildSelectOptions(options, selectedValue = '') {
    return options.map((option) => {
        const selected = String(option).toLowerCase() === String(selectedValue || '').toLowerCase() ? ' selected' : '';
        return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
    }).join('');
}

function getDefaultConversationResult(lastHistory) {
    return lastHistory?.conversationResult || 'Successful Conversation';
}

function getDefaultPromiseToPay(lastHistory) {
    return lastHistory?.promiseToPay || 'No Promise to Pay';
}

function getDefaultIssueType(lastHistory) {
    return lastHistory?.issueType || 'No Issue';
}

function getDefaultFollowupTime(lastHistory) {
    return lastHistory?.nextFollowupTime || 'Morning';
}

async function markCollector2307Submitted(paymentDocId) {
    const docId = decodeURIComponent(String(paymentDocId || '')).trim();
    const statusNode = document.getElementById('collectorPaymentSaveStatus') || document.getElementById('collectorFollowupSaveStatus');
    if (!docId || isSavingCollector2307Status) return;

    isSavingCollector2307Status = true;
    if (statusNode) statusNode.textContent = 'Marking 2307 form as submitted...';

    try {
        const now = toTimestampString(new Date());
        await firestoreUpdateDocumentFields('tbl_paymentinfo', docId, {
            tax_status: toFirestoreWriteValue(2),
            tax_form_status: toFirestoreWriteValue('submitted'),
            tax_form_received_at: toFirestoreWriteValue(now),
            tax_form_updated_at: toFirestoreWriteValue(now)
        });

        paymentEntries = paymentEntries.map((entry) => {
            if (String(entry.docId || entry.id || '') !== docId) return entry;
            return {
                ...entry,
                taxStatus: '2',
                taxFormStatus: 'submitted',
                taxFormReceivedAt: normalizeDate(now)
            };
        });

        if (currentCollectorWorkspace?.cell) {
            const refreshed = await buildCollectorFollowupWorkspace(currentCollectorWorkspace.cell);
            currentCollectorWorkspace = {
                ...refreshed,
                cellId: refreshed.cell.id
            };
            const content = document.getElementById('collectorCellContent');
            if (content) content.innerHTML = renderCollectorFollowupWorkspace(refreshed);
            bindCollectorPaymentForm();
            setCollectorWorkspaceTab('payment');
        }

        const refreshedStatusNode = document.getElementById('collectorPaymentSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = '2307 form marked submitted.';
    } catch (error) {
        console.error('Failed to update 2307 form status:', error);
        if (statusNode) statusNode.textContent = '2307 form status update failed.';
    } finally {
        isSavingCollector2307Status = false;
    }
}

function getPaymentSummaryForInvoiceKeys(paymentMap, ...keys) {
    for (const key of keys) {
        const safeKey = String(key || '').trim();
        if (safeKey && paymentMap.has(safeKey)) return paymentMap.get(safeKey);
    }
    return {
        amount: 0,
        isSettled: false,
        latestBalanceAmount: null,
        firstPaymentDate: null,
        lastPaymentDate: null,
        months: new Map()
    };
}

function renderPaymentHistoryRows(payments) {
    if (!payments.length) return '<div class="collection-followup-empty">No saved payment record for this invoice yet.</div>';

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table">
                <thead>
                    <tr>
                        <th>Paid Date</th>
                        <th>Date Dpst</th>
                        <th>OR No.</th>
                        <th>Received</th>
                        <th>Pymnt Ty</th>
                        <th>Status</th>
                        <th>Deduction</th>
                        <th>2307 Form</th>
                        <th>Balance</th>
                        <th>Check #</th>
                        <th>Check Amount</th>
                        <th>Account Bank</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.slice(0, 12).map((payment) => `
                        <tr>
                            <td>${escapeHtml(formatDate(payment.datePaid || payment.paymentDate))}</td>
                            <td>${escapeHtml(formatDate(payment.dateDeposit || payment.paymentDate))}</td>
                            <td>${escapeHtml(payment.orNumber || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.amount || 0))}</td>
                            <td>${escapeHtml(formatPaymentTypeLabel(payment.paymentType))}</td>
                            <td>${escapeHtml(payment.paymentStatus || (Number(payment.balanceAmount || 0) <= 0.01 ? 'Paid' : 'Partial'))}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(getPaymentDeductionAmount(payment)))}</td>
                            <td>${is2307DeductionPayment(payment) ? `<span class="collector-tax-status ${is2307FormSubmitted(payment) ? 'submitted' : 'pending'}">${escapeHtml(get2307FormStatusLabel(payment))}</span>` : '-'}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.balanceAmount || 0))}</td>
                            <td>${escapeHtml(payment.checkNumber || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(payment.checkAmount || 0))}</td>
                            <td>${escapeHtml(payment.accountBank || '-')}</td>
                            <td>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="editCollectorPaymentRecord('${encodeURIComponent(payment.docId || payment.id || '')}')">Edit</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="cancelCollectorPaymentRecord('${encodeURIComponent(payment.docId || payment.id || '')}')">Cancel</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function formatPaymentTypeLabel(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === '1' || raw.includes('check')) return 'CHECK';
    if (raw === '0' || raw.includes('cash')) return 'CASH';
    return raw ? raw.toUpperCase() : '-';
}

function renderCollectorPaymentTab(workspace, paymentRecords, paymentTotal, taxTotal, paymentBalance) {
    const { selectedInvoice, branchBalance, cell } = workspace;
    const invoiceNo = String(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    const invoiceId = String(selectedInvoice?.invoiceId || selectedInvoice?.invoiceNo || '').trim();
    const invoiceAmount = Number(selectedInvoice?.amount || cell?.displayBilledTotal || cell?.billedTotal || branchBalance || 0);
    const currentBalance = Math.max(0, Number(paymentBalance || 0));
    const clientName = selectedInvoice?.accountLabel || buildAccountLabel(selectedInvoice?.company, selectedInvoice?.branch) || selectedInvoice?.company || '';
    const category = selectedInvoice?.category || '';
    const invoiceDateValue = toDateKey(selectedInvoice?.invoiceDate || selectedInvoice?.dueDate) || '';
    const printedOrRef = selectedInvoice?.receivedBy || selectedInvoice?.printedOr || '';

    return `
        <section class="collection-payment-tab-panel" id="collectorPaymentPanel" role="tabpanel" aria-labelledby="collectorPaymentTab" hidden>
            <div class="collection-payment-layout">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Payment Details</div>
                    <div class="collection-payment-summary" id="collectorPaymentSummary" data-invoice-amount="${escapeHtml(currentBalance)}">
                        <div><span>Invoice Amount</span><strong id="collectorPaymentInvoiceAmount">${escapeHtml(formatCurrency(invoiceAmount))}</strong></div>
                        <div><span>Actual Received</span><strong id="collectorPaymentActual">${escapeHtml(formatCurrency(0))}</strong></div>
                        <div><span>Deducted</span><strong id="collectorPaymentTaxDisplay">${escapeHtml(formatCurrency(0))}</strong></div>
                        <div><span>Balance</span><strong id="collectorPaymentBalanceDisplay">${escapeHtml(formatCurrency(currentBalance))}</strong></div>
                    </div>
                    <div class="collection-followup-form collection-payment-form">
                        <div>
                            <label>Payment ID</label>
                            <input id="collectorPaymentLegacyId" type="text" value="Auto on save" readonly>
                            <input id="collectorPaymentDocId" type="hidden" value="">
                        </div>
                        <div>
                            <label>Client</label>
                            <input id="collectorPaymentClient" type="text" value="${escapeHtml(clientName)}">
                        </div>
                        <div>
                            <label>CTGRY</label>
                            <input id="collectorPaymentCategory" type="text" value="${escapeHtml(category)}">
                        </div>
                        <div>
                            <label>Amount Paid</label>
                            <input id="collectorPaymentPaidAmount" type="number" step="0.01" min="0" value="">
                        </div>
                        <div>
                            <label>Invoice Number</label>
                            <input id="collectorPaymentInvoiceNo" type="text" value="${escapeHtml(invoiceNo)}">
                            <input id="collectorPaymentInvoiceId" type="hidden" value="${escapeHtml(invoiceId)}">
                        </div>
                        <div>
                            <label>Invoice Date</label>
                            <input id="collectorPaymentInvoiceDate" type="date" value="${escapeHtml(invoiceDateValue)}">
                        </div>
                        <div>
                            <label>OR Number</label>
                            <input id="collectorPaymentOrNumber" type="text" value="">
                        </div>
                        <div>
                            <label>Printed / OR Ref.</label>
                            <input id="collectorPaymentPrintedOr" type="text" value="${escapeHtml(printedOrRef)}">
                        </div>
                        <div>
                            <label>Assigned</label>
                            <input id="collectorPaymentAssigned" type="text" value="">
                        </div>
                        <div>
                            <label>Date of Payment</label>
                            <input id="collectorPaymentDate" type="date" value="${escapeHtml(getTodayInputValue(0))}">
                        </div>
                        <div>
                            <label>Date Deposited</label>
                            <input id="collectorPaymentDepositDate" type="date" value="${escapeHtml(getTodayInputValue(0))}">
                        </div>
                        <label class="collection-check-row"><input id="collectorPaymentCash" type="checkbox" checked onchange="syncCollectorPaymentMethod('cash')"> Cash</label>
                        <label class="collection-check-row"><input id="collectorPaymentCheck" type="checkbox" onchange="syncCollectorPaymentMethod('check')"> Check</label>
                        <div>
                            <label>Check Number</label>
                            <input id="collectorPaymentCheckNumber" type="text" value="" disabled>
                        </div>
                        <div>
                            <label>Check Bank</label>
                            <input id="collectorPaymentCheckBank" type="text" value="" disabled>
                        </div>
                        <div>
                            <label>Date of Check</label>
                            <input id="collectorPaymentCheckDate" type="date" value="" disabled>
                        </div>
                        <div>
                            <label>Check Amount</label>
                            <input id="collectorPaymentCheckAmount" type="number" step="0.01" min="0" value="" disabled>
                        </div>
                        <div>
                            <label>Account Bank</label>
                            <input id="collectorPaymentAccountBank" type="text" value="" disabled>
                        </div>
                        <div>
                            <label>Payment Status</label>
                            <input id="collectorPaymentStatus" type="text" value="Paid">
                        </div>
                        <div>
                            <label>Deduction Type</label>
                            <select id="collectorPaymentDeductionType">
                                <option value="">None</option>
                                <option value="2307">2307 withholding tax</option>
                                <option value="other">Other deduction</option>
                            </select>
                        </div>
                        <div>
                            <label>Deducted / EWT Amount</label>
                            <input id="collectorPaymentDeductionAmount" type="number" step="0.01" min="0" value="">
                        </div>
                        <div>
                            <label>Balance</label>
                            <input id="collectorPaymentBalance" type="number" step="0.01" readonly value="${escapeHtml(currentBalance.toFixed(2))}">
                        </div>
                        <label class="collection-check-row full collector-2307-form-row" id="collector2307PendingRow">
                            <input id="collectorPayment2307Pending" type="checkbox" checked>
                            Pending 2307 Form
                        </label>
                        <div class="full">
                            <label>Remarks</label>
                            <textarea id="collectorPaymentRemarks" placeholder="Optional payment notes."></textarea>
                        </div>
                    </div>
                    <div class="detail-form-actions">
                        <button class="btn btn-primary" onclick="saveCollectorPayment()">Save Payment</button>
                        <button class="btn btn-secondary" id="collectorPaymentNewButton" onclick="resetCollectorPaymentForm()" type="button" hidden>New Payment</button>
                        <span class="detail-save-status" id="collectorPaymentSaveStatus">Ready.</span>
                    </div>
                </div>

                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Saved Payment Records</div>
                    <div class="collection-payment-rollup">
                        <div><span>Collected</span><strong>${escapeHtml(formatCurrency(paymentTotal))}</strong></div>
                        <div><span>2307</span><strong>${escapeHtml(formatCurrency(taxTotal))}</strong></div>
                        <div><span>Remaining</span><strong>${escapeHtml(formatCurrency(paymentBalance))}</strong></div>
                    </div>
                    <div class="collection-followup-panel-title collector-subsection-title">Pending 2307 Forms</div>
                    ${render2307PendingPanel(paymentRecords)}
                    ${renderPaymentHistoryRows(paymentRecords)}
                </div>
            </div>
        </section>
    `;
}

function renderCollectorFollowupWorkspace(workspace) {
    const {
        cell,
        context,
        profile,
        override,
        selectedInvoice,
        branchInvoices,
        companyInvoices,
        invoiceHistory,
        lastHistory,
        serviceHistory,
        activeSchedule,
        branchBalance,
        companyBalance,
        selectedContact,
        selectedContactNumber,
        address
    } = workspace;

    const contacts = getCollectionContactRows(profile, override);
    const defaultFollowup = toDateKey(lastHistory?.followupDate) || getTodayInputValue(1);
    const statusId = Number(lastHistory?.statusId || 1);
    const locationId = Number(lastHistory?.locationId || 1);
    const fromTime = normalizeTimeInput(getProfileField(profile, override, 'collection_time_from', ['time_from'], ''));
    const toTime = normalizeTimeInput(getProfileField(profile, override, 'collection_time_to', ['time_to'], ''));
    const followupTime = normalizeTimeInput(getProfileField(profile, override, 'followup_time', ['followup_time'], ''));
    const contactNo = selectedContactNumber || '';
    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || selectedInvoice?.amount || 0);
    const pendingAmount = Math.max(0, Number(branchBalance || billedTarget || 0));
    const scheduleStatusValue = String(activeSchedule?.schedule_status || 'Confirmed').trim();
    const scheduleDateValue = toDateKey(activeSchedule?.schedule_date || activeSchedule?.followup_date) || defaultFollowup;
    const scheduleTimeValue = normalizeTimeInput(activeSchedule?.schedule_time || activeSchedule?.collection_time || fromTime || followupTime || '');
    const scheduleIsActive = activeSchedule && String(activeSchedule.status || 'Active').toLowerCase() !== 'cancelled';
    const returnCallValue = activeSchedule?.return_call === true || String(activeSchedule?.return_call || '').toLowerCase() === 'true';
    const scheduleAssigneeId = normalizeLookupId(activeSchedule?.assigned_to_id || activeSchedule?.tech_id || '');
    const paymentRecords = getPaymentsForSelectedInvoice(selectedInvoice);
    const paymentTotal = paymentRecords.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const taxTotal = paymentRecords.reduce((sum, payment) => sum + Number(payment.tax2307 || 0), 0);
    const selectedOutstanding = getOutstandingInvoiceAmount(selectedInvoice);
    const cellOutstanding = getCellOutstandingBalance(cell);
    const paymentBalance = paymentRecords.length
        ? selectedOutstanding
        : Math.max(0, Number(selectedInvoice?.amount || billedTarget || 0) - paymentTotal - taxTotal);
    const displayBalance = paymentRecords.length
        ? paymentBalance
        : (Number(branchBalance || 0) > 0 ? Number(branchBalance || 0) : cellOutstanding);
    const workspaceInvoiceList = getCollectorSoaCandidateInvoices(workspace);
    const workspaceInvoiceListBalance = workspaceInvoiceList.reduce((sum, invoice) => sum + getOutstandingInvoiceAmount(invoice), 0);
    const displayAccountBalance = workspaceInvoiceListBalance > 0 ? workspaceInvoiceListBalance : displayBalance;
    const conversationResultValue = getDefaultConversationResult(lastHistory);
    const promiseToPayValue = getDefaultPromiseToPay(lastHistory);
    const promiseAmountValue = Number(lastHistory?.promiseToPayAmount || lastHistory?.paymentAmount || 0);
    const promiseDateValue = toDateKey(lastHistory?.promiseToPayDate) || '';
    const nextFollowupDateValue = toDateKey(lastHistory?.followupDate) || defaultFollowup;
    const nextFollowupTimeValue = getDefaultFollowupTime(lastHistory);
    const issueTypeValue = getDefaultIssueType(lastHistory);
    const issueNotesValue = lastHistory?.issueNotes || '';
    const assignedOwner = getCustomerAssignmentOwner(context);
    const assignedRole = getCurrentCollectionRoleAssignment();

    return `
        <div class="collection-followup-shell">
            <section class="collection-followup-hero">
                <div>
                    <div class="collection-followup-kicker">Invoice No. ${escapeHtml(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || 'No invoice linked')}</div>
                    <h3>${escapeHtml(context.customer)}</h3>
                    <p>Status: Active • Model: ${escapeHtml(context.modelName || selectedInvoice?.modelName || '-')} • Serial: ${escapeHtml(displaySerialNumber(context.serialNumber || selectedInvoice?.serialNumber))}</p>
                </div>
                <div class="collection-balance-card">
                    <span>List Balance</span>
                    <strong>${escapeHtml(formatCurrency(displayAccountBalance))}</strong>
                    <em>Company open: ${escapeHtml(formatCurrency(companyBalance))}</em>
                </div>
            </section>

            ${renderCollectorWorkspaceInvoiceList(workspace, selectedInvoice)}

            <div class="collection-workspace-tabs" role="tablist" aria-label="Collection workspace sections">
                <button type="button" class="collection-workspace-tab active" id="collectorFollowupTab" role="tab" aria-selected="true" aria-controls="collectorFollowupPanel" onclick="setCollectorWorkspaceTab('followup')">Follow-up</button>
                <button type="button" class="collection-workspace-tab" id="collectorPaymentTab" role="tab" aria-selected="false" aria-controls="collectorPaymentPanel" onclick="setCollectorWorkspaceTab('payment')">Payment</button>
            </div>

            <section class="collection-followup-tab-panel" id="collectorFollowupPanel" role="tabpanel" aria-labelledby="collectorFollowupTab">
            <div class="collection-soa-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="openCollectorSoaPeriodModal()">Print SOA</button>
            </div>
            <section class="collection-followup-grid">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Contacts</div>
                    ${contacts.length ? `
                        <table class="collection-contact-table">
                            <thead><tr><th>Location</th><th>Contact</th><th>Contact No.</th><th></th></tr></thead>
                            <tbody>
                                ${contacts.map((row) => `
                                    <tr data-contact-person="${escapeHtml(row.name)}" data-contact-number="${escapeHtml(row.number)}">
                                        <td>${escapeHtml(row.location)}</td>
                                        <td>${escapeHtml(row.name || '-')}</td>
                                        <td>${escapeHtml(row.number || '-')}</td>
                                        <td><button class="btn btn-secondary btn-sm" onclick="useCollectorContact(this)">Use</button></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="collection-followup-empty">No contact profile found in collection info.</div>'}

                    <div class="collection-followup-mini-form">
                        <div class="collection-customer-assignment-row">
                            <label>Customer Assignment Owner</label>
                            <input id="collectorCustomerOwner" type="text" value="${escapeHtml(assignedOwner || getCurrentCollectorName())}" placeholder="Collector responsible for this customer">
                            <select id="collectorCustomerOwnerRole">
                                <option value="">Open lane</option>
                                ${COLLECTION_ASSIGNMENT_ROLES.map((role) => `<option value="${escapeHtml(role.key)}"${role.key === assignedRole ? ' selected' : ''}>${escapeHtml(role.label)}</option>`).join('')}
                            </select>
                            <button class="btn btn-secondary btn-sm" onclick="saveCurrentCustomerAssignment()">Save Customer Assignment</button>
                            <span class="detail-save-status" id="collectorCustomerAssignmentStatus">Coordination only. Anyone can still open this account.</span>
                        </div>
                        <label>Collection Add.</label>
                        <textarea id="collectorProfileAddress">${escapeHtml(address || '')}</textarea>
                        <div class="collection-followup-two">
                            <div>
                                <label>Contact</label>
                                <input id="collectorProfileContactPerson" type="text" value="${escapeHtml(selectedContact || '')}">
                            </div>
                            <div>
                                <label>Contact #</label>
                                <input id="collectorProfileContactNumber" type="text" value="${escapeHtml(contactNo)}">
                            </div>
                        </div>
                        <div class="collection-followup-two">
                            <div>
                                <label>F/Up Days</label>
                                <input id="collectorProfileFollowupDays" type="text" value="${escapeHtml(getProfileField(profile, override, 'followup_days', ['followup_days'], ''))}">
                            </div>
                            <div>
                                <label>F/Up Time</label>
                                <input id="collectorProfileFollowupTime" type="time" value="${escapeHtml(followupTime)}">
                            </div>
                        </div>
                        <div class="collection-followup-two">
                            <div>
                                <label>Coll From</label>
                                <input id="collectorProfileTimeFrom" type="time" value="${escapeHtml(fromTime)}">
                            </div>
                            <div>
                                <label>Coll To</label>
                                <input id="collectorProfileTimeTo" type="time" value="${escapeHtml(toTime)}">
                            </div>
                        </div>
                        <label>Last Cntct</label>
                        <input id="collectorProfileLastContact" type="text" value="${escapeHtml(lastHistory?.remarks || getProfileField(profile, override, 'last_contact', ['last_contact'], lastHistory?.contactPerson || ''))}">
                        <button class="btn btn-secondary btn-sm" onclick="saveCollectorProfileOverride()">Save Address / Policy Override</button>
                        <span class="detail-save-status" id="collectorProfileSaveStatus">${override ? 'Web override active.' : 'Legacy profile loaded.'}</span>
                    </div>
                </div>

                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Invoice State</div>
	                    <div class="collection-followup-facts">
	                        <div><span>Balance</span><strong>${escapeHtml(formatCurrency(displayBalance))}</strong></div>
	                        <div><span>Date Received</span><strong>${escapeHtml(formatDate(selectedInvoice?.dateReceived || selectedInvoice?.invoiceDate))}</strong></div>
	                        <div><span>Received By</span><strong>${escapeHtml(selectedInvoice?.receivedBy || '-')}</strong></div>
	                        <div><span>Invoice Month</span><strong>${escapeHtml(selectedInvoice?.monthYear || context.label || '-')}</strong></div>
	                        <div><span>Collector Lane</span><strong>${escapeHtml(getCollectionRoleLabel(assignedRole) || '-')}</strong></div>
	                        <div><span>Customer Owner</span><strong>${escapeHtml(assignedOwner || 'Open')}</strong></div>
	                    </div>
                    <div class="collection-followup-panel-title">Conversation History</div>
                    ${renderHistoryRows(invoiceHistory)}
	                    <div class="collection-followup-form">
	                        <div>
	                            <label>Conversation Result</label>
	                            <select id="collectorConversationResult" required>
	                                ${buildSelectOptions(CONVERSATION_RESULT_OPTIONS, conversationResultValue)}
	                            </select>
	                        </div>
	                        <div>
	                            <label>Promise To Pay</label>
	                            <select id="collectorPromiseToPay" required>
	                                ${buildSelectOptions(PROMISE_TO_PAY_OPTIONS, promiseToPayValue)}
	                            </select>
	                        </div>
	                        <div>
	                            <label>Promise Amount</label>
	                            <input id="collectorPromiseAmount" type="number" min="0" step="0.01" value="${escapeHtml(promiseAmountValue.toFixed(2))}">
	                        </div>
	                        <div>
	                            <label>Promise Date</label>
	                            <input id="collectorPromiseDate" type="date" value="${escapeHtml(promiseDateValue)}">
	                        </div>
	                        <div>
	                            <label>Next Follow-up Date</label>
	                            <input id="collectorFollowupDate" type="date" value="${escapeHtml(nextFollowupDateValue)}" required>
	                        </div>
	                        <div>
	                            <label>Next Follow-up Time</label>
	                            <select id="collectorNextFollowupTime" required>
	                                ${buildSelectOptions(NEXT_FOLLOWUP_TIME_OPTIONS, nextFollowupTimeValue)}
	                            </select>
	                        </div>
	                        <div>
	                            <label>Issue Type</label>
	                            <select id="collectorIssueType" required>
	                                ${buildSelectOptions(ISSUE_TYPE_OPTIONS, issueTypeValue)}
	                            </select>
	                        </div>
	                        <div>
	                            <label>Issue Notes</label>
	                            <input id="collectorIssueNotes" type="text" list="collectorIssueNoteSuggestions" value="${escapeHtml(issueNotesValue)}" placeholder="Optional explanation">
	                            <datalist id="collectorIssueNoteSuggestions">
	                                ${ISSUE_NOTE_SUGGESTIONS.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}
	                            </datalist>
	                        </div>
	                        <div>
	                            <label>Received By</label>
	                            <input id="collectorReceivedBy" type="text" value="${escapeHtml(selectedInvoice?.receivedBy || '')}">
                        </div>
                        <div>
                            <label>Contact No.</label>
                            <input id="collectorContactNumber" type="text" value="${escapeHtml(contactNo)}">
                        </div>
                        <div>
                            <label>Status</label>
                            <select id="collectorStatusId">
                                ${collectionStatusOptions.map((status) => `<option value="${escapeHtml(status.id)}"${Number(status.id) === statusId ? ' selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Inv. Location</label>
                            <select id="collectorLocationId">
                                ${COLLECTION_LOCATION_OPTIONS.map((option) => `<option value="${escapeHtml(option.id)}"${Number(option.id) === locationId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                            </select>
                        </div>
	                        <div>
	                            <label>Coll Time</label>
	                            <input id="collectorCollectionTime" type="time" value="${escapeHtml(fromTime || followupTime || '')}">
	                        </div>
	                        <div class="full">
                            <label>Remarks</label>
                            <textarea id="collectorRemarks" placeholder="Write where the invoice is now, who was contacted, and the next action."></textarea>
                        </div>
                        <label class="collection-check-row"><input id="collectorCheckSigned" type="checkbox"${lastHistory?.isCheckSigned ? ' checked' : ''}> Check Signed</label>
                        <div>
                            <label>Check No.</label>
                            <input id="collectorCheckNumber" type="text" value="${escapeHtml(lastHistory?.checkNumber || '')}">
                        </div>
                        <div>
                            <label>Amount</label>
                            <input id="collectorPaymentAmount" type="number" step="0.01" value="${lastHistory?.paymentAmount ? escapeHtml(lastHistory.paymentAmount) : ''}">
                        </div>
                        <div>
                            <label>Last Cntct</label>
                            <input id="collectorLastContact" type="text" value="${escapeHtml(lastHistory?.contactPerson || selectedContact || '')}">
                        </div>
                    </div>
                    <div class="detail-form-actions">
                        <button class="btn btn-primary" onclick="saveCollectorFollowup()">Save Follow-up</button>
                        <span class="detail-save-status" id="collectorFollowupSaveStatus">Ready.</span>
                    </div>
                </div>
            </section>

            <section class="collection-followup-panel collection-followup-schedule-panel">
                <div class="collection-followup-panel-title">Set Schedule</div>
                <div class="collection-schedule-form">
                    <label class="collection-check-row collection-schedule-return">
                        <input id="collectorScheduleReturnCall" type="checkbox"${returnCallValue ? ' checked' : ''}>
                        Return Call
                    </label>
                    <div class="collection-schedule-radio">
                        <label><input type="radio" name="collectorScheduleReturnChoice" value="yes"${returnCallValue ? ' checked' : ''}> Yes</label>
                        <label><input type="radio" name="collectorScheduleReturnChoice" value="no"${returnCallValue ? '' : ' checked'}> No</label>
                    </div>
                    <div>
                        <label>Schedule Date</label>
                        <input id="collectorScheduleDate" type="date" value="${escapeHtml(scheduleDateValue || '')}">
                    </div>
                    <div>
                        <label>Time</label>
                        <input id="collectorScheduleTime" type="time" value="${escapeHtml(scheduleTimeValue || '')}">
                    </div>
                    <div>
                        <label>Schedule Type</label>
                        <select id="collectorScheduleStatus">
                            ${COLLECTION_SCHEDULE_OPTIONS.map((option) => `<option value="${escapeHtml(option)}"${option.toLowerCase() === scheduleStatusValue.toLowerCase() ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label>Assigned Messenger / Tech</label>
                        <select id="collectorScheduleAssignee">
                            ${buildCollectionAssignableStaffOptions(scheduleAssigneeId)}
                        </select>
                    </div>
                    <div class="collection-schedule-actions">
                        <button class="btn btn-primary btn-sm" onclick="saveCollectorSchedule()">Save</button>
                        <button class="btn btn-secondary btn-sm" onclick="cancelCollectorSchedule()"${scheduleIsActive ? '' : ' disabled'}>Cancel Trial Schedule</button>
                    </div>
                </div>
                <div class="detail-save-status collection-schedule-status" id="collectorScheduleSaveStatus">
                    ${scheduleIsActive
                        ? `Active schedule: ${escapeHtml(scheduleStatusValue)}${scheduleDateValue ? ` on ${escapeHtml(formatDate(scheduleDateValue))}` : ''}.`
                        : (activeSchedule ? 'Schedule is cancelled.' : 'No active schedule yet.')}
                </div>
            </section>

            <section class="collection-followup-bottom">
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Branch Invoices</div>
                    ${renderMiniInvoiceRows(branchInvoices, 'No unpaid branch invoices found in the current Collections data.')}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Company Invoices</div>
                    ${renderMiniInvoiceRows(companyInvoices, 'No unpaid company invoices found in the current Collections data.')}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Pending 2307 Forms</div>
                    ${render2307PendingPanel(paymentRecords)}
                </div>
                <div class="collection-followup-panel">
                    <div class="collection-followup-panel-title">Service / Delivery History</div>
                    ${renderServiceRows(serviceHistory)}
                </div>
            </section>
            </section>

            ${renderCollectorPaymentTab(workspace, paymentRecords, paymentTotal, taxTotal, paymentBalance)}
        </div>
    `;
}

async function openCollectorCell(cellId) {
    const cell = collectorCellMap.get(decodeCollectorCellToken(cellId));
    if (!cell) return;
    if (!lastLoadSucceeded && !canUseCollectorMatrixSnapshot()) {
        window.alert('No saved matrix summary yet. The backend rebuild job must create the month comparison table.');
        return;
    }
    captureCollectorReturnBookmark(cell.id || cellId);

    const modal = document.getElementById('collectorCellModal');
    const title = document.getElementById('collectorCellTitle');
    const subtitle = document.getElementById('collectorCellSubtitle');
    const content = document.getElementById('collectorCellContent');
    if (!modal || !title || !subtitle || !content) return;

    const billedTarget = Number(cell.displayBilledTotal || cell.billedTotal || 0);
    const pendingAmount = getCellOutstandingBalance(cell);
    title.textContent = `${cell.customer} • ${cell.branchName || cell.accountLabel || 'Main'} • ${cell.label}`;
    subtitle.textContent = `Loading collection profile, unpaid invoices, history, and service records for this follow-up.`;
    content.innerHTML = `
        <div class="cell-modal-summary">
            <div class="cell-modal-card">
                <div class="label">RD</div>
                <div class="value">${escapeHtml(String(cell.rdValues.filter(Boolean).sort((a, b) => a - b)[0] || '-'))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Billed</div>
                <div class="value">${escapeHtml(formatCurrency(billedTarget))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Collected</div>
                <div class="value">${escapeHtml(formatCurrency(cell.collectedTotal))}</div>
            </div>
            <div class="cell-modal-card">
                <div class="label">Pending</div>
                <div class="value">${escapeHtml(formatCurrency(pendingAmount))}</div>
            </div>
        </div>
        <div class="collector-cell-status-row">
            ${cell.missedReading ? '<span class="collector-chip pending">Missed Reading</span>' : ''}
            ${cell.catchUpBilling ? `<span class="collector-chip viewport">Catch-up Billing${cell.catchUpGapMonths > 1 ? ` (${escapeHtml(String(cell.catchUpGapMonths))} months)` : ''}</span>` : ''}
            ${cell.pendingBilling && !cell.missedReading ? '<span class="collector-chip pending">Pending Billing</span>' : ''}
            <span class="collector-chip">Preparing follow-up workspace...</span>
        </div>
    `;

    modal.classList.remove('hidden');

    currentCollectorWorkspace = {
        cell,
        context: resolveCollectorCellContext(cell),
        cellId: cell.id
    };

    try {
        if (!lastLoadSucceeded && canUseCollectorMatrixSnapshot()) {
            await ensureCollectorCellDetailData(cell);
            const workspace = await buildCollectorFollowupWorkspace(cell, { forceFull: true });
            if (currentCollectorWorkspace?.cellId !== cell.id) return;
            currentCollectorWorkspace = {
                ...workspace,
                cellId: cell.id
            };
            const selectedInvoice = workspace.selectedInvoice;
            title.textContent = `${workspace.context.customer} • ${workspace.context.branchName || 'Main'} • ${workspace.context.label}`;
            subtitle.textContent = selectedInvoice
                ? `Invoice #${selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '-'} follow-up`
                : `Follow-up workspace`;
            content.innerHTML = renderCollectorFollowupWorkspace(workspace);
            bindCollectorPaymentForm();
            return;
        }

        const workspace = await buildCollectorFollowupWorkspace(cell, { forceFull: true });
        if (currentCollectorWorkspace?.cellId !== cell.id) return;
        currentCollectorWorkspace = {
            ...workspace,
            cellId: cell.id
        };

        const selectedInvoice = workspace.selectedInvoice;
        title.textContent = `${workspace.context.customer} • ${workspace.context.branchName || 'Main'} • ${workspace.context.label}`;
        subtitle.textContent = selectedInvoice
            ? `Invoice #${selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '-'} follow-up`
            : `Follow-up workspace`;
        content.innerHTML = renderCollectorFollowupWorkspace(workspace);
        if (!workspace.snapshot) bindCollectorPaymentForm();
    } catch (error) {
        console.error('Failed to open collection follow-up workspace:', error);
        subtitle.textContent = 'Collection follow-up workspace could not load completely.';
        content.innerHTML += `
            <div class="detail-last-remark">
                <h4>Unable to load follow-up workspace</h4>
                <p>Please refresh Collections and try again. No history or profile data was changed.</p>
            </div>
        `;
    }
}

function openCollectorCellByToken(token) {
    void openCollectorCell(token);
}

async function openCollectorPriorityCell(token, tabName = 'followup') {
    await openCollectorCell(decodeURIComponent(String(token || '')));
    if (tabName === 'payment') {
        setTimeout(() => setCollectorWorkspaceTab('payment'), 250);
    }
}

window.openCollectorCellFullWorkspace = openCollectorCellFullWorkspace;
window.openCollectorCell = openCollectorCell;
window.openCollectorCellByToken = openCollectorCellByToken;
window.openCollectorPriorityCell = openCollectorPriorityCell;
window.setPriorityWorklistView = setPriorityWorklistView;
window.saveDashboardCollectionAssignment = saveDashboardCollectionAssignment;

function closeCollectorCellModal() {
    document.getElementById('collectorCellModal')?.classList.add('hidden');
    restoreCollectorReturnBookmark({ clear: true });
}

function openCollectorInvoiceFromCell(invoiceKey) {
    closeCollectorCellModal();
    viewInvoiceDetail(decodeURIComponent(String(invoiceKey || '')));
}

function setCollectorWorkspaceTab(tabName) {
    const activeTab = tabName === 'payment' ? 'payment' : 'followup';
    const followupPanel = document.getElementById('collectorFollowupPanel');
    const paymentPanel = document.getElementById('collectorPaymentPanel');
    const followupTab = document.getElementById('collectorFollowupTab');
    const paymentTab = document.getElementById('collectorPaymentTab');

    if (followupPanel) followupPanel.hidden = activeTab !== 'followup';
    if (paymentPanel) paymentPanel.hidden = activeTab !== 'payment';

    if (followupTab) {
        followupTab.classList.toggle('active', activeTab === 'followup');
        followupTab.setAttribute('aria-selected', activeTab === 'followup' ? 'true' : 'false');
    }
    if (paymentTab) {
        paymentTab.classList.toggle('active', activeTab === 'payment');
        paymentTab.setAttribute('aria-selected', activeTab === 'payment' ? 'true' : 'false');
    }

    if (activeTab === 'payment') updateCollectorPaymentBalance();
}

function updateCollectorPaymentBalance() {
    const summary = document.getElementById('collectorPaymentSummary');
    if (!summary) return;

    const invoiceAmount = parseMoneyInput(summary.dataset.invoiceAmount || '0');
    const paidAmount = parseMoneyInput(document.getElementById('collectorPaymentPaidAmount')?.value || '0');
    const deductionType = String(document.getElementById('collectorPaymentDeductionType')?.value || '').trim();
    const deductionAmount = deductionType ? parseMoneyInput(document.getElementById('collectorPaymentDeductionAmount')?.value || '0') : 0;
    const pending2307Row = document.getElementById('collector2307PendingRow');
    const pending2307Input = document.getElementById('collectorPayment2307Pending');
    const balance = Math.max(0, invoiceAmount - paidAmount - deductionAmount);
    const balanceInput = document.getElementById('collectorPaymentBalance');
    const actualNode = document.getElementById('collectorPaymentActual');
    const taxNode = document.getElementById('collectorPaymentTaxDisplay');
    const balanceNode = document.getElementById('collectorPaymentBalanceDisplay');

    if (pending2307Row) pending2307Row.hidden = false;
    if (pending2307Input && !pending2307Input.dataset.touched) {
        pending2307Input.checked = true;
    }
    if (balanceInput) balanceInput.value = balance.toFixed(2);
    if (actualNode) actualNode.textContent = formatCurrency(paidAmount);
    if (taxNode) taxNode.textContent = formatCurrency(deductionAmount);
    if (balanceNode) balanceNode.textContent = formatCurrency(balance);
}

function bindCollectorPaymentForm() {
    ['collectorPaymentPaidAmount', 'collectorPaymentDeductionAmount', 'collectorPaymentDeductionType'].forEach((id) => {
        const input = document.getElementById(id);
        input?.addEventListener('input', updateCollectorPaymentBalance);
        input?.addEventListener('change', updateCollectorPaymentBalance);
    });
    document.getElementById('collectorPaymentPaidAmount')?.addEventListener('input', () => {
        const checkAmount = document.getElementById('collectorPaymentCheckAmount');
        if (document.getElementById('collectorPaymentCheck')?.checked && checkAmount && !String(checkAmount.value || '').trim()) {
            checkAmount.value = document.getElementById('collectorPaymentPaidAmount')?.value || '';
        }
    });
    document.getElementById('collectorPayment2307Pending')?.addEventListener('change', (event) => {
        event.currentTarget.dataset.touched = '1';
    });
    syncCollectorPaymentMethod(document.getElementById('collectorPaymentCheck')?.checked ? 'check' : 'cash');
    updateCollectorPaymentBalance();
}

function syncCollectorPaymentMethod(method) {
    const isCheck = method === 'check';
    const cashInput = document.getElementById('collectorPaymentCash');
    const checkInput = document.getElementById('collectorPaymentCheck');
    const checkNumber = document.getElementById('collectorPaymentCheckNumber');
    const checkBank = document.getElementById('collectorPaymentCheckBank');
    const checkDate = document.getElementById('collectorPaymentCheckDate');
    const checkAmount = document.getElementById('collectorPaymentCheckAmount');
    const accountBank = document.getElementById('collectorPaymentAccountBank');

    if (cashInput) cashInput.checked = !isCheck;
    if (checkInput) checkInput.checked = isCheck;
    [checkNumber, checkBank, checkDate, checkAmount, accountBank].forEach((input) => {
        if (input) input.disabled = !isCheck;
    });
    if (isCheck && checkAmount && !String(checkAmount.value || '').trim()) {
        checkAmount.value = document.getElementById('collectorPaymentPaidAmount')?.value || '';
    }
}

function findCollectorPaymentRecord(docId) {
    const safeDocId = decodeURIComponent(String(docId || '')).trim();
    if (!safeDocId) return null;
    return paymentEntries.find((payment) => String(payment.docId || payment.id || '') === safeDocId) || null;
}

function receivePaymentOutstandingForInvoice(invoice) {
    const paid = getPaymentsForInvoiceKeys(invoice)
        .reduce((sum, payment) => sum + Number(payment.amount || 0) + getPaymentDeductionAmount(payment), 0);
    return Math.max(0, Number(invoice?.amount || 0) - paid);
}

function findReceivePaymentInvoice(query) {
    const needle = normalizeText(query);
    if (!needle) return null;
    return collectorBillingRecords.find((record) => {
        const haystack = normalizeText([
            record.invoiceNo,
            record.invoiceId,
            record.company,
            record.branch,
            record.accountLabel
        ].filter(Boolean).join(' '));
        return haystack.includes(needle);
    }) || null;
}

function searchReceivePaymentInvoices(query) {
    const needle = normalizeText(query);
    if (!needle) return [];
    return collectorBillingRecords
        .filter((record) => {
            const outstanding = receivePaymentOutstandingForInvoice(record);
            if (outstanding <= 0.01) return false;
            const haystack = normalizeText([
                record.invoiceNo,
                record.invoiceId,
                record.company,
                record.branch,
                record.accountLabel
            ].filter(Boolean).join(' '));
            return haystack.includes(needle);
        })
        .slice(0, 12);
}

function setReceivePaymentStatus(message) {
    const node = document.getElementById('receivePaymentStatus');
    if (node) node.textContent = message || 'Ready.';
}

function clearReceivePaymentSelection({ keepDraft = false } = {}) {
    receivePaymentState.selectedInvoices = [];
    receivePaymentState.searchResults = [];
    receivePaymentState.matchedDraftIds = new Set();
    if (!keepDraft) {
        receivePaymentState.selectedDraft = null;
        receivePaymentState.selectedDraftGroup = [];
    }
    const search = document.getElementById('receivePaymentInvoiceSearch');
    const results = document.getElementById('receivePaymentSearchResults');
    if (search) search.value = '';
    if (results) {
        results.hidden = true;
        results.innerHTML = '';
    }
}

function getDraftMessengerName(payment) {
    return String(payment?.assigned || payment?.encodedBy || payment?.messenger || 'Unassigned messenger').trim() || 'Unassigned messenger';
}

function getDraftTurnoverAmount(payment) {
    return Number(payment?.amount || 0) + getPaymentDeductionAmount(payment);
}

function groupDraftPaymentsByMessenger() {
    const groups = new Map();
    draftPaymentEntries.forEach((payment) => {
        const key = getDraftMessengerName(payment);
        if (!groups.has(key)) {
            groups.set(key, {
                messenger: key,
                payments: [],
                amount: 0,
                deduction: 0,
                cash: 0,
                checks: 0
            });
        }
        const group = groups.get(key);
        const amount = Number(payment.amount || 0);
        const deduction = getPaymentDeductionAmount(payment);
        group.payments.push(payment);
        group.amount += amount;
        group.deduction += deduction;
        if (formatPaymentTypeLabel(payment.paymentType) === 'CHECK') group.checks += amount;
        else group.cash += amount;
    });
    return Array.from(groups.values()).sort((left, right) => right.amount + right.deduction - left.amount - left.deduction);
}

function renderReceivePaymentDrafts() {
    const list = document.getElementById('receivePaymentDraftList');
    if (!list) return;
    if (!draftPaymentEntries.length) {
        list.innerHTML = '<div class="empty-followup">No field draft payments waiting for confirmation.</div>';
        return;
    }
    list.innerHTML = groupDraftPaymentsByMessenger()
        .map((group) => `
            <div class="receive-payment-group">
                <div class="receive-payment-group-head">
                    <div>
                        <div class="receive-payment-messenger">${escapeHtml(group.messenger)}</div>
                        <div class="collector-sub">${group.payments.length} customer collection${group.payments.length === 1 ? '' : 's'} encoded · Cash ${escapeHtml(formatCurrency(group.cash))} · Checks ${escapeHtml(formatCurrency(group.checks))}</div>
                    </div>
                    <div class="receive-payment-group-total"><span>Turnover total</span>${escapeHtml(formatCurrency(group.amount + group.deduction))}</div>
                    <button type="button" class="btn btn-primary btn-sm" onclick="loadReceivePaymentDraftGroup('${encodeURIComponent(group.messenger)}')">Review Batch</button>
                </div>
                <table class="receive-payment-batch-table">
                    <thead>
                        <tr>
                            <th class="receive-payment-checkcell">OK</th>
                            <th>Date</th>
                            <th>Customer / Branch</th>
                            <th>Check No</th>
                            <th>Check Date</th>
                            <th>Inv No</th>
                            <th>OR No</th>
                            <th class="text-right">Amount</th>
                            <th class="text-right">2307</th>
                            <th class="text-right">Net Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${group.payments.map((payment) => {
                            const docId = String(payment.docId || payment.id || '');
                            const customerBranch = [payment.client, payment.category].filter(Boolean).join(' - ');
                            return `
                                <tr>
                                    <td class="receive-payment-checkcell"><input type="checkbox" ${receivePaymentState.matchedDraftIds.has(docId) ? 'checked' : ''} onchange="toggleReceivePaymentDraftMatch('${encodeURIComponent(docId)}', this.checked)"></td>
                                    <td>${escapeHtml(formatDate(payment.paymentDate))}</td>
                                    <td>${escapeHtml(customerBranch || payment.client || '')}</td>
                                    <td>${escapeHtml(payment.checkNumber || '-')}</td>
                                    <td>${escapeHtml(formatDate(payment.checkDate))}</td>
                                    <td>${escapeHtml(payment.invoiceNo || payment.invoiceId || '-')}</td>
                                    <td>${escapeHtml(payment.orNumber || payment.printedOr || '-')}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(getDraftTurnoverAmount(payment)))}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(getPaymentDeductionAmount(payment)))}</td>
                                    <td class="text-right">${escapeHtml(formatCurrency(payment.amount || 0))}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `).join('');
}

function renderReceivePaymentSearchResults() {
    const results = document.getElementById('receivePaymentSearchResults');
    if (!results) return;
    const rows = receivePaymentState.searchResults || [];
    if (!rows.length) {
        results.hidden = true;
        results.innerHTML = '';
        return;
    }
    results.hidden = false;
    results.innerHTML = rows.map((record, index) => `
        <button type="button" class="receive-payment-result" onclick="addReceivePaymentInvoice(${index})">
            <strong>${escapeHtml(record.invoiceNo || record.invoiceId || '-')}</strong>
            <span>${escapeHtml(record.company || '')}${record.branch ? ` / ${escapeHtml(record.branch)}` : ''}</span>
            <span>${escapeHtml(formatDate(record.invoiceDate))} · ${escapeHtml(formatCurrency(receivePaymentOutstandingForInvoice(record)))}</span>
        </button>
    `).join('');
}

function renderReceivePaymentInvoices() {
    const tbody = document.getElementById('receivePaymentInvoiceRows');
    const totalNode = document.getElementById('receivePaymentInvoiceTotal');
    if (!tbody || !totalNode) return;
    const invoices = receivePaymentState.selectedInvoices;
    if (!invoices.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="collection-followup-empty">No invoice selected yet.</td></tr>';
        totalNode.textContent = formatCurrency(0);
        return;
    }
    const total = invoices.reduce((sum, invoice) => sum + Number(invoice.receiveAmount || 0), 0);
    tbody.innerHTML = invoices.map((invoice, index) => `
        <tr>
            <td>${escapeHtml(formatDate(invoice.invoiceDate))}</td>
            <td>${escapeHtml(invoice.company || '')}<br><span class="collector-sub">${escapeHtml(invoice.branch || '')}</span></td>
            <td>${escapeHtml(invoice.invoiceNo || invoice.invoiceId || '-')}</td>
            <td class="text-right">${escapeHtml(formatCurrency(invoice.receiveAmount || 0))}</td>
            <td><button type="button" class="btn btn-secondary btn-sm" onclick="removeReceivePaymentInvoice(${index})">Remove</button></td>
        </tr>
    `).join('');
    totalNode.textContent = formatCurrency(total);
}

function toggleReceivePaymentDraftMatch(paymentDocId, checked) {
    const docId = decodeURIComponent(String(paymentDocId || '')).trim();
    if (!docId) return;
    if (checked) receivePaymentState.matchedDraftIds.add(docId);
    else receivePaymentState.matchedDraftIds.delete(docId);
    updateReceivePaymentBalanceStatus();
}

function updateReceivePaymentBalanceStatus() {
    const total = receivePaymentState.selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.receiveAmount || 0), 0);
    const amount = parseMoneyInput(document.getElementById('receivePaymentAmount')?.value || '0');
    const deduction = parseMoneyInput(document.getElementById('receivePaymentDeduction')?.value || '0');
    const delta = total - amount - deduction;
    const group = receivePaymentState.selectedDraftGroup || [];
    const allMatched = group.length && group.every((payment) => receivePaymentState.matchedDraftIds.has(String(payment.docId || payment.id || '')));
    if (!receivePaymentState.selectedInvoices.length) {
        setReceivePaymentStatus('Select invoice(s), or review a messenger turnover batch.');
    } else if (group.length && !allMatched) {
        setReceivePaymentStatus('Tick each draft row only after actual cash, check, or bank slip matches the encoded transaction.');
    } else if (Math.abs(delta) <= 0.01) {
        setReceivePaymentStatus('Ready to confirm. Invoice total matches amount received plus deduction.');
    } else {
        setReceivePaymentStatus(`Difference: ${formatCurrency(delta)}. Invoice total must match amount received plus deduction.`);
    }
}

function addReceivePaymentInvoice(indexOrRecord) {
    const record = typeof indexOrRecord === 'number'
        ? receivePaymentState.searchResults[indexOrRecord]
        : indexOrRecord;
    if (!record) return;
    const key = String(record.invoiceKey || record.invoiceNo || record.invoiceId || '').trim();
    if (receivePaymentState.selectedInvoices.some((item) => String(item.invoiceKey || item.invoiceNo || item.invoiceId || '') === key)) {
        setReceivePaymentStatus('Invoice is already in the receive payment table.');
        return;
    }
    receivePaymentState.selectedInvoices.push({
        ...record,
        receiveAmount: receivePaymentOutstandingForInvoice(record) || Number(record.amount || 0)
    });
    renderReceivePaymentInvoices();
    updateReceivePaymentBalanceStatus();
}

function removeReceivePaymentInvoice(index) {
    receivePaymentState.selectedInvoices.splice(index, 1);
    renderReceivePaymentInvoices();
    updateReceivePaymentBalanceStatus();
}

function runReceivePaymentSearch() {
    const query = document.getElementById('receivePaymentInvoiceSearch')?.value || '';
    receivePaymentState.searchResults = searchReceivePaymentInvoices(query);
    renderReceivePaymentSearchResults();
    if (!receivePaymentState.searchResults.length && String(query || '').trim()) {
        setReceivePaymentStatus('No unpaid matching invoice found.');
    }
}

function loadReceivePaymentDraft(paymentDocId) {
    const docId = decodeURIComponent(String(paymentDocId || '')).trim();
    const draft = draftPaymentEntries.find((entry) => String(entry.docId || entry.id || '') === docId);
    if (!draft) {
        setReceivePaymentStatus('Draft payment could not be loaded.');
        return;
    }
    clearReceivePaymentSelection({ keepDraft: true });
    receivePaymentState.selectedDraft = draft;

    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value ?? '';
    };
    setValue('receivePaymentDate', toDateKey(draft.datePaid || draft.paymentDate) || getTodayInputValue(0));
    setValue('receivePaymentOrNumber', draft.orNumber || draft.printedOr || '');
    setValue('receivePaymentAmount', Number(draft.amount || 0) ? Number(draft.amount || 0).toFixed(2) : '');
    setValue('receivePaymentDeduction', Number(getPaymentDeductionAmount(draft) || 0) ? Number(getPaymentDeductionAmount(draft)).toFixed(2) : '');
    setValue('receivePaymentType', formatPaymentTypeLabel(draft.paymentType) === 'CHECK' ? 'check' : 'cash');
    setValue('receivePaymentCheckNumber', draft.checkNumber || '');
    setValue('receivePaymentCheckDate', toDateKey(draft.checkDate) || '');
    setValue('receivePaymentCheckBank', draft.accountBank || '');
    setValue('receivePaymentRemarks', draft.remarks || '');

    const invoice = findReceivePaymentInvoice(draft.invoiceNo || draft.invoiceId);
    if (invoice) addReceivePaymentInvoice(invoice);
    else {
        const search = document.getElementById('receivePaymentInvoiceSearch');
        if (search) search.value = draft.invoiceNo || draft.invoiceId || '';
        setReceivePaymentStatus('Review the draft and search/add the invoice before confirming.');
    }
}

function loadReceivePaymentDraftGroup(messengerName) {
    const messenger = decodeURIComponent(String(messengerName || '')).trim();
    const group = draftPaymentEntries.filter((entry) => getDraftMessengerName(entry) === messenger);
    if (!group.length) {
        setReceivePaymentStatus('Messenger batch could not be loaded.');
        return;
    }
    clearReceivePaymentSelection({ keepDraft: true });
    receivePaymentState.selectedDraft = group[0];
    receivePaymentState.selectedDraftGroup = group;

    const amountTotal = group.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const deductionTotal = group.reduce((sum, payment) => sum + getPaymentDeductionAmount(payment), 0);
    const hasCash = group.some((payment) => formatPaymentTypeLabel(payment.paymentType) !== 'CHECK');
    const hasCheck = group.some((payment) => formatPaymentTypeLabel(payment.paymentType) === 'CHECK');
    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value ?? '';
    };

    setValue('receivePaymentDate', toDateKey(group[0].datePaid || group[0].paymentDate) || getTodayInputValue(0));
    setValue('receivePaymentOrNumber', group.map((payment) => payment.orNumber || payment.printedOr || '').filter(Boolean).join(', '));
    setValue('receivePaymentAmount', amountTotal ? amountTotal.toFixed(2) : '');
    setValue('receivePaymentDeduction', deductionTotal ? deductionTotal.toFixed(2) : '');
    setValue('receivePaymentType', hasCash && hasCheck ? 'mixed' : hasCheck ? 'check' : 'cash');
    setValue('receivePaymentCheckNumber', group.map((payment) => payment.checkNumber || '').filter(Boolean).join(', '));
    setValue('receivePaymentCheckDate', toDateKey(group.find((payment) => payment.checkDate)?.checkDate) || '');
    setValue('receivePaymentCheckBank', group.map((payment) => payment.accountBank || '').filter(Boolean).join(', '));
    setValue('receivePaymentRemarks', `Messenger turnover: ${messenger}`);

    group.forEach((draft) => {
        const invoice = findReceivePaymentInvoice(draft.invoiceNo || draft.invoiceId);
        if (!invoice) return;
        const turnoverTotal = getDraftTurnoverAmount(draft);
        receivePaymentState.selectedInvoices.push({
            ...invoice,
            receiveAmount: turnoverTotal || receivePaymentOutstandingForInvoice(invoice),
            draftDocId: String(draft.docId || draft.id || '')
        });
    });

    renderReceivePaymentDrafts();
    renderReceivePaymentInvoices();
    updateReceivePaymentBalanceStatus();
}

function openReceivePaymentModal() {
    const modal = document.getElementById('receivePaymentModal');
    if (!modal) return;
    clearReceivePaymentSelection();
    ['receivePaymentOrNumber', 'receivePaymentAmount', 'receivePaymentDeduction', 'receivePaymentCheckNumber', 'receivePaymentCheckDate', 'receivePaymentCheckBank', 'receivePaymentRemarks'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    const paymentDate = document.getElementById('receivePaymentDate');
    const paymentType = document.getElementById('receivePaymentType');
    if (paymentDate) paymentDate.value = getTodayInputValue(0);
    if (paymentType) paymentType.value = 'cash';
    renderReceivePaymentDrafts();
    renderReceivePaymentInvoices();
    updateReceivePaymentBalanceStatus();
    modal.classList.remove('hidden');
    document.getElementById('receivePaymentInvoiceSearch')?.focus();
}

function closeReceivePaymentModal() {
    document.getElementById('receivePaymentModal')?.classList.add('hidden');
}

function buildReceivePaymentAllocation(totalAmount, totalDeduction, invoiceAmount, selectedTotal) {
    if (selectedTotal <= 0) return { paymentAmount: 0, deductionAmount: 0, balanceAmount: 0 };
    const ratio = Number(invoiceAmount || 0) / selectedTotal;
    const deductionAmount = Math.min(Number(invoiceAmount || 0), Number((totalDeduction * ratio).toFixed(2)));
    const paymentAmount = Math.min(Math.max(0, Number(invoiceAmount || 0) - deductionAmount), Number((totalAmount * ratio).toFixed(2)));
    const balanceAmount = Math.max(0, Number(invoiceAmount || 0) - paymentAmount - deductionAmount);
    return { paymentAmount, deductionAmount, balanceAmount };
}

async function confirmReceivePayment() {
    if (isSavingReceivePayment) return;
    const invoices = receivePaymentState.selectedInvoices;
    const selectedTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.receiveAmount || 0), 0);
    const amount = parseMoneyInput(document.getElementById('receivePaymentAmount')?.value || '0');
    const deduction = parseMoneyInput(document.getElementById('receivePaymentDeduction')?.value || '0');
    const paymentDate = String(document.getElementById('receivePaymentDate')?.value || '').trim();
    const orNumber = String(document.getElementById('receivePaymentOrNumber')?.value || '').trim();
    const selectedPaymentType = String(document.getElementById('receivePaymentType')?.value || '');
    const isCheck = selectedPaymentType === 'check';
    const checkNumber = String(document.getElementById('receivePaymentCheckNumber')?.value || '').trim();
    const checkDate = String(document.getElementById('receivePaymentCheckDate')?.value || '').trim();
    const checkBank = String(document.getElementById('receivePaymentCheckBank')?.value || '').trim();
    const remarks = String(document.getElementById('receivePaymentRemarks')?.value || '').trim();
    const draft = receivePaymentState.selectedDraft;
    const draftGroup = receivePaymentState.selectedDraftGroup || [];

    if (!invoices.length) {
        setReceivePaymentStatus('Add at least one invoice before confirming received payment.');
        return;
    }
    if (!paymentDate) {
        setReceivePaymentStatus('Set the payment date.');
        return;
    }
    if (Math.abs(selectedTotal - amount - deduction) > 0.01) {
        setReceivePaymentStatus('Invoice total must match amount received plus 2307/deduction before confirmation.');
        return;
    }
    if (draftGroup.length && !draftGroup.every((payment) => receivePaymentState.matchedDraftIds.has(String(payment.docId || payment.id || '')))) {
        setReceivePaymentStatus('Confirm the actual cash/check/slip match for every row in the messenger batch.');
        return;
    }
    if (isCheck && (!checkNumber || !checkDate || !checkBank)) {
        setReceivePaymentStatus('Complete check number, check date, and bank.');
        return;
    }

    isSavingReceivePayment = true;
    const button = document.getElementById('receivePaymentConfirmBtn');
    if (button) button.disabled = true;
    setReceivePaymentStatus('Confirming received payment...');
    try {
        const now = toTimestampString(new Date());
        const confirmedBy = getCurrentCollectorName();
        const sharedGroupId = draftGroup.length ? `turnover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : (draft?.docId || createWebDocId('received_payment_group'));
        const createdEntries = [];

        for (let index = 0; index < invoices.length; index += 1) {
            const invoice = invoices[index];
            const sourceDraft = String(invoice.draftDocId || '')
                ? draftGroup.find((payment) => String(payment.docId || payment.id || '') === String(invoice.draftDocId || ''))
                : (!draftGroup.length && index === 0 ? draft : null);
            const allocation = sourceDraft
                ? {
                    paymentAmount: Number(sourceDraft.amount || 0),
                    deductionAmount: getPaymentDeductionAmount(sourceDraft),
                    balanceAmount: Math.max(0, Number(invoice.receiveAmount || 0) - Number(sourceDraft.amount || 0) - getPaymentDeductionAmount(sourceDraft))
                }
                : buildReceivePaymentAllocation(amount, deduction, Number(invoice.receiveAmount || 0), selectedTotal);
            const paymentDocId = sourceDraft?.docId || createWebDocId('received_payment');
            const paymentRecordId = sourceDraft?.id || paymentDocId;
            const entryIsCheck = sourceDraft ? formatPaymentTypeLabel(sourceDraft.paymentType) === 'CHECK' : isCheck;
            const entryCheckNumber = sourceDraft?.checkNumber || checkNumber;
            const entryCheckDate = toDateKey(sourceDraft?.checkDate) || checkDate;
            const entryCheckBank = sourceDraft?.accountBank || checkBank;
            const entryOrNumber = sourceDraft?.orNumber || sourceDraft?.printedOr || orNumber;
            const checkDocId = entryIsCheck ? (sourceDraft?.checkpaymentId && sourceDraft.checkpaymentId !== '0' ? sourceDraft.checkpaymentId : createWebDocId('received_checkpayment')) : '';
            const taxFormStatus = allocation.deductionAmount > 0 ? 'pending' : '';
            const paymentFields = {
                id: toFirestoreWriteValue(paymentRecordId),
                invoice_id: toFirestoreWriteValue(invoice.invoiceId || invoice.invoiceNo),
                invoice_num: toFirestoreWriteValue(invoice.invoiceNo || invoice.invoiceId),
                client: toFirestoreWriteValue(invoice.company || ''),
                category: toFirestoreWriteValue(invoice.branch || ''),
                invoice_amt: toFirestoreWriteValue(Number(invoice.receiveAmount || 0)),
                invoice_date: toFirestoreWriteValue(formatInputDateTime(toDateKey(invoice.invoiceDate))),
                printed_or: toFirestoreWriteValue(entryOrNumber),
                assigned: toFirestoreWriteValue(confirmedBy),
                payment_amt: toFirestoreWriteValue(allocation.paymentAmount),
                balance_amt: toFirestoreWriteValue(allocation.balanceAmount),
                date_deposit: toFirestoreWriteValue(formatInputDateTime(paymentDate)),
                date_paid: toFirestoreWriteValue(formatInputDateTime(paymentDate)),
                ornum: toFirestoreWriteValue(entryOrNumber),
                or_number: toFirestoreWriteValue(entryOrNumber),
                payment_type: toFirestoreWriteValue(entryIsCheck ? 1 : 0),
                payment_status: toFirestoreWriteValue(allocation.balanceAmount <= 0.01 ? 'Paid' : 'Partial'),
                check_number: toFirestoreWriteValue(entryCheckNumber),
                check_amt: toFirestoreWriteValue(entryIsCheck ? allocation.paymentAmount : 0),
                check_date: toFirestoreWriteValue(formatInputDateTime(entryCheckDate)),
                account_bank: toFirestoreWriteValue(entryCheckBank),
                tax_2307: toFirestoreWriteValue(allocation.deductionAmount),
                tax_date_paid: toFirestoreWriteValue(formatInputDateTime(allocation.deductionAmount > 0 ? paymentDate : '')),
                tax_status: toFirestoreWriteValue(allocation.deductionAmount > 0 ? 1 : 0),
                deduction_type: toFirestoreWriteValue(allocation.deductionAmount > 0 ? '2307' : ''),
                deduction_amount: toFirestoreWriteValue(allocation.deductionAmount),
                tax_form_status: toFirestoreWriteValue(taxFormStatus),
                checkpayment_id: toFirestoreWriteValue(checkDocId || 0),
                remarks: toFirestoreWriteValue(remarks),
                received_payment_group_id: toFirestoreWriteValue(sharedGroupId),
                field_draft_payment_id: toFirestoreWriteValue(sourceDraft?.docId || draft?.docId || ''),
                messenger_turnover_by: toFirestoreWriteValue(sourceDraft ? getDraftMessengerName(sourceDraft) : ''),
                field_confirmed_at: toFirestoreWriteValue(now),
                field_confirmed_by: toFirestoreWriteValue(confirmedBy),
                timestamp: toFirestoreWriteValue(now),
                updated_at: toFirestoreWriteValue(now),
                source: toFirestoreWriteValue(sourceDraft ? 'collections_confirmed_field_payment' : 'collections_received_payment')
            };

            if (sourceDraft?.docId) {
                await firestoreUpdateDocumentFields('tbl_paymentinfo', paymentDocId, paymentFields);
            } else {
                await firestoreSetDocument('tbl_paymentinfo', paymentDocId, paymentFields);
            }

            if (entryIsCheck) {
                await firestoreSetDocument('tbl_checkpayments', checkDocId, {
                    id: toFirestoreWriteValue(checkDocId),
                    payments_id: toFirestoreWriteValue(paymentDocId),
                    invoice_id: toFirestoreWriteValue(invoice.invoiceId || invoice.invoiceNo),
                    check_number: toFirestoreWriteValue(entryCheckNumber),
                    bank: toFirestoreWriteValue(entryCheckBank),
                    account_bank: toFirestoreWriteValue(entryCheckBank),
                    check_amt: toFirestoreWriteValue(allocation.paymentAmount),
                    check_date: toFirestoreWriteValue(formatInputDateTime(entryCheckDate)),
                    remarks: toFirestoreWriteValue(remarks),
                    source: toFirestoreWriteValue('collections_received_payment'),
                    timestamp: toFirestoreWriteValue(now)
                });
            }

            createdEntries.push({
                docId: paymentDocId,
                id: paymentRecordId,
                invoiceId: invoice.invoiceId || invoice.invoiceNo,
                invoiceNo: invoice.invoiceNo || invoice.invoiceId,
                client: invoice.company || '',
                category: invoice.branch || '',
                invoiceAmount: Number(invoice.receiveAmount || 0),
                invoiceDate: normalizeDate(invoice.invoiceDate),
                amount: allocation.paymentAmount,
                balanceAmount: allocation.balanceAmount,
                deductionType: allocation.deductionAmount > 0 ? '2307' : '',
                deductionAmount: allocation.deductionAmount,
                paymentDate: normalizeDate(paymentDate),
                datePaid: normalizeDate(paymentDate),
                dateDeposit: normalizeDate(paymentDate),
                orNumber: entryOrNumber,
                paymentType: entryIsCheck ? '1' : '0',
                paymentStatus: allocation.balanceAmount <= 0.01 ? 'Paid' : 'Partial',
                tax2307: allocation.deductionAmount,
                taxStatus: allocation.deductionAmount > 0 ? '1' : '0',
                taxFormStatus,
                checkNumber: entryCheckNumber,
                checkAmount: entryIsCheck ? allocation.paymentAmount : 0,
                checkDate: normalizeDate(entryCheckDate),
                accountBank: entryCheckBank,
                remarks
            });
        }

        if (draftGroup.length) {
            const confirmedIds = new Set(draftGroup.map((entry) => String(entry.docId || entry.id || '')));
            draftPaymentEntries = draftPaymentEntries.filter((entry) => !confirmedIds.has(String(entry.docId || entry.id || '')));
        } else if (draft?.docId) {
            draftPaymentEntries = draftPaymentEntries.filter((entry) => String(entry.docId || entry.id || '') !== String(draft.docId || draft.id || ''));
        }
        createdEntries.forEach((entry) => {
            paymentEntries = paymentEntries.filter((item) => String(item.docId || item.id || '') !== String(entry.docId || entry.id || ''));
            paymentEntries.push(entry);
        });
        rebuildPaidInvoiceIdsFromPayments();
        collectorDashboardData = null;
        renderReceivePaymentDrafts();
        clearReceivePaymentSelection();
        renderReceivePaymentInvoices();
        setReceivePaymentStatus('Payment confirmed. Month comparison will update with the official payment.');
        void renderCollectorDashboard({ recompute: true });
    } catch (error) {
        console.error('Failed to confirm received payment:', error);
        setReceivePaymentStatus('Payment confirmation failed. Please try again.');
    } finally {
        isSavingReceivePayment = false;
        if (button) button.disabled = false;
    }
}

function resetCollectorPaymentForm() {
    const summary = document.getElementById('collectorPaymentSummary');
    const currentBalance = parseMoneyInput(summary?.dataset.invoiceAmount || '0');
    const legacyId = document.getElementById('collectorPaymentLegacyId');
    const docIdInput = document.getElementById('collectorPaymentDocId');
    const newButton = document.getElementById('collectorPaymentNewButton');
    if (legacyId) legacyId.value = 'Auto on save';
    if (docIdInput) docIdInput.value = '';
    if (newButton) newButton.hidden = true;

    [
        'collectorPaymentPaidAmount',
        'collectorPaymentOrNumber',
        'collectorPaymentAssigned',
        'collectorPaymentCheckNumber',
        'collectorPaymentCheckBank',
        'collectorPaymentCheckDate',
        'collectorPaymentCheckAmount',
        'collectorPaymentAccountBank',
        'collectorPaymentDeductionAmount',
        'collectorPaymentRemarks'
    ].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });

    const paymentDate = document.getElementById('collectorPaymentDate');
    const depositDate = document.getElementById('collectorPaymentDepositDate');
    const status = document.getElementById('collectorPaymentStatus');
    const deductionType = document.getElementById('collectorPaymentDeductionType');
    const balance = document.getElementById('collectorPaymentBalance');
    const pending2307 = document.getElementById('collectorPayment2307Pending');
    if (paymentDate) paymentDate.value = getTodayInputValue(0);
    if (depositDate) depositDate.value = getTodayInputValue(0);
    if (status) status.value = 'Paid';
    if (deductionType) deductionType.value = '';
    if (balance) balance.value = currentBalance.toFixed(2);
    if (pending2307) {
        pending2307.checked = true;
        delete pending2307.dataset.touched;
    }
    syncCollectorPaymentMethod('cash');
    updateCollectorPaymentBalance();
    const statusNode = document.getElementById('collectorPaymentSaveStatus');
    if (statusNode) statusNode.textContent = 'Ready for new payment.';
}

function editCollectorPaymentRecord(paymentDocId) {
    const payment = findCollectorPaymentRecord(paymentDocId);
    const statusNode = document.getElementById('collectorPaymentSaveStatus');
    if (!payment) {
        if (statusNode) statusNode.textContent = 'Payment record could not be loaded for editing.';
        return;
    }

    const docId = String(payment.docId || payment.id || '').trim();
    const legacyId = document.getElementById('collectorPaymentLegacyId');
    const docIdInput = document.getElementById('collectorPaymentDocId');
    const newButton = document.getElementById('collectorPaymentNewButton');
    if (legacyId) legacyId.value = payment.id || docId;
    if (docIdInput) docIdInput.value = docId;
    if (newButton) newButton.hidden = false;

    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value ?? '';
    };

    setValue('collectorPaymentClient', payment.client || document.getElementById('collectorPaymentClient')?.value || '');
    setValue('collectorPaymentCategory', payment.category || document.getElementById('collectorPaymentCategory')?.value || '');
    setValue('collectorPaymentPaidAmount', Number(payment.amount || 0) ? Number(payment.amount || 0).toFixed(2) : '');
    setValue('collectorPaymentInvoiceNo', payment.invoiceNo || document.getElementById('collectorPaymentInvoiceNo')?.value || '');
    setValue('collectorPaymentInvoiceId', payment.invoiceId || payment.invoiceNo || '');
    setValue('collectorPaymentInvoiceDate', toDateKey(payment.invoiceDate) || document.getElementById('collectorPaymentInvoiceDate')?.value || '');
    setValue('collectorPaymentOrNumber', payment.orNumber || '');
    setValue('collectorPaymentPrintedOr', payment.printedOr || document.getElementById('collectorPaymentPrintedOr')?.value || '');
    setValue('collectorPaymentAssigned', payment.assigned || '');
    setValue('collectorPaymentDate', toDateKey(payment.datePaid || payment.paymentDate) || getTodayInputValue(0));
    setValue('collectorPaymentDepositDate', toDateKey(payment.dateDeposit || payment.paymentDate) || getTodayInputValue(0));
    setValue('collectorPaymentCheckNumber', payment.checkNumber || '');
    setValue('collectorPaymentCheckBank', payment.accountBank || '');
    setValue('collectorPaymentCheckDate', toDateKey(payment.checkDate) || '');
    setValue('collectorPaymentCheckAmount', Number(payment.checkAmount || 0) ? Number(payment.checkAmount || 0).toFixed(2) : '');
    setValue('collectorPaymentAccountBank', payment.accountBank || '');
    setValue('collectorPaymentStatus', payment.paymentStatus || (Number(payment.balanceAmount || 0) <= 0.01 ? 'Paid' : 'Partial'));
    setValue('collectorPaymentDeductionType', payment.deductionType || (Number(payment.tax2307 || 0) > 0 ? '2307' : ''));
    setValue('collectorPaymentDeductionAmount', Number(getPaymentDeductionAmount(payment) || 0) ? Number(getPaymentDeductionAmount(payment) || 0).toFixed(2) : '');
    setValue('collectorPaymentBalance', Number(payment.balanceAmount || 0).toFixed(2));
    setValue('collectorPaymentRemarks', payment.remarks || '');

    const pending2307 = document.getElementById('collectorPayment2307Pending');
    if (pending2307) {
        pending2307.checked = is2307DeductionPayment(payment) ? !is2307FormSubmitted(payment) : true;
        pending2307.dataset.touched = '1';
    }

    syncCollectorPaymentMethod(formatPaymentTypeLabel(payment.paymentType) === 'CHECK' ? 'check' : 'cash');
    updateCollectorPaymentBalance();
    if (statusNode) statusNode.textContent = `Editing payment ${payment.id || docId}. Save will update this record.`;
}

async function refreshCollectorPaymentWorkspace(message = '') {
    if (!currentCollectorWorkspace?.cell) return;
    const refreshed = await buildCollectorFollowupWorkspace(currentCollectorWorkspace.cell);
    currentCollectorWorkspace = {
        ...refreshed,
        cellId: refreshed.cell.id
    };

    const content = document.getElementById('collectorCellContent');
    if (content) content.innerHTML = renderCollectorFollowupWorkspace(refreshed);
    bindCollectorPaymentForm();
    setCollectorWorkspaceTab('payment');
    const refreshedStatusNode = document.getElementById('collectorPaymentSaveStatus');
    if (refreshedStatusNode && message) refreshedStatusNode.textContent = message;
}

async function cancelCollectorPaymentRecord(paymentDocId) {
    const docId = decodeURIComponent(String(paymentDocId || '')).trim();
    const payment = findCollectorPaymentRecord(docId);
    const statusNode = document.getElementById('collectorPaymentSaveStatus');
    if (!docId || !payment || isSavingCollectorPayment) {
        if (statusNode) statusNode.textContent = 'Payment record could not be cancelled.';
        return;
    }
    const ok = window.confirm(`Cancel payment ${payment.id || docId}? This removes it from collection totals but keeps an audit trail.`);
    if (!ok) return;

    isSavingCollectorPayment = true;
    if (statusNode) statusNode.textContent = 'Cancelling payment record...';
    try {
        const now = toTimestampString(new Date());
        await firestoreUpdateDocumentFields('tbl_paymentinfo', docId, {
            payment_status: toFirestoreWriteValue('Cancelled'),
            iscancel: toFirestoreWriteValue(1),
            cancelled_at: toFirestoreWriteValue(now),
            cancelled_by: toFirestoreWriteValue(getCurrentCollectorName()),
            updated_at: toFirestoreWriteValue(now)
        });
        paymentEntries = paymentEntries.filter((entry) => String(entry.docId || entry.id || '') !== docId);
        rebuildPaidInvoiceIdsFromPayments();
        collectorDashboardData = null;
        await refreshCollectorPaymentWorkspace('Payment cancelled. Totals were updated.');
        void renderCollectorDashboard({ recompute: true });
    } catch (error) {
        console.error('Failed to cancel collection payment:', error);
        if (statusNode) statusNode.textContent = 'Payment cancel failed. Please try again.';
    } finally {
        isSavingCollectorPayment = false;
    }
}

function useCollectorContact(button) {
    const row = button?.closest?.('tr');
    if (!row) return;

    const person = row.dataset.contactPerson || '';
    const number = row.dataset.contactNumber || '';
    const followupContact = document.getElementById('collectorLastContact');
    const profileContact = document.getElementById('collectorProfileContactPerson');
    const profileNumber = document.getElementById('collectorProfileContactNumber');
    const contactNumber = document.getElementById('collectorContactNumber');

    if (followupContact) followupContact.value = person;
    if (profileContact) profileContact.value = person;
    if (profileNumber) profileNumber.value = number;
    if (contactNumber) contactNumber.value = number;
}

async function saveCollectorProfileOverride() {
    if (!currentCollectorWorkspace?.context || isSavingCollectorProfileOverride) return;

    const statusNode = document.getElementById('collectorProfileSaveStatus');
    const context = currentCollectorWorkspace.context;
    const docId = collectionProfileOverrideDocId(context);

    const override = {
        branch_id: context.branchId || '',
        company_id: context.companyId || '',
        contractmain_id: context.contractmainId || '',
        customer: context.customer || '',
        branch: context.branchName || '',
        collection_address: String(document.getElementById('collectorProfileAddress')?.value || '').trim(),
        contact_person: String(document.getElementById('collectorProfileContactPerson')?.value || '').trim(),
        contact_number: String(document.getElementById('collectorProfileContactNumber')?.value || '').trim(),
        followup_days: String(document.getElementById('collectorProfileFollowupDays')?.value || '').trim(),
        followup_time: String(document.getElementById('collectorProfileFollowupTime')?.value || '').trim(),
        collection_time_from: String(document.getElementById('collectorProfileTimeFrom')?.value || '').trim(),
        collection_time_to: String(document.getElementById('collectorProfileTimeTo')?.value || '').trim(),
        last_contact: String(document.getElementById('collectorProfileLastContact')?.value || '').trim(),
        updated_at: toTimestampString(new Date()),
        source: 'collections_web_override'
    };

    isSavingCollectorProfileOverride = true;
    if (statusNode) statusNode.textContent = 'Saving web override...';

    try {
        const fields = {};
        Object.entries(override).forEach(([key, value]) => {
            fields[key] = toFirestoreWriteValue(value);
        });

        await firestoreSetDocument('marga_collection_profiles', docId, fields);
        upsertCollectionProfileOverride(context, override);

        if (statusNode) statusNode.textContent = 'Saved as web override. Legacy collection info was not changed.';
    } catch (error) {
        console.error('Failed to save collection profile override:', error);
        if (statusNode) statusNode.textContent = 'Override save failed. Follow-up history was not affected.';
    } finally {
        isSavingCollectorProfileOverride = false;
    }
}

async function saveCollectorPayment() {
    if (!currentCollectorWorkspace || isSavingCollectorPayment) return;

    const statusNode = document.getElementById('collectorPaymentSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const editingDocId = String(document.getElementById('collectorPaymentDocId')?.value || '').trim();
    const editingPayment = editingDocId ? findCollectorPaymentRecord(editingDocId) : null;
    const invoiceNo = String(document.getElementById('collectorPaymentInvoiceNo')?.value || selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
    const invoiceId = String(document.getElementById('collectorPaymentInvoiceId')?.value || selectedInvoice?.invoiceId || selectedInvoice?.invoiceNo || invoiceNo || '').trim();
    const paymentClient = String(document.getElementById('collectorPaymentClient')?.value || selectedInvoice?.accountLabel || selectedInvoice?.company || '').trim();
    const paymentCategory = String(document.getElementById('collectorPaymentCategory')?.value || selectedInvoice?.category || '').trim();
    const invoiceAmount = parseMoneyInput(String(selectedInvoice?.amount || currentCollectorWorkspace?.cell?.displayBilledTotal || currentCollectorWorkspace?.cell?.billedTotal || '0'));
    const invoiceDate = String(document.getElementById('collectorPaymentInvoiceDate')?.value || '').trim();
    const printedOrRef = String(document.getElementById('collectorPaymentPrintedOr')?.value || '').trim();
    const assigned = String(document.getElementById('collectorPaymentAssigned')?.value || '').trim();
    const amountPaid = parseMoneyInput(document.getElementById('collectorPaymentPaidAmount')?.value || '0');
    const deductionType = String(document.getElementById('collectorPaymentDeductionType')?.value || '').trim().toLowerCase();
    const deductionAmount = deductionType ? parseMoneyInput(document.getElementById('collectorPaymentDeductionAmount')?.value || '0') : 0;
    const tax2307 = deductionType === '2307' ? deductionAmount : 0;
    const otherDeductionAmount = deductionType && deductionType !== '2307' ? deductionAmount : 0;
    const taxFormPending = tax2307 > 0 && Boolean(document.getElementById('collectorPayment2307Pending')?.checked);
    const taxFormStatus = tax2307 > 0 ? (taxFormPending ? 'pending' : 'submitted') : '';
    const taxStatus = tax2307 > 0 ? (taxFormPending ? 1 : 2) : 0;
    const balance = parseMoneyInput(document.getElementById('collectorPaymentBalance')?.value || '0');
    const orNumber = String(document.getElementById('collectorPaymentOrNumber')?.value || '').trim();
    const paymentDate = String(document.getElementById('collectorPaymentDate')?.value || '').trim();
    const depositDate = String(document.getElementById('collectorPaymentDepositDate')?.value || paymentDate || '').trim();
    const isCheck = Boolean(document.getElementById('collectorPaymentCheck')?.checked);
    const checkNumber = String(document.getElementById('collectorPaymentCheckNumber')?.value || '').trim();
    const checkBank = String(document.getElementById('collectorPaymentCheckBank')?.value || '').trim();
    const checkDate = String(document.getElementById('collectorPaymentCheckDate')?.value || '').trim();
    const checkAmount = isCheck ? parseMoneyInput(document.getElementById('collectorPaymentCheckAmount')?.value || amountPaid) : 0;
    const accountBank = String(document.getElementById('collectorPaymentAccountBank')?.value || checkBank || '').trim();
    const paymentStatus = String(document.getElementById('collectorPaymentStatus')?.value || (balance <= 0.01 ? 'Paid' : 'Partial')).trim();
    const remarks = String(document.getElementById('collectorPaymentRemarks')?.value || '').trim();
    const now = toTimestampString(new Date());

    if (!invoiceId && !invoiceNo) {
        if (statusNode) statusNode.textContent = 'No invoice is linked to this payment.';
        return;
    }

    if (!(amountPaid > 0) && !(deductionAmount > 0)) {
        if (statusNode) statusNode.textContent = 'Enter the actual amount received or a deduction amount.';
        return;
    }

    if (deductionAmount > 0 && !deductionType) {
        if (statusNode) statusNode.textContent = 'Choose the deduction type.';
        return;
    }

    if (!paymentDate) {
        if (statusNode) statusNode.textContent = 'Set the date of payment.';
        return;
    }

    if (isCheck && (!checkNumber || !checkBank || !checkDate)) {
        if (statusNode) statusNode.textContent = 'Complete check number, bank, and check date.';
        return;
    }

    isSavingCollectorPayment = true;
    if (statusNode) statusNode.textContent = editingDocId ? 'Updating payment record...' : 'Saving payment record...';

    try {
        const paymentDocId = editingDocId || createWebDocId('web_payment');
        const paymentRecordId = editingDocId ? (String(editingPayment?.id || '').trim() || paymentDocId) : paymentDocId;
        const checkDocId = isCheck
            ? (String(editingPayment?.checkpaymentId || '').trim() || createWebDocId('web_checkpayment'))
            : '';
        const paymentFields = {
            id: toFirestoreWriteValue(paymentRecordId),
            invoice_id: toFirestoreWriteValue(invoiceId || invoiceNo),
            invoice_num: toFirestoreWriteValue(invoiceNo || invoiceId),
            client: toFirestoreWriteValue(paymentClient),
            category: toFirestoreWriteValue(paymentCategory),
            invoice_amt: toFirestoreWriteValue(invoiceAmount),
            invoice_date: toFirestoreWriteValue(formatInputDateTime(invoiceDate)),
            printed_or: toFirestoreWriteValue(printedOrRef),
            assigned: toFirestoreWriteValue(assigned),
            payment_amt: toFirestoreWriteValue(amountPaid),
            balance_amt: toFirestoreWriteValue(balance),
            date_deposit: toFirestoreWriteValue(formatInputDateTime(depositDate)),
            date_paid: toFirestoreWriteValue(formatInputDateTime(paymentDate)),
            ornum: toFirestoreWriteValue(orNumber),
            payment_type: toFirestoreWriteValue(isCheck ? 1 : 0),
            payment_status: toFirestoreWriteValue(paymentStatus),
            check_number: toFirestoreWriteValue(checkNumber),
            check_amt: toFirestoreWriteValue(checkAmount),
            check_date: toFirestoreWriteValue(formatInputDateTime(checkDate)),
            account_bank: toFirestoreWriteValue(accountBank),
            tax_2307: toFirestoreWriteValue(tax2307),
            tax_date_paid: toFirestoreWriteValue(formatInputDateTime(tax2307 > 0 ? paymentDate : '')),
            tax_status: toFirestoreWriteValue(taxStatus),
            deduction_type: toFirestoreWriteValue(deductionType),
            deduction_amount: toFirestoreWriteValue(deductionAmount),
            other_deduction_amount: toFirestoreWriteValue(otherDeductionAmount),
            tax_form_status: toFirestoreWriteValue(taxFormStatus),
            tax_form_received_at: toFirestoreWriteValue(tax2307 > 0 && !taxFormPending ? now : ''),
            checkpayment_id: toFirestoreWriteValue(checkDocId || 0),
            remarks: toFirestoreWriteValue(remarks),
            timestamp: toFirestoreWriteValue(now),
            updated_at: toFirestoreWriteValue(now),
            source: toFirestoreWriteValue('collections_web_payment')
        };

        if (editingDocId) {
            await firestoreUpdateDocumentFields('tbl_paymentinfo', paymentDocId, paymentFields);
        } else {
            await firestoreSetDocument('tbl_paymentinfo', paymentDocId, paymentFields);
        }

        if (isCheck) {
            await firestoreSetDocument('tbl_checkpayments', checkDocId, {
                id: toFirestoreWriteValue(checkDocId),
                payments_id: toFirestoreWriteValue(paymentDocId),
                invoice_id: toFirestoreWriteValue(invoiceId || invoiceNo),
                check_number: toFirestoreWriteValue(checkNumber),
                bank: toFirestoreWriteValue(checkBank),
                account_bank: toFirestoreWriteValue(accountBank),
                account_number: toFirestoreWriteValue(accountBank),
                check_amt: toFirestoreWriteValue(checkAmount || amountPaid),
                check_date: toFirestoreWriteValue(formatInputDateTime(checkDate)),
                remarks: toFirestoreWriteValue(remarks),
                source: toFirestoreWriteValue('collections_web_payment'),
                timestamp: toFirestoreWriteValue(now)
            });
        }

        const updatedPaymentEntry = {
            docId: paymentDocId,
            id: paymentRecordId,
            invoiceId: invoiceId || invoiceNo,
            invoiceNo: invoiceNo || invoiceId,
            client: paymentClient,
            category: paymentCategory,
            invoiceAmount,
            invoiceDate: normalizeDate(invoiceDate),
            printedOr: printedOrRef,
            assigned,
            amount: amountPaid,
            balanceAmount: balance,
            deductionType,
            deductionAmount,
            otherDeductionAmount,
            paymentDate: normalizeDate(depositDate || paymentDate),
            datePaid: normalizeDate(paymentDate),
            dateDeposit: normalizeDate(depositDate || paymentDate),
            taxDatePaid: tax2307 > 0 ? normalizeDate(paymentDate) : null,
            orNumber,
            paymentType: isCheck ? '1' : '0',
            paymentStatus,
            tax2307,
            taxStatus: String(taxStatus),
            taxFormStatus,
            taxFormReceivedAt: tax2307 > 0 && !taxFormPending ? normalizeDate(now) : null,
            checkpaymentId: checkDocId,
            checkNumber,
            checkAmount,
            checkDate: normalizeDate(checkDate),
            accountBank,
            remarks
        };
        paymentEntries = paymentEntries.filter((entry) => String(entry.docId || entry.id || '') !== paymentDocId);
        paymentEntries.push(updatedPaymentEntry);
        rebuildPaidInvoiceIdsFromPayments();

        await refreshCollectorPaymentWorkspace(editingDocId ? 'Updated. Payment record was edited.' : 'Saved. Payment record updated.');
        void refreshCollectorMatrixAfterStaffWrite();
    } catch (error) {
        console.error('Failed to save collection payment:', error);
        if (statusNode) statusNode.textContent = 'Payment save failed. Please try again.';
    } finally {
        isSavingCollectorPayment = false;
    }
}

async function saveCollectorFollowup() {
    if (!currentCollectorWorkspace || isSavingCollectorFollowup) return;

    const statusNode = document.getElementById('collectorFollowupSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const context = currentCollectorWorkspace.context || resolveCollectorCellContext(currentCollectorWorkspace.cell || {});

    const remarks = String(document.getElementById('collectorRemarks')?.value || '').trim();
    const followupDate = String(document.getElementById('collectorFollowupDate')?.value || '').trim();
    const conversationResult = String(document.getElementById('collectorConversationResult')?.value || '').trim();
    const promiseToPay = String(document.getElementById('collectorPromiseToPay')?.value || '').trim();
    const promiseAmountRaw = String(document.getElementById('collectorPromiseAmount')?.value || '').trim();
    const promiseAmount = promiseAmountRaw ? Number(promiseAmountRaw) : 0;
    const promiseDate = String(document.getElementById('collectorPromiseDate')?.value || '').trim();
    const nextFollowupTime = String(document.getElementById('collectorNextFollowupTime')?.value || '').trim();
    const issueType = String(document.getElementById('collectorIssueType')?.value || '').trim();
    const issueNotes = String(document.getElementById('collectorIssueNotes')?.value || '').trim();
    const collectionTime = String(document.getElementById('collectorCollectionTime')?.value || '').trim();
    const contactPerson = String(document.getElementById('collectorLastContact')?.value || '').trim();
    const contactNumber = String(document.getElementById('collectorContactNumber')?.value || '').trim();
    const statusId = Number(document.getElementById('collectorStatusId')?.value || 0);
    const locationId = Number(document.getElementById('collectorLocationId')?.value || 0);
    const locationOption = COLLECTION_LOCATION_OPTIONS.find((option) => Number(option.id) === locationId);
    const checkSigned = Boolean(document.getElementById('collectorCheckSigned')?.checked);
    const checkNumber = String(document.getElementById('collectorCheckNumber')?.value || '').trim();
    const paymentAmountRaw = String(document.getElementById('collectorPaymentAmount')?.value || '').trim();
    const paymentAmount = paymentAmountRaw ? Number(paymentAmountRaw) : 0;

    if (!conversationResult || !promiseToPay || !nextFollowupTime || !issueType) {
        if (statusNode) statusNode.textContent = 'Please complete Conversation Result, Promise To Pay, Next Follow-up Time, and Issue Type.';
        return;
    }

    if (PROMISE_DATE_REQUIRED_OPTIONS.has(promiseToPay) && !promiseDate) {
        if (statusNode) statusNode.textContent = 'Please set Promise To Pay Date for this payment schedule.';
        return;
    }

    if (promiseAmount < 0 || !Number.isFinite(promiseAmount)) {
        if (statusNode) statusNode.textContent = 'Promise amount must be zero or higher.';
        return;
    }

    if (!remarks) {
        if (statusNode) statusNode.textContent = 'Please enter remarks before saving.';
        return;
    }

    if (!followupDate) {
        if (statusNode) statusNode.textContent = 'Please set the next follow-up date.';
        return;
    }

    const normalizedTime = collectionTime ? `${collectionTime.length === 5 ? collectionTime : collectionTime.slice(0, 5)}:00` : '00:00:00';

    isSavingCollectorFollowup = true;
    if (statusNode) statusNode.textContent = 'Saving follow-up history...';

    try {
        const invoiceNo = String(selectedInvoice?.invoiceNo || selectedInvoice?.invoiceId || '').trim();
        const invoiceId = String(selectedInvoice?.invoiceId || selectedInvoice?.invoiceNo || '').trim();
        const accountKeys = collectionAccountHistoryKeys(context);
        const monthSlug = scheduleSlug(context.monthKey || context.label || '', '');
        const accountRef = accountKeys.find((key) => monthSlug && key.endsWith(`:${monthSlug}`)) || accountKeys[0] || collectionScheduleDocId(context, selectedInvoice);
        const accountGroupRef = accountKeys.find((key) => !monthSlug || !key.endsWith(`:${monthSlug}`)) || accountRef;
        const createdHistory = await firestoreCreate('tbl_collectionhistory', {
            invoice_num: { stringValue: invoiceNo },
            invoice_id: { stringValue: invoiceId },
            account_ref: { stringValue: accountRef },
            account_group_ref: { stringValue: accountGroupRef },
            branch_id: { stringValue: context.branchId || '' },
            company_id: { stringValue: context.companyId || '' },
            contractmain_id: { stringValue: context.contractmainId || '' },
            machine_id: { stringValue: context.machineId || '' },
            month_key: { stringValue: context.monthKey || context.label || '' },
            remarks: { stringValue: remarks },
            contact_person: { stringValue: contactPerson || '-' },
            contact_number: { stringValue: contactNumber || '' },
            conversation_result: { stringValue: conversationResult },
            promise_to_pay: { stringValue: promiseToPay },
            promise_to_pay_amount: { doubleValue: promiseAmount },
            promise_to_pay_date: { stringValue: promiseDate },
            next_followup_date: { stringValue: followupDate },
            next_followup_time: { stringValue: nextFollowupTime },
            issue_type: { stringValue: issueType },
            issue_notes: { stringValue: issueNotes },
            collection_role_assignment: { stringValue: getCurrentCollectionRoleAssignment() },
            customer_assignment_owner: { stringValue: getCustomerAssignmentOwner(context) || getCurrentCollectorName() },
            followed_up_by: { stringValue: getCurrentCollectorName() },
            collector_name: { stringValue: getCurrentCollectorName() },
            followup_datetime: { stringValue: `${followupDate} ${normalizedTime}` },
            timestamp: { stringValue: toTimestampString(new Date()) },
            schedule_status: { integerValue: String(statusId || 0) },
            status_id: { integerValue: String(statusId || 0) },
            location_id: { integerValue: String(locationId || 0) },
            location_label: { stringValue: locationOption?.label || '' },
            ischecksigned: { booleanValue: checkSigned },
            check_number: { stringValue: checkNumber },
            payment_amount: { doubleValue: Number.isFinite(paymentAmount) ? paymentAmount : 0 }
        });

        const savedHistoryEntry = collectionHistoryDocToEntry(createdHistory);
        if (collectionHistoryBulkLoaded) {
            indexCollectionHistoryEntry(savedHistoryEntry);
        } else {
            await loadCollectionHistory();
            indexCollectionHistoryEntry(savedHistoryEntry);
        }

        const refreshed = await buildCollectorFollowupWorkspace(currentCollectorWorkspace.cell);
        currentCollectorWorkspace = {
            ...refreshed,
            cellId: refreshed.cell.id
        };

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(refreshed);
        bindCollectorPaymentForm();
        const refreshedStatusNode = document.getElementById('collectorFollowupSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Follow-up history updated.';
        void refreshCollectorMatrixAfterStaffWrite();
    } catch (error) {
        console.error('Failed to save collection follow-up:', error);
        if (statusNode) statusNode.textContent = 'Save failed. Please try again.';
    } finally {
        isSavingCollectorFollowup = false;
    }
}

function buildCollectorScheduleRecord(workspace, options = {}) {
    const context = workspace.context || {};
    const selectedInvoice = workspace.selectedInvoice || {};
    const scheduleStatus = options.scheduleStatus || String(document.getElementById('collectorScheduleStatus')?.value || 'Confirmed').trim();
    const scheduleDate = options.scheduleDate || String(document.getElementById('collectorScheduleDate')?.value || '').trim();
    const scheduleTime = options.scheduleTime || String(document.getElementById('collectorScheduleTime')?.value || '').trim();
    const assignee = options.assignee || getCollectionAssignee();
    const returnCallRadio = document.querySelector('input[name="collectorScheduleReturnChoice"]:checked')?.value;
    const returnCall = options.returnCall !== undefined
        ? options.returnCall
        : (returnCallRadio ? returnCallRadio === 'yes' : Boolean(document.getElementById('collectorScheduleReturnCall')?.checked));
    const invoiceNo = String(selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '').trim();
    const now = toTimestampString(new Date());
    const previous = workspace.activeSchedule || {};
    const branch = branchMap[normalizeLookupId(context.branchId)] || {};

    return {
        ...previous,
        source: 'collections_followup',
        purpose: getSchedulePurposeLabel(scheduleStatus),
        schedule_status: scheduleStatus,
        schedule_status_key: scheduleSlug(scheduleStatus),
        status: options.status || 'Active',
        trial_schedule: true,
        return_call: returnCall,
        schedule_date: scheduleDate,
        schedule_time: scheduleTime,
        followup_date: String(document.getElementById('collectorFollowupDate')?.value || scheduleDate || '').trim(),
        collection_time: String(document.getElementById('collectorCollectionTime')?.value || scheduleTime || '').trim(),
        invoice_no: invoiceNo,
        invoice_id: String(selectedInvoice.invoiceId || selectedInvoice.invoiceNo || '').trim(),
        invoice_month: selectedInvoice.monthYear || context.label || '',
        amount: Number(selectedInvoice.amount || selectedInvoice.billedAmount || workspace.branchBalance || 0),
        balance: Number(workspace.branchBalance || selectedInvoice.amount || 0),
        company_id: context.companyId || '',
        branch_id: context.branchId || '',
        contractmain_id: context.contractmainId || '',
        machine_id: context.machineId || '',
        customer: context.customer || selectedInvoice.company || '',
        branch: context.branchName || selectedInvoice.branch || branch.name || '',
        model: context.modelName || selectedInvoice.modelName || '',
        serial: displaySerialNumber(context.serialNumber || selectedInvoice.serialNumber || ''),
        assigned_to_id: assignee.id || '',
        assigned_to: assignee.name || getCurrentCollectorName(),
        assigned_role: assignee.role || '',
        assigned_messenger_id: /messenger|driver/i.test(assignee.role || '') ? assignee.id : '',
        assigned_messenger_name: /messenger|driver/i.test(assignee.role || '') ? assignee.name : '',
        assigned_technician_id: /technician|production/i.test(assignee.role || '') ? assignee.id : '',
        assigned_technician_name: /technician|production/i.test(assignee.role || '') ? assignee.name : '',
        committed_by: getCurrentCollectorName(),
        collector_name: getCurrentCollectorName(),
        followed_up_by: getCurrentCollectorName(),
        tech_id: assignee.id || '',
        tbl_schedule_id: options.tblScheduleId || previous.tbl_schedule_id || '',
        collection_address: String(document.getElementById('collectorProfileAddress')?.value || workspace.address || branch.address || '').trim(),
        contact_person: String(document.getElementById('collectorLastContact')?.value || document.getElementById('collectorProfileContactPerson')?.value || '').trim(),
        contact_number: String(document.getElementById('collectorContactNumber')?.value || document.getElementById('collectorProfileContactNumber')?.value || '').trim(),
        remarks: String(document.getElementById('collectorRemarks')?.value || previous.remarks || '').trim(),
        pcname: previous.pcname || 'PWA',
        area_group: previous.area_group || 'Area Group 1 (Unassigned)',
        updated_at: now,
        created_at: previous.created_at || now
    };
}

function buildCollectorLegacyScheduleRecord(workspace, masterRecord, scheduleId) {
    const context = workspace.context || {};
    const branch = branchMap[normalizeLookupId(context.branchId)] || {};
    const selectedInvoice = workspace.selectedInvoice || {};
    const taskTime = normalizeTimeInput(masterRecord.schedule_time || masterRecord.collection_time || '') || '08:00';
    const taskDateTime = `${masterRecord.schedule_date} ${taskTime.length === 5 ? `${taskTime}:00` : taskTime}`;
    const assigneeId = Number(masterRecord.assigned_to_id || masterRecord.tech_id || 0) || 0;
    const invoiceNo = String(masterRecord.invoice_no || selectedInvoice.invoiceNo || selectedInvoice.invoiceId || '').trim();
    const remarks = buildAddressText([
        masterRecord.remarks,
        invoiceNo ? `Collection for invoice ${invoiceNo}` : 'Collection schedule confirmed',
        masterRecord.return_call ? 'Return call: yes' : ''
    ]);

    return {
        id: Number(scheduleId),
        company_id: Number(context.companyId || selectedInvoice.companyId || 0) || 0,
        branch_id: Number(context.branchId || selectedInvoice.branchId || 0) || 0,
        area_id: Number(branch.area_id || 0) || 0,
        serial: Number(context.machineId || selectedInvoice.machineId || 0) || 0,
        caller: masterRecord.contact_person || '-',
        phone_number: masterRecord.contact_number || '',
        purpose_id: 2,
        task_datetime: taskDateTime,
        original_sched: taskDateTime,
        tech_id: assigneeId,
        assigned_to_id: assigneeId,
        assigned_to: masterRecord.assigned_to || '',
        assigned_role: masterRecord.assigned_role || '',
        assigned_messenger_id: Number(masterRecord.assigned_messenger_id || 0) || 0,
        assigned_messenger_name: masterRecord.assigned_messenger_name || '',
        assigned_technician_id: Number(masterRecord.assigned_technician_id || 0) || 0,
        assigned_technician_name: masterRecord.assigned_technician_name || '',
        trouble_id: 0,
        remarks,
        status: 1,
        isongoing: 0,
        date_finished: '0000-00-00 00:00:00',
        iscancel: 0,
        scheduled: 1,
        withcomplain: 0,
        withrequest: 0,
        super_urgent: masterRecord.return_call ? 1 : 0,
        request_origin: 'collections',
        request_serial_number: context.serialNumber || selectedInvoice.serialNumber || '',
        customer_request: remarks,
        contractmain_id: Number(context.contractmainId || selectedInvoice.contractmainId || 0) || 0,
        from_mobileapp: 1,
        bridge_updated_at: new Date().toISOString(),
        bridge_updated_by: 0,
        collectioninfo_id: Number(masterRecord.collection_id || 0) || 0,
        invoice_num: invoiceNo || 0,
        invoice_count: invoiceNo ? 1 : 0,
        amt_collected: 0,
        commitment_date: masterRecord.followup_date ? `${masterRecord.followup_date} 00:00:00` : '0000-00-00 00:00:00',
        committed_by: getCurrentCollectorName(),
        collocutor: masterRecord.contact_person || '',
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
        from_other_source: 0,
        oldest_invoice_age: 0,
        soa_status: 0,
        willsettle: 0,
        firebase_key: '',
        iscancelleddate: '',
        csr_status: 0,
        csr_remarks: '',
        meter_reading: 0,
        tl_status: 0,
        tl_remarks: '',
        shutdown_date: '0000-00-00 00:00:00',
        dev_remarks: '',
        collection_schedule_source: 'collections_modal',
        collection_schedule_doc_id: collectionScheduleDocId(context, selectedInvoice),
        collection_schedule_status: masterRecord.schedule_status || 'Confirmed'
    };
}

async function saveCollectorSchedule() {
    if (!currentCollectorWorkspace || isSavingCollectorSchedule) return;

    const statusNode = document.getElementById('collectorScheduleSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const context = currentCollectorWorkspace.context;
    const scheduleDate = String(document.getElementById('collectorScheduleDate')?.value || '').trim();
    let assignee = getCollectionAssignee();

    if (!scheduleDate) {
        if (statusNode) statusNode.textContent = 'Please choose a schedule date.';
        return;
    }

    if (!assignee.id) {
        if (statusNode) statusNode.textContent = 'Please assign a messenger or technician before saving.';
        return;
    }

    if (window.MargaScheduleConsolidation?.validateRequiredAssignment) {
        const assignment = MargaScheduleConsolidation.validateRequiredAssignment({
            staffId: assignee.id,
            staffName: assignee.name,
            activeStaffIds: collectionAssignableStaff.map((staff) => normalizeLookupId(staff.id)).filter(Boolean)
        });
        if (!assignment.ok) {
            if (statusNode) statusNode.textContent = assignment.reason;
            return;
        }
    }

    let consolidationFields = {};
    if (window.MargaScheduleConsolidation) {
        const consolidation = await MargaScheduleConsolidation.resolveAssignment({
            moduleName: 'collections',
            date: scheduleDate,
            taskDatetime: `${scheduleDate} 08:00:00`,
            companyId: context.companyId || selectedInvoice.companyId,
            branchId: context.branchId || selectedInvoice.branchId,
            staffId: assignee.id,
            staffName: assignee.name,
            purposeId: 2,
            scheduleId: currentCollectorWorkspace.activeSchedule?.tbl_schedule_id || currentCollectorWorkspace.activeSchedule?.schedule_id || '',
            currentDocId: currentCollectorWorkspace.activeSchedule?._docId || '',
            customerName: context.companyName || selectedInvoice.customer || selectedInvoice.accountLabel || '',
            getStaffName: (staffId) => collectionAssignableStaff.find((staff) => normalizeLookupId(staff.id) === normalizeLookupId(staffId))?.name || employeeLookupMap.get(normalizeLookupId(staffId)) || `Staff #${staffId}`
        });
        if (!consolidation.ok) return;
        consolidationFields = consolidation.scheduleFields || {};
        if (normalizeLookupId(consolidation.staffId) !== normalizeLookupId(assignee.id)) {
            const nextId = normalizeLookupId(consolidation.staffId);
            const staff = collectionAssignableStaff.find((item) => normalizeLookupId(item.id) === nextId) || null;
            assignee = {
                id: nextId,
                name: staff?.name || employeeLookupMap.get(nextId) || `Staff #${nextId}`,
                role: staff?.role || ''
            };
            const select = document.getElementById('collectorScheduleAssignee');
            if (select) select.value = nextId;
        }
    }

    isSavingCollectorSchedule = true;
    if (statusNode) statusNode.textContent = 'Saving to Master Schedule...';

    try {
        const existingScheduleId = Number(currentCollectorWorkspace.activeSchedule?.tbl_schedule_id || currentCollectorWorkspace.activeSchedule?.schedule_id || 0) || 0;
        const scheduleId = existingScheduleId || await allocateNextNumericId('tbl_schedule');
        const docId = collectionScheduleDocId(context, selectedInvoice);
        const record = buildCollectorScheduleRecord(currentCollectorWorkspace, {
            scheduleDate,
            status: 'Active',
            assignee,
            tblScheduleId: scheduleId
        });
        const legacySchedule = buildCollectorLegacyScheduleRecord(currentCollectorWorkspace, record, scheduleId);
        Object.assign(legacySchedule, consolidationFields);
        const legacyFields = {};
        Object.entries(legacySchedule).forEach(([key, value]) => {
            if (!key.startsWith('_')) legacyFields[key] = toFirestoreWriteValue(value);
        });
        await firestoreSetDocument('tbl_schedule', scheduleId, legacyFields);

        const fields = {};
        Object.entries({ ...record, tbl_schedule_id: scheduleId, schedule_id: scheduleId }).forEach(([key, value]) => {
            if (!key.startsWith('_')) fields[key] = toFirestoreWriteValue(value);
        });
        try {
            await firestoreSetDocument('marga_master_schedule', docId, fields);
        } catch (mirrorError) {
            console.warn('Saved tbl_schedule but could not mirror marga_master_schedule:', mirrorError);
        }

        currentCollectorWorkspace.activeSchedule = { ...record, tbl_schedule_id: scheduleId, schedule_id: scheduleId, _docId: docId };
        upsertCollectionScheduleEntry({ ...record, tbl_schedule_id: scheduleId, schedule_id: scheduleId, _docId: docId });

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(currentCollectorWorkspace);
        bindCollectorPaymentForm();

        const refreshedStatusNode = document.getElementById('collectorScheduleSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = `Saved to Master Schedule #${scheduleId}.`;
        recomputeFilteredInvoices();
    } catch (error) {
        console.error('Failed to save collection schedule:', error);
        if (statusNode) statusNode.textContent = `Schedule save failed: ${error.message || 'Please try again.'}`;
    } finally {
        isSavingCollectorSchedule = false;
    }
}

async function cancelCollectorSchedule() {
    if (!currentCollectorWorkspace || isSavingCollectorSchedule) return;

    const statusNode = document.getElementById('collectorScheduleSaveStatus');
    const selectedInvoice = currentCollectorWorkspace.selectedInvoice;
    const context = currentCollectorWorkspace.context;
    const activeSchedule = currentCollectorWorkspace.activeSchedule;

    if (!activeSchedule || String(activeSchedule.status || '').toLowerCase() === 'cancelled') {
        if (statusNode) statusNode.textContent = 'There is no active trial schedule to cancel.';
        return;
    }

    const docId = activeSchedule._docId || collectionScheduleDocId(context, selectedInvoice);
    const cancelled = {
        ...activeSchedule,
        status: 'Cancelled',
        cancelled_at: toTimestampString(new Date()),
        updated_at: toTimestampString(new Date()),
        cancelled_by: getCurrentCollectorName()
    };
    const fields = {};
    Object.entries(cancelled).forEach(([key, value]) => {
        if (!key.startsWith('_')) fields[key] = toFirestoreWriteValue(value);
    });

    isSavingCollectorSchedule = true;
    if (statusNode) statusNode.textContent = 'Cancelling schedule...';

    try {
        const scheduleId = Number(activeSchedule.tbl_schedule_id || activeSchedule.schedule_id || 0) || 0;
        if (scheduleId) {
            await firestoreSetDocument('tbl_schedule', scheduleId, {
                iscancel: toFirestoreWriteValue(1),
                status: toFirestoreWriteValue(0),
                iscancelleddate: toFirestoreWriteValue(toTimestampString(new Date())),
                collection_schedule_status: toFirestoreWriteValue('Cancelled')
            });
        }
        try {
            await firestoreSetDocument('marga_master_schedule', docId, fields);
        } catch (mirrorError) {
            console.warn('Cancelled tbl_schedule but could not mirror marga_master_schedule:', mirrorError);
        }
        currentCollectorWorkspace.activeSchedule = { ...cancelled, _docId: docId };
        collectionScheduleEntries = collectionScheduleEntries.filter((entry) => entry.docId !== docId && entry.invoiceKey !== String(activeSchedule.invoice_no || activeSchedule.invoice_id || '').trim());

        const content = document.getElementById('collectorCellContent');
        if (content) content.innerHTML = renderCollectorFollowupWorkspace(currentCollectorWorkspace);
        bindCollectorPaymentForm();

        const refreshedStatusNode = document.getElementById('collectorScheduleSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = scheduleId ? `Master Schedule #${scheduleId} cancelled.` : 'Trial schedule cancelled.';
        recomputeFilteredInvoices();
    } catch (error) {
        console.error('Failed to cancel collection schedule:', error);
        if (statusNode) statusNode.textContent = 'Cancel failed. Please try again.';
    } finally {
        isSavingCollectorSchedule = false;
    }
}

function toggleAnalyticsDashboard(forceValue = null) {
    analyticsDashboardVisible = typeof forceValue === 'boolean' ? forceValue : !analyticsDashboardVisible;

    const dashboard = document.getElementById('trend-dashboard');
    const button = document.getElementById('btnToggleAnalytics');

    dashboard?.classList.toggle('dashboard-hidden', !analyticsDashboardVisible);
    if (button) button.textContent = analyticsDashboardVisible ? 'Hide Analytics' : 'Analytics';
}

function renderTrendDashboard() {
    const trendData = computeMonthlyTrendData();
    renderTrendSummaryCards(trendData);
    renderTrendInsights(trendData);
    renderTrendStrip(trendData);
    renderTrendComparisonTable(trendData);
}

function getTodayScheduledInvoices() {
    const todayKey = toDateKey(new Date());
    return getConfirmedCollectionInvoicesForDate(todayKey);
}

function isConfirmedCollectionSchedule(entry) {
    const text = `${entry?.scheduleStatus || ''} ${entry?.scheduleStatusKey || ''} ${entry?.remarks || ''}`.toLowerCase();
    return /confirm|pick[\s-]?up|pickup|collect/.test(text) && !/promise/.test(text);
}

function isPromiseToPaySchedule(entry) {
    const text = `${entry?.scheduleStatus || ''} ${entry?.scheduleStatusKey || ''} ${entry?.remarks || ''}`.toLowerCase();
    return /promise|ptp|will pay|pay on|payment commitment/.test(text);
}

function isPaymentResolutionSchedule(entry) {
    const text = `${entry?.scheduleStatus || ''} ${entry?.scheduleStatusKey || ''} ${entry?.purpose || ''} ${entry?.remarks || ''}`.toLowerCase();
    return /service|trouble|machine|repair|payment hold|hold/.test(text);
}

function invoiceRowFromScheduleEntry(entry, fallbackLabel = 'Unlinked schedule') {
    const invoice = findInvoiceByKey(entry.invoiceKey) || null;
    return {
        ...(invoice || {}),
        invoiceKey: invoice?.invoiceKey || entry.invoiceKey,
        invoiceNo: invoice?.invoiceNo || entry.invoiceKey || '-',
        invoiceDate: invoice?.invoiceDate || null,
        dueDate: invoice?.dueDate || null,
        company: invoice?.company || entry.customer || fallbackLabel,
        branch: invoice?.branch || entry.branch || '',
        amount: Number(entry.amount || invoice?.amount || 0),
        age: Number(invoice?.age || 0),
        lastContactDays: invoice?.lastContactDays ?? null,
        lastContactDate: invoice?.lastContactDate || null,
        scheduledFollowupDate: entry.scheduleDate,
        scheduledRemarks: entry.remarks,
        scheduledContactPerson: entry.assignedTo,
        scheduledStatus: entry.scheduleStatus,
        scheduleTime: entry.scheduleTime,
        assignedTo: entry.assignedTo
    };
}

function uniqueScheduleRowsForDate(dateKey, predicate, fallbackLabel) {
    const seen = new Set();
    const rows = [];

    collectionScheduleEntries
        .filter((entry) => entry.scheduleDateKey === dateKey)
        .filter(predicate)
        .forEach((entry) => {
            const invoice = findInvoiceByKey(entry.invoiceKey) || null;
            const key = invoice?.invoiceKey || entry.invoiceKey || `${entry.customer}:${entry.branch}:${entry.scheduleDateKey}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push(invoiceRowFromScheduleEntry(entry, fallbackLabel));
        });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getConfirmedCollectionInvoicesForDate(dateKey) {
    return uniqueScheduleRowsForDate(dateKey, isConfirmedCollectionSchedule, 'Unlinked confirmed collection');
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
    const todayKey = toDateKey(new Date());
    const rows = uniqueScheduleRowsForDate(todayKey, isPromiseToPaySchedule, 'Unlinked promise');
    const seen = invoiceKeySetFromRows(rows);
    const historySeen = new Set();

    Object.values(collectionHistory)
        .flat()
        .forEach((entry) => {
            if (!entry || entry.followupDateKey !== todayKey) return;
            const statusLabel = getCollectionStatusLabel(entry.statusId || entry.scheduleStatus);
            const promiseText = `${entry.remarks || ''} ${statusLabel || ''}`.toLowerCase();
            if (!PROMISE_REMARK_PATTERN.test(promiseText) && !/promise|ptp|will pay|pay on|payment commitment/.test(promiseText)) return;

            const token = collectionHistoryToken(entry);
            if (historySeen.has(token)) return;
            historySeen.add(token);

            const invoice = findInvoiceByKey(entry.invoiceKey || entry.accountRef || entry.accountGroupRef);
            if (!invoice) return;
            if (seen.has(invoice.invoiceKey)) return;
            seen.add(invoice.invoiceKey);
            rows.push({
                ...invoice,
                scheduledFollowupDate: entry.followupDate,
                scheduledRemarks: entry.remarks,
                scheduledStatus: statusLabel || entry.scheduleStatus,
                scheduledContactPerson: entry.contactPerson
            });
        });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getTomorrowConfirmedCollectionInvoices() {
    return getConfirmedCollectionInvoicesForDate(getTodayInputValue(1));
}

function hasMeaningfulRemarks(value) {
    const text = String(value || '').trim().toLowerCase();
    return Boolean(text) && text !== 'no remarks' && text !== 'n/a' && text !== 'na' && text !== '-';
}

function getCollectorEntryStaffName(entry = {}) {
    const employeeId = normalizeLookupId(entry.employeeId || entry.assignedToId || '');
    const byId = employeeLookupMap.get(employeeId);
    const explicitName = String(
        entry.committedBy
        || entry.collectorName
        || entry.followedUpBy
        || entry.employeeName
        || byId
        || entry.createdBy
        || entry.updatedBy
        || entry.encodedBy
        || entry.insertedBy
        || ''
    ).trim();
    if (explicitName) return explicitName;

    const assignedName = String(entry.assignedTo || '').trim();
    const assignedRole = String(entry.assignedRole || roleForEmployeeId(entry.assignedToId) || roleForEmployeeName(assignedName) || '').trim();
    if (assignedName && !isFieldPickupRole(assignedRole)) return assignedName;
    return 'Unassigned';
}

function makeCollectorTodayRowFromSchedule(entry = {}, options = {}) {
    const invoiceRow = invoiceRowFromScheduleEntry(entry, options.fallbackLabel || 'Unlinked collection schedule');
    const key = invoiceRow.invoiceKey || entry.invoiceKey || entry.docId || `${entry.customer}:${entry.branch}:${entry.scheduleDateKey}`;
    return {
        key,
        staff: getCollectorEntryStaffName(entry),
        customer: invoiceRow.company || entry.customer || options.fallbackLabel || 'Unlinked collection schedule',
        branch: invoiceRow.branch || entry.branch || '',
        invoiceNo: invoiceRow.invoiceNo || entry.invoiceKey || '-',
        amount: Number(entry.amount || invoiceRow.amount || 0) || 0,
        remarks: entry.remarks || '',
        contactPerson: entry.assignedTo || '',
        computer: entry.computer || '',
        date: entry.scheduleDate,
        followupDate: entry.followupDate || entry.scheduleDate,
        invoiceKey: invoiceRow.invoiceKey || entry.invoiceKey || ''
    };
}

function getCollectorTodayCallRows() {
    const todayKey = toDateKey(new Date());
    const tomorrowKey = getTodayInputValue(1);
    const seen = new Set();
    const rows = [];

    Object.values(collectionHistory)
        .flat()
        .forEach((entry) => {
            if (!entry || entry.callDateKey !== todayKey) return;
            if (!hasMeaningfulRemarks(entry.remarks)) return;
            const token = collectionHistoryToken(entry);
            if (seen.has(token)) return;
            seen.add(token);
            const invoice = findInvoiceByKey(entry.invoiceKey || entry.accountRef || entry.accountGroupRef) || {};
            rows.push({
                key: token,
                staff: getCollectorEntryStaffName(entry),
                customer: invoice.company || 'Unlinked account',
                branch: invoice.branch || '',
                invoiceNo: invoice.invoiceNo || entry.invoiceKey || '-',
                amount: Number(entry.paymentAmount || invoice.amount || 0) || 0,
                remarks: entry.remarks || '',
                contactPerson: entry.contactPerson || '',
                computer: entry.computer || '',
                date: entry.callDate || entry.followupDate,
                followupDate: entry.followupDate || '',
                invoiceKey: invoice.invoiceKey || entry.invoiceKey || ''
            });
        });

    collectionScheduleEntries
        .filter((entry) => hasMeaningfulRemarks(entry.remarks))
        .filter((entry) => {
            const updatedKey = toDateKey(entry.updatedAt);
            if (updatedKey === todayKey) return true;
            if (entry.scheduleDateKey === todayKey) return true;
            return entry.scheduleDateKey === tomorrowKey && isConfirmedCollectionSchedule(entry);
        })
        .forEach((entry) => {
            const row = makeCollectorTodayRowFromSchedule(entry, { fallbackLabel: 'Unlinked schedule remark' });
            const token = `schedule:${entry.docId || row.key}:${entry.remarks || ''}`;
            if (seen.has(token)) return;
            seen.add(token);
            rows.push(row);
        });

    return rows.sort((a, b) => String(a.staff).localeCompare(String(b.staff)) || Number(b.amount || 0) - Number(a.amount || 0));
}

function getCollectorTodayConfirmedRows() {
    const todayKey = toDateKey(new Date());
    const tomorrowKey = getTodayInputValue(1);
    const seen = new Set();
    const rows = [];

    Object.values(collectionHistory)
        .flat()
        .forEach((entry) => {
            if (!entry || entry.callDateKey !== todayKey || entry.followupDateKey !== tomorrowKey) return;
            if (!hasMeaningfulRemarks(entry.remarks)) return;
            const statusLabel = getCollectionStatusLabel(entry.statusId || entry.scheduleStatus);
            const confirmText = `${entry.remarks || ''} ${statusLabel || ''} ${entry.scheduleStatus || ''}`.toLowerCase();
            if (!/confirm|pick[\s-]?up|pickup|collect/.test(confirmText) || /promise/.test(confirmText)) return;
            const invoice = findInvoiceByKey(entry.invoiceKey || entry.accountRef || entry.accountGroupRef) || {};
            const key = invoice.invoiceKey || entry.invoiceKey || entry.accountRef || entry.accountGroupRef || collectionHistoryToken(entry);
            if (seen.has(key)) return;
            seen.add(key);
            rows.push({
                key,
                staff: getCollectorEntryStaffName(entry),
                customer: invoice.company || 'Unlinked confirmed collection',
                branch: invoice.branch || '',
                invoiceNo: invoice.invoiceNo || entry.invoiceKey || '-',
                amount: Number(entry.paymentAmount || invoice.amount || 0) || 0,
                remarks: entry.remarks || '',
                contactPerson: entry.contactPerson || '',
                computer: entry.computer || '',
                date: entry.followupDate,
                followupDate: entry.followupDate || '',
                invoiceKey: invoice.invoiceKey || entry.invoiceKey || ''
            });
        });

    collectionScheduleEntries
        .filter((entry) => entry.scheduleDateKey === tomorrowKey)
        .filter(isConfirmedCollectionSchedule)
        .forEach((entry) => {
            const row = makeCollectorTodayRowFromSchedule(entry, { fallbackLabel: 'Unlinked confirmed collection' });
            if (seen.has(row.key)) return;
            seen.add(row.key);
            rows.push(row);
        });

    return rows.sort((a, b) => String(a.staff).localeCompare(String(b.staff)) || Number(b.amount || 0) - Number(a.amount || 0));
}

function buildCollectorTodayStaffSummary(rows = []) {
    const byStaff = new Map();
    rows.forEach((row) => {
        const staff = String(row.staff || 'Unassigned').trim() || 'Unassigned';
        if (!byStaff.has(staff)) byStaff.set(staff, { staff, count: 0, amount: 0, rows: [] });
        const group = byStaff.get(staff);
        group.count += 1;
        group.amount += Number(row.amount || 0) || 0;
        group.rows.push(row);
    });
    return Array.from(byStaff.values()).sort((a, b) => b.count - a.count || b.amount - a.amount || a.staff.localeCompare(b.staff));
}

function getCollectorTodaySummaryRows(type) {
    return type === 'confirmed' ? getCollectorTodayConfirmedRows() : getCollectorTodayCallRows();
}

function renderCollectorTodayStaffSummary(type) {
    const groups = buildCollectorTodayStaffSummary(getCollectorTodaySummaryRows(type));
    if (!groups.length) {
        return '<div class="collection-followup-empty">No staff rows found for this summary yet.</div>';
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table collector-total-detail-table">
                <thead>
                    <tr>
                        <th>Staff</th>
                        <th>${type === 'confirmed' ? 'Confirmed' : 'Calls'}</th>
                        <th>Amount</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    ${groups.map((group) => `
                        <tr>
                            <td>${escapeHtml(group.staff)}</td>
                            <td class="text-right">${escapeHtml(group.count.toLocaleString())}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(group.amount))}</td>
                            <td><button type="button" class="btn btn-secondary btn-sm collector-today-staff-open" data-summary-type="${escapeHtml(type)}" data-staff="${escapeHtml(group.staff)}">Open</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCollectorTodayStaffDetails(type, staffName) {
    const rows = getCollectorTodaySummaryRows(type).filter((row) => String(row.staff || 'Unassigned') === staffName);
    if (!rows.length) {
        return '<div class="collection-followup-empty">No detail rows found for this staff member.</div>';
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table collector-total-detail-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Branch / Dept</th>
                        <th>Invoice</th>
                        <th>${type === 'confirmed' ? 'Confirmed Amount' : 'Amount'}</th>
                        <th>${type === 'confirmed' ? 'Collection Date' : 'Call Date'}</th>
                        <th>Next Follow-up</th>
                        <th>Computer</th>
                        <th>Remarks</th>
                        <th>Open</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.customer || '-')}</td>
                            <td>${escapeHtml(row.branch || '-')}</td>
                            <td>${escapeHtml(row.invoiceNo || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount || 0))}</td>
                            <td>${escapeHtml(formatDate(row.date))}</td>
                            <td>${escapeHtml(formatDate(row.followupDate))}</td>
                            <td>${escapeHtml(row.computer || '-')}</td>
                            <td>${escapeHtml(row.remarks || '-')}</td>
                            <td>${row.invoiceKey ? `<button type="button" class="btn btn-secondary btn-sm collector-today-invoice-open" data-invoice-key="${escapeHtml(row.invoiceKey)}">Open</button>` : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCollectorTodayAllDetails(type, rows = []) {
    if (!rows.length) {
        return '<div class="collection-followup-empty">No call detail rows found.</div>';
    }

    return `
        <div class="collection-followup-table-wrap">
            <table class="collection-followup-table collector-total-detail-table">
                <thead>
                    <tr>
                        <th>Staff</th>
                        <th>Customer</th>
                        <th>Branch / Dept</th>
                        <th>Invoice</th>
                        <th>Amount</th>
                        <th>Next Follow-up</th>
                        <th>Computer</th>
                        <th>Remarks</th>
                        <th>Open</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.staff || 'Unassigned')}</td>
                            <td>${escapeHtml(row.customer || '-')}</td>
                            <td>${escapeHtml(row.branch || '-')}</td>
                            <td>${escapeHtml(row.invoiceNo || '-')}</td>
                            <td class="text-right">${escapeHtml(formatCurrency(row.amount || 0))}</td>
                            <td>${escapeHtml(formatDate(row.followupDate))}</td>
                            <td>${escapeHtml(row.computer || '-')}</td>
                            <td>${escapeHtml(row.remarks || '-')}</td>
                            <td>${row.invoiceKey ? `<button type="button" class="btn btn-secondary btn-sm collector-today-invoice-open" data-invoice-key="${escapeHtml(row.invoiceKey)}">Open</button>` : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderCollectorTodaySummaryModalContent(type, rows = []) {
    const summaryTitle = type === 'confirmed' ? 'Staff Confirmed Collections' : 'Staff Call Counts';
    const detailTitle = type === 'confirmed' ? 'Confirmed Collection Details' : 'Call Remarks Details';
    return `
        <div class="collection-followup-panel-title">${escapeHtml(summaryTitle)}</div>
        ${renderCollectorTodayStaffSummary(type)}
        <div class="collection-followup-panel-title" style="margin-top:16px;">${escapeHtml(detailTitle)}</div>
        ${renderCollectorTodayAllDetails(type, rows)}
    `;
}

function updateCollectorTodaySummaryCard() {
    const confirmedRows = getCollectorTodayConfirmedRows();
    const callRows = getCollectorTodayCallRows();
    const confirmedAmount = confirmedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const confirmedCountNode = document.getElementById('collectorTodayConfirmedCount');
    const confirmedAmountNode = document.getElementById('collectorTodayConfirmedAmount');
    const callCountNode = document.getElementById('collectorTodayCallCount');
    if (confirmedCountNode) confirmedCountNode.textContent = confirmedRows.length.toLocaleString();
    if (confirmedAmountNode) confirmedAmountNode.textContent = `Tomorrow collection: ${formatCurrencyShort(confirmedAmount)}`;
    if (callCountNode) callCountNode.textContent = callRows.length.toLocaleString();
}

function openCollectorTodaySummary(type = 'confirmed') {
    const safeType = type === 'calls' ? 'calls' : 'confirmed';
    const modal = document.getElementById('collectorTotalModal');
    const title = document.getElementById('collectorTotalTitle');
    const subtitle = document.getElementById('collectorTotalSubtitle');
    const content = document.getElementById('collectorTotalContent');
    if (!modal || !title || !subtitle || !content) return;

    const rows = getCollectorTodaySummaryRows(safeType);
    const amount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    title.textContent = safeType === 'confirmed' ? 'Today Confirmed Collections' : 'Total Calls Today';
    subtitle.textContent = safeType === 'confirmed'
        ? `${rows.length.toLocaleString()} confirmed for tomorrow collection • ${formatCurrency(amount)}`
        : `${rows.length.toLocaleString()} call(s) with remarks today`;
    content.innerHTML = renderCollectorTodaySummaryModalContent(safeType, rows);
    bindCollectorTodaySummaryButtons(content);
    modal.classList.remove('hidden');
}

function openCollectorTodayStaffDetails(type = 'confirmed', staffToken = '') {
    const safeType = type === 'calls' ? 'calls' : 'confirmed';
    const staffName = decodeURIComponent(String(staffToken || '')).trim() || 'Unassigned';
    const modal = document.getElementById('collectorTotalModal');
    const title = document.getElementById('collectorTotalTitle');
    const subtitle = document.getElementById('collectorTotalSubtitle');
    const content = document.getElementById('collectorTotalContent');
    if (!modal || !title || !subtitle || !content) return;

    const rows = getCollectorTodaySummaryRows(safeType).filter((row) => String(row.staff || 'Unassigned') === staffName);
    const amount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    title.textContent = staffName;
    subtitle.textContent = safeType === 'confirmed'
        ? `${rows.length.toLocaleString()} confirmed collection(s) • ${formatCurrency(amount)}`
        : `${rows.length.toLocaleString()} call(s) with remarks`;
    content.innerHTML = renderCollectorTodayStaffDetails(safeType, staffName);
    bindCollectorTodaySummaryButtons(content);
    modal.classList.remove('hidden');
}

function bindCollectorTodaySummaryButtons(root = document) {
    root.querySelectorAll('.collector-today-staff-open').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            openCollectorTodayStaffDetails(button.dataset.summaryType || 'confirmed', encodeURIComponent(button.dataset.staff || 'Unassigned'));
        });
    });

    root.querySelectorAll('.collector-today-invoice-open').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            const invoiceKey = button.dataset.invoiceKey || '';
            closeCollectorTotalModal();
            viewInvoiceDetail(invoiceKey);
        });
    });
}

function getPendingResolutionInvoices() {
    const seen = new Set();
    const rows = [];

    collectionScheduleEntries
        .filter(isPaymentResolutionSchedule)
        .forEach((entry) => {
            const invoice = findInvoiceByKey(entry.invoiceKey) || null;
            const key = invoice?.invoiceKey || entry.invoiceKey || `${entry.customer}:${entry.branch}:${entry.scheduleDateKey}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push(invoiceRowFromScheduleEntry(entry, 'Unlinked payment blocker'));
        });

    rows.sort((a, b) => b.amount - a.amount);
    return rows;
}

function getCollectorActivityToday() {
    const todayKey = toDateKey(new Date());
    const byCollector = new Map();
    const seen = new Set();

    Object.values(collectionHistory)
        .flat()
        .forEach((entry) => {
            if (!entry || entry.callDateKey !== todayKey) return;
            if (!hasMeaningfulRemarks(entry.remarks)) return;
            if (!entry.followupDateKey) return;
            const token = collectionHistoryToken(entry);
            if (seen.has(token)) return;
            seen.add(token);
            const collector = getCollectorEntryStaffName(entry);
            if (!byCollector.has(collector)) {
                byCollector.set(collector, { collector, count: 0, promisedAmount: 0, confirmedAmount: 0 });
            }
            const row = byCollector.get(collector);
            row.count += 1;
            const amount = Number(entry.paymentAmount || 0) || 0;
            if (/promise/i.test(entry.remarks || '') || Number(entry.scheduleStatus || 0) >= 5) row.promisedAmount += amount;
            if (/confirm|pickup|pick up|collect/i.test(entry.remarks || '')) row.confirmedAmount += amount;
        });

    return Array.from(byCollector.values()).sort((a, b) => b.count - a.count || a.collector.localeCompare(b.collector));
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
    const tomorrowConfirmed = getTomorrowConfirmedCollectionInvoices();
    const staleUrgent = getUrgentNotCalledInvoices();
    const highValueDue = getHighValueDueThisWeekInvoices();
    const missingContact = getMissingContactInvoices();
    const pendingResolution = getPendingResolutionInvoices();

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
    setText('brief-tomorrow-confirmed-count', tomorrowConfirmed.length.toLocaleString());
    setText(
        'brief-tomorrow-confirmed-amount',
        `Amount: ${formatCurrencyShort(tomorrowConfirmed.reduce((sum, inv) => sum + inv.amount, 0))}`
    );
    setText('brief-pending-resolution-count', pendingResolution.length.toLocaleString());
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
                    <tr class="clickable-row" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(formatDate(inv.invoiceDate || inv.dueDate))}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td>${escapeHtml(inv.branch)}</td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
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
                    <tr class="clickable-row" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                        <td>#${escapeHtml(inv.invoiceNo)}</td>
                        <td>${escapeHtml(inv.company)}</td>
                        <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                        <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
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
                            <tr class="clickable-row" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td>${escapeHtml(inv.branch)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td class="amount">${escapeHtml(formatCurrency(inv.amount))}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
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
                            <tr class="clickable-row" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">
                                <td>#${escapeHtml(inv.invoiceNo)}</td>
                                <td>${escapeHtml(inv.company)}</td>
                                <td><span class="${escapeHtml(getAgeClass(inv.age))}">${escapeHtml(String(inv.age))}d</span></td>
                                <td>${escapeHtml(lastCall)}</td>
                                <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(inv.invoiceKey)}')">View</button></td>
                            </tr>
                        `;
                    })
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderCollectorActivityTable() {
    const container = document.getElementById('collector-activity-table');
    if (!container) return;

    const rows = getCollectorActivityToday();

    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-followup">No collector call movement recorded today.</div>';
        return;
    }

    container.innerHTML = `
        <table class="data-table mini-table">
            <thead>
                <tr>
                    <th>Collector</th>
                    <th>Calls With Movement</th>
                    <th>Promise Amount</th>
                    <th>Confirmed Amount</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        (row) => `
                    <tr>
                        <td>${escapeHtml(row.collector)}</td>
                        <td class="amount">${escapeHtml(row.count.toLocaleString())}</td>
                        <td class="amount">${escapeHtml(formatCurrency(row.promisedAmount))}</td>
                        <td class="amount">${escapeHtml(formatCurrency(row.confirmedAmount))}</td>
                    </tr>
                `
                    )
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
                            <tr class="${invoice.historyCount > 0 ? 'has-followup' : ''}" onclick="event.stopPropagation(); viewInvoiceDetail('${escapeHtml(invoice.invoiceKey)}')">
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

    currentDetailInvoice = invoice;
    detailInvoiceNo.textContent = invoice.invoiceNo;

    const history = getHistoryForInvoice(invoice.invoiceNo, invoice.invoiceId);
    const lastHistory = history.length > 0 ? history[0] : null;

    const lastRemarks = lastHistory ? lastHistory.remarks : 'No conversation logged yet.';
    const lastFollowup = lastHistory && lastHistory.followupDate ? formatDate(lastHistory.followupDate) : '-';
    const contactNumber = invoice.contactNumber || (lastHistory ? lastHistory.contactNumber : '') || '';
    const contactPerson = (lastHistory && hasMeaningfulContact(lastHistory.contactPerson) ? lastHistory.contactPerson : '').trim();
    const callHref = normalizePhone(contactNumber);
    const defaultFollowup = getTodayInputValue(1);

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
            <div class="detail-item"><label>Contact Number</label><span>${escapeHtml(contactNumber || 'No contact number')}</span></div>
            <div class="detail-item"><label>Quick Call</label><span>${callHref ? `<a href="tel:${escapeHtml(callHref)}">${escapeHtml(callHref)}</a>` : 'No dialable number'}</span></div>
        </div>

        <div class="detail-last-remark">
            <h4>Last Conversation Remark</h4>
            <p>${escapeHtml(lastRemarks)}</p>
        </div>

        <div class="detail-call-log">
            <h4>Call Update and Follow-up</h4>
            <div class="detail-form-grid">
                <div class="detail-form-group">
                    <label>Contact Number</label>
                    <input id="detailContactNumber" type="text" value="${escapeHtml(contactNumber)}" placeholder="09xx / landline">
                </div>
                <div class="detail-form-group">
                    <label>Contact Person</label>
                    <input id="detailContactPerson" type="text" value="${escapeHtml(contactPerson)}" placeholder="Person spoken to">
                </div>
                <div class="detail-form-group full">
                    <label>Conversation Remarks</label>
                    <textarea id="detailRemarksInput" placeholder="Write what happened in the call..."></textarea>
                </div>
                <div class="detail-form-group">
                    <label>Conversation Result</label>
                    <select id="detailConversationResult">${buildSelectOptions(CONVERSATION_RESULT_OPTIONS, getDefaultConversationResult(lastHistory))}</select>
                </div>
                <div class="detail-form-group">
                    <label>Promise To Pay</label>
                    <select id="detailPromiseToPay">${buildSelectOptions(PROMISE_TO_PAY_OPTIONS, getDefaultPromiseToPay(lastHistory))}</select>
                </div>
                <div class="detail-form-group">
                    <label>Promise Amount</label>
                    <input id="detailPromiseAmount" type="number" min="0" step="0.01" value="${escapeHtml(Number(lastHistory?.promiseToPayAmount || 0).toFixed(2))}">
                </div>
                <div class="detail-form-group">
                    <label>Promise Date</label>
                    <input id="detailPromiseDate" type="date" value="${escapeHtml(toDateKey(lastHistory?.promiseToPayDate) || '')}">
                </div>
                <div class="detail-form-group">
                    <label>Next Follow-up Date</label>
                    <input id="detailFollowupInput" type="date" value="${escapeHtml(defaultFollowup)}">
                </div>
                <div class="detail-form-group">
                    <label>Next Follow-up Time</label>
                    <select id="detailNextFollowupTime">${buildSelectOptions(NEXT_FOLLOWUP_TIME_OPTIONS, getDefaultFollowupTime(lastHistory))}</select>
                </div>
                <div class="detail-form-group">
                    <label>Issue Type</label>
                    <select id="detailIssueType">${buildSelectOptions(ISSUE_TYPE_OPTIONS, getDefaultIssueType(lastHistory))}</select>
                </div>
                <div class="detail-form-group">
                    <label>Issue Notes</label>
                    <input id="detailIssueNotes" type="text" list="detailIssueNoteSuggestions" value="${escapeHtml(lastHistory?.issueNotes || '')}">
                    <datalist id="detailIssueNoteSuggestions">${ISSUE_NOTE_SUGGESTIONS.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist>
                </div>
                <div class="detail-form-group">
                    <label>Schedule Type</label>
                    <select id="detailScheduleType">
                        <option value="0">Regular Follow-up</option>
                        <option value="5">Promise Due</option>
                        <option value="6">For Pickup</option>
                    </select>
                </div>
            </div>
            <div class="detail-form-actions">
                <button class="btn btn-primary" onclick="saveCollectionConversation()">Save Call Log</button>
                <span class="detail-save-status" id="detailSaveStatus">After saving, this history updates immediately.</span>
            </div>
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
                                    <div class="history-date">Phone: ${escapeHtml(item.contactNumber || '-')}</div>
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

async function saveCollectionConversation() {
    if (!currentDetailInvoice) return;
    if (isSavingConversation) return;

    const contactNumberInput = document.getElementById('detailContactNumber');
    const contactPersonInput = document.getElementById('detailContactPerson');
    const remarksInput = document.getElementById('detailRemarksInput');
    const followupInput = document.getElementById('detailFollowupInput');
    const scheduleInput = document.getElementById('detailScheduleType');
    const statusNode = document.getElementById('detailSaveStatus');

    const contactNumber = String(contactNumberInput?.value || '').trim();
    const contactPerson = String(contactPersonInput?.value || '').trim();
    const remarks = String(remarksInput?.value || '').trim();
    const followupDate = String(followupInput?.value || '').trim();
    const scheduleStatus = Number(scheduleInput?.value || 0);
    const conversationResult = String(document.getElementById('detailConversationResult')?.value || '').trim();
    const promiseToPay = String(document.getElementById('detailPromiseToPay')?.value || '').trim();
    const promiseAmount = Number(document.getElementById('detailPromiseAmount')?.value || 0) || 0;
    const promiseDate = String(document.getElementById('detailPromiseDate')?.value || '').trim();
    const nextFollowupTime = String(document.getElementById('detailNextFollowupTime')?.value || '').trim();
    const issueType = String(document.getElementById('detailIssueType')?.value || '').trim();
    const issueNotes = String(document.getElementById('detailIssueNotes')?.value || '').trim();

    if (!remarks) {
        if (statusNode) statusNode.textContent = 'Please enter conversation remarks before saving.';
        return;
    }

    if (!followupDate) {
        if (statusNode) statusNode.textContent = 'Please set a follow-up date.';
        return;
    }

    if (!conversationResult || !promiseToPay || !nextFollowupTime || !issueType) {
        if (statusNode) statusNode.textContent = 'Please complete Conversation Result, Promise To Pay, Next Follow-up Time, and Issue Type.';
        return;
    }

    if (PROMISE_DATE_REQUIRED_OPTIONS.has(promiseToPay) && !promiseDate) {
        if (statusNode) statusNode.textContent = 'Please set Promise To Pay Date for this payment schedule.';
        return;
    }

    isSavingConversation = true;
    if (statusNode) statusNode.textContent = 'Saving call log...';

    try {
        await firestoreCreate('tbl_collectionhistory', {
            invoice_num: { stringValue: String(currentDetailInvoice.invoiceNo || currentDetailInvoice.invoiceId || '') },
            invoice_id: { stringValue: String(currentDetailInvoice.invoiceId || currentDetailInvoice.invoiceNo || '') },
            remarks: { stringValue: remarks },
            contact_person: { stringValue: contactPerson || '-' },
            contact_number: { stringValue: contactNumber || '' },
            conversation_result: { stringValue: conversationResult },
            promise_to_pay: { stringValue: promiseToPay },
            promise_to_pay_amount: { doubleValue: promiseAmount },
            promise_to_pay_date: { stringValue: promiseDate },
            next_followup_date: { stringValue: followupDate },
            next_followup_time: { stringValue: nextFollowupTime },
            issue_type: { stringValue: issueType },
            issue_notes: { stringValue: issueNotes },
            collection_role_assignment: { stringValue: getCurrentCollectionRoleAssignment() },
            followed_up_by: { stringValue: getCurrentCollectorName() },
            collector_name: { stringValue: getCurrentCollectorName() },
            followup_datetime: { stringValue: `${followupDate} 00:00:00` },
            timestamp: { stringValue: toTimestampString(new Date()) },
            schedule_status: { integerValue: String(scheduleStatus) }
        });

        await loadCollectionHistory();

        const refreshedHistory = getHistoryForInvoice(currentDetailInvoice.invoiceNo, currentDetailInvoice.invoiceId);
        const lastHistory = refreshedHistory.length > 0 ? refreshedHistory[0] : null;

        currentDetailInvoice.history = refreshedHistory;
        currentDetailInvoice.historyCount = refreshedHistory.length;
        currentDetailInvoice.lastRemarks = lastHistory ? lastHistory.remarks : null;
        currentDetailInvoice.lastContactDate = lastHistory ? lastHistory.callDate : null;
        currentDetailInvoice.lastContactDays = currentDetailInvoice.lastContactDate
            ? Math.max(0, daysBetween(currentDetailInvoice.lastContactDate, new Date()))
            : null;
        currentDetailInvoice.nextFollowup = lastHistory ? lastHistory.followupDate : null;
        currentDetailInvoice.contactNumber = contactNumber || currentDetailInvoice.contactNumber || '';

        recomputeFilteredInvoices();
        collectorDashboardData = null;
        void renderCollectorDashboard({ recompute: true });
        viewInvoiceDetail(currentDetailInvoice.invoiceKey);
        const refreshedStatusNode = document.getElementById('detailSaveStatus');
        if (refreshedStatusNode) refreshedStatusNode.textContent = 'Saved. Call history updated.';
    } catch (error) {
        console.error('Failed to save collection conversation:', error);
        if (statusNode) statusNode.textContent = 'Save failed. Please try again.';
    } finally {
        isSavingConversation = false;
    }
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
    const collectorCellModal = document.getElementById('collectorCellModal');
    const collectorBranchModal = document.getElementById('collectorBranchModal');
    const collectorTotalModal = document.getElementById('collectorTotalModal');
    const collectorSoaPeriodModal = document.getElementById('collectorSoaPeriodModal');
    const receivePaymentModal = document.getElementById('receivePaymentModal');
    const welcomeModal = document.getElementById('welcomeModal');

    followupModal?.addEventListener('click', (event) => {
        if (event.target === followupModal) closeFollowupModal();
    });

    detailModal?.addEventListener('click', (event) => {
        if (event.target === detailModal) closeDetailModal();
    });

    collectorCellModal?.addEventListener('click', (event) => {
        if (event.target === collectorCellModal) closeCollectorCellModal();
    });

    collectorBranchModal?.addEventListener('click', (event) => {
        if (event.target === collectorBranchModal) closeCollectorBranchModal();
    });

    collectorTotalModal?.addEventListener('click', (event) => {
        if (event.target === collectorTotalModal) closeCollectorTotalModal();
    });

    collectorSoaPeriodModal?.addEventListener('click', (event) => {
        if (event.target === collectorSoaPeriodModal) closeCollectorSoaPeriodModal();
    });

    receivePaymentModal?.addEventListener('click', (event) => {
        if (event.target === receivePaymentModal) closeReceivePaymentModal();
    });

    welcomeModal?.addEventListener('click', (event) => {
        if (event.target === welcomeModal) closeWelcomeModal();
    });

    document.getElementById('receivePaymentInvoiceSearch')?.addEventListener('input', runReceivePaymentSearch);
    document.getElementById('receivePaymentAddBtn')?.addEventListener('click', () => {
        const match = receivePaymentState.searchResults[0]
            || findReceivePaymentInvoice(document.getElementById('receivePaymentInvoiceSearch')?.value || '');
        if (match) addReceivePaymentInvoice(match);
        else setReceivePaymentStatus('Search and select an unpaid invoice first.');
    });
    ['receivePaymentAmount', 'receivePaymentDeduction'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', updateReceivePaymentBalanceStatus);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeFollowupModal();
            closeDetailModal();
            closeCollectorCellModal();
            closeCollectorBranchModal();
            closeCollectorTotalModal();
            closeCollectorSoaPeriodModal();
            closeReceivePaymentModal();
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

function clearCollectionsResponseCache() {
    try {
        let removed = 0;
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (!key) continue;
            if (key.startsWith('marga_firestore_response_cache_v1') || key.startsWith('marga_firestore_cache_v1:')) {
                localStorage.removeItem(key);
                removed += 1;
            }
        }
        if (removed > 0) {
            console.info(`Collections cleared ${removed} cached API response(s) from local storage.`);
        }
    } catch (error) {
        console.warn('Unable to clear Collections response cache.', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    collectorMatrixBuildInProgress = false;
    clearCollectionsResponseCache();
    setupModalEvents();
    showRandomTip();
    initQuickAgeButtons();
    toggleAnalyticsDashboard(false);
    renderCollectionsCompareScorecard();
    document.getElementById('saveCollectionsSnapshotBtn')?.addEventListener('click', saveCollectionsCompareSnapshot);

    document.getElementById('collectorSearchInput')?.addEventListener('input', () => {
        queueCollectorMatrixFilterRender();
    });
    document.getElementById('collectorInvoiceSearchInput')?.addEventListener('input', () => {
        queueCollectorMatrixFilterRender();
        queueCollectorInvoiceSearchSupplement();
    });
    document.getElementById('collectorSortInput')?.addEventListener('change', () => {
        queueCollectorMatrixFilterRender();
    });
    document.getElementById('collectorTodayConfirmedBtn')?.addEventListener('click', () => {
        openCollectorTodaySummary('confirmed');
    });
    document.getElementById('collectorTodayCallsBtn')?.addEventListener('click', () => {
        openCollectorTodaySummary('calls');
    });

    document.getElementById('search-input')?.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') applyFilters();
    });

    ['filter-from-date', 'filter-to-date'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => {
            applyFilters();
        });
    });

    renderDeferredCollectionsWorkspaceNote();
    void loadCollectionWorkflowSettings().catch((error) => {
        console.warn('Collection workflow settings preload failed:', error);
    });
    const hydratedFromCache = await hydrateCollectorMatrixFromDeviceCache();
    if (!hydratedFromCache) {
        const noteNode = document.getElementById('collector-dashboard-note');
        if (noteNode) {
            noteNode.textContent = 'Loading saved month-to-month summary from server...';
        }
    }
    void refreshCollectorMatrixFromSnapshot({ quiet: true }).then((result) => {
        if (!result?.loaded && !collectorMatrixSnapshotLoaded) {
            renderCollectorMatrixEmptyState();
        }
        updateCollectorMatrixHeaderStatus();
    });
    updateCollectorMatrixHeaderStatus();
    if (lastLoadSucceeded) checkWelcomeModal();
});
