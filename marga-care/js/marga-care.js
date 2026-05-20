(function () {
    const state = {
        rows: [],
        summary: null,
        generatedAt: '',
        template: [
            'Subject: Welcome to Marga Care - your service portal is ready',
            '',
            'Hi {{main_contact}},',
            '',
            'Good news: Marga has improved the way we support your machines. Your company now has access to Marga Care, a dedicated service portal for faster requests, clearer machine visibility, and easier coordination with our team.',
            '',
            'What you can do in Marga Care:',
            '- View your active machines and assigned branches/departments.',
            '- Send toner/ink requests without waiting for a manual follow-up.',
            '- Create repair/service requests and monitor open tickets.',
            '- Use 24/7 chat support for urgent concerns.',
            '- Start an audio call through secure WebRTC when real-time assistance is needed.',
            '- Help your branches submit requests using their assigned branch credentials.',
            '',
            'Portal: https://care.marga.biz',
            'Company: {{company_name}}',
            'Admin email: {{email}}',
            'Admin temporary password: {{admin_password}}',
            '',
            'Branch / Department: {{branch_department}}',
            'Machine Serial: {{serial_number}}',
            'Branch temporary password: {{branch_password}}',
            '',
            'Instructions:',
            '1. Open https://care.marga.biz.',
            '2. Sign in using the admin email and temporary password above.',
            '3. Review your company, branch, and machine details.',
            '4. Share the branch password only with authorized branch or department users.',
            '5. Use Marga Care for toner/ink, repair requests, chat, and audio support.',
            '',
            'This portal is part of our service improvement program so your team can reach us faster and track requests more clearly.',
            '',
            'Thank you,',
            'Marga Care Team'
        ].join('\\n')
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!MargaAuth.requireAccess('marga-care')) return;
        renderUser();
        bindEvents();
        renderTemplate();
        loadCareRows();
    });

    function bindEvents() {
        document.getElementById('refreshCareBtn')?.addEventListener('click', loadCareRows);
        document.getElementById('companySearch')?.addEventListener('input', debounce(renderRows, 160));
        document.getElementById('typeFilter')?.addEventListener('change', renderRows);
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
        try {
            const response = await fetch('/.netlify/functions/marga-care?refresh_cache=true', { credentials: 'include' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) throw new Error(data.message || `Request failed: ${response.status}`);
            state.rows = data.rows || [];
            state.summary = data.summary || {};
            state.generatedAt = data.generated_at || '';
            renderStats();
            renderRows();
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="11"><div class="care-alert">${escapeHtml(error.message || 'Unable to load Marga Care rows.')}</div></td></tr>`;
            document.getElementById('companyListMeta').textContent = 'Unable to load active clients';
        }
    }

    function renderStats() {
        const summary = state.summary || {};
        document.getElementById('statCompanies').textContent = formatNumber(summary.portal_companies || 0);
        document.getElementById('statRepresentatives').textContent = formatNumber(summary.representative_logins || 0);
        document.getElementById('statGroupMachines').textContent = formatNumber(summary.group_machines || 0);
        document.getElementById('statIndividualMachines').textContent = formatNumber(summary.individual_machines || 0);
    }

    function filteredRows() {
        const q = String(document.getElementById('companySearch')?.value || '').trim().toLowerCase();
        const type = document.getElementById('typeFilter')?.value || 'all';
        return state.rows.filter((row) => {
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

        tbody.innerHTML = rows.map((row) => `
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
                    <span class="care-type-pill ${row.type_code === 'group' ? 'is-group' : 'is-individual'}">${escapeHtml(row.type)}</span>
                    <span class="care-table-sub">${escapeHtml(row.classification_reason)}</span>
                </td>
                <td>${escapeHtml(row.main_contact || 'For confirmation')}</td>
                <td class="${row.email ? '' : 'care-missing'}">${escapeHtml(row.email || 'Needs email')}</td>
                <td><code>${escapeHtml(row.admin_password)}</code></td>
                <td>
                    ${escapeHtml(row.branch_contact || 'For confirmation')}
                    ${row.branch_phone ? `<span class="care-table-sub">${escapeHtml(row.branch_phone)}</span>` : ''}
                </td>
                <td><code>${escapeHtml(row.branch_password)}</code></td>
                <td><span class="care-status ${row.email ? 'is-preparing' : 'is-missing'}">${escapeHtml(row.status)}</span></td>
                <td>
                    <button type="button" class="care-send-btn" data-row-id="${escapeAttr(row.row_id)}" ${row.email ? '' : 'disabled'}>
                        Send Email
                    </button>
                    <span class="care-table-sub">${escapeHtml(row.email ? 'Preview first, send after approval' : 'Email required')}</span>
                </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.care-send-btn').forEach((button) => {
            button.addEventListener('click', () => previewRowEmail(button.dataset.rowId));
        });
    }

    function renderTemplate() {
        const target = document.getElementById('emailTemplateText');
        if (target) target.value = state.template;
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
}());
