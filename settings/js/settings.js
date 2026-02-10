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

    document.getElementById('employeeModalOverlay').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCloseBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalCancelBtn').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModalSaveBtn').addEventListener('click', () => saveEmployee());

    // Ensure admin-only password fields are hidden for HR/non-admin.
    document.getElementById('userPasswordField').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('employeePasswordField').style.display = isAdmin ? 'flex' : 'none';

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
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
    return { stringValue: String(value ?? '') };
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

    const editing = docId ? SETTINGS_STATE.users.find((u) => u._docId === docId) : null;
    title.textContent = editing ? 'Edit User' : 'New User';

    emailInput.value = editing?.email || '';
    nameInput.value = editing?.name || '';
    roleInput.value = editing?.role || 'viewer';
    staffInput.value = editing?.staff_id || '';
    passInput.value = '';
    activeInput.value = (editing?.active === false) ? 'false' : 'true';

    // Email is the key for docId. Editing email is not supported yet.
    emailInput.disabled = Boolean(editing);

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
        const roleGuess = getRoleGuess(e, positionName);
        const active = e.marga_active !== false;
        const linked = SETTINGS_STATE.userByStaffId.get(String(e.id || '')) || null;
        return `
            <tr>
                <td data-label="ID">${empId}</td>
                <td data-label="Name">${sanitize(getEmployeeDisplayName(e))}</td>
                <td data-label="Position">${sanitize(positionName || '-')}</td>
                <td data-label="Role"><span class="ops-role-badge ${roleGuess === 'Technician' ? 'role-tech' : roleGuess === 'Messenger' ? 'role-messenger' : 'role-unknown'}">${sanitize(roleGuess)}</span></td>
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
    const roleGuess = getRoleGuess(emp, positionName);

    document.getElementById('employeeModalTitle').textContent = `${getEmployeeDisplayName(emp)} (${emp.id})`;
    document.getElementById('employeeId').value = String(emp.id || '');
    document.getElementById('employeePosition').value = positionName || '-';
    document.getElementById('employeeNickname').value = String(emp.nickname || '').trim();
    document.getElementById('employeeContact').value = String(emp.contact_number || '').trim();
    document.getElementById('employeeFullName').value = `${String(emp.firstname || '').trim()} ${String(emp.lastname || '').trim()}`.trim();

    const empActive = emp.marga_active !== false;
    document.getElementById('employeeActive').value = empActive ? 'true' : 'false';

    document.getElementById('employeeEmail').value = String(linked?.email || '').trim();
    document.getElementById('employeeRole').value = String(linked?.role || roleGuessToUserRole(roleGuess) || 'viewer').toLowerCase();
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
        await patchDocument('tbl_employee', employeeId, { marga_active: empActive });

        const email = String(document.getElementById('employeeEmail').value || '').trim().toLowerCase();
        const role = String(document.getElementById('employeeRole').value || 'viewer').trim();
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

        const docId = SETTINGS_STATE.editingDocId || email;

        const baseFields = {
            email,
            username: email,
            name,
            role,
            active,
            staff_id: staff_id || null,
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
