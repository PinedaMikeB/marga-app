if (!MargaAuth.requireAccess('hr')) {
    throw new Error('Unauthorized access to HR module.');
}

const WORK_LOCATIONS_COLLECTION = 'marga_hr_work_locations';
const EMPLOYEE_DEDUCTIONS_COLLECTION = 'marga_hr_employee_deductions';
const PAYROLL_DISBURSEMENTS_COLLECTION = 'marga_hr_payroll_disbursements';
const PAYROLL_ADJUSTMENTS_COLLECTION = 'marga_hr_attendance_adjustments';
const ACTIVE_EMPLOYEE_SUMMARY_DOC = 'hr_active_employee_summary_v1';
const OFFICE_MAX_METERS = 200;
const PRODUCTION_MAX_METERS = 200;
const CUSTOMER_SITE_MAX_METERS = 200;

const PAYROLL_ORGANIZATIONS = ['WOTG', 'Marga', 'Others'];
const PAYROLL_RATE_SOURCE = 'payroll 1st Period of May 2026.xlsx';
const PAYROLL_PRINT_COLUMNS = [
    ['number', 'No.'],
    ['name', 'employee'],
    ['semiMonthlyRate', 'semimrate'],
    ['dailyRate', 'daily_rate'],
    ['totalBasic', 'total_basic'],
    ['absences', 'absences'],
    ['otHours', 'ot_hours'],
    ['otPay', 'ot_pay'],
    ['allowance', 'allowance'],
    ['rdot', 'RDOT'],
    ['regularOt', 'Regular OT'],
    ['holidayPay', 'Holiday pay'],
    ['payAdjustment', 'Adjustment'],
    ['totalPay', 'total_pay'],
    ['utHours', 'ut_hours'],
    ['utDeduction', 'ut_deduction'],
    ['sss', 'sss'],
    ['mandatorySssProvident', 'mandatory sss provident fund'],
    ['phic', 'phic'],
    ['hdmf', 'hdmf'],
    ['minutesLate', 'minutes_late'],
    ['lateDeduction', 'late_deduction'],
    ['grossIncome', 'gross_income'],
    ['nontaxAllowance', 'Nontax allowance'],
    ['withholdingTax', 'withholding_tax'],
    ['taxRefund', 'tax_refund'],
    ['sssLoan', 'sss_loan'],
    ['coopLoan', 'coop_loan'],
    ['philhealthAdjustment', 'Philhealth adjustment'],
    ['bankLoan', 'Bank Loan'],
    ['cashAdvance', 'cash_adv'],
    ['pagibigLoan', 'Pagibig loan'],
    ['tshirt', 'T-shirt'],
    ['otherDeduction', 'OTHERS'],
    ['houseRental', 'A/R HOUSE RENTAL'],
    ['taxAdjustment', 'TAX Adjustment'],
    ['deductionAdjustment', 'Adjustment'],
    ['netSalary', 'net_salary']
];

const PAYROLL_DEDUCTION_PREFILL_FIELDS = [
    { type: 'cash_advance', amountKeys: ['payroll_cash_advance_per_payroll', 'payroll_cash_adv_per_payroll', 'payroll_cash_adv'], sourceLabel: 'Office', title: 'Cash Advance' },
    { type: 'sss_loan', amountKeys: ['payroll_sss_loan_per_payroll', 'payroll_sss_loan'], sourceLabel: 'SSS', title: 'SSS Loan' },
    { type: 'pagibig_loan', amountKeys: ['payroll_pagibig_loan_per_payroll', 'payroll_pagibig_loan'], sourceLabel: 'Pag-IBIG', title: 'Pag-IBIG Loan' },
    { type: 'bank_loan', amountKeys: ['payroll_bank_loan_per_payroll', 'payroll_bank_loan'], sourceLabel: 'Bank', title: 'Bank Loan' },
    { type: 'coop_loan', amountKeys: ['payroll_coop_loan_per_payroll', 'payroll_coop_loan'], sourceLabel: 'Coop', title: 'Coop Loan' }
];

const DEFAULT_WORK_LOCATIONS = [
    {
        id: 'havila-office',
        name: 'Havila Office',
        type: 'office',
        address: 'MARGA office / Havila, Antipolo',
        latitude: '',
        longitude: '',
        allowedMeters: 200,
        requiresPincode: true,
        isActive: true
    },
    {
        id: 'production-office',
        name: 'Production Office',
        type: 'production',
        address: '',
        latitude: '',
        longitude: '',
        allowedMeters: 200,
        requiresPincode: true,
        isActive: true
    }
];

const TYPE_LABELS = {
    office: 'Office',
    production: 'Production',
    customer_site: 'Customer Site',
    temporary_site: 'Temporary Site'
};

const HR_STATE = {
    employees: [],
    positions: new Map(),
    locations: [],
    fieldEvents: [],
    payrollAttendance: [],
    performanceSchedules: [],
    performanceAttendance: [],
    finishBlocks: [],
    closeRequests: [],
    performanceRows: [],
    performanceGroups: [],
    performanceTab: 'summary',
    selectedRecommendationKey: '',
    performanceStatus: new Map(),
    branches: new Map(),
    companies: new Map(),
    employeeDeductions: [],
    payrollAdjustments: [],
    payrollDisbursements: [],
    usingEmployeeSummary: false,
    employeeSummaryBuiltAt: '',
    fullEmployeeRosterLoaded: false,
    activeTab: 'employees',
    editingEmployeeId: '',
    employeeModalMode: 'edit',
    editingDeductionDocId: ''
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    if (user) {
        document.getElementById('userName').textContent = user.name || user.username || 'User';
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = String(user.name || user.username || 'U').charAt(0).toUpperCase();
    }
    initPayrollDateDefaults();
    initPayrollCutoffControls();
    const performanceDate = document.getElementById('performanceDateInput');
    if (performanceDate) performanceDate.value = todayDateKey();

    document.getElementById('refreshHrBtn').addEventListener('click', () => loadHrModule());
    document.getElementById('printPayrollBtn')?.addEventListener('click', () => {
        setActiveTab('payroll');
        window.print();
    });
    document.getElementById('exportPayrollPdfBtn')?.addEventListener('click', exportPayrollPdf);
    document.getElementById('confirmPayrollBtn')?.addEventListener('click', confirmPayrollRun);
    document.getElementById('payrollSample')?.addEventListener('change', (event) => {
        const select = event.target.closest('[data-payroll-organization]');
        if (select) savePayrollOrganizationDraft(select.dataset.payrollOrganization, select.value);
    });
    document.getElementById('payrollDateFromInput')?.addEventListener('change', refreshPayrollModel);
    document.getElementById('payrollDateToInput')?.addEventListener('change', refreshPayrollModel);
    document.getElementById('payrollCurrentCutoffBtn')?.addEventListener('click', () => {
        const current = recommendedPayrollPeriod(todayDateKey());
        setPayrollPeriodInputs(current);
        refreshPayrollModel();
    });
    performanceDate?.addEventListener('change', () => refreshPerformanceDate());
    document.querySelectorAll('[data-performance-tab]').forEach((button) => {
        button.addEventListener('click', () => setPerformanceTab(button.dataset.performanceTab));
    });
    document.querySelectorAll('.hr-tab').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    });
    document.getElementById('employeeSearch').addEventListener('input', renderEmployees);
    document.getElementById('employeeStatusFilter').addEventListener('change', handleEmployeeStatusFilterChange);
    document.getElementById('addEmployeeBtn').addEventListener('click', openNewEmployeeModal);
    document.querySelector('#hrEmployeesTable tbody').addEventListener('click', (event) => {
        const button = event.target.closest('[data-employee-view]');
        if (button) openEmployeeModal(button.dataset.employeeView);
    });
    document.getElementById('employeeModalOverlay').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCloseBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCancelBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalSaveBtn').addEventListener('click', saveEmployeeDetails);
    document.getElementById('employeeModalBrief')?.addEventListener('click', handleEmployeePhotoClick);
    document.getElementById('employeeModalBrief')?.addEventListener('change', handleEmployeePhotoChange);
    document.getElementById('employeeDeductionSaveBtn')?.addEventListener('click', saveEmployeeDeductionPlan);
    document.getElementById('employeeDeductionCreateSuggestionsBtn')?.addEventListener('click', createEmployeeDeductionSuggestions);
    document.getElementById('employeeDeductionResetBtn')?.addEventListener('click', resetEmployeeDeductionForm);
    document.getElementById('employeeDeductionPrefills')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-deduction-prefill]');
        if (button) applyEmployeeDeductionPrefill(button.dataset.deductionPrefill, button.dataset.deductionPrefillType);
    });
    document.querySelector('#employeeDeductionsTable tbody')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-deduction-edit]');
        if (button) openEmployeeDeductionEditor(button.dataset.deductionEdit);
    });
    document.getElementById('employeePrintSoaBtn')?.addEventListener('click', printEmployeeSoa);
    document.getElementById('performanceModalOverlay').addEventListener('click', closePerformanceModal);
    document.getElementById('performanceModalCloseBtn').addEventListener('click', closePerformanceModal);
    document.getElementById('performanceModalCloseFooterBtn').addEventListener('click', closePerformanceModal);
    document.querySelector('#hrPerformanceTable tbody').addEventListener('change', (event) => {
        const select = event.target.closest('[data-performance-status]');
        if (select) savePerformanceRowStatus(select.dataset.performanceStatus, select.value);
    });
    document.getElementById('hrPerformanceDashboard')?.addEventListener('click', (event) => {
        const viewButton = event.target.closest('[data-recommendation-view]');
        if (viewButton) {
            openRecommendationEvidence(viewButton.dataset.recommendationView);
        }
    });
    document.getElementById('locationType').addEventListener('change', updateMeterLimit);
    document.getElementById('allowedMeters').addEventListener('input', updateMeterLabel);
    document.getElementById('locationForm').addEventListener('submit', (event) => {
        event.preventDefault();
        saveLocationForm();
    });
    document.getElementById('newLocationBtn').addEventListener('click', () => resetLocationForm());
    document.getElementById('useCurrentLocationBtn').addEventListener('click', () => fillCurrentGps('latitude', 'longitude', 'formNotice'));
    document.getElementById('useEmployeeGpsBtn').addEventListener('click', () => fillCurrentGps('employeeLatitude', 'employeeLongitude', 'eligibilityResult'));
    document.getElementById('checkEligibilityBtn').addEventListener('click', previewEligibility);

    const initialTab = getRequestedHrTab();
    if (initialTab) setActiveTab(initialTab);

    loadHrModule();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function getRequestedHrTab() {
    try {
        const params = new URLSearchParams(window.location.search);
        const tab = String(params.get('tab') || '').trim().toLowerCase();
        return ['employees', 'time-records', 'payroll', 'performance', 'locations'].includes(tab) ? tab : '';
    } catch (error) {
        return '';
    }
}

function getRequestedHrTimeSubtab() {
    try {
        const params = new URLSearchParams(window.location.search);
        const subtab = String(params.get('subtab') || '').trim().toLowerCase();
        return ['records', 'adjustments'].includes(subtab) ? subtab : 'records';
    } catch (error) {
        return 'records';
    }
}

function getRequestedHrAdjustmentId() {
    try {
        const params = new URLSearchParams(window.location.search);
        return String(params.get('request_id') || '').trim();
    } catch (error) {
        return '';
    }
}

async function loadHrModule() {
    const status = document.getElementById('hrDirectoryStatus');
    status.textContent = 'Loading HR records...';
    try {
        const [summaryDoc, positions, locations, fieldEvents, employeeDeductions, payrollDisbursements, payrollAdjustments] = await Promise.all([
            MargaUtils.fetchDoc('tbl_app_settings', ACTIVE_EMPLOYEE_SUMMARY_DOC).catch(() => null),
            MargaUtils.fetchCollection('tbl_position', 200).catch(() => []),
            loadWorkLocations(),
            MargaUtils.fetchCollection('tbl_field_visit_events', 500).catch(() => []),
            MargaUtils.fetchCollection(EMPLOYEE_DEDUCTIONS_COLLECTION, 1000).catch(() => []),
            MargaUtils.fetchCollection(PAYROLL_DISBURSEMENTS_COLLECTION, 2000).catch(() => []),
            MargaUtils.fetchCollection(PAYROLL_ADJUSTMENTS_COLLECTION, 2000).catch(() => [])
        ]);
        const summaryEmployees = Array.isArray(summaryDoc?.employees) && summaryDoc.employees.every((row) => row && typeof row === 'object' && !Array.isArray(row))
            ? summaryDoc.employees.map((row) => ({ ...row }))
            : [];
        if (summaryEmployees.length) {
            if (summaryEmployees.length > 50) {
                const employees = await MargaUtils.fetchCollection('tbl_employee', 500);
                const payrollSeededEmployees = getPayrollSeededEmployees(employees);
                HR_STATE.employees = payrollSeededEmployees;
                HR_STATE.usingEmployeeSummary = false;
                HR_STATE.employeeSummaryBuiltAt = '';
                HR_STATE.fullEmployeeRosterLoaded = true;
                await persistActiveEmployeeSummary(payrollSeededEmployees);
            } else {
                HR_STATE.employees = summaryEmployees;
                HR_STATE.usingEmployeeSummary = true;
                HR_STATE.employeeSummaryBuiltAt = String(summaryDoc?.built_at || '');
                HR_STATE.fullEmployeeRosterLoaded = false;
            }
        } else {
            if (Array.isArray(summaryDoc?.employees) && summaryDoc.employees.length) {
                console.warn('HR summary cache is malformed; rebuilding from tbl_employee.', summaryDoc.employees.slice(0, 3));
            }
            const employees = await MargaUtils.fetchCollection('tbl_employee', 500);
            HR_STATE.employees = getPayrollSeededEmployees(employees);
            HR_STATE.usingEmployeeSummary = false;
            HR_STATE.employeeSummaryBuiltAt = '';
            HR_STATE.fullEmployeeRosterLoaded = true;
            await persistActiveEmployeeSummary(HR_STATE.employees);
        }
        HR_STATE.positions = new Map(positions.map((position) => [
            String(position.id || position._docId || ''),
            position
        ]));
        HR_STATE.locations = locations;
        HR_STATE.fieldEvents = fieldEvents;
        HR_STATE.employeeDeductions = employeeDeductions.map(normalizeEmployeeDeduction);
        HR_STATE.payrollAdjustments = Array.isArray(payrollAdjustments) ? payrollAdjustments : [];
        HR_STATE.payrollDisbursements = payrollDisbursements.map(normalizePayrollDisbursement);
        await loadPerformanceDateData(getPerformanceDate());
        await hydratePerformanceLookups(fieldEvents);
        status.textContent = HR_STATE.usingEmployeeSummary && HR_STATE.employeeSummaryBuiltAt
            ? `${HR_STATE.employees.length.toLocaleString()} active employee summary rows loaded.`
            : `${HR_STATE.employees.length.toLocaleString()} employee record(s) loaded.`;
        renderEmployees();
        mountHrTimeRecordsPane();
        renderPerformance();
        await refreshPayrollModel();
        renderLocations();
        resetLocationForm(HR_STATE.locations[0] || DEFAULT_WORK_LOCATIONS[0]);
        updateOverview();
    } catch (error) {
        console.error('HR module load failed:', error);
        status.textContent = `Unable to load HR records: ${error.message || error}`;
        renderPayrollModel();
    }
}

function setActiveTab(tab) {
    const next = ['employees', 'time-records', 'payroll', 'performance', 'locations'].includes(tab) ? tab : 'employees';
    HR_STATE.activeTab = next;
    document.querySelectorAll('.hr-tab').forEach((button) => {
        const active = button.dataset.tab === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('employeesPane').classList.toggle('open', next === 'employees');
    document.getElementById('timeRecordsPane').classList.toggle('open', next === 'time-records');
    document.getElementById('payrollPane').classList.toggle('open', next === 'payroll');
    document.getElementById('performancePane').classList.toggle('open', next === 'performance');
    document.getElementById('locationsPane').classList.toggle('open', next === 'locations');
    document.getElementById('locationValidatorPane').classList.toggle('open', next === 'locations');
}

function mountHrTimeRecordsPane() {
    const root = document.getElementById('hrTimeRecordsMount');
    const mount = window.MargaAttendanceTimeRecords?.mountHrPane;
    if (!root) return;
    if (typeof mount !== 'function' || !window.MargaPayrollCutoff) {
        root.innerHTML = '<p class="ops-subtext">Time records tools are not ready yet. Reload the page and try again.</p>';
        return;
    }
    mount(root, {
        employees: HR_STATE.employees,
        period: window.MargaPayrollCutoff.timeRecordsPayrollPeriod(window.MargaPayrollCutoff.todayDateKey()),
        initialSubtab: getRequestedHrTimeSubtab(),
        selectedRequestId: getRequestedHrAdjustmentId()
    });
}

function setPerformanceTab(tab) {
    const next = tab === 'details' ? 'details' : 'summary';
    HR_STATE.performanceTab = next;
    document.querySelectorAll('[data-performance-tab]').forEach((button) => {
        const active = button.dataset.performanceTab === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('performanceSummaryView')?.classList.toggle('open', next === 'summary');
    document.getElementById('performanceDetailsView')?.classList.toggle('open', next === 'details');
}

function getPerformanceDate() {
    return document.getElementById('performanceDateInput')?.value || todayDateKey();
}

async function refreshPerformanceDate() {
    document.getElementById('performanceStatus').textContent = 'Loading selected day performance...';
    HR_STATE.selectedRecommendationKey = '';
    await loadPerformanceDateData(getPerformanceDate());
    await hydratePerformanceLookups(HR_STATE.fieldEvents);
    renderPerformance();
}

function todayDateKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function firestoreValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    return { stringValue: String(value ?? '') };
}

async function runHrQuery(structuredQuery) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || (Array.isArray(payload) && payload[0]?.error)) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'HR query failed.');
    }
    return Array.isArray(payload)
        ? payload.map((row) => row.document).filter(Boolean).map((doc) => MargaUtils.parseFirestoreDoc(doc))
        : [];
}

async function queryHrDateRange(collectionId, fieldPath, start, end, limit = 2000) {
    return runHrQuery({
        from: [{ collectionId }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(start) } },
                    { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue(end) } }
                ]
            }
        },
        limit
    });
}

async function queryHrEquals(collectionId, fieldPath, value, limit = 2000) {
    return runHrQuery({
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: firestoreValue(value) } },
        limit
    });
}

async function loadPerformanceDateData(date) {
    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;
    const [schedules, attendance, finishBlocks, closeRequests] = await Promise.all([
        queryHrDateRange('tbl_schedule', 'task_datetime', start, end, 2500).catch(() => []),
        queryHrEquals('tbl_field_attendance', 'attendance_date', date, 500).catch(() => []),
        queryHrDateRange('tbl_field_finish_blocks', 'blocked_at', `${date}T00:00:00`, `${date}T23:59:59`, 1000).catch(() => []),
        queryHrEquals('tbl_schedule_close_requests', 'request_date', date, 1000).catch(() => [])
    ]);
    HR_STATE.performanceSchedules = schedules;
    HR_STATE.performanceAttendance = attendance;
    HR_STATE.finishBlocks = finishBlocks;
    HR_STATE.closeRequests = closeRequests;
}

async function loadWorkLocations() {
    try {
        const locations = await MargaUtils.fetchCollection(WORK_LOCATIONS_COLLECTION, 100);
        if (locations.length) return locations.map(normalizeLocation).sort(sortLocations);
    } catch (error) {
        console.warn('Work locations unavailable; using local defaults.', error);
    }
    return DEFAULT_WORK_LOCATIONS.map(normalizeLocation);
}

async function refreshPayrollModel() {
    const period = getPayrollPeriod();
    syncPayrollCutoffControlFromInputs();
    const live = getLivePayrollWindow(period);
    if (live.rangeStart && live.rangeEnd) {
        HR_STATE.payrollAttendance = await queryHrDateRange('tbl_field_attendance', 'attendance_date', live.rangeStart, live.rangeEnd, 2000).catch(() => []);
    } else {
        HR_STATE.payrollAttendance = [];
    }
    if (window.MargaAttendanceTimeRecords?.fetchAdjustments) {
        HR_STATE.payrollAdjustments = await window.MargaAttendanceTimeRecords.fetchAdjustments('').catch(() => HR_STATE.payrollAdjustments || []);
    } else {
        HR_STATE.payrollAdjustments = await MargaUtils.fetchCollection(PAYROLL_ADJUSTMENTS_COLLECTION, 2000).catch(() => HR_STATE.payrollAdjustments || []);
    }
    renderPayrollModel();
}

async function handleEmployeeStatusFilterChange() {
    const statusFilter = document.getElementById('employeeStatusFilter')?.value || 'active';
    if ((statusFilter === 'all' || statusFilter === 'inactive') && !HR_STATE.fullEmployeeRosterLoaded) {
        await ensureFullEmployeeRoster();
    }
    renderEmployees();
}

async function ensureFullEmployeeRoster() {
    if (HR_STATE.fullEmployeeRosterLoaded) return;
    const status = document.getElementById('hrDirectoryStatus');
    if (status) status.textContent = 'Loading full employee roster...';
    const employees = await MargaUtils.fetchCollection('tbl_employee', 500);
    HR_STATE.employees = employees;
    HR_STATE.fullEmployeeRosterLoaded = true;
    HR_STATE.usingEmployeeSummary = false;
    await persistActiveEmployeeSummary(employees);
    mountHrTimeRecordsPane();
}

function employeeSummaryRow(employee) {
    return {
        _docId: String(employee._docId || employee.id || '').trim(),
        id: String(employee.id || employee._docId || '').trim(),
        firstname: employee.firstname || '',
        lastname: employee.lastname || '',
        nickname: employee.nickname || '',
        email: employee.email || '',
        marga_login_email: employee.marga_login_email || '',
        username: employee.username || '',
        active: employee.active !== false,
        marga_active: employee.marga_active !== false,
        marga_account_active: employee.marga_account_active !== false,
        estatus: employee.estatus ?? '',
        mstatus: employee.mstatus ?? '',
        position_id: employee.position_id ?? '',
        position_name: employee.position_name || employee.position || employee.position_label || '',
        rate_type: employee.rate_type || employee.salary_type || '',
        monthly_salary: employee.monthly_salary ?? employee.monthly_rate ?? '',
        monthly_rate: employee.monthly_rate ?? employee.monthly_salary ?? '',
        semi_monthly_rate: employee.semi_monthly_rate ?? employee.semim_rate ?? '',
        semim_rate: employee.semim_rate ?? employee.semi_monthly_rate ?? '',
        daily_rate: employee.daily_rate ?? '',
        allowance: employee.allowance ?? '',
        bank_account_no: employee.bank_account_no || '',
        sss_no: employee.sss_no || employee.sss || '',
        philhealth_no: employee.philhealth_no || employee.philhealth || '',
        pagibig_no: employee.pagibig_no || employee.pagibig || '',
        tin_no: employee.tin_no || employee.tinnum || '',
        payroll_sequence: employee.payroll_sequence ?? '',
        payroll_sheet_employee_name: employee.payroll_sheet_employee_name || '',
        payroll_rate_source: employee.payroll_rate_source || '',
        payroll_rate_effective_cutoff: employee.payroll_rate_effective_cutoff || '',
        payroll_sss_amount: employee.payroll_sss_amount ?? '',
        sss_deduction: employee.sss_deduction ?? '',
        employee_sss_share: employee.employee_sss_share ?? '',
        payroll_mandatory_sss_provident: employee.payroll_mandatory_sss_provident ?? '',
        payroll_phic_amount: employee.payroll_phic_amount ?? '',
        phic_deduction: employee.phic_deduction ?? '',
        philhealth_deduction: employee.philhealth_deduction ?? '',
        employee_philhealth_share: employee.employee_philhealth_share ?? '',
        payroll_hdmf_amount: employee.payroll_hdmf_amount ?? '',
        hdmf_deduction: employee.hdmf_deduction ?? '',
        pagibig_deduction: employee.pagibig_deduction ?? '',
        employee_pagibig_share: employee.employee_pagibig_share ?? '',
        pagibig_ded: employee.pagibig_ded ?? '',
        payroll_withholding_tax: employee.payroll_withholding_tax ?? '',
        withholding_tax: employee.withholding_tax ?? '',
        payroll_nontax_allowance: employee.payroll_nontax_allowance ?? '',
        payroll_tax_refund: employee.payroll_tax_refund ?? '',
        payroll_philhealth_adjustment: employee.payroll_philhealth_adjustment ?? '',
        payroll_tshirt_deduction: employee.payroll_tshirt_deduction ?? '',
        payroll_other_deduction: employee.payroll_other_deduction ?? '',
        payroll_house_rental: employee.payroll_house_rental ?? '',
        payroll_tax_adjustment: employee.payroll_tax_adjustment ?? '',
        payroll_deduction_adjustment: employee.payroll_deduction_adjustment ?? '',
        payroll_cash_advance_per_payroll: employee.payroll_cash_advance_per_payroll ?? employee.payroll_cash_adv_per_payroll ?? employee.payroll_cash_adv ?? '',
        payroll_sss_loan_per_payroll: employee.payroll_sss_loan_per_payroll ?? employee.payroll_sss_loan ?? '',
        payroll_pagibig_loan_per_payroll: employee.payroll_pagibig_loan_per_payroll ?? employee.payroll_pagibig_loan ?? '',
        payroll_bank_loan_per_payroll: employee.payroll_bank_loan_per_payroll ?? employee.payroll_bank_loan ?? '',
        payroll_coop_loan_per_payroll: employee.payroll_coop_loan_per_payroll ?? employee.payroll_coop_loan ?? '',
        payroll_deduction_prefill_source: employee.payroll_deduction_prefill_source || '',
        payroll_deduction_prefill_cutoff: employee.payroll_deduction_prefill_cutoff || '',
        imagepath: employee.imagepath || '',
        profile_photo_url: employee.profile_photo_url || employee.profilePhotoUrl || '',
        profile_photo_path: employee.profile_photo_path || employee.profilePhotoPath || '',
        mobile: employee.mobile || employee.contact_number || '',
        birthdate: employee.birthdate || '',
        civil_status: employee.civil_status || '',
        address: employee.address || '',
        hire_date: employee.hire_date || employee.date_hired || '',
        emergency_contact_name: employee.emergency_contact_name || '',
        emergency_contact_phone: employee.emergency_contact_phone || '',
        hr_notes: employee.hr_notes || employee.notes || ''
    };
}

async function persistActiveEmployeeSummary(sourceEmployees = HR_STATE.employees) {
    const sourceRows = Array.isArray(sourceEmployees) ? sourceEmployees : [];
    const preserveSeededRoster = sourceRows.length > 0 && sourceRows.every((employee) => employee && hasSeededPayrollRate(employee));
    const activeEmployees = sourceRows
        .filter((employee) => preserveSeededRoster || MargaUtils.isOfficialActiveEmployee(employee))
        .map(employeeSummaryRow)
        .sort((left, right) => MargaUtils.getEmployeeFullName(left, '').localeCompare(MargaUtils.getEmployeeFullName(right, '')));
    const payload = {
        doc_type: 'hr_active_employee_summary',
        built_at: new Date().toISOString(),
        active_count: activeEmployees.length,
        employees: activeEmployees
    };
    await setDocument('tbl_app_settings', ACTIVE_EMPLOYEE_SUMMARY_DOC, payload);
    HR_STATE.employeeSummaryBuiltAt = payload.built_at;
    return payload;
}

function renderEmployees() {
    const tbody = document.querySelector('#hrEmployeesTable tbody');
    const query = String(document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('employeeStatusFilter').value;
    const usingSeededRoster = HR_STATE.employees.length > 0 && HR_STATE.employees.every((employee) => employee && hasSeededPayrollRate(employee));
    const rows = HR_STATE.employees
        .filter((employee) => {
            const isActive = usingSeededRoster ? true : MargaUtils.isOfficialActiveEmployee(employee);
            if (statusFilter === 'active' && !isActive) return false;
            if (statusFilter === 'inactive' && isActive) return false;
            if (!query) return true;
            return [
                employee.id,
                employee._docId,
                MargaUtils.getEmployeeFullName(employee, ''),
                getPositionLabel(employee),
                getSalaryRate(employee),
                getRateType(employee),
                getAllowance(employee),
                employee.email,
                employee.marga_login_email,
                employee.username
            ].some((value) => String(value || '').toLowerCase().includes(query));
        })
        .sort((left, right) => MargaUtils.getEmployeeFullName(left, '').localeCompare(MargaUtils.getEmployeeFullName(right, '')));

    tbody.innerHTML = rows.slice(0, 250).map((employee) => {
        const id = sanitize(employee.id || employee._docId || '');
        const name = sanitize(MargaUtils.getEmployeeFullName(employee, id));
        const email = sanitize(employee.email || employee.marga_login_email || employee.username || '-');
        const position = sanitize(getPositionLabel(employee));
        const salary = getSalaryRate(employee);
        const rateType = getRateType(employee);
        const allowance = getAllowance(employee);
        const active = usingSeededRoster ? true : MargaUtils.isOfficialActiveEmployee(employee);
        return `
            <tr>
                <td data-label="ID">${id || '-'}</td>
                <td data-label="Name"><strong>${name}</strong></td>
                <td data-label="Position">${position}</td>
                <td data-label="Rate Type">${sanitize(rateType || '-')}</td>
                <td data-label="Salary Rate">${sanitize(formatMoneyOrDash(salary))}</td>
                <td data-label="Allowance">${sanitize(formatMoneyOrDash(allowance))}</td>
                <td data-label="Email">${email}</td>
                <td data-label="Status"><span class="status-badge ${active ? 'success' : 'neutral'}">${active ? 'Active' : 'Inactive'}</span></td>
                <td data-label="Action"><button type="button" class="hr-text-btn" data-employee-view="${id}">View</button></td>
            </tr>
        `;
    }).join('');

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9">No employees match the current filter.</td></tr>';
    }

    const statusNote = HR_STATE.usingEmployeeSummary
        ? `Shown from active employee summary${HR_STATE.employeeSummaryBuiltAt ? ` · built ${new Date(HR_STATE.employeeSummaryBuiltAt).toLocaleString('en-PH')}` : ''}.`
        : 'Shown from live employee roster.';
    document.getElementById('hrDirectoryStatus').textContent = `${rows.length.toLocaleString()} employee(s) shown. ${statusNote}`;
    updateOverview();
}

function renderPerformance() {
    const tbody = document.querySelector('#hrPerformanceTable tbody');
    const activeEmployees = HR_STATE.employees.filter((employee) => MargaUtils.isOfficialActiveEmployee(employee));
    const rows = activeEmployees
        .filter(isFieldPerformanceEmployee)
        .map(buildPerformanceRow)
        .filter((row) => row.assignedCount > 0 || row.attendance || row.finishBlocks.length || row.events.length || row.closeRequests.length)
        .sort((left, right) => performanceSeverity(right) - performanceSeverity(left) || right.assignedCount - left.assignedCount || left.name.localeCompare(right.name));

    HR_STATE.performanceRows = rows;
    renderPerformanceDashboard(rows);
    renderPerformanceDetailsTable();
    document.getElementById('performanceStatus').textContent = `${getPerformanceDate()} performance summary. ${rows.length.toLocaleString()} field staff with activity, schedule, or attendance evidence.`;
}

function renderPerformanceDetailsTable() {
    const tbody = document.querySelector('#hrPerformanceTable tbody');
    const group = getSelectedPerformanceGroup();
    const rows = group ? group.rows : HR_STATE.performanceRows;
    tbody.innerHTML = rows.slice(0, 160).map((row) => {
        const rawId = String(row.employee.id || row.employee._docId || '');
        const evidence = buildPerformanceEvidence(row, group?.key || '').slice(0, 4);
        const statusKey = performanceDecisionKey(rawId, group?.key || 'all');
        return `
            <tr>
                <td data-label="Employee"><strong>${sanitize(row.name)}</strong></td>
                <td data-label="Role">${sanitize(row.role)}</td>
                <td data-label="Attendance">${sanitize(row.attendanceLabel)}</td>
                <td data-label="Workload">${row.finishedCount}/${row.assignedCount} finished · ${row.unfinishedCount} open</td>
                <td data-label="Evidence">${evidence.length ? evidence.map((item) => `<div>${sanitize(item)}</div>`).join('') : 'No detailed exception for selected recommendation.'}</td>
                <td data-label="Recommendation"><span class="hr-rec-badge ${sanitize(row.recommendationClass)}">${sanitize(group?.actionLabel || row.recommendation)}</span></td>
                <td data-label="Status">${renderPerformanceStatusSelect(statusKey)}</td>
            </tr>
        `;
    }).join('');

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7">${group ? 'No staff currently match this recommendation.' : 'No field performance records found for the selected date.'}</td></tr>`;
    }
}

function isFieldPerformanceEmployee(employee) {
    const role = getPositionLabel(employee).toLowerCase();
    return /field|technician|messenger|collector|collection|service|refiller|driver/.test(role);
}

function employeeKeys(employee) {
    return [
        employee.id,
        employee._docId,
        employee.email,
        employee.marga_login_email,
        employee.username,
        MargaUtils.getEmployeeFullName(employee, '')
    ].map(normalizeStaffKey).filter(Boolean);
}

function rowMatchesEmployee(row, keys) {
    const values = [
        row.tech_id,
        row.staff_id,
        row.employee_id,
        row.employeeId,
        row.requester_staff_id,
        row.staff_name,
        row.requester_name,
        row.staff,
        row.user_name
    ].map(normalizeStaffKey).filter(Boolean);
    return values.some((value) => keys.has(value));
}

function normalizeDbDateTime(value) {
    const text = String(value || '').trim();
    if (!text || /^0{4}-0{2}-0{2}/.test(text) || ['undefined', 'null', 'invalid date'].includes(text.toLowerCase())) return '';
    return text;
}

function isScheduleFinished(row) {
    return Boolean(normalizeDbDateTime(row.date_finished || row.field_time_out));
}

function timeFromDateTime(value) {
    const text = normalizeDbDateTime(value);
    const match = text.match(/(?:T|\s)(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : '';
}

function minutesAfterEight(value) {
    const time = timeFromDateTime(value);
    if (!time) return null;
    const [hour, minute] = time.split(':').map(Number);
    return (hour * 60 + minute) - (8 * 60);
}

function hasNumberValue(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
}

function purposeId(row) {
    return Number(row?.purpose_id || 0) || 0;
}

function buildPerformanceRow(employee) {
    const keySet = new Set(employeeKeys(employee));
    const date = getPerformanceDate();
    const schedules = HR_STATE.performanceSchedules.filter((row) => rowMatchesEmployee(row, keySet));
    const attendance = HR_STATE.performanceAttendance.find((row) => rowMatchesEmployee(row, keySet)) || null;
    const finishBlocks = HR_STATE.finishBlocks.filter((row) => rowMatchesEmployee(row, keySet));
    const closeRequests = HR_STATE.closeRequests.filter((row) => rowMatchesEmployee(row, keySet));
    const events = HR_STATE.fieldEvents
        .filter((event) => rowMatchesEmployee(event, keySet) && rowDateKey(event.occurred_at || event.created_at || event.timestamp || event.local_date) === date)
        .sort((left, right) => String(right.occurred_at || right.created_at || right.timestamp || '').localeCompare(String(left.occurred_at || left.created_at || left.timestamp || '')));
    const finished = schedules.filter(isScheduleFinished);
    const unfinished = schedules.filter((row) => !isScheduleFinished(row));
    const lateMinutes = minutesAfterEight(attendance?.time_in);
    const flags = [];
    if (schedules.length && !attendance) flags.push('No attendance time in');
    if (lateMinutes !== null && lateMinutes > 0) flags.push(`Late ${lateMinutes} min`);
    if (unfinished.length) flags.push(`${unfinished.length} not finished`);
    if (finishBlocks.length) flags.push(`${finishBlocks.length} blocked finish`);
    const missingWork = finished.filter((row) => purposeId(row) === 5 && !String(row.field_work_notes || '').trim()).length;
    const missingBillingMeter = finished.filter((row) => [1, 8].includes(purposeId(row)) && !hasNumberValue(row.field_present_meter || row.meter_reading)).length;
    const missingCollection = finished.filter((row) => purposeId(row) === 2 && !hasNumberValue(row.field_collection_payment_amount)).length;
    const missingDelivery = finished.filter((row) => [3, 4].includes(purposeId(row)) && !String(row.field_delivery_details || '').trim()).length;
    if (missingWork) flags.push(`${missingWork} no work notes`);
    if (missingBillingMeter) flags.push(`${missingBillingMeter} no billing meter`);
    if (missingCollection) flags.push(`${missingCollection} no collection details`);
    if (missingDelivery) flags.push(`${missingDelivery} no delivery details`);
    const recommendation = recommendPerformance({ flags, schedules, unfinished, finishBlocks, lateMinutes, attendance });
    return {
        employee,
        name: MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || ''),
        role: getPositionLabel(employee),
        schedules,
        assignedCount: schedules.length,
        finishedCount: finished.length,
        unfinishedCount: unfinished.length,
        attendance,
        attendanceLabel: attendance ? `${timeFromDateTime(attendance.time_in) || 'No time'}${lateMinutes > 0 ? ` · late ${lateMinutes}m` : ' · on time'}` : (schedules.length ? 'No time in' : 'No schedule'),
        lateMinutes,
        finishBlocks,
        closeRequests,
        events,
        flags,
        recommendation: recommendation.label,
        recommendationClass: recommendation.className
    };
}

function rowDateKey(value) {
    const text = String(value || '').trim();
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
}

function recommendPerformance({ flags, schedules, unfinished, finishBlocks, lateMinutes, attendance }) {
    if ((schedules.length && !attendance) || finishBlocks.length >= 3 || unfinished.length >= 5) return { label: 'For Memo', className: 'memo' };
    if (finishBlocks.length || unfinished.length >= 2 || (lateMinutes || 0) > 15) return { label: 'For Warning', className: 'warning' };
    if (flags.length) return { label: 'For Coaching', className: 'coaching' };
    return { label: 'OK', className: 'ok' };
}

function performanceSeverity(row) {
    return { memo: 4, warning: 3, coaching: 2, ok: 1 }[row.recommendationClass] || 0;
}

function renderPerformanceDashboard(rows) {
    const groups = buildPerformanceRecommendationGroups(rows);
    HR_STATE.performanceGroups = groups;
    if (HR_STATE.selectedRecommendationKey && !groups.some((group) => group.key === HR_STATE.selectedRecommendationKey)) {
        HR_STATE.selectedRecommendationKey = '';
    }
    const activeGroups = groups.filter((group) => group.rows.length);
    const actionCount = activeGroups.reduce((sum, group) => sum + group.rows.length, 0);
    document.getElementById('hrPerformanceDashboard').innerHTML = `
        <div class="hr-recommendation-board">
            <section class="hr-recommendation-lead">
                <span>${sanitize(getPerformanceDate())} Manager Recommendations</span>
                <h4>${activeGroups.length ? `${activeGroups.length} HR action area${activeGroups.length === 1 ? '' : 's'} for field staff` : 'No field discipline recommendation today'}</h4>
                <p>${activeGroups.length ? `${actionCount.toLocaleString()} staff evidence item(s) require HR review. Click a recommendation to see customer-level evidence before deciding. Production, collections, and billing performance rules can be added as their measurements are finalized.` : 'The selected day has no field attendance or execution pattern that needs HR action.'}</p>
            </section>
            <div class="hr-recommendation-stack">
                ${groups.map((group, index) => renderPerformanceRecommendationCard(group, index + 1)).join('')}
            </div>
        </div>
    `;
}

function buildPerformanceRecommendationGroups(rows) {
    const groups = [
        {
            key: 'no_attendance',
            severity: 'Memo review',
            actionLabel: 'Verbal counseling',
            title: 'Give verbal counseling for no official attendance time-in',
            rationale: 'Attendance time-in is the proof that the route started under company supervision. Without it, payroll, dispatch accountability, and field safety cannot be verified.',
            rows: rows.filter((row) => row.assignedCount > 0 && !row.attendance)
        },
        {
            key: 'late_attendance',
            severity: 'Warning review',
            actionLabel: 'Verbal counseling',
            title: 'Give verbal counseling for late field attendance after 8:00 AM',
            rationale: 'Late time-in delays the route and creates same-day pressure on billing, service, collection, and messenger commitments. Review exceptions before deciding discipline.',
            rows: rows.filter((row) => (row.lateMinutes || 0) > 0)
        },
        {
            key: 'low_accomplishment',
            severity: 'Warning review',
            actionLabel: 'Performance coaching',
            title: 'Coach staff with less than 50% route accomplishment',
            rationale: 'Low completion pushes work to the next day, increases customer follow-up, and hides whether the problem is routing, attendance, coordination, or field execution.',
            rows: rows.filter((row) => row.assignedCount >= 2 && (row.finishedCount / Math.max(row.assignedCount, 1)) < 0.5)
        },
        {
            key: 'blocked_finish',
            severity: 'Coaching review',
            actionLabel: 'App compliance coaching',
            title: 'Coach staff blocked from Mark Finished because required details were missing',
            rationale: 'A blocked finish means the staff tried to close work but the evidence was incomplete. This should be reviewed before accepting the schedule as finished.',
            rows: rows.filter((row) => row.finishBlocks.length)
        },
        {
            key: 'missing_execution',
            severity: 'Coaching review',
            actionLabel: 'Work execution counseling',
            title: 'Counsel staff with missing work execution, meter, payment, billing, or delivery details',
            rationale: 'Finished work without the required purpose-specific details weakens machine history, billing records, collection accountability, and delivery traceability.',
            rows: rows.filter((row) => row.flags.some((flag) => /no work notes|no billing meter|no collection details|no delivery details/i.test(flag)))
        },
        {
            key: 'open_work',
            severity: 'Manager follow-up',
            actionLabel: 'Route follow-up',
            title: 'Follow up staff with open schedules still not marked finished',
            rationale: 'Open schedules must be explained before tomorrow’s route is prepared so legitimate delays, unvisited customers, and app issues are separated.',
            rows: rows.filter((row) => row.unfinishedCount > 0)
        }
    ];

    return groups.map((group) => ({
        ...group,
        rows: group.rows.sort((left, right) => performanceSeverity(right) - performanceSeverity(left) || right.unfinishedCount - left.unfinishedCount || left.name.localeCompare(right.name))
    }));
}

function renderPerformanceRecommendationCard(group, number) {
    const names = group.rows.slice(0, 6).map((row) => row.name).join(', ');
    const extra = Math.max(group.rows.length - 6, 0);
    const nameText = group.rows.length ? `${names}${extra ? `, +${extra} more` : ''}` : 'None for selected date';
    const activeClass = HR_STATE.selectedRecommendationKey === group.key ? ' active' : '';
    const disabled = group.rows.length ? '' : ' disabled';
    return `
        <article class="hr-recommendation-card${activeClass}">
            <button type="button" class="hr-recommendation-main"${disabled} data-recommendation-view="${sanitize(group.key)}">
                <span>Recommendation ${number} · ${sanitize(group.severity)}</span>
                <strong>${sanitize(group.title)}</strong>
                <em>${group.rows.length.toLocaleString()} staff member${group.rows.length === 1 ? '' : 's'}</em>
                <p>${sanitize(nameText)}</p>
                <small>${sanitize(group.rationale)}</small>
            </button>
        </article>
    `;
}

function getSelectedPerformanceGroup() {
    if (!HR_STATE.selectedRecommendationKey) return null;
    return HR_STATE.performanceGroups.find((group) => group.key === HR_STATE.selectedRecommendationKey) || null;
}

function openRecommendationEvidence(key) {
    HR_STATE.selectedRecommendationKey = String(key || '');
    renderPerformanceDashboard(HR_STATE.performanceRows);
    renderPerformanceDetailsTable();
    setPerformanceTab('details');
}

function buildPerformanceEvidence(row, groupKey = '') {
    const contextLabel = (schedule) => {
        const context = resolveEventContext(schedule);
        const name = [context.company, context.branch].filter(Boolean).join(' / ');
        return name || schedule.customer_name || schedule.branch_name || schedule.id || schedule._docId || 'schedule';
    };
    if (groupKey === 'no_attendance') {
        return row.schedules.slice(0, 8).map((schedule, index) => `${index + 1}. ${contextLabel(schedule)} - failed to time in for assigned schedule.`);
    }
    if (groupKey === 'late_attendance') {
        return [`Official time-in ${timeFromDateTime(row.attendance?.time_in) || 'not recorded'} - late by ${row.lateMinutes || 0} minute(s).`];
    }
    if (groupKey === 'low_accomplishment') {
        const rate = row.assignedCount ? Math.round((row.finishedCount / row.assignedCount) * 100) : 0;
        return [
            `${row.finishedCount}/${row.assignedCount} finished (${rate}% accomplishment).`,
            ...row.schedules.filter((schedule) => !isScheduleFinished(schedule)).slice(0, 7).map((schedule, index) => `${index + 1}. ${contextLabel(schedule)} - still open.`)
        ];
    }
    if (groupKey === 'blocked_finish') {
        return row.finishBlocks.slice(0, 8).map((block, index) => `${index + 1}. ${block.reason || block.purpose_label || 'Mark Finished blocked because required details were incomplete.'}`);
    }
    if (groupKey === 'missing_execution') {
        return row.flags.filter((flag) => /no work notes|no billing meter|no collection details|no delivery details/i.test(flag));
    }
    if (groupKey === 'open_work') {
        return row.schedules.filter((schedule) => !isScheduleFinished(schedule)).slice(0, 8).map((schedule, index) => `${index + 1}. ${contextLabel(schedule)} - not marked finished.`);
    }
    return row.flags.length ? row.flags : ['No exception details for this selection.'];
}

function renderPerformanceStatusSelect(statusKey) {
    const current = HR_STATE.performanceStatus.get(statusKey) || 'pending';
    const options = [
        ['pending', 'Pending'],
        ['called', 'Called'],
        ['counseled', 'Counseled'],
        ['received_memo', 'Received memo'],
        ['suspended', 'Suspended'],
        ['not_applicable', 'Not applicable']
    ];
    return `
        <select class="hr-status-select" data-performance-status="${sanitize(statusKey)}">
            ${options.map(([value, label]) => `<option value="${sanitize(value)}"${current === value ? ' selected' : ''}>${sanitize(label)}</option>`).join('')}
        </select>
    `;
}

function performanceDecisionKey(employeeId, groupKey) {
    return `${getPerformanceDate()}::${groupKey || 'all'}::${employeeId}`;
}

function findPerformanceRowByEmployeeId(employeeId) {
    const id = String(employeeId || '').trim();
    return HR_STATE.performanceRows.find((row) => String(row.employee.id || row.employee._docId || '').trim() === id) || null;
}

function callPerformanceStaff(employeeId) {
    const row = findPerformanceRowByEmployeeId(employeeId);
    if (!row) return;
    const phone = String(firstPresent(row.employee, ['mobile', 'mobile_no', 'phone', 'contact_no', 'contact_number']) || '').trim();
    if (!phone) {
        alert(`No phone number found for ${row.name}.`);
        return;
    }
    window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
}

async function savePerformanceRowStatus(statusKey, status) {
    HR_STATE.performanceStatus.set(statusKey, status);
    const [, groupKey, employeeId] = String(statusKey || '').split('::');
    const group = HR_STATE.performanceGroups.find((item) => item.key === groupKey) || null;
    const row = findPerformanceRowByEmployeeId(employeeId);
    if (!row) return;
    const labels = {
        pending: 'Pending',
        called: 'Called',
        counseled: 'Counseled',
        received_memo: 'Received memo',
        suspended: 'Suspended',
        not_applicable: 'Not applicable'
    };
    try {
        const id = `hr_perf_${getPerformanceDate()}_${groupKey || 'all'}_${employeeId}_${Date.now()}`;
        await setDocument('tbl_hr_performance_actions', id, {
            date: getPerformanceDate(),
            recommendation_key: groupKey || 'all',
            recommendation_title: group?.title || row.recommendation,
            action: status,
            action_label: labels[status] || status,
            staff_id: employeeId,
            staff_name: row.name,
            staff_role: row.role,
            created_at: new Date().toISOString(),
            created_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
        });
    } catch (error) {
        console.error('Performance status failed:', error);
        alert(`Could not record status: ${error.message || error}`);
    }
}

function renderPayrollModel() {
    const sampleRows = buildSamplePayrollRows();
    const period = getPayrollPeriod();
    const cutoff = getPayrollCutoffProfile(period);
    const live = getLivePayrollWindow(period);
    const deductionRows = getPayrollDeductionRegister(period);
    const paymentSummaryMap = getPayrollDisbursementSummaryMap(period);
    const disbursements = getPayrollDisbursements(period);
    const totals = sampleRows.reduce((sum, row) => ({
        monthly: sum.monthly + row.monthlyRate,
        semiMonthly: sum.semiMonthly + row.semiMonthlyRate,
        netSalary: sum.netSalary + row.netSalary
    }), { monthly: 0, semiMonthly: 0, netSalary: 0 });
    const totalPaid = roundMoney(disbursements.reduce((sum, item) => sum + item.amount, 0));
    const totalBalance = roundMoney(Math.max(0, totals.netSalary - totalPaid));
    const liveNotice = live.isFuture
        ? 'Selected cutoff has not started yet, so payroll shows zero live attendance days.'
        : (live.isLive
            ? `Live payroll is computed only through today (${formatPayrollPeriodDate(live.rangeEnd)}). Future days until ${formatPayrollPeriodDate(live.configuredTo)} are not counted yet.`
            : `Payroll uses the full cutoff through ${formatPayrollPeriodDate(live.rangeEnd)}.`);
    document.getElementById('payrollStatus').textContent = `Payroll runs read the Employment & Payroll fields in tbl_employee plus attendance inside tbl_field_attendance. ${cutoff.title} detected. ${liveNotice} Government deductions now show whenever the employee payroll source or workbook has a saved value; loans and cash advances use active deduction plans.`;
    document.getElementById('payrollSample').innerHTML = `
        <div class="hr-payroll-sample-header">
            <div>
                <span>PAYROLL CUT OFF: ${sanitize(period.label)}</span>
                <h4>PAYROLL</h4>
                <p>Each payroll run follows the payroll workbook columns. Attendance-driven basic pay is live through ${sanitize(formatPayrollPeriodDate(live.rangeEnd))}. OT remains manual and requires signed approved overtime authorization.</p>
            </div>
            <div class="hr-payroll-total">
                <span>Net Salary Total</span>
                <strong>${formatMoneyOrDash(totals.netSalary)}</strong>
            </div>
        </div>
        <div class="hr-payroll-totals">
            <div><span>Sheet</span><strong>Sheet1</strong></div>
            <div><span>Title</span><strong>PAYROLL</strong></div>
            <div><span>Cutoff Period</span><strong>${sanitize(period.compactLabel)}</strong></div>
            <div><span>Computed Through</span><strong>${sanitize(live.isFuture ? 'Not started' : live.rangeEnd)}</strong></div>
            <div><span>Cutoff Type</span><strong>${sanitize(cutoff.title)}</strong></div>
            <div><span>Payroll Employees</span><strong>${sampleRows.length}</strong></div>
        </div>
        <div class="table-container hr-payroll-table-wrap">
            <table class="table hr-payroll-table">
                <thead>
                    <tr>
                        ${PAYROLL_PRINT_COLUMNS.map(([, label]) => `<th>${sanitize(label)}</th>`).join('')}
                        <th>paid</th>
                        <th>balance</th>
                        <th>action</th>
                    </tr>
                </thead>
                <tbody>
                    ${sampleRows.map((row) => {
                        const paymentState = getPayrollRowPaymentState(row, paymentSummaryMap);
                        return `
                            <tr>
                                ${PAYROLL_PRINT_COLUMNS.map(([key, label]) => `<td data-label="${sanitize(label)}">${formatPayrollCell(row, key)}</td>`).join('')}
                                <td data-label="paid" class="hr-payroll-payment-cell">
                                    <div class="hr-payroll-payment-stack">
                                        <strong>${sanitize(formatPayrollNumber(paymentState.paidAmount))}</strong>
                                        <small>${paymentState.entries.length ? `${paymentState.entries.length} disbursement${paymentState.entries.length === 1 ? '' : 's'}` : 'No disbursement yet'}</small>
                                    </div>
                                </td>
                                <td data-label="balance" class="hr-payroll-payment-cell">
                                    <div class="hr-payroll-payment-stack">
                                        <strong>${sanitize(formatPayrollNumber(paymentState.balanceAmount))}</strong>
                                        <small>Live net salary less paid releases</small>
                                    </div>
                                </td>
                                <td data-label="action">
                                    <div class="hr-payroll-row-actions">
                                        <button type="button" class="btn btn-secondary btn-sm" data-payroll-disburse="${sanitize(String(row.id || ''))}">Disburse</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div class="hr-manual-payroll-grid">
            <section>
                <h4>Approved Overtime Authorization</h4>
                <p>OT is case by case only. Enter it here only when there is a signed approved overtime authorization form.</p>
                <div class="table-container">
                    <table class="table hr-payroll-table">
                        <thead><tr><th>Employee</th><th>Date</th><th>Reason / Work To Finish</th><th>Hours</th><th>Approved By</th><th>Signed Form</th></tr></thead>
                        <tbody><tr><td colspan="6">No approved OT entries for this sample.</td></tr></tbody>
                    </table>
                </div>
            </section>
            <section>
                <h4>Deductions Register</h4>
                <p>Active employee deduction plans auto-fill this register. When payroll is confirmed, the deducted amount is posted to the loan/cash advance balance and SOA history.</p>
                <div class="table-container">
                    <table class="table hr-payroll-table">
                        <thead><tr><th>Employee</th><th>Deduction Type</th><th>Reference</th><th>Amount</th><th>Approved / Source</th></tr></thead>
                        <tbody>${deductionRows.length
                            ? deductionRows.map((row) => `<tr><td>${sanitize(row.employeeName)}</td><td>${sanitize(row.typeLabel)}</td><td>${sanitize(row.reference)}</td><td>${sanitize(formatPayrollNumber(row.amount))}</td><td>${sanitize(row.sourceLabel)}</td></tr>`).join('')
                            : '<tr><td colspan="5">No active employee deduction plans for this payroll period.</td></tr>'}</tbody>
                    </table>
                </div>
            </section>
        </div>
        <section class="hr-payroll-ledger">
            <div class="hr-payroll-ledger-header">
                <div class="hr-payroll-ledger-summary">
                    <h4>Payroll Disbursement Register</h4>
                    <p>Partial payroll release is allowed here. Paid and balance stay linked to the current live payroll row instead of locking the payroll line.</p>
                </div>
                <div class="hr-payroll-ledger-metrics">
                    <article><span>Total Net Salary</span><strong>${formatMoneyOrDash(totals.netSalary)}</strong></article>
                    <article><span>Total Paid</span><strong>${formatMoneyOrDash(totalPaid)}</strong></article>
                    <article><span>Total Balance</span><strong>${formatMoneyOrDash(totalBalance)}</strong></article>
                </div>
            </div>
            <div class="table-container">
                <table class="table hr-payroll-table">
                    <thead>
                        <tr><th>Employee</th><th>Paid Date</th><th>Amount</th><th>Net Salary Snapshot</th><th>Remarks</th><th>Encoded By</th></tr>
                    </thead>
                    <tbody>
                        ${disbursements.length
                            ? disbursements.map((item) => `
                                <tr>
                                    <td>${sanitize(item.staffName || item.payrollName || `#${item.staffId}`)}</td>
                                    <td>${sanitize(item.paidOn || '--')}</td>
                                    <td>${sanitize(formatPayrollNumber(item.amount))}</td>
                                    <td>${sanitize(formatPayrollNumber(item.netSalarySnapshot || 0))}</td>
                                    <td>${sanitize(item.remarks || '--')}</td>
                                    <td>${sanitize(item.createdBy || '--')}</td>
                                </tr>
                            `).join('')
                            : '<tr><td colspan="6">No payroll disbursement entries yet for this cutoff.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </section>
    `;
    document.getElementById('payrollAnalysis').innerHTML = `
        <h4>Workbook Formula Map</h4>
        <div class="hr-detected-grid">
            <div><span>Workbook</span><strong>payroll 1st Period of May 2026.xlsx</strong></div>
            <div><span>Sheet</span><strong>Sheet1</strong></div>
            <div><span>Rows</span><strong>${sampleRows.length} employees from tbl_employee payroll setup</strong></div>
            <div><span>Print Setup</span><strong>Landscape, workbook columns</strong></div>
            <div><span>Monthly Rate</span><strong>tbl_employee semimrate x 2</strong></div>
            <div><span>Attendance Scope</span><strong>${sanitize(live.isFuture ? 'Future cutoff only' : `${live.rangeStart} to ${live.rangeEnd}`)}</strong></div>
            <div><span>Cutoff Type</span><strong>${sanitize(cutoff.title)}</strong></div>
            <div><span>Net Salary Sample Total</span><strong>${formatMoneyOrDash(totals.netSalary)}</strong></div>
        </div>
        <h4>Copied Computation Rules</h4>
        <ol>
            <li><strong>semimrate:</strong> official monthly rate / 2.</li>
            <li><strong>daily_rate:</strong> <code>((semimrate * 2) / 313) * 12</code>.</li>
            <li><strong>live total_basic:</strong> while the cutoff is still open, <code>min(semimrate, daily_rate * attendance_days)</code> so payroll grows only from attendance already recorded through today.</li>
            <li><strong>final total_basic:</strong> after the cutoff closes, <code>semimrate - (daily_rate * absences)</code>.</li>
            <li><strong>OT pay:</strong> <code>(((daily_rate / 8) * 0.25) + (daily_rate / 8)) * ot_hours</code>. HR now reads attendance OT adjustments from the shared time-record request source; approved rows are preferred, and pending rows are previewed when no approved hours are available yet.</li>
            <li><strong>total_pay:</strong> <code>total_basic + approved_ot_pay + allowance + rdot + regular_ot + holiday_pay + adjustment</code>.</li>
            <li><strong>attendance inputs:</strong> <code>attendance_days</code> comes from unique <code>tbl_field_attendance.attendance_date</code> rows for the employee inside the selected cutoff; <code>minutes_late</code> sums saved late minutes or derives them from <code>time_in</code>.</li>
            <li><strong>ut_deduction:</strong> <code>(daily_rate / 8) * ut_hours</code>; <strong>late_deduction:</strong> <code>((daily_rate / 8) / 60) * minutes_late</code>.</li>
            <li><strong>gross_income:</strong> <code>total_pay - ut_deduction - sss - mandatory_sss_provident - phic - hdmf - late_deduction</code>.</li>
            <li><strong>net_salary:</strong> <code>gross_income + nontax_allowance - withholding_tax + tax_refund - sss_loan - coop_loan - philhealth_adjustment - bank_loan - cash_adv - pagibig_loan - t_shirt - others - house_rental - adjustment - tax_adjustment</code>.</li>
            <li><strong>Deduction source rule:</strong> if the payroll workbook or employee payroll source has a saved government deduction value, payroll shows it in the current run; active loan and advance balances still come from the deduction-plan register.</li>
            <li><strong>Payroll disbursement rule:</strong> saved disbursement entries track paid releases per employee and cutoff, while balance always recomputes from the current live <code>net_salary</code> minus total paid.</li>
        </ol>
    `;
    document.querySelectorAll('[data-payroll-disburse]').forEach((button) => {
        button.addEventListener('click', async () => {
            const row = sampleRows.find((entry) => String(entry.id || '') === button.dataset.payrollDisburse);
            if (!row) return;
            try {
                await promptPayrollDisbursement(row, getPayrollRowPaymentState(row, paymentSummaryMap), period);
            } catch (error) {
                alert(error?.message || 'Unable to save payroll disbursement.');
            }
        });
    });
}

function initPayrollDateDefaults() {
    const fromInput = document.getElementById('payrollDateFromInput');
    const toInput = document.getElementById('payrollDateToInput');
    if (!fromInput || !toInput) return;
    const defaults = recommendedPayrollPeriod(todayDateKey());
    fromInput.value = defaults.from;
    toInput.value = defaults.to;
}

function initPayrollCutoffControls() {
    const select = document.getElementById('payrollCutoffSelect');
    if (!select || !window.MargaPayrollCutoff?.listPayrollPeriodOptions) return;
    renderPayrollCutoffSelect();
    if (select.dataset.bound === '1') return;
    select.dataset.bound = '1';
    select.addEventListener('change', () => {
        const match = window.MargaPayrollCutoff.listPayrollPeriodOptions(24)
            .find((period) => period.key === select.value);
        if (!match) return;
        setPayrollPeriodInputs(match);
        refreshPayrollModel();
    });
}

function renderPayrollCutoffSelect() {
    const select = document.getElementById('payrollCutoffSelect');
    if (!select || !window.MargaPayrollCutoff?.listPayrollPeriodOptions) return;
    const currentKey = payrollPeriodKey(getPayrollPeriod());
    const options = window.MargaPayrollCutoff.listPayrollPeriodOptions(16).map((period) => {
        const selected = period.key === currentKey ? ' selected' : '';
        return `<option value="${sanitize(period.key)}"${selected}>${sanitize(period.label)}</option>`;
    });
    select.innerHTML = options.join('');
}

function syncPayrollCutoffControlFromInputs() {
    renderPayrollCutoffSelect();
}

function setPayrollPeriodInputs(period = {}) {
    const fromInput = document.getElementById('payrollDateFromInput');
    const toInput = document.getElementById('payrollDateToInput');
    if (!fromInput || !toInput) return;
    fromInput.value = period.from || '';
    toInput.value = period.to || '';
    syncPayrollCutoffControlFromInputs();
}

function getPayrollPeriod() {
    const from = valueOf('payrollDateFromInput') || '2026-05-10';
    const to = valueOf('payrollDateToInput') || '2026-05-25';
    return {
        from,
        to,
        label: `${formatPayrollPeriodDate(from)} - ${formatPayrollPeriodDate(to)}`,
        compactLabel: `${from} to ${to}`
    };
}

function payrollPeriodKey(period = getPayrollPeriod()) {
    return `${period.from || ''}_${period.to || ''}`;
}

function getLivePayrollWindow(period = getPayrollPeriod()) {
    const fromDate = parsePayrollDate(period.from);
    const toDate = parsePayrollDate(period.to);
    const today = parsePayrollDate(todayDateKey()) || new Date();
    if (!fromDate || !toDate) {
        return {
            configuredFrom: period.from,
            configuredTo: period.to,
            rangeStart: period.from,
            rangeEnd: period.to,
            isLive: false,
            isFuture: false
        };
    }
    const configuredTo = formatDateInputValue(toDate);
    if (today < fromDate) {
        return {
            configuredFrom: period.from,
            configuredTo,
            rangeStart: period.from,
            rangeEnd: period.from,
            isLive: false,
            isFuture: true
        };
    }
    const effectiveTo = today < toDate ? today : toDate;
    return {
        configuredFrom: period.from,
        configuredTo,
        rangeStart: period.from,
        rangeEnd: formatDateInputValue(effectiveTo),
        isLive: effectiveTo < toDate,
        isFuture: false
    };
}

function recommendedPayrollPeriod(dateKey) {
    const base = parsePayrollDate(dateKey) || new Date();
    const year = base.getFullYear();
    const month = base.getMonth();
    const day = base.getDate();
    if (day >= 11 && day <= 25) {
        return {
            from: formatDateInputValue(new Date(year, month, 11)),
            to: formatDateInputValue(new Date(year, month, 25))
        };
    }
    if (day >= 26) {
        return {
            from: formatDateInputValue(new Date(year, month, 26)),
            to: formatDateInputValue(new Date(year, month + 1, 10))
        };
    }
    return {
        from: formatDateInputValue(new Date(year, month - 1, 26)),
        to: formatDateInputValue(new Date(year, month, 10))
    };
}

function getPayrollCutoffProfile(period = getPayrollPeriod()) {
    const from = parsePayrollDate(period.from);
    const to = parsePayrollDate(period.to);
    if (from && to) {
        if (from.getDate() === 26 && to.getDate() === 10) {
            return { key: 'first_cutoff', title: 'First cutoff (26th to 10th)' };
        }
        if (from.getDate() === 11 && to.getDate() === 25 && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
            return { key: 'second_cutoff', title: 'Second cutoff (11th to 25th)' };
        }
    }
    return { key: 'custom', title: 'Custom cutoff' };
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parsePayrollDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatPayrollPeriodDate(value) {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatPayrollCell(row, key) {
    if (key === 'number') return sanitize(row.number);
    if (key === 'name') return `<strong>${sanitize(row.name)}</strong>`;
    if (key === 'otHours') {
        const value = row[key];
        const hoursText = typeof value === 'number' ? sanitize(formatPayrollNumber(value)) : sanitize(value || '');
        const status = String(row.otStatusLabel || '').trim();
        return `${hoursText}${status ? `<small>${sanitize(status)}</small>` : ''}`;
    }
    if (key === 'otPay') {
        const value = row[key];
        const payText = typeof value === 'number' ? sanitize(formatPayrollNumber(value)) : sanitize(value || '');
        const pending = roundMoney(toNumber(row.pendingOtHours));
        const approved = roundMoney(toNumber(row.approvedOtHours));
        const note = approved > 0
            ? `${formatPayrollNumber(approved)} hr approved`
            : (pending > 0 ? `${formatPayrollNumber(pending)} hr pending preview` : '');
        return `${payText}${note ? `<small>${sanitize(note)}</small>` : ''}`;
    }
    const value = row[key];
    if (value === '' || value === null || value === undefined) return '';
    if (typeof value === 'number') return sanitize(formatPayrollNumber(value));
    return sanitize(value);
}

function payrollCellText(row, key) {
    if (key === 'number') return String(row.number ?? '');
    if (key === 'name') return String(row.name || '');
    const value = row[key];
    if (value === '' || value === null || value === undefined) return '';
    if (typeof value === 'number') return formatPayrollNumber(value);
    return String(value);
}

function formatPayrollNumber(value) {
    const rounded = roundMoney(value);
    return rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hasSeededPayrollRate(employee) {
    const payrollSource = String(firstPresent(employee, ['payroll_rate_source']) || '').trim();
    const sequence = toNumber(firstPresent(employee, ['payroll_sequence']));
    return Boolean(payrollSource) || sequence > 0;
}

function comparePayrollSeedPriority(left, right) {
    const leftCutoff = String(firstPresent(left, ['payroll_rate_effective_cutoff']) || '');
    const rightCutoff = String(firstPresent(right, ['payroll_rate_effective_cutoff']) || '');
    if (leftCutoff !== rightCutoff) return leftCutoff.localeCompare(rightCutoff);
    const leftUpdated = Date.parse(firstPresent(left, ['payroll_rate_updated_at']) || '') || 0;
    const rightUpdated = Date.parse(firstPresent(right, ['payroll_rate_updated_at']) || '') || 0;
    if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
    const leftRecurringScore = ['payroll_sss_amount', 'payroll_phic_amount', 'payroll_hdmf_amount', 'payroll_withholding_tax']
        .reduce((sum, key) => sum + (roundMoney(toNumber(firstPresent(left, [key]))) > 0 ? 1 : 0), 0);
    const rightRecurringScore = ['payroll_sss_amount', 'payroll_phic_amount', 'payroll_hdmf_amount', 'payroll_withholding_tax']
        .reduce((sum, key) => sum + (roundMoney(toNumber(firstPresent(right, [key]))) > 0 ? 1 : 0), 0);
    if (leftRecurringScore !== rightRecurringScore) return leftRecurringScore - rightRecurringScore;
    const leftDocId = toNumber(firstPresent(left, ['_docId', 'id']));
    const rightDocId = toNumber(firstPresent(right, ['_docId', 'id']));
    return leftDocId - rightDocId;
}

function getPayrollSeedGroupKey(employee) {
    const sequence = toNumber(firstPresent(employee, ['payroll_sequence']));
    if (sequence > 0) return `sequence:${sequence}`;
    const payrollName = normalizePayrollEmployeeName(
        firstPresent(employee, ['payroll_sheet_employee_name'])
        || MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || '')
    );
    return payrollName ? `name:${payrollName}` : `doc:${firstPresent(employee, ['_docId', 'id'])}`;
}

function getPayrollSeededEmployees(sourceEmployees = HR_STATE.employees) {
    const groups = new Map();
    (Array.isArray(sourceEmployees) ? sourceEmployees : [])
        .filter((employee) => employee && hasSeededPayrollRate(employee))
        .forEach((employee) => {
            const key = getPayrollSeedGroupKey(employee);
            const current = groups.get(key);
            if (!current || comparePayrollSeedPriority(current, employee) < 0) {
                groups.set(key, employee);
            }
        });
    return Array.from(groups.values())
        .sort((left, right) => {
            const leftSequence = toNumber(firstPresent(left, ['payroll_sequence'])) || 9999;
            const rightSequence = toNumber(firstPresent(right, ['payroll_sequence'])) || 9999;
            if (leftSequence !== rightSequence) return leftSequence - rightSequence;
            return MargaUtils.getEmployeeFullName(left, '').localeCompare(MargaUtils.getEmployeeFullName(right, ''));
        });
}

function buildSamplePayrollRows() {
    const period = getPayrollPeriod();
    const cutoff = getPayrollCutoffProfile(period);
    const live = getLivePayrollWindow(period);
    return getPayrollSeededEmployees()
        .map((employee) => {
            const rates = payrollRatesFor(employee);
            const deductionTotals = getEmployeeDeductionTotals(employee, period);
            const recurring = getRecurringPayrollValues(employee, cutoff);
            const attendance = getPayrollAttendanceSummary(employee, live);
            const overtime = getPayrollOtSummary(employee, period);
            const payrollSource = firstPresent(employee, ['payroll_rate_source']);
            const sequence = toNumber(firstPresent(employee, ['payroll_sequence']));
            const name = firstPresent(employee, ['payroll_sheet_employee_name'])
                || MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || 'Employee');
            const semiMonthlyRate = roundMoney(rates.semiMonthlyRate);
            const dailyRate = roundMoney(rates.dailyRate);
            const allowance = roundMoney(toNumber(firstPresent(employee, ['allowance', 'payroll_allowance'])));
            const absences = attendance.absences;
            const otHours = roundMoney(overtime.previewHours);
            const otPay = roundMoney((((dailyRate / 8) * 0.25) + (dailyRate / 8)) * otHours);
            const rdot = 0;
            const regularOt = 0;
            const holidayPay = 0;
            const payAdjustment = 0;
            const totalBasic = roundMoney(live.isLive
                ? Math.min(semiMonthlyRate, dailyRate * attendance.daysWorked)
                : Math.max(0, semiMonthlyRate - (dailyRate * absences)));
            const totalPay = roundMoney(totalBasic + otPay + allowance + rdot + regularOt + holidayPay + payAdjustment);
            const utHours = attendance.utHours;
            const utDeduction = roundMoney((dailyRate / 8) * utHours);
            const sss = recurring.sss;
            const mandatorySssProvident = recurring.mandatorySssProvident;
            const phic = recurring.phic;
            const hdmf = recurring.hdmf;
            const minutesLate = attendance.minutesLate;
            const lateDeduction = roundMoney(((dailyRate / 8) / 60) * minutesLate);
            const grossIncome = roundMoney(totalPay - utDeduction - sss - mandatorySssProvident - phic - hdmf - lateDeduction);
            const nontaxAllowance = recurring.nontaxAllowance;
            const withholdingTax = recurring.withholdingTax;
            const taxRefund = recurring.taxRefund;
            const sssLoan = deductionTotals.sssLoan;
            const coopLoan = deductionTotals.coopLoan;
            const philhealthAdjustment = recurring.philhealthAdjustment;
            const bankLoan = deductionTotals.bankLoan;
            const cashAdvance = deductionTotals.cashAdvance;
            const pagibigLoan = deductionTotals.pagibigLoan;
            const tshirt = recurring.tshirt;
            const otherDeduction = recurring.otherDeduction;
            const houseRental = recurring.houseRental;
            const taxAdjustment = recurring.taxAdjustment;
            const deductionAdjustment = recurring.deductionAdjustment;
            return {
                number: sequence || 9999,
                id: employee.id || employee._docId || '',
                name,
                organization: getPayrollOrganization(name, employee),
                status: MargaUtils.isOfficialActiveEmployee(employee) ? 'Active' : 'Seeded Payroll',
                monthlyRate: roundMoney(rates.monthlyRate),
                semiMonthlyRate,
                dailyRate,
                totalBasic,
                absences,
                daysWorked: attendance.daysWorked,
                otHours,
                otPay,
                allowance,
                rdot,
                regularOt,
                holidayPay,
                payAdjustment,
                totalPay,
                utHours,
                utDeduction,
                sss,
                mandatorySssProvident,
                phic,
                hdmf,
                minutesLate,
                lateDeduction,
                grossIncome,
                nontaxAllowance,
                withholdingTax,
                taxRefund,
                sssLoan,
                coopLoan,
                philhealthAdjustment,
                bankLoan,
                cashAdvance,
                pagibigLoan,
                tshirt,
                otherDeduction,
                houseRental,
                taxAdjustment,
                deductionAdjustment,
                netSalary: roundMoney(grossIncome + nontaxAllowance - withholdingTax + taxRefund - sssLoan - coopLoan - philhealthAdjustment - bankLoan - cashAdvance - pagibigLoan - tshirt - otherDeduction - houseRental - deductionAdjustment - taxAdjustment),
                sourceLabel: payrollSource || 'tbl_employee',
                attendanceDaysScope: attendance.elapsedDays,
                otStatusLabel: overtime.sourceLabel,
                approvedOtHours: overtime.approvedHours,
                pendingOtHours: overtime.pendingHours
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (left.number !== right.number) return left.number - right.number;
            return left.name.localeCompare(right.name);
        })
        .map((row, index) => ({ ...row, number: index + 1 }));
}

function getRecurringPayrollValues(employee, cutoff = getPayrollCutoffProfile()) {
    const preferPayrollValue = (payrollKeys, fallbackKeys = []) => roundMoney(toNumber(preferredPayrollFieldValue(employee, payrollKeys, fallbackKeys)));
    const everyPayroll = (keys) => roundMoney(toNumber(firstPresent(employee, keys)));
    return {
        sss: preferPayrollValue(['payroll_sss_amount'], ['sss_deduction', 'employee_sss_share']),
        mandatorySssProvident: preferPayrollValue(['payroll_mandatory_sss_provident'], ['mandatory_sss_provident', 'sss_provident']),
        phic: preferPayrollValue(['payroll_phic_amount'], ['phic_deduction', 'philhealth_deduction', 'employee_philhealth_share']),
        hdmf: preferPayrollValue(['payroll_hdmf_amount'], ['hdmf_deduction', 'pagibig_deduction', 'employee_pagibig_share', 'pagibig_ded']),
        withholdingTax: preferPayrollValue(['payroll_withholding_tax'], ['withholding_tax']),
        nontaxAllowance: everyPayroll(['payroll_nontax_allowance', 'nontax_allowance']),
        taxRefund: everyPayroll(['payroll_tax_refund', 'tax_refund']),
        philhealthAdjustment: everyPayroll(['payroll_philhealth_adjustment', 'philhealth_adjustment']),
        tshirt: everyPayroll(['payroll_tshirt_deduction', 'tshirt_deduction']),
        otherDeduction: everyPayroll(['payroll_other_deduction', 'other_deduction']),
        houseRental: everyPayroll(['payroll_house_rental', 'house_rental']),
        taxAdjustment: everyPayroll(['payroll_tax_adjustment', 'tax_adjustment']),
        deductionAdjustment: everyPayroll(['payroll_deduction_adjustment', 'deduction_adjustment'])
    };
}

function getPayrollAttendanceSummary(employee, live = getLivePayrollWindow()) {
    if (live.isFuture || !live.rangeStart || !live.rangeEnd) {
        return { daysWorked: 0, elapsedDays: 0, absences: 0, minutesLate: 0, utHours: 0 };
    }
    const startDate = parsePayrollDate(live.rangeStart);
    const endDate = parsePayrollDate(live.rangeEnd);
    if (!startDate || !endDate) {
        return { daysWorked: 0, elapsedDays: 0, absences: 0, minutesLate: 0, utHours: 0 };
    }
    const hireDate = parsePayrollDate(toDateInputValue(firstPresent(employee, ['hire_date', 'date_hired', 'employment_date', 'start_date'])));
    const effectiveStart = hireDate && hireDate > startDate ? hireDate : startDate;
    const elapsedDays = effectiveStart > endDate ? 0 : countPayrollWorkdays(effectiveStart, endDate);
    const keySet = new Set(employeeKeys(employee));
    const seenDates = new Set();
    let minutesLate = 0;
    let utHours = 0;
    for (const row of HR_STATE.payrollAttendance) {
        if (!rowMatchesEmployee(row, keySet)) continue;
        const dateKey = String(firstPresent(row, ['attendance_date']) || '').trim();
        if (!dateKey || seenDates.has(dateKey)) continue;
        seenDates.add(dateKey);
        const savedLate = Math.max(0, toNumber(firstPresent(row, ['time_in_late_minutes', 'late_minutes', 'minutes_late'])));
        minutesLate += savedLate || Math.max(0, minutesAfterEight(firstPresent(row, ['time_in']))) || 0;
        utHours += Math.max(0, toNumber(firstPresent(row, ['ut_hours', 'undertime_hours', 'undertime'])));
    }
    const daysWorked = seenDates.size;
    return {
        daysWorked,
        elapsedDays,
        absences: Math.max(0, elapsedDays - daysWorked),
        minutesLate: roundMoney(minutesLate),
        utHours: roundMoney(utHours)
    };
}

function getPayrollOtSummary(employee, period = getPayrollPeriod()) {
    const employeeId = Number(firstPresent(employee, ['id', '_docId', 'staff_id', 'employee_id']) || 0) || 0;
    const overtimeHoursFromAdjustment = window.MargaAttendanceTimeRecords?.overtimeHoursFromAdjustment;
    const adjustmentMatchesPeriod = window.MargaAttendanceTimeRecords?.adjustmentMatchesPeriod;
    if (!employeeId || typeof overtimeHoursFromAdjustment !== 'function' || typeof adjustmentMatchesPeriod !== 'function') {
        return {
            previewHours: 0,
            approvedHours: 0,
            pendingHours: 0,
            missingApprovedHours: 0,
            sourceLabel: ''
        };
    }
    const rows = (Array.isArray(HR_STATE.payrollAdjustments) ? HR_STATE.payrollAdjustments : [])
        .filter((row) => Number(row.staff_id || 0) === employeeId)
        .filter((row) => String(row.request_type || '').trim() === 'request_ot')
        .filter((row) => ['pending', 'approved'].includes(String(row.status || '').trim()))
        .filter((row) => adjustmentMatchesPeriod(row, period));
    const approvedHours = roundMoney(rows
        .filter((row) => String(row.status || '').trim() === 'approved')
        .reduce((sum, row) => sum + overtimeHoursFromAdjustment(row), 0));
    const pendingHours = roundMoney(rows
        .filter((row) => String(row.status || '').trim() === 'pending')
        .reduce((sum, row) => sum + overtimeHoursFromAdjustment(row), 0));
    const missingApprovedHours = rows
        .filter((row) => String(row.status || '').trim() === 'approved')
        .filter((row) => overtimeHoursFromAdjustment(row) <= 0).length;

    const byDate = new Map();
    rows.forEach((row) => {
        const dateKey = String(row.attendance_date || '').trim();
        if (!dateKey) return;
        const hours = roundMoney(overtimeHoursFromAdjustment(row));
        const status = String(row.status || '').trim();
        const score = status === 'approved'
            ? (hours > 0 ? 4 : 2)
            : (hours > 0 ? 3 : 1);
        const existing = byDate.get(dateKey);
        if (!existing || score > existing.score) {
            byDate.set(dateKey, { row, hours, status, score });
        }
    });
    const previewHours = roundMoney(Array.from(byDate.values()).reduce((sum, entry) => sum + entry.hours, 0));
    const sourceLabel = approvedHours > 0
        ? 'Approved OT'
        : (previewHours > 0 ? 'Pending OT preview' : (missingApprovedHours ? 'Approved OT missing hours' : ''));
    return {
        previewHours,
        approvedHours,
        pendingHours,
        missingApprovedHours,
        sourceLabel
    };
}

function countPayrollWorkdays(startDate, endDate) {
    const cursor = new Date(startDate.getTime());
    cursor.setHours(12, 0, 0, 0);
    const end = new Date(endDate.getTime());
    end.setHours(12, 0, 0, 0);
    let count = 0;
    while (cursor <= end) {
        const day = cursor.getDay();
        if (day !== 0) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count;
}

function preferredPayrollFieldValue(employee, payrollKeys, fallbackKeys = []) {
    const payrollRaw = firstPresent(employee, payrollKeys);
    const fallbackRaw = firstPresent(employee, fallbackKeys);
    const hasPayrollValue = payrollRaw !== '';
    const payrollAmount = roundMoney(toNumber(payrollRaw));
    const fallbackAmount = roundMoney(toNumber(fallbackRaw));
    if (hasPayrollValue && payrollAmount > 0) return payrollRaw;
    if (fallbackAmount > 0) return fallbackRaw;
    if (hasPayrollValue) return payrollRaw;
    return fallbackRaw;
}

function payrollPreviewNetSalary(monthlyRate, allowanceValue = 0) {
    const semiMonthlyRate = toNumber(monthlyRate) / 2;
    const dailyRate = ((semiMonthlyRate * 2) / 313) * 12;
    const totalBasic = semiMonthlyRate;
    const approvedOtPay = 0;
    const allowance = toNumber(allowanceValue);
    const rdot = 0;
    const regularOt = 0;
    const holidayPay = 0;
    const adjustment = 0;
    const totalPay = totalBasic + approvedOtPay + allowance + rdot + regularOt + holidayPay + adjustment;
    const utDeduction = 0;
    const sss = 0;
    const mandatorySssProvident = 0;
    const phic = 0;
    const hdmf = 0;
    const lateDeduction = 0;
    const grossIncome = totalPay - utDeduction - sss - mandatorySssProvident - phic - hdmf - lateDeduction;
    const nontaxAllowance = 0;
    const withholdingTax = 0;
    const taxRefund = 0;
    const sssLoan = 0;
    const coopLoan = 0;
    const philhealthAdjustment = 0;
    const bankLoan = 0;
    const cashAdvance = 0;
    const pagibigLoan = 0;
    const tshirt = 0;
    const otherDeduction = 0;
    const houseRental = 0;
    const taxAdjustment = 0;
    return grossIncome + nontaxAllowance - withholdingTax + taxRefund - sssLoan - coopLoan - philhealthAdjustment - bankLoan - cashAdvance - pagibigLoan - tshirt - otherDeduction - houseRental - adjustment - taxAdjustment;
}

function getPayrollOrganization(payrollName, employee) {
    const draft = readPayrollOrganizationDraft(payrollName);
    if (PAYROLL_ORGANIZATIONS.includes(draft)) return draft;
    const stored = firstPresent(employee || {}, ['payroll_organization', 'organization', 'employee_organization', 'marga_organization']);
    const normalized = PAYROLL_ORGANIZATIONS.find((option) => option.toLowerCase() === String(stored || '').trim().toLowerCase());
    return normalized || 'Marga';
}

function payrollOrganizationStorageKey(payrollName) {
    return `marga_hr_payroll_org:${normalizePayrollName(payrollName)}`;
}

function readPayrollOrganizationDraft(payrollName) {
    try {
        return localStorage.getItem(payrollOrganizationStorageKey(payrollName)) || '';
    } catch (error) {
        return '';
    }
}

function savePayrollOrganizationDraft(payrollName, organization) {
    if (!PAYROLL_ORGANIZATIONS.includes(organization)) return;
    try {
        localStorage.setItem(payrollOrganizationStorageKey(payrollName), organization);
    } catch (error) {
        console.warn('Unable to save payroll organization draft.', error);
    }
}

function normalizePayrollName(value) {
    const raw = String(value || '').trim();
    const name = raw.includes(',')
        ? raw.split(',').reverse().join(' ')
        : raw;
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\bjr\.?\b/g, 'jr')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function payrollRatesFor(employee) {
    const monthly = toNumber(firstPresent(employee, ['monthly_salary', 'basic_salary', 'basic_monthly', 'monthly_rate']));
    const semiMonthly = toNumber(firstPresent(employee, ['semi_monthly_rate', 'semim_rate', 'semimrate', 'salary_rate', 'salary']));
    const daily = toNumber(firstPresent(employee, ['daily_rate', 'marga_daily_rate']));
    const resolvedMonthly = monthly || (semiMonthly ? semiMonthly * 2 : daily * 24) || 25000;
    const resolvedSemi = semiMonthly || (resolvedMonthly / 2) || 12500;
    const resolvedDaily = daily || ((resolvedSemi * 2) / 313) * 12;
    return {
        monthlyRate: resolvedMonthly,
        semiMonthlyRate: resolvedSemi,
        dailyRate: resolvedDaily
    };
}

function getFallbackSampleEmployees() {
    return [
        { id: 'S-001', firstname: 'Sample', lastname: 'Admin', position_name: 'Office Admin', monthly_salary: 28000, allowance: 1000, bank_account_no: 'sample' },
        { id: 'S-002', firstname: 'Sample', lastname: 'Technician', position_name: 'Field Technician', monthly_salary: 24000, allowance: 800 },
        { id: 'S-003', firstname: 'Sample', lastname: 'Collector', position_name: 'Collector', monthly_salary: 26000, allowance: 900, bank_account_no: 'sample' }
    ];
}

function getPositionLabel(employee) {
    const position = HR_STATE.positions.get(String(employee.position_id || ''));
    return MargaUtils.getEmployeeDesignation(employee, position ? new Map([[String(employee.position_id || ''), position]]) : null);
}

async function hydratePerformanceLookups(events = []) {
    const sourceRows = [
        ...events,
        ...HR_STATE.performanceSchedules,
        ...HR_STATE.finishBlocks,
        ...HR_STATE.closeRequests
    ];
    const branchIds = [...new Set(sourceRows.map((event) => String(event.branch_id || '').trim()).filter(Boolean))].slice(0, 160);
    const companyIds = [...new Set(sourceRows.map((event) => String(event.company_id || '').trim()).filter(Boolean))].slice(0, 160);
    const [branches, companies] = await Promise.all([
        Promise.all(branchIds.map((id) => MargaUtils.fetchDoc('tbl_branchinfo', id).then((doc) => [id, doc]).catch(() => [id, null]))),
        Promise.all(companyIds.map((id) => MargaUtils.fetchDoc('tbl_companylist', id).then((doc) => [id, doc]).catch(() => [id, null])))
    ]);
    HR_STATE.branches = new Map(branches.filter(([, doc]) => doc));
    HR_STATE.companies = new Map(companies.filter(([, doc]) => doc));
}

function resolveEventContext(event = null) {
    if (!event) return { company: '', branch: '' };
    const branch = HR_STATE.branches.get(String(event.branch_id || '').trim()) || {};
    const company = HR_STATE.companies.get(String(event.company_id || branch.company_id || '').trim()) || {};
    return {
        company: firstPresent(event, ['company_name', 'account_name', 'customer_name', 'client_name'])
            || firstPresent(company, ['companyname', 'company_name', 'name'])
            || (event.company_id ? `Company #${event.company_id}` : ''),
        branch: firstPresent(event, ['branch_name', 'customer_branch', 'branch'])
            || firstPresent(branch, ['branchname', 'branch_name', 'name'])
            || (event.branch_id ? `Branch #${event.branch_id}` : '')
    };
}

function findEmployeeById(employeeId) {
    const id = String(employeeId || '').trim();
    return HR_STATE.employees.find((employee) => String(employee.id || employee._docId || '').trim() === id) || null;
}

async function hydrateEmployeeForEdit(employee) {
    if (!employee || !HR_STATE.usingEmployeeSummary) return employee;
    const docId = String(employee.id || employee._docId || '').trim();
    if (!docId) return employee;
    try {
        const fullEmployee = await MargaUtils.fetchDoc('tbl_employee', docId);
        if (!fullEmployee || typeof fullEmployee !== 'object') return employee;
        Object.assign(employee, fullEmployee, { _docId: docId });
    } catch (error) {
        console.warn('Unable to hydrate full employee record for HR modal:', docId, error);
    }
    return employee;
}

async function openEmployeeModal(employeeId) {
    const employee = findEmployeeById(employeeId);
    if (!employee) return;
    await hydrateEmployeeForEdit(employee);
    HR_STATE.employeeModalMode = 'edit';
    HR_STATE.editingEmployeeId = String(employee.id || employee._docId || '');
    document.getElementById('employeeDocId').value = HR_STATE.editingEmployeeId;
    document.getElementById('employeeIdInput').disabled = true;
    document.getElementById('employeeModalTitle').textContent = MargaUtils.getEmployeeFullName(employee, HR_STATE.editingEmployeeId);
    document.getElementById('employeeModalSubtitle').textContent = 'This edits tbl_employee, the same employee source used by Service, Billing, Collections, Schedule, login, and Field App assignment.';
    document.getElementById('employeeModalSaveBtn').textContent = 'Save Employee';

    setInputValue('employeeIdInput', employee.id || employee._docId || '');
    setInputValue('employeeFirstNameInput', employee.firstname || '');
    setInputValue('employeeLastNameInput', employee.lastname || '');
    setInputValue('employeeNicknameInput', employee.nickname || '');
    setInputValue('employeeEmailInput', employee.email || employee.marga_login_email || employee.username || '');
    setInputValue('employeeMobileInput', firstPresent(employee, ['mobile', 'mobile_no', 'phone', 'contact_no', 'contact_number']));
    setInputValue('employeeBirthdateInput', toDateInputValue(firstPresent(employee, ['birthdate', 'birthday', 'date_of_birth'])));
    setInputValue('employeeCivilStatusInput', firstPresent(employee, ['civil_status', 'marital_status']));
    setInputValue('employeeAddressInput', firstPresent(employee, ['address', 'home_address', 'current_address']));
    setInputValue('employeeAccountStatusInput', MargaUtils.isOfficialActiveEmployee(employee) ? 'active' : 'inactive');
    setInputValue('employeeUsernameInput', employee.username || employee.marga_username || '');
    setInputValue('employeePasswordInput', '');
    setInputValue('employeePasswordConfirmInput', '');
    setInputValue('employeePositionInput', getPositionLabel(employee));
    setInputValue('employeeHireDateInput', toDateInputValue(firstPresent(employee, ['hire_date', 'date_hired', 'employment_date', 'start_date'])));
    setInputValue('employeeRateTypeInput', getRateType(employee));
    setInputValue('employeeMonthlySalaryInput', firstPresent(employee, ['monthly_salary', 'basic_salary']));
    setInputValue('employeeSemiMonthlyRateInput', firstPresent(employee, ['semim_rate', 'semi_monthly_rate', 'semimrate']));
    setInputValue('employeeDailyRateInput', firstPresent(employee, ['daily_rate', 'marga_daily_rate']));
    setInputValue('employeeAllowanceInput', getAllowance(employee));
    setInputValue('employeeBankAccountInput', firstPresent(employee, ['bank_account_no', 'bank_account', 'account_no', 'payroll_account_no']));
    setInputValue('employeeSssInput', firstPresent(employee, ['sss_no', 'sss_number', 'sss']));
    setInputValue('employeePhilhealthInput', firstPresent(employee, ['philhealth_no', 'philhealth_number', 'phic_no', 'phic']));
    setInputValue('employeePagibigInput', firstPresent(employee, ['pagibig_no', 'pagibig_number', 'hdmf_no', 'hdmf']));
    setInputValue('employeeTinInput', firstPresent(employee, ['tin_no', 'tin_number', 'tin']));
    setInputValue('employeeSssDeductionInput', preferredPayrollFieldValue(employee, ['payroll_sss_amount'], ['sss_deduction', 'employee_sss_share']));
    setInputValue('employeeMandatorySssProvidentInput', firstPresent(employee, ['payroll_mandatory_sss_provident', 'mandatory_sss_provident', 'sss_provident']));
    setInputValue('employeePhilhealthDeductionInput', preferredPayrollFieldValue(employee, ['payroll_phic_amount'], ['phic_deduction', 'philhealth_deduction', 'employee_philhealth_share']));
    setInputValue('employeePagibigDeductionInput', preferredPayrollFieldValue(employee, ['payroll_hdmf_amount'], ['hdmf_deduction', 'pagibig_deduction', 'employee_pagibig_share', 'pagibig_ded']));
    setInputValue('employeeWithholdingTaxInput', preferredPayrollFieldValue(employee, ['payroll_withholding_tax'], ['withholding_tax']));
    setInputValue('employeeNontaxAllowanceInput', firstPresent(employee, ['payroll_nontax_allowance', 'nontax_allowance']));
    setInputValue('employeeTaxRefundInput', firstPresent(employee, ['payroll_tax_refund', 'tax_refund']));
    setInputValue('employeePhilhealthAdjustmentInput', firstPresent(employee, ['payroll_philhealth_adjustment', 'philhealth_adjustment']));
    setInputValue('employeeTshirtDeductionInput', firstPresent(employee, ['payroll_tshirt_deduction', 'tshirt_deduction']));
    setInputValue('employeeOtherDeductionInput', firstPresent(employee, ['payroll_other_deduction', 'other_deduction']));
    setInputValue('employeeHouseRentalInput', firstPresent(employee, ['payroll_house_rental', 'house_rental']));
    setInputValue('employeeTaxAdjustmentInput', firstPresent(employee, ['payroll_tax_adjustment', 'tax_adjustment']));
    setInputValue('employeeDeductionAdjustmentInput', firstPresent(employee, ['payroll_deduction_adjustment', 'deduction_adjustment']));
    setInputValue('employeeEmergencyNameInput', firstPresent(employee, ['emergency_contact_name', 'emergency_contact']));
    setInputValue('employeeEmergencyPhoneInput', firstPresent(employee, ['emergency_contact_phone', 'emergency_phone']));
    setInputValue('employeeNotesInput', firstPresent(employee, ['hr_notes', 'notes', 'remarks']));
    document.getElementById('employeeModalBrief').innerHTML = renderEmployeeBrief(employee);
    resetEmployeeDeductionForm();
    renderEmployeeDeductions(employee.id || employee._docId || '');
    renderEmployeeDeductionPrefills(employee);
    document.getElementById('employeeModalStatus').textContent = 'Ready.';
    setModalOpen('employeeModal', 'employeeModalOverlay', true);
}

function openNewEmployeeModal() {
    HR_STATE.employeeModalMode = 'create';
    HR_STATE.editingEmployeeId = '';
    const nextEmployeeId = allocateNextEmployeeId();
    document.getElementById('employeeDocId').value = '';
    document.getElementById('employeeIdInput').disabled = true;
    document.getElementById('employeeModalTitle').textContent = 'Add Employee';
    document.getElementById('employeeModalSubtitle').textContent = 'Create a new tbl_employee record so HR, payroll, login, Service, Billing, Collections, Schedule, and Field App assignment all use the same employee source.';
    document.getElementById('employeeModalSaveBtn').textContent = 'Add Employee';
    [
        'employeeFirstNameInput',
        'employeeLastNameInput',
        'employeeNicknameInput',
        'employeeEmailInput',
        'employeeMobileInput',
        'employeeBirthdateInput',
        'employeeCivilStatusInput',
        'employeeAddressInput',
        'employeeUsernameInput',
        'employeePasswordInput',
        'employeePasswordConfirmInput',
        'employeePositionInput',
        'employeeHireDateInput',
        'employeeRateTypeInput',
        'employeeMonthlySalaryInput',
        'employeeSemiMonthlyRateInput',
        'employeeDailyRateInput',
        'employeeAllowanceInput',
        'employeeBankAccountInput',
        'employeeSssInput',
        'employeePhilhealthInput',
        'employeePagibigInput',
        'employeeTinInput',
        'employeeSssDeductionInput',
        'employeeMandatorySssProvidentInput',
        'employeePhilhealthDeductionInput',
        'employeePagibigDeductionInput',
        'employeeWithholdingTaxInput',
        'employeeNontaxAllowanceInput',
        'employeeTaxRefundInput',
        'employeePhilhealthAdjustmentInput',
        'employeeTshirtDeductionInput',
        'employeeOtherDeductionInput',
        'employeeHouseRentalInput',
        'employeeTaxAdjustmentInput',
        'employeeDeductionAdjustmentInput',
        'employeeEmergencyNameInput',
        'employeeEmergencyPhoneInput',
        'employeeNotesInput'
    ].forEach((id) => setInputValue(id, ''));
    setInputValue('employeeIdInput', nextEmployeeId);
    setInputValue('employeeAccountStatusInput', 'active');
    document.getElementById('employeeModalBrief').innerHTML = `
        <div class="hr-employee-identity">
            ${renderEmployeePhotoControl({ id: nextEmployeeId, _docId: nextEmployeeId }, '+', { disabled: true })}
            <div>
                <span class="hr-kicker">New Employee · ID ${sanitize(nextEmployeeId)}</span>
                <strong>Ready to create</strong>
                <p>Use the same employee editor already used by View so payroll and assignment data stay in one place.</p>
            </div>
        </div>
        <div class="hr-employee-brief-metrics">
            <div><span>Allowance</span><strong>${sanitize(formatMoneyOrDash(0))}</strong></div>
            <div><span>Cash advance</span><strong>${sanitize(formatMoneyOrDash(0))}</strong></div>
            <div><span>Loan</span><strong>${sanitize(formatMoneyOrDash(0))}</strong></div>
        </div>
    `;
    resetEmployeeDeductionForm();
    renderEmployeeDeductions('');
    renderEmployeeDeductionPrefills(null);
    document.getElementById('employeeModalStatus').textContent = `New employee ID ${nextEmployeeId} is reserved from the current HR list.`;
    setModalOpen('employeeModal', 'employeeModalOverlay', true);
}

function renderEmployeeBrief(employee) {
    const active = MargaUtils.isOfficialActiveEmployee(employee);
    const rates = payrollRatesFor(employee);
    const mobile = firstPresent(employee, ['mobile', 'mobile_no', 'phone', 'contact_no', 'contact_number']) || '-';
    const email = employee.email || employee.marga_login_email || employee.username || '-';
    const initial = String(MargaUtils.getEmployeeFullName(employee, 'E').charAt(0) || 'E').toUpperCase();
    return `
        <div class="hr-employee-identity">
            ${renderEmployeePhotoControl(employee, initial)}
            <div>
                <span class="hr-kicker">${active ? 'Active Employee' : 'Inactive Employee'} · ID ${sanitize(employee.id || employee._docId || '-')}</span>
                <strong>${sanitize(MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || 'Employee'))}</strong>
                <p>${sanitize(getPositionLabel(employee) || 'No position set')} · ${sanitize(email)} · ${sanitize(mobile)}</p>
            </div>
        </div>
        <div class="hr-employee-brief-metrics">
            <div><span>Semi-monthly</span><strong>${sanitize(formatMoneyOrDash(rates.semiMonthlyRate))}</strong></div>
            <div><span>Allowance</span><strong>${sanitize(formatMoneyOrDash(rates.allowance))}</strong></div>
            <div><span>Cash advance</span><strong>${sanitize(formatMoneyOrDash(getCashAdvance(employee)))}</strong></div>
            <div><span>Loan</span><strong>${sanitize(formatMoneyOrDash(getLoan(employee)))}</strong></div>
        </div>
    `;
}

function employeePhotoUrl(employee = {}) {
    const rawUrl = String(firstPresent(employee, ['profile_photo_url', 'profilePhotoUrl', 'imagepath', 'photo_url', 'avatar_url']) || '').trim();
    const updatedAt = String(firstPresent(employee, ['profile_photo_updated_at', 'profilePhotoUpdatedAt']) || '').trim();
    if (!rawUrl || !updatedAt || rawUrl.includes('v=')) return rawUrl;
    return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(updatedAt)}`;
}

function resolveEmployeePhotoSrc(value) {
    const src = String(value || '').trim();
    if (!src) return '';
    if (/^(https?:|data:image\/|blob:)/i.test(src)) return src;
    if (src.startsWith('/')) return src;
    return `/${src.replace(/^\/+/, '')}`;
}

function renderEmployeePhotoControl(employee = {}, fallback = 'E', options = {}) {
    const employeeId = String(employee.id || employee._docId || HR_STATE.editingEmployeeId || '').trim();
    const photoSrc = resolveEmployeePhotoSrc(employeePhotoUrl(employee));
    const disabled = options.disabled || !employeeId || HR_STATE.employeeModalMode === 'create';
    const editLabel = disabled ? 'Save First' : 'Edit';
    return `
        <div class="hr-employee-photo-block">
            <span class="hr-employee-avatar ${photoSrc ? 'has-photo' : ''}">
                ${photoSrc
                    ? `<img src="${sanitize(photoSrc)}" alt="${sanitize(MargaUtils.getEmployeeFullName(employee, 'Employee'))} photo">`
                    : sanitize(String(fallback || 'E').charAt(0).toUpperCase())}
            </span>
            <button type="button" class="hr-photo-edit-btn" data-employee-photo-edit data-employee-id="${sanitize(employeeId)}" ${disabled ? 'disabled' : ''}>${editLabel}</button>
            <input type="file" accept="image/*" data-employee-photo-input data-employee-id="${sanitize(employeeId)}" hidden>
        </div>
    `;
}

function handleEmployeePhotoClick(event) {
    const button = event.target.closest('[data-employee-photo-edit]');
    if (!button || button.disabled) return;
    const input = button.parentElement?.querySelector('[data-employee-photo-input]');
    input?.click();
}

function handleEmployeePhotoChange(event) {
    const input = event.target.closest('[data-employee-photo-input]');
    if (!input) return;
    uploadEmployeePhoto(input);
}

async function uploadEmployeePhoto(input) {
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    const docId = String(input.dataset.employeeId || HR_STATE.editingEmployeeId || '').trim();
    const employee = findEmployeeById(docId);
    const status = document.getElementById('employeeModalStatus');
    if (!docId || !employee) {
        if (status) status.textContent = 'Save the employee first before uploading a photo.';
        return;
    }
    if (!String(file.type || '').startsWith('image/')) {
        if (status) status.textContent = 'Only image files can be uploaded as employee photos.';
        return;
    }
    if (file.size > 12_000_000) {
        if (status) status.textContent = 'Photo is too large. Use an image under 12 MB.';
        return;
    }
    try {
        if (status) status.textContent = 'Uploading employee photo...';
        const dataUrl = await prepareEmployeePhotoDataUrl(file);
        const response = await fetch('/margabase-api/admin/employee-photos/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: docId,
                employeeName: MargaUtils.getEmployeeFullName(employee, docId),
                originalName: file.name || 'employee-photo',
                dataUrl
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) throw new Error(payload?.error?.message || payload?.error || 'Photo upload failed.');
        const asset = payload.asset || {};
        const nowIso = new Date().toISOString();
        const basePhotoUrl = String(asset.file_url || '').trim();
        const photoUrl = basePhotoUrl.includes('v=')
            ? basePhotoUrl
            : `${basePhotoUrl}${basePhotoUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(nowIso)}`;
        const photoPath = String(asset.storage_relative_path || '').trim();
        if (!photoUrl || !photoPath) throw new Error('Photo upload did not return a storage path.');
        const patch = {
            imagepath: photoUrl,
            profile_photo_url: photoUrl,
            profile_photo_path: photoPath,
            profile_photo_updated_at: nowIso,
            hr_updated_at: nowIso,
            hr_updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr',
            marga_updated_at: nowIso
        };
        await patchDocument('tbl_employee', docId, patch);
        Object.assign(employee, patch);
        await persistActiveEmployeeSummary(HR_STATE.employees);
        document.getElementById('employeeModalBrief').innerHTML = renderEmployeeBrief(employee);
        renderEmployees();
        if (status) status.textContent = 'Employee photo saved.';
    } catch (error) {
        console.error('Employee photo upload failed:', error);
        if (status) status.textContent = `Photo upload failed: ${error.message || error}`;
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read selected photo.'));
        reader.readAsDataURL(file);
    });
}

async function prepareEmployeePhotoDataUrl(file) {
    const sourceUrl = await readFileAsDataUrl(file);
    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unable to load selected photo.'));
        img.src = sourceUrl;
    });
    const size = 640;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(0, 0, size, size);
    const sourceSize = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const sx = Math.max(0, ((image.naturalWidth || image.width) - sourceSize) / 2);
    const sy = Math.max(0, ((image.naturalHeight || image.height) - sourceSize) / 2);
    ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.86);
}

function closeEmployeeModal() {
    HR_STATE.editingEmployeeId = '';
    HR_STATE.employeeModalMode = 'edit';
    resetEmployeeDeductionForm();
    renderEmployeeDeductions('');
    renderEmployeeDeductionPrefills(null);
    setModalOpen('employeeModal', 'employeeModalOverlay', false);
}

async function saveEmployeeDetails() {
    const mode = HR_STATE.employeeModalMode || 'edit';
    const docId = mode === 'create' ? valueOf('employeeIdInput') : document.getElementById('employeeDocId').value;
    if (!docId) return;
    const status = document.getElementById('employeeModalStatus');
    const saveBtn = document.getElementById('employeeModalSaveBtn');
    status.textContent = mode === 'create' ? 'Creating employee...' : 'Saving employee details...';
    saveBtn.disabled = true;
    const nowIso = new Date().toISOString();
    const accountActive = valueOf('employeeAccountStatusInput') !== 'inactive';
    const newPassword = valueOf('employeePasswordInput');
    const confirmPassword = valueOf('employeePasswordConfirmInput');
    const firstName = valueOf('employeeFirstNameInput');
    const lastName = valueOf('employeeLastNameInput');
    const email = valueOf('employeeEmailInput');
    const username = valueOf('employeeUsernameInput');
    if (!firstName || !lastName) {
        status.textContent = 'First name and last name are required.';
        saveBtn.disabled = false;
        return;
    }
    if (mode === 'create' && findEmployeeById(docId)) {
        status.textContent = `Employee ID ${docId} already exists. Refresh the HR list and try again.`;
        saveBtn.disabled = false;
        return;
    }
    const fields = {
        id: docId,
        firstname: firstName,
        lastname: lastName,
        nickname: valueOf('employeeNicknameInput'),
        email,
        marga_login_email: email,
        username,
        marga_active: accountActive,
        marga_account_active: accountActive,
        active: accountActive,
        estatus: accountActive ? 1 : 0,
        mobile: valueOf('employeeMobileInput'),
        birthdate: valueOf('employeeBirthdateInput'),
        civil_status: valueOf('employeeCivilStatusInput'),
        address: valueOf('employeeAddressInput'),
        position_name: valueOf('employeePositionInput'),
        hire_date: valueOf('employeeHireDateInput'),
        rate_type: valueOf('employeeRateTypeInput'),
        monthly_salary: numberOrBlank('employeeMonthlySalaryInput'),
        semi_monthly_rate: numberOrBlank('employeeSemiMonthlyRateInput'),
        semim_rate: numberOrBlank('employeeSemiMonthlyRateInput'),
        daily_rate: numberOrBlank('employeeDailyRateInput'),
        allowance: numberOrBlank('employeeAllowanceInput'),
        bank_account_no: valueOf('employeeBankAccountInput'),
        sss_no: valueOf('employeeSssInput'),
        philhealth_no: valueOf('employeePhilhealthInput'),
        pagibig_no: valueOf('employeePagibigInput'),
        tin_no: valueOf('employeeTinInput'),
        payroll_sss_amount: numberOrBlank('employeeSssDeductionInput'),
        payroll_mandatory_sss_provident: numberOrBlank('employeeMandatorySssProvidentInput'),
        payroll_phic_amount: numberOrBlank('employeePhilhealthDeductionInput'),
        payroll_hdmf_amount: numberOrBlank('employeePagibigDeductionInput'),
        payroll_withholding_tax: numberOrBlank('employeeWithholdingTaxInput'),
        payroll_nontax_allowance: numberOrBlank('employeeNontaxAllowanceInput'),
        payroll_tax_refund: numberOrBlank('employeeTaxRefundInput'),
        payroll_philhealth_adjustment: numberOrBlank('employeePhilhealthAdjustmentInput'),
        payroll_tshirt_deduction: numberOrBlank('employeeTshirtDeductionInput'),
        payroll_other_deduction: numberOrBlank('employeeOtherDeductionInput'),
        payroll_house_rental: numberOrBlank('employeeHouseRentalInput'),
        payroll_tax_adjustment: numberOrBlank('employeeTaxAdjustmentInput'),
        payroll_deduction_adjustment: numberOrBlank('employeeDeductionAdjustmentInput'),
        emergency_contact_name: valueOf('employeeEmergencyNameInput'),
        emergency_contact_phone: valueOf('employeeEmergencyPhoneInput'),
        hr_notes: valueOf('employeeNotesInput'),
        hr_updated_at: nowIso,
        hr_updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
    };
    try {
        if (newPassword || confirmPassword) {
            Object.assign(fields, await buildEmployeePasswordFields(newPassword, confirmPassword, nowIso));
        }
        if (mode === 'create') {
            Object.assign(fields, {
                created_at: nowIso,
                hr_created_at: nowIso,
                hr_created_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
            });
            await setDocument('tbl_employee', docId, fields);
            HR_STATE.employees.push({ _docId: docId, ...fields });
            document.getElementById('employeeDocId').value = docId;
            HR_STATE.editingEmployeeId = docId;
            HR_STATE.employeeModalMode = 'edit';
            document.getElementById('employeeModalTitle').textContent = MargaUtils.getEmployeeFullName(fields, docId);
            document.getElementById('employeeModalSubtitle').textContent = 'This edits tbl_employee, the same employee source used by Service, Billing, Collections, Schedule, login, and Field App assignment.';
            document.getElementById('employeeModalSaveBtn').textContent = 'Save Employee';
        } else {
            await patchDocument('tbl_employee', docId, fields);
            const employee = findEmployeeById(docId);
            if (employee) Object.assign(employee, fields);
        }
        await persistActiveEmployeeSummary(HR_STATE.employees);
        renderEmployees();
        mountHrTimeRecordsPane();
        renderPayrollModel();
        document.getElementById('employeeModalBrief').innerHTML = renderEmployeeBrief(findEmployeeById(docId) || { ...fields, _docId: docId });
        renderEmployeeDeductions(docId);
        status.textContent = mode === 'create' ? 'Employee created.' : 'Employee details saved.';
    } catch (error) {
        console.error('Employee save failed:', error);
        status.textContent = `Save failed: ${error.message || error}`;
        alert(`Save failed: ${error.message || error}`);
    } finally {
        saveBtn.disabled = false;
    }
}

async function buildEmployeePasswordFields(newPassword, confirmPassword, nowIso) {
    if (!newPassword || !confirmPassword) {
        throw new Error('Enter and confirm the new login password.');
    }
    if (newPassword !== confirmPassword) {
        throw new Error('New password and confirmation do not match.');
    }
    if (newPassword.length < 4) {
        throw new Error('Use at least 4 characters for staff login passwords.');
    }
    if (!MargaAuth.canHashPasswords()) {
        throw new Error('Password reset requires HTTPS or localhost so the browser can create the secure password hash.');
    }
    const iterations = 120000;
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = await MargaAuth.pbkdf2(newPassword, salt, iterations);
    return {
        password: '',
        password_hash: MargaAuth.bytesToBase64(hash),
        password_salt: MargaAuth.bytesToBase64(salt),
        password_iterations: iterations,
        password_updated_at: nowIso,
        password_updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
    };
}

function openPerformanceModal(employeeId) {
    const employee = findEmployeeById(employeeId);
    if (!employee) return;
    const row = HR_STATE.performanceRows.find((item) => String(item.employee.id || item.employee._docId || '') === String(employeeId)) || buildPerformanceRow(employee);
    document.getElementById('performanceModalTitle').textContent = MargaUtils.getEmployeeFullName(employee, employeeId);
    document.getElementById('performanceModalSubtitle').textContent = `${getPerformanceDate()} review · ${row.assignedCount.toLocaleString()} schedule(s), ${row.finishBlocks.length.toLocaleString()} blocked finish attempt(s).`;
    document.getElementById('performanceDetailContent').innerHTML = renderPerformanceDetail(row);
    setModalOpen('performanceModal', 'performanceModalOverlay', true);
}

function closePerformanceModal() {
    setModalOpen('performanceModal', 'performanceModalOverlay', false);
}

function renderPerformanceDetail(row) {
    if (!row) return '<div class="ops-subtext">No Field App records found for this staff member yet.</div>';
    const events = row.events || [];
    const schedules = row.schedules || [];
    const blocks = row.finishBlocks || [];
    return `
        <div class="hr-performance-summary">
            <div><span>Attendance</span><strong>${sanitize(row.attendanceLabel)}</strong></div>
            <div><span>Finished</span><strong>${row.finishedCount}/${row.assignedCount}</strong></div>
            <div><span>Recommendation</span><strong>${sanitize(row.recommendation)}</strong></div>
        </div>
        <div class="hr-modal-section">
            <h3>Reason For Review</h3>
            <p class="ops-subtext">${row.flags.length ? sanitize(row.flags.join(', ')) : 'No major flags for selected date.'}</p>
        </div>
        ${blocks.length ? `
            <div class="hr-modal-section">
                <h3>Blocked Mark Finished Attempts</h3>
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>Time</th><th>Purpose</th><th>Reason</th></tr></thead>
                        <tbody>${blocks.map((block) => `<tr><td>${sanitize(block.blocked_at || '-')}</td><td>${sanitize(block.purpose_label || '-')}</td><td>${sanitize(block.reason || '-')}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>
        ` : ''}
        <div class="table-container">
            <table class="table">
                <thead><tr><th>Schedule</th><th>Purpose</th><th>Status</th><th>Customer / Company</th><th>Branch</th></tr></thead>
                <tbody>
                    ${schedules.slice(0, 80).map((schedule) => {
                        const context = resolveEventContext(schedule);
                        return `
                            <tr>
                                <td>${sanitize(schedule.id || schedule._docId || '-')}</td>
                                <td>${sanitize(schedule.purpose_label || schedule.purpose || schedule.purpose_id || '-')}</td>
                                <td>${isScheduleFinished(schedule) ? 'Finished' : 'Open'}</td>
                                <td>${sanitize(context.company || '-')}</td>
                                <td>${sanitize(context.branch || '-')}</td>
                            </tr>
                        `;
                    }).join('') || '<tr><td colspan="5">No schedules for selected date.</td></tr>'}
                </tbody>
            </table>
        </div>
        <div class="table-container">
            <table class="table">
                <thead><tr><th>Field Event Time</th><th>Action</th><th>Customer / Company</th><th>Branch</th><th>GPS</th></tr></thead>
                <tbody>
                    ${events.slice(0, 80).map((event) => {
                        const context = resolveEventContext(event);
                        const gps = hasCoordinates(event) ? `${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}` : '-';
                        return `
                            <tr>
                                <td>${sanitize(event.occurred_at || event.local_date || '-')}</td>
                                <td>${sanitize(event.action || event.status_label || '-')}</td>
                                <td>${sanitize(context.company || '-')}</td>
                                <td>${sanitize(context.branch || '-')}</td>
                                <td>${sanitize(gps)}</td>
                            </tr>
                        `;
                    }).join('') || '<tr><td colspan="5">No field event records for selected date.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function getSalaryRate(employee) {
    return firstPresent(employee, [
        'monthly_salary',
        'monthly_rate',
        'basic_salary',
        'semi_monthly_rate',
        'semim_rate',
        'semimrate',
        'salary_rate',
        'salary',
        'daily_rate',
        'rate',
        'marga_salary_rate',
        'marga_daily_rate',
        'payroll_rate'
    ]);
}

function getRateType(employee) {
    return firstPresent(employee, [
        'rate_type',
        'salary_type',
        'pay_type',
        'payroll_rate_type',
        'marga_rate_type'
    ]) || inferRateType(employee);
}

function getAllowance(employee) {
    return firstPresent(employee, [
        'allowance',
        'daily_allowance',
        'meal_allowance',
        'transportation_allowance',
        'marga_allowance'
    ]);
}

function getCashAdvance(employee) {
    const period = getPayrollPeriod();
    const totals = getEmployeeDeductionTotals(employee, period);
    return totals.cashAdvance || firstPresent(employee, ['cash_advance', 'cash_adv', 'cashadvance', 'employee_cash_advance']);
}

function getLoan(employee) {
    const period = getPayrollPeriod();
    const totals = getEmployeeDeductionTotals(employee, period);
    return roundMoney(totals.bankLoan + totals.sssLoan + totals.pagibigLoan + totals.coopLoan)
        || firstPresent(employee, ['bank_loan', 'loan', 'employee_loan', 'salary_loan']);
}

function allocateNextEmployeeId() {
    const highestId = HR_STATE.employees.reduce((max, employee) => {
        const numericId = Number(String(employee.id || employee._docId || '').trim());
        return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
    }, 0);
    return String(highestId + 1);
}

function normalizeEmployeeDeduction(record = {}) {
    const totalAmount = roundMoney(toNumber(firstPresent(record, ['total_amount', 'totalAmount', 'loan_amount'])));
    const rawBalance = firstPresent(record, ['balance_amount', 'balanceAmount', 'remaining_balance']);
    const rawStatus = String(firstPresent(record, ['status']) || 'active').trim();
    const balanceAmount = rawBalance === ''
        ? (rawStatus === 'setup_needed' && totalAmount <= 0 ? '' : totalAmount)
        : roundMoney(toNumber(rawBalance));
    const deductionPerPayroll = roundMoney(toNumber(firstPresent(record, ['deduction_per_payroll', 'deductionPerPayroll', 'monthly_deduction'])));
    const transactions = Array.isArray(record.transactions) ? record.transactions : [];
    return {
        _docId: String(record._docId || record.id || '').trim(),
        employeeId: String(firstPresent(record, ['employee_id', 'employeeId'])).trim(),
        employeeName: String(firstPresent(record, ['employee_name', 'employeeName'])).trim(),
        type: String(firstPresent(record, ['type']) || 'other_loan').trim(),
        source: String(firstPresent(record, ['source', 'lender', 'provider_name']) || '').trim(),
        totalAmount,
        balanceAmount,
        deductionPerPayroll,
        startDate: String(firstPresent(record, ['start_date', 'startDate']) || '').trim(),
        reference: String(firstPresent(record, ['reference', 'ref_no']) || '').trim(),
        status: rawStatus,
        remarks: String(firstPresent(record, ['remarks', 'notes']) || '').trim(),
        transactions: transactions.map((entry) => ({
            cutoffKey: String(firstPresent(entry, ['cutoffKey']) || '').trim(),
            payrollFrom: String(firstPresent(entry, ['payrollFrom']) || '').trim(),
            payrollTo: String(firstPresent(entry, ['payrollTo']) || '').trim(),
            amount: roundMoney(toNumber(firstPresent(entry, ['amount']))),
            postedAt: String(firstPresent(entry, ['postedAt']) || '').trim(),
            postedBy: String(firstPresent(entry, ['postedBy']) || '').trim()
        }))
    };
}

function normalizePayrollDisbursement(record = {}) {
    return {
        _docId: String(record._docId || record.id || '').trim(),
        periodFrom: String(firstPresent(record, ['period_from', 'periodFrom']) || '').trim(),
        periodTo: String(firstPresent(record, ['period_to', 'periodTo']) || '').trim(),
        periodKey: String(firstPresent(record, ['period_key', 'periodKey']) || '').trim(),
        staffId: String(firstPresent(record, ['staff_id', 'staffId', 'employee_id']) || '').trim(),
        staffName: String(firstPresent(record, ['staff_name', 'staffName', 'employee_name']) || '').trim(),
        payrollName: String(firstPresent(record, ['payroll_name', 'payrollName']) || '').trim(),
        amount: roundMoney(toNumber(firstPresent(record, ['amount', 'paid_amount']))),
        paidOn: String(firstPresent(record, ['paid_on', 'paidOn', 'date_paid']) || '').trim(),
        remarks: String(firstPresent(record, ['remarks', 'note']) || '').trim(),
        netSalarySnapshot: roundMoney(toNumber(firstPresent(record, ['net_salary_snapshot', 'netSalarySnapshot']))),
        createdAt: String(firstPresent(record, ['created_at', 'createdAt']) || '').trim(),
        createdBy: String(firstPresent(record, ['created_by', 'createdBy']) || '').trim()
    };
}

function getPayrollDisbursements(period = getPayrollPeriod()) {
    const key = payrollPeriodKey(period);
    return HR_STATE.payrollDisbursements
        .filter((item) => item.periodKey === key || (item.periodFrom === period.from && item.periodTo === period.to))
        .sort((left, right) => String(right.paidOn || right.createdAt || '').localeCompare(String(left.paidOn || left.createdAt || '')));
}

function getPayrollDisbursementSummaryMap(period = getPayrollPeriod()) {
    const map = new Map();
    getPayrollDisbursements(period).forEach((item) => {
        const staffKey = String(item.staffId || '').trim();
        if (!staffKey) return;
        const current = map.get(staffKey) || { totalPaid: 0, entries: [] };
        current.totalPaid = roundMoney(current.totalPaid + item.amount);
        current.entries.push(item);
        map.set(staffKey, current);
    });
    return map;
}

function getPayrollRowPaymentState(row, summaryMap = new Map()) {
    const summary = summaryMap.get(String(row.id || '').trim()) || { totalPaid: 0, entries: [] };
    const paidAmount = roundMoney(summary.totalPaid || 0);
    const balanceAmount = roundMoney(Math.max(0, roundMoney(row.netSalary) - paidAmount));
    return {
        paidAmount,
        balanceAmount,
        entries: summary.entries
    };
}

async function promptPayrollDisbursement(row, paymentState, period = getPayrollPeriod()) {
    const maxAmount = roundMoney(Math.max(0, paymentState.balanceAmount));
    if (!(maxAmount > 0)) {
        alert('This payroll line is already fully disbursed.');
        return;
    }
    const amountInput = window.prompt(`Disburse amount for ${row.name}\nAvailable balance: ${formatMoneyOrDash(maxAmount)}`, String(maxAmount));
    if (amountInput === null) return;
    const amount = roundMoney(toNumber(amountInput));
    if (!(amount > 0)) {
        alert('Enter a valid disbursement amount.');
        return;
    }
    if (amount > maxAmount) {
        alert(`Amount exceeds the remaining balance of ${formatMoneyOrDash(maxAmount)}.`);
        return;
    }
    const paidOn = String(window.prompt('Paid date (YYYY-MM-DD)', todayDateKey()) || '').trim() || todayDateKey();
    const remarks = String(window.prompt('Remarks / reference (optional)', '') || '').trim();
    const docId = `payroll-disbursement-${period.from}-${period.to}-${row.id}-${Date.now()}`;
    const createdBy = MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr';
    await setDocument(PAYROLL_DISBURSEMENTS_COLLECTION, docId, {
        period_from: period.from,
        period_to: period.to,
        period_key: payrollPeriodKey(period),
        staff_id: String(row.id || '').trim(),
        staff_name: row.name,
        payroll_name: row.name,
        amount,
        paid_on: paidOn,
        remarks,
        net_salary_snapshot: roundMoney(row.netSalary),
        created_at: new Date().toISOString(),
        created_by: createdBy
    });
    HR_STATE.payrollDisbursements.unshift(normalizePayrollDisbursement({
        _docId: docId,
        period_from: period.from,
        period_to: period.to,
        period_key: payrollPeriodKey(period),
        staff_id: String(row.id || '').trim(),
        staff_name: row.name,
        payroll_name: row.name,
        amount,
        paid_on: paidOn,
        remarks,
        net_salary_snapshot: roundMoney(row.netSalary),
        created_at: new Date().toISOString(),
        created_by: createdBy
    }));
    renderPayrollModel();
}

function getEmployeeDeductions(employeeId) {
    const id = String(employeeId || '').trim();
    return HR_STATE.employeeDeductions
        .filter((item) => item.employeeId === id)
        .sort((left, right) => left.type.localeCompare(right.type) || left.source.localeCompare(right.source));
}

function findEmployeeDeduction(docId) {
    const id = String(docId || '').trim();
    return HR_STATE.employeeDeductions.find((item) => item._docId === id) || null;
}

function getEmployeeDeductionTotals(employee, period = getPayrollPeriod()) {
    const totals = {
        cashAdvance: 0,
        sssLoan: 0,
        pagibigLoan: 0,
        bankLoan: 0,
        coopLoan: 0
    };
    getEmployeeDeductions(employee.id || employee._docId || '')
        .filter((item) => isDeductionActiveForPeriod(item, period))
        .forEach((item) => {
            const amount = getDeductionAmountForPeriod(item);
            if (item.type === 'cash_advance') totals.cashAdvance += amount;
            else if (item.type === 'sss_loan') totals.sssLoan += amount;
            else if (item.type === 'pagibig_loan') totals.pagibigLoan += amount;
            else if (item.type === 'coop_loan') totals.coopLoan += amount;
            else totals.bankLoan += amount;
        });
    Object.keys(totals).forEach((key) => {
        totals[key] = roundMoney(totals[key]);
    });
    return totals;
}

function getPayrollDeductionRegister(period = getPayrollPeriod()) {
    return HR_STATE.employeeDeductions
        .filter((item) => isDeductionActiveForPeriod(item, period))
        .map((item) => ({
            employeeId: item.employeeId,
            employeeName: item.employeeName || MargaUtils.getEmployeeFullName(findEmployeeById(item.employeeId) || {}, item.employeeId),
            typeLabel: deductionTypeLabel(item.type),
            reference: item.reference || '-',
            amount: getDeductionAmountForPeriod(item),
            sourceLabel: item.source || 'Employee deduction plan'
        }))
        .filter((row) => row.amount > 0)
        .sort((left, right) => left.employeeName.localeCompare(right.employeeName) || left.typeLabel.localeCompare(right.typeLabel));
}

function deductionSourceLabel(type) {
    return {
        cash_advance: 'Office',
        sss_loan: 'SSS',
        pagibig_loan: 'Pag-IBIG',
        bank_loan: 'Bank',
        coop_loan: 'Coop',
        other_loan: 'Other'
    }[String(type || '').trim()] || 'Employee deduction plan';
}

function isDeductionActiveForPeriod(item, period = getPayrollPeriod()) {
    if (!item || item.status !== 'active') return false;
    if (item.balanceAmount <= 0) return false;
    if (!item.startDate) return true;
    return item.startDate <= period.to;
}

function getDeductionAmountForPeriod(item) {
    return roundMoney(Math.max(0, Math.min(toNumber(item.deductionPerPayroll), toNumber(item.balanceAmount))));
}

function deductionTypeLabel(type) {
    return {
        cash_advance: 'Cash Advance',
        sss_loan: 'SSS Loan',
        pagibig_loan: 'Pag-IBIG Loan',
        bank_loan: 'Bank Loan',
        coop_loan: 'Coop Loan',
        other_loan: 'Other Loan'
    }[String(type || '').trim()] || 'Loan';
}

function getEmployeeDeductionPrefills(employee) {
    if (!employee) return [];
    const employeeId = String(employee.id || employee._docId || '').trim();
    return PAYROLL_DEDUCTION_PREFILL_FIELDS
        .map((config) => {
            const amount = roundMoney(toNumber(firstPresent(employee, config.amountKeys)));
            if (amount <= 0) return null;
            const hasPlan = getEmployeeDeductions(employeeId).some((item) => item.type === config.type);
            if (hasPlan) return null;
            return {
                ...config,
                employeeId,
                amount,
                source: firstPresent(employee, ['payroll_deduction_prefill_source']) || PAYROLL_RATE_SOURCE,
                lenderSource: deductionSourceLabel(config.type)
            };
        })
        .filter(Boolean);
}

function renderEmployeeDeductionPrefills(employee) {
    const root = document.getElementById('employeeDeductionPrefills');
    if (!root) return;
    const suggestions = getEmployeeDeductionPrefills(employee);
    if (!suggestions.length) {
        root.innerHTML = '';
        return;
    }
    root.innerHTML = `
        <header>
            <div>
                <h4>Suggested From Payroll Workbook</h4>
                <p>Click a suggestion to prefill the deduction plan. Accounting can fill the total loan/advance and remaining balance later.</p>
            </div>
        </header>
        <div class="hr-deduction-prefill-list">
            ${suggestions.map((item) => `
                <button type="button" class="hr-deduction-prefill-btn" data-deduction-prefill="${sanitize(item.employeeId)}" data-deduction-prefill-type="${sanitize(item.type)}">
                    <span>${sanitize(item.title)}</span>
                    <small>${sanitize(formatMoneyOrDash(item.amount))} / payroll</small>
                </button>
            `).join('')}
        </div>
    `;
}

function applyEmployeeDeductionPrefill(employeeId, type) {
    const employee = findEmployeeById(employeeId);
    const suggestion = getEmployeeDeductionPrefills(employee).find((item) => item.type === type);
    if (!suggestion) return;
    fillEmployeeDeductionFormFromSuggestion(suggestion);
    document.getElementById('employeeDeductionStatus').textContent = `${deductionTypeLabel(suggestion.type)} prefilled at ${formatMoneyOrDash(suggestion.amount)} per payroll. Save as Setup Needed now, then Accounting can fill total and current balance later before activating it.`;
}

function fillEmployeeDeductionFormFromSuggestion(suggestion) {
    const period = getPayrollPeriod();
    setInputValue('employeeDeductionTypeInput', suggestion.type);
    setInputValue('employeeDeductionSourceInput', suggestion.lenderSource || suggestion.sourceLabel || deductionSourceLabel(suggestion.type));
    setInputValue('employeeDeductionTotalInput', '');
    setInputValue('employeeDeductionPerPayrollInput', suggestion.amount ? String(suggestion.amount) : '');
    setInputValue('employeeDeductionBalanceInput', '');
    setInputValue('employeeDeductionStartDateInput', period.from);
    setInputValue('employeeDeductionReferenceInput', suggestion.source);
    setInputValue('employeeDeductionStatusInput', 'setup_needed');
    setInputValue('employeeDeductionRemarksInput', `Prefilled from ${suggestion.source}. Confirm total loan/advance and current balance before saving.`);
}

function resetEmployeeDeductionForm() {
    HR_STATE.editingDeductionDocId = '';
    [
        'employeeDeductionSourceInput',
        'employeeDeductionTotalInput',
        'employeeDeductionPerPayrollInput',
        'employeeDeductionBalanceInput',
        'employeeDeductionStartDateInput',
        'employeeDeductionReferenceInput',
        'employeeDeductionRemarksInput'
    ].forEach((id) => setInputValue(id, ''));
    setInputValue('employeeDeductionTypeInput', 'cash_advance');
    setInputValue('employeeDeductionStatusInput', 'setup_needed');
    const saveButton = document.getElementById('employeeDeductionSaveBtn');
    if (saveButton) saveButton.textContent = 'Save Deduction Plan';
    const employeeId = document.getElementById('employeeDocId')?.value || '';
    document.getElementById('employeeDeductionStatus').textContent = employeeId
        ? 'Encode total amount and deduction per payroll once. Or save a Setup Needed draft when Accounting still needs to confirm the remaining balance.'
        : 'Save the employee first before adding a deduction plan.';
    renderEmployeeDeductionPrefills(findEmployeeById(employeeId));
}

function openEmployeeDeductionEditor(docId) {
    const item = findEmployeeDeduction(docId);
    if (!item) return;
    HR_STATE.editingDeductionDocId = item._docId;
    setInputValue('employeeDeductionTypeInput', item.type || 'cash_advance');
    setInputValue('employeeDeductionSourceInput', item.source || '');
    setInputValue('employeeDeductionTotalInput', item.totalAmount > 0 ? item.totalAmount : '');
    setInputValue('employeeDeductionPerPayrollInput', item.deductionPerPayroll > 0 ? item.deductionPerPayroll : '');
    setInputValue('employeeDeductionBalanceInput', item.balanceAmount === '' ? '' : item.balanceAmount);
    setInputValue('employeeDeductionStartDateInput', item.startDate || '');
    setInputValue('employeeDeductionReferenceInput', item.reference || '');
    setInputValue('employeeDeductionStatusInput', item.status || 'setup_needed');
    setInputValue('employeeDeductionRemarksInput', item.remarks || '');
    const saveButton = document.getElementById('employeeDeductionSaveBtn');
    if (saveButton) saveButton.textContent = 'Update Deduction Plan';
    document.getElementById('employeeDeductionStatus').textContent = `${deductionTypeLabel(item.type)} is open for editing.`;
}

function renderEmployeeDeductions(employeeId) {
    const tbody = document.querySelector('#employeeDeductionsTable tbody');
    const rows = employeeId ? getEmployeeDeductions(employeeId) : [];
    tbody.innerHTML = rows.length
        ? rows.map((item) => {
            const totalDeducted = roundMoney(item.totalAmount - item.balanceAmount);
            return `<tr>
                <td>${sanitize(deductionTypeLabel(item.type))}</td>
                <td>${sanitize(item.source || '-')}</td>
                <td>${sanitize(formatMoneyOrDash(item.totalAmount))}</td>
                <td>${sanitize(formatMoneyOrDash(item.deductionPerPayroll))}</td>
                <td>${sanitize(formatMoneyOrDash(item.balanceAmount))}</td>
                <td>${sanitize(item.status === 'closed' ? 'Closed' : (item.status === 'setup_needed' ? 'Setup Needed' : 'Active'))}</td>
                <td>${sanitize(formatMoneyOrDash(totalDeducted))}</td>
                <td><button type="button" class="hr-text-btn" data-deduction-edit="${sanitize(item._docId)}">Edit</button></td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="8">No deduction plans yet.</td></tr>';
}

async function saveEmployeeDeductionPlan() {
    const employeeId = document.getElementById('employeeDocId').value || '';
    const status = document.getElementById('employeeDeductionStatus');
    if (!employeeId) {
        status.textContent = 'Save the employee first before adding a deduction plan.';
        return;
    }
    const employee = findEmployeeById(employeeId);
    const totalAmount = roundMoney(toNumber(valueOf('employeeDeductionTotalInput')));
    const deductionPerPayroll = roundMoney(toNumber(valueOf('employeeDeductionPerPayrollInput')));
    const requestedBalance = valueOf('employeeDeductionBalanceInput');
    const planStatus = valueOf('employeeDeductionStatusInput') || 'setup_needed';
    const hasTotalAmount = valueOf('employeeDeductionTotalInput') !== '';
    const hasBalanceAmount = requestedBalance !== '';
    const balanceAmount = hasBalanceAmount ? roundMoney(toNumber(requestedBalance)) : (hasTotalAmount ? totalAmount : '');
    if (deductionPerPayroll <= 0) {
        status.textContent = 'Deduction per payroll is required.';
        return;
    }
    if (planStatus === 'active' && (!hasTotalAmount || !hasBalanceAmount)) {
        status.textContent = 'Active deduction plans need both total loan/advance and current balance.';
        return;
    }
    if (hasTotalAmount && totalAmount <= 0) {
        status.textContent = 'Total loan / advance must be greater than zero when provided.';
        return;
    }
    if (hasBalanceAmount && roundMoney(toNumber(requestedBalance)) < 0) {
        status.textContent = 'Current balance cannot be negative.';
        return;
    }
    const existingDocId = HR_STATE.editingDeductionDocId;
    const docId = existingDocId || `ded-${employeeId}-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const fields = {
        employee_id: employeeId,
        employee_name: MargaUtils.getEmployeeFullName(employee || {}, employeeId),
        type: valueOf('employeeDeductionTypeInput') || 'other_loan',
        source: valueOf('employeeDeductionSourceInput'),
        total_amount: hasTotalAmount ? totalAmount : '',
        balance_amount: balanceAmount,
        deduction_per_payroll: deductionPerPayroll,
        start_date: valueOf('employeeDeductionStartDateInput'),
        reference: valueOf('employeeDeductionReferenceInput'),
        status: planStatus,
        remarks: valueOf('employeeDeductionRemarksInput'),
        transactions: existingDocId ? (findEmployeeDeduction(existingDocId)?.transactions || []) : []
    };
    try {
        if (existingDocId) {
            await patchDocument(EMPLOYEE_DEDUCTIONS_COLLECTION, docId, {
                ...fields,
                updated_at: nowIso,
                updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
            });
            const existing = findEmployeeDeduction(docId);
            if (existing) Object.assign(existing, normalizeEmployeeDeduction({ _docId: docId, ...existing, ...fields }));
        } else {
            await setDocument(EMPLOYEE_DEDUCTIONS_COLLECTION, docId, {
                ...fields,
                created_at: nowIso,
                created_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
            });
            HR_STATE.employeeDeductions.push(normalizeEmployeeDeduction({ _docId: docId, ...fields, created_at: nowIso }));
        }
        renderEmployeeDeductions(employeeId);
        renderPayrollModel();
        resetEmployeeDeductionForm();
        status.textContent = planStatus === 'setup_needed'
            ? 'Deduction draft saved as Setup Needed. Fill the total and current balance later, then switch to Active before payroll confirmation.'
            : `${existingDocId ? 'Deduction plan updated.' : 'Deduction plan saved.'} It will auto-apply in payroll when active.`;
    } catch (error) {
        console.error('Save employee deduction plan failed:', error);
        status.textContent = `Save failed: ${error.message || error}`;
    }
}

async function createEmployeeDeductionSuggestions() {
    const employeeId = document.getElementById('employeeDocId').value || '';
    const status = document.getElementById('employeeDeductionStatus');
    if (!employeeId) {
        status.textContent = 'Save the employee first before creating workbook deduction drafts.';
        return;
    }
    const employee = findEmployeeById(employeeId);
    const suggestions = getEmployeeDeductionPrefills(employee);
    if (!suggestions.length) {
        status.textContent = 'No workbook-based deduction drafts are waiting for this employee.';
        return;
    }
    let createdCount = 0;
    for (const suggestion of suggestions) {
        const docId = `ded-${employeeId}-${suggestion.type}-${Date.now()}-${createdCount + 1}`;
        const nowIso = new Date().toISOString();
        const fields = {
            employee_id: employeeId,
            employee_name: MargaUtils.getEmployeeFullName(employee || {}, employeeId),
            type: suggestion.type,
            source: suggestion.lenderSource || deductionSourceLabel(suggestion.type),
            total_amount: '',
            balance_amount: '',
            deduction_per_payroll: suggestion.amount,
            start_date: getPayrollPeriod().from,
            reference: suggestion.source,
            status: 'setup_needed',
            remarks: `Prefilled from ${suggestion.source}. Confirm total loan/advance and current balance before activating.`,
            transactions: [],
            created_at: nowIso,
            created_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
        };
        await setDocument(EMPLOYEE_DEDUCTIONS_COLLECTION, docId, fields);
        HR_STATE.employeeDeductions.push(normalizeEmployeeDeduction({ _docId: docId, ...fields }));
        createdCount += 1;
    }
    renderEmployeeDeductions(employeeId);
    renderEmployeeDeductionPrefills(employee);
    resetEmployeeDeductionForm();
    status.textContent = `${createdCount} workbook deduction draft(s) created as Setup Needed. Accounting can fill totals and balances later.`;
}

async function confirmPayrollRun() {
    const period = getPayrollPeriod();
    const cutoffKey = `${period.from}_to_${period.to}`;
    const userLabel = MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr';
    const activeRows = HR_STATE.employeeDeductions.filter((item) => isDeductionActiveForPeriod(item, period));
    if (!activeRows.length) {
        alert('No active employee deduction plans are ready for this payroll period.');
        return;
    }
    let postedCount = 0;
    for (const item of activeRows) {
        const existing = item.transactions.find((entry) => entry.cutoffKey === cutoffKey);
        if (existing) continue;
        const amount = getDeductionAmountForPeriod(item);
        if (amount <= 0) continue;
        const nextBalance = roundMoney(Math.max(0, item.balanceAmount - amount));
        const nextStatus = nextBalance <= 0 ? 'closed' : item.status;
        const nextTransactions = [
            ...item.transactions,
            {
                cutoffKey,
                payrollFrom: period.from,
                payrollTo: period.to,
                amount,
                postedAt: new Date().toISOString(),
                postedBy: userLabel
            }
        ];
        await patchDocument(EMPLOYEE_DEDUCTIONS_COLLECTION, item._docId, {
            balance_amount: nextBalance,
            status: nextStatus,
            transactions: nextTransactions,
            last_posted_cutoff: cutoffKey,
            updated_at: new Date().toISOString(),
            updated_by: userLabel
        });
        item.balanceAmount = nextBalance;
        item.status = nextStatus;
        item.transactions = nextTransactions;
        postedCount += 1;
    }
    renderPayrollModel();
    renderEmployeeDeductions(document.getElementById('employeeDocId').value || '');
    alert(postedCount
        ? `Payroll confirmed. ${postedCount} deduction plan(s) were posted and balances updated.`
        : 'This payroll period was already confirmed for all active deduction plans.');
}

function exportPayrollPdf() {
    if (!window.pdfMake) {
        alert('PDF export is not ready because the PDF library did not load.');
        return;
    }
    const sampleRows = buildSamplePayrollRows();
    const period = getPayrollPeriod();
    const live = getLivePayrollWindow(period);
    const cutoff = getPayrollCutoffProfile(period);
    const totals = sampleRows.reduce((sum, row) => sum + row.netSalary, 0);
    const headers = PAYROLL_PRINT_COLUMNS.map(([, label]) => ({
        text: String(label || '').toUpperCase(),
        style: 'tableHeader'
    }));
    const body = [
        headers,
        ...sampleRows.map((row) => PAYROLL_PRINT_COLUMNS.map(([key]) => ({
            text: payrollCellText(row, key),
            style: 'tableCell'
        })))
    ];
    const widthForPayrollColumn = (key) => {
        if (key === 'number') return 16;
        if (key === 'name') return 84;
        if (['semiMonthlyRate', 'dailyRate', 'totalBasic', 'totalPay', 'grossIncome', 'netSalary'].includes(key)) return 34;
        if (['sss', 'phic', 'hdmf', 'rdot', 'tshirt', 'otHours', 'otPay', 'utHours'].includes(key)) return 20;
        if (['mandatorySssProvident', 'nontaxAllowance', 'withholdingTax', 'taxRefund', 'philhealthAdjustment', 'bankLoan', 'cashAdvance', 'pagibigLoan', 'otherDeduction', 'houseRental', 'taxAdjustment', 'deductionAdjustment', 'minutesLate', 'lateDeduction', 'regularOt', 'holidayPay', 'payAdjustment', 'allowance', 'sssLoan', 'coopLoan', 'absences', 'utDeduction'].includes(key)) return 24;
        return 22;
    };
    const filename = `marga-payroll-${period.from}-to-${period.to}.pdf`;
    const docDefinition = {
        pageSize: 'LEGAL',
        pageOrientation: 'landscape',
        pageMargins: [10, 12, 10, 12],
        content: [
            { text: 'MARGA PAYROLL', style: 'title' },
            { text: `Payroll Cutoff: ${period.label}`, style: 'meta' },
            { text: `Computed Through: ${live.isFuture ? 'Not started' : formatPayrollPeriodDate(live.rangeEnd)} | Cutoff Type: ${cutoff.title} | Employees: ${sampleRows.length} | Net Salary Total: ${formatMoneyOrDash(totals)}`, style: 'meta' },
            {
                margin: [0, 8, 0, 0],
                table: {
                    headerRows: 1,
                    dontBreakRows: true,
                    widths: PAYROLL_PRINT_COLUMNS.map(([key]) => widthForPayrollColumn(key)),
                    body
                },
                layout: {
                    fillColor: (rowIndex) => (rowIndex === 0 ? '#EAF2FB' : null),
                    hLineColor: () => '#D7E2F0',
                    vLineColor: () => '#D7E2F0',
                    paddingLeft: () => 2,
                    paddingRight: () => 2,
                    paddingTop: () => 1,
                    paddingBottom: () => 1
                }
            }
        ],
        styles: {
            title: { fontSize: 14, bold: true, color: '#19345c' },
            meta: { fontSize: 7.5, color: '#41516b', margin: [0, 1, 0, 0] },
            tableHeader: { fontSize: 5.2, bold: true, color: '#1d4f82' },
            tableCell: { fontSize: 5.1, color: '#1f2937' }
        },
        defaultStyle: {
            fontSize: 5.1
        }
    };
    window.pdfMake.createPdf(docDefinition).download(filename);
}

function printEmployeeSoa() {
    const employeeId = document.getElementById('employeeDocId').value || '';
    if (!employeeId) {
        alert('Save the employee first before printing SOA.');
        return;
    }
    const employee = findEmployeeById(employeeId);
    const rows = getEmployeeDeductions(employeeId);
    if (!rows.length) {
        alert('This employee has no deduction plans yet.');
        return;
    }
    const totalLoan = roundMoney(rows.reduce((sum, item) => sum + item.totalAmount, 0));
    const totalBalance = roundMoney(rows.reduce((sum, item) => sum + item.balanceAmount, 0));
    const totalDeducted = roundMoney(totalLoan - totalBalance);
    const printable = `
        <html><head><title>Employee Deduction SOA</title><style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #123; }
            h1,h2 { margin: 0 0 8px; }
            p { margin: 0 0 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #cfdbea; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #eef5ff; }
        </style></head><body>
            <h1>MARGA Employee Deduction SOA</h1>
            <p><strong>Employee:</strong> ${sanitize(MargaUtils.getEmployeeFullName(employee || {}, employeeId))}</p>
            <p><strong>Total Loan / Advance:</strong> ${sanitize(formatMoneyOrDash(totalLoan))} | <strong>Total Deducted:</strong> ${sanitize(formatMoneyOrDash(totalDeducted))} | <strong>Remaining Balance:</strong> ${sanitize(formatMoneyOrDash(totalBalance))}</p>
            ${rows.map((item) => `
                <h2>${sanitize(deductionTypeLabel(item.type))} - ${sanitize(item.source || 'No source')}</h2>
                <p><strong>Total:</strong> ${sanitize(formatMoneyOrDash(item.totalAmount))} | <strong>Per Payroll:</strong> ${sanitize(formatMoneyOrDash(item.deductionPerPayroll))} | <strong>Balance:</strong> ${sanitize(formatMoneyOrDash(item.balanceAmount))}</p>
                <table><thead><tr><th>Cutoff</th><th>Amount Deducted</th><th>Posted At</th><th>Posted By</th></tr></thead>
                    <tbody>${item.transactions.length ? item.transactions.map((entry) => `<tr><td>${sanitize(entry.cutoffKey)}</td><td>${sanitize(formatMoneyOrDash(entry.amount))}</td><td>${sanitize(entry.postedAt || '-')}</td><td>${sanitize(entry.postedBy || '-')}</td></tr>`).join('') : '<tr><td colspan="4">No payroll deductions posted yet.</td></tr>'}</tbody>
                </table>
            `).join('')}
        </body></html>
    `;
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    if (!printWindow) {
        alert('Allow popups to print the employee deduction SOA.');
        return;
    }
    printWindow.document.open();
    printWindow.document.write(printable);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function renderLocations() {
    const list = document.getElementById('locationList');
    const preview = document.getElementById('previewLocation');
    list.innerHTML = '';
    preview.innerHTML = '';

    HR_STATE.locations.forEach((location) => {
        const item = document.createElement('article');
        item.className = 'hr-location-item';
        item.innerHTML = `
            <header>
                <div>
                    <h4>${sanitize(location.name)}</h4>
                    <p>${sanitize(location.address || 'No address set yet')}</p>
                </div>
                <span class="hr-pill ${location.isActive ? '' : 'inactive'}">${location.isActive ? 'Active' : 'Inactive'}</span>
            </header>
            <div class="hr-location-meta">
                <span class="hr-pill">${sanitize(TYPE_LABELS[location.type] || location.type)}</span>
                <span class="hr-pill">${clampAllowedMeters(location.type, location.allowedMeters)}m max</span>
                <span class="hr-pill ${hasCoordinates(location) ? '' : 'warning'}">${hasCoordinates(location) ? `${sanitize(location.latitude)}, ${sanitize(location.longitude)}` : 'Needs GPS pin'}</span>
                <span class="hr-pill">${location.requiresPincode ? 'Pincode required' : 'No pincode'}</span>
            </div>
            <div class="hr-row-actions">
                <button type="button" class="hr-text-btn" data-edit="${sanitize(location.id)}">Edit</button>
                <button type="button" class="hr-text-btn" data-toggle="${sanitize(location.id)}">${location.isActive ? 'Disable' : 'Enable'}</button>
            </div>
        `;
        list.appendChild(item);

        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = location.name;
        preview.appendChild(option);
    });

    list.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => resetLocationForm(HR_STATE.locations.find((location) => location.id === button.dataset.edit)));
    });
    list.querySelectorAll('[data-toggle]').forEach((button) => {
        button.addEventListener('click', () => toggleLocation(button.dataset.toggle));
    });

    if (!HR_STATE.locations.length) {
        list.innerHTML = '<div class="ops-subtext">No work locations saved yet.</div>';
    }
    updateOverview();
}

function updateOverview() {
    const usingSeededRoster = HR_STATE.employees.length > 0 && HR_STATE.employees.every((employee) => employee && hasSeededPayrollRate(employee));
    const activeEmployees = usingSeededRoster
        ? HR_STATE.employees.length
        : HR_STATE.employees.filter((employee) => MargaUtils.isOfficialActiveEmployee(employee)).length;
    document.getElementById('activeEmployeeCount').textContent = activeEmployees.toLocaleString();
    document.getElementById('workLocationCount').textContent = HR_STATE.fieldEvents.length.toLocaleString();
    document.getElementById('strictestGate').textContent = 'Ready';
}

async function saveLocationForm() {
    const notice = document.getElementById('formNotice');
    const type = document.getElementById('locationType').value;
    const location = normalizeLocation({
        id: document.getElementById('locationId').value || slugify(document.getElementById('locationName').value),
        name: document.getElementById('locationName').value.trim(),
        type,
        address: document.getElementById('locationAddress').value.trim(),
        latitude: document.getElementById('latitude').value,
        longitude: document.getElementById('longitude').value,
        allowedMeters: clampAllowedMeters(type, document.getElementById('allowedMeters').value),
        requiresPincode: document.getElementById('requiresPincode').checked,
        isActive: document.getElementById('isActive').checked,
        updatedAt: new Date().toISOString(),
        updatedBy: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
    });

    if (!location.name) {
        setNotice(notice, 'Location name is required.', 'error');
        return;
    }
    if (!hasCoordinates(location)) {
        setNotice(notice, 'Latitude and longitude are required before this pin can be used for time-in.', 'error');
        return;
    }

    try {
        await setDocument(WORK_LOCATIONS_COLLECTION, location.id, {
            name: location.name,
            type: location.type,
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            allowed_meters: location.allowedMeters,
            requires_pincode: location.requiresPincode,
            active: location.isActive,
            updated_at: location.updatedAt,
            updated_by: location.updatedBy
        });
        const index = HR_STATE.locations.findIndex((item) => item.id === location.id);
        if (index >= 0) HR_STATE.locations[index] = location;
        else HR_STATE.locations.push(location);
        HR_STATE.locations.sort(sortLocations);
        renderLocations();
        resetLocationForm(location);
        setNotice(notice, `${location.name} saved with a ${location.allowedMeters}m limit.`, 'success');
    } catch (error) {
        console.error('Save location failed:', error);
        setNotice(notice, `Save failed: ${error.message || error}`, 'error');
    }
}

async function toggleLocation(locationId) {
    const location = HR_STATE.locations.find((item) => item.id === locationId);
    if (!location) return;
    const nextActive = location.isActive === false;
    try {
        await setDocument(WORK_LOCATIONS_COLLECTION, location.id, {
            active: nextActive,
            updated_at: new Date().toISOString(),
            updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
        });
        location.isActive = nextActive;
        renderLocations();
    } catch (error) {
        alert(`Failed to update location: ${error.message || error}`);
    }
}

function resetLocationForm(location = null) {
    const current = normalizeLocation(location || {
        id: '',
        name: '',
        type: 'office',
        address: '',
        latitude: '',
        longitude: '',
        allowedMeters: 200,
        requiresPincode: true,
        isActive: true
    });
    document.getElementById('locationId').value = current.id || '';
    document.getElementById('locationName').value = current.name || '';
    document.getElementById('locationType').value = current.type || 'office';
    document.getElementById('locationAddress').value = current.address || '';
    document.getElementById('latitude').value = current.latitude || '';
    document.getElementById('longitude').value = current.longitude || '';
    document.getElementById('allowedMeters').value = clampAllowedMeters(current.type, current.allowedMeters);
    document.getElementById('requiresPincode').checked = current.requiresPincode !== false;
    document.getElementById('isActive').checked = current.isActive !== false;
    setNotice(document.getElementById('formNotice'), '', '');
    updateMeterLimit();
}

function updateMeterLimit() {
    const type = document.getElementById('locationType').value;
    const input = document.getElementById('allowedMeters');
    input.max = String(maxMetersForType(type));
    input.value = String(clampAllowedMeters(type, input.value));
    updateMeterLabel();
}

function updateMeterLabel() {
    document.getElementById('allowedMetersLabel').textContent = `${document.getElementById('allowedMeters').value}m`;
}

function previewEligibility() {
    const location = HR_STATE.locations.find((item) => item.id === document.getElementById('previewLocation').value);
    const result = validateTimeIn(location, {
        latitude: document.getElementById('employeeLatitude').value,
        longitude: document.getElementById('employeeLongitude').value
    });
    const element = document.getElementById('eligibilityResult');
    element.className = `hr-eligibility ${result.allowed ? 'allowed' : 'blocked'}`;
    element.textContent = result.reason;
}

function fillCurrentGps(latitudeId, longitudeId, noticeId) {
    const notice = document.getElementById(noticeId);
    if (!navigator.geolocation) {
        setNotice(notice, 'This browser does not support GPS location.', 'error');
        return;
    }
    setNotice(notice, 'Reading current GPS location...', 'neutral');
    navigator.geolocation.getCurrentPosition((position) => {
        document.getElementById(latitudeId).value = position.coords.latitude.toFixed(6);
        document.getElementById(longitudeId).value = position.coords.longitude.toFixed(6);
        setNotice(notice, `GPS captured with ${Math.round(position.coords.accuracy)}m device accuracy.`, 'success');
    }, () => {
        setNotice(notice, 'GPS permission was denied or unavailable.', 'error');
    }, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
    });
}

function validateTimeIn(location, employeePoint) {
    if (!location || location.isActive === false) return { allowed: false, reason: 'Assigned work location is inactive or missing.' };
    if (!hasCoordinates(location)) return { allowed: false, reason: `${location.name} has no pinned GPS coordinates yet.` };
    if (!hasCoordinates(employeePoint)) return { allowed: false, reason: 'Employee GPS point is missing.' };
    const allowedMeters = clampAllowedMeters(location.type, location.allowedMeters);
    const actualDistance = distanceMeters(location, employeePoint);
    if (actualDistance <= allowedMeters) {
        return {
            allowed: true,
            distanceMeters: actualDistance,
            allowedMeters,
            reason: `Allowed. Employee is ${actualDistance.toFixed(1)}m from ${location.name}.`
        };
    }
    return {
        allowed: false,
        distanceMeters: actualDistance,
        allowedMeters,
        reason: `Blocked. Employee is ${actualDistance.toFixed(1)}m away; limit is ${allowedMeters}m.`
    };
}

function normalizeLocation(location = {}) {
    return {
        id: String(location.id || location._docId || slugify(location.name || '')).trim(),
        name: String(location.name || '').trim(),
        type: String(location.type || 'office').trim(),
        address: String(location.address || '').trim(),
        latitude: String(location.latitude ?? '').trim(),
        longitude: String(location.longitude ?? '').trim(),
        allowedMeters: clampAllowedMeters(location.type || 'office', location.allowedMeters ?? location.allowed_meters ?? 20),
        requiresPincode: location.requiresPincode ?? location.requires_pincode ?? true,
        isActive: location.isActive ?? location.active ?? true,
        updatedAt: location.updatedAt || location.updated_at || ''
    };
}

function maxMetersForType(type) {
    if (type === 'customer_site' || type === 'temporary_site') return CUSTOMER_SITE_MAX_METERS;
    if (type === 'production') return PRODUCTION_MAX_METERS;
    return OFFICE_MAX_METERS;
}

function clampAllowedMeters(type, value) {
    const numericValue = Number(value) || 5;
    return Math.min(Math.max(Math.round(numericValue), 5), maxMetersForType(type));
}

function distanceMeters(from, to) {
    const earthRadiusMeters = 6371000;
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const deltaLat = toRadians(Number(to.latitude) - Number(from.latitude));
    const deltaLng = toRadians(Number(to.longitude) - Number(from.longitude));
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
        + Math.cos(lat1) * Math.cos(lat2)
        * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
}

function hasCoordinates(value) {
    return value
        && value.latitude !== ''
        && value.longitude !== ''
        && Number.isFinite(Number(value.latitude))
        && Number.isFinite(Number(value.longitude));
}

function firstPresent(record, keys) {
    for (const key of keys) {
        const value = record?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
}

function inferRateType(employee) {
    if (firstPresent(employee, ['monthly_salary', 'basic_monthly', 'monthly_rate'])) return 'Monthly';
    if (firstPresent(employee, ['daily_rate', 'marga_daily_rate'])) return 'Daily';
    if (firstPresent(employee, ['hourly_rate'])) return 'Hourly';
    return '';
}

function formatMoneyOrDash(value) {
    const numeric = Number(String(value ?? '').replace(/,/g, ''));
    if (!Number.isFinite(numeric) || numeric === 0 && String(value ?? '').trim() === '') return '-';
    if (Number.isFinite(numeric)) {
        return `PHP ${numeric.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value || '-');
}

function toNumber(value) {
    const numeric = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeStaffKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9@.]+/g, '');
}

function getPerformanceSignal(eventCount) {
    if (eventCount >= 20) return 'Strong app activity';
    if (eventCount >= 5) return 'Enough data for review';
    if (eventCount > 0) return 'Light data only';
    return 'Waiting for app events';
}

function parsePastedTable(text) {
    const rows = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim())
        .map((line) => line.includes('\t') ? line.split('\t') : line.split(','));
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((header) => String(header || '').trim()).filter(Boolean);
    return {
        headers,
        rows: rows.slice(1).filter((row) => row.some((cell) => String(cell || '').trim()))
    };
}

function detectPayrollColumns(headers) {
    const find = (...patterns) => {
        const match = headers.find((header) => patterns.some((pattern) => pattern.test(String(header || '').toLowerCase())));
        return match || '';
    };
    return {
        employee: find(/employee|name|staff/),
        salaryRate: find(/salary.*rate|daily.*rate|monthly.*rate|basic.*pay|basic.*salary|\brate\b/),
        daysWorked: find(/days.*work|work.*days|present|attendance/),
        approvedOvertime: find(/approved.*overtime|overtime.*authorization|\bot\b/),
        allowance: find(/allowance|meal|transport/),
        grossPay: find(/gross/),
        sss: find(/\bsss\b/),
        philHealth: find(/phil.?health/),
        pagIbig: find(/pag.?ibig|hdmf/),
        deduction: find(/deduction|advance|loan|cash.*advance/),
        netPay: find(/net.*pay|take.*home|amount.*due/)
    };
}

function formatDetectedLabel(key) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? '';
}

function valueOf(id) {
    return String(document.getElementById(id)?.value || '').trim();
}

function numberOrBlank(id) {
    const raw = valueOf(id);
    if (!raw) return '';
    const value = Number(raw);
    return Number.isFinite(value) ? value : '';
}

function toDateInputValue(value) {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value || '').trim();
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function setModalOpen(modalId, overlayId, isOpen) {
    const modal = document.getElementById(modalId);
    const overlay = document.getElementById(overlayId);
    modal?.classList.toggle('open', isOpen);
    overlay?.classList.toggle('visible', isOpen);
    modal?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function toRadians(value) {
    return Number(value) * Math.PI / 180;
}

function setNotice(element, message, mode) {
    element.textContent = message;
    if (element.id === 'eligibilityResult') {
        element.className = `hr-eligibility ${mode === 'success' ? 'allowed' : mode === 'error' ? 'blocked' : 'neutral'}`;
        return;
    }
    element.className = `hr-form-notice ${mode || ''}`;
}

function sortLocations(left, right) {
    return String(left.name || '').localeCompare(String(right.name || ''));
}

function slugify(value) {
    return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `location-${Date.now()}`;
}

function sanitize(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    if (typeof value === 'object') {
        const fields = {};
        Object.entries(value).forEach(([key, child]) => {
            fields[key] = toFirestoreFieldValue(child);
        });
        return { mapValue: { fields } };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    return { stringValue: String(value ?? '') };
}

async function setDocument(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    return payload;
}

async function patchDocument(collection, docId, fields) {
    const updateKeys = Object.keys(fields);
    if (!updateKeys.length) return null;
    const params = updateKeys
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');
    const body = { fields: {} };
    updateKeys.forEach((key) => {
        body.fields[key] = toFirestoreFieldValue(fields[key]);
    });
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}&${params}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    return payload;
}

window.MargaHrWorkLocations = {
    maxMetersForType,
    clampAllowedMeters,
    distanceMeters,
    validateTimeIn
};
