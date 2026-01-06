/**
 * MARGA Collections Module
 * With Priority-Based Workflow & Best Practices
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;
let currentPriorityFilter = null;

// Lookup maps
let contractMap = {};
let branchMap = {};
let companyMap = {};
let paidInvoiceIds = new Set();

// Daily tips rotation
const dailyTips = [
    "Focus on URGENT (91-120 days) invoices first - they have the highest recovery potential!",
    "Follow up on HIGH priority (61-90 days) before they become urgent. Recovery rate: 70-80%",
    "Document all call attempts - this helps track customer payment patterns.",
    "For accounts 120+ days, consider recommending machine pull-out to management.",
    "Best time to call: 9-11 AM and 2-4 PM. Avoid lunch hours!",
    "Always confirm the contact person and best time to reach them.",
    "Send SMS reminders for customers who don't answer calls.",
    "Accounts over 1 year have less than 10% recovery rate - focus on collectible accounts first!"
];

// Helper functions
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
    let allDocs = [];
    let pageToken = null;
    let page = 0;
    
    while (page < 100) {
        page++;
        const data = await firestoreGet(collection, 300, pageToken);
        if (data.documents) allDocs = allDocs.concat(data.documents);
        if (statusCallback) statusCallback(`Loading ${collection}... ${allDocs.length} records`);
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }
    return allDocs;
}

function monthNameToNumber(monthName) {
    const months = { 'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6, 'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12 };
    return months[String(monthName).toLowerCase()] || 0;
}

function calculateAgeFromDueDate(dueDate) {
    if (!dueDate) return 0;
    try {
        const datePart = dueDate.split(' ')[0];
        const invoiceDate = new Date(datePart);
        const diffDays = Math.ceil((new Date() - invoiceDate) / (1000 * 60 * 60 * 24));
        return Math.max(0, diffDays);
    } catch (e) { return 0; }
}

function calculateAgeFromMonthYear(month, year) {
    if (!month || !year) return 0;
    const monthNum = monthNameToNumber(month);
    if (!monthNum) return 0;
    const invoiceDate = new Date(parseInt(year), monthNum - 1, 1);
    return Math.max(0, Math.ceil((new Date() - invoiceDate) / (1000 * 60 * 60 * 24)));
}

// Get priority based on age
function getPriority(age) {
    if (age >= 366) return { code: 'baddebt', label: 'Bad Debt', color: '#455a64' };
    if (age >= 121) return { code: 'review', label: 'For Review', color: '#7b1fa2' };
    if (age >= 91) return { code: 'urgent', label: 'Urgent', color: '#d32f2f' };
    if (age >= 61) return { code: 'high', label: 'High', color: '#f57c00' };
    if (age >= 31) return { code: 'medium', label: 'Medium', color: '#fbc02d' };
    return { code: 'current', label: 'Current', color: '#66bb6a' };
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
    if (amount >= 1000000) return '₱' + (amount / 1000000).toFixed(1) + 'M';
    if (amount >= 1000) return '₱' + (amount / 1000).toFixed(0) + 'K';
    return '₱' + amount.toFixed(0);
}

function updateLoadingStatus(message) {
    document.getElementById('table-container').innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <span>${message}</span>
        </div>
    `;
}

// Welcome Modal
function showWelcomeModal() {
    document.getElementById('welcomeModal').classList.remove('hidden');
}

function closeWelcomeModal() {
    document.getElementById('welcomeModal').classList.add('hidden');
    if (document.getElementById('dontShowAgain').checked) {
        localStorage.setItem('collections_hideWelcome', 'true');
    }
}

function checkWelcomeModal() {
    if (!localStorage.getItem('collections_hideWelcome')) {
        showWelcomeModal();
    }
}

// Tip Banner
function showRandomTip() {
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    document.getElementById('tipText').textContent = tip;
}

function closeTip() {
    document.getElementById('tipBanner').style.display = 'none';
}

// Load data
async function loadUnpaidInvoices() {
    updateLoadingStatus('Starting data load...');

    try {
        const companyDocs = await firestoreGetAll('tbl_companylist', updateLoadingStatus);
        const branchDocs = await firestoreGetAll('tbl_branchinfo', updateLoadingStatus);
        const contractDocs = await firestoreGetAll('tbl_contractmain', updateLoadingStatus);
        const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus);
        const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus);

        // Build lookups
        companyMap = {};
        companyDocs.forEach(doc => { companyMap[getValue(doc.fields.id)] = getValue(doc.fields.companyname) || 'Unknown'; });

        branchMap = {};
        branchDocs.forEach(doc => {
            branchMap[getValue(doc.fields.id)] = { name: getValue(doc.fields.branchname) || 'Main', company_id: getValue(doc.fields.company_id) };
        });

        contractMap = {};
        contractDocs.forEach(doc => {
            contractMap[getValue(doc.fields.id)] = { branch_id: getValue(doc.fields.contract_id), category_id: getValue(doc.fields.category_id) };
        });

        paidInvoiceIds = new Set();
        paymentDocs.forEach(doc => {
            const invId = getValue(doc.fields.invoice_id);
            if (invId) paidInvoiceIds.add(String(invId));
        });

        // Process billing
        updateLoadingStatus('Processing invoices...');
        allInvoices = [];
        const years = new Set();

        billingDocs.forEach(doc => {
            const f = doc.fields;
            const invoiceId = getValue(f.invoice_id);
            if (paidInvoiceIds.has(String(invoiceId))) return;

            const contract = contractMap[getValue(f.contractmain_id)] || {};
            const branch = branchMap[contract.branch_id] || {};
            
            const monthStr = getValue(f.month);
            const yearStr = getValue(f.year);
            if (yearStr) years.add(yearStr);

            let age = calculateAgeFromDueDate(getValue(f.due_date));
            if (age === 0 && monthStr && yearStr) age = calculateAgeFromMonthYear(monthStr, yearStr);

            const totalAmount = parseFloat(getValue(f.totalamount) || getValue(f.amount) || 0);
            const vatAmount = parseFloat(getValue(f.vatamount) || 0);

            allInvoices.push({
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
                receivedBy: getValue(f.receivedby)
            });
        });

        // Sort by priority (urgent first), then by amount
        allInvoices.sort((a, b) => {
            const priorityOrder = { 'urgent': 0, 'high': 1, 'medium': 2, 'current': 3, 'review': 4, 'baddebt': 5 };
            if (priorityOrder[a.priority.code] !== priorityOrder[b.priority.code]) {
                return priorityOrder[a.priority.code] - priorityOrder[b.priority.code];
            }
            return b.amount - a.amount;
        });

        filteredInvoices = [...allInvoices];
        populateYearFilter(years);
        updateAllStats();
        currentPage = 1;
        renderTable();

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('table-container').innerHTML = `
            <div class="empty-state">
                <h3>Error Loading Data</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="loadUnpaidInvoices()">Try Again</button>
            </div>
        `;
    }
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

// Update all statistics
function updateAllStats() {
    // Priority counts
    const priorities = { current: [], medium: [], high: [], urgent: [], review: [], baddebt: [] };
    
    allInvoices.forEach(inv => {
        priorities[inv.priority.code].push(inv);
    });

    // Update priority cards
    Object.keys(priorities).forEach(key => {
        const invs = priorities[key];
        const count = invs.length;
        const amount = invs.reduce((sum, inv) => sum + inv.amount, 0);
        
        document.getElementById(`count-${key}`).textContent = count.toLocaleString();
        document.getElementById(`amount-${key}`).textContent = formatCurrencyShort(amount);
    });

    // Update summary stats (based on filtered)
    const total = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const activeCollection = filteredInvoices.filter(inv => inv.age <= 180).reduce((sum, inv) => sum + inv.amount, 0);
    const collectibleCount = filteredInvoices.filter(inv => inv.age <= 180).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(total);
    document.getElementById('total-active').textContent = formatCurrencyShort(activeCollection);
    document.getElementById('invoice-count').textContent = filteredInvoices.length.toLocaleString();
    document.getElementById('collectible-count').textContent = collectibleCount.toLocaleString();
}

// Filter by priority card click
function filterByPriority(priority) {
    // Remove active class from all cards
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
    
    // Clear other filters
    document.getElementById('filter-year').value = '';
    document.getElementById('filter-month').value = '';
    document.getElementById('filter-age').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('search-input').value = '';

    if (currentPriorityFilter === priority) {
        // Toggle off - show all
        currentPriorityFilter = null;
        filteredInvoices = [...allInvoices];
    } else {
        // Apply priority filter
        currentPriorityFilter = priority;
        filteredInvoices = allInvoices.filter(inv => inv.priority.code === priority);
        
        // Add active class
        event.target.closest('.priority-card').classList.add('active');
    }

    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

// Apply filters
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
        
        // Age range filter
        if (ageFilter) {
            const [min, max] = ageFilter.split('-').map(v => v === '+' ? Infinity : parseInt(v.replace('+', '')));
            if (ageFilter.includes('+')) {
                if (inv.age < parseInt(ageFilter)) return false;
            } else {
                if (inv.age < min || inv.age > max) return false;
            }
        }
        
        if (searchTerm) {
            const searchStr = `${inv.company} ${inv.branch} ${inv.invoiceNo}`.toLowerCase();
            if (!searchStr.includes(searchTerm)) return false;
        }
        
        return true;
    });

    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

function showActiveFilters() {
    const filters = [];
    const yearFilter = document.getElementById('filter-year').value;
    const monthFilter = document.getElementById('filter-month').value;
    const ageFilter = document.getElementById('filter-age').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const searchTerm = document.getElementById('search-input').value.trim();

    if (currentPriorityFilter) filters.push({ label: `Priority: ${currentPriorityFilter.toUpperCase()}`, field: 'priority' });
    if (yearFilter) filters.push({ label: `Year: ${yearFilter}`, field: 'filter-year' });
    if (monthFilter) filters.push({ label: `Month: ${monthFilter}`, field: 'filter-month' });
    if (ageFilter) filters.push({ label: `Age: ${ageFilter}`, field: 'filter-age' });
    if (categoryFilter) filters.push({ label: `Category: ${categoryFilter}`, field: 'filter-category' });
    if (searchTerm) filters.push({ label: `Search: "${searchTerm}"`, field: 'search-input' });

    document.getElementById('active-filters').innerHTML = filters.length === 0 ? '' :
        filters.map(f => `<span class="filter-tag">${f.label} <span class="remove" onclick="removeFilter('${f.field}')">×</span></span>`).join('');
}

function removeFilter(fieldId) {
    if (fieldId === 'priority') {
        currentPriorityFilter = null;
        document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
        filteredInvoices = [...allInvoices];
    } else {
        document.getElementById(fieldId).value = '';
        applyFilters();
        return;
    }
    currentPage = 1;
    updateAllStats();
    renderTable();
    showActiveFilters();
}

function clearFilters() {
    currentPriorityFilter = null;
    document.querySelectorAll('.priority-card').forEach(card => card.classList.remove('active'));
    document.getElementById('filter-year').value = '';
    document.getElementById('filter-month').value = '';
    document.getElementById('filter-age').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('search-input').value = '';
    
    filteredInvoices = [...allInvoices];
    currentPage = 1;
    updateAllStats();
    renderTable();
    document.getElementById('active-filters').innerHTML = '';
}

// Render table
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
        <th>Priority</th><th>Invoice #</th><th>Company / Branch</th><th>Amount</th><th>Month/Year</th><th>Age</th><th>Category</th><th>Action</th>
    </tr></thead><tbody>`;

    pageInvoices.forEach(inv => {
        html += `<tr onclick="viewInvoice(${inv.id})">
            <td><span class="priority-badge ${inv.priority.code}">${inv.priority.label}</span></td>
            <td><strong>${inv.invoiceNo}</strong></td>
            <td><div class="company-name">${inv.company}</div><div class="branch-name">${inv.branch}</div></td>
            <td class="amount">${formatCurrency(inv.amount)}</td>
            <td>${inv.monthYear}</td>
            <td class="${getAgeClass(inv.age)}">${inv.age} days</td>
            <td><span class="badge badge-${inv.category.toLowerCase()}">${inv.category}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); viewInvoice(${inv.id})">View</button></td>
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

function viewInvoice(invoiceId) {
    const inv = allInvoices.find(i => i.id == invoiceId);
    if (inv) {
        alert(`Invoice #${inv.invoiceNo}\n\nCompany: ${inv.company}\nBranch: ${inv.branch}\nAmount: ${formatCurrency(inv.amount)}\nAge: ${inv.age} days\nPriority: ${inv.priority.label}\n\n(Detail view coming in Phase 2)`);
    }
}

function exportToExcel() {
    if (filteredInvoices.length === 0) { alert('No data'); return; }
    
    let csv = '\uFEFF' + ['Priority', 'Invoice #', 'Company', 'Branch', 'Amount', 'Month', 'Year', 'Age', 'Category'].join(',') + '\n';
    filteredInvoices.forEach(inv => {
        csv += [inv.priority.label, inv.invoiceNo, `"${inv.company}"`, `"${inv.branch}"`, inv.amount.toFixed(2), inv.month || '', inv.year || '', inv.age, inv.category].join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `collections-${new Date().toISOString().split('T')[0]}.csv`;
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
    
    loadUnpaidInvoices();
});
