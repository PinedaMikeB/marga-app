/**
 * MARGA Customer Form Module
 * Handles add/edit functionality for companies and branches
 * Modernized replacement for VB.NET interface
 */

const CustomerForm = (function() {
    // Current state
    let currentCompany = null;
    let currentBranches = [];
    let currentBillInfo = [];
    let currentContracts = [];  // Add contracts data
    let activeBranchIndex = 0;
    let isEditMode = false;
    let isDirty = false;

    // Reference data
    let refData = {
        areas: [],
        cities: [],
        contracts: [],  // All contracts
        machines: [],   // All machines
        models: [],     // All models
        brands: [],     // All brands
        natureOfBusiness: [
            'Service Business',
            'Merchandising Business',
            'Manufacturing Business',
            'Government',
            'Educational Institution',
            'Healthcare',
            'Non-Profit Organization'
        ],
        businessIndustry: [
            'Information Technology',
            'Healthcare',
            'Finance & Banking',
            'Manufacturing',
            'Retail',
            'Education',
            'Government',
            'Legal Services',
            'Real Estate',
            'Transportation',
            'Hospitality',
            'Construction',
            'Media & Entertainment',
            'Telecommunications',
            'Agriculture',
            'Energy',
            'Other'
        ]
    };

    /**
     * Initialize the form module
     */
    async function init(areas, cities, contracts, machines, models, brands) {
        refData.areas = areas || [];
        refData.cities = cities || [];
        refData.contracts = contracts || [];
        refData.machines = machines || [];
        refData.models = models || [];
        refData.brands = brands || [];
        createModalHTML();
        bindEvents();
    }

    /**
     * Status mapping for contracts
     */
    const statusMap = {
        0: { text: 'Pending', class: 'pending', color: '#f59e0b' },
        1: { text: 'Active', class: 'active', color: '#10b981' },
        2: { text: 'Terminated', class: 'terminated', color: '#ef4444' },
        3: { text: 'On Hold', class: 'pending', color: '#f59e0b' },
        4: { text: 'Pulled Out', class: 'terminated', color: '#ef4444' },
        7: { text: 'Ended', class: 'terminated', color: '#6b7280' },
        8: { text: 'Replaced', class: 'pending', color: '#8b5cf6' },
        9: { text: 'Transferred', class: 'pending', color: '#3b82f6' },
        10: { text: 'For Pullout', class: 'pending', color: '#f59e0b' },
        13: { text: 'Cancelled', class: 'terminated', color: '#ef4444' }
    };

    /**
     * Category mapping for contracts (rental types)
     * TODO: Verify these codes with Mike's legacy system
     */
    const categoryMap = {
        0: { code: 'N/A', name: 'Not Set' },
        1: { code: 'RTP', name: 'Rental To Purchase' },
        2: { code: 'RTF', name: 'Rental (Full)' },
        3: { code: 'RTC', name: 'Rental (Consumable)' },
        4: { code: 'SVC', name: 'Service Only' },
        5: { code: 'PUR', name: 'Purchase' },
        6: { code: 'FMS', name: 'Fleet Management' },
        8: { code: 'CPC', name: 'Cost Per Copy' },
        9: { code: 'MPS', name: 'Managed Print Service' },
        12: { code: 'RTL', name: 'Rental (Lease)' },
        13: { code: 'CON', name: 'Consignment' },
        14: { code: 'OTH', name: 'Other' },
        15: { code: 'TRL', name: 'Trial' }
    };

    /**
     * Render Machine & Contract section for a branch (EDITABLE)
     */
    function renderMachineContractSection(branch) {
        // If no branch ID, it's a new branch - no contracts yet
        if (!branch.id) {
            return `
                <div class="form-section">
                    <div class="section-header cyan">
                        <div class="section-icon cyan">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                        </div>
                        <span class="section-title">Machine & Contract</span>
                    </div>
                    <div class="section-body">
                        <div class="no-machine-info">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4;">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                            <p>No machine assigned yet. Save this branch first to add machines.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Find contracts for this branch
        const branchContracts = refData.contracts.filter(c => c.contract_id == branch.id);
        
        if (branchContracts.length === 0) {
            return `
                <div class="form-section">
                    <div class="section-header cyan">
                        <div class="section-icon cyan">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                        </div>
                        <span class="section-title">Machine & Contract</span>
                    </div>
                    <div class="section-body">
                        <div class="no-machine-info">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4;">
                                <rect x="2" y="6" width="20" height="12" rx="2"/>
                                <path d="M12 12h.01"/>
                            </svg>
                            <p>No machine/contract linked to this branch.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Generate status options
        const statusOptions = Object.entries(statusMap).map(([id, info]) => 
            `<option value="${id}">${info.text}</option>`
        ).join('');

        // Generate category options
        const categoryOptions = Object.entries(categoryMap).map(([id, info]) => 
            `<option value="${id}">${info.code} - ${info.name}</option>`
        ).join('');

        // Render each contract with machine details (EDITABLE)
        const contractsHTML = branchContracts.map((contract, index) => {
            const machine = refData.machines.find(m => m.id == contract.mach_id) || {};
            const model = refData.models.find(m => m.id == machine.model_id) || {};
            const brand = refData.brands.find(b => b.id == machine.brand_id) || {};
            const statusInfo = statusMap[contract.status] || { text: 'Unknown', class: 'pending', color: '#6b7280' };
            const categoryInfo = categoryMap[contract.category_id] || { code: 'N/A', name: 'Unknown' };
            
            const modelName = model.modelname || machine.description || 'Unknown Model';
            const brandName = brand.brandname || brand.brand_name || '';
            const serial = machine.serial || contract.xserial || 'N/A';
            const contractIdx = `contract_${contract.id}`;
            
            return `
                <div class="machine-contract-card" data-contract-id="${contract.id}">
                    <div class="machine-contract-header">
                        <div class="machine-info">
                            <div class="machine-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                                    <path d="M6 10h.01M6 14h.01"/>
                                    <rect x="10" y="9" width="8" height="6" rx="1"/>
                                </svg>
                            </div>
                            <div>
                                <div class="machine-model">${MargaUtils.escapeHtml(brandName ? brandName + ' ' + modelName : modelName)}</div>
                                <div class="machine-serial">Serial: <strong>${MargaUtils.escapeHtml(serial)}</strong></div>
                            </div>
                        </div>
                        <div class="contract-badges">
                            <span class="category-badge">${categoryInfo.code}</span>
                            <span class="contract-status-badge" style="background: ${statusInfo.color}20; color: ${statusInfo.color}; border: 1px solid ${statusInfo.color}40;">
                                ${statusInfo.text}
                            </span>
                        </div>
                    </div>
                    
                    <!-- Editable Contract Details -->
                    <div class="contract-edit-section">
                        <div class="contract-edit-row">
                            <div class="edit-field">
                                <label>Status</label>
                                <select class="field-select contract-field" id="${contractIdx}_status" data-field="status">
                                    ${statusOptions.replace(`value="${contract.status}"`, `value="${contract.status}" selected`)}
                                </select>
                            </div>
                            <div class="edit-field">
                                <label>Category</label>
                                <select class="field-select contract-field" id="${contractIdx}_category" data-field="category_id">
                                    ${categoryOptions.replace(`value="${contract.category_id}"`, `value="${contract.category_id}" selected`)}
                                </select>
                            </div>
                            <div class="edit-field">
                                <label>VAT</label>
                                <select class="field-select contract-field" id="${contractIdx}_vat" data-field="withvat">
                                    <option value="1" ${contract.withvat == 1 ? 'selected' : ''}>VAT Inclusive</option>
                                    <option value="0" ${contract.withvat != 1 ? 'selected' : ''}>VAT Exclusive</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="rates-edit-grid">
                            <div class="rates-column">
                                <div class="rates-title">B&W Rates</div>
                                <div class="edit-field">
                                    <label>Page Rate (₱)</label>
                                    <input type="number" step="0.01" class="field-input contract-field" 
                                        id="${contractIdx}_page_rate" data-field="page_rate"
                                        value="${contract.page_rate || 0}">
                                </div>
                                <div class="edit-field">
                                    <label>Monthly Quota</label>
                                    <input type="number" class="field-input contract-field" 
                                        id="${contractIdx}_quota" data-field="monthly_quota"
                                        value="${contract.monthly_quota || 0}">
                                </div>
                                <div class="edit-field">
                                    <label>Monthly Rate (₱)</label>
                                    <input type="number" step="0.01" class="field-input contract-field" 
                                        id="${contractIdx}_monthly_rate" data-field="monthly_rate"
                                        value="${contract.monthly_rate || 0}">
                                </div>
                            </div>
                            <div class="rates-column color-column">
                                <div class="rates-title">Color Rates</div>
                                <div class="edit-field">
                                    <label>Page Rate (₱)</label>
                                    <input type="number" step="0.01" class="field-input contract-field" 
                                        id="${contractIdx}_page_rate2" data-field="page_rate2"
                                        value="${contract.page_rate2 || 0}">
                                </div>
                                <div class="edit-field">
                                    <label>Monthly Quota</label>
                                    <input type="number" class="field-input contract-field" 
                                        id="${contractIdx}_quota2" data-field="monthly_quota2"
                                        value="${contract.monthly_quota2 || 0}">
                                </div>
                                <div class="edit-field">
                                    <label>Monthly Rate (₱)</label>
                                    <input type="number" step="0.01" class="field-input contract-field" 
                                        id="${contractIdx}_monthly_rate2" data-field="monthly_rate2"
                                        value="${contract.monthly_rate2 || 0}">
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="contract-meta">
                        <span>Contract #${contract.id}</span>
                        <span>Machine ID: ${contract.mach_id}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="form-section">
                <div class="section-header cyan">
                    <div class="section-icon cyan">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="6" width="20" height="12" rx="2"/>
                            <path d="M12 12h.01"/>
                        </svg>
                    </div>
                    <span class="section-title">Machine & Contract (${branchContracts.length})</span>
                </div>
                <div class="section-body machine-contract-list">
                    ${contractsHTML}
                </div>
            </div>
        `;
    }


    /**
     * Create the modal HTML structure
     */
    function createModalHTML() {
        const modalHTML = `
            <div class="modal-overlay" id="customerFormOverlay"></div>
            <div class="modal-container" id="customerFormModal">
                <div class="modal-header">
                    <div class="modal-title">
                        <div class="modal-title-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                        </div>
                        <span id="formModalTitle">New Customer</span>
                    </div>
                    <button class="modal-close" onclick="CustomerForm.close()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <!-- Branch Tabs -->
                <div class="branch-tabs" id="branchTabs">
                    <button class="branch-tab active" data-index="0">Branch 1</button>
                    <button class="branch-tab branch-tab-add" onclick="CustomerForm.addBranch()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Add Branch
                    </button>
                </div>
                
                <div class="modal-body" id="formModalBody">
                    <!-- Dynamic content -->
                </div>
                
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="CustomerForm.close()">Cancel</button>
                    <button class="btn btn-primary" onclick="CustomerForm.save()" id="saveCustomerBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                            <polyline points="17,21 17,13 7,13 7,21"/>
                            <polyline points="7,3 7,8 15,8"/>
                        </svg>
                        Save Customer
                    </button>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
     * Bind event handlers
     */
    function bindEvents() {
        // Branch tab clicks
        document.getElementById('branchTabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.branch-tab:not(.branch-tab-add)');
            if (tab) {
                const index = parseInt(tab.dataset.index);
                switchBranch(index);
            }
        });

        // Track form changes
        document.getElementById('formModalBody').addEventListener('input', () => {
            isDirty = true;
        });

        // Close on overlay click
        document.getElementById('customerFormOverlay').addEventListener('click', () => {
            if (isDirty) {
                if (confirm('You have unsaved changes. Are you sure you want to close?')) {
                    close();
                }
            } else {
                close();
            }
        });
    }

    /**
     * Open form for new customer
     */
    function openNew() {
        isEditMode = false;
        currentCompany = {
            companyname: '',
            company_tin: '',
            nature_of_business: '',
            business_industry: '',
            business_style: ''
        };
        currentBranches = [createEmptyBranch()];
        currentBillInfo = [createEmptyBillInfo()];
        activeBranchIndex = 0;
        isDirty = false;
        
        document.getElementById('formModalTitle').textContent = 'New Customer';
        renderForm();
        showModal();
    }

    /**
     * Open form for editing existing customer
     */
    function openEdit(company, branches, billInfo) {
        isEditMode = true;
        currentCompany = { ...company };
        currentBranches = branches.length > 0 ? branches.map(b => ({ ...b })) : [createEmptyBranch()];
        currentBillInfo = billInfo.length > 0 ? billInfo.map(bi => ({ ...bi })) : currentBranches.map(() => createEmptyBillInfo());
        
        // Ensure billInfo matches branches
        while (currentBillInfo.length < currentBranches.length) {
            currentBillInfo.push(createEmptyBillInfo());
        }
        
        activeBranchIndex = 0;
        isDirty = false;
        
        document.getElementById('formModalTitle').textContent = 'Edit Customer';
        renderForm();
        showModal();
    }

    /**
     * Create empty branch object
     */
    function createEmptyBranch() {
        return {
            branchname: '',
            code: '',
            room: '',
            floor: '',
            bldg: '',
            street: '',
            brgy: '',
            city: '',
            area_id: '',
            landmark: '',
            signatory: '',
            designation: '',
            email: '',
            delivery_contact: '',
            delivery_num: '',
            delivery_days: '',
            delivery_hours: '',
            delivery_city: '',
            delivery_area_id: '',
            delivery_address: '',
            service_contact: '',
            service_num: '',
            service_city: '',
            service_area_id: '',
            service_address: '',
            inactive: false
        };
    }

    /**
     * Create empty bill info object
     */
    function createEmptyBillInfo() {
        return {
            endusername: '',
            endusercontactnum: '',
            endusercity: '',
            enduseradd: '',
            enduserarea_id: '',
            acct_contact: '',
            acct_num: '',
            acct_email: '',
            cashier_contact: '',
            cashier_num: '',
            treasury_contact: '',
            treasury_num: '',
            releasing_contact: '',
            releasing_num: '',
            col_days: '',
            col_from: '',
            col_to: '',
            col_city: '',
            col_area_id: '',
            col_address: ''
        };
    }

    /**
     * Render the complete form
     */
    function renderForm() {
        renderBranchTabs();
        renderFormContent();
    }

    /**
     * Render branch tabs
     */
    function renderBranchTabs() {
        const tabsContainer = document.getElementById('branchTabs');
        const tabs = currentBranches.map((branch, idx) => `
            <button class="branch-tab ${idx === activeBranchIndex ? 'active' : ''}" data-index="${idx}">
                ${branch.branchname || 'Branch ' + (idx + 1)}
                ${currentBranches.length > 1 ? `
                    <span class="tab-delete" onclick="event.stopPropagation(); CustomerForm.removeBranch(${idx})">×</span>
                ` : ''}
            </button>
        `).join('');
        
        tabsContainer.innerHTML = tabs + `
            <button class="branch-tab branch-tab-add" onclick="CustomerForm.addBranch()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
                Add Branch
            </button>
        `;
    }

    /**
     * Render form content for current branch
     */
    function renderFormContent() {
        const branch = currentBranches[activeBranchIndex];
        const billInfo = currentBillInfo[activeBranchIndex] || createEmptyBillInfo();
        
        const areaOptions = refData.areas.map(a => 
            `<option value="${a.id}" ${branch.area_id == a.id ? 'selected' : ''}>${MargaUtils.escapeHtml(a.area_name || a.name || '')}</option>`
        ).join('');
        
        const cityOptions = [...new Set(refData.cities.map(c => c.city_name || c.name))].filter(Boolean).map(city => 
            `<option value="${city}" ${branch.city == city ? 'selected' : ''}>${MargaUtils.escapeHtml(city)}</option>`
        ).join('');
        
        const natureOptions = refData.natureOfBusiness.map(n => 
            `<option value="${n}" ${currentCompany.nature_of_business == n ? 'selected' : ''}>${n}</option>`
        ).join('');
        
        const industryOptions = refData.businessIndustry.map(i => 
            `<option value="${i}" ${currentCompany.business_industry == i ? 'selected' : ''}>${i}</option>`
        ).join('');

        const html = `
            <div class="form-layout">
                <!-- LEFT COLUMN -->
                <div class="form-column">
                    <!-- Company Information -->
                    <div class="form-section">
                        <div class="section-header purple">
                            <div class="section-icon purple">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 21h18M3 7v1a3 3 0 006 0V7m0 1a3 3 0 006 0V7m0 1a3 3 0 006 0V7H3l2-4h14l2 4M6 21V10m12 11V10"/>
                                </svg>
                            </div>
                            <span class="section-title">Company Information</span>
                        </div>
                        <div class="section-body">
                            <div class="form-grid">
                                <div class="form-field span-full">
                                    <label class="field-label">Company Name</label>
                                    <input type="text" class="field-input" id="companyName" 
                                        value="${MargaUtils.escapeHtml(currentCompany.companyname || '')}"
                                        placeholder="Enter company name">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">TIN</label>
                                    <input type="text" class="field-input" id="companyTin" 
                                        value="${MargaUtils.escapeHtml(currentCompany.company_tin || '')}"
                                        placeholder="000-000-000-000">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Business Style</label>
                                    <input type="text" class="field-input" id="businessStyle" 
                                        value="${MargaUtils.escapeHtml(currentCompany.business_style || '')}"
                                        placeholder="Business style">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Nature of Business</label>
                                    <select class="field-select" id="natureOfBusiness">
                                        <option value="">Select...</option>
                                        ${natureOptions}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Business Industry</label>
                                    <select class="field-select" id="businessIndustry">
                                        <option value="">Select...</option>
                                        ${industryOptions}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Branch / Department -->
                    <div class="form-section">
                        <div class="section-header green">
                            <div class="section-icon green">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                                    <circle cx="12" cy="10" r="3"/>
                                </svg>
                            </div>
                            <span class="section-title">Branch / Department</span>
                        </div>
                        <div class="section-body">
                            <div class="form-grid">
                                <div class="form-field span-2">
                                    <label class="field-label">Branch Name</label>
                                    <input type="text" class="field-input" id="branchName" 
                                        value="${MargaUtils.escapeHtml(branch.branchname || '')}"
                                        placeholder="Branch or department name">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Branch Code</label>
                                    <input type="text" class="field-input" id="branchCode" 
                                        value="${MargaUtils.escapeHtml(branch.code || '')}"
                                        placeholder="Code">
                                </div>
                            </div>
                            
                            <div class="form-grid form-grid-4" style="margin-top: 0.875rem;">
                                <div class="form-field">
                                    <label class="field-label">Room</label>
                                    <input type="text" class="field-input" id="branchRoom" 
                                        value="${MargaUtils.escapeHtml(branch.room || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Floor</label>
                                    <input type="text" class="field-input" id="branchFloor" 
                                        value="${MargaUtils.escapeHtml(branch.floor || '')}">
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Building</label>
                                    <input type="text" class="field-input" id="branchBldg" 
                                        value="${MargaUtils.escapeHtml(branch.bldg || '')}">
                                </div>
                            </div>
                            
                            <div class="form-grid form-grid-2" style="margin-top: 0.875rem;">
                                <div class="form-field">
                                    <label class="field-label">Street</label>
                                    <input type="text" class="field-input" id="branchStreet" 
                                        value="${MargaUtils.escapeHtml(branch.street || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Barangay</label>
                                    <input type="text" class="field-input" id="branchBrgy" 
                                        value="${MargaUtils.escapeHtml(branch.brgy || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">City</label>
                                    <select class="field-select" id="branchCity">
                                        <option value="">Select...</option>
                                        ${cityOptions}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Area</label>
                                    <select class="field-select" id="branchArea">
                                        <option value="">Select...</option>
                                        ${areaOptions}
                                    </select>
                                </div>
                            </div>
                            
                            <div class="form-grid" style="margin-top: 0.875rem;">
                                <div class="form-field span-full">
                                    <label class="field-label">Landmark</label>
                                    <input type="text" class="field-input" id="branchLandmark" 
                                        value="${MargaUtils.escapeHtml(branch.landmark || '')}"
                                        placeholder="Nearby landmark">
                                </div>
                            </div>
                            
                            <div class="form-grid form-grid-2" style="margin-top: 0.875rem;">
                                <div class="form-field">
                                    <label class="field-label">Signatory</label>
                                    <input type="text" class="field-input" id="branchSignatory" 
                                        value="${MargaUtils.escapeHtml(branch.signatory || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Designation</label>
                                    <input type="text" class="field-input" id="branchDesignation" 
                                        value="${MargaUtils.escapeHtml(branch.designation || '')}">
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Email Address</label>
                                    <input type="email" class="field-input" id="branchEmail" 
                                        value="${MargaUtils.escapeHtml(branch.email || '')}"
                                        placeholder="email@company.com">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Machine & Contract Information (Read-Only Display) -->
                    ${renderMachineContractSection(branch)}

                    <!-- Delivery Information -->
                    <div class="form-section">
                        <div class="section-header orange">
                            <div class="section-icon orange">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="1" y="3" width="15" height="13"/>
                                    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                                    <circle cx="5.5" cy="18.5" r="2.5"/>
                                    <circle cx="18.5" cy="18.5" r="2.5"/>
                                </svg>
                            </div>
                            <span class="section-title">Delivery Information</span>
                            <button class="copy-all-btn" onclick="CustomerForm.copyToDelivery()">
                                Copy from Branch →
                            </button>
                        </div>
                        <div class="section-body">
                            <div class="form-grid form-grid-2">
                                <div class="form-field">
                                    <label class="field-label">Contact Person</label>
                                    <input type="text" class="field-input" id="deliveryContact" 
                                        value="${MargaUtils.escapeHtml(branch.delivery_contact || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Contact Number</label>
                                    <input type="text" class="field-input" id="deliveryNum" 
                                        value="${MargaUtils.escapeHtml(branch.delivery_num || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Office Days</label>
                                    <input type="text" class="field-input" id="deliveryDays" 
                                        value="${MargaUtils.escapeHtml(branch.delivery_days || '')}"
                                        placeholder="Mon-Fri">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Office Hours</label>
                                    <input type="text" class="field-input" id="deliveryHours" 
                                        value="${MargaUtils.escapeHtml(branch.delivery_hours || '')}"
                                        placeholder="8am to 5pm">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">City</label>
                                    <select class="field-select" id="deliveryCity">
                                        <option value="">Select...</option>
                                        ${cityOptions.replace(`selected`, ``).replace(`value="${branch.delivery_city}"`, `value="${branch.delivery_city}" selected`)}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Area</label>
                                    <select class="field-select" id="deliveryArea">
                                        <option value="">Select...</option>
                                        ${areaOptions.replace(/selected/g, ``).replace(`value="${branch.delivery_area_id}"`, `value="${branch.delivery_area_id}" selected`)}
                                    </select>
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Full Address</label>
                                    <input type="text" class="field-input" id="deliveryAddress" 
                                        value="${MargaUtils.escapeHtml(branch.delivery_address || '')}">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Service Information -->
                    <div class="form-section">
                        <div class="section-header blue">
                            <div class="section-icon blue">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                                </svg>
                            </div>
                            <span class="section-title">Service Information</span>
                            <button class="copy-all-btn" onclick="CustomerForm.copyToService()">
                                Copy from Branch →
                            </button>
                        </div>
                        <div class="section-body">
                            <div class="form-grid form-grid-2">
                                <div class="form-field">
                                    <label class="field-label">Contact Person</label>
                                    <input type="text" class="field-input" id="serviceContact" 
                                        value="${MargaUtils.escapeHtml(branch.service_contact || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Contact Number</label>
                                    <input type="text" class="field-input" id="serviceNum" 
                                        value="${MargaUtils.escapeHtml(branch.service_num || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">City</label>
                                    <select class="field-select" id="serviceCity">
                                        <option value="">Select...</option>
                                        ${cityOptions.replace(/selected/g, ``).replace(`value="${branch.service_city}"`, `value="${branch.service_city}" selected`)}
                                    </select>
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Area</label>
                                    <select class="field-select" id="serviceArea">
                                        <option value="">Select...</option>
                                        ${areaOptions.replace(/selected/g, ``).replace(`value="${branch.service_area_id}"`, `value="${branch.service_area_id}" selected`)}
                                    </select>
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Full Address</label>
                                    <input type="text" class="field-input" id="serviceAddress" 
                                        value="${MargaUtils.escapeHtml(branch.service_address || '')}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- RIGHT COLUMN -->
                <div class="form-column">
                    <!-- Billing Information -->
                    <div class="form-section">
                        <div class="section-header pink">
                            <div class="section-icon pink">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                                    <line x1="1" y1="10" x2="23" y2="10"/>
                                </svg>
                            </div>
                            <span class="section-title">Billing Information</span>
                        </div>
                        <div class="section-body">
                            <div class="form-grid form-grid-2">
                                <div class="form-field span-2">
                                    <label class="field-label">End User Name</label>
                                    <input type="text" class="field-input" id="endUserName" 
                                        value="${MargaUtils.escapeHtml(billInfo.endusername || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">Contact Number</label>
                                    <input type="text" class="field-input" id="endUserContact" 
                                        value="${MargaUtils.escapeHtml(billInfo.endusercontactnum || '')}">
                                </div>
                                <div class="form-field">
                                    <label class="field-label">City</label>
                                    <select class="field-select" id="endUserCity">
                                        <option value="">Select...</option>
                                        ${cityOptions.replace(/selected/g, ``).replace(`value="${billInfo.endusercity}"`, `value="${billInfo.endusercity}" selected`)}
                                    </select>
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Address</label>
                                    <input type="text" class="field-input" id="endUserAddress" 
                                        value="${MargaUtils.escapeHtml(billInfo.enduseradd || '')}">
                                </div>
                                <div class="form-field span-2">
                                    <label class="field-label">Area</label>
                                    <select class="field-select" id="endUserArea">
                                        <option value="">Select...</option>
                                        ${areaOptions.replace(/selected/g, ``).replace(`value="${billInfo.enduserarea_id}"`, `value="${billInfo.enduserarea_id}" selected`)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Collection Information -->
                    <div class="form-section">
                        <div class="section-header green">
                            <div class="section-icon green">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="1" x2="12" y2="23"/>
                                    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                                </svg>
                            </div>
                            <span class="section-title">Collection Information</span>
                        </div>
                        <div class="section-body">
                            <!-- Accounting -->
                            <div class="collection-subsection">
                                <div class="subsection-label">Accounting</div>
                                <div class="form-grid form-grid-2">
                                    <div class="form-field">
                                        <label class="field-label">Contact</label>
                                        <input type="text" class="field-input" id="acctContact" 
                                            value="${MargaUtils.escapeHtml(billInfo.acct_contact || '')}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">Number</label>
                                        <input type="text" class="field-input" id="acctNum" 
                                            value="${MargaUtils.escapeHtml(billInfo.acct_num || '')}">
                                    </div>
                                    <div class="form-field span-2">
                                        <label class="field-label">Email</label>
                                        <input type="email" class="field-input" id="acctEmail" 
                                            value="${MargaUtils.escapeHtml(billInfo.acct_email || '')}">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Cashier -->
                            <div class="collection-subsection">
                                <div class="subsection-label">Cashier</div>
                                <div class="form-grid form-grid-2">
                                    <div class="form-field">
                                        <label class="field-label">Contact</label>
                                        <input type="text" class="field-input" id="cashierContact" 
                                            value="${MargaUtils.escapeHtml(billInfo.cashier_contact || '')}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">Number</label>
                                        <input type="text" class="field-input" id="cashierNum" 
                                            value="${MargaUtils.escapeHtml(billInfo.cashier_num || '')}">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Treasury -->
                            <div class="collection-subsection">
                                <div class="subsection-label">Treasury</div>
                                <div class="form-grid form-grid-2">
                                    <div class="form-field">
                                        <label class="field-label">Contact</label>
                                        <input type="text" class="field-input" id="treasuryContact" 
                                            value="${MargaUtils.escapeHtml(billInfo.treasury_contact || '')}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">Number</label>
                                        <input type="text" class="field-input" id="treasuryNum" 
                                            value="${MargaUtils.escapeHtml(billInfo.treasury_num || '')}">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Releasing -->
                            <div class="collection-subsection">
                                <div class="subsection-label">Releasing</div>
                                <div class="form-grid form-grid-2">
                                    <div class="form-field">
                                        <label class="field-label">Contact</label>
                                        <input type="text" class="field-input" id="releasingContact" 
                                            value="${MargaUtils.escapeHtml(billInfo.releasing_contact || '')}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">Number</label>
                                        <input type="text" class="field-input" id="releasingNum" 
                                            value="${MargaUtils.escapeHtml(billInfo.releasing_num || '')}">
                                    </div>
                                </div>
                            </div>

                            <!-- Collection Schedule -->
                            <div class="collection-subsection">
                                <div class="subsection-label">Collection Schedule</div>
                                <div class="form-grid form-grid-2">
                                    <div class="form-field span-2">
                                        <label class="field-label">Collection Days</label>
                                        <input type="text" class="field-input" id="colDays" 
                                            value="${MargaUtils.escapeHtml(billInfo.col_days || '')}"
                                            placeholder="MONDAY - FRIDAY">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">From</label>
                                        <input type="time" class="field-input" id="colFrom" 
                                            value="${billInfo.col_from || ''}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">To</label>
                                        <input type="time" class="field-input" id="colTo" 
                                            value="${billInfo.col_to || ''}">
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">City</label>
                                        <select class="field-select" id="colCity">
                                            <option value="">Select...</option>
                                            ${cityOptions.replace(/selected/g, ``).replace(`value="${billInfo.col_city}"`, `value="${billInfo.col_city}" selected`)}
                                        </select>
                                    </div>
                                    <div class="form-field">
                                        <label class="field-label">Area</label>
                                        <select class="field-select" id="colArea">
                                            <option value="">Select...</option>
                                            ${areaOptions.replace(/selected/g, ``).replace(`value="${billInfo.col_area_id}"`, `value="${billInfo.col_area_id}" selected`)}
                                        </select>
                                    </div>
                                    <div class="form-field span-2">
                                        <label class="field-label">Collection Address</label>
                                        <input type="text" class="field-input" id="colAddress" 
                                            value="${MargaUtils.escapeHtml(billInfo.col_address || '')}">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('formModalBody').innerHTML = html;
    }

    /**
     * Switch to different branch
     */
    function switchBranch(index) {
        // Save current branch data first
        saveCurrentBranchData();
        
        // Switch to new branch
        activeBranchIndex = index;
        renderForm();
    }

    /**
     * Add new branch
     */
    function addBranch() {
        saveCurrentBranchData();
        currentBranches.push(createEmptyBranch());
        currentBillInfo.push(createEmptyBillInfo());
        activeBranchIndex = currentBranches.length - 1;
        isDirty = true;
        renderForm();
    }

    /**
     * Remove branch
     */
    function removeBranch(index) {
        if (currentBranches.length <= 1) {
            MargaUtils.showToast('Cannot remove the only branch', 'error');
            return;
        }
        
        if (!confirm('Are you sure you want to remove this branch?')) return;
        
        currentBranches.splice(index, 1);
        currentBillInfo.splice(index, 1);
        
        if (activeBranchIndex >= currentBranches.length) {
            activeBranchIndex = currentBranches.length - 1;
        }
        
        isDirty = true;
        renderForm();
    }

    /**
     * Save current branch data from form fields
     */
    function saveCurrentBranchData() {
        const branch = currentBranches[activeBranchIndex];
        const billInfo = currentBillInfo[activeBranchIndex];
        
        if (!branch) return;
        
        // Company data (only need to save once)
        currentCompany.companyname = document.getElementById('companyName')?.value || '';
        currentCompany.company_tin = document.getElementById('companyTin')?.value || '';
        currentCompany.business_style = document.getElementById('businessStyle')?.value || '';
        currentCompany.nature_of_business = document.getElementById('natureOfBusiness')?.value || '';
        currentCompany.business_industry = document.getElementById('businessIndustry')?.value || '';
        
        // Branch data
        branch.branchname = document.getElementById('branchName')?.value || '';
        branch.code = document.getElementById('branchCode')?.value || '';
        branch.room = document.getElementById('branchRoom')?.value || '';
        branch.floor = document.getElementById('branchFloor')?.value || '';
        branch.bldg = document.getElementById('branchBldg')?.value || '';
        branch.street = document.getElementById('branchStreet')?.value || '';
        branch.brgy = document.getElementById('branchBrgy')?.value || '';
        branch.city = document.getElementById('branchCity')?.value || '';
        branch.area_id = document.getElementById('branchArea')?.value || '';
        branch.landmark = document.getElementById('branchLandmark')?.value || '';
        branch.signatory = document.getElementById('branchSignatory')?.value || '';
        branch.designation = document.getElementById('branchDesignation')?.value || '';
        branch.email = document.getElementById('branchEmail')?.value || '';
        
        // Delivery data
        branch.delivery_contact = document.getElementById('deliveryContact')?.value || '';
        branch.delivery_num = document.getElementById('deliveryNum')?.value || '';
        branch.delivery_days = document.getElementById('deliveryDays')?.value || '';
        branch.delivery_hours = document.getElementById('deliveryHours')?.value || '';
        branch.delivery_city = document.getElementById('deliveryCity')?.value || '';
        branch.delivery_area_id = document.getElementById('deliveryArea')?.value || '';
        branch.delivery_address = document.getElementById('deliveryAddress')?.value || '';
        
        // Service data
        branch.service_contact = document.getElementById('serviceContact')?.value || '';
        branch.service_num = document.getElementById('serviceNum')?.value || '';
        branch.service_city = document.getElementById('serviceCity')?.value || '';
        branch.service_area_id = document.getElementById('serviceArea')?.value || '';
        branch.service_address = document.getElementById('serviceAddress')?.value || '';

        // Bill info data
        if (billInfo) {
            billInfo.endusername = document.getElementById('endUserName')?.value || '';
            billInfo.endusercontactnum = document.getElementById('endUserContact')?.value || '';
            billInfo.endusercity = document.getElementById('endUserCity')?.value || '';
            billInfo.enduseradd = document.getElementById('endUserAddress')?.value || '';
            billInfo.enduserarea_id = document.getElementById('endUserArea')?.value || '';
            billInfo.acct_contact = document.getElementById('acctContact')?.value || '';
            billInfo.acct_num = document.getElementById('acctNum')?.value || '';
            billInfo.acct_email = document.getElementById('acctEmail')?.value || '';
            billInfo.cashier_contact = document.getElementById('cashierContact')?.value || '';
            billInfo.cashier_num = document.getElementById('cashierNum')?.value || '';
            billInfo.treasury_contact = document.getElementById('treasuryContact')?.value || '';
            billInfo.treasury_num = document.getElementById('treasuryNum')?.value || '';
            billInfo.releasing_contact = document.getElementById('releasingContact')?.value || '';
            billInfo.releasing_num = document.getElementById('releasingNum')?.value || '';
            billInfo.col_days = document.getElementById('colDays')?.value || '';
            billInfo.col_from = document.getElementById('colFrom')?.value || '';
            billInfo.col_to = document.getElementById('colTo')?.value || '';
            billInfo.col_city = document.getElementById('colCity')?.value || '';
            billInfo.col_area_id = document.getElementById('colArea')?.value || '';
            billInfo.col_address = document.getElementById('colAddress')?.value || '';
        }
    }

    /**
     * Copy branch address to delivery
     */
    function copyToDelivery() {
        const branch = currentBranches[activeBranchIndex];
        document.getElementById('deliveryContact').value = branch.signatory || '';
        document.getElementById('deliveryCity').value = branch.city || '';
        document.getElementById('deliveryArea').value = branch.area_id || '';
        
        const address = [branch.room, branch.floor, branch.bldg, branch.street, branch.brgy].filter(Boolean).join(', ');
        document.getElementById('deliveryAddress').value = address;
        
        isDirty = true;
        MargaUtils.showToast('Copied to delivery info', 'success');
    }

    /**
     * Copy branch address to service
     */
    function copyToService() {
        const branch = currentBranches[activeBranchIndex];
        document.getElementById('serviceContact').value = branch.signatory || '';
        document.getElementById('serviceCity').value = branch.city || '';
        document.getElementById('serviceArea').value = branch.area_id || '';
        
        const address = [branch.room, branch.floor, branch.bldg, branch.street, branch.brgy].filter(Boolean).join(', ');
        document.getElementById('serviceAddress').value = address;
        
        isDirty = true;
        MargaUtils.showToast('Copied to service info', 'success');
    }

    /**
     * Collect contract data from form fields
     * @returns {Array} Array of contract updates
     */
    function collectContractData() {
        const contractUpdates = [];
        const contractCards = document.querySelectorAll('.machine-contract-card[data-contract-id]');
        
        contractCards.forEach(card => {
            const contractId = card.dataset.contractId;
            const prefix = `contract_${contractId}`;
            
            // Get all contract fields
            const statusEl = document.getElementById(`${prefix}_status`);
            const categoryEl = document.getElementById(`${prefix}_category`);
            const vatEl = document.getElementById(`${prefix}_vat`);
            const pageRateEl = document.getElementById(`${prefix}_page_rate`);
            const quotaEl = document.getElementById(`${prefix}_quota`);
            const monthlyRateEl = document.getElementById(`${prefix}_monthly_rate`);
            const pageRate2El = document.getElementById(`${prefix}_page_rate2`);
            const quota2El = document.getElementById(`${prefix}_quota2`);
            const monthlyRate2El = document.getElementById(`${prefix}_monthly_rate2`);
            
            if (statusEl) {
                contractUpdates.push({
                    id: contractId,
                    status: parseInt(statusEl.value) || 0,
                    category_id: parseInt(categoryEl?.value) || 0,
                    withvat: parseInt(vatEl?.value) || 0,
                    page_rate: parseFloat(pageRateEl?.value) || 0,
                    monthly_quota: parseInt(quotaEl?.value) || 0,
                    monthly_rate: parseFloat(monthlyRateEl?.value) || 0,
                    page_rate2: parseFloat(pageRate2El?.value) || 0,
                    monthly_quota2: parseInt(quota2El?.value) || 0,
                    monthly_rate2: parseFloat(monthlyRate2El?.value) || 0
                });
            }
        });
        
        return contractUpdates;
    }

    /**
     * Save customer data to Firebase
     */
    async function save() {
        try {
            // Save current form data first
            saveCurrentBranchData();
            
            // Validate
            if (!currentCompany.companyname?.trim()) {
                MargaUtils.showToast('Company name is required', 'error');
                return;
            }
            
            // Show loading state
            const saveBtn = document.getElementById('saveCustomerBtn');
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<div class="spinner"></div> Saving...';
            saveBtn.disabled = true;
            
            const db = firebase.firestore();
            const batch = db.batch();
            
            // Prepare company data
            const companyData = {
                companyname: currentCompany.companyname.trim(),
                company_tin: currentCompany.company_tin || '',
                business_style: currentCompany.business_style || '',
                nature_of_business: currentCompany.nature_of_business || '',
                business_industry: currentCompany.business_industry || '',
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            let companyId;
            
            if (isEditMode && currentCompany.id) {
                // Update existing company
                companyId = currentCompany.id;
                const companyRef = db.collection('tbl_companylist').doc(String(companyId));
                batch.update(companyRef, companyData);
            } else {
                // Create new company - get next ID
                const companiesSnapshot = await db.collection('tbl_companylist')
                    .orderBy('id', 'desc')
                    .limit(1)
                    .get();
                
                companyId = companiesSnapshot.empty ? 1 : (companiesSnapshot.docs[0].data().id || 0) + 1;
                companyData.id = companyId;
                companyData.created_at = firebase.firestore.FieldValue.serverTimestamp();
                
                const companyRef = db.collection('tbl_companylist').doc(String(companyId));
                batch.set(companyRef, companyData);
            }
            
            // Save branches
            for (let i = 0; i < currentBranches.length; i++) {
                const branch = currentBranches[i];
                const billInfo = currentBillInfo[i];
                
                const branchData = {
                    company_id: companyId,
                    branchname: branch.branchname || '',
                    code: branch.code || '',
                    room: branch.room || '',
                    floor: branch.floor || '',
                    bldg: branch.bldg || '',
                    street: branch.street || '',
                    brgy: branch.brgy || '',
                    city: branch.city || '',
                    area_id: branch.area_id ? parseInt(branch.area_id) : null,
                    landmark: branch.landmark || '',
                    signatory: branch.signatory || '',
                    designation: branch.designation || '',
                    email: branch.email || '',
                    delivery_contact: branch.delivery_contact || '',
                    delivery_num: branch.delivery_num || '',
                    delivery_days: branch.delivery_days || '',
                    delivery_hours: branch.delivery_hours || '',
                    delivery_city: branch.delivery_city || '',
                    delivery_area_id: branch.delivery_area_id ? parseInt(branch.delivery_area_id) : null,
                    delivery_address: branch.delivery_address || '',
                    service_contact: branch.service_contact || '',
                    service_num: branch.service_num || '',
                    service_city: branch.service_city || '',
                    service_area_id: branch.service_area_id ? parseInt(branch.service_area_id) : null,
                    service_address: branch.service_address || '',
                    inactive: branch.inactive || false,
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                };

                let branchId;
                
                if (branch.id) {
                    // Update existing branch
                    branchId = branch.id;
                    const branchRef = db.collection('tbl_branchinfo').doc(String(branchId));
                    batch.update(branchRef, branchData);
                } else {
                    // Create new branch
                    const branchesSnapshot = await db.collection('tbl_branchinfo')
                        .orderBy('id', 'desc')
                        .limit(1)
                        .get();
                    
                    branchId = branchesSnapshot.empty ? 1 : (branchesSnapshot.docs[0].data().id || 0) + 1;
                    branchData.id = branchId;
                    branchData.created_at = firebase.firestore.FieldValue.serverTimestamp();
                    
                    const branchRef = db.collection('tbl_branchinfo').doc(String(branchId));
                    batch.set(branchRef, branchData);
                }
                
                // Save bill info
                const billInfoData = {
                    branch_id: branchId,
                    endusername: billInfo.endusername || '',
                    endusercontactnum: billInfo.endusercontactnum || '',
                    endusercity: billInfo.endusercity || '',
                    enduseradd: billInfo.enduseradd || '',
                    enduserarea_id: billInfo.enduserarea_id ? parseInt(billInfo.enduserarea_id) : null,
                    acct_contact: billInfo.acct_contact || '',
                    acct_num: billInfo.acct_num || '',
                    acct_email: billInfo.acct_email || '',
                    cashier_contact: billInfo.cashier_contact || '',
                    cashier_num: billInfo.cashier_num || '',
                    treasury_contact: billInfo.treasury_contact || '',
                    treasury_num: billInfo.treasury_num || '',
                    releasing_contact: billInfo.releasing_contact || '',
                    releasing_num: billInfo.releasing_num || '',
                    col_days: billInfo.col_days || '',
                    col_from: billInfo.col_from || '',
                    col_to: billInfo.col_to || '',
                    col_city: billInfo.col_city || '',
                    col_area_id: billInfo.col_area_id ? parseInt(billInfo.col_area_id) : null,
                    col_address: billInfo.col_address || '',
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                if (billInfo.id) {
                    // Update existing bill info
                    const billRef = db.collection('tbl_billinfo').doc(String(billInfo.id));
                    batch.update(billRef, billInfoData);
                } else {
                    // Create new bill info
                    const billSnapshot = await db.collection('tbl_billinfo')
                        .orderBy('id', 'desc')
                        .limit(1)
                        .get();
                    
                    const billId = billSnapshot.empty ? 1 : (billSnapshot.docs[0].data().id || 0) + 1;
                    billInfoData.id = billId;
                    billInfoData.created_at = firebase.firestore.FieldValue.serverTimestamp();
                    
                    const billRef = db.collection('tbl_billinfo').doc(String(billId));
                    batch.set(billRef, billInfoData);
                }
            }
            
            // Save contract updates (if any)
            const contractUpdates = collectContractData();
            for (const contractData of contractUpdates) {
                const contractRef = db.collection('tbl_contractmain').doc(String(contractData.id));
                batch.update(contractRef, {
                    status: contractData.status,
                    category_id: contractData.category_id,
                    withvat: contractData.withvat,
                    page_rate: contractData.page_rate,
                    monthly_quota: contractData.monthly_quota,
                    monthly_rate: contractData.monthly_rate,
                    page_rate2: contractData.page_rate2,
                    monthly_quota2: contractData.monthly_quota2,
                    monthly_rate2: contractData.monthly_rate2,
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            // Commit batch
            await batch.commit();
            
            MargaUtils.showToast(isEditMode ? 'Customer updated successfully' : 'Customer created successfully', 'success');
            isDirty = false;
            close();
            
            // Reload data in main module
            if (typeof loadAllData === 'function') {
                loadAllData();
            }
            
        } catch (error) {
            console.error('Error saving customer:', error);
            MargaUtils.showToast('Failed to save customer: ' + error.message, 'error');
        } finally {
            const saveBtn = document.getElementById('saveCustomerBtn');
            if (saveBtn) {
                saveBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                        <polyline points="17,21 17,13 7,13 7,21"/>
                        <polyline points="7,3 7,8 15,8"/>
                    </svg>
                    Save Customer
                `;
                saveBtn.disabled = false;
            }
        }
    }

    /**
     * Show modal
     */
    function showModal() {
        document.getElementById('customerFormOverlay').classList.add('visible');
        document.getElementById('customerFormModal').classList.add('visible');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Close modal
     */
    function close() {
        if (isDirty) {
            if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
                return;
            }
        }
        
        document.getElementById('customerFormOverlay').classList.remove('visible');
        document.getElementById('customerFormModal').classList.remove('visible');
        document.body.style.overflow = '';
        
        // Reset state
        currentCompany = null;
        currentBranches = [];
        currentBillInfo = [];
        activeBranchIndex = 0;
        isDirty = false;
    }

    // Public API
    return {
        init,
        openNew,
        openEdit,
        openEditBranch,
        addBranch,
        removeBranch,
        copyToDelivery,
        copyToService,
        save,
        close
    };
})();

/**
 * Open form for editing existing customer at specific branch
 */
function openEditBranch(company, branches, billInfo, branchIndex) {
    CustomerForm.openEdit(company, branches, billInfo);
    // Switch to the specific branch after a short delay to let the form render
    setTimeout(() => {
        if (typeof switchBranch === 'function') {
            switchBranch(branchIndex);
        }
    }, 100);
}

// Add to CustomerForm
CustomerForm.openEditBranch = function(company, branches, billInfo, branchIndex) {
    this.openEdit(company, branches, billInfo);
    // We need to access the internal switchBranch - let's set the active index before rendering
    setTimeout(() => {
        const tabs = document.querySelectorAll('#branchTabs .branch-tab:not(.branch-tab-add)');
        if (tabs[branchIndex]) {
            tabs[branchIndex].click();
        }
    }, 100);
};

// Make globally available
window.CustomerForm = CustomerForm;
