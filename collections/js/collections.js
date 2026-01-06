/**
 * MARGA Collections Module
 * Phase 1: View Unpaid Invoices
 */

const API_KEY = FIREBASE_CONFIG.apiKey;
const BASE_URL = FIREBASE_CONFIG.baseUrl;

// State
let allInvoices = [];
let filteredInvoices = [];
let currentPage = 1;
const pageSize = 50;

// Lookup maps
let contractMap = {};
let branchMap = {};
let companyMap = {};
let paidInvoiceIds = new Set();

// Helper to extract Firestore value
function getValue(field) {
    if (!field) return null;
    return field.integerValue || field.stringValue || field.doubleValue || field.booleanValue || null;
}

// Firestore REST API fetch
async function firestoreGet(collection, pageSize = 500) {
    const url = `${BASE_URL}/${collection}?pageSize=${pageSize}&key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}`);
    return response.json();
}

// Calculate invoice age in days
function calculateAge(invMonth, invYear) {
    if (!invMonth || !invYear) return 0;
    const invoiceDate = new Date(invYear, invMonth - 1, 1);
    const today = new Date();
    const diffTime = today - invoiceDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Get age class for styling
function getAgeClass(days) {
    if (days >= 120) return 'age-120';
    if (days >= 90) return 'age-90';
    if (days >= 60) return 'age-60';
    if (days >= 30) return 'age-30';
    return '';
}

// Format currency
function formatCurrency(amount) {
    return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Load all required data
async function loadUnpaidInvoices() {
    const tableContainer = document.getElementById('table-container');
    tableContainer.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <span>Loading unpaid invoices...</span>
        </div>
    `;

    try {
        // Fetch all data in parallel
        console.log('Fetching data from Firebase...');
        const [billing, payments, contracts, branches, companies] = await Promise.all([
            firestoreGet('tbl_billing', 1000),
            firestoreGet('tbl_paymentinfo', 1000),
            firestoreGet('tbl_contractmain', 1000),
            firestoreGet('tbl_branchinfo', 1000),
            firestoreGet('tbl_companylist', 500)
        ]);

        console.log('Data fetched:', {
            billing: billing.documents?.length || 0,
            payments: payments.documents?.length || 0,
            contracts: contracts.documents?.length || 0,
            branches: branches.documents?.length || 0,
            companies: companies.documents?.length || 0
        });

        // Build payment lookup (which invoices are paid)
        paidInvoiceIds = new Set();
        if (payments.documents) {
            payments.documents.forEach(doc => {
                const invId = getValue(doc.fields.invoice_id);
                if (invId) paidInvoiceIds.add(String(invId));
            });
        }

        // Build contract lookup
        contractMap = {};
        if (contracts.documents) {
            contracts.documents.forEach(doc => {
                const f = doc.fields;
                const id = getValue(f.id);
                contractMap[id] = {
                    branch_id: getValue(f.contract_id), // contract_id field = branch_id
                    mach_id: getValue(f.mach_id),
                    category_id: getValue(f.category_id)
                };
            });
        }

        // Build branch lookup
        branchMap = {};
        if (branches.documents) {
            branches.documents.forEach(doc => {
                const f = doc.fields;
                const id = getValue(f.id);
                branchMap[id] = {
                    name: getValue(f.branchname) || 'Main',
                    company_id: getValue(f.company_id)
                };
            });
        }

        // Build company lookup
        companyMap = {};
        if (companies.documents) {
            companies.documents.forEach(doc => {
                const f = doc.fields;
                const id = getValue(f.id);
                companyMap[id] = getValue(f.companyname) || 'Unknown';
            });
        }

        // Process billing records to find unpaid
        allInvoices = [];
        if (billing.documents) {
            billing.documents.forEach(doc => {
                const f = doc.fields;
                const id = getValue(f.id);
                
                // Skip if paid
                if (paidInvoiceIds.has(String(id))) return;

                const contractId = getValue(f.contract_id);
                const contract = contractMap[contractId] || {};
                const branch = branchMap[contract.branch_id] || {};
                const companyName = companyMap[branch.company_id] || 'Unknown';
                
                const invMonth = getValue(f.invmonth);
                const invYear = getValue(f.invyear);
                const age = calculateAge(invMonth, invYear);
                
                const amount = parseFloat(getValue(f.amount) || getValue(f.totalamount) || 0);
                const vatAmount = parseFloat(getValue(f.vatamount) || 0);
                const totalAmount = amount + vatAmount;

                allInvoices.push({
                    id: id,
                    invoiceNo: getValue(f.invoiceno) || id,
                    contractId: contractId,
                    amount: totalAmount,
                    month: invMonth,
                    year: invYear,
                    monthYear: invMonth && invYear ? `${getMonthName(invMonth)} ${invYear}` : '-',
                    age: age,
                    company: companyName,
                    branch: branch.name || 'Unknown',
                    category: getCategoryCode(contract.category_id),
                    location: getValue(f.location),
                    dateprinted: getValue(f.dateprinted)
                });
            });
        }

        // Sort by amount descending (highest first)
        allInvoices.sort((a, b) => b.amount - a.amount);

        // Apply initial filters
        filteredInvoices = [...allInvoices];
        
        // Update stats
        updateStats();
        
        // Populate month filter
        populateMonthFilter();
        
        // Render table
        currentPage = 1;
        renderTable();

        // Update timestamp
        document.getElementById('last-updated').textContent = 
            'Last updated: ' + new Date().toLocaleTimeString();

    } catch (error) {
        console.error('Error loading data:', error);
        tableContainer.innerHTML = `
            <div class="empty-state">
                <h3>Error Loading Data</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="loadUnpaidInvoices()">Try Again</button>
            </div>
        `;
    }
}

// Get month name
function getMonthName(month) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(month)] || month;
}

// Get category code
function getCategoryCode(categoryId) {
    const categories = {
        1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC',
        6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD'
    };
    return categories[categoryId] || '-';
}

// Update statistics
function updateStats() {
    const total = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const count = filteredInvoices.length;
    const age30 = filteredInvoices.filter(inv => inv.age >= 30).length;
    const age60 = filteredInvoices.filter(inv => inv.age >= 60).length;
    const age90 = filteredInvoices.filter(inv => inv.age >= 90).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(total);
    document.getElementById('invoice-count').textContent = count.toLocaleString();
    document.getElementById('age-30').textContent = age30.toLocaleString();
    document.getElementById('age-60').textContent = age60.toLocaleString();
    document.getElementById('age-90').textContent = age90.toLocaleString();
}

// Populate month filter dropdown
function populateMonthFilter() {
    const months = new Set();
    allInvoices.forEach(inv => {
        if (inv.monthYear && inv.monthYear !== '-') {
            months.add(inv.monthYear);
        }
    });
    
    const select = document.getElementById('filter-month');
    select.innerHTML = '<option value="">All Months</option>';
    
    // Sort months (most recent first)
    const sortedMonths = Array.from(months).sort((a, b) => {
        const [monthA, yearA] = a.split(' ');
        const [monthB, yearB] = b.split(' ');
        if (yearA !== yearB) return yearB - yearA;
        const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        return monthOrder.indexOf(monthB) - monthOrder.indexOf(monthA);
    });
    
    sortedMonths.forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = month;
        select.appendChild(option);
    });
}

// Apply filters
function applyFilters() {
    const monthFilter = document.getElementById('filter-month').value;
    const ageFilter = document.getElementById('filter-age').value;
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    filteredInvoices = allInvoices.filter(inv => {
        // Month filter
        if (monthFilter && inv.monthYear !== monthFilter) return false;
        
        // Age filter
        if (ageFilter && inv.age < parseInt(ageFilter)) return false;
        
        // Search filter
        if (searchTerm) {
            const searchStr = `${inv.company} ${inv.branch} ${inv.invoiceNo}`.toLowerCase();
            if (!searchStr.includes(searchTerm)) return false;
        }
        
        return true;
    });

    currentPage = 1;
    updateStats();
    renderTable();
}

// Clear filters
function clearFilters() {
    document.getElementById('filter-month').value = '';
    document.getElementById('filter-age').value = '';
    document.getElementById('search-input').value = '';
    filteredInvoices = [...allInvoices];
    currentPage = 1;
    updateStats();
    renderTable();
}

// Render table
function renderTable() {
    const container = document.getElementById('table-container');
    const pagination = document.getElementById('pagination');
    
    if (filteredInvoices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No Unpaid Invoices Found</h3>
                <p>All invoices have been paid or no data matches your filters.</p>
            </div>
        `;
        pagination.style.display = 'none';
        return;
    }

    // Calculate pagination
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIdx, endIdx);

    // Build table HTML
    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Invoice #</th>
                    <th>Company / Branch</th>
                    <th>Amount</th>
                    <th>Month/Year</th>
                    <th>Age</th>
                    <th>Category</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    pageInvoices.forEach(inv => {
        const ageClass = getAgeClass(inv.age);
        html += `
            <tr onclick="viewInvoice(${inv.id})" data-id="${inv.id}">
                <td><strong>${inv.invoiceNo}</strong></td>
                <td>
                    <div class="company-name">${inv.company}</div>
                    <div class="branch-name">${inv.branch}</div>
                </td>
                <td class="amount">${formatCurrency(inv.amount)}</td>
                <td>${inv.monthYear}</td>
                <td class="${ageClass}">${inv.age} days</td>
                <td><span class="badge badge-${inv.category?.toLowerCase() || 'rtp'}">${inv.category}</span></td>
                <td>
                    <button class="btn btn-secondary" onclick="event.stopPropagation(); viewInvoice(${inv.id})">
                        View
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Update pagination
    document.getElementById('showing-start').textContent = startIdx + 1;
    document.getElementById('showing-end').textContent = endIdx;
    document.getElementById('total-records').textContent = filteredInvoices.length;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = endIdx >= filteredInvoices.length;
    pagination.style.display = 'flex';
}

// Pagination
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}

function nextPage() {
    const maxPage = Math.ceil(filteredInvoices.length / pageSize);
    if (currentPage < maxPage) {
        currentPage++;
        renderTable();
    }
}

// View invoice details (Phase 2)
function viewInvoice(invoiceId) {
    console.log('View invoice:', invoiceId);
    // TODO: Open invoice detail modal/page
    alert(`Invoice ${invoiceId} details - Coming in Phase 2!`);
}

// Export to Excel (basic CSV)
function exportToExcel() {
    const headers = ['Invoice #', 'Company', 'Branch', 'Amount', 'Month/Year', 'Age (Days)', 'Category'];
    const rows = filteredInvoices.map(inv => [
        inv.invoiceNo,
        inv.company,
        inv.branch,
        inv.amount.toFixed(2),
        inv.monthYear,
        inv.age,
        inv.category
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unpaid-invoices-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Search on Enter key
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            applyFilters();
        }
    });
    
    // Load data on page load
    loadUnpaidInvoices();
});
