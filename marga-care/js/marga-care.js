(function () {
    const state = {
        rows: [],
        summary: null,
        generatedAt: ''
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!MargaAuth.requireAccess('marga-care')) return;
        renderUser();
        bindEvents();
        loadCareRows();
    });

    function bindEvents() {
        document.getElementById('refreshCareBtn')?.addEventListener('click', loadCareRows);
        document.getElementById('companySearch')?.addEventListener('input', debounce(renderRows, 160));
        document.getElementById('typeFilter')?.addEventListener('change', renderRows);
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
            const response = await fetch('/api/marga-care?refresh_cache=true', { credentials: 'include' });
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
                <td>${escapeHtml(row.action)}</td>
            </tr>
        `).join('');
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
}());
