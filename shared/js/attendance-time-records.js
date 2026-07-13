/**
 * Shared time records UI for Field App, Dashboard, and HR.
 */
(function () {
    const ATTENDANCE_COLLECTION = 'tbl_field_attendance';
    const ZERO_DATETIME = '0000-00-00 00:00:00';
    const EMPTY_DATES = new Set(['', ZERO_DATETIME, 'null', 'undefined', 'invalid date']);

    const TIME_RECORDS_FORM_VERSION = '20260708-fix-time-in-out-1';

    const modalState = {
        staffId: 0,
        staffName: '',
        sourceModule: 'field',
        period: null,
        rows: [],
        pendingByDate: new Map(),
        formDate: '',
        formMode: ''
    };

    const hrState = {
        employees: [],
        subtab: 'records',
        selectedStaffId: 0,
        period: null,
        rows: [],
        adjustments: [],
        selectedRequestId: ''
    };

    function getMargabaseAdminUrl(route) {
        const baseUrl = String(window.FIREBASE_CONFIG?.baseUrl || window.MARGABASE_CONFIG?.baseUrl || '').trim();
        const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
        if (baseUrl.startsWith('/margabase-api/')) return `/margabase-api${normalizedRoute}`;
        if (baseUrl.includes('/v1/projects/')) {
            const base = new URL(baseUrl, window.location.origin);
            const marker = '/v1/projects/';
            const markerIndex = base.pathname.indexOf(marker);
            const adminBase = markerIndex >= 0 ? base.pathname.slice(0, markerIndex) : '/margabase-api';
            return `${base.origin}${adminBase}${normalizedRoute}`;
        }
        return `http://127.0.0.1:8787${normalizedRoute}`;
    }

    function firestoreValue(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        }
        return { stringValue: String(value ?? '') };
    }

    async function runQuery(structuredQuery) {
        const response = await fetch(`${window.FIREBASE_CONFIG.baseUrl}:runQuery?key=${window.FIREBASE_CONFIG.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        });
        const payload = await response.json();
        if (!response.ok || payload?.error || (Array.isArray(payload) && payload[0]?.error)) {
            throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Time records query failed.');
        }
        return Array.isArray(payload)
            ? payload.map((row) => row.document).filter(Boolean).map((doc) => window.MargaUtils.parseFirestoreDoc(doc))
            : [];
    }

    async function queryAttendanceRange({ staffId = 0, from, to, limit = 2000 }) {
        const filters = [
            { fieldFilter: { field: { fieldPath: 'attendance_date' }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(from) } },
            { fieldFilter: { field: { fieldPath: 'attendance_date' }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue(to) } }
        ];
        if (staffId) {
            filters.unshift({
                fieldFilter: { field: { fieldPath: 'staff_id' }, op: 'EQUAL', value: firestoreValue(staffId) }
            });
        }
        return runQuery({
            from: [{ collectionId: ATTENDANCE_COLLECTION }],
            where: { compositeFilter: { op: 'AND', filters } },
            limit
        });
    }

    const ADJUSTMENT_COLLECTION = 'marga_hr_attendance_adjustments';

    function normalizeAdjustmentRow(row = {}) {
        const id = String(row.id || row._docId || '').trim();
        return { ...row, id };
    }

    async function fetchAdjustmentsFromCollection(status = '') {
        if (!window.MargaUtils?.fetchCollection) return [];
        const rows = await window.MargaUtils.fetchCollection(ADJUSTMENT_COLLECTION, 500).catch(() => []);
        return rows
            .map(normalizeAdjustmentRow)
            .filter((row) => !status || String(row.status || '').trim() === status);
    }

    async function fetchAdjustments(status = '') {
        const url = new URL(getMargabaseAdminUrl('/admin/hr-attendance-adjustment/list'), window.location.href);
        if (status) url.searchParams.set('status', status);
        try {
            const response = await fetch(url.toString(), { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (response.ok && !payload?.error && Array.isArray(payload.rows)) {
                return payload.rows.map(normalizeAdjustmentRow);
            }
            const message = payload?.error?.message || `Adjustment list HTTP ${response.status}`;
            if (!/unsupported margabase firestore compatibility path/i.test(message)) {
                throw new Error(message);
            }
        } catch (error) {
            if (!/unsupported margabase firestore compatibility path|adjustment list http 404/i.test(String(error?.message || ''))) {
                console.warn('Adjustment admin list unavailable; falling back to Firestore collection.', error);
            }
        }
        return fetchAdjustmentsFromCollection(status);
    }

    function normalizeDateTime(value) {
        const text = String(value || '').trim();
        const normalized = text.replace('T', ' ').toLowerCase();
        if (EMPTY_DATES.has(normalized)) return '';
        return text;
    }

    function formatTime(value) {
        const normalized = normalizeDateTime(value);
        if (!normalized) return '--:--';
        const time = normalized.replace('T', ' ').slice(11, 16);
        const [hour, minute] = time.split(':').map((part) => Number(part));
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time || '--:--';
        const suffix = hour >= 12 ? 'PM' : 'AM';
        return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
    }

    function extractClockTime(value) {
        const normalized = String(value || '').trim().replace('T', ' ');
        const match = normalized.match(/(\d{1,2}):(\d{2})/);
        if (!match) return '';
        return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
    }

    function roundOtHours(value) {
        return Math.round(Number(value || 0) * 100) / 100;
    }

    function overtimeHoursFromAdjustment(row = {}) {
        const direct = Number(row.ot_hours);
        if (Number.isFinite(direct) && direct > 0) return roundOtHours(direct);
        const fromClock = extractClockTime(row.ot_from_time);
        const toClock = extractClockTime(row.ot_to_time);
        if (fromClock && toClock) {
            const hours = computeOtHoursFromClock(fromClock, toClock);
            if (hours > 0) return hours;
        }
        return 0;
    }

    function adjustmentMatchesPeriod(row = {}, period = {}) {
        const date = String(row.attendance_date || '').trim();
        if (date && date >= String(period.from || '').trim() && date <= String(period.to || '').trim()) return true;
        const cutoffFrom = String(row.cutoff_from || '').trim();
        const cutoffTo = String(row.cutoff_to || '').trim();
        return cutoffFrom === String(period.from || '').trim() && cutoffTo === String(period.to || '').trim();
    }

    function isOvertimeAdjustment(row = {}) {
        return String(row.request_type || '').trim() === 'request_ot';
    }

    function isDeleteDayAdjustment(row = {}) {
        return String(row.request_type || '').trim() === 'delete_day';
    }

    function isTimeAdjustment(row = {}) {
        return !isDeleteDayAdjustment(row) && !isOvertimeAdjustment(row);
    }

    function buildTimeAdjustmentSummary(row = {}) {
        const requestedIn = formatTime(row.requested_time_in);
        const requestedOut = formatTime(row.requested_time_out);
        const hasRequestedIn = Boolean(normalizeDateTime(row.requested_time_in));
        const hasRequestedOut = Boolean(normalizeDateTime(row.requested_time_out));
        const parts = [];
        if (hasRequestedIn) parts.push(`In ${requestedIn}`);
        if (hasRequestedOut) parts.push(`Out ${requestedOut}`);
        const location = String(row.requested_location_type || '').trim();
        const suffix = hasRequestedIn && location ? ` (${location})` : '';
        if (!parts.length) return `Adjust time${suffix}`;
        return `Adjust ${parts.join(' · ')}${suffix}`;
    }

    function summarizeRequestedOt(adjustments = [], staffId = 0, period = {}) {
        const rows = (Array.isArray(adjustments) ? adjustments : [])
            .filter((row) => Number(row.staff_id || 0) === Number(staffId || 0))
            .filter((row) => isOvertimeAdjustment(row))
            .filter((row) => ['pending', 'approved'].includes(String(row.status || '').trim()))
            .filter((row) => adjustmentMatchesPeriod(row, period));
        const approvedHours = roundOtHours(rows
            .filter((row) => String(row.status || '').trim() === 'approved')
            .reduce((sum, row) => sum + overtimeHoursFromAdjustment(row), 0));
        const pendingHours = roundOtHours(rows
            .filter((row) => String(row.status || '').trim() === 'pending')
            .reduce((sum, row) => sum + overtimeHoursFromAdjustment(row), 0));
        const missingApprovedHours = rows
            .filter((row) => String(row.status || '').trim() === 'approved')
            .filter((row) => overtimeHoursFromAdjustment(row) <= 0).length;
        return {
            count: rows.length,
            approvedHours,
            pendingHours,
            totalHours: roundOtHours(approvedHours + pendingHours),
            missingApprovedHours
        };
    }

    function buildOtAdjustmentsByDate(adjustments = [], staffId = 0, period = {}) {
        const map = new Map();
        (Array.isArray(adjustments) ? adjustments : [])
            .filter((row) => Number(row.staff_id || 0) === Number(staffId || 0))
            .filter((row) => isOvertimeAdjustment(row))
            .filter((row) => ['pending', 'approved'].includes(String(row.status || '').trim()))
            .filter((row) => adjustmentMatchesPeriod(row, period))
            .forEach((row) => {
                const dateKey = String(row.attendance_date || '').trim();
                if (!dateKey) return;
                const current = map.get(dateKey);
                if (!current || String(row.status || '') === 'approved') map.set(dateKey, row);
            });
        return map;
    }

    function renderOtAdjustmentBadge(row = {}) {
        const status = String(row.status || '').trim();
        const hours = overtimeHoursFromAdjustment(row);
        if (status === 'pending') {
            const label = hours > 0 ? `OT pending (${hours.toFixed(2)} hr)` : 'OT pending';
            return `<span class="attendance-time-records-badge">${label}</span>`;
        }
        if (hours > 0) {
            return `<span class="attendance-time-records-badge is-approved-ot">OT approved (${hours.toFixed(2)} hr)</span>`;
        }
        return '<span class="attendance-time-records-badge is-approved-ot-missing">OT approved (hours missing)</span>';
    }

    function locationLabelFromRow(row = {}) {
        const workType = String(row.time_in_work_location_type || '').trim().toLowerCase();
        const locationStatus = String(row.time_in_location_status || '').trim().toLowerCase();
        if (workType === 'office' || locationStatus.includes('office')) {
            return `Office — ${String(row.time_in_work_location_name || row.time_in_company_name || 'Office').trim()}`;
        }
        if (workType === 'production' || locationStatus.includes('production')) {
            return `Production — ${String(row.time_in_work_location_name || row.time_in_company_name || 'Production').trim()}`;
        }
        const company = String(row.time_in_company_name || '').trim();
        const branch = String(row.time_in_branch_name || '').trim();
        if (company || branch) return [company, branch].filter(Boolean).join(' — ');
        return '--';
    }

    function getCurrentPeriod() {
        const cutoff = window.MargaPayrollCutoff;
        const today = cutoff.todayDateKey();
        return cutoff.timeRecordsPayrollPeriod(today);
    }

    function payrollPeriodKey(period = {}) {
        return `${period.from || ''}_${period.to || ''}`;
    }

    function listSelectablePayrollPeriods(count = 16) {
        return window.MargaPayrollCutoff?.listPayrollPeriodOptions?.(count) || [];
    }

    function findPayrollPeriodByKey(key = '') {
        return listSelectablePayrollPeriods(24).find((period) => period.key === key) || null;
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderPayrollPeriodSelectOptions(selectedPeriod = {}) {
        const selectedKey = payrollPeriodKey(selectedPeriod);
        return listSelectablePayrollPeriods(16).map((period) => {
            const selected = period.key === selectedKey ? ' selected' : '';
            return `<option value="${escapeHtml(period.key)}"${selected}>${escapeHtml(period.label)}</option>`;
        }).join('');
    }

    function syncPayrollPeriodSelect(selectId, period = {}) {
        const select = document.getElementById(selectId);
        if (!select) return;
        select.innerHTML = renderPayrollPeriodSelectOptions(period);
    }

    function bindPayrollPeriodSelect(selectId, onPeriodChange) {
        const select = document.getElementById(selectId);
        if (!select || select.dataset.periodBound === '1') return;
        select.dataset.periodBound = '1';
        select.addEventListener('change', () => {
            const period = findPayrollPeriodByKey(select.value);
            if (!period) return;
            onPeriodChange({
                from: period.from,
                to: period.to,
                key: period.key,
                label: period.label,
                complete: period.complete,
                profile: period.profile
            });
        });
    }

    function normalizePeriodState(period = {}) {
        const key = payrollPeriodKey(period);
        const match = findPayrollPeriodByKey(key);
        if (match) {
            return {
                from: match.from,
                to: match.to,
                key: match.key,
                label: match.label,
                complete: match.complete,
                profile: match.profile
            };
        }
        return {
            from: period.from || '',
            to: period.to || '',
            key,
            label: period.label || ''
        };
    }

    function employeeRecordFromState(employeeOrStaffId, staffName = '') {
        if (employeeOrStaffId && typeof employeeOrStaffId === 'object') return employeeOrStaffId;
        const staffId = Number(employeeOrStaffId || 0) || 0;
        const found = getSortedEmployees(hrState.employees).find((row) => Number(row.id || 0) === staffId);
        if (found) return found;
        return {
            id: staffId,
            staff_id: staffId,
            name: staffName,
            staff_name: staffName
        };
    }

    function computeTotals(rows, period, employeeOrStaffId = null, staffName = '') {
        const cutoff = window.MargaPayrollCutoff;
        const employee = employeeRecordFromState(employeeOrStaffId, staffName);
        const summary = cutoff.computePayrollAttendanceSummary(employee, rows, period);
        return {
            totalAttendance: summary.daysWorked,
            totalLateMinutes: summary.minutesLate,
            totalAbsent: summary.absences,
            elapsedDays: summary.elapsedDays,
            utHours: summary.utHours
        };
    }

    function getSortedEmployees(employees = []) {
        return (Array.isArray(employees) ? employees : [])
            .map((employee) => {
                const id = Number(employee.id || employee.employee_id || employee.staff_id || 0) || 0;
                const name = String(
                    window.MargaUtils?.getEmployeeFullName?.(employee, id)
                    || employee.name
                    || employee.employee_name
                    || ''
                ).trim();
                return { ...employee, id, name };
            })
            .filter((employee) => employee.id && employee.name)
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    }

    function getSelectedEmployeeIndex() {
        const employees = getSortedEmployees(hrState.employees);
        const index = employees.findIndex((employee) => Number(employee.id) === Number(hrState.selectedStaffId || 0));
        return { employees, index: index >= 0 ? index : 0 };
    }

    function updateStaffNavigator() {
        const { employees, index } = getSelectedEmployeeIndex();
        const total = employees.length;
        const current = total ? index + 1 : 0;
        const employee = employees[index] || null;
        const positionEl = document.getElementById('hrTimeRecordsStaffPosition');
        const nameEl = document.getElementById('hrTimeRecordsStaffName');
        const prevBtn = document.getElementById('hrTimeRecordsPrevBtn');
        const nextBtn = document.getElementById('hrTimeRecordsNextBtn');
        const selectEl = document.getElementById('hrTimeRecordsEmployee');
        if (positionEl) positionEl.textContent = total ? `${current} / ${total}` : '0 / 0';
        if (nameEl) nameEl.textContent = employee?.name || 'No employee selected';
        if (prevBtn) prevBtn.disabled = !total || index <= 0;
        if (nextBtn) nextBtn.disabled = !total || index >= total - 1;
        if (selectEl && employee) selectEl.value = String(employee.id);
    }

    function navigateEmployee(step) {
        const { employees, index } = getSelectedEmployeeIndex();
        if (!employees.length) return;
        const nextIndex = Math.max(0, Math.min(employees.length - 1, index + step));
        hrState.selectedStaffId = Number(employees[nextIndex].id || 0) || 0;
        updateStaffNavigator();
        refreshHrRecords().catch((error) => alert(error?.message || error));
    }

    function buildDateRows(rows, period) {
        const cutoff = window.MargaPayrollCutoff;
        const display = cutoff.getTimeRecordsDisplayWindow(period);
        const start = cutoff.parsePayrollDate(period.from);
        const end = cutoff.parsePayrollDate(display.rangeEnd || period.to);
        if (!start || !end) return [];
        const byDate = new Map();
        rows.forEach((row) => {
            const dateKey = String(row.attendance_date || '').trim();
            if (!dateKey) return;
            byDate.set(dateKey, row);
        });
        const output = [];
        const cursor = new Date(start.getTime());
        cursor.setHours(12, 0, 0, 0);
        const endDate = new Date(end.getTime());
        endDate.setHours(12, 0, 0, 0);
        while (cursor <= endDate) {
            if (cursor.getDay() !== 0) {
                const dateKey = cutoff.formatDateInputValue(cursor);
                output.push({
                    dateKey,
                    row: byDate.get(dateKey) || {
                        attendance_date: dateKey,
                        time_in: '',
                        time_out: ''
                    }
                });
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        return output.reverse();
    }

    function readTimeFieldValue(input) {
        if (!input) return '';
        return String(input.value || '').trim();
    }

    function readOtRequestTimes() {
        const form = document.getElementById('attendanceTimeRecordsForm');
        const fromEl = form?.querySelector('#attendanceTimeRecordsOtFrom')
            || document.getElementById('attendanceTimeRecordsOtFrom');
        const toEl = form?.querySelector('#attendanceTimeRecordsOtTo')
            || document.getElementById('attendanceTimeRecordsOtTo');
        const fromTime = readTimeFieldValue(fromEl);
        const toTime = readTimeFieldValue(toEl);
        return {
            fromEl,
            toEl,
            fromTime,
            toTime,
            hours: computeOtHoursFromClock(fromTime, toTime)
        };
    }

    function upgradeRequestFormLayout() {
        const modal = document.getElementById('attendanceTimeRecordsModal');
        if (modal && modal.dataset.formVersion !== TIME_RECORDS_FORM_VERSION) {
            modal.remove();
        }
    }

    function ensureModalPeriodToolbar() {
        const body = document.querySelector('#attendanceTimeRecordsModal .attendance-time-records-body');
        if (!body || document.getElementById('attendanceTimeRecordsPeriodSelect')) return;
        const toolbar = document.createElement('div');
        toolbar.className = 'attendance-time-records-period-toolbar';
        toolbar.innerHTML = `
            <label class="attendance-time-records-period-label">
                <span>Payroll Period</span>
                <select id="attendanceTimeRecordsPeriodSelect"></select>
            </label>
        `;
        body.insertBefore(toolbar, body.firstChild);
        bindPayrollPeriodSelect('attendanceTimeRecordsPeriodSelect', (period) => {
            hideForm();
            modalState.period = normalizePeriodState(period);
            refreshModalData().catch((error) => {
                console.error('Time records period change failed:', error);
                alert(error?.message || 'Unable to load time records for that cutoff.');
            });
        });
    }

    function ensureModalDom() {
        upgradeRequestFormLayout();
        if (document.getElementById('attendanceTimeRecordsModal')) {
            ensureModalPeriodToolbar();
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.id = 'attendanceTimeRecordsModal';
        wrapper.className = 'attendance-time-records-modal';
        wrapper.dataset.formVersion = TIME_RECORDS_FORM_VERSION;
        wrapper.innerHTML = `
            <div class="attendance-time-records-panel" role="dialog" aria-modal="true" aria-labelledby="attendanceTimeRecordsTitle">
                <div class="attendance-time-records-header">
                    <div>
                        <h2 id="attendanceTimeRecordsTitle">Time Records</h2>
                        <p id="attendanceTimeRecordsSubtitle"></p>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" data-attendance-time-records-close>Close</button>
                </div>
                <div class="attendance-time-records-body">
                    <div class="attendance-time-records-period-toolbar">
                        <label class="attendance-time-records-period-label">
                            <span>Payroll Period</span>
                            <select id="attendanceTimeRecordsPeriodSelect"></select>
                        </label>
                    </div>
                    <div class="attendance-time-records-totals" id="attendanceTimeRecordsTotals"></div>
                    <div class="attendance-time-records-status" id="attendanceTimeRecordsStatus"></div>
                    <div class="attendance-time-records-table-wrap">
                        <table class="attendance-time-records-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Location</th>
                                    <th>Time In</th>
                                    <th>Time Out</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="attendanceTimeRecordsTableBody"></tbody>
                        </table>
                    </div>
                    <div class="attendance-time-records-form" id="attendanceTimeRecordsForm" hidden>
                        <h3 id="attendanceTimeRecordsFormTitle">Request Adjustment</h3>
                        <p class="attendance-time-records-status" id="attendanceTimeRecordsFormDate"></p>
                        <label>
                            <span>Reason</span>
                            <textarea id="attendanceTimeRecordsReason" required></textarea>
                        </label>
                        <div id="attendanceTimeRecordsFixTimeWrap" hidden>
                            <label>
                                <span>Requested Time In</span>
                                <input type="time" id="attendanceTimeRecordsTimeIn" name="requested_time_in">
                            </label>
                            <label>
                                <span>Requested Time Out</span>
                                <input type="time" id="attendanceTimeRecordsTimeOut" name="requested_time_out">
                            </label>
                        </div>
                        <div id="attendanceTimeRecordsLocationWrap" hidden>
                            <label>
                                <span>Location</span>
                                <select id="attendanceTimeRecordsLocation" name="requested_location_type">
                                    <option value="">Select location</option>
                                    <option value="office">Office</option>
                                    <option value="production">Production</option>
                                    <option value="field">Field</option>
                                </select>
                            </label>
                        </div>
                        <div id="attendanceTimeRecordsOtWrap" hidden>
                            <label>
                                <span>OT From</span>
                                <input type="time" id="attendanceTimeRecordsOtFrom" name="ot_from_time" step="60">
                            </label>
                            <label>
                                <span>OT To</span>
                                <input type="time" id="attendanceTimeRecordsOtTo" name="ot_to_time" step="60">
                            </label>
                            <p class="attendance-time-records-status" id="attendanceTimeRecordsOtHours"></p>
                        </div>
                        <label>
                            <span>Supporting Image</span>
                            <input type="file" id="attendanceTimeRecordsImage" accept="image/*" capture="environment">
                        </label>
                        <div class="attendance-time-records-image-preview" id="attendanceTimeRecordsImagePreview" hidden>
                            <img id="attendanceTimeRecordsImageThumb" alt="Supporting image preview">
                            <span id="attendanceTimeRecordsImageName"></span>
                        </div>
                        <div class="attendance-time-records-actions">
                            <button type="button" class="btn btn-primary btn-sm" id="attendanceTimeRecordsSubmitBtn">Submit Request</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="attendanceTimeRecordsCancelFormBtn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);
        wrapper.addEventListener('click', (event) => {
            if (event.target === wrapper) closeModal();
        });
        wrapper.querySelector('[data-attendance-time-records-close]')?.addEventListener('click', closeModal);
        document.getElementById('attendanceTimeRecordsCancelFormBtn')?.addEventListener('click', hideForm);
        document.getElementById('attendanceTimeRecordsSubmitBtn')?.addEventListener('click', () => {
            submitForm().catch((error) => {
                console.error('Attendance adjustment submit failed:', error);
                alert(error?.message || 'Unable to submit adjustment request.');
            });
        });
        document.getElementById('attendanceTimeRecordsImage')?.addEventListener('change', (event) => {
            renderImagePreview(event.target);
        });
        document.getElementById('attendanceTimeRecordsOtFrom')?.addEventListener('input', updateOtHoursPreview);
        document.getElementById('attendanceTimeRecordsOtTo')?.addEventListener('input', updateOtHoursPreview);
        document.getElementById('attendanceTimeRecordsOtFrom')?.addEventListener('change', updateOtHoursPreview);
        document.getElementById('attendanceTimeRecordsOtTo')?.addEventListener('change', updateOtHoursPreview);
        bindPayrollPeriodSelect('attendanceTimeRecordsPeriodSelect', (period) => {
            hideForm();
            modalState.period = normalizePeriodState(period);
            refreshModalData().catch((error) => {
                console.error('Time records period change failed:', error);
                alert(error?.message || 'Unable to load time records for that cutoff.');
            });
        });
    }

    function computeOtHoursFromClock(fromTime, toTime) {
        if (!fromTime || !toTime) return 0;
        const [fromHour, fromMinute] = String(fromTime).split(':').map(Number);
        const [toHour, toMinute] = String(toTime).split(':').map(Number);
        if (!Number.isFinite(fromHour) || !Number.isFinite(fromMinute) || !Number.isFinite(toHour) || !Number.isFinite(toMinute)) return 0;
        const start = fromHour * 60 + fromMinute;
        const end = toHour * 60 + toMinute;
        if (end <= start) return 0;
        return Math.round(((end - start) / 60) * 100) / 100;
    }

    function updateOtHoursPreview() {
        const { fromTime, toTime, hours } = readOtRequestTimes();
        const label = document.getElementById('attendanceTimeRecordsOtHours');
        if (!label) return;
        if (!fromTime || !toTime) {
            label.textContent = 'Enter OT from and to time.';
            return;
        }
        label.textContent = hours > 0
            ? `Computed OT: ${hours.toFixed(2)} hour(s)`
            : 'OT to time must be later than from time.';
    }

    function renderImagePreview(fileInput) {
        const preview = document.getElementById('attendanceTimeRecordsImagePreview');
        const thumb = document.getElementById('attendanceTimeRecordsImageThumb');
        const name = document.getElementById('attendanceTimeRecordsImageName');
        const file = fileInput?.files?.[0];
        if (!preview || !thumb || !name) return;
        if (!file) {
            preview.hidden = true;
            thumb.removeAttribute('src');
            name.textContent = '';
            return;
        }
        name.textContent = file.name;
        const reader = new FileReader();
        reader.onload = () => {
            thumb.src = String(reader.result || '');
            preview.hidden = false;
        };
        reader.readAsDataURL(file);
    }

    function hideForm() {
        modalState.formDate = '';
        modalState.formMode = '';
        const form = document.getElementById('attendanceTimeRecordsForm');
        if (form) {
            form.hidden = true;
            delete form.dataset.formMode;
            delete form.dataset.formDate;
        }
        const fixTimeWrap = document.getElementById('attendanceTimeRecordsFixTimeWrap');
        const locationWrap = document.getElementById('attendanceTimeRecordsLocationWrap');
        const otWrap = document.getElementById('attendanceTimeRecordsOtWrap');
        if (fixTimeWrap) fixTimeWrap.hidden = true;
        if (locationWrap) locationWrap.hidden = true;
        if (otWrap) otWrap.hidden = true;
    }

    function isElementVisible(el) {
        return Boolean(el && !el.hidden && el.getClientRects().length > 0);
    }

    function isOtSubmissionIntent(otTimes = readOtRequestTimes(), formMode = '') {
        const title = String(document.getElementById('attendanceTimeRecordsFormTitle')?.textContent || '').trim();
        const otWrap = document.getElementById('attendanceTimeRecordsOtWrap');
        const form = document.getElementById('attendanceTimeRecordsForm');
        if (/overtime/i.test(title)) return true;
        if (form?.dataset.formMode === 'request_ot' || modalState.formMode === 'request_ot') return true;
        if (formMode === 'request_ot') return true;
        if (otWrap && !otWrap.hidden) return true;
        if (otTimes.fromTime || otTimes.toTime) return true;
        return false;
    }

    function isLegacyOtApiRejection(error, otTimes = readOtRequestTimes()) {
        const message = String(error?.message || '');
        return /time-in is required/i.test(message)
            && Boolean(otTimes.fromTime && otTimes.toTime);
    }

    function resolveActiveFormMode() {
        const form = document.getElementById('attendanceTimeRecordsForm');
        const otWrap = document.getElementById('attendanceTimeRecordsOtWrap');
        const fixWrap = document.getElementById('attendanceTimeRecordsFixTimeWrap');
        const title = document.getElementById('attendanceTimeRecordsFormTitle');
        const otTimes = readOtRequestTimes();
        if (isElementVisible(otWrap) || /overtime/i.test(String(title?.textContent || ''))) {
            return 'request_ot';
        }
        if (otTimes.fromTime && otTimes.toTime && !isElementVisible(fixWrap)) {
            return 'request_ot';
        }
        if (isElementVisible(fixWrap)) return 'adjust_time';
        const stored = String(form?.dataset.formMode || modalState.formMode || '').trim();
        if (stored) return stored;
        return '';
    }

    function resolveActiveFormDate() {
        const form = document.getElementById('attendanceTimeRecordsForm');
        return String(form?.dataset.formDate || modalState.formDate || '').trim();
    }

    function showForm(dateKey, mode) {
        modalState.formDate = dateKey;
        modalState.formMode = mode;
        const form = document.getElementById('attendanceTimeRecordsForm');
        const title = document.getElementById('attendanceTimeRecordsFormTitle');
        const dateLabel = document.getElementById('attendanceTimeRecordsFormDate');
        const fixTimeWrap = document.getElementById('attendanceTimeRecordsFixTimeWrap');
        const locationWrap = document.getElementById('attendanceTimeRecordsLocationWrap');
        const timeInInput = document.getElementById('attendanceTimeRecordsTimeIn');
        const timeOutInput = document.getElementById('attendanceTimeRecordsTimeOut');
        const locationInput = document.getElementById('attendanceTimeRecordsLocation');
        const otWrap = document.getElementById('attendanceTimeRecordsOtWrap');
        const otFromInput = document.getElementById('attendanceTimeRecordsOtFrom');
        const otToInput = document.getElementById('attendanceTimeRecordsOtTo');
        const imageInput = document.getElementById('attendanceTimeRecordsImage');
        if (!form || !title || !dateLabel) return;
        form.dataset.formMode = mode;
        form.dataset.formDate = dateKey;
        title.textContent = mode === 'delete_day'
            ? 'Request Delete'
            : (mode === 'request_ot' ? 'Request Overtime' : 'Fix Time');
        dateLabel.textContent = `Attendance date: ${window.MargaPayrollCutoff.formatPayrollPeriodDate(dateKey)}`;
        const isTimeFix = mode === 'adjust_time';
        const isOtRequest = mode === 'request_ot';
        if (fixTimeWrap) fixTimeWrap.hidden = !isTimeFix;
        if (locationWrap) locationWrap.hidden = !isTimeFix;
        if (otWrap) otWrap.hidden = !isOtRequest;
        if (timeInInput) timeInInput.required = false;
        if (timeOutInput) timeOutInput.required = false;
        if (locationInput) locationInput.required = false;
        if (otFromInput) otFromInput.required = isOtRequest;
        if (otToInput) otToInput.required = isOtRequest;
        document.getElementById('attendanceTimeRecordsReason').value = '';
        if (timeInInput) timeInInput.value = '';
        if (timeOutInput) timeOutInput.value = '';
        if (locationInput) locationInput.value = '';
        if (otFromInput) otFromInput.value = '';
        if (otToInput) otToInput.value = '';
        updateOtHoursPreview();
        if (imageInput) {
            imageInput.value = '';
            imageInput.required = !isOtRequest;
        }
        renderImagePreview(imageInput);
        form.hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function compressImageFile(file, { maxDimension = 1280, quality = 0.78 } = {}) {
        if (!file || !String(file.type || '').startsWith('image/')) return file;
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise((resolve) => {
            canvas.toBlob((result) => resolve(result || file), 'image/jpeg', quality);
        });
        return blob || file;
    }

    function toFirestoreFieldValue(value) {
        if (value === null || value === undefined) return { nullValue: null };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        }
        if (typeof value === 'object') {
            const fields = {};
            Object.entries(value).forEach(([key, child]) => {
                if (child !== undefined && typeof child !== 'function') fields[key] = toFirestoreFieldValue(child);
            });
            return { mapValue: { fields } };
        }
        return { stringValue: String(value ?? '') };
    }

    async function patchFirestoreDocument(collection, docId, data) {
        const fields = {};
        Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined && typeof value !== 'function') fields[key] = toFirestoreFieldValue(value);
        });
        const response = await fetch(
            `${window.FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${window.FIREBASE_CONFIG.apiKey}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields })
            }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            throw new Error(payload?.error?.message || `Failed to save ${collection}/${docId}`);
        }
        return payload;
    }

    function isAdminRouteUnavailable(message = '', status = 0) {
        const text = String(message || '');
        return status === 404
            || status === 502
            || status === 503
            || /unsupported margabase firestore compatibility path/i.test(text);
    }

    async function postAdjustmentRequest(body, attempt = 1) {
        const response = await fetch(getMargabaseAdminUrl('/admin/hr-attendance-adjustment/request'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            const message = payload?.error?.message || `Request failed with HTTP ${response.status}`;
            if (attempt < 3 && isAdminRouteUnavailable(message, response.status)) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 700));
                return postAdjustmentRequest(body, attempt + 1);
            }
            const error = new Error(message);
            error.status = response.status;
            error.isAdminRouteUnavailable = isAdminRouteUnavailable(message, response.status);
            throw error;
        }
        return payload;
    }

    async function submitAdjustmentFallback(body, imageDataUrl) {
        const adjustmentId = `adj-${body.staff_id}-${String(body.attendance_date || '').replace(/-/g, '')}-${Date.now()}`;
        const attendanceDocIdValue = `${Number(body.staff_id || 0) || 0}_${String(body.attendance_date || '').replace(/[^0-9]/g, '')}`;
        const attendanceRows = await queryAttendanceRange({
            staffId: Number(body.staff_id || 0) || 0,
            from: body.attendance_date,
            to: body.attendance_date,
            limit: 5
        }).catch(() => []);
        const attendance = attendanceRows[0] || {};
        const record = {
            id: adjustmentId,
            staff_id: Number(body.staff_id || 0) || 0,
            staff_name: body.staff_name || '',
            attendance_date: body.attendance_date,
            attendance_doc_id: attendanceDocIdValue,
            request_type: body.request_type || 'adjust_time_in',
            reason: body.reason || '',
            requested_time_in: body.requested_time_in || '',
            requested_time_out: body.requested_time_out || '',
            requested_location_type: body.requested_location_type || '',
            ot_from_time: body.ot_from_time || '',
            ot_to_time: body.ot_to_time || '',
            ot_hours: body.ot_hours || 0,
            before_time_in: attendance.time_in || '',
            before_time_out: attendance.time_out || '',
            before_location_label: locationLabelFromRow(attendance),
            supporting_image_url: '',
            supporting_image_path: '',
            supporting_image_data_url: String(imageDataUrl || '').length <= 900000 ? imageDataUrl : '',
            status: 'pending',
            cutoff_from: body.cutoff_from || '',
            cutoff_to: body.cutoff_to || '',
            source_module: body.source_module || 'dashboard',
            requested_at: new Date().toISOString(),
            requested_by: body.requested_by || '',
            email_sent_at: '',
            email_sent_to: '',
            reviewed_at: '',
            reviewed_by: '',
            review_remarks: '',
            approved_via: '',
            fallback_saved_without_email: true
        };
        await patchFirestoreDocument(ADJUSTMENT_COLLECTION, adjustmentId, record);
        return { ok: true, id: adjustmentId, status: 'pending', fallback: true };
    }

    async function readImageDataUrl(fileInput, { required = true } = {}) {
        const file = fileInput?.files?.[0];
        if (!file) {
            if (required) throw new Error('Supporting image is required.');
            return '';
        }
        if (!String(file.type || '').startsWith('image/')) throw new Error('Only image files are supported.');
        if (file.size > 12_000_000) throw new Error('Supporting image is too large.');
        const compressed = await compressImageFile(file);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Unable to read supporting image.'));
            reader.readAsDataURL(compressed);
        });
    }

    async function submitForm() {
        const formMode = resolveActiveFormMode();
        const formDate = resolveActiveFormDate();
        const reason = String(document.getElementById('attendanceTimeRecordsReason')?.value || '').trim();
        const requestedTimeIn = readTimeFieldValue(document.getElementById('attendanceTimeRecordsTimeIn'));
        const requestedTimeOut = readTimeFieldValue(document.getElementById('attendanceTimeRecordsTimeOut'));
        const requestedLocationType = String(document.getElementById('attendanceTimeRecordsLocation')?.value || '').trim();
        const otTimes = readOtRequestTimes();
        const imageInput = document.getElementById('attendanceTimeRecordsImage');
        const isOtRequest = isOtSubmissionIntent(otTimes, formMode);
        const isDeleteDay = !isOtRequest && formMode === 'delete_day';
        const isTimeFix = !isOtRequest && !isDeleteDay && formMode === 'adjust_time';
        if (!reason) throw new Error('Reason is required.');
        if (!formDate) throw new Error('Attendance date is required.');
        if (isOtRequest) {
            if (!otTimes.fromTime) throw new Error('OT from time is required.');
            if (!otTimes.toTime) throw new Error('OT to time is required.');
            if (otTimes.hours <= 0) throw new Error('OT to time must be later than from time.');
        } else if (isTimeFix) {
            if (!requestedTimeIn && !requestedTimeOut) throw new Error('Enter a requested time in, time out, or both.');
            if (requestedTimeIn && !requestedLocationType) throw new Error('Location is required when adjusting time in.');
            const requestedInDb = requestedTimeIn ? `${formDate} ${requestedTimeIn}:00` : '';
            const requestedOutDb = requestedTimeOut ? `${formDate} ${requestedTimeOut}:00` : '';
            if (requestedInDb && requestedOutDb && requestedOutDb <= requestedInDb) {
                throw new Error('Requested time out must be later than requested time in.');
            }
            const sourceRow = modalState.rows.find((row) => String(row.attendance_date || '').trim() === formDate) || {};
            const currentTimeIn = normalizeDateTime(sourceRow.time_in);
            if (!requestedInDb && requestedOutDb && currentTimeIn && requestedOutDb <= currentTimeIn) {
                throw new Error('Requested time out must be later than the current time in.');
            }
        }
        const imageDataUrl = await readImageDataUrl(imageInput, { required: !isOtRequest && !isDeleteDay });
        const period = normalizePeriodState(modalState.period || getCurrentPeriod());
        modalState.period = period;
        const user = window.MargaAuth?.getUser?.() || {};
        const requestedBy = String(user.name || user.username || modalState.staffName || '').trim();
        const timeInDb = requestedTimeIn
            ? `${formDate} ${requestedTimeIn}:00`
            : '';
        const timeOutDb = requestedTimeOut
            ? `${formDate} ${requestedTimeOut}:00`
            : '';
        const otHours = otTimes.hours;
        const submitBtn = document.getElementById('attendanceTimeRecordsSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;
        const requestType = isDeleteDay
            ? 'delete_day'
            : (isOtRequest ? 'request_ot' : 'adjust_time_in');
        const requestBody = {
            staff_id: modalState.staffId,
            staff_name: modalState.staffName,
            attendance_date: formDate,
            request_type: requestType,
            reason,
            requested_time_in: isOtRequest ? '' : timeInDb,
            requested_time_out: isOtRequest ? '' : timeOutDb,
            requested_location_type: isOtRequest ? '' : requestedLocationType,
            ot_from_time: otTimes.fromTime ? `${formDate} ${otTimes.fromTime}:00` : '',
            ot_to_time: otTimes.toTime ? `${formDate} ${otTimes.toTime}:00` : '',
            ot_hours: isOtRequest ? otHours : 0,
            supporting_image_data_url: imageDataUrl,
            cutoff_from: period.from,
            cutoff_to: period.to,
            source_module: modalState.sourceModule,
            requested_by: requestedBy
        };
        try {
            let payload;
            try {
                payload = await postAdjustmentRequest(requestBody);
            } catch (error) {
                if (!error?.isAdminRouteUnavailable && isLegacyOtApiRejection(error, otTimes)) {
                    const otBody = {
                        ...requestBody,
                        request_type: 'request_ot',
                        requested_time_in: '',
                        requested_location_type: '',
                        ot_from_time: otTimes.fromTime ? `${formDate} ${otTimes.fromTime}:00` : '',
                        ot_to_time: otTimes.toTime ? `${formDate} ${otTimes.toTime}:00` : '',
                        ot_hours: otHours
                    };
                    payload = await submitAdjustmentFallback(otBody, imageDataUrl);
                } else if (!error?.isAdminRouteUnavailable) {
                    throw error;
                } else {
                    payload = await submitAdjustmentFallback(requestBody, imageDataUrl);
                }
            }
            hideForm();
            await refreshModalData();
            alert(payload?.fallback
                ? 'Request saved for HR review. Email notification will follow when the server link recovers.'
                : 'Request submitted. HR will review after email approval.');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function renderTotals(container, totals, {
        compact = false,
        payrollAligned = false,
        requestedOt = null
    } = {}) {
        if (!container) return;
        container.classList.toggle('is-compact', compact);
        const otSummary = requestedOt && requestedOt.count > 0 ? requestedOt : null;
        const otCard = otSummary
            ? `<article class="attendance-time-records-total is-requested-ot">
                    <span>Requested OT</span>
                    <strong>${otSummary.totalHours.toFixed(2)} hr</strong>
                    <small>${otSummary.approvedHours.toFixed(2)} approved${otSummary.pendingHours > 0 ? ` · ${otSummary.pendingHours.toFixed(2)} pending` : ''}${otSummary.missingApprovedHours > 0 ? ' · hours missing on approved row' : ''}</small>
               </article>`
            : '';
        container.innerHTML = `
            <article class="attendance-time-records-total">
                <span>Attendance Days</span>
                <strong>${totals.totalAttendance}</strong>
            </article>
            <article class="attendance-time-records-total">
                <span>Late Minutes</span>
                <strong>${totals.totalLateMinutes} min</strong>
            </article>
            <article class="attendance-time-records-total">
                <span>Absences</span>
                <strong>${totals.totalAbsent}</strong>
            </article>
            ${otCard}
            ${payrollAligned ? '<p class="attendance-time-records-payroll-note">Totals use the same attendance-day, late-minute, and absence rules as HR Payroll. Requested OT uses approved and pending overtime requests in this cutoff.</p>' : ''}
        `;
    }

    function renderTableBody(tbody, dateRows, pendingByDate, interactive = true, otByDate = new Map(), options = {}) {
        if (!tbody) return;
        tbody.innerHTML = dateRows.map(({ dateKey, row }) => {
            const pending = pendingByDate.get(dateKey);
            const otAdjustment = otByDate.get(dateKey);
            const pendingBadge = pending && !isOvertimeAdjustment(pending)
                ? `<span class="attendance-time-records-badge">${isDeleteDayAdjustment(pending) ? 'Delete pending' : 'Time adjustment pending'}</span>`
                : '';
            const otBadge = otAdjustment ? renderOtAdjustmentBadge(otAdjustment) : '';
            const hrRemoveOtAction = !interactive && options.allowOtRemoval && otAdjustment
                ? `<div class="attendance-time-records-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-remove-ot-adjustment="${escapeHtml(otAdjustment.id)}">Remove OT</button>
                   </div>`
                : '';
            const actions = interactive
                ? `<div class="attendance-time-records-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-attendance-adjust="${dateKey}">Fix Time</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-attendance-ot="${dateKey}">Request OT</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-attendance-delete="${dateKey}">Delete</button>
                   </div>`
                : (hrRemoveOtAction || '<span class="attendance-time-records-status">Read only</span>');
            const hasAttendance = Boolean(normalizeDateTime(row.time_in));
            const absentClass = hasAttendance ? '' : ' is-absent-day';
            return `
                <tr class="${absentClass.trim()}">
                    <td>${window.MargaPayrollCutoff.formatPayrollPeriodDate(dateKey)}${otBadge || pendingBadge ? `<div>${[otBadge, pendingBadge].filter(Boolean).join(' ')}</div>` : ''}</td>
                    <td>${locationLabelFromRow(row)}</td>
                    <td>${formatTime(row.time_in)}</td>
                    <td>${formatTime(row.time_out)}</td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join('');
        if (interactive) {
            tbody.querySelectorAll('[data-attendance-adjust]').forEach((button) => {
                button.addEventListener('click', () => showForm(button.dataset.attendanceAdjust, 'adjust_time'));
            });
            tbody.querySelectorAll('[data-attendance-ot]').forEach((button) => {
                button.addEventListener('click', () => showForm(button.dataset.attendanceOt, 'request_ot'));
            });
            tbody.querySelectorAll('[data-attendance-delete]').forEach((button) => {
                button.addEventListener('click', () => {
                    if (!window.confirm('Send a delete request to HR for this attendance day?')) return;
                    showForm(button.dataset.attendanceDelete, 'delete_day');
                });
            });
        } else if (options.allowOtRemoval) {
            tbody.querySelectorAll('[data-remove-ot-adjustment]').forEach((button) => {
                button.addEventListener('click', async () => {
                    if (!window.confirm('Remove this OT from payroll and time records?')) return;
                    try {
                        await removeOtAdjustment(button.dataset.removeOtAdjustment);
                        await refreshHrAdjustments();
                        await refreshHrRecords();
                        alert('OT removed.');
                    } catch (error) {
                        alert(error?.message || 'Unable to remove OT.');
                    }
                });
            });
        }
    }

    async function refreshModalData() {
        const status = document.getElementById('attendanceTimeRecordsStatus');
        if (status) status.textContent = 'Loading time records...';
        const period = normalizePeriodState(modalState.period || getCurrentPeriod());
        modalState.period = period;
        const [rows, adjustments] = await Promise.all([
            queryAttendanceRange({ staffId: modalState.staffId, from: period.from, to: period.to }),
            fetchAdjustments('').catch(() => [])
        ]);
        const payDate = window.MargaPayrollCutoff.getPayrollPayDate(period);
        modalState.rows = rows;
        modalState.period = period;
        const pendingByDate = new Map();
        const otByDate = buildOtAdjustmentsByDate(adjustments, modalState.staffId, period);
        adjustments
            .filter((row) => Number(row.staff_id || 0) === Number(modalState.staffId || 0) && String(row.status || '') === 'pending')
            .forEach((row) => pendingByDate.set(String(row.attendance_date || ''), row));
        modalState.pendingByDate = pendingByDate;
        const requestedOt = summarizeRequestedOt(adjustments, modalState.staffId, period);
        const heading = window.MargaPayrollCutoff.formatCutoffHeading(period);
        document.getElementById('attendanceTimeRecordsTitle').textContent = heading.title;
        const payNote = payDate ? ` · Payroll ${window.MargaPayrollCutoff.formatPayrollPeriodDate(payDate)}` : '';
        document.getElementById('attendanceTimeRecordsSubtitle').textContent = `${heading.subtitle} · ${modalState.staffName || 'Staff'}${payNote}`;
        renderTotals(
            document.getElementById('attendanceTimeRecordsTotals'),
            computeTotals(rows, period, modalState.staffId, modalState.staffName),
            { requestedOt }
        );
        renderTableBody(
            document.getElementById('attendanceTimeRecordsTableBody'),
            buildDateRows(rows, period),
            pendingByDate,
            true,
            otByDate
        );
        if (status) status.textContent = '';
        syncPayrollPeriodSelect('attendanceTimeRecordsPeriodSelect', period);
    }

    function closeModal() {
        const modal = document.getElementById('attendanceTimeRecordsModal');
        if (modal) modal.classList.remove('open');
        hideForm();
    }

    async function openModal(options = {}) {
        if (!window.MargaPayrollCutoff || !window.MargaUtils || !window.FIREBASE_CONFIG) {
            alert('Time records module is not fully loaded.');
            return;
        }
        const staffId = Number(options.staffId || 0) || 0;
        if (!staffId) {
            alert('Staff ID is required for time records.');
            return;
        }
        ensureModalDom();
        modalState.staffId = staffId;
        modalState.staffName = String(options.staffName || '').trim();
        modalState.sourceModule = String(options.sourceModule || 'field').trim();
        modalState.period = normalizePeriodState(options.period || getCurrentPeriod());
        hideForm();
        syncPayrollPeriodSelect('attendanceTimeRecordsPeriodSelect', modalState.period);
        document.getElementById('attendanceTimeRecordsModal').classList.add('open');
        try {
            await refreshModalData();
        } catch (error) {
            console.error('Time records load failed:', error);
            const status = document.getElementById('attendanceTimeRecordsStatus');
            if (status) status.textContent = error?.message || 'Unable to load time records.';
        }
    }

    function buildEmployeeOptions(employees, selectedStaffId) {
        return getSortedEmployees(employees)
            .map((employee) => {
                const selected = Number(employee.id) === Number(selectedStaffId || 0) ? 'selected' : '';
                return `<option value="${employee.id}" ${selected}>${employee.name} (#${employee.id})</option>`;
            })
            .join('');
    }

    function mountHrPane(root, options = {}) {
        if (!root || !window.MargaPayrollCutoff) return;
        hrState.employees = Array.isArray(options.employees) ? options.employees : [];
        const period = normalizePeriodState(options.period || getCurrentPeriod());
        hrState.period = period;
        const sortedEmployees = getSortedEmployees(hrState.employees);
        hrState.selectedStaffId = Number(
            options.selectedStaffId
            || sortedEmployees[0]?.id
            || hrState.employees[0]?.id
            || 0
        ) || 0;
        root.innerHTML = `
            <div class="hr-time-records-shell">
            <div class="attendance-time-records-subtabs" role="tablist">
                <button type="button" class="attendance-time-records-subtab active" data-hr-time-subtab="records">All Staff Records</button>
                <button type="button" class="attendance-time-records-subtab" data-hr-time-subtab="adjustments">Adjustment Requests <span id="hrTimeRecordsPendingCount"></span></button>
            </div>
            <div id="hrTimeRecordsRecordsPane">
                <div class="hr-time-records-toolbar">
                    <div class="hr-time-records-cutoff-group">
                        <label class="attendance-time-records-period-label">
                            <span>Payroll Period</span>
                            <select id="hrTimeRecordsPeriodSelect">${renderPayrollPeriodSelectOptions(period)}</select>
                        </label>
                        <button type="button" class="btn btn-secondary btn-sm" id="hrTimeRecordsCurrentCutoffBtn">Current Cutoff</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="hrTimeRecordsRefreshBtn">Refresh</button>
                    </div>
                    <div class="hr-time-records-staff-nav" aria-label="Employee navigation">
                        <button type="button" class="hr-time-records-nav-btn" id="hrTimeRecordsPrevBtn" aria-label="Previous employee">‹</button>
                        <div class="hr-time-records-staff-meta">
                            <strong id="hrTimeRecordsStaffPosition">1 / ${sortedEmployees.length || 0}</strong>
                            <span id="hrTimeRecordsStaffName">${sortedEmployees[0]?.name || 'No employee selected'}</span>
                        </div>
                        <button type="button" class="hr-time-records-nav-btn" id="hrTimeRecordsNextBtn" aria-label="Next employee">›</button>
                        <label class="hr-time-records-staff-select-wrap">
                            <span>Jump to</span>
                            <select id="hrTimeRecordsEmployee">${buildEmployeeOptions(hrState.employees, hrState.selectedStaffId)}</select>
                        </label>
                    </div>
                </div>
                <div class="hr-time-records-context-bar" id="hrTimeRecordsHeading"></div>
                <div class="attendance-time-records-totals" id="hrTimeRecordsTotals"></div>
                <div class="attendance-time-records-table-wrap hr-time-records-table-wrap">
                    <table class="attendance-time-records-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Location</th>
                                <th>Time In</th>
                                <th>Time Out</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="hrTimeRecordsTableBody"></tbody>
                    </table>
                </div>
            </div>
            </div>
            <div id="hrTimeRecordsAdjustmentsPane" hidden>
                <p class="attendance-time-records-status" id="hrTimeRecordsAdjustmentsStatus"></p>
                <div class="attendance-time-records-table-wrap">
                    <table class="attendance-time-records-table">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Date</th>
                                <th>Request</th>
                                <th>Reason</th>
                                <th>Image</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="hrTimeRecordsAdjustmentsBody"></tbody>
                    </table>
                </div>
            </div>
        `;
        root.querySelectorAll('[data-hr-time-subtab]').forEach((button) => {
            button.addEventListener('click', () => setHrSubtab(button.dataset.hrTimeSubtab));
        });
        document.getElementById('hrTimeRecordsRefreshBtn')?.addEventListener('click', () => {
            refreshHrRecords().catch((error) => alert(error?.message || error));
        });
        document.getElementById('hrTimeRecordsEmployee')?.addEventListener('change', (event) => {
            hrState.selectedStaffId = Number(event.target.value || 0) || 0;
            updateStaffNavigator();
            refreshHrRecords().catch((error) => alert(error?.message || error));
        });
        document.getElementById('hrTimeRecordsPrevBtn')?.addEventListener('click', () => navigateEmployee(-1));
        document.getElementById('hrTimeRecordsNextBtn')?.addEventListener('click', () => navigateEmployee(1));
        bindPayrollPeriodSelect('hrTimeRecordsPeriodSelect', (nextPeriod) => {
            hrState.period = normalizePeriodState(nextPeriod);
            refreshHrRecords().catch((error) => alert(error?.message || error));
        });
        document.getElementById('hrTimeRecordsCurrentCutoffBtn')?.addEventListener('click', () => {
            hrState.period = normalizePeriodState(getCurrentPeriod());
            syncPayrollPeriodSelect('hrTimeRecordsPeriodSelect', hrState.period);
            refreshHrRecords().catch((error) => alert(error?.message || error));
        });
        if (options.initialSubtab) setHrSubtab(options.initialSubtab);
        updateStaffNavigator();
        refreshHrRecords().catch((error) => {
            const status = document.getElementById('hrTimeRecordsHeading');
            if (status) status.textContent = error?.message || 'Unable to load HR time records.';
        });
        refreshHrAdjustments(options.selectedRequestId || '').catch((error) => {
            const status = document.getElementById('hrTimeRecordsAdjustmentsStatus');
            if (status) status.textContent = error?.message || 'Unable to load adjustment requests.';
        });
    }

    function setHrSubtab(subtab) {
        hrState.subtab = subtab === 'adjustments' ? 'adjustments' : 'records';
        document.querySelectorAll('[data-hr-time-subtab]').forEach((button) => {
            button.classList.toggle('active', button.dataset.hrTimeSubtab === hrState.subtab);
        });
        document.getElementById('hrTimeRecordsRecordsPane').hidden = hrState.subtab !== 'records';
        document.getElementById('hrTimeRecordsAdjustmentsPane').hidden = hrState.subtab !== 'adjustments';
    }

    async function refreshHrRecords() {
        const period = normalizePeriodState(hrState.period || getCurrentPeriod());
        hrState.period = period;
        const { employees, index } = getSelectedEmployeeIndex();
        const employee = employees[index] || null;
        const staffId = Number(employee?.id || hrState.selectedStaffId || 0) || 0;
        updateStaffNavigator();
        const heading = window.MargaPayrollCutoff.formatCutoffHeading(period);
        const payDate = window.MargaPayrollCutoff.getPayrollPayDate(period);
        const headingEl = document.getElementById('hrTimeRecordsHeading');
        if (headingEl) {
            const payNote = payDate ? `Payroll ${window.MargaPayrollCutoff.formatPayrollPeriodDate(payDate)}` : '';
            headingEl.innerHTML = `
                <span class="hr-time-records-context-title">${heading.title}</span>
                <span class="hr-time-records-context-meta">${heading.subtitle}${payNote ? ` · ${payNote}` : ''}</span>
            `;
        }
        const [rows, adjustments] = await Promise.all([
            staffId ? queryAttendanceRange({ staffId, from: period.from, to: period.to }) : Promise.resolve([]),
            staffId ? fetchAdjustments('').catch(() => []) : Promise.resolve([])
        ]);
        const requestedOt = summarizeRequestedOt(adjustments, staffId, period);
        const otByDate = buildOtAdjustmentsByDate(adjustments, staffId, period);
        renderTotals(
            document.getElementById('hrTimeRecordsTotals'),
            computeTotals(rows, period, employee || staffId, employee?.name || ''),
            { compact: true, payrollAligned: true, requestedOt }
        );
        const matchedRows = rows.filter((row) => window.MargaPayrollCutoff.rowMatchesEmployee(
            row,
            window.MargaPayrollCutoff.employeeKeys(employee || { id: staffId, staff_id: staffId })
        ));
        renderTableBody(
            document.getElementById('hrTimeRecordsTableBody'),
            buildDateRows(matchedRows.length ? matchedRows : rows, period),
            new Map(),
            false,
            otByDate,
            { allowOtRemoval: true }
        );
        syncPayrollPeriodSelect('hrTimeRecordsPeriodSelect', period);
    }

    async function promptAdminPassword() {
        const password = window.prompt('Enter admin approval password:');
        if (!password) throw new Error('Approval cancelled.');
        return String(password).trim();
    }

    async function approveAdjustment(adjustmentId) {
        const password = await promptAdminPassword();
        const user = window.MargaAuth?.getUser?.() || {};
        const response = await fetch(getMargabaseAdminUrl('/admin/hr-attendance-adjustment/approve'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: adjustmentId,
                password,
                reviewed_by: String(user.name || user.username || 'hr-admin').trim()
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            const message = payload?.error?.message || `Approve failed with HTTP ${response.status}`;
            if (/unsupported margabase firestore compatibility path/i.test(message)) {
                throw new Error('Approve API is not available yet. Restart the Margabase API service, then try again.');
            }
            throw new Error(message);
        }
        return payload;
    }

    async function rejectAdjustment(adjustmentId) {
        const remarks = window.prompt('Optional reject remark:') || '';
        const user = window.MargaAuth?.getUser?.() || {};
        const response = await fetch(getMargabaseAdminUrl('/admin/hr-attendance-adjustment/reject'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: adjustmentId,
                review_remarks: remarks,
                reviewed_by: String(user.name || user.username || 'hr-admin').trim()
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            const message = payload?.error?.message || `Reject failed with HTTP ${response.status}`;
            if (/unsupported margabase firestore compatibility path/i.test(message)) {
                throw new Error('Reject API is not available yet. Restart the Margabase API service, then try again.');
            }
            throw new Error(message);
        }
        return payload;
    }

    async function verifyCurrentAdminPassword(password) {
        const auth = window.MargaAuth;
        const sessionUser = auth?.getUser?.() || {};
        const ident = String(sessionUser.email || sessionUser.username || '').trim();
        if (!ident || typeof auth?.findUserByEmailOrUsername !== 'function' || typeof auth?.verifyPassword !== 'function') {
            throw new Error('Current admin account could not be verified.');
        }
        const userRecord = await auth.findUserByEmailOrUsername(ident);
        if (!userRecord) throw new Error('Current admin account could not be verified.');
        const valid = await auth.verifyPassword(userRecord, password);
        if (!valid) throw new Error('Admin password is incorrect.');
        return userRecord;
    }

    async function removeOtAdjustment(adjustmentId) {
        const password = await promptAdminPassword();
        const userRecord = await verifyCurrentAdminPassword(password);
        const user = window.MargaAuth?.getUser?.() || {};
        const response = await fetch(getMargabaseAdminUrl('/admin/hr-attendance-adjustment/remove-ot'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: adjustmentId,
                password,
                reviewed_by: String(user.name || user.username || 'hr-admin').trim(),
                reviewed_by_email: String(userRecord?.email || user.email || '').trim()
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
            const message = payload?.error?.message || `Remove OT failed with HTTP ${response.status}`;
            if (/unsupported margabase firestore compatibility path/i.test(message) || response.status === 404) {
                throw new Error('Remove OT API is not available yet. Restart the Margabase API service, then try again.');
            }
            throw new Error(message);
        }
        return payload;
    }

    function imageLink(row = {}) {
        const inline = String(row.supporting_image_data_url || '').trim();
        if (inline.startsWith('data:image/')) {
            return `<a href="${inline}" target="_blank" rel="noopener">View</a>`;
        }
        const text = String(row.supporting_image_url || '').trim();
        if (!text) return '--';
        const href = text.startsWith('http') ? text : `${window.location.origin}${text.startsWith('/') ? '' : '/'}${text}`;
        return `<a href="${href}" target="_blank" rel="noopener">View</a>`;
    }

    async function refreshHrAdjustments(selectedRequestId = '') {
        const statusEl = document.getElementById('hrTimeRecordsAdjustmentsStatus');
        if (statusEl) statusEl.textContent = 'Loading adjustment requests...';
        let rows = [];
        try {
            rows = await fetchAdjustments('');
        } catch (error) {
            if (statusEl) statusEl.textContent = error?.message || 'Unable to load adjustment requests.';
            return;
        }
        if (statusEl) statusEl.textContent = rows.length ? '' : 'No adjustment requests yet.';
        const pendingCount = rows.filter((row) => String(row.status || '') === 'pending').length;
        const countEl = document.getElementById('hrTimeRecordsPendingCount');
        if (countEl) countEl.textContent = pendingCount ? `(${pendingCount})` : '';
        const tbody = document.getElementById('hrTimeRecordsAdjustmentsBody');
        if (!tbody) return;
        const sorted = rows.slice().sort((left, right) => {
            const leftPending = String(left.status || '') === 'pending' ? 0 : 1;
            const rightPending = String(right.status || '') === 'pending' ? 0 : 1;
            if (leftPending !== rightPending) return leftPending - rightPending;
            return String(right.requested_at || '').localeCompare(String(left.requested_at || ''));
        });
        tbody.innerHTML = sorted.map((row) => {
            const isPending = String(row.status || '') === 'pending';
            const requestLabel = row.request_type === 'delete_day'
                ? 'Delete day'
                : (row.request_type === 'request_ot'
                    ? `OT ${formatTime(row.ot_from_time)} to ${formatTime(row.ot_to_time)} (${overtimeHoursFromAdjustment(row).toFixed(2)} hr)`
                    : buildTimeAdjustmentSummary(row));
            const detailLine = row.request_type === 'request_ot'
                ? '<div class="attendance-time-records-status">Approved OT flows into payroll when approved</div>'
                : `<div class="attendance-time-records-status">Current in ${formatTime(row.before_time_in)} · out ${formatTime(row.before_time_out)}</div>`;
            const actions = isPending
                ? `<div class="attendance-time-records-actions">
                        <button type="button" class="btn btn-primary btn-sm" data-hr-adjustment-approve="${row.id}">Approve</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-hr-adjustment-reject="${row.id}">Reject</button>
                   </div>`
                : '<span class="attendance-time-records-status">Closed</span>';
            const highlight = selectedRequestId && row.id === selectedRequestId ? ' style="background:#fff8e8"' : '';
            return `
                <tr${highlight}>
                    <td>${row.staff_name || '--'}<div class="attendance-time-records-status">#${row.staff_id || '--'}</div></td>
                    <td>${window.MargaPayrollCutoff.formatPayrollPeriodDate(row.attendance_date)}</td>
                    <td>${requestLabel}${detailLine}</td>
                    <td>${row.reason || '--'}</td>
                    <td>${imageLink(row)}</td>
                    <td>${row.status || '--'}</td>
                    <td>${actions}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7">No adjustment requests yet.</td></tr>';

        tbody.querySelectorAll('[data-hr-adjustment-approve]').forEach((button) => {
            button.addEventListener('click', async () => {
                try {
                    await approveAdjustment(button.dataset.hrAdjustmentApprove);
                    await refreshHrAdjustments();
                    await refreshHrRecords();
                    alert('Adjustment approved.');
                } catch (error) {
                    alert(error?.message || 'Approve failed.');
                }
            });
        });
        tbody.querySelectorAll('[data-hr-adjustment-reject]').forEach((button) => {
            button.addEventListener('click', async () => {
                try {
                    await rejectAdjustment(button.dataset.hrAdjustmentReject);
                    await refreshHrAdjustments();
                    alert('Adjustment rejected.');
                } catch (error) {
                    alert(error?.message || 'Reject failed.');
                }
            });
        });
        if (selectedRequestId) setHrSubtab('adjustments');
    }

    window.MargaAttendanceTimeRecords = {
        openModal,
        mountHrPane,
        getMargabaseAdminUrl,
        buildTimeAdjustmentSummary,
        locationLabelFromRow,
        computeTotals,
        queryAttendanceRange,
        fetchAdjustments,
        approveAdjustment,
        rejectAdjustment,
        removeOtAdjustment,
        formatTime,
        overtimeHoursFromAdjustment,
        summarizeRequestedOt,
        adjustmentMatchesPeriod
    };

    function getDashboardStaffId(user = {}) {
        const direct = Number(user.staff_id || user.staffId || user.employee_id || user.employeeId || 0) || 0;
        if (direct) return direct;
        const fromUsername = String(user.username || '').match(/(\d+)/);
        return fromUsername ? Number(fromUsername[1]) || 0 : 0;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('[data-office-attendance-time-records]')?.addEventListener('click', () => {
            const user = window.MargaAuth?.getUser?.() || {};
            const staffId = getDashboardStaffId(user);
            if (!staffId) {
                alert('Staff ID is required for time records.');
                return;
            }
            openModal({
                staffId,
                staffName: String(user.name || user.username || '').trim(),
                sourceModule: 'dashboard'
            }).catch((error) => {
                console.error('Dashboard time records open failed:', error);
                alert(error?.message || 'Unable to open time records.');
            });
        });
    });
}());
