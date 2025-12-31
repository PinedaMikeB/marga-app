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
    invoices: [],
    billingStatus: [] // Track billing status per contract/month
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
let currentFilter = 'all'; // all, today, unbilled
let contractsWithInfo = []; // Cached enriched contracts

/**
 * Initialize Firebase if not already done
 */
function initFirebase() {
    if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
    }
    return firebase.firestore();
}

/**
 * Initialize billing module
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase first
    initFirebase();
    
    // Check auth
    if (typeof MargaAuth !== 'undefined') {
        MargaAuth.init();
    }
    
    // Set today's date in header
    const today = new Date();
    document.getElementById('billingDate').value = today.toISOString().split('T')[0];
    
    // Set default date range filter (current month)
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    document.getElementById('filterDateFrom').value = firstOfMonth.toISOString().split('T')[0];
    document.getElementById('filterDateTo').value = lastOfMonth.toISOString().split('T')[0];
    
    // Populate year dropdowns
    populateYearDropdowns();
    
    // Set default month to current
    const currentMonth = today.getMonth() + 1;
    document.getElementById('billingMonth').value = currentMonth;
    
    // Load billing data
    await loadBillingData();
    
    // Update display
    renderForReadingTable();
    
    // Add date change listener for header date
    document.getElementById('billingDate').addEventListener('change', () => {
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
        const db = initFirebase();
        
        console.log('Loading billing data...');
        
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
        
        // Build enriched contracts list
        buildContractsWithInfo();
        
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
 * Build enriched contracts with all related info
 */
function buildContractsWithInfo() {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    contractsWithInfo = billingData.contracts.map(contract => {
        const branch = billingData.branches.find(b => b.id == contract.contract_id);
        const company = branch ? billingData.companies.find(c => c.id == branch.company_id) : null;
        const machine = billingData.machines.find(m => m.id == contract.mach_id);
        const model = machine ? billingData.models.find(m => m.id == machine.model_id) : null;
        const brand = machine ? billingData.brands.find(b => b.id == machine.brand_id) : null;
        const category = billingData.categories.find(c => c.id == contract.category_id);
        
        // Get reading day from branch or contract
        const readingDay = parseInt(branch?.reading_date) || parseInt(contract?.reading_day) || 0;
        
        // Check if this contract has been billed this month
        const billedThisMonth = billingData.readings.some(r => 
            r.contract_id == contract.id && 
            r.billing_month == currentMonth && 
            r.billing_year == currentYear
        );
        
        // Get last reading for this contract
        const lastReading = billingData.readings
            .filter(r => r.contract_id == contract.id)
            .sort((a, b) => {
                const dateA = a.created_at?.toDate?.() || new Date(0);
                const dateB = b.created_at?.toDate?.() || new Date(0);
                return dateB - dateA;
            })[0];
        
        // Determine billing status
        let billingStatus = 'unbilled';
        if (lastReading) {
            if (lastReading.status === 'received') {
                billingStatus = 'received';
            } else if (lastReading.status === 'pending' || lastReading.status === 'billed') {
                billingStatus = 'billed';
            }
        }
        
        return {
            ...contract,
            branch,
            company,
            machine,
            model,
            brand,
            category,
            readingDay,
            billedThisMonth,
            billingStatus,
            lastReading
        };
    });
}


/**
 * Update billing statistics
 */
function updateBillingStats() {
    const today = new Date();
    const todayDay = today.getDate();
    
    // Count contracts for today's reading day
    const forReadingToday = contractsWithInfo.filter(c => c.readingDay === todayDay).length;
    const unbilledCount = contractsWithInfo.filter(c => c.billingStatus === 'unbilled' || !c.billedThisMonth).length;
    const billedCount = contractsWithInfo.filter(c => c.billedThisMonth).length;
    
    document.getElementById('totalForReading').textContent = forReadingToday;
    document.getElementById('completedToday').textContent = billedCount;
    document.getElementById('pendingInvoices').textContent = unbilledCount;
    
    // Update filter counts
    document.getElementById('countAll').textContent = `(${contractsWithInfo.length})`;
    document.getElementById('countToday').textContent = `(${forReadingToday})`;
    document.getElementById('countUnbilled').textContent = `(${unbilledCount})`;
    
    // Calculate total billed this month
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    const totalBilled = billingData.readings
        .filter(r => r.billing_month == currentMonth && r.billing_year == currentYear)
        .reduce((sum, r) => sum + (parseFloat(r.amount_due) || 0), 0);
    
    document.getElementById('totalBilledMonth').textContent = formatCurrency(totalBilled);
}

/**
 * Set status filter
 */
function setStatusFilter(filter) {
    currentFilter = filter;
    
    // Update active button
    document.querySelectorAll('.filter-toggle .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    
    renderForReadingTable();
}

/**
 * Apply date range and status filters
 */
function applyFilters() {
    renderForReadingTable();
}

/**
 * Render the For Reading table
 */
function renderForReadingTable() {
    const tbody = document.getElementById('forReadingBody');
    const dateInput = document.getElementById('billingDate');
    const selectedDate = new Date(dateInput.value);
    const selectedDay = selectedDate.getDate();
    
    // Get date range filter
    const fromDate = document.getElementById('filterDateFrom').value;
    const toDate = document.getElementById('filterDateTo').value;
    
    // Filter contracts based on current filter
    let filteredContracts = [...contractsWithInfo];
    
    // Apply status filter
    if (currentFilter === 'today') {
        filteredContracts = filteredContracts.filter(c => c.readingDay === selectedDay);
    } else if (currentFilter === 'unbilled') {
        filteredContracts = filteredContracts.filter(c => !c.billedThisMonth);
    }
    // 'all' shows everything
    
    // Apply date range filter on reading day
    if (fromDate && toDate) {
        const fromDay = new Date(fromDate).getDate();
        const toDay = new Date(toDate).getDate();
        
        // For reading day filter (if same month)
        const fromMonth = new Date(fromDate).getMonth();
        const toMonth = new Date(toDate).getMonth();
        
        if (fromMonth === toMonth) {
            filteredContracts = filteredContracts.filter(c => {
                if (!c.readingDay) return true; // Include contracts without reading day
                return c.readingDay >= fromDay && c.readingDay <= toDay;
            });
        }
    }
    
    // Sort: today's reading day first, then unbilled, then by reading day
    filteredContracts.sort((a, b) => {
        // Unbilled first
        if (!a.billedThisMonth && b.billedThisMonth) return -1;
        if (a.billedThisMonth && !b.billedThisMonth) return 1;
        
        // Today's reading day second
        const aIsToday = a.readingDay === selectedDay ? 0 : 1;
        const bIsToday = b.readingDay === selectedDay ? 0 : 1;
        if (aIsToday !== bIsToday) return aIsToday - bIsToday;
        
        // Then by reading day
        return (a.readingDay || 99) - (b.readingDay || 99);
    });
    
    // Update count
    document.getElementById('forReadingCount').textContent = filteredContracts.length;
    
    if (filteredContracts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No contracts found matching filters</td></tr>`;
        return;
    }
    
    tbody.innerHTML = filteredContracts.map(c => {
        const isToday = c.readingDay === selectedDay;
        const categoryCode = c.category?.particular_code || c.category?.code || 'N/A';
        const categoryClass = categoryCode.toLowerCase();
        
        // Determine row class based on billing status
        let rowClass = '';
        let statusText = 'Active';
        let statusClass = 'active';
        
        if (c.billedThisMonth) {
            rowClass = 'billed-row';
            statusText = 'Billed';
            statusClass = 'billed';
        } else if (isToday) {
            rowClass = 'today-reading';
        }
        
        if (c.status === 7 || c.status === 2) {
            statusText = 'For Termination';
            statusClass = 'for-termination';
        }
        
        // Format install date
        const installDate = c.date_installed ? formatDate(c.date_installed) : 'N/A';
        
        return `
            <tr class="${rowClass}" onclick="selectContract(${c.id})" ${c.billedThisMonth ? 'title="Already billed this month"' : ''}>
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
        if (dateVal.toDate) {
            return dateVal.toDate().toLocaleDateString('en-CA');
        }
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
 * Format currency
 */
function formatCurrency(amount) {
    return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}


/**
 * Select a contract to bill
 */
function selectContract(contractId) {
    selectedContract = contractsWithInfo.find(c => c.id == contractId);
    if (!selectedContract) {
        showToast('Contract not found', 'error');
        return;
    }
    
    // Warn if already billed this month
    if (selectedContract.billedThisMonth) {
        if (!confirm('This contract has already been billed this month. Create another invoice?')) {
            return;
        }
    }
    
    // Populate contract info in modal
    const infoDiv = document.getElementById('selectedContractInfo');
    infoDiv.innerHTML = `
        <div class="contract-info-row">
            <span class="contract-info-label">Client</span>
            <span class="contract-info-value">${escapeHtml(selectedContract.company?.companyname || 'Unknown')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Branch</span>
            <span class="contract-info-value">${escapeHtml(selectedContract.branch?.branchname || 'N/A')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Model / Serial</span>
            <span class="contract-info-value">${escapeHtml(selectedContract.model?.modelname || selectedContract.machine?.description || 'N/A')} / ${escapeHtml(selectedContract.machine?.serial || 'N/A')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Category</span>
            <span class="contract-info-value">${escapeHtml(selectedContract.category?.particular_code || selectedContract.category?.code || 'N/A')} - ${escapeHtml(selectedContract.category?.particular_desc || selectedContract.category?.name || '')}</span>
        </div>
        <div class="contract-info-row">
            <span class="contract-info-label">Reading Day</span>
            <span class="contract-info-value">Day ${selectedContract.readingDay || 'Not Set'}</span>
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
    
    // Get previous reading
    let prevReading = 0;
    let prevDate = new Date(today);
    prevDate.setMonth(prevDate.getMonth() - 1);
    
    if (selectedContract.lastReading) {
        prevReading = selectedContract.lastReading.present_reading || 0;
        if (selectedContract.lastReading.present_date) {
            prevDate = new Date(selectedContract.lastReading.present_date);
        }
    }
    
    document.getElementById('rdPreviousDate').value = prevDate.toISOString().split('T')[0];
    document.getElementById('rdPreviousMeter').value = prevReading;
    
    // Populate contract rates
    document.getElementById('rdQuota').value = selectedContract.monthly_quota || 0;
    document.getElementById('rdPageRate').value = selectedContract.page_rate || 0;
    document.getElementById('rdExceedRate').value = selectedContract.exceed_rate || selectedContract.page_rate || 0;
    
    // Check if RTF (fixed rate - no reading needed)
    const isFixedRate = ['RTF', 'RTC', 'MAT', 'STC', 'MAC', 'REF', 'RD', 'PI', 'OTH'].includes(categoryCode);
    
    if (isFixedRate) {
        document.getElementById('rdPresentMeter').disabled = true;
        document.getElementById('rdPresentMeter').value = 'N/A';
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
 * Calculate billing based on meter reading
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
        netAmount = amount / 1.12;
        vatAmount = amount - netAmount;
    }
    
    document.getElementById('rdVat').value = vatAmount.toFixed(2);
    document.getElementById('rdNetAmount').value = netAmount.toFixed(2);
    
    // Final amount due
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
 * Load previous reading from database
 */
async function loadPreviousReading() {
    showToast('Loading previous reading...', 'info');
    
    try {
        const db = firebase.firestore();
        const readingsSnap = await db.collection('tbl_readings')
            .where('contract_id', '==', selectedContract.id)
            .orderBy('created_at', 'desc')
            .limit(1)
            .get();
        
        if (!readingsSnap.empty) {
            const lastReading = readingsSnap.docs[0].data();
            document.getElementById('rdPreviousMeter').value = lastReading.present_reading || 0;
            
            if (lastReading.present_date) {
                document.getElementById('rdPreviousDate').value = lastReading.present_date;
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
    if (currentInvoice.amountDue === undefined) {
        showToast('Please complete the billing calculation first', 'error');
        return;
    }
    
    renderInvoicePreview();
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
 * Render invoice preview
 */
function renderInvoicePreview() {
    const preview = document.getElementById('invoicePreview');
    const branch = selectedContract.branch;
    const company = selectedContract.company;
    const category = selectedContract.category;
    const categoryCode = category?.particular_code || category?.code || '';
    
    const billingDate = new Date();
    const formattedDate = billingDate.toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric'
    });
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5);
    const formattedDueDate = dueDate.toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric'
    });
    
    const address = formatBranchAddress(branch);
    
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
            <div class="inv-model">Printer Model   ${escapeHtml(selectedContract.model?.modelname || '')}   ${escapeHtml(selectedContract.machine?.serial || '')}</div>
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
    const parts = [branch.room, branch.floor, branch.bldg, branch.street, branch.brgy, branch.city_name || ''].filter(Boolean);
    return parts.join(' ');
}

/**
 * Adjust print position
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
    if (currentInvoice.amountDue === undefined) {
        showToast('Please complete the billing calculation first', 'error');
        return;
    }
    
    try {
        const db = firebase.firestore();
        
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
            status: 'pending' // pending = billed but not yet received by customer
        };
        
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
            const createdAt = inv.created_at?.toDate() || new Date();
            const age = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
            
            let ageClass = 'recent';
            if (age > 30) ageClass = 'old';
            else if (age > 14) ageClass = 'medium';
            
            const contract = contractsWithInfo.find(c => c.id == inv.contract_id);
            
            return `
                <tr class="pending-invoice-row" onclick="viewInvoice('${inv.docId}')">
                    <td><strong>${escapeHtml(inv.invoice_number)}</strong></td>
                    <td><span class="invoice-age ${ageClass}">${age}</span></td>
                    <td>${escapeHtml(contract?.company?.companyname || 'Unknown')}</td>
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
    showToast('Invoice view coming soon', 'info');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const existing = document.querySelector('.billing-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `billing-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

/**
 * Update reading dates
 */
function updateReadingDates() {
    // Can be customized based on reading schedule logic
}
