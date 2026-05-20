(function () {
    const state = {
        companies: [],
        selectedCompanyId: null,
        selectedCompany: null,
        lastPassword: ''
    };

    const portalTypeLabels = {
        mixed: 'Group + Individual',
        group_only: 'Group Machines Only',
        individual_only: 'Individual Machines Only',
        single_machine: 'Single Machine'
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (!MargaAuth.requireAccess('marga-care')) return;
        renderUser();
        bindEvents();
        loadCompanies();
    });

    function bindEvents() {
        document.getElementById('refreshCareBtn')?.addEventListener('click', loadCompanies);
        document.getElementById('companySearch')?.addEventListener('input', debounce(loadCompanies, 250));
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

    async function api(path, options = {}) {
        const response = await fetch(path, {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
            throw new Error(data.message || `Request failed: ${response.status}`);
        }
        return data;
    }

    async function loadCompanies() {
        const search = document.getElementById('companySearch')?.value || '';
        setListLoading();
        try {
            const data = await api(`/portal-api/admin/care/companies?q=${encodeURIComponent(search)}`);
            state.companies = data.companies || [];
            renderStats();
            renderCompanyList();
            if (state.selectedCompanyId && state.companies.some((company) => String(company.id) === String(state.selectedCompanyId))) {
                await selectCompany(state.selectedCompanyId, false);
            }
        } catch (error) {
            renderApiError(error);
        }
    }

    function setListLoading() {
        const list = document.getElementById('companyList');
        if (list) list.innerHTML = '<div class="care-empty"><strong>Loading</strong><span>Reading active customer records...</span></div>';
    }

    function renderApiError(error) {
        document.getElementById('companyList').innerHTML = '';
        document.getElementById('companyListMeta').textContent = 'Backend unavailable';
        document.getElementById('careDetail').innerHTML = `
            <div class="care-detail-inner">
                <div class="care-alert">${escapeHtml(error.message || 'Marga Care backend is not available on this host yet.')}</div>
            </div>
        `;
    }

    function renderStats() {
        const companies = state.companies;
        const reps = companies.filter((company) => company.representativeAccount).length;
        const groupMachines = companies.reduce((sum, company) => sum + Number(company.activeGroupMachines || 0), 0);
        const individualMachines = companies.reduce((sum, company) => sum + Number(company.activeIndividualMachines || 0), 0);
        document.getElementById('statCompanies').textContent = formatNumber(companies.length);
        document.getElementById('statRepresentatives').textContent = formatNumber(reps);
        document.getElementById('statGroupMachines').textContent = formatNumber(groupMachines);
        document.getElementById('statIndividualMachines').textContent = formatNumber(individualMachines);
        document.getElementById('companyListMeta').textContent = `${formatNumber(companies.length)} active customer records`;
    }

    function renderCompanyList() {
        const list = document.getElementById('companyList');
        if (!state.companies.length) {
            list.innerHTML = '<div class="care-empty"><strong>No companies found</strong><span>Try another search term.</span></div>';
            return;
        }
        list.innerHTML = state.companies.map((company) => `
            <button type="button" class="care-company-button ${String(company.id) === String(state.selectedCompanyId) ? 'active' : ''}" data-company-id="${company.id}">
                <span class="care-company-name">${escapeHtml(company.name)}</span>
                <span class="care-company-sub">
                    <span>${escapeHtml(portalTypeLabels[company.portalType] || company.portalType)}</span>
                    <span>${formatNumber(company.activeDevices)} machines</span>
                    ${company.representativeAccount ? '<span>login ready</span>' : '<span>no login</span>'}
                </span>
            </button>
        `).join('');
        list.querySelectorAll('[data-company-id]').forEach((button) => {
            button.addEventListener('click', () => selectCompany(button.dataset.companyId));
        });
    }

    async function selectCompany(companyId, showLoading = true) {
        state.selectedCompanyId = companyId;
        state.lastPassword = '';
        renderCompanyList();
        if (showLoading) {
            document.getElementById('careDetail').innerHTML = '<div class="care-empty"><strong>Loading</strong><span>Opening company profile...</span></div>';
        }
        try {
            const data = await api(`/portal-api/admin/care/companies/${companyId}`);
            state.selectedCompany = data.company;
            renderCompanyDetail();
        } catch (error) {
            document.getElementById('careDetail').innerHTML = `<div class="care-detail-inner"><div class="care-alert">${escapeHtml(error.message)}</div></div>`;
        }
    }

    function renderCompanyDetail() {
        const company = state.selectedCompany;
        if (!company) return;
        const repName = company.representativeName || company.defaults?.representativeName || '';
        const repEmail = company.representativeEmail || company.defaults?.representativeEmail || '';
        const repPhone = company.representativePhone || company.defaults?.representativePhone || '';
        const representativeAccount = company.accounts?.find((account) => account.role === 'company_representative') || company.accounts?.[0] || null;
        document.getElementById('careDetail').innerHTML = `
            <div class="care-detail-inner">
                <div class="care-detail-title">
                    <div>
                        <h2>${escapeHtml(company.name)}</h2>
                        <p>${escapeHtml(portalTypeLabels[company.portalType] || company.portalType)} portal setup</p>
                    </div>
                    <span class="care-pill">${company.active ? 'Active' : 'Inactive'}</span>
                </div>

                <div class="care-overview-grid">
                    <div class="care-overview-card"><span>Active Group Machines</span><strong>${formatNumber(company.activeGroupMachines)}</strong></div>
                    <div class="care-overview-card"><span>Active Individual Machines</span><strong>${formatNumber(company.activeIndividualMachines)}</strong></div>
                    <div class="care-overview-card"><span>Branches</span><strong>${formatNumber(company.activeBranches)}</strong></div>
                </div>

                <div class="care-form-grid">
                    <label class="care-field">
                        <span>Portal Type</span>
                        <select id="portalTypeInput">
                            ${Object.entries(portalTypeLabels).map(([value, label]) => `<option value="${value}" ${company.portalType === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </label>
                    <label class="care-field">
                        <span>Representative Email</span>
                        <input id="repEmailInput" type="email" value="${escapeAttr(repEmail)}" placeholder="representative@company.com">
                    </label>
                    <label class="care-field">
                        <span>Representative Name</span>
                        <input id="repNameInput" value="${escapeAttr(repName)}" placeholder="Main contact person">
                    </label>
                    <label class="care-field">
                        <span>Representative Number</span>
                        <input id="repPhoneInput" value="${escapeAttr(repPhone)}" placeholder="Mobile or landline">
                    </label>
                    <label class="care-field care-field-full">
                        <span>Internal Notes</span>
                        <textarea id="careNotesInput" rows="3" placeholder="Access instructions, branch rules, billing setup">${escapeHtml(company.notes || '')}</textarea>
                    </label>
                </div>

                <div class="care-actions">
                    <button type="button" class="btn btn-primary" id="saveProfileBtn">Save Profile</button>
                    <button type="button" class="btn btn-secondary" id="createRepBtn">Create/Update Representative + 6-Digit Password</button>
                    ${representativeAccount ? `<button type="button" class="btn btn-secondary" id="generatePasswordBtn" data-account-id="${representativeAccount.id}">Generate New Password</button>` : ''}
                    ${representativeAccount ? `<button type="button" class="btn btn-secondary" id="emailPreviewBtn" data-account-id="${representativeAccount.id}">Email Credential Preview</button>` : ''}
                </div>

                <div id="credentialOutput"></div>

                <div>
                    <h3 class="care-section-title">Portal Accounts</h3>
                    <div class="care-account-list">${renderAccounts(company.accounts || [])}</div>
                </div>

                <div>
                    <h3 class="care-section-title">Machine Sample</h3>
                    <div class="care-device-list">${renderDevices((company.devices || []).slice(0, 8))}</div>
                </div>
            </div>
        `;
        document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
        document.getElementById('createRepBtn')?.addEventListener('click', createRepresentative);
        document.getElementById('generatePasswordBtn')?.addEventListener('click', generatePassword);
        document.getElementById('emailPreviewBtn')?.addEventListener('click', emailPreview);
    }

    function renderAccounts(accounts) {
        if (!accounts.length) return '<div class="care-muted">No portal accounts yet.</div>';
        return accounts.map((account) => `
            <div class="care-row">
                <div>
                    <strong>${escapeHtml(account.displayName || account.login)}</strong>
                    <div class="care-account-meta">${escapeHtml(account.login)} · ${escapeHtml(account.role)} · ${account.active ? 'active' : 'inactive'}</div>
                </div>
                <span class="care-pill">${account.lastPasswordGeneratedAt ? 'password generated' : 'needs password'}</span>
            </div>
        `).join('');
    }

    function renderDevices(devices) {
        if (!devices.length) return '<div class="care-muted">No active machines found for this company.</div>';
        return devices.map((device) => `
            <div class="care-row">
                <div>
                    <strong>${escapeHtml(device.serial || device.legacy_id || device.id)}</strong>
                    <div class="care-device-meta">${escapeHtml(device.branchName || 'No branch assigned')} · ${escapeHtml(device.model || 'Machine')}</div>
                </div>
            </div>
        `).join('');
    }

    function profilePayload() {
        return {
            companyId: state.selectedCompanyId,
            portalType: document.getElementById('portalTypeInput')?.value || 'mixed',
            representativeName: document.getElementById('repNameInput')?.value || '',
            representativeEmail: document.getElementById('repEmailInput')?.value || '',
            representativePhone: document.getElementById('repPhoneInput')?.value || '',
            notes: document.getElementById('careNotesInput')?.value || '',
            active: true
        };
    }

    async function saveProfile() {
        try {
            await api('/portal-api/admin/care/company-profile', {
                method: 'POST',
                body: JSON.stringify(profilePayload())
            });
            await selectCompany(state.selectedCompanyId);
        } catch (error) {
            showCredentialOutput(`<div class="care-alert">${escapeHtml(error.message)}</div>`);
        }
    }

    async function createRepresentative() {
        try {
            const payload = profilePayload();
            const data = await api('/portal-api/admin/care/representative', {
                method: 'POST',
                body: JSON.stringify({
                    companyId: payload.companyId,
                    portalType: payload.portalType,
                    name: payload.representativeName,
                    email: payload.representativeEmail,
                    phone: payload.representativePhone,
                    notes: payload.notes,
                    generatePassword: true
                })
            });
            state.lastPassword = data.password || '';
            showPassword(data.account, state.lastPassword);
            await loadCompanies();
            await selectCompany(state.selectedCompanyId, false);
            showPassword(data.account, state.lastPassword);
        } catch (error) {
            showCredentialOutput(`<div class="care-alert">${escapeHtml(error.message)}</div>`);
        }
    }

    async function generatePassword(event) {
        try {
            const accountId = event.currentTarget.dataset.accountId;
            const data = await api(`/portal-api/admin/care/accounts/${accountId}/generate-password`, { method: 'POST', body: '{}' });
            state.lastPassword = data.password || '';
            showPassword(data.account, state.lastPassword);
        } catch (error) {
            showCredentialOutput(`<div class="care-alert">${escapeHtml(error.message)}</div>`);
        }
    }

    async function emailPreview(event) {
        try {
            const accountId = event.currentTarget.dataset.accountId;
            const data = await api(`/portal-api/admin/care/accounts/${accountId}/email-preview`, {
                method: 'POST',
                body: JSON.stringify({ password: state.lastPassword })
            });
            showCredentialOutput(`
                <div class="care-email-preview">
                    <div class="care-account-meta">${escapeHtml(data.message || 'Email preview ready.')}</div>
                    <pre>${escapeHtml(`To: ${data.preview.to}\nSubject: ${data.preview.subject}\n\n${data.preview.body}`)}</pre>
                </div>
            `);
        } catch (error) {
            showCredentialOutput(`<div class="care-alert">${escapeHtml(error.message)}</div>`);
        }
    }

    function showPassword(account, password) {
        showCredentialOutput(`
            <div class="care-password-output">
                <div class="care-account-meta">${escapeHtml(account.login)} temporary password</div>
                <div class="care-password-code">${escapeHtml(password)}</div>
                <div class="care-account-meta">This password is visible only now. Use Email Credential Preview before leaving this company.</div>
            </div>
        `);
    }

    function showCredentialOutput(html) {
        const output = document.getElementById('credentialOutput');
        if (output) output.innerHTML = html;
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
