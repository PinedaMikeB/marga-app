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
    editingEmployeeId: null,
    roleConfigs: new Map(),
    roleDocIds: new Map(),
    activeRoleEditor: 'collection'
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

const ROLE_OPTIONS = [
    { id: 'admin', label: 'Admin', description: 'Full system control and user administration.' },
    { id: 'service', label: 'Service', description: 'Customer service and dispatch operations.' },
    { id: 'billing', label: 'Billing', description: 'Billing, collections reporting, and finance operations.' },
    { id: 'collection', label: 'Collection', description: 'Collection workflow and follow-up modules.' },
    { id: 'hr', label: 'HR', description: 'HR and settings management scope.' },
    { id: 'technician', label: 'Technician', description: 'Field app access for technicians.' },
    { id: 'messenger', label: 'Messenger', description: 'Field app access for messengers/drivers.' },
    { id: 'viewer', label: 'Viewer', description: 'Read-focused access only.' }
];

const BASE_ROLE_DEFAULTS = {
    admin: ['customers', 'billing', 'collections', 'service', 'inventory', 'hr', 'reports', 'settings', 'sync', 'field', 'purchasing', 'pettycash', 'sales'],
    billing: ['customers', 'billing', 'reports'],
    collection: ['customers', 'collections', 'reports'],
    service: ['customers', 'service', 'inventory', 'field'],
    hr: ['hr', 'settings'],
    technician: ['field'],
    messenger: ['field'],
    viewer: ['customers', 'reports']
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    const isAdmin = MargaAuth.isAdmin();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    }

    document.getElementById('tabEmployees').addEventListener('click', () => setActiveTab('employees'));
    document.getElementById('tabAccounts').addEventListener('click', () => setActiveTab('accounts'));
    document.getElementById('tabRoles').addEventListener('click', () => setActiveTab('roles'));

    document.getElementById('refreshUsersBtn').addEventListener('click', () => loadDirectory());
    document.getElementById('userSearch').addEventListener('input', () => applyUserFilter());
    document.getElementById('userStatusFilter').addEventListener('change', () => applyUserFilter());
    document.getElementById('syncUsersBtn').addEventListener('click', () => syncUsersFromSpreadsheet());

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
    document.getElementById('userRoleInput').addEventListener('change', () => {
        if (SETTINGS_STATE.editingDocId) return;
        const role = document.getElementById('userRoleInput').value || 'viewer';
        renderUserModuleAccess(getRoleDefaultModules(role));
    });
    document.getElementById('applyRoleDefaultsBtn').addEventListener('click', () => {
        const role = document.getElementById('userRoleInput').value || 'viewer';
        renderUserModuleAccess(getRoleDefaultModules(role));
    });
    document.getElementById('saveRolePermissionsBtn').addEventListener('click', () => saveRolePermissions());
    document.getElementById('resetRolePermissionsBtn').addEventListener('click', () => resetRolePermissions());

    document.getElementById('employeeModalOverlay').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCloseBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCancelBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalSaveBtn').addEventListener('click', () => saveEmployee());

    // Ensure admin-only password fields are hidden for HR/non-admin.
    document.getElementById('userPasswordField').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('employeePasswordField').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('applyRoleDefaultsBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('saveRolePermissionsBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('resetRolePermissionsBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('syncUsersBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('userSyncFileInput').disabled = !isAdmin;
    if (!isAdmin) {
        document.getElementById('syncUsersResult').textContent = 'Only admin can sync XLSX user data.';
    }

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
    const next = tab === 'accounts' ? 'accounts' : tab === 'roles' ? 'roles' : 'employees';
    const tabEmployees = document.getElementById('tabEmployees');
    const tabAccounts = document.getElementById('tabAccounts');
    const tabRoles = document.getElementById('tabRoles');
    const employeesPane = document.getElementById('employeesPane');
    const accountsPane = document.getElementById('accountsPane');
    const rolesPane = document.getElementById('rolesPane');

    tabEmployees.classList.toggle('active', next === 'employees');
    tabAccounts.classList.toggle('active', next === 'accounts');
    tabRoles.classList.toggle('active', next === 'roles');
    tabEmployees.setAttribute('aria-selected', next === 'employees' ? 'true' : 'false');
    tabAccounts.setAttribute('aria-selected', next === 'accounts' ? 'true' : 'false');
    tabRoles.setAttribute('aria-selected', next === 'roles' ? 'true' : 'false');

    employeesPane.classList.toggle('open', next === 'employees');
    accountsPane.classList.toggle('open', next === 'accounts');
    rolesPane.classList.toggle('open', next === 'roles');
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
    const allowed = new Set(ROLE_OPTIONS.map((option) => option.id));
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

function moduleListsEqual(left, right) {
    const a = normalizeModuleList(left);
    const b = normalizeModuleList(right);
    if (a.length !== b.length) return false;
    const leftSet = new Set(a);
    return b.every((item) => leftSet.has(item));
}

function hasExplicitModuleOverride(userLike) {
    if (!userLike) return false;
    if (userLike.allowed_modules_configured === true) return true;
    if (userLike.allowed_modules_configured === false) return false;
    return normalizeModuleList(userLike.allowed_modules).length > 0;
}

function getRoleDefaultModules(role) {
    const r = normalizeRole(role);
    if (SETTINGS_STATE.roleConfigs.has(r)) return normalizeModuleList(SETTINGS_STATE.roleConfigs.get(r));
    const defaults = BASE_ROLE_DEFAULTS[r] || MargaAuth.PERMISSIONS?.[r] || [];
    return normalizeModuleList(defaults);
}

function getRoleOption(role) {
    const normalized = normalizeRole(role);
    return ROLE_OPTIONS.find((option) => option.id === normalized) || ROLE_OPTIONS.find((option) => option.id === 'viewer');
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

function renderRoleList() {
    const host = document.getElementById('roleList');
    if (!host) return;
    host.innerHTML = ROLE_OPTIONS.map((role) => `
        <button type="button" class="role-list-item ${SETTINGS_STATE.activeRoleEditor === role.id ? 'active' : ''}" data-role-id="${sanitize(role.id)}">
            <strong>${sanitize(role.label)}</strong>
            <span>${sanitize(role.description)}</span>
        </button>
    `).join('');

    host.querySelectorAll('[data-role-id]').forEach((button) => {
        button.addEventListener('click', () => {
            SETTINGS_STATE.activeRoleEditor = normalizeRole(button.dataset.roleId);
            renderRoleList();
            renderRoleEditor();
        });
    });
}

function renderRoleModuleAccess(selectedModules = []) {
    const host = document.getElementById('roleModuleAccess');
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

function getSelectedRoleModules() {
    return [...document.querySelectorAll('#roleModuleAccess input[type=\"checkbox\"]')]
        .filter((el) => el.checked)
        .map((el) => String(el.value || '').trim().toLowerCase())
        .filter(Boolean);
}

function renderRoleEditor() {
    const roleId = normalizeRole(SETTINGS_STATE.activeRoleEditor || 'viewer');
    const role = getRoleOption(roleId);
    const modules = getRoleDefaultModules(roleId);
    const title = document.getElementById('roleEditorTitle');
    const subtitle = document.getElementById('roleEditorSubtitle');
    const meta = document.getElementById('roleModuleMeta');
    if (title) title.textContent = role.label;
    if (subtitle) subtitle.textContent = role.description;
    renderRoleModuleAccess(modules);
    if (meta) {
        meta.textContent = `${modules.length} module(s) allowed for ${role.label}. Users with custom module overrides are not changed automatically.`;
    }
}

async function saveRolePermissions() {
    if (!MargaAuth.isAdmin()) {
        alert('Only admin can edit role permissions.');
        return;
    }
    const roleId = normalizeRole(SETTINGS_STATE.activeRoleEditor || 'viewer');
    const modules = getSelectedRoleModules();
    const role = getRoleOption(roleId);
    try {
        await setDocument('marga_role_permissions', roleId, {
            role: roleId,
            label: role.label,
            allowed_modules: modules,
            active: true,
            updated_at: new Date().toISOString(),
            updated_by: MargaAuth.getUser()?.email || MargaAuth.getUser()?.username || 'unknown'
        });
        SETTINGS_STATE.roleConfigs.set(roleId, modules);
        SETTINGS_STATE.roleDocIds.set(roleId, roleId);
        MargaAuth.setRolePermissions(roleId, modules);
        renderRoleList();
        renderRoleEditor();
        alert(`Saved role permissions for ${role.label}.`);
    } catch (err) {
        console.error('Save role permissions failed:', err);
        alert(`Failed to save role permissions: ${err.message || err}`);
    }
}

function resetRolePermissions() {
    const roleId = normalizeRole(SETTINGS_STATE.activeRoleEditor || 'viewer');
    const modules = normalizeModuleList(BASE_ROLE_DEFAULTS[roleId] || []);
    if (!confirm(`Reset ${getRoleOption(roleId).label} to current system defaults?`)) return;
    SETTINGS_STATE.roleConfigs.set(roleId, modules);
    renderRoleList();
    renderRoleEditor();
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
    renderUserModuleAccess(hasExplicitModuleOverride(editing) ? selectedModules : getRoleDefaultModules(roleInput.value));

    // Employee ID is the key in tbl_employee; email can be edited anytime.
    emailInput.disabled = false;
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
                await patchDocument('tbl_employee', id, {
                    marga_account_active: next,
                    marga_updated_at: new Date().toISOString()
                });
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
        const users = [...SETTINGS_STATE.employees]
            .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
            .map((employee) => {
                const first = String(employee.firstname || '').trim();
                const last = String(employee.lastname || '').trim();
                const name = `${first} ${last}`.trim() || String(employee.nickname || '').trim() || `ID ${employee.id || '-'}`;
                const role = normalizeRole(employee.marga_role || roleGuessToUserRole(getRoleGuess(employee, SETTINGS_STATE.positions.get(String(employee.position_id || 0)) || '')));
                const email = String(employee.email || employee.marga_login_email || '').trim().toLowerCase();
                const hasLogin = Boolean(email || employee.password_hash || employee.password);
                const accountActive = employee.marga_account_active !== false;
                return {
                    ...employee,
                    _docId: String(employee.id || employee._docId || ''),
                    email,
                    name,
                    role,
                    staff_id: Number(employee.id || 0) || null,
                    active: accountActive,
                    allowed_modules: normalizeModuleList(employee.marga_allowed_modules || employee.allowed_modules),
                    allowed_modules_configured: employee.allowed_modules_configured === true,
                    has_login: hasLogin
                };
            })
            .filter((row) => row.staff_id !== null);
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
    return getRoleOption(role).label;
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

async function loadRoleConfigs() {
    try {
        const docs = await runQuery({
            from: [{ collectionId: 'marga_role_permissions' }],
            orderBy: [{ field: { fieldPath: 'role' }, direction: 'ASCENDING' }],
            limit: 200
        });
        const roleDocs = docs.map(parseFirestoreDoc).filter(Boolean);
        const roleConfigs = new Map();
        const roleDocIds = new Map();

        ROLE_OPTIONS.forEach((role) => {
            roleConfigs.set(role.id, normalizeModuleList(BASE_ROLE_DEFAULTS[role.id] || []));
        });

        roleDocs.forEach((doc) => {
            const roleId = normalizeRole(doc.role || doc._docId);
            const modules = normalizeModuleList(doc.allowed_modules);
            roleConfigs.set(roleId, modules);
            roleDocIds.set(roleId, doc._docId || roleId);
        });

        SETTINGS_STATE.roleConfigs = roleConfigs;
        SETTINGS_STATE.roleDocIds = roleDocIds;
        SETTINGS_STATE.activeRoleEditor = ROLE_OPTIONS.some((role) => role.id === SETTINGS_STATE.activeRoleEditor)
            ? SETTINGS_STATE.activeRoleEditor
            : 'collection';

        ROLE_OPTIONS.forEach((role) => {
            MargaAuth.setRolePermissions(role.id, roleConfigs.get(role.id) || []);
        });
    } catch (err) {
        console.error('Load role configs failed:', err);
        SETTINGS_STATE.roleConfigs = new Map(ROLE_OPTIONS.map((role) => [role.id, normalizeModuleList(BASE_ROLE_DEFAULTS[role.id] || [])]));
        SETTINGS_STATE.roleDocIds = new Map();
    }
}

async function loadDirectory() {
    document.getElementById('settingsMeta').textContent = 'Loading directory from Firestore...';
    await Promise.all([loadPositions(), loadEmployees(), loadRoleConfigs()]);
    await loadUsers();

    document.getElementById('settingsMeta').textContent = `${SETTINGS_STATE.employees.length} employee(s), ${SETTINGS_STATE.users.length} account(s), ${SETTINGS_STATE.roleConfigs.size} role policy set(s).`;

    renderEmployeeLookupOptions();
    applyEmployeeFilter();
    applyUserFilter();
    renderRoleList();
    renderRoleEditor();
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
            marga_role_updated_at: new Date().toISOString(),
            marga_updated_at: new Date().toISOString()
        });

        const email = String(document.getElementById('employeeEmail').value || '').trim().toLowerCase();
        const accountActive = document.getElementById('employeeAccountActive').value === 'true';
        const password = String(document.getElementById('employeePassword').value || '');

        const linked = SETTINGS_STATE.userByStaffId.get(String(employeeId)) || null;
        const baseFields = {
            marga_account_active: accountActive,
            marga_active: empActive && accountActive,
            marga_role: role,
            marga_allowed_modules: hasExplicitModuleOverride(linked)
                ? normalizeModuleList(linked?.allowed_modules)
                : getRoleDefaultModules(role),
            allowed_modules_configured: hasExplicitModuleOverride(linked),
            marga_updated_at: new Date().toISOString()
        };

        if (email) {
            baseFields.email = email;
            baseFields.marga_login_email = email;
        }

        if (password) {
            if (!isAdmin) {
                alert('Only admin can set passwords.');
            } else {
                const hashed = await hashPassword(password);
                Object.assign(baseFields, hashed, { marga_password_updated_at: new Date().toISOString() });
            }
        }

        await patchDocument('tbl_employee', employeeId, baseFields);

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

function isValidEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    if (!value) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSpreadsheetHeader(header) {
    return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeNumericText(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^-?\d+(\.0+)?$/.test(raw)) return String(Math.trunc(Number(raw)));
    return raw;
}

function mapPositionToRole(position) {
    const p = String(position || '').trim().toLowerCase();
    if (!p) return 'viewer';
    if (p.includes('admin')) return 'admin';
    if (p.includes('collect')) return 'collection';
    if (p.includes('billing') || p.includes('cashier') || p.includes('account') || p.includes('finance') || p.includes('purchasing')) return 'billing';
    if (p.includes('messenger') || p.includes('driver')) return 'messenger';
    if (p.includes('tech') || p.includes('maintenance') || p.includes('refiller')) return 'technician';
    if (p.includes('service') || p.includes('csr') || p.includes('sales')) return 'service';
    if (p.includes('hr')) return 'hr';
    return 'viewer';
}

function buildImportRecordsFromRows(rows) {
    const headerIdx = rows.findIndex((row) => {
        const normalized = row.map((cell) => normalizeSpreadsheetHeader(cell));
        return normalized.includes('employee_id') && normalized.includes('email') && normalized.includes('password');
    });

    if (headerIdx < 0) {
        throw new Error('Cannot detect XLSX headers. Required columns: Employee_Id, Firstname, Lastname.');
    }

    const header = rows[headerIdx].map((cell) => normalizeSpreadsheetHeader(cell));
    const col = (name) => header.indexOf(name);
    const cols = {
        employee_id: col('employee_id'),
        nickname: col('nickname'),
        firstname: col('firstname'),
        lastname: col('lastname'),
        password: col('password'),
        contact_number: col('contact_number'),
        position: col('position'),
        email: col('email')
    };
    if (cols.employee_id < 0) {
        throw new Error('Missing required XLSX column: Employee_Id.');
    }

    const records = [];
    const skipped = [];

    for (let i = headerIdx + 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const rowNumber = i + 1;
        const employeeIdRaw = normalizeNumericText(row[cols.employee_id]);
        const nickname = String(row[cols.nickname] ?? '').trim();
        const firstname = String(row[cols.firstname] ?? '').trim();
        const lastname = String(row[cols.lastname] ?? '').trim();
        const password = normalizeNumericText(row[cols.password]);
        const contactNumber = normalizeNumericText(row[cols.contact_number]);
        const position = String(row[cols.position] ?? '').trim();
        const email = String(row[cols.email] ?? '').trim().toLowerCase();

        if (!employeeIdRaw && !nickname && !firstname && !lastname && !password && !position && !email) continue;
        if (!employeeIdRaw) {
            skipped.push({ row: rowNumber, reason: 'Missing employee ID.' });
            continue;
        }
        const staffId = Number(employeeIdRaw);
        if (!Number.isFinite(staffId)) {
            skipped.push({ row: rowNumber, reason: `Invalid employee ID: ${employeeIdRaw}` });
            continue;
        }
        const role = mapPositionToRole(position);
        const fullName = `${firstname} ${lastname}`.trim() || nickname || (email ? email.split('@')[0] : '');
        records.push({
            rowNumber,
            staff_id: staffId,
            nickname,
            firstname,
            lastname,
            name: fullName,
            email,
            password,
            has_valid_email: isValidEmail(email),
            has_password: Boolean(password),
            position,
            contact_number: contactNumber,
            role,
            allowed_modules: getRoleDefaultModules(role)
        });
    }

    return { records, skipped };
}

function normalizeNameKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeUsername(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 48);
}

function buildUsernameCandidates(record, employeeId) {
    const out = [];
    const email = String(record.email || '').trim().toLowerCase();
    if (email.includes('@')) out.push(email.split('@')[0]);
    if (record.nickname) out.push(record.nickname);
    if (record.firstname && record.lastname) out.push(`${record.firstname}.${record.lastname}`);
    if (record.firstname) out.push(record.firstname);
    out.push(`emp${employeeId}`);
    return out;
}

function pickUniqueUsername(record, employeeId, usedUsernames, currentUsername = '') {
    const current = sanitizeUsername(currentUsername);
    if (current) usedUsernames.delete(current);

    for (const raw of buildUsernameCandidates(record, employeeId)) {
        const base = sanitizeUsername(raw);
        if (!base) continue;
        let candidate = base;
        let idx = 2;
        while (usedUsernames.has(candidate)) {
            candidate = `${base}${idx}`;
            idx += 1;
        }
        usedUsernames.add(candidate);
        return candidate;
    }

    const fallback = `emp${employeeId}`;
    usedUsernames.add(fallback);
    return fallback;
}

function getImportMatchCandidates(record, indexes) {
    const candidates = new Set();
    const direct = indexes.byId.get(Number(record.staff_id || 0));
    if (direct) candidates.add(direct);

    const firstLast = `${normalizeNameKey(record.firstname)}|${normalizeNameKey(record.lastname)}`;
    (indexes.byFirstLast.get(firstLast) || []).forEach((id) => candidates.add(id));

    const nickLast = `${normalizeNameKey(record.nickname)}|${normalizeNameKey(record.lastname)}`;
    (indexes.byNickLast.get(nickLast) || []).forEach((id) => candidates.add(id));

    const full = normalizeNameKey(record.name);
    (indexes.byFullName.get(full) || []).forEach((id) => candidates.add(id));

    return [...candidates];
}

async function syncUsersFromSpreadsheet() {
    if (!MargaAuth.isAdmin()) {
        alert('Only admin can sync XLSX users.');
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert('XLSX parser failed to load. Refresh the page and try again.');
        return;
    }

    const fileInput = document.getElementById('userSyncFileInput');
    const resultEl = document.getElementById('syncUsersResult');
    const button = document.getElementById('syncUsersBtn');
    const file = fileInput?.files?.[0];
    if (!file) {
        alert('Select the Final Marga Users .xlsx file first.');
        return;
    }

    button.disabled = true;
    resultEl.textContent = 'Sync in progress...';
    try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        const { records, skipped } = buildImportRecordsFromRows(rows);
        if (!records.length) {
            resultEl.textContent = `No rows found. Skipped: ${skipped.length}.`;
            return;
        }

        const employeesById = new Map();
        const byFirstLast = new Map();
        const byNickLast = new Map();
        const byFullName = new Map();

        const addToMap = (map, key, id) => {
            if (!key || key === '|') return;
            if (!map.has(key)) map.set(key, []);
            if (!map.get(key).includes(id)) map.get(key).push(id);
        };

        SETTINGS_STATE.employees.forEach((employee) => {
            const id = Number(employee.id || 0);
            if (!id) return;
            employeesById.set(id, employee);
            const first = normalizeNameKey(employee.firstname);
            const last = normalizeNameKey(employee.lastname);
            const nick = normalizeNameKey(employee.nickname);
            const full = normalizeNameKey(`${String(employee.firstname || '').trim()} ${String(employee.lastname || '').trim()}`.trim() || employee.nickname || '');
            addToMap(byFirstLast, `${first}|${last}`, id);
            addToMap(byNickLast, `${nick}|${last}`, id);
            addToMap(byFullName, full, id);
        });

        const indexes = { byId: employeesById, byFirstLast, byNickLast, byFullName };
        const matchedIds = new Set();
        let synced = 0;
        const failed = [];
        const nowIso = new Date().toISOString();
        const usedUsernames = new Set();
        SETTINGS_STATE.employees.forEach((employee) => {
            const username = sanitizeUsername(employee.username);
            if (username) usedUsernames.add(username);
        });

        for (const record of records) {
            try {
                const candidates = getImportMatchCandidates(record, indexes);
                if (!candidates.length) {
                    failed.push({ row: record.rowNumber, reason: `No employee match for ${record.name || 'row'}` });
                    continue;
                }
                let employeeId = candidates[0];
                if (candidates.length > 1) {
                    const activeCandidate = candidates.find((id) => Number(employeesById.get(id)?.estatus || 0) === 1);
                    employeeId = activeCandidate || candidates[0];
                }

                const updateFields = {
                    marga_active: true,
                    marga_account_active: true,
                    marga_role: record.role,
                    marga_role_updated_at: nowIso,
                    marga_allowed_modules: record.allowed_modules,
                    allowed_modules_configured: false,
                    marga_source_file: file.name,
                    marga_source_row: record.rowNumber,
                    marga_updated_at: nowIso
                };

                if (record.contact_number) updateFields.contact_number = record.contact_number;
                if (record.has_valid_email) {
                    updateFields.email = record.email;
                    updateFields.marga_login_email = record.email;
                }
                const currentUsername = sanitizeUsername(employeesById.get(employeeId)?.username || '');
                const nextUsername = pickUniqueUsername(record, employeeId, usedUsernames, currentUsername);
                if (nextUsername) updateFields.username = nextUsername;
                if (record.has_password) {
                    const hashed = await hashPassword(record.password);
                    Object.assign(updateFields, hashed, { marga_password_updated_at: nowIso });
                }

                await patchDocument('tbl_employee', String(employeeId), updateFields);
                matchedIds.add(Number(employeeId));
                synced += 1;
            } catch (err) {
                failed.push({ row: record.rowNumber, reason: err.message || String(err) });
            }
        }

        // Canonical policy: employees not present in the confirmed final list become inactive.
        for (const employee of SETTINGS_STATE.employees) {
            const id = Number(employee.id || 0);
            if (!id || matchedIds.has(id)) continue;
            await patchDocument('tbl_employee', String(id), {
                marga_active: false,
                marga_account_active: false,
                marga_updated_at: nowIso
            });
        }

        await loadDirectory();
        const skippedAll = [...skipped, ...failed];
        const skipPreview = skippedAll.slice(0, 4).map((item) => `row ${item.row}: ${item.reason}`).join(' | ');
        resultEl.textContent = `Synced ${synced}/${records.length} rows to tbl_employee. Skipped ${skippedAll.length}.${skipPreview ? ` ${skipPreview}` : ''}`;
        alert(`User sync complete. Synced ${synced} employee account(s), skipped ${skippedAll.length}.`);
    } catch (err) {
        console.error('XLSX sync failed:', err);
        resultEl.textContent = `Sync failed: ${err.message || err}`;
        alert(`Sync failed: ${err.message || err}`);
    } finally {
        button.disabled = false;
    }
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
            : (hasExplicitModuleOverride(editing)
                ? normalizeModuleList(editing?.allowed_modules)
                : getRoleDefaultModules(normalizedRole));
        const allowedModulesConfigured = isAdmin
            ? !moduleListsEqual(allowedModules, getRoleDefaultModules(normalizedRole))
            : hasExplicitModuleOverride(editing);

        const docId = SETTINGS_STATE.editingDocId || (staff_id ? String(staff_id) : '');
        if (!docId) {
            alert('Select an employee first (Staff ID is required).');
            return;
        }

        const targetEmployee = SETTINGS_STATE.employees.find((emp) => String(emp.id || '') === String(docId));
        if (!targetEmployee) {
            alert('Selected employee does not exist in tbl_employee.');
            return;
        }

        const baseFields = {
            email,
            marga_login_email: email,
            marga_fullname: name || `${String(targetEmployee.firstname || '').trim()} ${String(targetEmployee.lastname || '').trim()}`.trim(),
            marga_role: normalizedRole,
            marga_account_active: active,
            marga_allowed_modules: allowedModules,
            allowed_modules_configured: allowedModulesConfigured,
            marga_updated_at: new Date().toISOString()
        };

        if (!SETTINGS_STATE.editingDocId) {
            if (!password) {
                alert('Temporary password is required for new users.');
                return;
            }
            const hashed = await hashPassword(password);
            await patchDocument('tbl_employee', docId, { ...baseFields, ...hashed, marga_password_updated_at: new Date().toISOString() });
        } else {
            // Update existing. If password provided, reset it.
            if (password) {
                const hashed = await hashPassword(password);
                await patchDocument('tbl_employee', docId, { ...baseFields, ...hashed, marga_password_updated_at: new Date().toISOString() });
            } else {
                await patchDocument('tbl_employee', docId, baseFields);
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
        await patchDocument('tbl_employee', docId, { ...hashed, marga_password_updated_at: new Date().toISOString(), marga_updated_at: new Date().toISOString() });
        alert('Password reset.');
    } catch (err) {
        console.error('Reset password failed:', err);
        alert(`Failed to reset password: ${err.message || err}`);
    }
}
