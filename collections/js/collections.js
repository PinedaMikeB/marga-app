/**
 * MARGA Collections Module - v3 FIXED
 * - Uses Machine History to find correct branch (NOT contract_id)
 * - Fixed STRING vs NUMBER key matching
 * - Fixed follow-up to only show TODAY
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;
let currentPriorityFilter = null;
let dataMode = 'active';
let todayFollowups = [];
let collectionHistory = {};

// Lookup maps
let contractMap = {};
let branchMap = {};
let companyMap = {};
let paidInvoiceIds = new Set();
let machToBranchMap = {};  // NEW: Machine to Branch mapping from history
let lookupsLoaded = false;

// Daily tips
const dailyTips = [
    "🎯 Focus on URGENT (91-120 days) first - highest recovery potential!",
    "📞 Best call times: 9-11 AM and 2-4 PM. Avoid lunch hours!",
    "📝 Always log call attempts - helps track payment patterns.",
    "⚡ Work URGENT → HIGH → MEDIUM for maximum efficiency.",
    "💡 For 120+ days accounts, recommend machine pull-out to management.",
    "📊 <strong>Daily Focus:</strong> 0-120 days (highest recovery 50-95%)",
    "📋 <strong>Weekly Review:</strong> 121-180 days (needs escalation)",
    "📁 <strong>Monthly:</strong> 180+ days (management decision)",
];

// Helpers
function getValue(field) {
    if (!field) return null;
    return field.integerValue || field.stringValue || field.doubleValue || field.booleanValue || null;
}

async function firestoreGet(collection, pageSize = 300, pageToken = null) {
    let url = `${BASE_URL}/${collection}?pageSize=${pageSize}&key=${API_KEY}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}`);
    return response.json();
}

async function firestoreGetAll(collection, statusCallback = null) {
    let allDocs = [], pageToken = null, page = 0;
    while (page < 100) {
        page++;
        const data = await firestoreGet(collection, 300, pageToken);
        if (data.documents) allDocs = allDocs.concat(data.documents);
        if (statusCallback) statusCallback(`Loading ${collection}... ${allDocs.length}`);
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }
    return allDocs;
}

function monthNameToNumber(monthName) {
    const months = { 'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6, 'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12 };
    return months[String(monthName).toLowerCase()] || 0;
}

function calculateAge(dueDate, month, year) {
    if (dueDate) {
        try {
            const datePart = dueDate.split(' ')[0];
            const d = new Date(datePart);
            if (!isNaN(d)) return Math.max(0, Math.ceil((new Date() - d) / 86400000));
        } catch (e) {}
    }
    if (month && year) {
        const monthNum = monthNameToNumber(month);
        if (monthNum) return Math.max(0, Math.ceil((new Date() - new Date(parseInt(year), monthNum - 1, 1)) / 86400000));
    }
    return 0;
}

function getPriority(age) {
    if (age >= 366) return { code: 'baddebt', label: 'Bad Debt', order: 5 };
    if (age >= 181) return { code: 'doubtful', label: 'Doubtful', order: 4 };
    if (age >= 121) return { code: 'review', label: 'For Review', order: 3 };
    if (age >= 91) return { code: 'urgent', label: 'URGENT', order: 0 };
    if (age >= 61) return { code: 'high', label: 'High', order: 1 };
    if (age >= 31) return { code: 'medium', label: 'Medium', order: 2 };
    return { code: 'current', label: 'Current', order: 6 };
}

function getAgeClass(days) {
    if (days >= 366) return 'age-365';
    if (days >= 180) return 'age-180';
    if (days >= 120) return 'age-120';
    if (days >= 90) return 'age-90';
    if (days >= 60) return 'age-60';
    if (days >= 30) return 'age-30';
    return 'age-current';
}

function formatCurrency(amount) {
    return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyShort(amount) {
    if (amount >= 1000000) return '₱' + (amount / 1000000).toFixed(2) + 'M';
    if (amount >= 1000) return '₱' + (amount / 1000).toFixed(0) + 'K';
    return '₱' + amount.toFixed(0);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr.split(' ')[0]);
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return dateStr; }
}

function isToday(dateStr) {
    if (!dateStr) return false;
    try {
        const datePart = dateStr.split(' ')[0];
        const today = new Date().toISOString().split('T')[0];
        return datePart === today;
    } catch (e) { return false; }
}

function updateLoadingStatus(message) {
    document.getElementById('table-container').innerHTML = `
        <div class="loading-overlay"><div class="loading-spinner"></div><span>${message}</span></div>
    `;
}

// Modals
function showWelcomeModal() { document.getElementById('welcomeModal').classList.remove('hidden'); }
function closeWelcomeModal() {
    document.getElementById('welcomeModal').classList.add('hidden');
    if (document.getElementById('dontShowAgain').checked) localStorage.setItem('collections_hideWelcome', 'true');
}
function checkWelcomeModal() { if (!localStorage.getItem('collections_hideWelcome')) showWelcomeModal(); }

function goToPriority(priority) {
    closeWelcomeModal();
    filterByPriority(priority);
}

function showRandomTip() {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    document.getElementById('tipText').innerHTML = tip;
}
function closeTip() { document.getElementById('tipBanner').style.display = 'none'; }

function showTodayFollowups() {
    const modal = document.getElementById('followupModal');
    const list = document.getElementById('followupList');
    
    if (todayFollowups.length === 0) {
        list.innerHTML = '<div class="empty-followup">✅ No scheduled follow-ups for today!</div>';
    } else {
        let html = '<div class="followup-list">';
        todayFollowups.forEach(f => {
            html += `
                <div class="followup-item" onclick="viewInvoiceDetail('${f.invoiceNum}')">
                    <div class="followup-company">${f.company}</div>
                    <div class="followup-invoice">Invoice #${f.invoiceNum}</div>
                </div>
            `;
        });
        html += '</div>';
        list.innerHTML = html;
    }
    
    modal.classList.remove('hidden');
}

function closeFollowupModal() {
    document.getElementById('followupModal').classList.add('hidden');
}

async function loadCollectionHistory() {
    try {
        const historyDocs = await firestoreGetAll('tbl_collectionhistory');
        collectionHistory = {};
        todayFollowups = [];
        
        const todayStr = new Date().toISOString().split('T')[0];
        
        historyDocs.forEach(doc => {
            const f = doc.fields;
            const invoiceNum = getValue(f.invoice_num);
            const followupDate = getValue(f.followup_datetime);
            const remarks = getValue(f.remarks);
            const contactPerson = getValue(f.contact_person);
            const timestamp = getValue(f.timestamp);
            
            if (!collectionHistory[invoiceNum]) {
                collectionHistory[invoiceNum] = [];
            }
            collectionHistory[invoiceNum].push({
                remarks, followupDate, contactPerson, timestamp
            });
            
            if (followupDate) {
                const followupDatePart = followupDate.split(' ')[0];
                if (followupDatePart === todayStr) {
                    todayFollowups.push({ invoiceNum, company: 'Loading...' });
                }
            }
        });
        
    } catch (e) {
        console.error('Error loading collection history:', e);
    }
}

function updateFollowupBadge() {
    const badge = document.getElementById('followupBadge');
    if (todayFollowups.length > 0) {
        badge.textContent = todayFollowups.length;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function updateFollowupCompanyNames() {
    todayFollowups.forEach(f => {
        const inv = allInvoices.find(i => String(i.invoiceNo) === String(f.invoiceNum) || String(i.invoiceId) === String(f.invoiceNum));
        f.company = inv ? inv.company : 'Invoice #' + f.invoiceNum;
    });
    updateFollowupBadge();
}

// NEW: Build Machine → Branch mapping from machine history
async function buildMachineToBranchMap() {
    updateLoadingStatus('Building machine location map...');
    const historyDocs = await firestoreGetAll('tbl_newmachinehistory');
    
    // Group deliveries by machine
    const machineDeliveries = {};
    historyDocs.forEach(d => {
        const f = d.fields;
        const machId = String(getValue(f.mach_id));
        const branchId = getValue(f.branch_id);
        const statusId = getValue(f.status_id);
        const datex = getValue(f.datex);
        
        // status_id = 2 means "For Delivery" (deployed to branch)
        if (statusId == 2 && branchId && branchId > 0) {
            if (!machineDeliveries[machId]) machineDeliveries[machId] = [];
            machineDeliveries[machId].push({ branchId: String(branchId), date: datex });
        }
    });
    
    // For each machine, get the LATEST delivery location
    machToBranchMap = {};
    Object.entries(machineDeliveries).forEach(([machId, deliveries]) => {
        deliveries.sort((a, b) => new Date(b.date) - new Date(a.date));
        machToBranchMap[machId] = deliveries[0].branchId;
    });
    
    console.log(`Built machine→branch map for ${Object.keys(machToBranchMap).length} machines`);
}

// Load lookups including machine history
async function loadLookups() {
    if (lookupsLoaded) return;
    
    updateLoadingStatus('Loading company data...');
    const companyDocs = await firestoreGetAll('tbl_companylist');
    companyMap = {};
    companyDocs.forEach(doc => { 
        const id = String(getValue(doc.fields.id));
        companyMap[id] = getValue(doc.fields.companyname) || 'Unknown'; 
    });

    updateLoadingStatus('Loading branch data...');
    const branchDocs = await firestoreGetAll('tbl_branchinfo');
    branchMap = {};
    branchDocs.forEach(doc => {
        const id = String(getValue(doc.fields.id));
        const companyId = String(getValue(doc.fields.company_id));
        branchMap[id] = { 
            name: getValue(doc.fields.branchname) || 'Main', 
            company_id: companyId 
        };
    });

    updateLoadingStatus('Loading contract data...');
    const contractDocs = await firestoreGetAll('tbl_contractmain');
    contractMap = {};
    contractDocs.forEach(doc => {
        const id = String(getValue(doc.fields.id));
        contractMap[id] = { 
            contract_id: String(getValue(doc.fields.contract_id)),
            mach_id: String(getValue(doc.fields.mach_id)),  // NEW: Include mach_id
            category_id: getValue(doc.fields.category_id) 
        };
    });

    // NEW: Build machine → branch mapping
    await buildMachineToBranchMap();

    updateLoadingStatus('Loading payment records...');
    const paymentDocs = await firestoreGetAll('tbl_paymentinfo');
    paidInvoiceIds = new Set();
    paymentDocs.forEach(doc => {
        const invId = getValue(doc.fields.invoice_id);
        if (invId) paidInvoiceIds.add(String(invId));
    });

    updateLoadingStatus('Loading collection history...');
    await loadCollectionHistory();

    lookupsLoaded = true;
    console.log('Lookups loaded:', { 
        companies: Object.keys(companyMap).length, 
        branches: Object.keys(branchMap).length, 
        contracts: Object.keys(contractMap).length,
        machineLocations: Object.keys(machToBranchMap).length 
    });
}

// Process invoice with NEW machine history lookup
function processInvoice(doc) {
    const f = doc.fields;
    const invoiceId = getValue(f.invoice_id);
    if (paidInvoiceIds.has(String(invoiceId))) return null;

    const contractmainId = String(getValue(f.contractmain_id));
    const contract = contractMap[contractmainId] || {};
    
    let companyName = 'Unknown';
    let branchName = 'Main';
    
    // NEW METHOD: Use mach_id → machine history → branch
    const machId = contract.mach_id;
    let branchId = machToBranchMap[machId];  // Get branch from machine history
    
    // Fallback to old method if machine not in history
    if (!branchId) {
        branchId = contract.contract_id;
    }
    
    const branch = branchMap[branchId];
    
    if (branch) {
        branchName = branch.name || 'Main';
        companyName = companyMap[branch.company_id] || 'Unknown';
    }
    
    const monthStr = getValue(f.month);
    const yearStr = getValue(f.year);
    const age = calculateAge(getValue(f.due_date), monthStr, yearStr);
    const totalAmount = parseFloat(getValue(f.totalamount) || getValue(f.amount) || 0);
    const vatAmount = parseFloat(getValue(f.vatamount) || 0);
    
    const history = collectionHistory[invoiceId] || collectionHistory[String(invoiceId)] || [];
    const lastHistory = history.length > 0 ? history[history.length - 1] : null;

    return {
        id: getValue(f.id),
        invoiceId: invoiceId,
        invoiceNo: invoiceId || getValue(f.id),
        amount: totalAmount + vatAmount,
        month: monthStr,
        year: yearStr,
        monthYear: monthStr && yearStr ? `${monthStr} ${yearStr}` : '-',
        dueDate: getValue(f.due_date),
        age: age,
        priority: getPriority(age),
        company: companyName,
        branch: branchName,
        category: getCategoryCode(contract.category_id),
        lastRemarks: lastHistory ? lastHistory.remarks : null,
        nextFollowup: lastHistory ? lastHistory.followupDate : null,
        historyCount: history.length
    };
}

async function loadActiveInvoices() {
    dataMode = 'active';
    document.getElementById('btnShowBadDebt').classList.remove('active');
    
    await loadLookups();
    
    updateLoadingStatus('Loading billing records...');
    const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus);
    
    allInvoices = [];
    const years = new Set();
    
    billingDocs.forEach(doc => {
        const inv = processInvoice(doc);
        if (inv && inv.age <= 180) {
            allInvoices.push(inv);
            if (inv.year) years.add(inv.year);
        }
    });

    allInvoices.sort((a, b) => {
        if (a.priority.order !== b.priority.order) return a.priority.order - b.priority.order;
        return b.amount - a.amount;
    });

    filteredInvoices = [...allInvoices];
    populateYearFilter(years);
    updateAllStats();
    currentPage = 1;
    renderTable();
    updateFollowupCompanyNames();
    
    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
    
    // Count unknowns for debugging
    const unknownCount = allInvoices.filter(inv => inv.company === 'Unknown').length;
    console.log(`Loaded ${allInvoices.length} invoices, ${unknownCount} still unknown`);
    
    if (todayFollowups.length > 0) {
        setTimeout(showTodayFollowups, 500);
    }
}

async function loadAllInvoices() {
    dataMode = 'all';
    document.getElementById('btnShowBadDebt').classList.add('active');
    
    await loadLookups();
    
    updateLoadingStatus('Loading ALL billing records...');
    const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus);
    
    allInvoices = [];
    const years = new Set();
    
    billingDocs.forEach(doc => {
        const inv = processInvoice(doc);
        if (inv) {
            allInvoices.push(inv);
            if (inv.year) years.add(inv.year);
        }
    });

    allInvoices.sort((a, b) => {
        if (a.priority.order !== b.priority.order) return a.priority.order - b.priority.order;
        return b.amount - a.amount;
    });

    filteredInvoices = [...allInvoices];
    populateYearFilter(years);
    updateAllStats();
    currentPage = 1;
    renderTable();
    updateFollowupCompanyNames();
    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
}

function toggleBadDebt() {
    if (dataMode === 'active') loadAllInvoices();
    else loadActiveInvoices();
}

async function loadUnpaidInvoices() {
    if (dataMode === 'all') await loadAllInvoices();
    else await loadActiveInvoices();
}

function getCategoryCode(categoryId) {
    const categories = { 1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC', 6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD' };
    return categories[categoryId] || '-';
}

function populateYearFilter(years) {
    const select = document.getElementById('filter-year');
    select.innerHTML = '<option value="">All</option>';
    Array.from(years).sort((a, b) => b - a).forEach(year => {
        select.innerHTML += `<option value="${year}">${year}</option>`;
    });
}

function updateAllStats() {
    const counts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };
    const amounts = { current: 0, medium: 0, high: 0, urgent: 0, review: 0, doubtful: 0, baddebt: 0 };

    allInvoices.forEach(inv => {
        counts[inv.priority.code] = (counts[inv.priority.code] || 0) + 1;
        amounts[inv.priority.code] = (amounts[inv.priority.code] || 0) + inv.amount;
    });

    ['current', 'medium', 'high', 'urgent', 'review', 'baddebt'].forEach(key => {
        const countEl = document.getElementById(`count-${key}`);
        const amountEl = document.getElementById(`amount-${key}`);
        if (countEl) countEl.textContent = (counts[key] || 0).toLocaleString();
        if (amountEl) amountEl.textContent = formatCurrencyShort(amounts[key] || 0);
    });

    const reviewCount = (counts.review || 0) + (counts.doubtful || 0);
    const reviewAmount = (amounts.review || 0) + (amounts.doubtful || 0);
    document.getElementById('count-review').textContent = reviewCount.toLocaleString();
    document.getElementById('amount-review').textContent = formatCurrencyShort(reviewAmount);

    const total = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const activeAmount = filteredInvoices.filter(inv => inv.age <= 120).reduce((sum, inv) => sum + inv.amount, 0);
    const collectibleCount = filteredInvoices.filter(inv => inv.age <= 120).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(total);
    document.getElementById('total-active').textContent = formatCurrencyShort(activeAmount);
    document.getElementById('invoice-count').textContent = filteredInvoices.length.toLocaleString();
    document.getElementById('collectible-count').textContent = collectibleCount.toLocaleString();
    document.getElementById('dataMode').textContent = dataMode === 'all' ? '(All Data)' : '(Active 0-180 days)';
}

function filterByPriority(priority) {
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
    clearFilterInputs();

    if (currentPriorityFilter === priority) {
        currentPriorityFilter = null;
        filteredInvoices = [...allInvoices];
    } else {
        currentPriorityFilter = priority;
        if (priority === 'review') {
            filteredInvoices = allInvoices.filter(inv => inv.priority.code === 'review' || inv.priority.code === 'doubtful');
        } else {
            filteredInvoices = allInvoices.filter(inv => inv.priority.code === priority);
        }
        document.querySelector(`.priority-card.${priority}`)?.classList.add('active');
    }

    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

function clearFilterInputs() {
    document.getElementById('filter-year').value = '';
    document.getElementById('filter-month').value = '';
    document.getElementById('filter-age').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('search-input').value = '';
}

function applyFilters() {
    currentPriorityFilter = null;
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));

    const yearFilter = document.getElementById('filter-year').value;
    const monthFilter = document.getElementById('filter-month').value;
    const ageFilter = document.getElementById('filter-age').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();

    filteredInvoices = allInvoices.filter(inv => {
        if (yearFilter && inv.year !== yearFilter) return false;
        if (monthFilter && inv.month !== monthFilter) return false;
        if (categoryFilter && inv.category !== categoryFilter) return false;
        
        if (ageFilter) {
            if (ageFilter === '366+') {
                if (inv.age < 366) return false;
            } else {
                const [min, max] = ageFilter.split('-').map(Number);
                if (inv.age < min || inv.age > max) return false;
            }
        }
        
        if (searchTerm && !`${inv.company} ${inv.branch} ${inv.invoiceNo}`.toLowerCase().includes(searchTerm)) return false;
        
        return true;
    });

    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

function showActiveFilters() {
    const filters = [];
    if (currentPriorityFilter) filters.push({ label: `Priority: ${currentPriorityFilter.toUpperCase()}`, field: 'priority' });
    if (document.getElementById('filter-year').value) filters.push({ label: `Year: ${document.getElementById('filter-year').value}`, field: 'filter-year' });
    if (document.getElementById('filter-month').value) filters.push({ label: `Month: ${document.getElementById('filter-month').value}`, field: 'filter-month' });
    if (document.getElementById('filter-age').value) filters.push({ label: `Age: ${document.getElementById('filter-age').value}`, field: 'filter-age' });
    if (document.getElementById('filter-category').value) filters.push({ label: `Category: ${document.getElementById('filter-category').value}`, field: 'filter-category' });
    if (document.getElementById('search-input').value.trim()) filters.push({ label: `Search: "${document.getElementById('search-input').value}"`, field: 'search-input' });

    document.getElementById('active-filters').innerHTML = filters.length === 0 ? '' :
        filters.map(f => `<span class="filter-tag">${f.label} <span class="remove" onclick="removeFilter('${f.field}')">×</span></span>`).join('');
}

function removeFilter(fieldId) {
    if (fieldId === 'priority') {
        currentPriorityFilter = null;
        document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
        filteredInvoices = [...allInvoices];
        currentPage = 1;
        updateAllStats();
        renderTable();
        showActiveFilters();
        return;
    }
    document.getElementById(fieldId).value = '';
    applyFilters();
}

function clearFilters() {
    clearFilterInputs();
    currentPriorityFilter = null;
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
    filteredInvoices = [...allInvoices];
    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

function renderTable() {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIndex, endIndex);

    if (pageInvoices.length === 0) {
        document.getElementById('table-container').innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <h3>No invoices found</h3>
                <p>Try adjusting your filters</p>
            </div>
        `;
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    let html = `
        <table class="invoice-table">
            <thead>
                <tr>
                    <th>Priority</th>
                    <th>Company</th>
                    <th>Invoice #</th>
                    <th>Period</th>
                    <th>Amount</th>
                    <th>Age</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    pageInvoices.forEach(inv => {
        const hasHistory = inv.historyCount > 0;
        const statusClass = hasHistory ? 'status-contacted' : 'status-new';
        const statusText = hasHistory ? `${inv.historyCount} notes` : 'New';
        
        html += `
            <tr class="invoice-row ${inv.priority.code}" onclick="viewInvoiceDetail('${inv.invoiceNo}')">
                <td><span class="priority-badge ${inv.priority.code}">${inv.priority.label}</span></td>
                <td>
                    <div class="company-name">${inv.company}</div>
                    <div class="branch-name">${inv.branch !== inv.company ? inv.branch : ''}</div>
                </td>
                <td><strong>#${inv.invoiceNo}</strong></td>
                <td>${inv.monthYear}</td>
                <td class="amount">${formatCurrency(inv.amount)}</td>
                <td><span class="age-badge ${getAgeClass(inv.age)}">${inv.age}d</span></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn-action" onclick="event.stopPropagation(); viewInvoiceDetail('${inv.invoiceNo}')" title="View Details">
                        👁️
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;

    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(filteredInvoices.length / pageSize);
    if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    let html = '<div class="pagination">';
    
    html += `<button class="page-btn" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
    
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button class="page-btn" onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>»</button>`;
    
    html += `<span class="page-info">Page ${currentPage} of ${totalPages} (${filteredInvoices.length} invoices)</span>`;
    html += '</div>';
    
    document.getElementById('pagination').innerHTML = html;
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredInvoices.length / pageSize);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTable();
    document.getElementById('table-container').scrollIntoView({ behavior: 'smooth' });
}

function viewInvoiceDetail(invoiceNo) {
    // Navigate to detail page or open modal
    window.location.href = `invoice-detail.html?invoice=${invoiceNo}`;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadActiveInvoices();
    checkWelcomeModal();
    showRandomTip();
    
    // Setup search
    document.getElementById('search-input')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applyFilters();
    });
});
