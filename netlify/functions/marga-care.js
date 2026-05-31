const crypto = require('crypto');

const MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
const BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL || process.env.MARGABASE_FIRESTORE_BASE_URL || 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const PASSWORD_SEED = process.env.MARGA_CARE_PASSWORD_SEED || process.env.OPENCLAW_API_KEY || MARGABASE_API_KEY || 'marga-care-onboarding';
const DEFAULT_PAGE_SIZE = Number(process.env.MARGA_CARE_PAGE_SIZE || 300);
const OVERRIDE_COLLECTION = 'marga_care_onboarding_overrides';
const PORTAL_ACCOUNTS_COLLECTION = 'marga_care_portal_accounts';
const PORTAL_ACCESS_COLLECTION = 'marga_care_portal_access';

function toJson(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, max-age=0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key'
        },
        body: JSON.stringify(body)
    };
}

function firestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    return { stringValue: String(value) };
}

function firestoreFields(object) {
    return Object.fromEntries(Object.entries(object || {}).map(([key, value]) => [key, firestoreValue(value)]));
}

function docIdForRow(rowId) {
    return crypto.createHash('sha1').update(String(rowId || '')).digest('hex');
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

function randomId(prefix, seed) {
    return `${prefix}_${crypto.createHash('sha1').update(String(seed || '')).digest('hex')}`;
}

function argon2idHash(password) {
    if (typeof crypto.argon2Sync !== 'function') {
        const error = new Error('Argon2id hashing is not available in this Node runtime. Use Node 25+ for Marga Care credential writes.');
        error.statusCode = 500;
        throw error;
    }
    const salt = crypto.randomBytes(16);
    const params = {
        memory: Number(process.env.MARGA_CARE_ARGON2_MEMORY || 65536),
        passes: Number(process.env.MARGA_CARE_ARGON2_PASSES || 3),
        parallelism: Number(process.env.MARGA_CARE_ARGON2_PARALLELISM || 1),
        tagLength: Number(process.env.MARGA_CARE_ARGON2_TAG_LENGTH || 32)
    };
    const hash = crypto.argon2Sync('argon2id', {
        message: String(password || ''),
        nonce: salt,
        ...params
    });
    return {
        password_hash: hash.toString('base64'),
        password_salt: salt.toString('base64'),
        password_algorithm: 'argon2id',
        password_memory: params.memory,
        password_passes: params.passes,
        password_parallelism: params.parallelism,
        password_tag_length: params.tagLength
    };
}

async function firestoreGet(collection, options = {}) {
    const params = new URLSearchParams();
    params.set('pageSize', String(options.pageSize || DEFAULT_PAGE_SIZE));
    params.set('key', MARGABASE_API_KEY);
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

async function firestorePatch(collection, docId, fields) {
    const params = new URLSearchParams();
    params.set('key', MARGABASE_API_KEY);
    Object.keys(fields || {}).forEach((field) => params.append('updateMask.fieldPaths', field));
    const response = await fetch(`${BASE_URL}/${collection}/${docId}?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields(fields) })
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `Failed to save ${collection}: ${response.status}`);
    }
    return response.json();
}

async function upsertPortalAccount(account) {
    const now = new Date().toISOString();
    const docId = clean(account.account_id);
    if (!docId) return null;
    await firestorePatch(PORTAL_ACCOUNTS_COLLECTION, docId, {
        account_id: docId,
        login: clean(account.login).toLowerCase(),
        display_name: clean(account.display_name),
        phone: clean(account.phone),
        role: clean(account.role),
        status: clean(account.status || 'Preparing'),
        company_id: clean(account.company_id),
        branch_id: clean(account.branch_id),
        customer_id: clean(account.customer_id),
        machine_id: clean(account.machine_id),
        serial_number: clean(account.serial_number),
        credential_delivery_email: clean(account.credential_delivery_email).toLowerCase(),
        password_hash: clean(account.password_hash),
        password_salt: clean(account.password_salt),
        password_algorithm: clean(account.password_algorithm),
        password_memory: Number(account.password_memory || 0),
        password_passes: Number(account.password_passes || 0),
        password_parallelism: Number(account.password_parallelism || 0),
        password_tag_length: Number(account.password_tag_length || 0),
        must_change_password: true,
        active: account.active !== false,
        updated_at: now,
        last_password_generated_at: now,
        last_plain_password_visible: false
    });
    return docId;
}

async function upsertPortalAccess(access) {
    const now = new Date().toISOString();
    const accountId = clean(access.account_id);
    if (!accountId) return null;
    const docId = randomId('access', [
        accountId,
        access.access_scope,
        access.company_id,
        access.branch_id,
        access.customer_id,
        access.machine_id,
        access.serial_number
    ].join(':'));
    await firestorePatch(PORTAL_ACCESS_COLLECTION, docId, {
        access_id: docId,
        account_id: accountId,
        access_scope: clean(access.access_scope),
        company_id: clean(access.company_id),
        branch_id: clean(access.branch_id),
        customer_id: clean(access.customer_id),
        machine_id: clean(access.machine_id),
        serial_number: clean(access.serial_number),
        can_view_billing: access.can_view_billing !== false,
        can_request_service: access.can_request_service !== false,
        can_request_toner: access.can_request_toner !== false,
        can_manage_branch_credentials: Boolean(access.can_manage_branch_credentials),
        active: access.active !== false,
        updated_at: now
    });
    return docId;
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

function typeLabel(typeCode) {
    return typeCode === 'group' ? 'Group Machine' : 'Individual Machine';
}

function typeReason(typeCode, fallback = '') {
    if (typeCode === 'group') return 'One invoice covering multiple branches / machines';
    if (typeCode === 'individual') return 'Single company, branch, or department account billed separately';
    return fallback || '';
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

async function loadOverrides() {
    const docs = await firestoreGetAll(OVERRIDE_COLLECTION, {
        fieldMask: [
            'row_id', 'status', 'type_code', 'main_contact', 'email', 'branch_contact',
            'admin_password', 'branch_password', 'updated_at', 'updated_by',
            'email_approved', 'email_sent_at'
        ],
        maxPages: 40
    }).catch(() => []);
    const map = new Map();
    docs.forEach((doc) => {
        const f = doc.fields || {};
        const rowId = clean(getField(f, ['row_id']));
        if (!rowId) return;
        map.set(rowId, {
            status: clean(getField(f, ['status'])),
            type_code: clean(getField(f, ['type_code'])),
            main_contact: clean(getField(f, ['main_contact'])),
            email: clean(getField(f, ['email'])),
            branch_contact: clean(getField(f, ['branch_contact'])),
            admin_password: clean(getField(f, ['admin_password'])),
            branch_password: clean(getField(f, ['branch_password'])),
            updated_at: clean(getField(f, ['updated_at'])),
            updated_by: clean(getField(f, ['updated_by'])),
            email_approved: Boolean(getField(f, ['email_approved']) || false),
            email_sent_at: clean(getField(f, ['email_sent_at']))
        });
    });
    return map;
}

function mergeOverride(row, override) {
    if (!override) return row;
    const merged = { ...row };
    ['status', 'main_contact', 'email', 'branch_contact', 'admin_password', 'branch_password', 'type_code', 'email_approved', 'email_sent_at'].forEach((key) => {
        if (override[key] !== undefined && override[key] !== null && override[key] !== '') merged[key] = override[key];
    });
    if (override.type_code) {
        merged.type = typeLabel(override.type_code);
        merged.classification_reason = typeReason(override.type_code, merged.classification_reason);
    }
    merged.updated_at = override.updated_at || row.updated_at || '';
    merged.updated_by = override.updated_by || row.updated_by || '';
    return merged;
}

async function rowAfterPatch(rowId, patch) {
    const result = await buildCareRows();
    const overrides = await loadOverrides();
    const baseRow = result.rows.find((row) => String(row.row_id) === String(rowId));
    if (!baseRow) return null;
    return mergeOverride(baseRow, {
        ...(overrides.get(rowId) || {}),
        ...(patch || {})
    });
}

async function syncPortalAccessForRow(row) {
    if (!row) return { accounts: [], access: [] };
    const status = clean(row.status || 'Preparing');
    const accounts = [];
    const access = [];
    const companyId = clean(row.company_id);
    const branchId = clean(row.branch_id);
    const customerId = clean(row.customer_id || row.company_id);
    const machineId = clean(row.machine_id);
    const serialNumber = clean(row.serial_number);

    if (isValidEmail(row.email) && clean(row.admin_password)) {
        const accountId = randomId('admin', companyId);
        const hash = argon2idHash(row.admin_password);
        accounts.push(await upsertPortalAccount({
            account_id: accountId,
            login: row.email,
            display_name: row.main_contact || row.company_name,
            phone: '',
            role: 'company_admin',
            status,
            company_id: companyId,
            branch_id: '',
            customer_id: customerId,
            machine_id: '',
            serial_number: '',
            credential_delivery_email: row.email,
            ...hash
        }));
        access.push(await upsertPortalAccess({
            account_id: accountId,
            access_scope: 'company',
            company_id: companyId,
            branch_id: '',
            customer_id: customerId,
            machine_id: '',
            serial_number: '',
            can_view_billing: true,
            can_request_service: true,
            can_request_toner: true,
            can_manage_branch_credentials: true
        }));
    }

    if (serialNumber && serialNumber.toLowerCase() !== 'n/a' && clean(row.branch_password)) {
        const accountId = randomId('branch', `${companyId}:${branchId}:${machineId}:${serialNumber}`);
        const hash = argon2idHash(row.branch_password);
        accounts.push(await upsertPortalAccount({
            account_id: accountId,
            login: serialNumber,
            display_name: row.branch_contact || row.branch_department || row.company_name,
            phone: row.branch_phone || '',
            role: 'branch_user',
            status,
            company_id: companyId,
            branch_id: branchId,
            customer_id: customerId,
            machine_id: machineId,
            serial_number: serialNumber,
            credential_delivery_email: row.email,
            ...hash
        }));
        access.push(await upsertPortalAccess({
            account_id: accountId,
            access_scope: 'machine',
            company_id: companyId,
            branch_id: branchId,
            customer_id: customerId,
            machine_id: machineId,
            serial_number: serialNumber,
            can_view_billing: false,
            can_request_service: true,
            can_request_toner: true,
            can_manage_branch_credentials: false
        }));
    }

    return {
        accounts: accounts.filter(Boolean),
        access: access.filter(Boolean)
    };
}

async function saveOverride(event) {
    const body = JSON.parse(event.body || '{}');
    const rowId = clean(body.row_id);
    if (!rowId) return toJson(400, { ok: false, message: 'row_id is required.' });
    const allowedStatuses = new Set(['Preparing', 'Onboarding', 'Connected', 'Needs Email Confirmation']);
    const patch = {
        row_id: rowId,
        updated_at: new Date().toISOString(),
        updated_by: clean(body.updated_by || body.user || 'Marga Staff')
    };
    ['main_contact', 'email', 'branch_contact', 'admin_password', 'branch_password', 'type_code'].forEach((key) => {
        if (body[key] !== undefined) patch[key] = clean(body[key]);
    });
    if (patch.type_code && !['group', 'individual'].includes(patch.type_code)) patch.type_code = 'individual';
    if (body.status !== undefined) {
        const status = clean(body.status);
        patch.status = allowedStatuses.has(status) ? status : 'Preparing';
    }
    if (body.email_approved !== undefined) patch.email_approved = Boolean(body.email_approved);
    if (body.email_sent_at !== undefined) patch.email_sent_at = clean(body.email_sent_at);
    await firestorePatch(OVERRIDE_COLLECTION, docIdForRow(rowId), patch);
    const synced = await syncPortalAccessForRow(await rowAfterPatch(rowId, patch));
    return toJson(200, { ok: true, override: patch, portal: synced });
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return toJson(200, { ok: true });
    if (event.httpMethod === 'POST') {
        try {
            return await saveOverride(event);
        } catch (error) {
            return toJson(500, { ok: false, message: error.message || 'Unable to save Marga Care row.' });
        }
    }
    if (event.httpMethod !== 'GET') return toJson(405, { ok: false, message: 'Method not allowed' });
    try {
        const result = await buildCareRows();
        const overrides = await loadOverrides();
        result.rows = result.rows.map((row) => mergeOverride(row, overrides.get(row.row_id)));
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
