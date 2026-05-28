if (!MargaAuth.requireAccess('hr')) {
    throw new Error('Unauthorized access to HR module.');
}

const WORK_LOCATIONS_COLLECTION = 'marga_hr_work_locations';
const OFFICE_MAX_METERS = 30;
const PRODUCTION_MAX_METERS = 30;
const CUSTOMER_SITE_MAX_METERS = 100;

const DEFAULT_WORK_LOCATIONS = [
    {
        id: 'havila-office',
        name: 'Havila Office',
        type: 'office',
        address: 'MARGA office / Havila, Antipolo',
        latitude: '',
        longitude: '',
        allowedMeters: 20,
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
        allowedMeters: 20,
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
    activeTab: 'employees',
    editingEmployeeId: ''
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    if (user) {
        document.getElementById('userName').textContent = user.name || user.username || 'User';
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = String(user.name || user.username || 'U').charAt(0).toUpperCase();
    }
    const performanceDate = document.getElementById('performanceDateInput');
    if (performanceDate) performanceDate.value = todayDateKey();

    document.getElementById('refreshHrBtn').addEventListener('click', () => loadHrModule());
    document.getElementById('printPayrollBtn')?.addEventListener('click', () => {
        setActiveTab('payroll');
        window.print();
    });
    performanceDate?.addEventListener('change', () => refreshPerformanceDate());
    document.querySelectorAll('[data-performance-tab]').forEach((button) => {
        button.addEventListener('click', () => setPerformanceTab(button.dataset.performanceTab));
    });
    document.querySelectorAll('.hr-tab').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    });
    document.getElementById('employeeSearch').addEventListener('input', renderEmployees);
    document.getElementById('employeeStatusFilter').addEventListener('change', renderEmployees);
    document.querySelector('#hrEmployeesTable tbody').addEventListener('click', (event) => {
        const button = event.target.closest('[data-employee-view]');
        if (button) openEmployeeModal(button.dataset.employeeView);
    });
    document.getElementById('employeeModalOverlay').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCloseBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCancelBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalSaveBtn').addEventListener('click', saveEmployeeDetails);
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

    loadHrModule();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

async function loadHrModule() {
    const status = document.getElementById('hrDirectoryStatus');
    status.textContent = 'Loading HR records...';
    try {
        const [employees, positions, locations, fieldEvents] = await Promise.all([
            MargaUtils.fetchCollection('tbl_employee', 500),
            MargaUtils.fetchCollection('tbl_position', 200).catch(() => []),
            loadWorkLocations(),
            MargaUtils.fetchCollection('tbl_field_visit_events', 500).catch(() => [])
        ]);
        HR_STATE.employees = employees;
        HR_STATE.positions = new Map(positions.map((position) => [
            String(position.id || position._docId || ''),
            position
        ]));
        HR_STATE.locations = locations;
        HR_STATE.fieldEvents = fieldEvents;
        await loadPerformanceDateData(getPerformanceDate());
        await hydratePerformanceLookups(fieldEvents);
        status.textContent = `${employees.length.toLocaleString()} employee record(s) loaded.`;
        renderEmployees();
        renderPerformance();
        renderPayrollModel();
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
    const next = ['employees', 'payroll', 'performance', 'locations'].includes(tab) ? tab : 'employees';
    HR_STATE.activeTab = next;
    document.querySelectorAll('.hr-tab').forEach((button) => {
        const active = button.dataset.tab === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('employeesPane').classList.toggle('open', next === 'employees');
    document.getElementById('payrollPane').classList.toggle('open', next === 'payroll');
    document.getElementById('performancePane').classList.toggle('open', next === 'performance');
    document.getElementById('locationsPane').classList.toggle('open', next === 'locations');
    document.getElementById('locationValidatorPane').classList.toggle('open', next === 'locations');
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

function renderEmployees() {
    const tbody = document.querySelector('#hrEmployeesTable tbody');
    const query = String(document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('employeeStatusFilter').value;
    const rows = HR_STATE.employees
        .filter((employee) => {
            const isActive = MargaUtils.isOfficialActiveEmployee(employee);
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
        const active = MargaUtils.isOfficialActiveEmployee(employee);
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

    document.getElementById('hrDirectoryStatus').textContent = `${rows.length.toLocaleString()} employee(s) shown.`;
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
    const totals = sampleRows.reduce((sum, row) => ({
        monthly: sum.monthly + row.monthlyRate,
        semiMonthly: sum.semiMonthly + row.semiMonthlyRate
    }), { monthly: 0, semiMonthly: 0 });
    document.getElementById('payrollStatus').textContent = 'Workbook format from payroll.xlsx: PAYROLL employee list and monthly rate. OT and deductions require manual approved entries.';
    document.getElementById('payrollSample').innerHTML = `
        <div class="hr-payroll-sample-header">
            <div>
                <span>Print Format</span>
                <h4>PAYROLL</h4>
                <p>Follow the workbook layout: employee list with monthly rate. This screen does not automatically compute overtime, deductions, or net pay.</p>
            </div>
            <div class="hr-payroll-total">
                <span>Total Monthly Rate</span>
                <strong>${formatMoneyOrDash(totals.monthly)}</strong>
            </div>
        </div>
        <div class="hr-payroll-totals">
            <div><span>Sheet</span><strong>Sheet1</strong></div>
            <div><span>Title</span><strong>PAYROLL</strong></div>
            <div><span>Monthly Rate Total</span><strong>${formatMoneyOrDash(totals.monthly)}</strong></div>
            <div><span>Semi-month Basis</span><strong>${formatMoneyOrDash(totals.semiMonthly)}</strong></div>
        </div>
        <div class="table-container hr-payroll-table-wrap">
            <table class="table hr-payroll-table">
                <thead>
                    <tr>
                        <th>No.</th>
                        <th>employee</th>
                        <th>monthly rate</th>
                        <th>semi-monthly reference</th>
                        <th>remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${sampleRows.map((row) => `
                        <tr>
                            <td data-label="No.">${row.number}</td>
                            <td data-label="employee"><strong>${sanitize(row.name)}</strong><small>ID ${sanitize(row.id)}</small></td>
                            <td data-label="monthly rate">${sanitize(formatMoneyOrDash(row.monthlyRate))}</td>
                            <td data-label="semi-monthly reference">${sanitize(formatMoneyOrDash(row.semiMonthlyRate))}</td>
                            <td data-label="remarks">${sanitize(row.position || '-')}</td>
                        </tr>
                    `).join('')}
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
                <p>The uploaded workbook does not contain deduction columns or formulas. Deductions should be manually encoded from approved payroll records before printing final payroll.</p>
                <div class="table-container">
                    <table class="table hr-payroll-table">
                        <thead><tr><th>Employee</th><th>Deduction Type</th><th>Reference</th><th>Amount</th><th>Approved / Source</th></tr></thead>
                        <tbody><tr><td colspan="5">No deduction entries in payroll.xlsx.</td></tr></tbody>
                    </table>
                </div>
            </section>
        </div>
    `;
    document.getElementById('payrollAnalysis').innerHTML = `
        <h4>payroll.xlsx Analysis</h4>
        <div class="hr-detected-grid">
            <div><span>Workbook</span><strong>payroll.xlsx</strong></div>
            <div><span>Sheet</span><strong>Sheet1</strong></div>
            <div><span>Title Cell</span><strong>PAYROLL</strong></div>
            <div><span>Columns</span><strong>employee, monthly rate</strong></div>
            <div><span>Print Setup</span><strong>Landscape</strong></div>
            <div><span>Deduction Formula</span><strong>Not present</strong></div>
        </div>
        <h4>Payroll Rules For MARGA HR</h4>
        <ol>
            <li><strong>Do not auto-compute OT:</strong> overtime is a special approved exception, not an attendance-derived payroll default.</li>
            <li><strong>OT support required:</strong> every OT entry must have employee, date, reason/work to finish, hours, approver, and signed authorization form reference.</li>
            <li><strong>Deduction support required:</strong> deductions must come from approved payroll inputs such as SSS, PhilHealth, HDMF, loans, cash advance, withholding tax, A/R house rental, or other named source records.</li>
            <li><strong>Workbook finding:</strong> this uploaded payroll.xlsx only shows employee and monthly rate; it does not show deduction formulas to copy.</li>
            <li><strong>Print rule:</strong> print the payroll rate sheet in the workbook style first, then attach approved OT and deduction registers when final payroll is prepared.</li>
        </ol>
    `;
}

function buildSamplePayrollRows() {
    const source = HR_STATE.employees
        .filter((employee) => MargaUtils.isOfficialActiveEmployee(employee))
        .filter((employee) => Number(toNumber(firstPresent(employee, ['monthly_salary', 'basic_salary', 'semi_monthly_rate', 'semim_rate', 'semimrate', 'daily_rate', 'salary_rate', 'salary']))) > 0)
        .sort((left, right) => MargaUtils.getEmployeeFullName(left, '').localeCompare(MargaUtils.getEmployeeFullName(right, '')))
        .slice(0, 8);
    const employees = source.length ? source : getFallbackSampleEmployees();
    return employees.map((employee, index) => {
        const rates = payrollRatesFor(employee);
        return {
            number: index + 1,
            id: employee.id || employee._docId || `S${index + 1}`,
            name: MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || `Sample Staff ${index + 1}`),
            position: getPositionLabel(employee),
            monthlyRate: roundMoney(rates.monthlyRate),
            semiMonthlyRate: roundMoney(rates.semiMonthlyRate),
            dailyRate: roundMoney(rates.dailyRate)
        };
    });
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

function openEmployeeModal(employeeId) {
    const employee = findEmployeeById(employeeId);
    if (!employee) return;
    HR_STATE.editingEmployeeId = String(employee.id || employee._docId || '');
    document.getElementById('employeeDocId').value = HR_STATE.editingEmployeeId;
    document.getElementById('employeeModalTitle').textContent = MargaUtils.getEmployeeFullName(employee, HR_STATE.editingEmployeeId);
    document.getElementById('employeeModalSubtitle').textContent = 'This edits tbl_employee, the same employee source used by Service, Billing, Collections, Schedule, login, and Field App assignment.';

    setInputValue('employeeIdInput', employee.id || employee._docId || '');
    setInputValue('employeeFirstNameInput', employee.firstname || '');
    setInputValue('employeeLastNameInput', employee.lastname || '');
    setInputValue('employeeNicknameInput', employee.nickname || '');
    setInputValue('employeeEmailInput', employee.email || employee.marga_login_email || employee.username || '');
    setInputValue('employeeMobileInput', firstPresent(employee, ['mobile', 'mobile_no', 'phone', 'contact_no', 'contact_number']));
    setInputValue('employeeBirthdateInput', toDateInputValue(firstPresent(employee, ['birthdate', 'birthday', 'date_of_birth'])));
    setInputValue('employeeCivilStatusInput', firstPresent(employee, ['civil_status', 'marital_status']));
    setInputValue('employeeAddressInput', firstPresent(employee, ['address', 'home_address', 'current_address']));
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
    setInputValue('employeeEmergencyNameInput', firstPresent(employee, ['emergency_contact_name', 'emergency_contact']));
    setInputValue('employeeEmergencyPhoneInput', firstPresent(employee, ['emergency_contact_phone', 'emergency_phone']));
    setInputValue('employeeNotesInput', firstPresent(employee, ['hr_notes', 'notes', 'remarks']));
    document.getElementById('employeeModalBrief').innerHTML = renderEmployeeBrief(employee);
    document.getElementById('employeeModalStatus').textContent = 'Ready.';
    setModalOpen('employeeModal', 'employeeModalOverlay', true);
}

function renderEmployeeBrief(employee) {
    const active = MargaUtils.isOfficialActiveEmployee(employee);
    const rates = payrollRatesFor(employee);
    const mobile = firstPresent(employee, ['mobile', 'mobile_no', 'phone', 'contact_no', 'contact_number']) || '-';
    const email = employee.email || employee.marga_login_email || employee.username || '-';
    return `
        <div class="hr-employee-identity">
            <span class="hr-employee-avatar">${sanitize(String(MargaUtils.getEmployeeFullName(employee, 'E').charAt(0) || 'E').toUpperCase())}</span>
            <div>
                <span class="hr-kicker">${active ? 'Active Employee' : 'Inactive Employee'} · ID ${sanitize(employee.id || employee._docId || '-')}</span>
                <strong>${sanitize(MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || 'Employee'))}</strong>
                <p>${sanitize(getPositionLabel(employee) || 'No position set')} · ${sanitize(email)} · ${sanitize(mobile)}</p>
            </div>
        </div>
        <div class="hr-employee-brief-metrics">
            <div><span>Semi-monthly</span><strong>${sanitize(formatMoneyOrDash(rates.semiMonthlyRate))}</strong></div>
            <div><span>Daily rate</span><strong>${sanitize(formatMoneyOrDash(rates.dailyRate))}</strong></div>
            <div><span>Allowance</span><strong>${sanitize(formatMoneyOrDash(rates.allowance))}</strong></div>
        </div>
    `;
}

function closeEmployeeModal() {
    HR_STATE.editingEmployeeId = '';
    setModalOpen('employeeModal', 'employeeModalOverlay', false);
}

async function saveEmployeeDetails() {
    const docId = document.getElementById('employeeDocId').value;
    if (!docId) return;
    const status = document.getElementById('employeeModalStatus');
    const saveBtn = document.getElementById('employeeModalSaveBtn');
    status.textContent = 'Saving employee details...';
    saveBtn.disabled = true;
    const nowIso = new Date().toISOString();
    const fields = {
        firstname: valueOf('employeeFirstNameInput'),
        lastname: valueOf('employeeLastNameInput'),
        nickname: valueOf('employeeNicknameInput'),
        email: valueOf('employeeEmailInput'),
        marga_login_email: valueOf('employeeEmailInput'),
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
        emergency_contact_name: valueOf('employeeEmergencyNameInput'),
        emergency_contact_phone: valueOf('employeeEmergencyPhoneInput'),
        hr_notes: valueOf('employeeNotesInput'),
        hr_updated_at: nowIso,
        hr_updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.name || 'hr'
    };
    try {
        await patchDocument('tbl_employee', docId, fields);
        const employee = findEmployeeById(docId);
        if (employee) Object.assign(employee, fields);
        renderEmployees();
        status.textContent = 'Employee details saved.';
    } catch (error) {
        console.error('Employee save failed:', error);
        status.textContent = `Save failed: ${error.message || error}`;
        alert(`Save failed: ${error.message || error}`);
    } finally {
        saveBtn.disabled = false;
    }
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
        'semi_monthly_rate',
        'semim_rate',
        'semimrate',
        'salary_rate',
        'salary',
        'daily_rate',
        'rate',
        'basic_salary',
        'monthly_salary',
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
    const activeEmployees = HR_STATE.employees.filter((employee) => MargaUtils.isOfficialActiveEmployee(employee)).length;
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
        allowedMeters: 20,
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
