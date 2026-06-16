/**
 * Shared payroll cutoff helpers for HR, Field, and Dashboard time records.
 */
(function () {
    const REGULAR_START_HOUR = 8;
    const REGULAR_START_MINUTE = 0;

    function parsePayrollDate(value) {
        if (!value) return null;
        const date = new Date(`${value}T12:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function todayDateKey() {
        return formatDateInputValue(new Date());
    }

    function firstPayrollPeriod(dateKey) {
        const base = parsePayrollDate(dateKey) || new Date();
        const year = base.getFullYear();
        const month = base.getMonth();
        const day = base.getDate();
        if (day <= 10) {
            return {
                from: formatDateInputValue(new Date(year, month - 1, 26)),
                to: formatDateInputValue(new Date(year, month, 10))
            };
        }
        return {
            from: formatDateInputValue(new Date(year, month, 26)),
            to: formatDateInputValue(new Date(year, month + 1, 10))
        };
    }

    function secondPayrollPeriod(dateKey) {
        const base = parsePayrollDate(dateKey) || new Date();
        const year = base.getFullYear();
        const month = base.getMonth();
        return {
            from: formatDateInputValue(new Date(year, month, 11)),
            to: formatDateInputValue(new Date(year, month, 25))
        };
    }

    function recommendedPayrollPeriod(dateKey) {
        const base = parsePayrollDate(dateKey) || new Date();
        const day = base.getDate();
        if (day >= 11 && day <= 25) return secondPayrollPeriod(dateKey);
        return firstPayrollPeriod(dateKey);
    }

    /**
     * Default Time Records / payroll-review window.
     * Includes the 5-day lead time before the 15th and 30th pay dates.
     */
    function timeRecordsPayrollPeriod(dateKey) {
        const base = parsePayrollDate(dateKey) || new Date();
        const year = base.getFullYear();
        const month = base.getMonth();
        const day = base.getDate();
        if (day >= 11 && day <= 15) {
            return {
                from: formatDateInputValue(new Date(year, month - 1, 26)),
                to: formatDateInputValue(new Date(year, month, 10))
            };
        }
        if (day >= 16 && day <= 25) {
            return {
                from: formatDateInputValue(new Date(year, month, 11)),
                to: formatDateInputValue(new Date(year, month, 25))
            };
        }
        if (day >= 26) {
            return {
                from: formatDateInputValue(new Date(year, month, 11)),
                to: formatDateInputValue(new Date(year, month, 25))
            };
        }
        return {
            from: formatDateInputValue(new Date(year, month - 1, 26)),
            to: formatDateInputValue(new Date(year, month, 10))
        };
    }

    function isPayrollPeriodComplete(period, dateKey = todayDateKey()) {
        const today = parsePayrollDate(dateKey);
        const toDate = parsePayrollDate(period?.to);
        if (!today || !toDate) return false;
        return today > toDate;
    }

    function formatPayrollPeriodOptionLabel(period, { includeStatus = true } = {}) {
        const profile = getPayrollCutoffProfile(period);
        const range = `${formatPayrollPeriodDate(period.from)} – ${formatPayrollPeriodDate(period.to)}`;
        if (!includeStatus) return `${profile.title} (${range})`;
        const status = isPayrollPeriodComplete(period) ? 'Complete' : 'In progress';
        return `${profile.title} (${range}) — ${status}`;
    }

    function listPayrollPeriodOptions(count = 16, dateKey = todayDateKey()) {
        const today = parsePayrollDate(dateKey) || new Date();
        const candidates = [];
        for (let monthOffset = 0; monthOffset < 30; monthOffset += 1) {
            const anchor = new Date(today.getFullYear(), today.getMonth() - monthOffset, 15);
            const year = anchor.getFullYear();
            const month = anchor.getMonth();
            candidates.push({
                from: formatDateInputValue(new Date(year, month, 11)),
                to: formatDateInputValue(new Date(year, month, 25))
            });
            candidates.push({
                from: formatDateInputValue(new Date(year, month - 1, 26)),
                to: formatDateInputValue(new Date(year, month, 10))
            });
        }
        const seen = new Set();
        const unique = [];
        candidates.forEach((period) => {
            const key = `${period.from}_${period.to}`;
            if (seen.has(key)) return;
            const toDate = parsePayrollDate(period.to);
            if (!toDate) return;
            seen.add(key);
            unique.push({
                ...period,
                key,
                complete: today > toDate,
                profile: getPayrollCutoffProfile(period),
                sortTo: toDate.getTime()
            });
        });
        return unique
            .sort((left, right) => right.sortTo - left.sortTo)
            .slice(0, Math.max(1, count))
            .map((period) => ({
                ...period,
                label: formatPayrollPeriodOptionLabel(period)
            }));
    }

    function lastCompletePayrollPeriod(dateKey = todayDateKey()) {
        const options = listPayrollPeriodOptions(24, dateKey);
        return options.find((period) => period.complete) || options[0] || firstPayrollPeriod(dateKey);
    }

    function getPayrollPayDate(period) {
        const profile = getPayrollCutoffProfile(period);
        const toDate = parsePayrollDate(period?.to);
        if (!toDate) return '';
        if (profile.key === 'first_cutoff') {
            return formatDateInputValue(new Date(toDate.getFullYear(), toDate.getMonth(), 15));
        }
        if (profile.key === 'second_cutoff') {
            return formatDateInputValue(new Date(toDate.getFullYear(), toDate.getMonth(), 30));
        }
        return '';
    }

    function getTimeRecordsDisplayWindow(period, dateKey = todayDateKey()) {
        const today = parsePayrollDate(dateKey);
        const fromDate = parsePayrollDate(period?.from);
        const toDate = parsePayrollDate(period?.to);
        if (!fromDate || !toDate) {
            return { rangeStart: period?.from || '', rangeEnd: period?.to || '', isClosed: false };
        }
        if (today && today < fromDate) {
            return {
                rangeStart: period.from,
                rangeEnd: period.from,
                isClosed: false,
                isFuture: true
            };
        }
        if (today && today > toDate) {
            return {
                rangeStart: period.from,
                rangeEnd: period.to,
                isClosed: true
            };
        }
        return {
            rangeStart: period.from,
            rangeEnd: today ? formatDateInputValue(today) : period.to,
            isClosed: false
        };
    }

    function getPayrollCutoffProfile(period) {
        const from = parsePayrollDate(period?.from);
        const to = parsePayrollDate(period?.to);
        if (from && to) {
            if (from.getDate() === 26 && to.getDate() === 10) {
                return { key: 'first_cutoff', title: '15th payroll (26th to 10th)', paySide: '15th' };
            }
            if (from.getDate() === 11 && to.getDate() === 25 && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
                return { key: 'second_cutoff', title: '30th payroll (11th to 25th)', paySide: '30th' };
            }
        }
        return { key: 'custom', title: 'Custom cutoff', paySide: '' };
    }

    function formatPayrollPeriodDate(value) {
        const date = parsePayrollDate(value);
        if (!date) return String(value || '');
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    function formatCutoffHeading(period, todayKey = todayDateKey()) {
        const profile = getPayrollCutoffProfile(period);
        return {
            title: `Time Records — ${profile.title.replace('First cutoff', 'First cutoff').replace('Second cutoff', 'Second cutoff')} (${formatPayrollPeriodDate(period.from)} – ${formatPayrollPeriodDate(period.to)})`,
            subtitle: `Today: ${formatPayrollPeriodDate(todayKey)}`,
            profile
        };
    }

    function countPayrollWorkdays(startDate, endDate) {
        const cursor = new Date(startDate.getTime());
        cursor.setHours(12, 0, 0, 0);
        const end = new Date(endDate.getTime());
        end.setHours(12, 0, 0, 0);
        let count = 0;
        while (cursor <= end) {
            if (cursor.getDay() !== 0) count += 1;
            cursor.setDate(cursor.getDate() + 1);
        }
        return count;
    }

    function normalizeDateTime(value) {
        const text = String(value || '').trim();
        if (!text || text === '0000-00-00 00:00:00') return '';
        return text;
    }

    function minutesAfterEight(timeValue) {
        const normalized = normalizeDateTime(timeValue);
        if (!normalized) return 0;
        const actual = new Date(normalized.replace(' ', 'T'));
        if (Number.isNaN(actual.getTime())) return 0;
        const grace = new Date(actual);
        grace.setHours(REGULAR_START_HOUR, REGULAR_START_MINUTE, 0, 0);
        return Math.max(0, Math.ceil((actual.getTime() - grace.getTime()) / 60000));
    }

    function getLivePayrollWindow(period) {
        const fromDate = parsePayrollDate(period.from);
        const toDate = parsePayrollDate(period.to);
        const today = parsePayrollDate(todayDateKey()) || new Date();
        if (!fromDate || !toDate) {
            return {
                rangeStart: period.from,
                rangeEnd: period.to,
                configuredFrom: period.from,
                configuredTo: period.to,
                isLive: false,
                isFuture: false
            };
        }
        const configuredTo = formatDateInputValue(toDate);
        if (today < fromDate) {
            return {
                rangeStart: period.from,
                rangeEnd: period.from,
                configuredFrom: period.from,
                configuredTo,
                isLive: false,
                isFuture: true
            };
        }
        const effectiveTo = today < toDate ? today : toDate;
        const rangeEnd = formatDateInputValue(effectiveTo);
        return {
            rangeStart: period.from,
            rangeEnd,
            configuredFrom: period.from,
            configuredTo,
            isLive: effectiveTo < toDate,
            isFuture: false
        };
    }

    function normalizeStaffKey(value) {
        return String(value ?? '').trim().toLowerCase();
    }

    function firstPresent(row, keys = []) {
        for (const key of keys) {
            const value = row?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return '';
    }

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function timeFromDateTime(value) {
        const text = normalizeDateTime(value);
        const match = text.match(/(?:T|\s)(\d{2}):(\d{2})/);
        return match ? `${match[1]}:${match[2]}` : '';
    }

    function payrollMinutesAfterEight(value) {
        const time = timeFromDateTime(value);
        if (!time) return 0;
        const [hour, minute] = time.split(':').map(Number);
        return Math.max(0, (hour * 60 + minute) - (8 * 60));
    }

    function employeeKeys(employee = {}) {
        const fullName = window.MargaUtils?.getEmployeeFullName?.(employee, '') || '';
        return [
            employee.id,
            employee._docId,
            employee.email,
            employee.marga_login_email,
            employee.username,
            fullName
        ].map(normalizeStaffKey).filter(Boolean);
    }

    function rowMatchesEmployee(row, keys) {
        const keySet = keys instanceof Set ? keys : new Set(keys);
        const values = [
            row?.tech_id,
            row?.staff_id,
            row?.employee_id,
            row?.employeeId,
            row?.requester_staff_id,
            row?.staff_name,
            row?.requester_name,
            row?.staff,
            row?.user_name
        ].map(normalizeStaffKey).filter(Boolean);
        return values.some((value) => keySet.has(value));
    }

    /**
     * Same attendance-day, late-minute, and absence math used by HR payroll.
     */
    function computePayrollAttendanceSummary(employee, attendanceRows = [], period = {}) {
        const live = getLivePayrollWindow(period);
        if (live.isFuture || !live.rangeStart || !live.rangeEnd) {
            return { daysWorked: 0, elapsedDays: 0, absences: 0, minutesLate: 0, utHours: 0 };
        }
        const startDate = parsePayrollDate(live.rangeStart);
        const endDate = parsePayrollDate(live.rangeEnd);
        if (!startDate || !endDate) {
            return { daysWorked: 0, elapsedDays: 0, absences: 0, minutesLate: 0, utHours: 0 };
        }
        const hireRaw = firstPresent(employee, ['hire_date', 'date_hired', 'employment_date', 'start_date']);
        const hireDate = parsePayrollDate(hireRaw);
        const effectiveStart = hireDate && hireDate > startDate ? hireDate : startDate;
        const elapsedDays = effectiveStart > endDate ? 0 : countPayrollWorkdays(effectiveStart, endDate);
        const keySet = new Set(employeeKeys(employee));
        const seenDates = new Set();
        let minutesLate = 0;
        let utHours = 0;
        attendanceRows.forEach((row) => {
            if (!rowMatchesEmployee(row, keySet)) return;
            const dateKey = String(firstPresent(row, ['attendance_date']) || '').trim();
            if (!dateKey || seenDates.has(dateKey)) return;
            seenDates.add(dateKey);
            const savedLate = Math.max(0, toNumber(firstPresent(row, ['time_in_late_minutes', 'late_minutes', 'minutes_late'])));
            minutesLate += savedLate || payrollMinutesAfterEight(firstPresent(row, ['time_in'])) || 0;
            utHours += Math.max(0, toNumber(firstPresent(row, ['ut_hours', 'undertime_hours', 'undertime'])));
        });
        const daysWorked = seenDates.size;
        return {
            daysWorked,
            elapsedDays,
            absences: Math.max(0, elapsedDays - daysWorked),
            minutesLate: Math.round(minutesLate),
            utHours: Math.round(utHours * 100) / 100
        };
    }

    window.MargaPayrollCutoff = {
        parsePayrollDate,
        formatDateInputValue,
        todayDateKey,
        firstPayrollPeriod,
        secondPayrollPeriod,
        recommendedPayrollPeriod,
        timeRecordsPayrollPeriod,
        listPayrollPeriodOptions,
        lastCompletePayrollPeriod,
        isPayrollPeriodComplete,
        formatPayrollPeriodOptionLabel,
        getPayrollPayDate,
        getTimeRecordsDisplayWindow,
        getPayrollCutoffProfile,
        formatPayrollPeriodDate,
        formatCutoffHeading,
        countPayrollWorkdays,
        normalizeDateTime,
        minutesAfterEight,
        getLivePayrollWindow,
        computePayrollAttendanceSummary,
        employeeKeys,
        rowMatchesEmployee
    };
})();
