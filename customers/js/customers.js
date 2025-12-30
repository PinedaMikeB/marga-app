/**
 * MARGA Customer Management Module
 * Handles customer data display and interactions
 */

// Data storage
let customers = {
    companies: [],
    branches: [],
    contracts: [],
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
let selectedCompanyId = null;
let currentFilter = 'all'; // 'all', 'active', 'inactive'

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
    
    // Initialize customer form module
    CustomerForm.init(customers.areas, customers.cities);
});

/**
 * Load all data from Firebase
 */
async function loadAllData() {
    try {
        showLoading(true);

        // Load all collections in parallel
        const [companies, branches, contracts, machines, models, brands, areas, cities, billInfo] = 
            await Promise.all([
                MargaUtils.fetchCollection('tbl_companylist'),
                MargaUtils.fetchCollection('tbl_branchinfo'),
                MargaUtils.fetchCollection('tbl_contractmain'),
                MargaUtils.fetchCollection('tbl_machine'),
                MargaUtils.fetchCollection('tbl_model'),
                MargaUtils.fetchCollection('tbl_brand'),
                MargaUtils.fetchCollection('tbl_area'),
                MargaUtils.fetchCollection('tbl_city'),
                MargaUtils.fetchCollection('tbl_billinfo')
            ]);

        customers = { companies, branches, contracts, machines, models, brands, areas, cities, billInfo };

        // Update stats
        updateStats();

        // Sort companies alphabetically and apply initial filter
        filteredCompanies = [...companies].sort((a, b) => 
            (a.companyname || '').localeCompare(b.companyname || '')
        );
        renderTable();

    } catch (error) {
        console.error('Error loading data:', error);
        MargaUtils.showToast('Failed to load customer data', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Update statistics display
 */
function updateStats() {
    MargaUtils.animateNumber('totalCompanies', customers.companies.length);
    MargaUtils.animateNumber('totalBranches', customers.branches.length);
    MargaUtils.animateNumber('activeMachines', customers.machines.length);
    MargaUtils.animateNumber('totalContracts', customers.contracts.length);
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
    
    // Group branches by company for status check
    const branchesByCompany = {};
    customers.branches.forEach(b => {
        if (!branchesByCompany[b.company_id]) branchesByCompany[b.company_id] = [];
        branchesByCompany[b.company_id].push(b);
    });
    
    // Start with all companies
    let result = [...customers.companies];
    
    // Apply search filter
    if (query) {
        result = result.filter(c => 
            c.companyname?.toLowerCase().includes(query)
        );
    }
    
    // Apply status filter
    if (currentFilter !== 'all') {
        result = result.filter(company => {
            const companyBranches = branchesByCompany[company.id] || [];
            const machineCount = getMachineCount(companyBranches);
            const isActive = machineCount > 0;
            
            if (currentFilter === 'active') return isActive;
            if (currentFilter === 'inactive') return !isActive;
            return true;
        });
    }
    
    // Sort alphabetically
    result.sort((a, b) => (a.companyname || '').localeCompare(b.companyname || ''));
    
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

    // Group branches by company for quick lookup
    const branchesByCompany = {};
    customers.branches.forEach(b => {
        if (!branchesByCompany[b.company_id]) branchesByCompany[b.company_id] = [];
        branchesByCompany[b.company_id].push(b);
    });

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

    tbody.innerHTML = pageCompanies.map(company => {
        const companyBranches = branchesByCompany[company.id] || [];
        const firstBranch = companyBranches[0] || {};
        const machineCount = getMachineCount(companyBranches);
        const location = getLocation(firstBranch);
        const isActive = machineCount > 0;

        return `
            <tr onclick="openPanel(${company.id})">
                <td>
                    <div class="customer-name">${MargaUtils.escapeHtml(company.companyname || 'Unknown')}</div>
                    <div class="customer-branch">${companyBranches.length} branch${companyBranches.length !== 1 ? 'es' : ''}</div>
                </td>
                <td class="customer-location">${MargaUtils.escapeHtml(location)}</td>
                <td class="customer-contact">${MargaUtils.escapeHtml(firstBranch.signatory || 'N/A')}</td>
                <td class="machine-count">${machineCount}</td>
                <td>
                    <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openPanel(${company.id})">
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
 */
function getMachineCount(branches) {
    const branchIds = branches.map(b => b.id);
    return customers.contracts.filter(c => 
        branchIds.includes(c.contract_id) && c.status != 2
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
function openPanel(companyId) {
    selectedCompanyId = companyId;
    
    const company = customers.companies.find(c => c.id == companyId);
    const companyBranches = customers.branches.filter(b => b.company_id == companyId);
    
    document.getElementById('panelCompanyName').textContent = company?.companyname || 'Unknown';
    document.getElementById('panelBranchCount').textContent = `${companyBranches.length} Branch${companyBranches.length !== 1 ? 'es' : ''}`;
    
    // Reset to info tab
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="info"]').classList.add('active');
    
    // Load info tab content
    loadInfoTab(company, companyBranches);
    
    // Show panel
    document.getElementById('detailPanel').classList.add('open');
    document.getElementById('overlay').classList.add('visible');
}

/**
 * Close detail panel
 */
function closePanel() {
    document.getElementById('detailPanel').classList.remove('open');
    document.getElementById('overlay').classList.remove('visible');
    selectedCompanyId = null;
}

/**
 * Switch tabs
 */
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    
    const company = customers.companies.find(c => c.id == selectedCompanyId);
    const companyBranches = customers.branches.filter(b => b.company_id == selectedCompanyId);
    
    switch(tabName) {
        case 'info':
            loadInfoTab(company, companyBranches);
            break;
        case 'billing':
            loadBillingTab(companyBranches);
            break;
        case 'machines':
            loadMachinesTab(companyBranches);
            break;
    }
}

/**
 * Load Info Tab content
 */
function loadInfoTab(company, companyBranches) {
    const content = document.getElementById('panelContent');
    
    // Get machines per branch
    const machinesByBranch = {};
    companyBranches.forEach(branch => {
        const branchContracts = customers.contracts.filter(c => c.contract_id == branch.id);
        machinesByBranch[branch.id] = branchContracts.map(contract => {
            const machine = customers.machines.find(m => m.id == contract.mach_id) || {};
            const model = customers.models.find(m => m.id == machine.model_id);
            return {
                model: model?.modelname || 'Unknown Model',
                serial: machine.serial || contract.xserial || 'N/A',
                status: contract.status
            };
        });
    });
    
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
            <div class="detail-section-title">Branches (${companyBranches.length})</div>
            ${companyBranches.map(branch => {
                const branchMachines = machinesByBranch[branch.id] || [];
                const activeMachines = branchMachines.filter(m => m.status == 1).length;
                
                return `
                <div class="branch-card branch-clickable" onclick="editBranch(${branch.id})">
                    <div class="branch-card-header">
                        <div>
                            <div class="branch-name">${MargaUtils.escapeHtml(branch.branchname || 'Unnamed')}</div>
                            <div class="branch-code">${MargaUtils.escapeHtml(branch.code || '')}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span class="badge ${branch.inactive ? 'badge-danger' : 'badge-success'}">
                                ${branch.inactive ? 'Inactive' : 'Active'}
                            </span>
                            <span class="branch-edit-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </span>
                        </div>
                    </div>
                    <div class="branch-details">
                        <div><strong>Address:</strong> ${MargaUtils.escapeHtml(formatAddress(branch))}</div>
                        <div><strong>Signatory:</strong> ${MargaUtils.escapeHtml(branch.signatory || 'N/A')} ${branch.designation ? '(' + MargaUtils.escapeHtml(branch.designation) + ')' : ''}</div>
                        <div><strong>Email:</strong> ${MargaUtils.escapeHtml(branch.email || 'N/A')}</div>
                    </div>
                    ${branchMachines.length > 0 ? `
                    <div class="branch-machines">
                        <div class="branch-machines-title">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                            Machines (${branchMachines.length}) - ${activeMachines} active
                        </div>
                        <div class="branch-machines-list">
                            ${branchMachines.slice(0, 3).map(m => `
                                <span class="machine-tag ${m.status == 1 ? 'active' : m.status == 0 ? 'pending' : 'terminated'}">
                                    ${MargaUtils.escapeHtml(m.model)}
                                </span>
                            `).join('')}
                            ${branchMachines.length > 3 ? `<span class="machine-tag more">+${branchMachines.length - 3} more</span>` : ''}
                        </div>
                    </div>
                    ` : ''}
                </div>
            `}).join('') || '<p class="text-muted text-center">No branches found</p>'}
        </div>
    `;
}

/**
 * Load Billing Tab content
 */
function loadBillingTab(companyBranches) {
    const branchIds = companyBranches.map(b => b.id);
    const branchBillInfo = customers.billInfo.filter(bi => branchIds.includes(bi.branch_id));
    const content = document.getElementById('panelContent');
    
    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Billing Information</div>
            ${branchBillInfo.length > 0 ? branchBillInfo.map(bi => `
                <div class="branch-card">
                    <div class="detail-grid">
                        <div class="detail-field">
                            <div class="field-label">Payee Name</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeename || 'N/A')}</div>
                        </div>
                        <div class="detail-field">
                            <div class="field-label">Contact</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeecontactnum || 'N/A')}</div>
                        </div>
                        <div class="detail-field full">
                            <div class="field-label">Payee Address</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.payeeadd || 'N/A')}</div>
                        </div>
                        <div class="detail-field">
                            <div class="field-label">End User</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.endusername || 'N/A')}</div>
                        </div>
                        <div class="detail-field">
                            <div class="field-label">End User Contact</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.endusercontactnum || 'N/A')}</div>
                        </div>
                        <div class="detail-field full">
                            <div class="field-label">End User Address</div>
                            <div class="field-value">${MargaUtils.escapeHtml(bi.enduseradd || 'N/A')}</div>
                        </div>
                    </div>
                </div>
            `).join('') : '<p class="text-muted text-center" style="padding: 2rem;">No billing information found</p>'}
        </div>
    `;
}

/**
 * Load Machines Tab content
 */
function loadMachinesTab(companyBranches) {
    const branchIds = companyBranches.map(b => b.id);
    const branchContracts = customers.contracts.filter(c => branchIds.includes(c.contract_id));
    const content = document.getElementById('panelContent');
    
    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Machines & Contracts (${branchContracts.length})</div>
            ${branchContracts.length > 0 ? branchContracts.map(contract => {
                const machine = customers.machines.find(m => m.id == contract.mach_id) || {};
                const model = customers.models.find(m => m.id == machine.model_id);
                const modelName = model?.modelname || 'Unknown Model';
                const statusText = contract.status == 1 ? 'Active' : contract.status == 2 ? 'Terminated' : 'Pending';
                const statusClass = contract.status == 1 ? 'active' : 'terminated';
                
                return `
                    <div class="machine-card">
                        <div class="machine-header">
                            <div>
                                <div class="machine-model">${MargaUtils.escapeHtml(modelName)}</div>
                                <div class="machine-serial">${MargaUtils.escapeHtml(machine.serial || contract.xserial || 'N/A')}</div>
                            </div>
                            <span class="machine-status ${statusClass}">${statusText}</span>
                        </div>
                        <div class="machine-rates">
                            <div class="rate-item">
                                <div class="rate-value">${MargaUtils.formatCurrency(contract.page_rate || 0)}</div>
                                <div class="rate-label">B&W Rate</div>
                            </div>
                            <div class="rate-item">
                                <div class="rate-value">${contract.monthly_quota || 0}</div>
                                <div class="rate-label">B&W Quota</div>
                            </div>
                            <div class="rate-item">
                                <div class="rate-value">${MargaUtils.formatCurrency(contract.monthly_rate || 0)}</div>
                                <div class="rate-label">Monthly Rate</div>
                            </div>
                        </div>
                        ${contract.page_rate2 > 0 ? `
                        <div class="machine-rates" style="border-top: 1px dashed var(--border); margin-top: 0.75rem; padding-top: 0.75rem;">
                            <div class="rate-item">
                                <div class="rate-value">${MargaUtils.formatCurrency(contract.page_rate2 || 0)}</div>
                                <div class="rate-label">Color Rate</div>
                            </div>
                            <div class="rate-item">
                                <div class="rate-value">${contract.monthly_quota2 || 0}</div>
                                <div class="rate-label">Color Quota</div>
                            </div>
                            <div class="rate-item">
                                <div class="rate-value">${MargaUtils.formatCurrency(contract.monthly_rate2 || 0)}</div>
                                <div class="rate-label">Color Monthly</div>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;
            }).join('') : '<p class="text-muted text-center" style="padding: 2rem;">No machines found</p>'}
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
    const headers = ['Company Name', 'TIN', 'Business Style', 'Branch Count'];
    const rows = filteredCompanies.map(c => {
        const branchCount = customers.branches.filter(b => b.company_id == c.id).length;
        return [
            c.companyname || '',
            c.company_tin || '',
            c.business_style || '',
            branchCount
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
    if (!selectedCompanyId) {
        MargaUtils.showToast('No customer selected', 'error');
        return;
    }
    
    const company = customers.companies.find(c => c.id == selectedCompanyId);
    const companyBranches = customers.branches.filter(b => b.company_id == selectedCompanyId);
    const branchIds = companyBranches.map(b => b.id);
    const branchBillInfo = customers.billInfo.filter(bi => branchIds.includes(bi.branch_id));
    
    // Close the detail panel
    closePanel();
    
    // Open edit form
    CustomerForm.openEdit(company, companyBranches, branchBillInfo);
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
    const companyBranches = customers.branches.filter(b => b.company_id == branch.company_id);
    const branchIds = companyBranches.map(b => b.id);
    const branchBillInfo = customers.billInfo.filter(bi => branchIds.includes(bi.branch_id));
    
    // Find the index of this branch
    const branchIndex = companyBranches.findIndex(b => b.id == branchId);
    
    // Close the detail panel
    closePanel();
    
    // Open edit form at specific branch
    CustomerForm.openEditBranch(company, companyBranches, branchBillInfo, branchIndex);
}
