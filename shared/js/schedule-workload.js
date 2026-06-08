/**
 * Shared schedule workload rules for Field App and Master Schedule.
 * Canonical open/past-pending logic follows Field App carryover behavior.
 */
(function () {
    const CARRYOVER_LOOKBACK_DAYS = 45;
    const ZERO_DATETIME = '0000-00-00 00:00:00';
    const LEGACY_EMPTY_DATETIME_VALUES = new Set([
        '',
        ZERO_DATETIME,
        'undefined',
        'undefined 00:00:00',
        'null',
        'null 00:00:00',
        'invalid date',
        'nan'
    ]);

    function clean(value) {
        return String(value ?? '').trim();
    }

    function dateOnly(value) {
        return clean(value).slice(0, 10);
    }

    function normalizeLegacyDateTime(value) {
        const text = clean(value);
        if (!text) return '';
        const compact = text.replace(/[T]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (LEGACY_EMPTY_DATETIME_VALUES.has(compact)) return '';
        if (compact.startsWith('undefined ')) return '';
        if (compact.startsWith('null ')) return '';
        return text;
    }

    function addDaysYmd(ymd, days) {
        const [y, m, d] = String(ymd || '').split('-').map((v) => Number(v));
        if (!y || !m || !d) return '';
        const date = new Date(Date.UTC(y, m - 1, d));
        date.setUTCDate(date.getUTCDate() + Number(days || 0));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }

    function originalScheduleDate(row) {
        return dateOnly(row?.original_sched)
            || dateOnly(row?.forwarded_from_date)
            || dateOnly(row?.route_forwarded_from_date)
            || dateOnly(row?.task_datetime);
    }

    function isPastPendingByOriginalDate(row, selectedDate) {
        const originalDate = originalScheduleDate(row);
        return Boolean(originalDate && selectedDate && originalDate < selectedDate);
    }

    function isScheduleFinished(row) {
        if (Number(row?.route_iscancelled || row?.iscancelled || row?.iscancel || 0) === 1) return true;
        if (normalizeLegacyDateTime(row?.route_date_finished || row?.date_finished)) return true;
        const routeStatus = row?.route_status === '' || row?.route_status === undefined || row?.route_status === null
            ? null
            : Number(row.route_status);
        return routeStatus === 0;
    }

    function isDispatchableScheduleRow(row) {
        return Number(row?.purpose_id || 0) !== 9;
    }

    function getAssignedStaffId(row) {
        return Number(row?.route_tech_id || row?.tech_id || 0) || 0;
    }

    function staffIdAllowed(row, staffIds) {
        if (!staffIds || !staffIds.size) return false;
        return staffIds.has(getAssignedStaffId(row)) || staffIds.has(Number(row?.tech_id || 0));
    }

    function asOlderCarryoverRow(row) {
        return {
            ...row,
            route_id: 0,
            route_doc_id: '',
            route_source: 'Older Pending',
            route_tech_id: Number(row.tech_id || 0) || 0,
            route_task_datetime: String(row.task_datetime || ''),
            route_status: '',
            route_iscancelled: Number(row.iscancel || row.iscancelled || 0) || 0,
            route_date_finished: String(row.date_finished || ''),
            route_remarks: String(row.remarks || row.caller || '').trim()
        };
    }

    function dedupeScheduleRows(rows) {
        const unique = new Map();
        rows.forEach((row) => {
            const scheduleId = Number(row.id || row._docId || 0);
            if (!scheduleId) return;
            if (!unique.has(scheduleId)) unique.set(scheduleId, row);
        });
        return Array.from(unique.values());
    }

    async function loadOlderCarryoverRows({
        date,
        excludedScheduleIds,
        staffIds,
        queryByDateRange,
        parseDoc
    }) {
        if (!date || !staffIds?.size || typeof queryByDateRange !== 'function') return [];

        const excluded = excludedScheduleIds instanceof Set ? excludedScheduleIds : new Set(excludedScheduleIds || []);
        const days = [];
        for (let index = 1; index <= CARRYOVER_LOOKBACK_DAYS; index += 1) {
            const day = addDaysYmd(date, -index);
            if (day) days.push(day);
        }

        const rows = [];
        const concurrency = 6;
        const parser = typeof parseDoc === 'function' ? parseDoc : (doc) => doc;

        for (let index = 0; index < days.length; index += concurrency) {
            const slice = days.slice(index, index + concurrency);
            const results = await Promise.all(slice.map((day) => (
                queryByDateRange('tbl_schedule', 'task_datetime', `${day} 00:00:00`, `${day} 23:59:59`).catch(() => [])
            )));
            results.flat().map(parser).filter(Boolean).forEach((row) => {
                const scheduleId = Number(row.id || row._docId || 0);
                if (!scheduleId || excluded.has(scheduleId)) return;
                if (!staffIdAllowed(row, staffIds)) return;
                if (isScheduleFinished(row)) return;
                rows.push(asOlderCarryoverRow(row));
            });
        }

        return rows;
    }

    async function loadCarryoverRows({
        date,
        printedRows = [],
        savedRows = [],
        todayScheduleIds,
        staffIds,
        buildRouteBoundRows,
        queryByDateRange,
        parseDoc
    }) {
        if (!date || !staffIds?.size) return [];

        const excluded = todayScheduleIds instanceof Set
            ? new Set(todayScheduleIds)
            : new Set((todayScheduleIds || []).map((id) => Number(id)).filter((id) => id > 0));

        const printedScheduleIds = new Set(
            printedRows.map((row) => Number(row.schedule_id || 0)).filter((id) => id > 0)
        );

        const savedCarryoverRoutes = savedRows
            .filter((row) => !printedScheduleIds.has(Number(row.schedule_id || 0)))
            .filter((row) => Number(row.iscancelled || row.iscancel || 0) !== 1);

        let savedCarryoverRows = [];
        if (typeof buildRouteBoundRows === 'function' && savedCarryoverRoutes.length) {
            savedCarryoverRows = (await buildRouteBoundRows(savedCarryoverRoutes, 'past pending'))
                .filter((row) => staffIdAllowed(row, staffIds))
                .filter(isDispatchableScheduleRow)
                .filter((row) => !excluded.has(Number(row.id || row._docId || 0)))
                .filter((row) => !isScheduleFinished(row));
            savedCarryoverRows.forEach((row) => {
                const scheduleId = Number(row.id || row._docId || 0);
                if (scheduleId > 0) excluded.add(scheduleId);
                row.route_source = 'Saved Past Pending';
            });
        }

        const olderRows = await loadOlderCarryoverRows({
            date,
            excludedScheduleIds: excluded,
            staffIds,
            queryByDateRange,
            parseDoc
        });

        return dedupeScheduleRows([
            ...savedCarryoverRows,
            ...olderRows.filter(isDispatchableScheduleRow)
        ]).sort((a, b) => {
            const left = dateOnly(a.task_datetime || a.route_task_datetime);
            const right = dateOnly(b.task_datetime || b.route_task_datetime);
            if (left !== right) return left.localeCompare(right);
            return Number(a.id || 0) - Number(b.id || 0);
        });
    }

    function classifyRowsNewTodayVsPastPending(rows, selectedDate) {
        const newToday = [];
        const pastPending = [];
        (rows || []).forEach((row) => {
            if (isScheduleFinished(row)) return;
            if (isPastPendingByOriginalDate(row, selectedDate)) pastPending.push(row);
            else newToday.push(row);
        });
        return { newToday, pastPending, totalOpen: newToday.length + pastPending.length };
    }

    window.MargaScheduleWorkload = {
        CARRYOVER_LOOKBACK_DAYS,
        originalScheduleDate,
        isPastPendingByOriginalDate,
        isScheduleFinished,
        isDispatchableScheduleRow,
        getAssignedStaffId,
        loadCarryoverRows,
        loadOlderCarryoverRows,
        classifyRowsNewTodayVsPastPending
    };
}());
