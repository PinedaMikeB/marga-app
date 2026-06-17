#!/usr/bin/env node

const BASE_URL = 'https://app.marga.biz/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const API_KEY = 'margabase-local';

const args = process.argv.slice(2);
const reportDate = args.find((arg) => arg.startsWith('--date='))?.slice('--date='.length) || '';
const apply = args.includes('--apply');

if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    console.error('Usage: node scripts/repair-pettycash-field-rollbacks.mjs --date=YYYY-MM-DD [--apply]');
    process.exit(1);
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (value && typeof value === 'object') {
        const fields = {};
        Object.entries(value).forEach(([key, child]) => {
            if (child === undefined || typeof child === 'function') return;
            fields[key] = toFirestoreFieldValue(child);
        });
        return { mapValue: { fields } };
    }
    return { stringValue: String(value ?? '') };
}

function parseFieldValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.nullValue !== undefined) return null;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map((entry) => parseFieldValue(entry));
    if (value.mapValue !== undefined) {
        const out = {};
        Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
            out[key] = parseFieldValue(child);
        });
        return out;
    }
    return null;
}

function parseDoc(document) {
    const parsed = {
        _docId: String(document?.name || '').split('/').pop() || ''
    };
    Object.entries(document?.fields || {}).forEach(([key, value]) => {
        parsed[key] = parseFieldValue(value);
    });
    return parsed;
}

async function getDoc(collection, docId) {
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}`);
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Unable to load ${collection}/${docId}`);
    }
    return parseDoc(payload);
}

async function runQuery(body) {
    const response = await fetch(`${BASE_URL}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || 'Unable to run query');
    }
    return (Array.isArray(payload) ? payload : [])
        .map((row) => row.document)
        .filter(Boolean)
        .map(parseDoc);
}

async function patchDoc(collection, docId, fields) {
    const updateMask = Object.keys(fields)
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}&${updateMask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Unable to patch ${collection}/${docId}`);
    }
    return parseDoc(payload);
}

async function setDoc(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Unable to set ${collection}/${docId}`);
    }
    return parseDoc(payload);
}

async function deleteDoc(collection, docId) {
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || `Unable to delete ${collection}/${docId}`);
    }
}

function sumAmounts(values) {
    return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

function inferExpenseGroup(item = {}, request = {}) {
    const direct = String(item.groupId || item.expenseGroup || '').trim();
    if (direct) return direct;
    const category = String(item.expenseCategory || request.expenseCategory || '').trim().toLowerCase();
    const groupMap = {
        'gasoline / fuel': 'gasoline',
        'meal allowance': 'meal_allowance',
        'toll': 'commute_fare',
        'parking': 'parking',
        'transportation / fare': 'commute_fare',
        'parts / supplies': 'field_parts',
        'delivery / courier': 'commute_fare',
        'emergency purchase': 'other_materials',
        'other': 'other'
    };
    return groupMap[category] || 'other';
}

function getSourceItems(request = {}) {
    const rows = Array.isArray(request.lineItems) && request.lineItems.length
        ? request.lineItems
        : [{
            accountId: request.accountId || '',
            itemNote: request.description || '',
            supplierStoreName: request.supplierStoreName || request.supplier || '',
            amount: Number(request.receiptAmount || request.amount || 0),
            receiptNumber: request.receiptNumber || '',
            expenseCategory: request.expenseCategory || ''
        }];
    return rows.map((item) => ({
        accountId: String(item.accountId || '').trim(),
        itemNote: String(item.itemNote || item.description || '').trim(),
        supplierStoreName: String(item.supplierStoreName || item.supplier || '').trim(),
        amount: Number(item.amount || 0),
        receiptNumber: String(item.receiptNumber || '').trim(),
        expenseCategory: String(item.expenseCategory || request.expenseCategory || '').trim(),
        groupId: String(item.groupId || item.expenseGroup || '').trim()
    }));
}

function distributeAmounts(items, approvedTotal) {
    if (items.length === 1) return [Number(Number(approvedTotal).toFixed(2))];
    const baseAmounts = items.map((item) => Math.max(Number(item.amount || 0), 0));
    const baseTotal = sumAmounts(baseAmounts);
    const targetTotal = Number(approvedTotal || 0) > 0 ? Number(approvedTotal || 0) : baseTotal;
    if (baseTotal <= 0) {
        const even = Number((targetTotal / items.length).toFixed(2));
        return items.map((_, index) => index === items.length - 1 ? Number((targetTotal - even * (items.length - 1)).toFixed(2)) : even);
    }
    let assigned = 0;
    return items.map((item, index) => {
        if (index === items.length - 1) {
            return Number((targetTotal - assigned).toFixed(2));
        }
        const value = Number(((Number(item.amount || 0) / baseTotal) * targetTotal).toFixed(2));
        assigned += value;
        return value;
    });
}

function buildEntriesFromRequest(request) {
    const requestId = String(request.id || '').trim();
    const sourceItems = getSourceItems(request);
    const approvedTotal = Number(request.approvedAmount || request.amount || 0);
    const postingDate = String(request.pettyCashPostedDate || request.reportDate || request.dateOfExpense || request.requestDate || '').trim();
    const amounts = distributeAmounts(sourceItems, approvedTotal);
    return sourceItems.map((item, index) => ({
        id: `${requestId}-L${index + 1}`,
        bundleId: requestId,
        voucherNumber: requestId,
        date: postingDate,
        payee: String(request.staffName || request.requestedBy || '').trim(),
        supplier: String(item.supplierStoreName || request.supplierStoreName || '').trim(),
        requestedBy: String(request.staffName || request.requestedBy || '').trim(),
        expenseGroup: inferExpenseGroup(item, request),
        accountId: String(item.accountId || '').trim(),
        itemNote: String(item.itemNote || request.description || '').trim(),
        amount: amounts[index],
        receiptNumber: String(item.receiptNumber || request.receiptNumber || request.orSiNumber || '').trim(),
        description: String(request.description || request.notes || '').trim(),
        status: 'Liquidated',
        replenishmentId: '',
        createdAt: String(request.approvedAt || request.createdAt || new Date().toISOString()).trim(),
        sourceModule: 'field_app',
        sourceRequestId: requestId,
        sourceRequestType: String(request.requestType || '').trim(),
        sourceRequestStatus: 'Approved',
        sourceExpenseDate: String(request.reportDate || request.dateOfExpense || request.requestDate || '').trim(),
        staffId: Number(request.staffId || 0),
        updatedAt: new Date().toISOString()
    }));
}

async function main() {
    const requests = (await runQuery({
        structuredQuery: {
            from: [{ collectionId: 'tbl_pettycash_requests' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'reportDate' },
                    op: 'EQUAL',
                    value: { stringValue: reportDate }
                }
            },
            limit: 500
        }
    })).filter((request) => String(request.sourceModule || '').trim() === 'field_app');

    const repairs = [];
    for (const request of requests) {
        const audits = await runQuery({
            structuredQuery: {
                from: [{ collectionId: 'tbl_pettycash_audit_logs' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'requestId' },
                        op: 'EQUAL',
                        value: { stringValue: String(request.id || '').trim() }
                    }
                },
                limit: 100
            }
        });
        const approvedAudits = audits
            .filter((audit) => String(audit.action || '').trim() === 'Approved')
            .sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
        const latestApprovedAudit = approvedAudits[approvedAudits.length - 1] || null;
        let approvedPayload = null;
        if (latestApprovedAudit?.newValue) {
            try {
                approvedPayload = JSON.parse(latestApprovedAudit.newValue);
            } catch (error) {
                approvedPayload = null;
            }
        }
        const shouldRepairStatus = String(request.status || '').trim() === 'Submitted' && latestApprovedAudit;
        const effectiveRequest = {
            ...request,
            ...(approvedPayload && typeof approvedPayload === 'object' ? approvedPayload : {}),
            status: latestApprovedAudit ? 'Approved' : String(request.status || '').trim(),
            approvedAmount: Number(
                approvedPayload?.approvedAmount
                || request.approvedAmount
                || request.amount
                || 0
            ),
            approvedAt: String(approvedPayload?.approvedAt || request.approvedAt || latestApprovedAudit?.timestamp || '').trim(),
            approvedBy: String(approvedPayload?.approvedBy || request.approvedBy || latestApprovedAudit?.userName || '').trim(),
            paymentStatus: String(approvedPayload?.paymentStatus || request.paymentStatus || 'Approved').trim(),
            pettyCashPostedDate: String(request.pettyCashPostedDate || request.reportDate || '').trim(),
            updatedAt: new Date().toISOString()
        };
        const entries = await runQuery({
            structuredQuery: {
                from: [{ collectionId: 'tbl_pettycash_entries' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'sourceRequestId' },
                        op: 'EQUAL',
                        value: { stringValue: String(request.id || '').trim() }
                    }
                },
                limit: 50
            }
        });
        const nextEntries = latestApprovedAudit ? buildEntriesFromRequest(effectiveRequest) : [];
        repairs.push({
            id: request.id,
            staffName: request.staffName,
            currentStatus: request.status,
            latestApprovedAt: latestApprovedAudit?.timestamp || '',
            willRepairStatus: Boolean(shouldRepairStatus),
            currentEntryCount: entries.length,
            nextEntryCount: nextEntries.length,
            effectiveRequest,
            existingEntries: entries,
            nextEntries
        });
    }

    const needingRepair = repairs.filter((item) => (
        item.willRepairStatus
        || (item.latestApprovedAt && item.currentStatus === 'Approved' && item.currentEntryCount === 0 && item.nextEntryCount > 0)
    ));
    console.log(JSON.stringify({
        reportDate,
        apply,
        totalFieldRequests: requests.length,
        repairsNeeded: needingRepair.map((item) => ({
            id: item.id,
            staffName: item.staffName,
            currentStatus: item.currentStatus,
            latestApprovedAt: item.latestApprovedAt,
            willRepairStatus: item.willRepairStatus,
            currentEntryCount: item.currentEntryCount,
            nextEntryCount: item.nextEntryCount
        }))
    }, null, 2));

    if (!apply || !needingRepair.length) return;

    for (const repair of needingRepair) {
        if (repair.latestApprovedAt) {
            await patchDoc('tbl_pettycash_requests', repair.id, {
                status: 'Approved',
                approvedAmount: Number(repair.effectiveRequest.approvedAmount || repair.effectiveRequest.amount || 0),
                approvalRemarks: String(repair.effectiveRequest.approvalRemarks || '').trim(),
                approvedBy: String(repair.effectiveRequest.approvedBy || '').trim(),
                approvedAt: String(repair.effectiveRequest.approvedAt || '').trim(),
                paymentStatus: String(repair.effectiveRequest.paymentStatus || 'Approved').trim(),
                pettyCashPostedDate: String(repair.effectiveRequest.pettyCashPostedDate || repair.effectiveRequest.reportDate || '').trim(),
                updatedAt: String(repair.effectiveRequest.updatedAt || new Date().toISOString()).trim()
            });
            const nextIds = new Set(repair.nextEntries.map((entry) => String(entry.id || '').trim()).filter(Boolean));
            for (const existingEntry of repair.existingEntries) {
                const existingId = String(existingEntry.id || '').trim();
                if (existingId && !nextIds.has(existingId)) {
                    await deleteDoc('tbl_pettycash_entries', existingId);
                }
            }
            for (const nextEntry of repair.nextEntries) {
                await setDoc('tbl_pettycash_entries', nextEntry.id, nextEntry);
            }
        }
    }

    console.log(`Applied ${needingRepair.length} repair(s) for ${reportDate}.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
