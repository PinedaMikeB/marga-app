/**
 * MARGA Collections Module
 * With Follow-up System & Interactive Guide
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
let lookupsLoaded = false;

// Daily tips - includes best practices guide
const dailyTips = [
    { type: 'tip', text: "🎯 Focus on URGENT (91-120 days) first - highest recovery potential!" },
    { type: 'tip', text: "📞 Best call times: 9-11 AM and 2-4 PM. Avoid lunch hours!" },
    { type: 'tip', text: "📝 Always log call attempts - helps track payment patterns." },
    { type: 'tip', text: "⚡ Work URGENT → HIGH → MEDIUM for maximum efficiency." },
    { type: 'tip', text: "💡 For 120+ days accounts, recommend machine pull-out to management." },
    { type: 'tip', text: "📱 Send SMS for customers who don't answer calls." },
    { type: 'guide', text: "📊 <strong>Daily Focus:</strong> 0-120 days (highest recovery rate 50-95%)" },
    { type: 'guide', text: "📋 <strong>Weekly Review:</strong> 121-180 days (needs escalation to manager)" },
    { type: 'guide', text: "📁 <strong>Monthly/Quarterly:</strong> 180+ days (management decision for write-off)" },
    { type: 'tip', text: "🔴 URGENT accounts (91-120 days) have 50-60% recovery - don't let them slip!" },
    { type: 'tip', text: "🟠 HIGH priority (61-90 days) - recovery drops to 70-80%, act fast!" },
    { type: 'tip', text: "💰 Accounts over 180 days have less than 30% recovery - prioritize newer ones!" }
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
        const d = new Date(dateStr.split(' ')[0]);
        const today = new Date();
        return d.toDateString() === today.toDateString();
    } catch (e) { return false; }
}

function isPastDue(dateStr) {
    if (!dateStr) return false;
    try {
        const d = new Date(dateStr.split(' ')[0]);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return d < today;
    } catch (e) { return false; }
}

function updateLoadingStatus(message) {
    document.getElementById('table-container').innerHTML = `
        <div class="loading-overlay"><div class="loading-spinner"></div><span>${message}</span></div>
    `;
}

// Welcome Modal with clickable priorities
function showWelcomeModal() { document.getElementById('welcomeModal').classList.remove('hidden'); }
function closeWelcomeModal() {
    document.getElementById('welcomeModal').classList.add('hidden');
    if (document.getElementById('dontShowAgain').checked) localStorage.setItem('collections_hideWelcome', 'true');
}
function checkWelcomeModal() { if (!localStorage.getItem('collections_hideWelcome')) showWelcomeModal(); }

// Click from welcome modal to filter
function goToPriority(priority) {
    closeWelcomeModal();
    filterByPriority(priority);
}

// Tips with guide rotation
function showRandomTip() {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    document.getElementById('tipText').innerHTML = tip.text;
}
function closeTip() { document.getElementById('tipBanner').style.display = 'none'; }

// Today's Follow-ups Modal
function showTodayFollowups() {
    const modal = document.getElementById('followupModal');
    const list = document.getElementById('followupList');
    
    if (todayFollowups.length === 0) {
        list.innerHTML = '<div class="empty-followup">✅ No scheduled follow-ups for today!</div>';
    } else {
        let html = '';
        todayFollowups.forEach(f => {
            const inv = allInvoices.find(i => i.invoiceId == f.invoiceNum || i.invoiceNo == f.invoiceNum);
            html += `
                <div class="followup-item" onclick="viewInvoiceDetail(${f.invoiceNum})">
                    <div class="followup-header">
                        <strong>Invoice #${f.invoiceNum}</strong>
                        <span class="followup-time">${f.time || ''}</span>
                    </div>
                    <div class="followup-company">${inv ? inv.company : 'Unknown'}</div>
                    <div class="followup-remarks">"${f.remarks || 'No remarks'}"</div>
                    <div class="followup-contact">${f.contactPerson ? '👤 ' + f.contactPerson : ''}</div>
                </div>
            `;
        });
        list.innerHTML = html;
    }
    
    modal.classList.remove('hidden');
}

function closeFollowupModal() {
    document.getElementById('followupModal').classList.add('hidden');
}

// Load collection history
async function loadCollectionHistory() {
    try {
        const historyDocs = await firestoreGetAll('tbl_collectionhistory');
        collectionHistory = {};
        todayFollowups = [];
        
        historyDocs.forEach(doc => {
            const f = doc.fields;
            const invoiceNum = getValue(f.invoice_num);
            const followupDate = getValue(f.followup_datetime);
            const remarks = getValue(f.remarks);
            const contactPerson = getValue(f.contact_person);
            const timestamp = getValue(f.timestamp);
            
            // Group by invoice
            if (!collectionHistory[invoiceNum]) {
                collectionHistory[invoiceNum] = [];
            }
            collectionHistory[invoiceNum].push({
                remarks: remarks,
                followupDate: followupDate,
                contactPerson: contactPerson,
                timestamp: timestamp
            });
            
            // Check for today's follow-ups
            if (isToday(followupDate) || isPastDue(followupDate)) {
                todayFollowups.push({
                    invoiceNum: invoiceNum,
                    remarks: remarks,
                    contactPerson: contactPerson,
                    time: followupDate ? followupDate.split(' ')[1] : ''
                });
            }
        });
        
        // Update follow-up badge
        updateFollowupBadge();
        
        console.log('Collection history loaded:', Object.keys(collectionHistory).length, 'invoices');
        console.log('Today follow-ups:', todayFollowups.length);
        
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

// Load lookups
async function loadLookups() {
    if (lookupsLoaded) return;
    
    updateLoadingStatus('Loading company data...');
    const companyDocs = await firestoreGetAll('tbl_companylist');
    companyMap = {};
    companyDocs.forEach(doc => { companyMap[getValue(doc.fields.id)] = getValue(doc.fields.companyname) || 'Unknown'; });

    updateLoadingStatus('Loading branch data...');
    const branchDocs = await firestoreGetAll('tbl_branchinfo');
    branchMap = {};
    branchDocs.forEach(doc => {
        branchMap[getValue(doc.fields.id)] = { name: getValue(doc.fields.branchname) || 'Main', company_id: getValue(doc.fields.company_id) };
    });

    updateLoadingStatus('Loading contract data...');
    const contractDocs = await firestoreGetAll('tbl_contractmain');
    contractMap = {};
    contractDocs.forEach(doc => {
        contractMap[getValue(doc.fields.id)] = { branch_id: getValue(doc.fields.contract_id), category_id: getValue(doc.fields.category_id) };
    });

    updateLoadingStatus('Loading payment records...');
    const paymentDocs = await firestoreGetAll('tbl_paymentinfo');
    paidInvoiceIds = new Set();
    paymentDocs.forEach(doc => {
        const invId = getValue(doc.fields.invoice_id);
        if (invId) paidInvoiceIds.add(String(invId));
    });

    // Load collection history
    updateLoadingStatus('Loading collection history...');
    await loadCollectionHistory();

    lookupsLoaded = true;
}

function processInvoice(doc) {
    const f = doc.fields;
    const invoiceId = getValue(f.invoice_id);
    if (paidInvoiceIds.has(String(invoiceId))) return null;

    const contract = contractMap[getValue(f.contractmain_id)] || {};
    const branch = branchMap[contract.branch_id] || {};
    const monthStr = getValue(f.month);
    const yearStr = getValue(f.year);
    const age = calculateAge(getValue(f.due_date), monthStr, yearStr);
    const totalAmount = parseFloat(getValue(f.totalamount) || getValue(f.amount) || 0);
    const vatAmount = parseFloat(getValue(f.vatamount) || 0);
    
    // Get last follow-up info
    const history = collectionHistory[invoiceId] || [];
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
        company: companyMap[branch.company_id] || 'Unknown',
        branch: branch.name || 'Unknown',
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
    
    updateLoadingStatus('Loading active receivables (0-180 days)...');
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
    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
    
    // Show today's follow-ups if any
    if (todayFollowups.length > 0) {
        setTimeout(showTodayFollowups, 500);
    }
}

async function loadAllInvoices() {
    dataMode = 'all';
    document.getElementById('btnShowBadDebt').classList.add('active');
    
    await loadLookups();
    
    updateLoadingStatus('Loading ALL receivables...');
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
    select.innerHTML = '<option value="">All Years</option>';
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
    } else {
        document.getElementById(fieldId).value = '';
        applyFilters();
    }
}

function clearFilters() {
    currentPriorityFilter = null;
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
    clearFilterInputs();
    filteredInvoices = [...allInvoices];
    currentPage = 1;
    updateAllStats();
    renderTable();
    document.getElementById('active-filters').innerHTML = '';
}

function renderTable() {
    const container = document.getElementById('table-container');
    const pagination = document.getElementById('pagination');

    if (filteredInvoices.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No Invoices Found</h3><p>Try adjusting your filters</p></div>`;
        pagination.style.display = 'none';
        return;
    }

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIdx, endIdx);

    let html = `<table class="data-table"><thead><tr>
        <th>Priority</th><th>Invoice #</th><th>Company / Branch</th><th>Amount</th><th>Month/Year</th><th>Age</th><th>Last Remarks</th><th>Action</th>
    </tr></thead><tbody>`;

    pageInvoices.forEach(inv => {
        const hasFollowup = inv.nextFollowup && (isToday(inv.nextFollowup) || isPastDue(inv.nextFollowup));
        const followupIcon = hasFollowup ? '🔔' : '';
        const remarksPreview = inv.lastRemarks ? (inv.lastRemarks.length > 30 ? inv.lastRemarks.substring(0, 30) + '...' : inv.lastRemarks) : '-';
        
        html += `<tr onclick="viewInvoiceDetail('${inv.invoiceNo}')" class="${hasFollowup ? 'has-followup' : ''}">
            <td><span class="priority-badge ${inv.priority.code}">${inv.priority.label}</span></td>
            <td><strong>${followupIcon} ${inv.invoiceNo}</strong></td>
            <td><div class="company-name">${inv.company}</div><div class="branch-name">${inv.branch}</div></td>
            <td class="amount">${formatCurrency(inv.amount)}</td>
            <td>${inv.monthYear}</td>
            <td class="${getAgeClass(inv.age)}">${inv.age}d</td>
            <td class="remarks-cell" title="${inv.lastRemarks || ''}">${remarksPreview}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoiceDetail('${inv.invoiceNo}')">View</button></td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    document.getElementById('showing-start').textContent = startIdx + 1;
    document.getElementById('showing-end').textContent = endIdx;
    document.getElementById('total-records').textContent = filteredInvoices.length.toLocaleString();
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = endIdx >= filteredInvoices.length;
    pagination.style.display = 'flex';
}

function prevPage() { if (currentPage > 1) { currentPage--; renderTable(); document.querySelector('.table-scroll').scrollTop = 0; } }
function nextPage() { if (currentPage < Math.ceil(filteredInvoices.length / pageSize)) { currentPage++; renderTable(); document.querySelector('.table-scroll').scrollTop = 0; } }

// View invoice detail with history
function viewInvoiceDetail(invoiceNo) {
    const inv = allInvoices.find(i => i.invoiceNo == invoiceNo || i.invoiceId == invoiceNo);
    if (!inv) return;
    
    const history = collectionHistory[invoiceNo] || collectionHistory[inv.invoiceId] || [];
    
    let historyHtml = '';
    if (history.length > 0) {
        history.slice().reverse().forEach(h => {
            historyHtml += `
                <div class="history-item">
                    <div class="history-date">${formatDate(h.timestamp)} ${h.contactPerson ? '• ' + h.contactPerson : ''}</div>
                    <div class="history-remarks">${h.remarks || 'No remarks'}</div>
                    ${h.followupDate ? `<div class="history-followup">📅 Follow-up: ${formatDate(h.followupDate)}</div>` : ''}
                </div>
            `;
        });
    } else {
        historyHtml = '<div class="no-history">No collection history yet</div>';
    }
    
    document.getElementById('detailInvoiceNo').textContent = inv.invoiceNo;
    document.getElementById('detailContent').innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><label>Company</label><span>${inv.company}</span></div>
            <div class="detail-item"><label>Branch</label><span>${inv.branch}</span></div>
            <div class="detail-item"><label>Amount</label><span class="amount">${formatCurrency(inv.amount)}</span></div>
            <div class="detail-item"><label>Age</label><span class="${getAgeClass(inv.age)}">${inv.age} days</span></div>
            <div class="detail-item"><label>Month/Year</label><span>${inv.monthYear}</span></div>
            <div class="detail-item"><label>Priority</label><span class="priority-badge ${inv.priority.code}">${inv.priority.label}</span></div>
        </div>
        <div class="history-section">
            <h4>📋 Collection History (${history.length} records)</h4>
            <div class="history-list">${historyHtml}</div>
        </div>
    `;
    
    document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

function viewInvoice(invoiceId) {
    viewInvoiceDetail(invoiceId);
}

function exportToExcel() {
    if (filteredInvoices.length === 0) { alert('No data'); return; }
    let csv = '\uFEFF' + ['Priority', 'Invoice #', 'Company', 'Branch', 'Amount', 'Month', 'Year', 'Age', 'Category', 'Last Remarks'].join(',') + '\n';
    filteredInvoices.forEach(inv => {
        csv += [inv.priority.label, inv.invoiceNo, `"${inv.company}"`, `"${inv.branch}"`, inv.amount.toFixed(2), inv.month || '', inv.year || '', inv.age, inv.category, `"${(inv.lastRemarks || '').replace(/"/g, '""')}"`].join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `collections-${dataMode}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    checkWelcomeModal();
    showRandomTip();
    
    document.getElementById('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') applyFilters(); });
    ['filter-year', 'filter-month', 'filter-age', 'filter-category'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });
    
    loadActiveInvoices();
});
