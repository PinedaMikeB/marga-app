/**
 * MARGA Billing Module
 * Handles meter readings, invoice generation, and billing calculations
 */

// Global state
let billingData = {
    contracts: [],
    branches: [],
    companies: [],
    machines: [],
    models: [],
    brands: [],
    categories: [],
    readings: [],
    invoices: []
};

let selectedContract = null;
let currentInvoice = {
    invoiceNumber: '',
    billingMonth: null,
    billingYear: null,
    presentReading: 0,
    previousReading: 0,
    presentDate: null,
    previousDate: null
};

let printPosition = { x: 0, y: 0 };

/**
 * Initialize billing module
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth
    if (typeof MargaAuth !== 'undefined') {
        MargaAuth.init();
    }
    
    // Set today's date
    const today = new Date();
    document.getElementById('billingDate').value = today.toISOString().split('T')[0];
    
    // Populate year dropdowns
    populateYearDropdowns();
    
    // Set default month to current
    const currentMonth = today.getMonth() + 1;
    document.getElementById('billingMonth').value = currentMonth;
    
    // Load billing data
    await loadBillingData();
    
    // Update display
    updateReadingDayBadge();
    renderForReadingTable();
    
    // Add date change listener
    document.getElementById('billingDate').addEventListener('change', () => {
        updateReadingDayBadge();
        renderForReadingTable();
    });
});

/**
 * Populate year dropdowns
 */
function populateYearDropdowns() {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];
    
    ['billingYear', 'rdYear'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            if (select.tagName === 'SELECT') {
                select.innerHTML = years.map(y => 
                    `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`
                ).join('');
            } else {
                select.value = currentYear;
            }
        }
    });
}

/**
 * Load all billing-related data from Firebase
 */
async function loadBillingData() {
    try {
        const db = firebase.firestore();
        
        // Load all required collections in parallel
        const [
            contractsSnap,
            branchesSnap,
            companiesSnap,
            machinesSnap,
            modelsSnap,
            brandsSnap,
            categoriesSnap
        ] = await Promise.all([
            db.collection('tbl_contractmain').where('status', '==', 1).get(),
            db.collection('tbl_branchinfo').get(),
            db.collection('tbl_companylist').get(),
            db.collection('tbl_machine').get(),
            db.collection('tbl_model').get(),
            db.collection('tbl_brand').get(),
            db.collection('tbl_particulars').get()
        ]);
        
        billingData.contracts = contractsSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.branches = branchesSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.companies = companiesSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.machines = machinesSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.models = modelsSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.brands = brandsSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        billingData.categories = categoriesSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        
        // Try to load readings if collection exists
        try {
            const readingsSnap = await db.collection('tbl_readings').get();
            billingData.readings = readingsSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        } catch (e) {
            billingData.readings = [];
        }
        
        // Update stats
        updateBillingStats();
        
        console.log('Billing data loaded:', {
            contracts: billingData.contracts.length,
            branches: billingData.branches.length,
            companies: billingData.companies.length
        });
        
    } catch (error) {
        console.error('Error loading billing data:', error);
        showToast('Error loading billing data', 'error');
    }
}


/**
 * Update billing statistics
 */
function updateBillingStats() {
    const today = new Date();
    const todayDay = today.getDate();
    
    // Count contracts for today's reading day
    const forReadingToday = billingData.contracts.filter(c => {
        const branch = billingData.branches.find(b => b.id == c.contract_id);
        return branch && parseInt(branch.reading_date) === todayDay;
    }).length;
    
    document.getElementById('totalForReading').textContent = forReadingToday;
    document.getElementById('forReadingCount').textContent = billingData.contracts.length;
    
    // Completed today (would need readings collection)
    document.getElementById('completedToday').textContent = '0';
    
    // Pending invoices
    document.getElementById('pendingInvoices').textContent = '0';
    
    // Total billed this month
    document.getElementById('totalBilledMonth').textContent = '₱0';
}

/**
 * Update reading day badge based on selected date
 */
function updateReadingDayBadge() {
    const dateInput = document.getElementById('billingDate');
    const date = new Date(dateInput.value);
    const day = date.getDate();
    document.getElementById('readingDayBadge').textContent = `Day ${day}`;
}

/**
 * Render the For Reading table
 */
function renderForReadingTable() {
    const tbody = document.getElementById('forReadingBody');
    const dateInput = document.getElementById('billingDate');
    const selectedDate = new Date(dateInput.value);
    const selectedDay = selectedDate.getDate();
    
    // Build contract data with all related info
    const contractsWithInfo = billingData.contracts.map(contract => {
        const branch = billingData.branches.find(b => b.id == contract.contract_id);
        const company = branch ? billingData.companies.find(c => c.id == branch.company_id) : null;
        const machine = billingData.machines.find(m => m.id == contract.mach_id);
        const model = machine ? billingData.models.find(m => m.id == machine.model_id) : null;
        const brand = machine ? billingData.brands.find(b => b.id == machine.brand_id) : null;
        const category = billingData.categories.find(c => c.id == contract.category_id);
        
        return {
            ...contract,
            branch,
            company,
            machine,
            model,
            brand,
            category,
            readingDay: branch ? parseInt(branch.reading_date) || 0 : 0
        };
    });
    
    // Sort: today's reading day first, then by reading day ascending
    contractsWithInfo.sort((a, b) => {
        const aIsToday = a.readingDay === selectedDay ? 0 : 1;
        const bIsToday = b.readingDay === selectedDay ? 0 : 1;
        if (aIsToday !== bIsToday) return aIsToday - bIsToday;
        return a.readingDay - b.readingDay;
    });
    
    if (contractsWithInfo.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No active contracts found</td></tr>`;
        return;
    }
    
    tbody.innerHTML = contractsWithInfo.map(c => {
        const isToday = c.readingDay === selectedDay;
        const categoryCode = c.category?.particular_code || c.category?.code || 'N/A';
        const categoryClass = categoryCode.toLowerCase();
        
        // Determine contract status display
        let statusText = 'Active';
        let statusClass = 'active';
        if (c.status === 7 || c.status === 2) {
            statusText = 'For Termination';
            statusClass = 'for-termination';
        }
        
        // Format install date
        const installDate = c.date_installed ? formatDate(c.date_installed) : 'N/A';
        
        return `
            <tr class="${isToday ? 'today-reading' : ''}" onclick="selectContract(${c.id})">
                <td><strong>${c.readingDay || '-'}</strong></td>
                <td><span class="category-badge ${categoryClass}">${categoryCode}</span></td>
                <td class="client-cell">
                    <div class="client-name">${escapeHtml(c.company?.companyname || 'Unknown')}</div>
                    <div class="branch-name">${escapeHtml(c.branch?.branchname || '')}</div>
                </td>
                <td>${escapeHtml(c.model?.modelname || c.machine?.description || 'N/A')}</td>
                <td><code>${escapeHtml(c.machine?.serial || c.xserial || 'N/A')}</code></td>
                <td><span class="contract-status ${statusClass}">${statusText}</span></td>
                <td>${installDate}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Format date helper
 */
function formatDate(dateVal) {
    if (!dateVal) return 'N/A';
    try {
        // Handle Firestore timestamp
        if (dateVal.toDate) {
            return dateVal.toDate().toLocaleDateString('en-CA');
        }
        // Handle string date
        const date = new Date(dateVal);
        if (isNaN(date)) return 'N/A';
        return date.toLocaleDateString('en-CA');
    } catch {
        return 'N/A';
    }
}

/**
 * Escape HTML helper
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


/**
 * Select a contract to bill
 */
function selectContract(contractId) {
    selectedContract = billingData.contracts.find(c => c.id == contractId);
    if (!selectedContract) {
        showToast('Contract not found', 'error');
        return;
    }
    
    // Get related info
    const branch = billingData.branches.find(b => b.id == selectedContract.contract_id);
    const company = branch ? billingData.companies.find(c => c.id == branch.company_id) : null;
    const machine = billingData.machines.find(m => m.id == selectedContract.mach_id);
    const model = machine ? billingData.models.find(m => m.id == machine.model_id) : null;
    const category = billingData.categories.find(c => c.id == selectedContract.category_id);
    
    selectedContract.branch = branch;
    selectedContract.company = company;
    selectedContract.machine = machine;
    selectedContract.model = model;
    selectedContract.category = category;
    
    // Populate contract info in modal
    const infoDiv = document.getElementById('selectedContractInfo');
    infoDiv.innerHTML = `
        <div class="contract-info-row">
            <span class="contract-info-label">Client</span>
            <span class="contract-info-value">${escapeHtml(company?.companyname || 'Unknown')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Branch</span>
            <span class="contract-info-value">${escapeHtml(branch?.branchname || 'N/A')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Model / Serial</span>
            <span class="contract-info-value">${escapeHtml(model?.modelname || machine?.description || 'N/A')} / ${escapeHtml(machine?.serial || 'N/A')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Category</span>
            <span class="contract-info-value">${escapeHtml(category?.particular_code || category?.code || 'N/A')} - ${escapeHtml(category?.particular_desc || category?.name || '')}</span>
        </div>
    `;
    
    // Show invoice number modal
    openInvoiceModal();
}

/**
 * Open invoice number modal
 */
function openInvoiceModal() {
    document.getElementById('invoiceNumber').value = '';
    document.getElementById('invoiceModalOverlay').classList.add('visible');
    document.getElementById('invoiceModal').classList.add('visible');
    document.getElementById('invoiceNumber').focus();
}

/**
 * Close invoice number modal
 */
function closeInvoiceModal() {
    document.getElementById('invoiceModalOverlay').classList.remove('visible');
    document.getElementById('invoiceModal').classList.remove('visible');
}

/**
 * Proceed to reading modal after entering invoice number
 */
function proceedToReading() {
    const invoiceNumber = document.getElementById('invoiceNumber').value.trim();
    const billingMonth = parseInt(document.getElementById('billingMonth').value);
    const billingYear = parseInt(document.getElementById('billingYear').value);
    
    if (!invoiceNumber) {
        showToast('Please enter an invoice number', 'error');
        document.getElementById('invoiceNumber').focus();
        return;
    }
    
    currentInvoice.invoiceNumber = invoiceNumber;
    currentInvoice.billingMonth = billingMonth;
    currentInvoice.billingYear = billingYear;
    
    closeInvoiceModal();
    openReadingModal();
}

/**
 * Open reading modal
 */
function openReadingModal() {
    const category = selectedContract.category;
    const categoryCode = category?.particular_code || category?.code || '';
    
    // Populate contract info
    document.getElementById('rdCompanyName').textContent = selectedContract.company?.companyname || 'N/A';
    document.getElementById('rdBranch').textContent = selectedContract.branch?.branchname || 'N/A';
    document.getElementById('rdCategory').textContent = categoryCode;
    document.getElementById('rdInvoiceNum').textContent = currentInvoice.invoiceNumber;
    document.getElementById('rdModel').textContent = selectedContract.model?.modelname || selectedContract.machine?.description || 'N/A';
    document.getElementById('rdSerial').textContent = selectedContract.machine?.serial || 'N/A';
    
    // Set month/year
    document.getElementById('rdMonth').value = currentInvoice.billingMonth;
    const rdYear = document.getElementById('rdYear');
    if (rdYear) rdYear.value = currentInvoice.billingYear;
    
    // Set dates
    const today = new Date();
    document.getElementById('rdPresentDate').value = today.toISOString().split('T')[0];
    
    // Get previous reading date (from last reading or estimate)
    const prevDate = new Date(today);
    prevDate.setMonth(prevDate.getMonth() - 1);
    document.getElementById('rdPreviousDate').value = prevDate.toISOString().split('T')[0];
    
    // Populate contract rates
    document.getElementById('rdQuota').value = selectedContract.monthly_quota || 0;
    document.getElementById('rdPageRate').value = selectedContract.page_rate || 0;
    document.getElementById('rdExceedRate').value = selectedContract.exceed_rate || selectedContract.page_rate || 0;
    
    // Get previous reading
    const prevReading = getLastReading(selectedContract.id);
    document.getElementById('rdPreviousMeter').value = prevReading;
    document.getElementById('rdPresentMeter').value = '';
    
    // Check if RTF (fixed rate - no reading needed)
    const isFixedRate = ['RTF', 'RTC', 'MAT', 'STC', 'MAC', 'REF', 'RD', 'PI', 'OTH'].includes(categoryCode);
    
    if (isFixedRate) {
        // For fixed rate, just show the monthly rate
        document.getElementById('rdPresentMeter').disabled = true;
        document.getElementById('rdPresentMeter').value = 'N/A';
        document.getElementById('rdNetAmount').value = selectedContract.monthly_rate || 0;
        calculateFixedRateBilling();
    } else {
        document.getElementById('rdPresentMeter').disabled = false;
        document.getElementById('rdPresentMeter').value = '';
    }
    
    // Reset calculations
    document.getElementById('rdGrossTotal').value = '';
    document.getElementById('rdSpoilageAmt').value = '';
    document.getElementById('rdNetConsumption').value = '';
    document.getElementById('rdVat').value = '';
    document.getElementById('rdNetAmount').value = '';
    document.getElementById('rdDiscount').value = '0';
    document.getElementById('rdAmountDue').textContent = '₱0.00';
    document.getElementById('rdRemarks').value = '';
    
    // Show modal
    document.getElementById('readingModalOverlay').classList.add('visible');
    document.getElementById('readingModal').classList.add('visible');
    
    if (!isFixedRate) {
        document.getElementById('rdPresentMeter').focus();
    }
}

/**
 * Close reading modal
 */
function closeReadingModal() {
    document.getElementById('readingModalOverlay').classList.remove('visible');
    document.getElementById('readingModal').classList.remove('visible');
}

/**
 * Get last reading for a contract
 */
function getLastReading(contractId) {
    // Find the most recent reading for this contract
    const readings = billingData.readings.filter(r => r.contract_id == contractId);
    if (readings.length === 0) return 0;
    
    // Sort by date descending
    readings.sort((a, b) => {
        const dateA = a.reading_date?.toDate?.() || new Date(a.reading_date);
        const dateB = b.reading_date?.toDate?.() || new Date(b.reading_date);
        return dateB - dateA;
    });
    
    return readings[0].present_reading || 0;
}


/**
 * Calculate billing based on meter reading
 * This handles RTP, MAP, STP categories
 */
function calculateBilling() {
    const presentReading = parseFloat(document.getElementById('rdPresentMeter').value) || 0;
    const previousReading = parseFloat(document.getElementById('rdPreviousMeter').value) || 0;
    const quota = parseFloat(document.getElementById('rdQuota').value) || 0;
    const pageRate = parseFloat(document.getElementById('rdPageRate').value) || 0;
    const exceedRate = parseFloat(document.getElementById('rdExceedRate').value) || pageRate;
    const discount = parseFloat(document.getElementById('rdDiscount').value) || 0;
    const applySpoilage = document.getElementById('rdSpoilage').checked;
    const isVatInclusive = selectedContract.withvat == 1;
    
    // Calculate gross consumption
    const grossConsumption = Math.max(0, presentReading - previousReading);
    document.getElementById('rdGrossTotal').value = grossConsumption;
    
    // Calculate spoilage (2% of gross)
    let spoilage = 0;
    if (applySpoilage && grossConsumption > 0) {
        spoilage = Math.round(grossConsumption * 0.02);
    }
    document.getElementById('rdSpoilageAmt').value = spoilage;
    
    // Net consumption after spoilage
    const netConsumption = grossConsumption - spoilage;
    document.getElementById('rdNetConsumption').value = netConsumption;
    
    // Calculate amount
    let amount = 0;
    
    if (quota > 0) {
        if (netConsumption <= quota) {
            // Within quota - charge minimum (quota * page rate)
            amount = quota * pageRate;
        } else {
            // Exceeds quota
            const withinQuota = quota * pageRate;
            const excessPages = netConsumption - quota;
            const excessAmount = excessPages * exceedRate;
            amount = withinQuota + excessAmount;
        }
    } else {
        // No quota - just multiply consumption by rate
        amount = netConsumption * pageRate;
    }
    
    // Handle VAT
    let vatAmount = 0;
    let netAmount = amount;
    
    if (isVatInclusive) {
        // VAT is included in the amount, calculate breakdown
        // Amount = Net + 12% VAT, so Net = Amount / 1.12
        netAmount = amount / 1.12;
        vatAmount = amount - netAmount;
    }
    
    document.getElementById('rdVat').value = vatAmount.toFixed(2);
    document.getElementById('rdNetAmount').value = netAmount.toFixed(2);
    
    // Final amount due (after discount)
    const amountDue = amount - discount;
    document.getElementById('rdAmountDue').textContent = formatCurrency(amountDue);
    
    // Store for invoice
    currentInvoice.presentReading = presentReading;
    currentInvoice.previousReading = previousReading;
    currentInvoice.grossConsumption = grossConsumption;
    currentInvoice.spoilage = spoilage;
    currentInvoice.netConsumption = netConsumption;
    currentInvoice.vatAmount = vatAmount;
    currentInvoice.netAmount = netAmount;
    currentInvoice.discount = discount;
    currentInvoice.amountDue = amountDue;
    currentInvoice.isVatInclusive = isVatInclusive;
}

/**
 * Calculate billing for fixed rate (RTF)
 */
function calculateFixedRateBilling() {
    const monthlyRate = parseFloat(selectedContract.monthly_rate) || 0;
    const discount = parseFloat(document.getElementById('rdDiscount').value) || 0;
    const isVatInclusive = selectedContract.withvat == 1;
    
    let vatAmount = 0;
    let netAmount = monthlyRate;
    
    if (isVatInclusive) {
        netAmount = monthlyRate / 1.12;
        vatAmount = monthlyRate - netAmount;
    }
    
    document.getElementById('rdVat').value = vatAmount.toFixed(2);
    document.getElementById('rdNetAmount').value = netAmount.toFixed(2);
    
    const amountDue = monthlyRate - discount;
    document.getElementById('rdAmountDue').textContent = formatCurrency(amountDue);
    
    // Store for invoice
    currentInvoice.presentReading = 0;
    currentInvoice.previousReading = 0;
    currentInvoice.grossConsumption = 0;
    currentInvoice.spoilage = 0;
    currentInvoice.netConsumption = 0;
    currentInvoice.vatAmount = vatAmount;
    currentInvoice.netAmount = netAmount;
    currentInvoice.discount = discount;
    currentInvoice.amountDue = amountDue;
    currentInvoice.isVatInclusive = isVatInclusive;
    currentInvoice.isFixedRate = true;
}

/**
 * Format currency
 */
function formatCurrency(amount) {
    return '₱' + parseFloat(amount).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Load previous reading from database
 */
async function loadPreviousReading() {
    showToast('Loading previous reading...', 'info');
    
    try {
        const db = firebase.firestore();
        const readingsSnap = await db.collection('tbl_readings')
            .where('contract_id', '==', selectedContract.id)
            .orderBy('reading_date', 'desc')
            .limit(1)
            .get();
        
        if (!readingsSnap.empty) {
            const lastReading = readingsSnap.docs[0].data();
            document.getElementById('rdPreviousMeter').value = lastReading.present_reading || 0;
            
            if (lastReading.reading_date) {
                const date = lastReading.reading_date.toDate ? 
                    lastReading.reading_date.toDate() : new Date(lastReading.reading_date);
                document.getElementById('rdPreviousDate').value = date.toISOString().split('T')[0];
            }
            
            showToast('Previous reading loaded', 'success');
        } else {
            showToast('No previous reading found', 'info');
        }
    } catch (error) {
        console.error('Error loading reading:', error);
        showToast('Error loading previous reading', 'error');
    }
}


/**
 * Show print preview modal
 */
function printInvoicePreview() {
    // Validate we have calculation done
    if (currentInvoice.amountDue === undefined) {
        showToast('Please complete the billing calculation first', 'error');
        return;
    }
    
    // Generate invoice preview
    renderInvoicePreview();
    
    // Show print modal
    document.getElementById('printModalOverlay').classList.add('visible');
    document.getElementById('printModal').classList.add('visible');
}

/**
 * Close print modal
 */
function closePrintModal() {
    document.getElementById('printModalOverlay').classList.remove('visible');
    document.getElementById('printModal').classList.remove('visible');
}

/**
 * Render invoice preview for printing
 */
function renderInvoicePreview() {
    const preview = document.getElementById('invoicePreview');
    const branch = selectedContract.branch;
    const company = selectedContract.company;
    const category = selectedContract.category;
    const categoryCode = category?.particular_code || category?.code || '';
    
    // Get billing date
    const billingDate = new Date();
    const formattedDate = billingDate.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
    
    // Calculate due date (5 days from now or as configured)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5);
    const formattedDueDate = dueDate.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
    
    // Format address
    const address = formatBranchAddress(branch);
    
    // Description text
    let description = '';
    if (currentInvoice.isFixedRate) {
        description = 'Fixed Monthly Rate';
    } else if (currentInvoice.netConsumption > 0) {
        description = `Meter Reading: ${currentInvoice.previousReading} to ${currentInvoice.presentReading}`;
    }
    
    preview.innerHTML = `
        <div class="invoice-content" style="transform: translate(${printPosition.x}mm, ${printPosition.y}mm);">
            <div class="inv-row">
                <div class="inv-client-name">${escapeHtml(company?.companyname || '')} - ${escapeHtml(branch?.branchname || '')}</div>
                <div class="inv-date">${formattedDate}</div>
            </div>
            
            <div class="inv-tin">${escapeHtml(company?.company_tin || '')}</div>
            
            <div class="inv-row">
                <div class="inv-address">${escapeHtml(address)}</div>
                <div class="inv-category">${categoryCode}</div>
            </div>
            
            <div class="inv-business-style">Business Style : ${escapeHtml(company?.business_style || '')}</div>
            
            <div class="inv-model">Printer Model   ${escapeHtml(selectedContract.model?.modelname || selectedContract.machine?.description || '')}   ${escapeHtml(selectedContract.machine?.serial || '')}</div>
            
            <div class="inv-description">${description}</div>
            
            <div class="inv-amounts">
                ${currentInvoice.isVatInclusive ? `
                    <div class="inv-amount-row">
                        <span class="inv-amount-label">Total Sales (VAT Inclusive) :</span>
                        <span class="inv-amount-value">${formatCurrency(currentInvoice.amountDue + currentInvoice.discount)}</span>
                    </div>
                    <div class="inv-amount-row">
                        <span class="inv-amount-label">Less VAT :</span>
                        <span class="inv-amount-value">${formatCurrency(currentInvoice.vatAmount)}</span>
                    </div>
                    <div class="inv-amount-row">
                        <span class="inv-amount-label">Amount net of VAT :</span>
                        <span class="inv-amount-value">${formatCurrency(currentInvoice.netAmount)}</span>
                    </div>
                ` : `
                    <div class="inv-amount-row">
                        <span class="inv-amount-label">Amount :</span>
                        <span class="inv-amount-value">${formatCurrency(currentInvoice.netAmount)}</span>
                    </div>
                `}
                ${currentInvoice.discount > 0 ? `
                    <div class="inv-amount-row">
                        <span class="inv-amount-label">Less Discount :</span>
                        <span class="inv-amount-value">${formatCurrency(currentInvoice.discount)}</span>
                    </div>
                ` : ''}
                <div class="inv-amount-row inv-total-row">
                    <span class="inv-amount-label">TOTAL AMOUNT :</span>
                    <span class="inv-amount-value">${formatCurrency(currentInvoice.amountDue)}</span>
                </div>
                <div class="inv-amount-row inv-due-date">
                    <span class="inv-amount-label">DUE DATE :</span>
                    <span class="inv-amount-value">${formattedDueDate}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Format branch address
 */
function formatBranchAddress(branch) {
    if (!branch) return '';
    const parts = [
        branch.room,
        branch.floor,
        branch.bldg,
        branch.street,
        branch.brgy,
        branch.city_name || ''
    ].filter(Boolean);
    return parts.join(' ');
}

/**
 * Adjust print position for alignment
 */
function adjustPrintPosition(dx, dy) {
    printPosition.x += dx;
    printPosition.y += dy;
    document.getElementById('posX').textContent = printPosition.x;
    document.getElementById('posY').textContent = printPosition.y;
    renderInvoicePreview();
}

/**
 * Reset print position
 */
function resetPrintPosition() {
    printPosition = { x: 0, y: 0 };
    document.getElementById('posX').textContent = '0';
    document.getElementById('posY').textContent = '0';
    renderInvoicePreview();
}


/**
 * Confirm and save billing
 */
async function confirmBilling() {
    // Validate
    if (currentInvoice.amountDue === undefined) {
        showToast('Please complete the billing calculation first', 'error');
        return;
    }
    
    try {
        const db = firebase.firestore();
        
        // Prepare reading data
        const readingData = {
            contract_id: selectedContract.id,
            invoice_number: currentInvoice.invoiceNumber,
            billing_month: currentInvoice.billingMonth,
            billing_year: currentInvoice.billingYear,
            present_reading: currentInvoice.presentReading,
            previous_reading: currentInvoice.previousReading,
            gross_consumption: currentInvoice.grossConsumption,
            spoilage: currentInvoice.spoilage,
            net_consumption: currentInvoice.netConsumption,
            vat_amount: currentInvoice.vatAmount,
            net_amount: currentInvoice.netAmount,
            discount: currentInvoice.discount,
            amount_due: currentInvoice.amountDue,
            is_vat_inclusive: currentInvoice.isVatInclusive,
            is_fixed_rate: currentInvoice.isFixedRate || false,
            reading_date: firebase.firestore.Timestamp.now(),
            present_date: document.getElementById('rdPresentDate').value,
            previous_date: document.getElementById('rdPreviousDate').value,
            remarks: document.getElementById('rdRemarks').value,
            created_by: firebase.auth().currentUser?.email || 'unknown',
            created_at: firebase.firestore.Timestamp.now(),
            status: 'pending' // pending, paid, cancelled
        };
        
        // Save to Firebase
        await db.collection('tbl_readings').add(readingData);
        
        showToast('Billing saved successfully!', 'success');
        closeReadingModal();
        
        // Refresh data
        await loadBillingData();
        renderForReadingTable();
        
    } catch (error) {
        console.error('Error saving billing:', error);
        showToast('Error saving billing: ' + error.message, 'error');
    }
}

/**
 * Print invoice
 */
function printInvoice() {
    // Save first, then print
    confirmBilling().then(() => {
        window.print();
        closePrintModal();
    });
}

/**
 * Refresh pending invoices
 */
async function refreshPendingInvoices() {
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('tbl_readings')
            .where('status', '==', 'pending')
            .orderBy('created_at', 'desc')
            .limit(50)
            .get();
        
        const tbody = document.getElementById('pendingInvoicesBody');
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No pending invoices</td></tr>';
            return;
        }
        
        const invoices = snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
        
        tbody.innerHTML = invoices.map(inv => {
            // Calculate age in days
            const createdAt = inv.created_at?.toDate() || new Date();
            const age = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
            
            let ageClass = 'recent';
            if (age > 30) ageClass = 'old';
            else if (age > 14) ageClass = 'medium';
            
            // Get contract info
            const contract = billingData.contracts.find(c => c.id == inv.contract_id);
            const branch = contract ? billingData.branches.find(b => b.id == contract.contract_id) : null;
            const company = branch ? billingData.companies.find(c => c.id == branch.company_id) : null;
            
            return `
                <tr class="pending-invoice-row" onclick="viewInvoice('${inv.docId}')">
                    <td><strong>${escapeHtml(inv.invoice_number)}</strong></td>
                    <td><span class="invoice-age ${ageClass}">${age}</span></td>
                    <td>${escapeHtml(company?.companyname || 'Unknown')}</td>
                </tr>
            `;
        }).join('');
        
        document.getElementById('pendingInvoices').textContent = invoices.length;
        
    } catch (error) {
        console.error('Error loading pending invoices:', error);
    }
}

/**
 * View invoice details
 */
function viewInvoice(docId) {
    // TODO: Implement invoice detail view
    showToast('Invoice view coming soon', 'info');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    // Remove existing toast
    const existing = document.querySelector('.billing-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `billing-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

/**
 * Update reading dates based on month selection
 */
function updateReadingDates() {
    // This can be customized based on your reading schedule logic
}
