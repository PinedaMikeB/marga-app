const crypto = require('crypto');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCgPJs1Neq2bRMAOvREBeV-f2i_3h1Qx3M';
const BASE_URL = process.env.FIRESTORE_BASE_URL || 'https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const PASSWORD_SEED = process.env.MARGA_CARE_PASSWORD_SEED || process.env.OPENCLAW_API_KEY || FIREBASE_API_KEY || 'marga-care-onboarding';
const DEFAULT_PAGE_SIZE = Number(process.env.MARGA_CARE_PAGE_SIZE || 300);

function toJson(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, max-age=0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key'
        },
        body: JSON.stringify(body)
    };
}

function getValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.stringValue !== undefined) return field.stringValue;
    return null;
}

function getField(fields, keys) {
    for (const key of keys) {
        const value = getValue(fields[key]);
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
}

function clean(value) {
    return String(value || '').trim();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value).toLowerCase());
}

function pickEmail(...values) {
    return values.map((value) => clean(value).toLowerCase()).find(isValidEmail) || '';
}

function pickText(...values) {
    return values.map(clean).find(Boolean) || '';
}

function passwordFor(scope, id) {
    const digest = crypto.createHmac('sha256', PASSWORD_SEED).update(`marga-care:${scope}:${id}`).digest();
    const numeric = digest.readUInt32BE(0) % 900000;
    return String(100000 + numeric);
}

async function firestoreGet(collection, options = {}) {
    const params = new URLSearchParams();
    params.set('pageSize', String(options.pageSize || DEFAULT_PAGE_SIZE));
    params.set('key', FIREBASE_API_KEY);
    if (options.pageToken) params.set('pageToken', options.pageToken);
    (options.fieldMask || []).forEach((field) => params.append('mask.fieldPaths', field));
    const response = await fetch(`${BASE_URL}/${collection}?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}: ${response.status}`);
    return response.json();
}

async function firestoreGetAll(collection, options = {}) {
    const docs = [];
    let pageToken = null;
    let page = 0;
    const maxPages = Number(options.maxPages || 80);
    while (page < maxPages) {
        page += 1;
        const data = await firestoreGet(collection, { ...options, pageToken });
        if (Array.isArray(data.documents)) docs.push(...data.documents);
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }
    return docs;
}

function buildMap(docs, idKeys = ['id']) {
    const map = new Map();
    docs.forEach((doc) => {
        const f = doc.fields || {};
        const id = clean(getField(f, idKeys) || doc.name?.split('/').pop());
        if (id) map.set(id, { id, fields: f });
    });
    return map;
}

function billingType({ hasActiveGroup, activeBranchCount, departmentName }) {
    if (departmentName) {
        return {
            type: 'Individual Machine',
            typeCode: 'individual',
            reason: 'Department-level contract / individually billed account'
        };
    }
    if (hasActiveGroup && activeBranchCount > 1) {
        return {
            type: 'Group Machine',
            typeCode: 'group',
            reason: 'One invoice covering multiple branches / machines'
        };
    }
    return {
        type: 'Individual Machine',
        typeCode: 'individual',
        reason: 'Single company or branch account billed separately'
    };
}

function archivedBranchName(name) {
    const value = clean(name).toLowerCase();
    return value.startsWith('~xx') || value.startsWith('xx ') || value.includes('pull-out');
}

async function buildCareRows() {
    const [companyDocs, branchDocs, billInfoDocs, contractDocs, contractDepDocs, groupDocs, machineDocs] = await Promise.all([
        firestoreGetAll('tbl_companylist', { fieldMask: ['id', 'companyname'], maxPages: 30 }),
        firestoreGetAll('tbl_branchinfo', {
            fieldMask: ['id', 'company_id', 'branchname', 'email', 'signatory', 'delivery_contact', 'service_contact', 'inactive'],
            maxPages: 60
        }),
        firestoreGetAll('tbl_billinfo', {
            fieldMask: [
                'id', 'branch_id', 'acct_email', 'acct_contact', 'endusername',
                'cashier_contact', 'treasury_contact', 'releasing_contact',
                'endusercontactnum', 'acct_num', 'cashier_num', 'treasury_num', 'releasing_num'
            ],
            maxPages: 100
        }),
        firestoreGetAll('tbl_contractmain', {
            fieldMask: ['id', 'contract_id', 'mach_id', 'status', 'xserial', 'category_id'],
            maxPages: 100
        }),
        firestoreGetAll('tbl_contractdep', { fieldMask: ['id', 'branch_id', 'departmentname'], maxPages: 80 }),
        firestoreGetAll('tbl_groupings', { fieldMask: ['id', 'company_id', 'groupname', 'isinactive', 'category_id'], maxPages: 30 }),
        firestoreGetAll('tbl_machine', { fieldMask: ['id', 'serial', 'description', 'model_id', 'status_id'], maxPages: 100 })
    ]);

    const companyMap = buildMap(companyDocs);
    const branchMap = buildMap(branchDocs);
    const depMap = buildMap(contractDepDocs);
    const machineMap = buildMap(machineDocs);
    const billInfoByBranch = new Map();
    const activeGroupsByCompany = new Map();
    const activeBranchIdsByCompany = new Map();

    billInfoDocs.forEach((doc) => {
        const f = doc.fields || {};
        const branchId = clean(getField(f, ['branch_id']));
        if (!branchId) return;
        if (!billInfoByBranch.has(branchId)) billInfoByBranch.set(branchId, []);
        billInfoByBranch.get(branchId).push(f);
    });

    groupDocs.forEach((doc) => {
        const f = doc.fields || {};
        if (Number(getField(f, ['isinactive']) || 0) === 1) return;
        const companyId = clean(getField(f, ['company_id']));
        if (!companyId) return;
        if (!activeGroupsByCompany.has(companyId)) activeGroupsByCompany.set(companyId, []);
        activeGroupsByCompany.get(companyId).push({
            id: clean(getField(f, ['id']) || doc.name?.split('/').pop()),
            name: pickText(getField(f, ['groupname']), 'Group Account')
        });
    });

    const activeContracts = [];
    contractDocs.forEach((doc) => {
        const f = doc.fields || {};
        const status = Number(getField(f, ['status']) || 0);
        if (status !== 1) return;
        const contractId = clean(getField(f, ['id']) || doc.name?.split('/').pop());
        const contractBranchOrDepId = clean(getField(f, ['contract_id']));
        const department = depMap.get(contractBranchOrDepId);
        const branchId = department ? clean(getField(department.fields, ['branch_id'])) : contractBranchOrDepId;
        const branch = branchMap.get(branchId);
        if (!contractId || !branch) return;
        const branchFields = branch.fields || {};
        const branchName = clean(getField(branchFields, ['branchname']));
        if (Number(getField(branchFields, ['inactive']) || 0) === 1 || archivedBranchName(branchName)) return;
        const companyId = clean(getField(branchFields, ['company_id']));
        if (!companyId) return;
        if (!activeBranchIdsByCompany.has(companyId)) activeBranchIdsByCompany.set(companyId, new Set());
        activeBranchIdsByCompany.get(companyId).add(branchId);
        activeContracts.push({
            contractId,
            branchId,
            companyId,
            departmentName: department ? clean(getField(department.fields, ['departmentname'])) : '',
            machId: clean(getField(f, ['mach_id'])),
            xserial: clean(getField(f, ['xserial'])),
            categoryId: Number(getField(f, ['category_id']) || 0)
        });
    });

    const rows = activeContracts.map((contract) => {
        const company = companyMap.get(contract.companyId);
        const branch = branchMap.get(contract.branchId);
        const machine = machineMap.get(contract.machId);
        const branchFields = branch?.fields || {};
        const companyName = pickText(getField(company?.fields || {}, ['companyname']), `Company ${contract.companyId}`);
        const branchName = pickText(getField(branchFields, ['branchname']), 'Main');
        const billInfos = billInfoByBranch.get(contract.branchId) || [];
        const billInfo = billInfos[0] || {};
        const adminEmail = pickEmail(
            getField(billInfo, ['acct_email']),
            getField(branchFields, ['email'])
        );
        const adminContact = pickText(
            getField(billInfo, ['acct_contact']),
            getField(billInfo, ['endusername']),
            getField(branchFields, ['signatory']),
            getField(branchFields, ['delivery_contact']),
            getField(branchFields, ['service_contact'])
        );
        const branchContact = pickText(
            getField(branchFields, ['service_contact']),
            getField(branchFields, ['delivery_contact']),
            getField(billInfo, ['endusername']),
            getField(billInfo, ['cashier_contact']),
            adminContact
        );
        const branchPhone = pickText(
            getField(billInfo, ['endusercontactnum']),
            getField(billInfo, ['acct_num']),
            getField(billInfo, ['cashier_num']),
            getField(billInfo, ['treasury_num']),
            getField(billInfo, ['releasing_num'])
        );
        const activeBranchCount = activeBranchIdsByCompany.get(contract.companyId)?.size || 0;
        const groups = activeGroupsByCompany.get(contract.companyId) || [];
        const type = billingType({
            hasActiveGroup: groups.length > 0,
            activeBranchCount,
            departmentName: contract.departmentName
        });
        const serial = pickText(contract.xserial, getField(machine?.fields || {}, ['serial']), contract.machId);
        return {
            row_id: `${contract.companyId}:${contract.branchId}:${contract.contractId}`,
            company_id: contract.companyId,
            company_name: companyName,
            branch_id: contract.branchId,
            branch_department: contract.departmentName ? `${branchName} - ${contract.departmentName}` : branchName,
            branch_name: branchName,
            department_name: contract.departmentName,
            serial_number: serial,
            contractmain_id: contract.contractId,
            machine_id: contract.machId,
            type: type.type,
            type_code: type.typeCode,
            classification_reason: type.reason,
            billing_group: groups[0]?.name || '',
            main_contact: adminContact,
            email: adminEmail,
            admin_password: passwordFor('company-admin', contract.companyId),
            branch_contact: branchContact,
            branch_phone: branchPhone,
            branch_password: passwordFor('branch', `${contract.companyId}:${contract.branchId}:${contract.departmentName || 'main'}`),
            status: adminEmail ? 'Preparing' : 'Needs Email Confirmation',
            action: 'Confirm Email, Edit Contact, Send Tomorrow',
            category_id: contract.categoryId
        };
    }).sort((a, b) => (
        a.company_name.localeCompare(b.company_name)
        || a.branch_department.localeCompare(b.branch_department)
        || a.serial_number.localeCompare(b.serial_number)
    ));

    const companyIds = new Set(rows.map((row) => row.company_id));
    const reps = new Set(rows.filter((row) => row.email).map((row) => `${row.company_id}:${row.email}`));
    const groupRows = rows.filter((row) => row.type_code === 'group').length;
    const individualRows = rows.filter((row) => row.type_code === 'individual').length;

    return {
        generated_at: new Date().toISOString(),
        summary: {
            portal_companies: companyIds.size,
            representative_logins: reps.size,
            group_machines: groupRows,
            individual_machines: individualRows,
            active_rows: rows.length,
            missing_email: rows.filter((row) => !row.email).length
        },
        rows
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return toJson(200, { ok: true });
    if (event.httpMethod !== 'GET') return toJson(405, { ok: false, message: 'Method not allowed' });
    try {
        const result = await buildCareRows();
        const params = new URLSearchParams(event.queryStringParameters || {});
        const q = clean(params.get('q')).toLowerCase();
        const rows = q
            ? result.rows.filter((row) => [
                row.company_name,
                row.branch_department,
                row.serial_number,
                row.email,
                row.main_contact,
                row.branch_contact
            ].join(' ').toLowerCase().includes(q))
            : result.rows;
        return toJson(200, {
            ok: true,
            generated_at: result.generated_at,
            summary: {
                ...result.summary,
                returned_rows: rows.length
            },
            rows
        });
    } catch (error) {
        return toJson(500, {
            ok: false,
            message: error.message || 'Unable to build Marga Care onboarding list.'
        });
    }
};
