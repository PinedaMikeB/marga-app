if (!MargaAuth.requireAccess('settings')) {
    throw new Error('Unauthorized access to settings module.');
}

const SETTINGS_STATE = {
    users: [],
    usersFiltered: [],
    employees: [],
    employeesFiltered: [],
    positions: new Map(),
    userByStaffId: new Map(),
    editingDocId: null,
    editingEmployeeId: null
};

const MODULE_OPTIONS = [
    { id: 'customers', label: 'Customers Module' },
    { id: 'billing', label: 'Billing Module' },
    { id: 'collections', label: 'Collections Module' },
    { id: 'service', label: 'Customer Service Module' },
    { id: 'field', label: 'Service Field App (Tech/Messenger)' },
    { id: 'inventory', label: 'Inventory Module' },
    { id: 'hr', label: 'Human Resource Module' },
    { id: 'reports', label: 'Reports Module' },
    { id: 'settings', label: 'Settings Module' },
    { id: 'sync', label: 'Sync Updater Module' },
    { id: 'purchasing', label: 'Purchasing Module' },
    { id: 'pettycash', label: 'Petty Cash Module' },
    { id: 'sales', label: 'Sales Module' }
];

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    const isAdmin = MargaAuth.isAdmin();
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    }

    document.getElementById('tabEmployees').addEventListener('click', () => setActiveTab('employees'));
    document.getElementById('tabAccounts').addEventListener('click', () => setActiveTab('accounts'));

    document.getElementById('refreshUsersBtn').addEventListener('click', () => loadDirectory());
    document.getElementById('userSearch').addEventListener('input', () => applyUserFilter());
    document.getElementById('userStatusFilter').addEventListener('change', () => applyUserFilter());

    document.getElementById('refreshEmployeesBtn').addEventListener('click', () => loadDirectory());
    document.getElementById('employeeSearch').addEventListener('input', () => applyEmployeeFilter());
    document.getElementById('employeeStatusFilter').addEventListener('change', () => applyEmployeeFilter());

    const newUserBtn = document.getElementById('newUserBtn');
    newUserBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    newUserBtn.addEventListener('click', () => openUserModal(null));

    document.getElementById('userModalOverlay').addEventListener('click', closeUserModal);
    document.getElementById('userModalCloseBtn').addEventListener('click', closeUserModal);
    document.getElementById('userModalCancelBtn').addEventListener('click', closeUserModal);
    document.getElementById('userModalSaveBtn').addEventListener('click', () => saveUser());
    document.getElementById('userEmployeeLookup').addEventListener('change', () => applyUserEmployeeLookup());
    document.getElementById('userEmployeeLookup').addEventListener('input', () => applyUserEmployeeLookup());
    document.getElementById('applyRoleDefaultsBtn').addEventListener('click', () => {
        const role = document.getElementById('userRoleInput').value || 'viewer';
        renderUserModuleAccess(getRoleDefaultModules(role));
    });

    document.getElementById('employeeModalOverlay').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCloseBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCancelBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalSaveBtn').addEventListener('click', () => saveEmployee());

    // Ensure admin-only password fields are hidden for HR/non-admin.
    document.getElementById('userPasswordField').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('employeePasswordField').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('applyRoleDefaultsBtn').style.display = isAdmin ? 'inline-flex' : 'none';

    setActiveTab('employees');
    loadDirectory();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function sanitize(text) {
    return MargaUtils.escapeHtml(String(text ?? ''));
}

function setActiveTab(tab) {
    const next = tab === 'accounts' ? 'accounts' : 'employees';
    const tabEmployees = document.getElementById('tabEmployees');
    const tabAccounts = document.getElementById('tabAccounts');
    const employeesPane = document.getElementById('employeesPane');
    const accountsPane = document.getElementById('accountsPane');

    tabEmployees.classList.toggle('active', next === 'employees');
    tabAccounts.classList.toggle('active', next === 'accounts');
    tabEmployees.setAttribute('aria-selected', next === 'employees' ? 'true' : 'false');
    tabAccounts.setAttribute('aria-selected', next === 'accounts' ? 'true' : 'false');

    employeesPane.classList.toggle('open', next === 'employees');
    accountsPane.classList.toggle('open', next === 'accounts');
}

function parseFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue !== undefined) {
        const arr = value.arrayValue?.values || [];
        return arr.map((entry) => parseFirestoreValue(entry)).filter((entry) => entry !== null && entry !== undefined);
    }
    if (value.mapValue !== undefined) {
        const out = {};
        Object.entries(value.mapValue?.fields || {}).forEach(([k, v]) => {
            out[k] = parseFirestoreValue(v);
        });
        return out;
    }
    return null;
}

function parseFirestoreDoc(doc) {
    if (!doc?.fields) return null;
    const parsed = {};
    Object.entries(doc.fields).forEach(([key, raw]) => {
        parsed[key] = parseFirestoreValue(raw);
    });
    if (doc.name) {
        parsed._docId = doc.name.split('/').pop();
    }
    return parsed;
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    }
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
    return { stringValue: String(value ?? '') };
}

function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    const allowed = new Set(['admin', 'service', 'billing', 'collection', 'hr', 'technician', 'messenger', 'viewer']);
    if (allowed.has(role)) return role;
    return 'viewer';
}

function normalizeModuleList(list) {
    if (Array.isArray(list)) {
        return [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
    }
    if (typeof list === 'string' && list.trim()) {
        return [...new Set(list.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
    }
    return [];
}

function getRoleDefaultModules(role) {
    const r = normalizeRole(role);
    const defaults = MargaAuth.PERMISSIONS?.[r] || [];
    return normalizeModuleList(defaults);
}

function renderUserModuleAccess(selectedModules = []) {
    const host = document.getElementById('userModuleAccess');
    if (!host) return;
    const selected = new Set(normalizeModuleList(selectedModules));
    const readOnly = !MargaAuth.isAdmin();
    host.innerHTML = MODULE_OPTIONS.map((option) => `
        <label class="module-option">
            <input type="checkbox" value="${sanitize(option.id)}" ${selected.has(option.id) ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
            <span>${sanitize(option.label)}</span>
        </label>
    `).join('');
}

function getSelectedUserModules() {
    return [...document.querySelectorAll('#userModuleAccess input[type=\"checkbox\"]')]
        .filter((el) => el.checked)
        .map((el) => String(el.value || '').trim().toLowerCase())
        .filter(Boolean);
}

async function runQuery(structuredQuery) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) }
    );
    const payload = await response.json();
    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        const message = payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.';
        throw new Error(message);
    }
    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean);
}

async function patchDocument(collection, docId, fields) {
    const updateKeys = Object.keys(fields);
    if (!updateKeys.length) return;

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
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    }
    return payload;
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
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    }
    return payload;
}

function setUserModalOpen(isOpen) {
    const overlay = document.getElementById('userModalOverlay');
    const modal = document.getElementById('userModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeUserModal() {
    setUserModalOpen(false);
    SETTINGS_STATE.editingDocId = null;
    document.getElementById('userEmployeeLookup').value = '';
    renderUserModuleAccess([]);
}

function openUserModal(docId) {
    SETTINGS_STATE.editingDocId = docId;

    const title = document.getElementById('userModalTitle');
    const emailInput = document.getElementById('userEmail');
    const nameInput = document.getElementById('userNameInput');
    const roleInput = document.getElementById('userRoleInput');
    const staffInput = document.getElementById('userStaffId');
    const passInput = document.getElementById('userPassword');
    const activeInput = document.getElementById('userActive');
    const lookupInput = document.getElementById('userEmployeeLookup');

    const editing = docId ? SETTINGS_STATE.users.find((u) => u._docId === docId) : null;
    title.textContent = editing ? 'Edit User' : 'New User';

    lookupInput.value = '';
    emailInput.value = editing?.email || '';
    nameInput.value = editing?.name || '';
    roleInput.value = normalizeRole(editing?.role || 'viewer');
    staffInput.value = editing?.staff_id || '';
    passInput.value = '';
    activeInput.value = (editing?.active === false) ? 'false' : 'true';
    const selectedModules = normalizeModuleList(editing?.allowed_modules);
    renderUserModuleAccess(selectedModules.length ? selectedModules : getRoleDefaultModules(roleInput.value));

    // Email is the key for docId. Editing email is not supported yet.
    emailInput.disabled = Boolean(editing);
    lookupInput.disabled = Boolean(editing);

    setUserModalOpen(true);
}

function applyUserFilter() {
    const q = String(document.getElementById('userSearch').value || '').trim().toLowerCase();
    const statusFilter = String(document.getElementById('userStatusFilter').value || 'active');
    const wantActive = statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : null;

    const base = SETTINGS_STATE.users.filter((u) => {
        if (wantActive === null) return true;
        const active = u.active !== false;
        return wantActive ? active : !active;
    });

    SETTINGS_STATE.usersFiltered = q
        ? base.filter((u) =>
            String(u.email || '').toLowerCase().includes(q) ||
            String(u.name || '').toLowerCase().includes(q) ||
            String(u.role || '').toLowerCase().includes(q) ||
            String(u.staff_id || '').includes(q)
        )
        : base;

    renderUsers();
}

function renderUsers() {
    const tbody = document.querySelector('#usersTable tbody');
    const rows = SETTINGS_STATE.usersFiltered;
    const isAdmin = MargaAuth.isAdmin();
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No users found.</td></tr>';
        return;
    }

    const roleClass = (role) => {
        const r = String(role || '').toLowerCase();
        if (r === 'technician') return 'role-tech';
        if (r === 'messenger') return 'role-messenger';
        return 'role-unknown';
    };

    tbody.innerHTML = rows.map((u) => {
        const active = u.active !== false;
        const id = sanitize(u._docId);
        const statusSelect = `
            <select class="settings-inline-select" data-action="user-status" data-id="${id}">
                <option value="true" ${active ? 'selected' : ''}>Active</option>
                <option value="false" ${!active ? 'selected' : ''}>Inactive</option>
            </select>
        `;
        const resetBtn = isAdmin
            ? `<button type="button" class="btn btn-secondary btn-sm" data-action="reset" data-id="${id}">Reset Password</button>`
            : '';
        return `
            <tr>
                <td data-label="Email">${sanitize(u.email || u.username || u._docId || '-')}</td>
                <td data-label="Name">${sanitize(u.name || '-')}</td>
                <td data-label="Role"><span class="ops-role-badge ${sanitize(roleClass(u.role))}">${sanitize(u.role || 'viewer')}</span></td>
                <td data-label="Staff ID">${sanitize(u.staff_id || '-')}</td>
                <td data-label="Status">${statusSelect}</td>
                <td data-label="Action" class="settings-row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="view" data-id="${id}">View</button>
                    ${resetBtn}
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (!id) return;
            if (action === 'view') {
                openUserModal(id);
                return;
            }
            if (action === 'reset') {
                if (!isAdmin) return;
                const next = prompt('Set new temporary password:');
                if (next === null) return;
                await resetPassword(id, next);
            }
        });
    });

    tbody.querySelectorAll('select[data-action="user-status"]').forEach((sel) => {
        sel.addEventListener('change', async () => {
            const id = sel.dataset.id;
            if (!id) return;
            const next = sel.value === 'true';
            sel.disabled = true;
            try {
                await patchDocument('marga_users', id, { active: next, updated_at: new Date().toISOString() });
                await loadDirectory();
            } catch (err) {
                console.error('Update user status failed:', err);
                alert(`Failed to update status: ${err.message || err}`);
            } finally {
                sel.disabled = false;
            }
        });
    });
}

async function loadUsers() {
    document.querySelector('#usersTable tbody').innerHTML = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';
    try {
        const docs = await runQuery({
            from: [{ collectionId: 'marga_users' }],
            orderBy: [{ field: { fieldPath: 'email' }, direction: 'ASCENDING' }],
            limit: 2000
        });
        const users = docs.map(parseFirestoreDoc).filter(Boolean);
        SETTINGS_STATE.users = users;
        SETTINGS_STATE.userByStaffId = new Map();
        users.forEach((u) => {
            const staffId = u.staff_id ?? u.staffId ?? null;
            if (staffId === null || staffId === undefined || staffId === '') return;
            SETTINGS_STATE.userByStaffId.set(String(staffId), u);
        });
    } catch (err) {
        console.error('Load users failed:', err);
        document.querySelector('#usersTable tbody').innerHTML = '<tr><td colspan="6" class="loading-cell">Unable to load users.</td></tr>';
    }
}

function getRoleGuess(employee, positionName) {
    const posId = Number(employee.position_id || 0);
    const pn = String(positionName || '').toLowerCase();
    if (posId === 5 || pn.includes('technician') || pn.includes('tech')) return 'Technician';
    if (posId === 9 || pn.includes('messenger') || pn.includes('driver')) return 'Messenger';
    return 'Staff';
}

function roleGuessToUserRole(roleGuess) {
    const rg = String(roleGuess || '').toLowerCase();
    if (rg === 'technician') return 'technician';
    if (rg === 'messenger') return 'messenger';
    return 'viewer';
}

function renderEmployeeLookupOptions() {
    const list = document.getElementById('employeeLookupList');
    if (!list) return;
    const options = [...SETTINGS_STATE.employees]
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        .map((emp) => {
            const name = getEmployeeDisplayName(emp);
            const full = `${String(emp.firstname || '').trim()} ${String(emp.lastname || '').trim()}`.trim();
            const label = full && full.toLowerCase() !== name.toLowerCase() ? `${name} (${full})` : name;
            return `<option value="${sanitize(`${emp.id} - ${label}`)}"></option>`;
        });
    list.innerHTML = options.join('');
}

function findEmployeeFromLookupValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const idMatch = raw.match(/^(\d+)\s*-/);
    if (idMatch) {
        const id = Number(idMatch[1]);
        return SETTINGS_STATE.employees.find((e) => Number(e.id || 0) === id) || null;
    }
    const normalized = raw.toLowerCase();
    return SETTINGS_STATE.employees.find((e) => {
        const name = getEmployeeDisplayName(e).toLowerCase();
        const full = `${String(e.firstname || '').trim()} ${String(e.lastname || '').trim()}`.trim().toLowerCase();
        return name === normalized || full === normalized || `${e.id} - ${name}`.toLowerCase() === normalized;
    }) || null;
}

function getSuggestedRoleFromEmployee(emp) {
    if (emp?.marga_role) return normalizeRole(emp.marga_role);
    const positionName = SETTINGS_STATE.positions.get(String(emp?.position_id || 0)) || '';
    return normalizeRole(roleGuessToUserRole(getRoleGuess(emp, positionName)));
}

function applyUserEmployeeLookup() {
    if (SETTINGS_STATE.editingDocId) return;
    const lookup = document.getElementById('userEmployeeLookup');
    const emp = findEmployeeFromLookupValue(lookup.value);
    if (!emp) return;

    const name = `${String(emp.firstname || '').trim()} ${String(emp.lastname || '').trim()}`.trim() || getEmployeeDisplayName(emp);
    const suggestedRole = getSuggestedRoleFromEmployee(emp);
    const emailCandidate = String(emp.email || '').trim();

    document.getElementById('userNameInput').value = name;
    document.getElementById('userStaffId').value = String(emp.id || '');
    document.getElementById('userRoleInput').value = suggestedRole;
    if (emailCandidate && !String(document.getElementById('userEmail').value || '').trim()) {
        document.getElementById('userEmail').value = emailCandidate;
    }
    renderUserModuleAccess(getRoleDefaultModules(suggestedRole));
}

function displayRoleLabel(role) {
    const r = normalizeRole(role);
    return r.charAt(0).toUpperCase() + r.slice(1);
}

function roleBadgeClass(role) {
    const r = normalizeRole(role);
    if (r === 'technician') return 'role-tech';
    if (r === 'messenger') return 'role-messenger';
    return 'role-unknown';
}

function getEmployeeEffectiveRole(employee, linked, positionName) {
    if (linked?.role) return normalizeRole(linked.role);
    if (employee?.marga_role) return normalizeRole(employee.marga_role);
    return normalizeRole(roleGuessToUserRole(getRoleGuess(employee, positionName)));
}

function getEmployeeDisplayName(emp) {
    const nickname = String(emp.nickname || '').trim();
    const first = String(emp.firstname || '').trim();
    const last = String(emp.lastname || '').trim();
    if (nickname) return nickname;
    return `${first} ${last}`.trim() || `ID ${emp.id || '-'}`;
}

function applyEmployeeFilter() {
    const q = String(document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const statusFilter = String(document.getElementById('employeeStatusFilter').value || 'active');
    const wantActive = statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : null;

    const base = SETTINGS_STATE.employees.filter((e) => {
        if (wantActive === null) return true;
        const active = e.marga_active !== false;
        return wantActive ? active : !active;
    });

    SETTINGS_STATE.employeesFiltered = q
        ? base.filter((e) => {
            const positionName = SETTINGS_STATE.positions.get(String(e.position_id || 0)) || '';
            const name = getEmployeeDisplayName(e);
            return (
                String(e.id || '').includes(q) ||
                name.toLowerCase().includes(q) ||
                String(positionName).toLowerCase().includes(q) ||
                String(e.contact_number || '').toLowerCase().includes(q)
            );
        })
        : base;

    renderEmployees();
}

function renderEmployees() {
    const tbody = document.querySelector('#employeesTable tbody');
    const rows = SETTINGS_STATE.employeesFiltered;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No employees found.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((e) => {
        const empId = sanitize(e.id);
        const positionName = SETTINGS_STATE.positions.get(String(e.position_id || 0)) || '-';
        const active = e.marga_active !== false;
        const linked = SETTINGS_STATE.userByStaffId.get(String(e.id || '')) || null;
        const effectiveRole = getEmployeeEffectiveRole(e, linked, positionName);
        return `
            <tr>
                <td data-label="ID">${empId}</td>
                <td data-label="Name">${sanitize(getEmployeeDisplayName(e))}</td>
                <td data-label="Position">${sanitize(positionName || '-')}</td>
                <td data-label="Role"><span class="ops-role-badge ${sanitize(roleBadgeClass(effectiveRole))}">${sanitize(displayRoleLabel(effectiveRole))}</span></td>
                <td data-label="Status">
                    <select class="settings-inline-select" data-action="emp-status" data-id="${empId}">
                        <option value="true" ${active ? 'selected' : ''}>Active</option>
                        <option value="false" ${!active ? 'selected' : ''}>Inactive</option>
                    </select>
                </td>
                <td data-label="Account">${sanitize(linked?.email || '-')}</td>
                <td data-label="Action" class="settings-row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="emp-view" data-id="${empId}">View</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('button[data-action="emp-view"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (!id) return;
            openEmployeeModal(id);
        });
    });

    tbody.querySelectorAll('select[data-action="emp-status"]').forEach((sel) => {
        sel.addEventListener('change', async () => {
            const id = sel.dataset.id;
            if (!id) return;
            const next = sel.value === 'true';
            sel.disabled = true;
            try {
                await patchDocument('tbl_employee', id, { marga_active: next });
                await loadDirectory();
            } catch (err) {
                console.error('Update employee status failed:', err);
                alert(`Failed to update employee status: ${err.message || err}`);
            } finally {
                sel.disabled = false;
            }
        });
    });
}

async function loadPositions() {
    try {
        const docs = await runQuery({
            from: [{ collectionId: 'tbl_empos' }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'ASCENDING' }],
            limit: 2000
        });
        const positions = docs.map(parseFirestoreDoc).filter(Boolean);
        SETTINGS_STATE.positions = new Map(positions.map((p) => [String(p.id || p._docId || ''), p.position || p.name || '']));
    } catch (err) {
        console.error('Load positions failed:', err);
        SETTINGS_STATE.positions = new Map();
    }
}

async function loadEmployees() {
    document.querySelector('#employeesTable tbody').innerHTML = '<tr><td colspan="7" class="loading-cell">Loading...</td></tr>';
    try {
        const docs = await runQuery({
            from: [{ collectionId: 'tbl_employee' }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'ASCENDING' }],
            limit: 5000
        });
        const employees = docs.map(parseFirestoreDoc).filter(Boolean);
        SETTINGS_STATE.employees = employees;
    } catch (err) {
        console.error('Load employees failed:', err);
        document.querySelector('#employeesTable tbody').innerHTML = '<tr><td colspan="7" class="loading-cell">Unable to load employees.</td></tr>';
        SETTINGS_STATE.employees = [];
    }
}

async function loadDirectory() {
    document.getElementById('settingsMeta').textContent = 'Loading directory from Firestore...';
    await Promise.all([loadPositions(), loadUsers(), loadEmployees()]);

    document.getElementById('settingsMeta').textContent = `${SETTINGS_STATE.employees.length} employee(s), ${SETTINGS_STATE.users.length} account(s).`;

    renderEmployeeLookupOptions();
    applyEmployeeFilter();
    applyUserFilter();
}

function setEmployeeModalOpen(isOpen) {
    const overlay = document.getElementById('employeeModalOverlay');
    const modal = document.getElementById('employeeModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeEmployeeModal() {
    SETTINGS_STATE.editingEmployeeId = null;
    setEmployeeModalOpen(false);
}

function openEmployeeModal(employeeId) {
    SETTINGS_STATE.editingEmployeeId = String(employeeId || '');
    const emp = SETTINGS_STATE.employees.find((e) => String(e.id || '') === SETTINGS_STATE.editingEmployeeId) || null;
    if (!emp) {
        alert('Employee not found.');
        return;
    }

    const positionName = SETTINGS_STATE.positions.get(String(emp.position_id || 0)) || '';
    const linked = SETTINGS_STATE.userByStaffId.get(String(emp.id || '')) || null;
    const effectiveRole = getEmployeeEffectiveRole(emp, linked, positionName);

    document.getElementById('employeeModalTitle').textContent = `${getEmployeeDisplayName(emp)} (${emp.id})`;
    document.getElementById('employeeId').value = String(emp.id || '');
    document.getElementById('employeePosition').value = positionName || '-';
    document.getElementById('employeeNickname').value = String(emp.nickname || '').trim();
    document.getElementById('employeeContact').value = String(emp.contact_number || '').trim();
    document.getElementById('employeeFullName').value = `${String(emp.firstname || '').trim()} ${String(emp.lastname || '').trim()}`.trim();

    const empActive = emp.marga_active !== false;
    document.getElementById('employeeActive').value = empActive ? 'true' : 'false';

    document.getElementById('employeeEmail').value = String(linked?.email || '').trim();
    document.getElementById('employeeRole').value = effectiveRole;
    document.getElementById('employeeAccountActive').value = (linked?.active === false) ? 'false' : (empActive ? 'true' : 'false');
    document.getElementById('employeePassword').value = '';

    setEmployeeModalOpen(true);
}

async function saveEmployee() {
    const saveBtn = document.getElementById('employeeModalSaveBtn');
    saveBtn.disabled = true;
    const isAdmin = MargaAuth.isAdmin();

    try {
        const employeeId = SETTINGS_STATE.editingEmployeeId;
        if (!employeeId) return;

        const empActive = document.getElementById('employeeActive').value === 'true';
        const role = normalizeRole(document.getElementById('employeeRole').value || 'viewer');
        await patchDocument('tbl_employee', employeeId, {
            marga_active: empActive,
            marga_role: role,
            marga_role_updated_at: new Date().toISOString()
        });

        const email = String(document.getElementById('employeeEmail').value || '').trim().toLowerCase();
        const accountActive = document.getElementById('employeeAccountActive').value === 'true';
        const password = String(document.getElementById('employeePassword').value || '');

        if (email) {
            const emp = SETTINGS_STATE.employees.find((e) => String(e.id || '') === String(employeeId)) || {};
            const name = getEmployeeDisplayName(emp);
            const linked = SETTINGS_STATE.userByStaffId.get(String(employeeId)) || null;

            const baseFields = {
                email,
                username: email,
                name,
                role,
                active: accountActive,
                staff_id: Number(employeeId),
                allowed_modules: normalizeModuleList(linked?.allowed_modules).length
                    ? normalizeModuleList(linked?.allowed_modules)
                    : getRoleDefaultModules(role),
                updated_at: new Date().toISOString()
            };

            // If an existing account is linked by staff_id but email changed, create the new docId and optionally disable the old one.
            if (linked && String(linked._docId || '') !== email) {
                const ok = confirm(`This employee is currently linked to ${linked.email || linked._docId}. Link to ${email} instead? The old account will be set to inactive.`);
                if (!ok) return;
                await patchDocument('marga_users', linked._docId, { active: false, updated_at: new Date().toISOString() });
            }

            if (password) {
                if (!isAdmin) {
                    alert('Only admin can set passwords.');
                } else {
                    const hashed = await hashPassword(password);
                    await setDocument('marga_users', email, { ...baseFields, ...hashed });
                }
            } else {
                if (!isAdmin) {
                    alert('Account saved without a password. Ask admin to set a temporary password before the user can login.');
                }
                await setDocument('marga_users', email, baseFields);
            }
        }

        closeEmployeeModal();
        await loadDirectory();
        alert('Employee saved.');
    } catch (err) {
        console.error('Save employee failed:', err);
        alert(`Failed to save employee: ${err.message || err}`);
    } finally {
        saveBtn.disabled = false;
    }
}

async function hashPassword(password) {
    const raw = String(password || '');
    if (!MargaAuth.canHashPasswords?.() || !crypto?.getRandomValues) {
        // Local file:// mode can lack WebCrypto; allow legacy plaintext as fallback.
        return { password: raw };
    }

    const iterations = 120000;
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const derived = await MargaAuth.pbkdf2(raw, salt, iterations);
    return {
        password_hash: MargaAuth.bytesToBase64(derived),
        password_salt: MargaAuth.bytesToBase64(salt),
        password_iterations: iterations,
        password_algo: 'PBKDF2-SHA256'
    };
}

async function saveUser() {
    const saveBtn = document.getElementById('userModalSaveBtn');
    saveBtn.disabled = true;
    const isAdmin = MargaAuth.isAdmin();

    try {
        const email = String(document.getElementById('userEmail').value || '').trim().toLowerCase();
        const name = String(document.getElementById('userNameInput').value || '').trim();
        const role = String(document.getElementById('userRoleInput').value || 'viewer').trim();
        const staffIdRaw = String(document.getElementById('userStaffId').value || '').trim();
        const staff_id = staffIdRaw ? Number(staffIdRaw) : null;
        const password = isAdmin ? String(document.getElementById('userPassword').value || '') : '';
        const active = document.getElementById('userActive').value === 'true';

        if (!email) {
            alert('Email is required.');
            return;
        }

        if (!role) {
            alert('Role is required.');
            return;
        }

        const normalizedRole = normalizeRole(role);
        const editing = SETTINGS_STATE.editingDocId
            ? SETTINGS_STATE.users.find((u) => u._docId === SETTINGS_STATE.editingDocId) || null
            : null;
        const allowedModules = isAdmin
            ? getSelectedUserModules()
            : (normalizeModuleList(editing?.allowed_modules).length
                ? normalizeModuleList(editing?.allowed_modules)
                : getRoleDefaultModules(normalizedRole));

        const docId = SETTINGS_STATE.editingDocId || email;

        const baseFields = {
            email,
            username: email,
            name,
            role: normalizedRole,
            active,
            staff_id: staff_id || null,
            allowed_modules: allowedModules,
            updated_at: new Date().toISOString()
        };

        if (!SETTINGS_STATE.editingDocId) {
            if (!password) {
                alert('Temporary password is required for new users.');
                return;
            }
            const hashed = await hashPassword(password);
            await setDocument('marga_users', docId, { ...baseFields, ...hashed });
        } else {
            // Update existing. If password provided, reset it.
            if (password) {
                const hashed = await hashPassword(password);
                await patchDocument('marga_users', docId, { ...baseFields, ...hashed });
            } else {
                await patchDocument('marga_users', docId, baseFields);
            }
        }

        closeUserModal();
        await loadDirectory();
        alert('User saved.');
    } catch (err) {
        console.error('Save user failed:', err);
        alert(`Failed to save user: ${err.message || err}`);
    } finally {
        saveBtn.disabled = false;
    }
}

async function resetPassword(docId, newPassword) {
    if (!MargaAuth.isAdmin()) {
        alert('Only admin can reset passwords.');
        return;
    }
    const next = String(newPassword || '');
    if (!next) {
        alert('Password cannot be empty.');
        return;
    }
    try {
        const hashed = await hashPassword(next);
        await patchDocument('marga_users', docId, { ...hashed, updated_at: new Date().toISOString() });
        alert('Password reset.');
    } catch (err) {
        console.error('Reset password failed:', err);
        alert(`Failed to reset password: ${err.message || err}`);
    }
}
