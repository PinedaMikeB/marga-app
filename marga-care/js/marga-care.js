(function () {
    const state = {
        rows: [],
        summary: null,
        generatedAt: '',
        apiBase: '/api/marga-care',
        writeEnabled: true,
        readOnlyFallback: false,
        template: [
            'Subject: Welcome to Marga Managed Care - Your Service Access Is Ready',
            '',
            'Hi {{main_contact}},',
            '',
            'In view of our continuous improvement in serving our customers, we are pleased to inform you that your company now has access to Marga Managed Care, our dedicated customer care system designed to make service requests faster, machine monitoring clearer, and communication with our team easier.',
            '',
            'Through Marga Managed Care, your team can:',
            '',
            'View your active machines and assigned branches or departments.',
            'Submit toner or ink requests without waiting for manual follow-up.',
            'Create repair and service requests.',
            'Monitor open tickets and request status.',
            'Use 24/7 chat support for urgent concerns.',
            'Start a secure audio call when real-time assistance is needed.',
            'Allow authorized branches or departments to submit requests using their assigned credentials.',
            '',
            'Access Link: https://care.marga.biz',
            'Company: {{company_name}}',
            'Admin Email: {{email}}',
            'Admin Temporary Password: {{admin_password}}',
            '',
            'Branch / Department: {{branch_department}}',
            'Machine Serial: {{serial_number}}',
            'Branch Temporary Password: {{branch_password}}',
            '',
            'To get started:',
            '',
            'Open https://care.marga.biz.',
            'Sign in using the admin email and temporary password above.',
            'Review your company, branch, and machine details.',
            'Share the branch password only with authorized branch or department users.',
            'Use Marga Managed Care for toner, ink, repair requests, chat support, and audio assistance.',
            '',
            'This is part of our ongoing service improvement program to help your team reach us faster, reduce delays, and track requests more clearly.',
            '',
            'Thank you for trusting Marga Enterprises. We look forward to serving you better through Marga Managed Care.',
            '',
            'Best regards,',
            'Marga Managed Care Team',
            'Marga Enterprises'
        ].join('\n')
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!MargaAuth.requireAccess('marga-care')) return;
        renderUser();
        bindEvents();
        renderTemplate();
        loadCareRows();
    });

    function bindEvents() {
        document.getElementById('refreshCareBtn')?.addEventListener('click', refreshCareRows);
        document.getElementById('companySearch')?.addEventListener('input', debounce(renderRows, 160));
        document.getElementById('typeFilter')?.addEventListener('change', renderRows);
        document.getElementById('toggleTemplateBtn')?.addEventListener('click', toggleTemplate);
        document.getElementById('copyTemplateBtn')?.addEventListener('click', copyTemplate);
        document.getElementById('closePreviewBtn')?.addEventListener('click', () => {
            document.getElementById('emailPreviewPanel').hidden = true;
        });
    }

    function renderUser() {
        const user = MargaAuth.getUser();
        if (!user) return;
        document.getElementById('userName').textContent = user.name || user.username || 'Admin';
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = (user.name || user.username || 'A').charAt(0).toUpperCase();
    }

    window.toggleSidebar = function toggleSidebar() {
        document.getElementById('sidebar')?.classList.toggle('open');
    };

    async function loadCareRows() {
        const tbody = document.getElementById('careRows');
        tbody.innerHTML = '<tr><td colspan="11">Loading active clients and generating credentials...</td></tr>';
        setBackendStatus('checking', 'Checking backend');
        try {
            const response = await fetch(`${state.apiBase}?refresh_cache=true`, { credentials: 'include' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) throw new Error(data.message || `Request failed: ${response.status}`);
            state.rows = data.rows || [];
            state.summary = data.summary || {};
            state.generatedAt = data.generated_at || '';
            setBackendStatus(
                state.writeEnabled ? 'online' : 'offline',
                state.writeEnabled ? 'Backend + database connected' : 'Read-only fallback - saves disabled'
            );
            renderRows();
        } catch (error) {
            if (state.apiBase === '/api/marga-care') {
                state.apiBase = '/.netlify/functions/marga-care';
                state.writeEnabled = false;
                state.readOnlyFallback = true;
                return loadCareRows();
            }
            setBackendStatus('offline', 'Backend disconnected');
            tbody.innerHTML = `<tr><td colspan="11"><div class="care-alert">${escapeHtml(error.message || 'Unable to load Marga Care rows.')}</div></td></tr>`;
            document.getElementById('companyListMeta').textContent = 'Unable to load active clients';
        }
    }

    function refreshCareRows() {
        state.apiBase = '/api/marga-care';
        state.writeEnabled = true;
        state.readOnlyFallback = false;
        return loadCareRows();
    }

    function filteredRows() {
        const q = String(document.getElementById('companySearch')?.value || '').trim().toLowerCase();
        const type = document.getElementById('typeFilter')?.value || 'all';
        return state.rows.filter((rawRow) => {
            const row = rawRow;
            const haystack = [
                row.company_name,
                row.branch_department,
                row.serial_number,
                row.type,
                row.main_contact,
                row.email,
                row.branch_contact,
                row.status
            ].join(' ').toLowerCase();
            const matchesSearch = !q || haystack.includes(q);
            const matchesType = type === 'all'
                || row.type_code === type
                || (type === 'needs-email' && !row.email);
            return matchesSearch && matchesType;
        });
    }

    function renderRows() {
        const rows = filteredRows();
        const tbody = document.getElementById('careRows');
        const generated = state.generatedAt ? new Date(state.generatedAt).toLocaleString() : 'now';
        document.getElementById('companyListMeta').textContent = `${formatNumber(rows.length)} shown of ${formatNumber(state.rows.length)} active machine rows · generated ${generated}`;

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="11">No rows match the current filter.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map((rawRow) => {
            const row = rawRow;
            return `
            <tr>
                <td>
                    <strong>${escapeHtml(row.company_name)}</strong>
                    <span class="care-table-sub">Company ID ${escapeHtml(row.company_id)}</span>
                </td>
                <td>
                    ${escapeHtml(row.branch_department || row.branch_name)}
                    ${row.billing_group ? `<span class="care-table-sub">${escapeHtml(row.billing_group)}</span>` : ''}
                </td>
                <td>${escapeHtml(row.serial_number || 'N/A')}</td>
                <td>
                    <select class="care-type-select ${row.type_code === 'group' ? 'is-group' : 'is-individual'}" data-row-id="${escapeAttr(row.row_id)}">
                        <option value="group" ${row.type_code === 'group' ? 'selected' : ''}>Group Machine</option>
                        <option value="individual" ${row.type_code === 'individual' ? 'selected' : ''}>Individual Machine</option>
                    </select>
                    <span class="care-table-sub">${escapeHtml(row.classification_reason)}</span>
                </td>
                <td><input class="care-cell-input" data-field="main_contact" data-row-id="${escapeAttr(row.row_id)}" value="${escapeAttr(row.main_contact || '')}" placeholder="For confirmation"></td>
                <td><input class="care-cell-input ${row.email ? '' : 'care-missing-input'}" data-field="email" data-row-id="${escapeAttr(row.row_id)}" value="${escapeAttr(row.email || '')}" placeholder="Needs email"></td>
                <td><input class="care-cell-input is-password" data-field="admin_password" data-row-id="${escapeAttr(row.row_id)}" value="${escapeAttr(row.admin_password || '')}"></td>
                <td>
                    <input class="care-cell-input" data-field="branch_contact" data-row-id="${escapeAttr(row.row_id)}" value="${escapeAttr(row.branch_contact || '')}" placeholder="For confirmation">
                    ${row.branch_phone ? `<span class="care-table-sub">${escapeHtml(row.branch_phone)}</span>` : ''}
                </td>
                <td><input class="care-cell-input is-password" data-field="branch_password" data-row-id="${escapeAttr(row.row_id)}" value="${escapeAttr(row.branch_password || '')}"></td>
                <td>
                    <select class="care-status-select" data-row-id="${escapeAttr(row.row_id)}">
                        ${['Preparing', 'Onboarding', 'Connected'].map((status) => `<option value="${status}" ${row.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                    </select>
                </td>
                <td>${renderActionButtons(row)}</td>
            </tr>
        `;
        }).join('');
        tbody.querySelectorAll('.care-status-select').forEach((select) => {
            select.addEventListener('change', () => updateRowOverride(select.dataset.rowId, { status: select.value }, false));
        });
        tbody.querySelectorAll('.care-type-select').forEach((select) => {
            select.addEventListener('change', () => {
                const typeCode = select.value;
                updateRowOverride(select.dataset.rowId, {
                    type_code: typeCode,
                    type: typeCode === 'group' ? 'Group Machine' : 'Individual Machine',
                    classification_reason: typeCode === 'group'
                        ? 'One invoice covering multiple branches / machines'
                        : 'Single company, branch, or department account billed separately'
                }, true);
            });
        });
        tbody.querySelectorAll('.care-cell-input').forEach((input) => {
            input.addEventListener('change', () => updateRowOverride(input.dataset.rowId, { [input.dataset.field]: input.value.trim() }, false));
        });
        tbody.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => handleAction(button.dataset.action, button.dataset.rowId));
        });
    }

    function renderActionButtons(row) {
        return `
            <div class="care-action-stack">
                <button type="button" class="care-action-btn is-save" data-action="save" data-row-id="${escapeAttr(row.row_id)}">Save</button>
                <button type="button" class="care-action-btn" data-action="edit" data-row-id="${escapeAttr(row.row_id)}">Edit</button>
                <button type="button" class="care-action-btn" data-action="main-pw" data-row-id="${escapeAttr(row.row_id)}">Generate PW Main</button>
                <button type="button" class="care-action-btn" data-action="branch-pw" data-row-id="${escapeAttr(row.row_id)}">Generate PW Branch</button>
                <button type="button" class="care-action-btn is-send" data-action="send" data-row-id="${escapeAttr(row.row_id)}" ${row.email ? '' : 'disabled'}>Send Email</button>
            </div>
        `;
    }

    function handleAction(action, rowId) {
        const row = state.rows.find((item) => String(item.row_id) === String(rowId));
        if (!row) return;
        if (action === 'save') return saveRow(rowId);
        if (action === 'edit') return editRow(row);
        if (action === 'main-pw') return generatePassword(rowId, 'admin_password');
        if (action === 'branch-pw') return generatePassword(rowId, 'branch_password');
        if (action === 'send') return previewRowEmail(rowId);
    }

    function saveRow(rowId) {
        const row = state.rows.find((item) => String(item.row_id) === String(rowId));
        if (!row) return Promise.resolve();
        return saveRowPatch(rowId, {
            main_contact: row.main_contact || '',
            email: row.email || '',
            admin_password: row.admin_password || '',
            branch_contact: row.branch_contact || '',
            branch_password: row.branch_password || '',
            status: row.status || 'Preparing',
            type_code: row.type_code || 'individual'
        })
            .then(() => pulseRow(rowId, 'Saved'))
            .catch(showSaveError);
    }

    function editRow(row) {
        const mainContact = window.prompt('Main contact', row.main_contact || '');
        if (mainContact === null) return;
        const email = window.prompt('Email', row.email || '');
        if (email === null) return;
        const branchContact = window.prompt('Branch contact', row.branch_contact || '');
        if (branchContact === null) return;
        updateRowOverride(row.row_id, {
            main_contact: mainContact.trim(),
            email: email.trim(),
            branch_contact: branchContact.trim()
        }, true);
    }

    function generatePassword(rowId, field) {
        updateRowOverride(rowId, { [field]: randomPassword() }, true);
    }

    function updateRowOverride(rowId, patch, rerender) {
        const row = state.rows.find((item) => String(item.row_id) === String(rowId));
        const previous = {};
        if (row) {
            Object.keys(patch).forEach((key) => { previous[key] = row[key]; });
        }
        if (row) Object.assign(row, patch);
        saveRowPatch(rowId, patch).catch((error) => {
            if (row) Object.assign(row, previous);
            renderRows();
            showSaveError(error);
        });
        if (rerender) renderRows();
    }

    function randomPassword() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    async function saveRowPatch(rowId, patch) {
        if (!state.writeEnabled) {
            throw new Error('Margabase save route is not connected. Restart the local Margabase proxy or route /api/marga-care to Margabase.');
        }
        const user = MargaAuth.getUser?.() || {};
        const response = await fetch(state.apiBase, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                row_id: rowId,
                updated_by: user.name || user.email || 'Marga Staff',
                ...patch
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 405) {
            throw new Error('Save reached a read-only route. /api/marga-care must be served by the Margabase local proxy.');
        }
        if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `Save failed: ${response.status}`);
        return data;
    }

    function showSaveError(error) {
        window.alert(error.message || 'Unable to save row to Margabase.');
    }

    function pulseRow(rowId, text) {
        const button = Array.from(document.querySelectorAll('[data-action="save"]'))
            .find((item) => String(item.dataset.rowId) === String(rowId));
        if (!button) return;
        const oldText = button.textContent;
        button.textContent = text;
        window.setTimeout(() => { button.textContent = oldText; }, 1200);
    }

    function renderTemplate() {
        const target = document.getElementById('emailTemplateText');
        if (target) target.value = state.template;
    }

    function toggleTemplate() {
        const panel = document.getElementById('templatePanel');
        const button = document.getElementById('toggleTemplateBtn');
        if (!panel || !button) return;
        const collapsed = panel.classList.toggle('is-collapsed');
        button.textContent = collapsed ? 'Show Template' : 'Hide Template';
    }

    async function copyTemplate() {
        try {
            await navigator.clipboard.writeText(state.template);
            const button = document.getElementById('copyTemplateBtn');
            if (!button) return;
            const oldText = button.textContent;
            button.textContent = 'Copied';
            window.setTimeout(() => { button.textContent = oldText; }, 1400);
        } catch {
            window.alert('Unable to copy template from this browser.');
        }
    }

    function previewRowEmail(rowId) {
        const row = state.rows.find((item) => String(item.row_id) === String(rowId));
        if (!row) return;
        const preview = fillTemplate(row);
        document.getElementById('emailPreviewPanel').hidden = false;
        document.getElementById('emailPreviewTitle').textContent = `Email Preview - ${row.company_name}`;
        document.getElementById('emailPreviewMeta').textContent = `To: ${row.email}`;
        document.getElementById('emailPreviewText').textContent = preview;
        document.getElementById('emailPreviewPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function fillTemplate(row) {
        return state.template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
            const value = row[key];
            return value === null || value === undefined || value === '' ? 'For confirmation' : String(value);
        });
    }

    function debounce(fn, delay) {
        let timer = null;
        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), delay);
        };
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('en-US').format(Number(value || 0));
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function setBackendStatus(status, label) {
        const el = document.getElementById('careBackendStatus');
        if (!el) return;
        el.dataset.status = status;
        el.querySelector('strong').textContent = label;
    }
}());
