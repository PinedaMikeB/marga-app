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

    document.getElementById('refreshHrBtn').addEventListener('click', () => loadHrModule());
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
    document.querySelector('#hrPerformanceTable tbody').addEventListener('click', (event) => {
        const button = event.target.closest('[data-performance-view]');
        if (button) openPerformanceModal(button.dataset.performanceView);
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
    const eventsByStaff = new Map();
    HR_STATE.fieldEvents.forEach((event) => {
        const staffKey = normalizeStaffKey(event.staff_id || event.employee_id || event.employeeId || event.staff_name || event.staff || event.user_name);
        if (!staffKey) return;
        if (!eventsByStaff.has(staffKey)) eventsByStaff.set(staffKey, []);
        eventsByStaff.get(staffKey).push(event);
    });

    const rows = activeEmployees.map((employee) => {
        const keys = [
            employee.id,
            employee._docId,
            employee.email,
            employee.marga_login_email,
            employee.username,
            MargaUtils.getEmployeeFullName(employee, '')
        ].map(normalizeStaffKey).filter(Boolean);
        const events = [...new Set(keys)].flatMap((key) => eventsByStaff.get(key) || []);
        events.sort((left, right) => String(right.created_at || right.timestamp || right.updated_at || '').localeCompare(String(left.created_at || left.timestamp || left.updated_at || '')));
        return { employee, events, last: events[0] || null };
    }).sort((left, right) => right.events.length - left.events.length || MargaUtils.getEmployeeFullName(left.employee, '').localeCompare(MargaUtils.getEmployeeFullName(right.employee, '')));

    tbody.innerHTML = rows.slice(0, 100).map(({ employee, events, last }) => {
        const name = sanitize(MargaUtils.getEmployeeFullName(employee, employee.id || employee._docId || ''));
        const role = sanitize(getPositionLabel(employee));
        const lastAction = sanitize(last?.action || last?.status_label || last?.field_last_action || '-');
        const context = resolveEventContext(last);
        const gps = hasCoordinates(last)
            ? `${Number(last.latitude).toFixed(5)}, ${Number(last.longitude).toFixed(5)}`
            : '-';
        const signal = events.length ? getPerformanceSignal(events.length) : 'Waiting for app events';
        const id = sanitize(employee.id || employee._docId || '');
        return `
            <tr>
                <td data-label="Employee"><strong>${name}</strong></td>
                <td data-label="Role">${role}</td>
                <td data-label="Field App Records">${events.length.toLocaleString()}</td>
                <td data-label="Customer / Company">${sanitize(context.company || '-')}</td>
                <td data-label="Branch">${sanitize(context.branch || '-')}</td>
                <td data-label="Last Action">${lastAction}</td>
                <td data-label="Last GPS">${sanitize(gps)}</td>
                <td data-label="Signal">${sanitize(signal)}</td>
                <td data-label="Action"><button type="button" class="hr-text-btn" data-performance-view="${id}">View</button></td>
            </tr>
        `;
    }).join('');

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9">No active employees found for performance analytics.</td></tr>';
    }
    document.getElementById('performanceStatus').textContent = `${HR_STATE.fieldEvents.length.toLocaleString()} Field App record(s) available. These are staff actions saved by the Field App, such as customer location pinning, time checks, or route progress updates.`;
}

function renderPayrollModel() {
    document.getElementById('payrollStatus').textContent = 'Formula design from attached workbook: payroll, attendance summary, and payout summary sheets.';
    document.getElementById('payrollAnalysis').innerHTML = `
        <h4>Payroll Sheet Formula Map</h4>
        <div class="hr-detected-grid">
            <div><span>Cutoff</span><strong>April 11-25, 2026</strong></div>
            <div><span>Source Sheet</span><strong>payroll</strong></div>
            <div><span>Attendance Sheet</span><strong>Sheet2</strong></div>
            <div><span>Payout Sheet</span><strong>Sheet1</strong></div>
            <div><span>Primary Key</span><strong>Employee name, then employee ID once HR fills it</strong></div>
            <div><span>Output</span><strong>Net salary + bank/encashment summary</strong></div>
        </div>
        <h4>Computation Design</h4>
        <ol>
            <li><strong>Semi-monthly rate:</strong> monthly salary / 2, stored from HR employee salary setup.</li>
            <li><strong>Daily rate:</strong> <code>((semiMonthlyRate * 2) / 313) * 12</code>, matching the workbook's 313-day annual divisor and 12-day pay-period basis.</li>
            <li><strong>Total basic:</strong> <code>semiMonthlyRate - (dailyRate * absences)</code>.</li>
            <li><strong>OT pay:</strong> <code>((dailyRate / 8) * 1.25) * overtimeHours</code>.</li>
            <li><strong>Regular OT / RDOT / adjustments:</strong> added as separate payroll inputs, with attendance defaults from Field App where possible.</li>
            <li><strong>Total pay:</strong> basic + OT + allowance + RDOT + regular OT + adjustment.</li>
            <li><strong>Undertime and late deductions:</strong> undertime uses hourly rate * UT hours; late uses per-minute rate * minutes late.</li>
            <li><strong>Gross income:</strong> total pay - undertime - SSS - provident fund - PhilHealth - HDMF - late deduction.</li>
            <li><strong>Net salary:</strong> gross income + non-tax allowance - withholding tax + tax refund - SSS loan - coop loan - PhilHealth adjustment - cash advance - Pag-IBIG loan - bank loan - A/R house rental - others.</li>
            <li><strong>Payout summary:</strong> split by bank account/direct deposit and encashment, then reconcile totals against payroll totals.</li>
        </ol>
    `;
}

function getPositionLabel(employee) {
    const position = HR_STATE.positions.get(String(employee.position_id || ''));
    return MargaUtils.getEmployeeDesignation(employee, position ? new Map([[String(employee.position_id || ''), position]]) : null);
}

async function hydratePerformanceLookups(events = []) {
    const branchIds = [...new Set(events.map((event) => String(event.branch_id || '').trim()).filter(Boolean))].slice(0, 120);
    const companyIds = [...new Set(events.map((event) => String(event.company_id || '').trim()).filter(Boolean))].slice(0, 120);
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
    document.getElementById('employeeModalStatus').textContent = 'Ready.';
    setModalOpen('employeeModal', 'employeeModalOverlay', true);
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
    const keys = [
        employee.id,
        employee._docId,
        employee.email,
        employee.marga_login_email,
        employee.username,
        MargaUtils.getEmployeeFullName(employee, '')
    ].map(normalizeStaffKey).filter(Boolean);
    const keySet = new Set(keys);
    const events = HR_STATE.fieldEvents
        .filter((event) => keySet.has(normalizeStaffKey(event.staff_id || event.employee_id || event.employeeId || event.staff_name || event.staff || event.user_name)))
        .sort((left, right) => String(right.occurred_at || right.created_at || '').localeCompare(String(left.occurred_at || left.created_at || '')));
    document.getElementById('performanceModalTitle').textContent = MargaUtils.getEmployeeFullName(employee, employeeId);
    document.getElementById('performanceModalSubtitle').textContent = `${events.length.toLocaleString()} Field App record(s). Counts mean saved staff actions from the Field App, not a final HR rating.`;
    document.getElementById('performanceDetailContent').innerHTML = renderPerformanceDetail(events);
    setModalOpen('performanceModal', 'performanceModalOverlay', true);
}

function closePerformanceModal() {
    setModalOpen('performanceModal', 'performanceModalOverlay', false);
}

function renderPerformanceDetail(events) {
    if (!events.length) return '<div class="ops-subtext">No Field App records found for this staff member yet.</div>';
    return `
        <div class="hr-performance-summary">
            <div><span>Total Records</span><strong>${events.length.toLocaleString()}</strong></div>
            <div><span>Customer Location Pins</span><strong>${events.filter((event) => event.action === 'customer_location_pinned').length.toLocaleString()}</strong></div>
            <div><span>Unique Customers</span><strong>${new Set(events.map((event) => `${event.company_id || ''}:${event.branch_id || ''}`)).size.toLocaleString()}</strong></div>
        </div>
        <div class="table-container">
            <table class="table">
                <thead><tr><th>Date/Time</th><th>Action</th><th>Customer / Company</th><th>Branch</th><th>GPS</th></tr></thead>
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
                    }).join('')}
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
        overtime: find(/overtime|\bot\b/),
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
