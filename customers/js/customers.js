/**
 * MARGA Customer Management Module
 * Handles customer data display and interactions
 */

// Data storage
let customers = {
    companies: [],
    branches: [],
    contracts: [],
    contractDeps: [],
    machines: [],
    models: [],
    brands: [],
    areas: [],
    cities: [],
    billInfo: []
};

// Pagination
let currentPage = 1;
const itemsPerPage = 25;
let filteredCompanies = [];
let accountRows = [];
let selectedAccountKey = null;
let currentFilter = 'all'; // 'all', 'active', 'inactive'
let recentBilledContractIds = new Set();

const BILLING_ACTIVITY_START_KEY = '2025-10';
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Initialize module
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Setup search with debounce
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', MargaUtils.debounce(handleSearch, 300));
    }

    // Load data
    await loadAllData();
    
    // Initialize customer form module with all reference data
    CustomerForm.init(
        customers.areas, 
        customers.cities, 
        customers.contracts, 
        customers.contractDeps,
        customers.machines, 
        customers.models, 
        customers.brands
    );

    applyDeepLink();
});

/**
 * Load all data from Firebase
 */
async function loadAllData() {
    try {
        showLoading(true);

        // Load all collections in parallel
        const [companies, branches, contracts, contractDeps, machines, models, brands, areas, cities, billInfo, billedContractIds] = 
            await Promise.all([
                MargaUtils.fetchCollection('tbl_companylist'),
                MargaUtils.fetchCollection('tbl_branchinfo'),
                MargaUtils.fetchCollection('tbl_contractmain'),
                MargaUtils.fetchCollection('tbl_contractdep'),
                MargaUtils.fetchCollection('tbl_machine'),
                MargaUtils.fetchCollection('tbl_model'),
                MargaUtils.fetchCollection('tbl_brand'),
                MargaUtils.fetchCollection('tbl_area'),
                MargaUtils.fetchCollection('tbl_city'),
                MargaUtils.fetchCollection('tbl_billinfo'),
                fetchRecentBilledContractIds(BILLING_ACTIVITY_START_KEY, getCurrentMonthKey())
            ]);

        customers = { companies, branches, contracts, contractDeps, machines, models, brands, areas, cities, billInfo };
        recentBilledContractIds = billedContractIds;
        accountRows = buildAccountRows();

        // Update stats
        updateStats();

        // Sort account rows alphabetically and apply initial filter
        filteredCompanies = [...accountRows].sort((a, b) =>
            `${a.companyName || ''} ${a.accountName || ''}`.localeCompare(`${b.companyName || ''} ${b.accountName || ''}`)
        );
        renderTable();

    } catch (error) {
        console.error('Error loading data:', error);
        MargaUtils.showToast('Failed to load customer data', 'error');
    } finally {
        showLoading(false);
    }
}

function applyDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const companyId = String(params.get('company_id') || '').trim();
    const branchId = String(params.get('branch_id') || '').trim();
    const machineId = String(params.get('machine_id') || '').trim();
    const contractmainId = String(params.get('contractmain_id') || '').trim();
    const tab = String(params.get('tab') || '').trim().toLowerCase();
    const account = accountRows.find((entry) => {
        if (branchId && String(entry.branchId || '') === branchId) return true;
        if (machineId && entry.contracts.some((contract) => String(contract.mach_id || '') === machineId)) return true;
        if (contractmainId && entry.contracts.some((contract) => String(contract.id || '') === contractmainId)) return true;
        if (companyId && String(entry.companyId || '') === companyId) return true;
        return false;
    });
    if (!account) return;

    openPanel(account.key);
    if (tab === 'billing' || tab === 'machines' || tab === 'info') {
        switchTab(tab);
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(key, offset) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1 + Number(offset || 0), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthRange(startKey, endKey) {
    const keys = [];
    let current = startKey;
    while (current && current <= endKey) {
        keys.push(current);
        if (current === endKey) break;
        current = shiftMonthKey(current, 1);
    }
    return keys;
}

function monthNameFromKey(key) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return '';
    return MONTH_NAMES[Number(match[2]) - 1] || '';
}

async function runFirestoreQuery(structuredQuery) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) {
        throw new Error(`Failed to query recent billing activity: HTTP ${response.status}`);
    }

    const rows = await response.json();
    return Array.isArray(rows)
        ? rows.filter((row) => row?.document).map((row) => MargaUtils.parseFirestoreDoc(row.document)).filter(Boolean)
        : [];
}

async function fetchRecentBilledContractIds(startKey, endKey) {
    try {
        const monthKeys = buildMonthRange(startKey, endKey);
        if (!monthKeys.length) return new Set();

        const groups = await Promise.all(monthKeys.map((monthKey) => runFirestoreQuery({
            from: [{ collectionId: 'tbl_billing' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        { fieldFilter: { field: { fieldPath: 'year' }, op: 'EQUAL', value: { stringValue: String(monthKey.slice(0, 4)) } } },
                        { fieldFilter: { field: { fieldPath: 'month' }, op: 'EQUAL', value: { stringValue: monthNameFromKey(monthKey) } } }
                    ]
                }
            },
            select: {
                fields: [
                    { fieldPath: 'contractmain_id' }
                ]
            }
        })));

        const contractIds = new Set();
        groups.flat().forEach((doc) => {
            const contractId = String(doc?.contractmain_id || '').trim();
            if (contractId) contractIds.add(contractId);
        });
        return contractIds;
    } catch (error) {
        console.warn('Recent billing activity lookup failed:', error);
        return new Set();
    }
}

function resolveContractDep(contract) {
    return (customers.contractDeps || []).find((entry) => String(entry.id) === String(contract.contract_id)) || null;
}

function resolveContractBranch(contract) {
    const contractDep = resolveContractDep(contract);
    const contractDepBranchId = Number(contractDep?.branch_id || 0) || 0;
    const directBranch = customers.branches.find((entry) => String(entry.id) === String(contract.contract_id)) || null;
    if (contractDepBranchId) {
        return customers.branches.find((entry) => String(entry.id) === String(contractDepBranchId)) || null;
    }
    return directBranch;
}

function buildAccountName(branchName, departmentName = '') {
    const base = String(branchName || 'Main').trim() || 'Main';
    const dept = String(departmentName || '').trim();
    if (!dept) return base;
    if (normalizeText(base).includes(normalizeText(dept))) return base;
    return `${base} - ${dept}`;
}

function buildAccountRows() {
    const companyMap = new Map(customers.companies.map((company) => [String(company.id), company]));
    const branchMap = new Map(customers.branches.map((branch) => [String(branch.id), branch]));
    const machineMap = new Map(customers.machines.map((machine) => [String(machine.id), machine]));
    const modelMap = new Map(customers.models.map((model) => [String(model.id), model]));
    const rows = new Map();
    const rowsByBranch = new Map();

    const ensureRow = ({ company, branch, contractDep, fallbackBranchId = null }) => {
        const companyId = String(company?.id || branch?.company_id || 'unlinked').trim() || 'unlinked';
        const branchId = String(branch?.id || fallbackBranchId || '').trim();
        const departmentName = String(contractDep?.departmentname || '').trim();
        const companyName = String(company?.companyname || branch?.company_name || 'Unlinked in Firebase').trim() || 'Unlinked in Firebase';
        const branchName = String(branch?.branchname || (branchId ? `Unlinked Branch ${branchId}` : 'Unlinked Branch')).trim() || 'Unlinked Branch';
        const accountName = buildAccountName(branchName, departmentName);
        const key = [companyId, branchId || 'unlinked', normalizeText(departmentName || branchName || accountName)].join(':');

        if (!rows.has(key)) {
            rows.set(key, {
                key,
                companyId,
                companyName,
                branchId: branch?.id || fallbackBranchId || null,
                branch,
                company,
                branchName,
                departmentName,
                accountName,
                contracts: [],
                machineEntries: [],
                billInfoRows: [],
                machineCount: 0,
                activeMachineCount: 0,
                recentBilledContractCount: 0,
                isActive: false,
                location: getLocation(branch),
                contactName: branch?.signatory || 'N/A'
            });
        }

        const row = rows.get(key);
        if (branch?.id) {
            const branchKey = String(branch.id);
            if (!rowsByBranch.has(branchKey)) rowsByBranch.set(branchKey, []);
            if (!rowsByBranch.get(branchKey).includes(key)) rowsByBranch.get(branchKey).push(key);
        }
        return row;
    };

    customers.contracts.forEach((contract) => {
        const contractDep = resolveContractDep(contract);
        const branch = resolveContractBranch(contract);
        const company = branch ? companyMap.get(String(branch.company_id)) || null : null;
        const fallbackBranchId = Number(contractDep?.branch_id || 0) || (!branch ? Number(contract.contract_id || 0) || null : null);
        const row = ensureRow({ company, branch, contractDep, fallbackBranchId });

        row.contracts.push(contract);
        const machine = machineMap.get(String(contract.mach_id)) || {};
        const model = modelMap.get(String(machine.model_id)) || null;
        row.machineEntries.push({
            contractId: contract.id,
            machineId: contract.mach_id,
            serial: machine.serial || contract.xserial || 'N/A',
            modelName: model?.modelname || machine.description || 'Unknown Model',
            status: contract.status
        });
        if (recentBilledContractIds.has(String(contract.id || '').trim())) {
            row.recentBilledContractCount += 1;
        }
        if (Number(contract.status || 0) === 1) {
            row.activeMachineCount += 1;
        }
    });

    customers.branches.forEach((branch) => {
        const branchKey = String(branch.id);
        if (rowsByBranch.has(branchKey)) return;
        const company = companyMap.get(String(branch.company_id)) || null;
        ensureRow({ company, branch, contractDep: null, fallbackBranchId: branch.id });
    });

    const billInfoByBranch = new Map();
    customers.billInfo.forEach((billInfo) => {
        const key = String(billInfo.branch_id || '').trim();
        if (!key) return;
        if (!billInfoByBranch.has(key)) billInfoByBranch.set(key, []);
        billInfoByBranch.get(key).push(billInfo);
    });

    return Array.from(rows.values())
        .map((row) => {
            row.machineEntries = row.machineEntries.sort((left, right) => String(left.modelName || '').localeCompare(String(right.modelName || '')));
            row.machineCount = row.machineEntries.length;
            row.isActive = row.activeMachineCount > 0 || row.recentBilledContractCount > 0;
            row.location = getLocation(row.branch);
            row.contactName = row.branch?.signatory || 'N/A';
            row.billInfoRows = row.branchId ? (billInfoByBranch.get(String(row.branchId)) || []) : [];
            return row;
        })
        .sort((left, right) => {
            const companyCompare = String(left.companyName || '').localeCompare(String(right.companyName || ''));
            if (companyCompare !== 0) return companyCompare;
            return String(left.accountName || '').localeCompare(String(right.accountName || ''));
        });
}

/**
 * Update statistics display
 */
function updateStats() {
    MargaUtils.animateNumber('totalCompanies', customers.companies.length);
    MargaUtils.animateNumber('totalBranches', customers.branches.length);
    
    // Count only active machines (status == 1)
    const activeContracts = customers.contracts.filter(c => c.status == 1);
    MargaUtils.animateNumber('activeMachines', activeContracts.length);
    MargaUtils.animateNumber('totalContracts', customers.contracts.length);
    
    // Update filter counts
    updateFilterCounts();
}

/**
 * Update filter button counts
 */
function updateFilterCounts() {
    let activeCount = 0;
    let inactiveCount = 0;

    accountRows.forEach((row) => {
        if (row.isActive) {
            activeCount++;
        } else {
            inactiveCount++;
        }
    });
    
    const countAll = document.getElementById('countAll');
    const countActive = document.getElementById('countActive');
    const countInactive = document.getElementById('countInactive');
    
    if (countAll) countAll.textContent = `(${accountRows.length})`;
    if (countActive) countActive.textContent = `(${activeCount})`;
    if (countInactive) countInactive.textContent = `(${inactiveCount})`;
}

/**
 * Show/hide loading state
 */
function showLoading(show) {
    const tbody = document.getElementById('customerTableBody');
    if (show) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-cell">
                    <div class="spinner"></div>
                    <span>Loading customers...</span>
                </td>
            </tr>
        `;
    }
}

/**
 * Handle search input
 */
function handleSearch(event) {
    const query = event?.target?.value?.toLowerCase().trim() || '';
    applyFilters(query);
}

/**
 * Apply filters (search + status)
 */
function applyFilters(query = '') {
    // Get search query if not provided
    if (!query) {
        query = document.getElementById('searchInput')?.value?.toLowerCase().trim() || '';
    }
    
    // Start with all account rows
    let result = [...accountRows];
    
    // Apply search filter
    if (query) {
        result = result.filter((row) =>
            [
                row.companyName,
                row.accountName,
                row.branchName,
                row.departmentName,
                row.contactName
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(query)
        );
    }
    
    // Apply status filter
    if (currentFilter !== 'all') {
        result = result.filter((row) => {
            if (currentFilter === 'active') return row.isActive;
            if (currentFilter === 'inactive') return !row.isActive;
            return true;
        });
    }
    
    // Sort alphabetically
    result.sort((a, b) => `${a.companyName || ''} ${a.accountName || ''}`.localeCompare(`${b.companyName || ''} ${b.accountName || ''}`));
    
    filteredCompanies = result;
    currentPage = 1;
    renderTable();
}

/**
 * Set status filter
 */
function setFilter(filter) {
    currentFilter = filter;
    
    // Update filter button styles
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
    
    applyFilters();
}

/**
 * Render customer table
 */
function renderTable() {
    const tbody = document.getElementById('customerTableBody');
    
    // Calculate pagination
    const totalPages = Math.ceil(filteredCompanies.length / itemsPerPage);
    const startIdx = (currentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const pageCompanies = filteredCompanies.slice(startIdx, endIdx);

    if (pageCompanies.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-cell">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;">
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                    </svg>
                    <span>No customers found</span>
                </td>
            </tr>
        `;
        updatePaginationInfo(0, 0, 0);
        return;
    }

    tbody.innerHTML = pageCompanies.map((account) => {
        const machineCount = account.machineCount || 0;
        const location = account.location || 'N/A';
        const isActive = Boolean(account.isActive);
        const rowKey = MargaUtils.escapeHtml(String(account.key || '')).replace(/'/g, "\\'");

        return `
            <tr onclick="openPanel('${rowKey}')">
                <td>
                    <div class="customer-name">${MargaUtils.escapeHtml(account.companyName || 'Unknown')}</div>
                    <div class="customer-branch">${MargaUtils.escapeHtml(account.accountName || account.branchName || 'Account')}</div>
                </td>
                <td class="customer-location">${MargaUtils.escapeHtml(location)}</td>
                <td class="customer-contact">${MargaUtils.escapeHtml(account.contactName || 'N/A')}</td>
                <td class="machine-count">${machineCount}</td>
                <td>
                    <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openPanel('${rowKey}')">
                        View
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    updatePaginationInfo(startIdx + 1, Math.min(endIdx, filteredCompanies.length), filteredCompanies.length);
    updatePaginationButtons(totalPages);
}

/**
 * Get machine count for branches
 * Status codes: 1 = Active, 2 = Terminated, 7 = Historical/Ended
 * Only count status == 1 as active machines
 */
function getMachineCount(branches) {
    const branchIds = branches.map(b => b.id);
    return customers.contracts.filter(c => 
        branchIds.includes(c.contract_id) && c.status == 1
    ).length;
}

/**
 * Get location string
 */
function getLocation(branch) {
    if (!branch) return 'N/A';
    
    const area = customers.areas.find(a => a.id == branch.area_id);
    const areaName = area?.area_name || area?.name || '';
    const cityName = branch.city || '';
    
    return areaName || cityName || 'N/A';
}

/**
 * Update pagination info
 */
function updatePaginationInfo(start, end, total) {
    document.getElementById('showingStart').textContent = start;
    document.getElementById('showingEnd').textContent = end;
    document.getElementById('totalRecords').textContent = total;
    document.getElementById('currentPage').textContent = currentPage;
}

/**
 * Update pagination buttons
 */
function updatePaginationButtons(totalPages) {
    document.getElementById('prevBtn').disabled = currentPage <= 1;
    document.getElementById('nextBtn').disabled = currentPage >= totalPages;
}

/**
 * Previous page
 */
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}

/**
 * Next page
 */
function nextPage() {
    const totalPages = Math.ceil(filteredCompanies.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderTable();
    }
}

/**
 * Open detail panel
 */
function openPanel(accountKey) {
    selectedAccountKey = String(accountKey || '');
    const account = accountRows.find((entry) => String(entry.key) === selectedAccountKey);
    if (!account) {
        MargaUtils.showToast('Account not found', 'error');
        return;
    }

    document.getElementById('panelCompanyName').textContent = account.companyName || 'Unknown';
    document.getElementById('panelBranchCount').textContent = account.accountName || account.branchName || 'Account';
    
    // Reset to info tab
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    const infoTab = document.querySelector('.detail-tab[data-tab="info"]');
    if (infoTab) infoTab.classList.add('active');
    
    // Load info tab content
    loadInfoTab(account);
    
    // Show modal
    document.getElementById('detailPanel').classList.add('open');
    document.getElementById('detailOverlay').classList.add('visible');
}

/**
 * Close detail panel
 */
function closePanel() {
    document.getElementById('detailPanel').classList.remove('open');
    document.getElementById('detailOverlay').classList.remove('visible');
    selectedAccountKey = null;
}

/**
 * Switch tabs
 */
function switchTab(tabName) {
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.detail-tab[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    
    const account = accountRows.find((entry) => String(entry.key) === String(selectedAccountKey));
    if (!account) return;
    
    switch(tabName) {
        case 'info':
            loadInfoTab(account);
            break;
        case 'billing':
            loadBillingTab(account);
            break;
        case 'machines':
            loadMachinesTab(account);
            break;
    }
}

/**
 * Load Info Tab content
 */
function loadInfoTab(account) {
    const content = document.getElementById('panelContent');
    const company = account.company || customers.companies.find((entry) => String(entry.id) === String(account.companyId));
    const branch = account.branch || {};
    const activeMachines = account.machineEntries.filter((entry) => Number(entry.status || 0) === 1).length;
    
    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Company Information</div>
            <div class="detail-grid">
                <div class="detail-field full">
                    <div class="field-label">Company Name</div>
                    <div class="field-value">${MargaUtils.escapeHtml(company?.companyname || 'N/A')}</div>
                </div>
                <div class="detail-field">
                    <div class="field-label">TIN</div>
                    <div class="field-value">${MargaUtils.escapeHtml(company?.company_tin || 'N/A')}</div>
                </div>
                <div class="detail-field">
                    <div class="field-label">Business Style</div>
                    <div class="field-value">${MargaUtils.escapeHtml(company?.business_style || 'N/A')}</div>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Selected Account</div>
            <div class="branch-card ${account.branchId ? 'branch-clickable' : ''}" ${account.branchId ? `onclick="editBranch(${account.branchId})"` : ''}>
                    <div class="branch-card-header">
                        <div>
                            <div class="branch-name">${MargaUtils.escapeHtml(account.accountName || branch.branchname || 'Unnamed')}</div>
                            <div class="branch-code">${MargaUtils.escapeHtml(branch.code || '')}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span class="badge ${account.isActive ? 'badge-success' : 'badge-danger'}">
                                ${account.isActive ? 'Active' : 'Inactive'}
                            </span>
                            ${account.branchId ? `
                            <span class="branch-edit-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </span>
                            ` : ''}
                        </div>
                    </div>
                    <div class="branch-details">
                        <div><strong>Address:</strong> ${MargaUtils.escapeHtml(formatAddress(branch))}</div>
                        <div><strong>Signatory:</strong> ${MargaUtils.escapeHtml(branch.signatory || 'N/A')} ${branch.designation ? '(' + MargaUtils.escapeHtml(branch.designation) + ')' : ''}</div>
                        <div><strong>Email:</strong> ${MargaUtils.escapeHtml(branch.email || 'N/A')}</div>
                    </div>
                    ${account.machineEntries.length > 0 ? `
                    <div class="branch-machines">
                        <div class="branch-machines-title">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                            Machines (${account.machineEntries.length}) - ${activeMachines} active
                        </div>
                        <div class="branch-machines-list">
                            ${account.machineEntries.slice(0, 3).map(m => `
                                <span class="machine-tag ${m.status == 1 ? 'active' : m.status == 0 ? 'pending' : 'terminated'}">
                                    ${MargaUtils.escapeHtml(m.modelName)}
                                </span>
                            `).join('')}
                            ${account.machineEntries.length > 3 ? `<span class="machine-tag more">+${account.machineEntries.length - 3} more</span>` : ''}
                        </div>
                    </div>
                    ` : ''}
                    ${account.branchId ? `
                    <div class="branch-actions">
                        <button class="btn-convert" onclick="event.stopPropagation(); showConvertModal(${account.branchId}, '${MargaUtils.escapeHtml(branch.branchname || '').replace(/'/g, "\\'")}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14M5 12h14"/>
                            </svg>
                            Convert to Company
                        </button>
                    </div>
                    ` : ''}
                </div>
        </div>
    `;
}

/**
 * Load Billing Tab content
 */
function loadBillingTab(account) {
    const branchBillInfo = account.billInfoRows || [];
    const content = document.getElementById('panelContent');
    
    if (branchBillInfo.length === 0) {
        content.innerHTML = `
            <div class="tab-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                </svg>
                <h4>No Billing Information</h4>
                <p>No billing records found for this company</p>
            </div>
        `;
        return;
    }
    
    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Billing Information</div>
            ${branchBillInfo.map(bi => {
                return `
                <div class="billing-card">
                    <div class="billing-card-header">${MargaUtils.escapeHtml(account.accountName || account.branchName || 'Account')}</div>
                    <div class="billing-grid">
                        <div class="billing-field">
                            <div class="field-label">Payee Name</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeename || 'N/A')}</div>
                        </div>
                        <div class="billing-field">
                            <div class="field-label">Contact</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeecontactnum || 'N/A')}</div>
                        </div>
                        <div class="billing-field" style="grid-column: span 2;">
                            <div class="field-label">Payee Address</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeeadd || 'N/A')}</div>
                        </div>
                        <div class="billing-field">
                            <div class="field-label">End User</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.endusername || 'N/A')}</div>
                        </div>
                        <div class="billing-field">
                            <div class="field-label">End User Contact</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.endusercontactnum || 'N/A')}</div>
                        </div>
                        <div class="billing-field" style="grid-column: span 2;">
                            <div class="field-label">End User Address</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.enduseradd || 'N/A')}</div>
                        </div>
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
}

/**
 * Load Machines Tab content
 */
function loadMachinesTab(account) {
    const branchContracts = account.contracts || [];
    const content = document.getElementById('panelContent');
    
    // Status mapping based on legacy system
    const statusMap = {
        0: { text: 'Pending', class: 'pending' },
        1: { text: 'Active', class: 'active' },
        2: { text: 'Terminated', class: 'terminated' },
        3: { text: 'On Hold', class: 'pending' },
        4: { text: 'Pulled Out', class: 'terminated' },
        7: { text: 'Ended', class: 'ended' },
        8: { text: 'Replaced', class: 'pending' },
        9: { text: 'Transferred', class: 'pending' },
        10: { text: 'For Pullout', class: 'pending' },
        13: { text: 'Cancelled', class: 'terminated' }
    };
    
    if (branchContracts.length === 0) {
        content.innerHTML = `
            <div class="tab-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                    <path d="M12 12h.01"/>
                </svg>
                <h4>No Machines</h4>
                <p>No machines or contracts found for this company</p>
            </div>
        `;
        return;
    }
    
    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Machines & Contracts (${branchContracts.length})</div>
            ${branchContracts.map(contract => {
                const machine = customers.machines.find(m => m.id == contract.mach_id) || {};
                const model = customers.models.find(m => m.id == machine.model_id);
                const modelName = model?.modelname || 'Unknown Model';
                const statusInfo = statusMap[contract.status] || { text: `Status ${contract.status}`, class: 'pending' };
                
                return `
                    <div class="machine-card">
                        <div class="machine-card-header">
                            <div>
                                <div class="machine-card-title">${MargaUtils.escapeHtml(modelName)}</div>
                                <div class="machine-card-serial">${MargaUtils.escapeHtml(machine.serial || contract.xserial || 'N/A')}</div>
                            </div>
                            <span class="machine-status-badge ${statusInfo.class}">${statusInfo.text}</span>
                        </div>
                        <div class="machine-details-grid">
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">B&W Rate</div>
                                <div class="machine-detail-value currency">${MargaUtils.formatCurrency(contract.page_rate || 0)}</div>
                            </div>
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">B&W Quota</div>
                                <div class="machine-detail-value">${(contract.monthly_quota || 0).toLocaleString()}</div>
                            </div>
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">Monthly Rate</div>
                                <div class="machine-detail-value currency">${MargaUtils.formatCurrency(contract.monthly_rate || 0)}</div>
                            </div>
                        </div>
                        ${contract.page_rate2 > 0 ? `
                        <div class="machine-details-grid" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed #e2e8f0;">
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">Color Rate</div>
                                <div class="machine-detail-value currency">${MargaUtils.formatCurrency(contract.page_rate2 || 0)}</div>
                            </div>
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">Color Quota</div>
                                <div class="machine-detail-value">${(contract.monthly_quota2 || 0).toLocaleString()}</div>
                            </div>
                            <div class="machine-detail-item">
                                <div class="machine-detail-label">Color Monthly</div>
                                <div class="machine-detail-value currency">${MargaUtils.formatCurrency(contract.monthly_rate2 || 0)}</div>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * Format address from branch
 */
function formatAddress(branch) {
    const parts = [
        branch.room,
        branch.floor,
        branch.bldg,
        branch.street,
        branch.brgy,
        branch.city
    ].filter(Boolean);
    
    return parts.length > 0 ? parts.join(', ') : 'N/A';
}

/**
 * Export customers to CSV
 */
function exportCustomers() {
    const headers = ['Company Name', 'Account', 'Location', 'Contact', 'Machine Count', 'Status'];
    const rows = filteredCompanies.map((row) => {
        return [
            row.companyName || '',
            row.accountName || row.branchName || '',
            row.location || '',
            row.contactName || '',
            row.machineCount || 0,
            row.isActive ? 'Active' : 'Inactive'
        ];
    });
    
    const csv = [headers, ...rows].map(row => 
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    MargaUtils.showToast('Export completed', 'success');
}

/**
 * Edit customer - opens the form with current data
 */
function editCustomer() {
    if (!selectedAccountKey) {
        MargaUtils.showToast('No customer selected', 'error');
        return;
    }

    const account = accountRows.find((entry) => String(entry.key) === String(selectedAccountKey));
    if (!account?.branchId) {
        MargaUtils.showToast('This account has no editable branch link yet.', 'error');
        return;
    }

    editBranch(account.branchId);
}

/**
 * Print customer details
 */
function printCustomer() {
    window.print();
}

/**
 * Show new customer modal
 */
function showNewCustomerModal() {
    CustomerForm.openNew();
}


/**
 * Edit a specific branch
 */
function editBranch(branchId) {
    const branch = customers.branches.find(b => b.id == branchId);
    if (!branch) {
        MargaUtils.showToast('Branch not found', 'error');
        return;
    }
    
    const company = customers.companies.find(c => c.id == branch.company_id);
    const companyBranches = [branch];
    const branchBillInfo = customers.billInfo.filter(bi => bi.branch_id == branchId);
    const branchIndex = 0;
    
    // Close the detail panel
    closePanel();
    
    // Open edit form at specific branch
    CustomerForm.openEditBranch(company, companyBranches, branchBillInfo, branchIndex);
}


/**
 * Show Convert to Company Modal
 */
function showConvertModal(branchId, branchName) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('convertModal');
    if (!modal) {
        const modalHTML = `
            <div class="modal-overlay" id="convertModalOverlay" onclick="closeConvertModal()"></div>
            <div class="convert-modal" id="convertModal">
                <div class="convert-modal-header">
                    <h3>🔄 Convert Branch to Company</h3>
                    <button class="modal-close-btn" onclick="closeConvertModal()">×</button>
                </div>
                <div class="convert-modal-body">
                    <p class="convert-info">This will remove the branch from its current company and create a new company with the same information.</p>
                    
                    <div class="convert-form">
                        <div class="form-field">
                            <label class="field-label">New Company Name</label>
                            <input type="text" class="field-input" id="newCompanyName" placeholder="Enter company name">
                        </div>
                        <div class="form-field">
                            <label class="field-label">TIN (Optional)</label>
                            <input type="text" class="field-input" id="newCompanyTin" placeholder="000-000-000-000">
                        </div>
                        <div class="form-field">
                            <label class="field-label">Business Style (Optional)</label>
                            <input type="text" class="field-input" id="newCompanyStyle" placeholder="Business style">
                        </div>
                    </div>
                    
                    <input type="hidden" id="convertBranchId">
                </div>
                <div class="convert-modal-footer">
                    <button class="btn btn-secondary" onclick="closeConvertModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="executeConvert()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Convert & Save
                    </button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('convertModal');
    }
    
    // Set values
    document.getElementById('convertBranchId').value = branchId;
    document.getElementById('newCompanyName').value = branchName;
    document.getElementById('newCompanyTin').value = '';
    document.getElementById('newCompanyStyle').value = '';
    
    // Show modal
    document.getElementById('convertModalOverlay').classList.add('visible');
    modal.classList.add('visible');
    document.getElementById('newCompanyName').focus();
}

/**
 * Close Convert Modal
 */
function closeConvertModal() {
    document.getElementById('convertModalOverlay')?.classList.remove('visible');
    document.getElementById('convertModal')?.classList.remove('visible');
}

/**
 * Execute the conversion
 */
async function executeConvert() {
    const branchId = document.getElementById('convertBranchId').value;
    const newCompanyName = document.getElementById('newCompanyName').value.trim();
    const newCompanyTin = document.getElementById('newCompanyTin').value.trim();
    const newCompanyStyle = document.getElementById('newCompanyStyle').value.trim();
    
    if (!newCompanyName) {
        MargaUtils.showToast('Company name is required', 'error');
        return;
    }
    
    if (!branchId) {
        MargaUtils.showToast('No branch selected', 'error');
        return;
    }
    
    try {
        // Show loading
        const btn = document.querySelector('#convertModal .btn-primary');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<div class="spinner"></div> Converting...';
        btn.disabled = true;
        
        // Get the branch data
        const branch = customers.branches.find(b => b.id == branchId);
        if (!branch) {
            throw new Error('Branch not found');
        }
        
        // Get next company ID
        const maxCompanyId = Math.max(...customers.companies.map(c => c.id || 0), 0);
        const newCompanyId = maxCompanyId + 1;
        
        // Create new company via REST API
        const companyData = {
            fields: {
                id: { integerValue: newCompanyId },
                companyname: { stringValue: newCompanyName },
                company_tin: { stringValue: newCompanyTin },
                business_style: { stringValue: newCompanyStyle },
                nature_of_business: { stringValue: '' },
                business_industry: { stringValue: '' }
            }
        };
        
        // Save new company
        const createResponse = await fetch(
            `${FIREBASE_CONFIG.baseUrl}/tbl_companylist?documentId=${newCompanyId}&key=${FIREBASE_CONFIG.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(companyData)
            }
        );
        
        if (!createResponse.ok) {
            throw new Error('Failed to create company');
        }
        
        // Update branch to point to new company
        const updateResponse = await fetch(
            `${FIREBASE_CONFIG.baseUrl}/tbl_branchinfo/${branchId}?updateMask.fieldPaths=company_id&key=${FIREBASE_CONFIG.apiKey}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fields: {
                        company_id: { integerValue: newCompanyId }
                    }
                })
            }
        );
        
        if (!updateResponse.ok) {
            throw new Error('Failed to update branch');
        }
        
        MargaUtils.showToast(`"${newCompanyName}" created successfully!`, 'success');
        closeConvertModal();
        closePanel();
        
        // Reload data
        await loadAllData();
        
    } catch (error) {
        console.error('Convert error:', error);
        MargaUtils.showToast('Error: ' + error.message, 'error');
    } finally {
        const btn = document.querySelector('#convertModal .btn-primary');
        if (btn) {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Convert & Save
            `;
            btn.disabled = false;
        }
    }
}
