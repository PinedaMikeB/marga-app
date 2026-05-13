/**
 * Shared schedule consolidation guard.
 * Keeps Billing, Collections, Service, and Master Schedule using one dispatch rule.
 */
(function () {
    const ZERO_DATETIME = '0000-00-00 00:00:00';
    const SERVICE_PURPOSE_IDS = new Set([5]);
    const MESSENGER_PURPOSE_IDS = new Set([1, 2, 3, 4, 8]);

    function clean(value) {
        return String(value ?? '').trim();
    }

    function numeric(value) {
        const parsed = Number(value || 0);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function dateOnly(value) {
        return clean(value).slice(0, 10);
    }

    function firestoreValue(value) {
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
        return { stringValue: String(value ?? '') };
    }

    function parseFirestoreValue(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.integerValue !== undefined) return Number(value.integerValue);
        if (value.doubleValue !== undefined) return Number(value.doubleValue);
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.timestampValue !== undefined) return value.timestampValue;
        return null;
    }

    function parseFirestoreDoc(doc) {
        if (!doc?.fields) return null;
        const parsed = {};
        Object.entries(doc.fields).forEach(([key, raw]) => {
            parsed[key] = parseFirestoreValue(raw);
        });
        if (doc.name) parsed._docId = doc.name.split('/').pop();
        return parsed;
    }

    function apiBase() {
        return window.FIREBASE_CONFIG?.baseUrl || '';
    }

    function apiKey() {
        return window.FIREBASE_CONFIG?.apiKey || '';
    }

    async function runQuery(structuredQuery) {
        const response = await fetch(`${apiBase()}:runQuery?key=${apiKey()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        });
        const payload = await response.json();
        if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
            throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Schedule consolidation query failed.');
        }
        return Array.isArray(payload) ? payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean) : [];
    }

    async function fetchDoc(collection, docId) {
        if (!docId && docId !== 0) return null;
        const response = await fetch(`${apiBase()}/${collection}/${encodeURIComponent(String(docId))}?key=${apiKey()}`);
        if (response.status === 404) return null;
        const payload = await response.json();
        if (!response.ok || payload?.error) return null;
        return parseFirestoreDoc(payload);
    }

    async function patchDoc(collection, docId, fields) {
        const params = new URLSearchParams({ key: apiKey() });
        Object.keys(fields).forEach((fieldPath) => params.append('updateMask.fieldPaths', fieldPath));
        const body = { fields: {} };
        Object.entries(fields).forEach(([key, value]) => {
            body.fields[key] = firestoreValue(value);
        });
        const response = await fetch(`${apiBase()}/${collection}/${encodeURIComponent(String(docId))}?${params.toString()}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`Unable to update ${collection}/${docId}.`);
    }

    async function querySchedulesForDate(date) {
        if (!date) return [];
        return runQuery({
            from: [{ collectionId: 'tbl_schedule' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        {
                            fieldFilter: {
                                field: { fieldPath: 'task_datetime' },
                                op: 'GREATER_THAN_OR_EQUAL',
                                value: { stringValue: `${date} 00:00:00` }
                            }
                        },
                        {
                            fieldFilter: {
                                field: { fieldPath: 'task_datetime' },
                                op: 'LESS_THAN_OR_EQUAL',
                                value: { stringValue: `${date} 23:59:59` }
                            }
                        }
                    ]
                }
            },
            limit: 1000
        });
    }

    function normalizeAddress(value) {
        return clean(value)
            .toLowerCase()
            .replace(/\b(unit|room|rm|floor|flr|fl|dept|department|office|suite)\b\.?/g, ' ')
            .replace(/\b\d+(st|nd|rd|th)?\s*(floor|flr|fl|room|rm)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function branchLocationKey(branch) {
        if (!branch) return '';
        return normalizeAddress([
            branch.branch_address,
            branch.bldg,
            branch.street,
            branch.brgy,
            branch.city
        ].filter(Boolean).join(' '));
    }

    async function loadBranchMap(branchIds) {
        const map = new Map();
        const unique = Array.from(new Set(branchIds.map((id) => String(id || '').trim()).filter(Boolean)));
        await Promise.all(unique.map(async (id) => {
            const row = await fetchDoc('tbl_branchinfo', id);
            if (row) map.set(id, row);
        }));
        return map;
    }

    function isCancelled(row) {
        const statusText = clean(row.status || row.master_schedule_status || row.collection_schedule_status).toLowerCase();
        return numeric(row.iscancel || row.iscancelled) === 1
            || Boolean(row.cancelled_at)
            || statusText === 'cancelled'
            || dateOnly(row.date_finished) && clean(row.date_finished) !== ZERO_DATETIME;
    }

    function isServiceTask(row) {
        return SERVICE_PURPOSE_IDS.has(numeric(row.purpose_id))
            || /service/i.test(clean(row.request_origin || row.source_module || row.purpose || row.schedule_purpose));
    }

    function sameVisitLocation(left, right, branchMap) {
        const leftBranchId = clean(left.branch_id);
        const rightBranchId = clean(right.branch_id);
        const leftBranch = branchMap.get(leftBranchId) || null;
        const rightBranch = branchMap.get(rightBranchId) || null;
        const leftCompany = clean(left.company_id || leftBranch?.company_id);
        const rightCompany = clean(right.company_id || rightBranch?.company_id);
        if (!leftCompany || !rightCompany || leftCompany !== rightCompany) return false;

        if (leftBranchId && rightBranchId && leftBranchId === rightBranchId) return true;

        const leftKey = branchLocationKey(leftBranch);
        const rightKey = branchLocationKey(rightBranch);
        return Boolean(leftKey && rightKey && leftKey === rightKey);
    }

    function assignedName(row, getStaffName) {
        const staffId = numeric(row.tech_id);
        return getStaffName?.(staffId) || clean(row.assigned_to || row.assigned_staff_name || row.field_billing_assigned_staff_name) || (staffId ? `Staff #${staffId}` : 'Unassigned');
    }

    function normalizeStaffName(value) {
        return clean(value).toLowerCase();
    }

    function invalidStaffName(value) {
        const normalized = normalizeStaffName(value);
        return !normalized
            || normalized === 'unassigned'
            || normalized === 'suggested / unassigned'
            || normalized === 'others'
            || normalized === 'other'
            || normalized.startsWith('id 0')
            || normalized.startsWith('staff #0');
    }

    function validateRequiredAssignment(context = {}) {
        const staffId = numeric(context.staffId || context.techId || context.assignedStaffId);
        const staffName = clean(context.staffName || context.assignedTo || context.assignedStaffName);
        const activeStaffIds = Array.isArray(context.activeStaffIds)
            ? new Set(context.activeStaffIds.map((id) => String(id || '').trim()).filter(Boolean))
            : null;

        if (!staffId) {
            return { ok: false, reason: 'Choose an active assigned staff member before saving this schedule.' };
        }
        if (invalidStaffName(staffName)) {
            return { ok: false, reason: 'Assigned staff must have a real active name, not Unassigned or Others.' };
        }
        if (activeStaffIds && activeStaffIds.size && !activeStaffIds.has(String(staffId))) {
            return { ok: false, reason: `${staffName || `Staff #${staffId}`} is not in the active scheduling roster.` };
        }
        return { ok: true, staffId, staffName };
    }

    function taskLabel(row) {
        const purposeId = numeric(row.purpose_id);
        if (purposeId === 1) return 'Billing';
        if (purposeId === 2) return 'Collection';
        if (purposeId === 3) return 'Deliver Ink / Toner';
        if (purposeId === 4) return 'Deliver Cartridge';
        if (purposeId === 5) return 'Service';
        if (purposeId === 8) return 'Reading';
        return clean(row.purpose || row.schedule_purpose || row.trouble || 'Schedule');
    }

    function customerLabel(context, conflicts) {
        return clean(context.customerName || context.companyName)
            || clean(conflicts[0]?.company_name || conflicts[0]?.caller)
            || 'This customer';
    }

    function chooseOwner(conflicts, context, getStaffName) {
        const serviceOwner = conflicts.find((row) => isServiceTask(row) && numeric(row.tech_id) > 0);
        if (serviceOwner) return serviceOwner;
        return conflicts.find((row) => numeric(row.tech_id) > 0 && numeric(row.tech_id) !== numeric(context.staffId)) || null;
    }

    async function resolveAssignment(context = {}) {
        const date = context.date || dateOnly(context.taskDatetime);
        const staffId = numeric(context.staffId);
        const companyId = numeric(context.companyId);
        const branchId = numeric(context.branchId);
        if (!date || !staffId || !companyId || !branchId || !apiBase() || !apiKey()) return { ok: true, staffId };

        const currentScheduleId = clean(context.scheduleId || context.currentScheduleId);
        const currentDocId = clean(context.currentDocId || context.docId);
        const schedules = await querySchedulesForDate(date).catch((error) => {
            console.warn('Schedule consolidation check failed:', error);
            return [];
        });
        if (!schedules.length) return { ok: true, staffId };

        const candidate = {
            company_id: companyId,
            branch_id: branchId,
            purpose_id: numeric(context.purposeId),
            request_origin: context.moduleName || '',
            tech_id: staffId
        };
        const branchMap = await loadBranchMap([branchId, ...schedules.map((row) => row.branch_id)]);
        const conflicts = schedules
            .filter((row) => !isCancelled(row))
            .filter((row) => {
                const rowId = clean(row.id || row.schedule_id);
                const docId = clean(row._docId);
                if (currentScheduleId && rowId === currentScheduleId) return false;
                if (currentDocId && docId === currentDocId) return false;
                if (!numeric(row.tech_id)) return false;
                return sameVisitLocation(candidate, row, branchMap);
            });

        if (!conflicts.length) return { ok: true, staffId };

        const getStaffName = context.getStaffName || null;
        const newIsService = isServiceTask(candidate);
        const owner = chooseOwner(conflicts, context, getStaffName);
        if (!owner) return { ok: true, staffId };

        const ownerId = numeric(owner.tech_id);
        if (!ownerId || ownerId === staffId) return { ok: true, staffId };

        const customer = customerLabel(context, conflicts);
        const ownerName = assignedName(owner, getStaffName);
        const newStaffName = context.staffName || getStaffName?.(staffId) || `Staff #${staffId}`;
        const details = conflicts
            .slice(0, 5)
            .map((row) => `#${row.id || row._docId || '-'} ${taskLabel(row)} assigned to ${assignedName(row, getStaffName)}`)
            .join('\n');

        if (newIsService) {
            const ok = window.confirm(
                `${customer} already has schedule(s) on ${date} for the same location:\n\n${details}\n\nService should carry billing, collection, and delivery tasks when a technician is already going there.\n\nTransfer these same-location schedule(s) to ${newStaffName}?`
            );
            if (!ok) return { ok: false, staffId };

            await Promise.all(conflicts
                .filter((row) => numeric(row.tech_id) !== staffId)
                .map((row) => patchDoc('tbl_schedule', row._docId || row.id, {
                    tech_id: staffId,
                    dispatch_consolidated_at: new Date().toISOString(),
                    dispatch_consolidated_by_module: clean(context.moduleName || 'schedule'),
                    dispatch_consolidated_reason: 'same_customer_location_service_wins'
                })));
            return { ok: true, staffId, transferredIds: conflicts.map((row) => row.id || row._docId).filter(Boolean) };
        }

        if (context.allowReassignmentOverride) {
            const ok = window.confirm(
                `${customer} already has a same-location schedule on ${date} assigned to ${ownerName}.\n\n${details}\n\nYou are changing the field owner to ${newStaffName}. Continue this reassignment?`
            );
            if (!ok) return { ok: false, staffId };
            return { ok: true, staffId, reassignmentOverride: true };
        }

        const ok = window.confirm(
            `${customer} already has a same-location schedule on ${date} assigned to ${ownerName}.\n\n${details}\n\nTo avoid another trip, assign this task to ${ownerName} too?`
        );
        if (!ok) return { ok: false, staffId };
        return { ok: true, staffId: ownerId, consolidatedToId: ownerId };
    }

    window.MargaScheduleConsolidation = {
        resolveAssignment,
        validateRequiredAssignment,
        constants: {
            servicePurposeIds: SERVICE_PURPOSE_IDS,
            messengerPurposeIds: MESSENGER_PURPOSE_IDS
        }
    };
}());
