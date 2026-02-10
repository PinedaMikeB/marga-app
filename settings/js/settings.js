if (!MargaAuth.requireAccess('settings')) {
    throw new Error('Unauthorized access to settings module.');
}

const SETTINGS_STATE = {
    users: [],
    filtered: [],
    editingDocId: null
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    }

    document.getElementById('refreshUsersBtn').addEventListener('click', () => loadUsers());
    document.getElementById('userSearch').addEventListener('input', () => applyUserFilter());
    document.getElementById('newUserBtn').addEventListener('click', () => openUserModal(null));

    document.getElementById('userModalOverlay').addEventListener('click', closeUserModal);
    document.getElementById('userModalCloseBtn').addEventListener('click', closeUserModal);
    document.getElementById('userModalCancelBtn').addEventListener('click', closeUserModal);
    document.getElementById('userModalSaveBtn').addEventListener('click', () => saveUser());

    loadUsers();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function sanitize(text) {
    return MargaUtils.escapeHtml(String(text ?? ''));
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
    SETTINGS_STATE.filtered = q
        ? SETTINGS_STATE.users.filter((u) =>
            String(u.email || '').toLowerCase().includes(q) ||
            String(u.name || '').toLowerCase().includes(q) ||
            String(u.role || '').toLowerCase().includes(q) ||
            String(u.staff_id || '').includes(q)
        )
        : [...SETTINGS_STATE.users];
    renderUsers();
}

function renderUsers() {
    const tbody = document.querySelector('#usersTable tbody');
    const rows = SETTINGS_STATE.filtered;
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
        return `
            <tr>
                <td data-label="Email">${sanitize(u.email || u.username || u._docId || '-')}</td>
                <td data-label="Name">${sanitize(u.name || '-')}</td>
                <td data-label="Role"><span class="ops-role-badge ${sanitize(roleClass(u.role))}">${sanitize(u.role || 'viewer')}</span></td>
                <td data-label="Staff ID">${sanitize(u.staff_id || '-')}</td>
                <td data-label="Status"><span class="status-pill ${active ? 'active' : 'inactive'}">${active ? 'Active' : 'Inactive'}</span></td>
                <td data-label="Action" class="settings-row-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${sanitize(u._docId)}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="reset" data-id="${sanitize(u._docId)}">Reset Password</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (!id) return;
            if (action === 'edit') {
                openUserModal(id);
                return;
            }
            if (action === 'reset') {
                const next = prompt('Set new temporary password:');
                if (next === null) return;
                await resetPassword(id, next);
            }
        });
    });
}

async function loadUsers() {
    document.querySelector('#usersTable tbody').innerHTML = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';
    document.getElementById('usersMeta').textContent = 'Loading users from Firestore...';

    try {
        const docs = await runQuery({
            from: [{ collectionId: 'marga_users' }],
            orderBy: [{ field: { fieldPath: 'email' }, direction: 'ASCENDING' }],
            limit: 2000
        });
        const users = docs.map(parseFirestoreDoc).filter(Boolean);
        SETTINGS_STATE.users = users;
        SETTINGS_STATE.filtered = [...users];
        document.getElementById('usersMeta').textContent = `${users.length} user(s) loaded.`;
        applyUserFilter();
    } catch (err) {
        console.error('Load users failed:', err);
        document.getElementById('usersMeta').textContent = `Error: ${err.message || err}`;
        document.querySelector('#usersTable tbody').innerHTML = '<tr><td colspan="6" class="loading-cell">Unable to load users.</td></tr>';
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

    try {
        const email = String(document.getElementById('userEmail').value || '').trim().toLowerCase();
        const name = String(document.getElementById('userNameInput').value || '').trim();
        const role = String(document.getElementById('userRoleInput').value || 'viewer').trim();
        const staffIdRaw = String(document.getElementById('userStaffId').value || '').trim();
        const staff_id = staffIdRaw ? Number(staffIdRaw) : null;
        const password = String(document.getElementById('userPassword').value || '');
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
        await loadUsers();
        alert('User saved.');
    } catch (err) {
        console.error('Save user failed:', err);
        alert(`Failed to save user: ${err.message || err}`);
    } finally {
        saveBtn.disabled = false;
    }
}

async function resetPassword(docId, newPassword) {
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
