/**
 * MARGA Collections Module
 * Phase 1: View Unpaid Invoices
 * With improved filters: Year, Month, Age (30-240+ days), Category
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

// Firestore REST API fetch with pagination
async function firestoreGet(collection, pageSize = 300, pageToken = null) {
    let url = `${BASE_URL}/${collection}?pageSize=${pageSize}&key=${API_KEY}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}`);
    return response.json();
}

// Fetch ALL documents from a collection
async function firestoreGetAll(collection, statusCallback = null) {
    let allDocs = [];
    let pageToken = null;
    let page = 0;
    const maxPages = 100;
    
    while (page < maxPages) {
        page++;
        const data = await firestoreGet(collection, 300, pageToken);
        
        if (data.documents && data.documents.length > 0) {
            allDocs = allDocs.concat(data.documents);
        }
        
        if (statusCallback) {
            statusCallback(`Loading ${collection}... ${allDocs.length} records (page ${page})`);
        }
        
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
    }
    
    console.log(`${collection}: ${allDocs.length} total records in ${page} pages`);
    return allDocs;
}

// Convert month name to number
function monthNameToNumber(monthName) {
    const months = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4,
        'may': 5, 'june': 6, 'july': 7, 'august': 8,
        'september': 9, 'october': 10, 'november': 11, 'december': 12
    };
    return months[String(monthName).toLowerCase()] || 0;
}

// Calculate invoice age in days from due_date
function calculateAgeFromDueDate(dueDate) {
    if (!dueDate) return 0;
    try {
        const datePart = dueDate.split(' ')[0];
        const invoiceDate = new Date(datePart);
        const today = new Date();
        const diffTime = today - invoiceDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return Math.max(0, diffDays);
    } catch (e) {
        return 0;
    }
}

// Calculate age from month/year strings
function calculateAgeFromMonthYear(month, year) {
    if (!month || !year) return 0;
    const monthNum = monthNameToNumber(month);
    if (!monthNum) return 0;
    
    const invoiceDate = new Date(parseInt(year), monthNum - 1, 1);
    const today = new Date();
    const diffTime = today - invoiceDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
}

// Get age class for styling
function getAgeClass(days) {
    if (days >= 240) return 'age-240';
    if (days >= 180) return 'age-180';
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

// Update loading status
function updateLoadingStatus(message) {
    const container = document.getElementById('table-container');
    container.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <span>${message}</span>
        </div>
    `;
}

// Load all required data
async function loadUnpaidInvoices() {
    updateLoadingStatus('Starting data load...');

    try {
        console.log('=== Starting data fetch ===');
        
        updateLoadingStatus('Loading companies...');
        const companyDocs = await firestoreGetAll('tbl_companylist', updateLoadingStatus);
        
        updateLoadingStatus('Loading branches...');
        const branchDocs = await firestoreGetAll('tbl_branchinfo', updateLoadingStatus);
        
        updateLoadingStatus('Loading contracts...');
        const contractDocs = await firestoreGetAll('tbl_contractmain', updateLoadingStatus);
        
        updateLoadingStatus('Loading payments...');
        const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus);
        
        updateLoadingStatus('Loading billing records...');
        const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus);

        console.log('=== Data fetch complete ===');
        console.log({ companies: companyDocs.length, branches: branchDocs.length, contracts: contractDocs.length, payments: paymentDocs.length, billing: billingDocs.length });

        // Build lookups
        updateLoadingStatus('Building lookups...');
        
        companyMap = {};
        companyDocs.forEach(doc => {
            const f = doc.fields;
            companyMap[getValue(f.id)] = getValue(f.companyname) || 'Unknown';
        });

        branchMap = {};
        branchDocs.forEach(doc => {
            const f = doc.fields;
            branchMap[getValue(f.id)] = {
                name: getValue(f.branchname) || 'Main',
                company_id: getValue(f.company_id)
            };
        });

        contractMap = {};
        contractDocs.forEach(doc => {
            const f = doc.fields;
            contractMap[getValue(f.id)] = {
                branch_id: getValue(f.contract_id),
                mach_id: getValue(f.mach_id),
                category_id: getValue(f.category_id),
                status: getValue(f.status)
            };
        });

        paidInvoiceIds = new Set();
        paymentDocs.forEach(doc => {
            const invId = getValue(doc.fields.invoice_id);
            if (invId) paidInvoiceIds.add(String(invId));
        });

        // Process billing records
        updateLoadingStatus('Processing invoices...');
        allInvoices = [];
        const years = new Set();
        
        billingDocs.forEach(doc => {
            const f = doc.fields;
            const billingId = getValue(f.id);
            const invoiceId = getValue(f.invoice_id);
            
            if (paidInvoiceIds.has(String(invoiceId))) return;

            const contractmainId = getValue(f.contractmain_id);
            const contract = contractMap[contractmainId];
            
            let companyName = 'Unknown';
            let branchName = 'Unknown';
            let categoryId = null;
            
            if (contract) {
                const branch = branchMap[contract.branch_id];
                if (branch) {
                    branchName = branch.name || 'Main';
                    companyName = companyMap[branch.company_id] || 'Unknown';
                }
                categoryId = contract.category_id;
            }
            
            const monthStr = getValue(f.month);
            const yearStr = getValue(f.year);
            const dueDate = getValue(f.due_date);
            
            // Track years for filter
            if (yearStr) years.add(yearStr);
            
            let age = calculateAgeFromDueDate(dueDate);
            if (age === 0 && monthStr && yearStr) {
                age = calculateAgeFromMonthYear(monthStr, yearStr);
            }
            
            const totalAmount = parseFloat(getValue(f.totalamount) || getValue(f.amount) || 0);
            const vatAmount = parseFloat(getValue(f.vatamount) || 0);
            const finalAmount = totalAmount + vatAmount;

            let monthYear = '-';
            if (monthStr && yearStr) {
                monthYear = `${monthStr} ${yearStr}`;
            }

            allInvoices.push({
                id: billingId,
                invoiceId: invoiceId,
                invoiceNo: invoiceId || billingId,
                contractmainId: contractmainId,
                amount: finalAmount,
                month: monthStr,
                year: yearStr,
                monthYear: monthYear,
                dueDate: dueDate,
                age: age,
                company: companyName,
                branch: branchName,
                category: getCategoryCode(categoryId),
                receivedBy: getValue(f.receivedby),
                dateReceived: getValue(f.date_received),
                status: getValue(f.status)
            });
        });

        console.log('Total unpaid:', allInvoices.length);

        // Sort by amount descending
        allInvoices.sort((a, b) => b.amount - a.amount);
        filteredInvoices = [...allInvoices];
        
        // Populate year filter
        populateYearFilter(years);
        
        // Update UI
        updateStats();
        currentPage = 1;
        renderTable();

        document.getElementById('last-updated').textContent = 
            'Last updated: ' + new Date().toLocaleTimeString();

    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('table-container').innerHTML = `
            <div class="empty-state">
                <h3>Error Loading Data</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="loadUnpaidInvoices()">Try Again</button>
            </div>
        `;
    }
}

// Get category code
function getCategoryCode(categoryId) {
    const categories = { 1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC', 6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD', 11: 'PI', 12: 'OTH' };
    return categories[categoryId] || '-';
}

// Populate year filter
function populateYearFilter(years) {
    const select = document.getElementById('filter-year');
    select.innerHTML = '<option value="">All Years</option>';
    
    const sortedYears = Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        select.appendChild(option);
    });
}

// Update statistics
function updateStats() {
    const total = filteredInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const count = filteredInvoices.length;
    const age30 = filteredInvoices.filter(inv => inv.age >= 30).length;
    const age60 = filteredInvoices.filter(inv => inv.age >= 60).length;
    const age90 = filteredInvoices.filter(inv => inv.age >= 90).length;
    const age120 = filteredInvoices.filter(inv => inv.age >= 120).length;

    document.getElementById('total-unpaid').textContent = formatCurrency(total);
    document.getElementById('invoice-count').textContent = count.toLocaleString();
    document.getElementById('age-30').textContent = age30.toLocaleString();
    document.getElementById('age-60').textContent = age60.toLocaleString();
    document.getElementById('age-90').textContent = age90.toLocaleString();
    document.getElementById('age-120').textContent = age120.toLocaleString();
}

// Apply filters
function applyFilters() {
    const yearFilter = document.getElementById('filter-year').value;
    const monthFilter = document.getElementById('filter-month').value;
    const ageFilter = document.getElementById('filter-age').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();

    console.log('Applying filters:', { yearFilter, monthFilter, ageFilter, categoryFilter, searchTerm });

    filteredInvoices = allInvoices.filter(inv => {
        // Year filter
        if (yearFilter && inv.year !== yearFilter) return false;
        
        // Month filter
        if (monthFilter && inv.month !== monthFilter) return false;
        
        // Age filter
        if (ageFilter && inv.age < parseInt(ageFilter)) return false;
        
        // Category filter
        if (categoryFilter && inv.category !== categoryFilter) return false;
        
        // Search filter
        if (searchTerm) {
            const searchStr = `${inv.company} ${inv.branch} ${inv.invoiceNo} ${inv.invoiceId}`.toLowerCase();
            if (!searchStr.includes(searchTerm)) return false;
        }
        
        return true;
    });

    console.log('Filtered results:', filteredInvoices.length);

    currentPage = 1;
    updateStats();
    renderTable();
    showActiveFilters();
}

// Show active filters
function showActiveFilters() {
    const container = document.getElementById('active-filters');
    const filters = [];
    
    const yearFilter = document.getElementById('filter-year').value;
    const monthFilter = document.getElementById('filter-month').value;
    const ageFilter = document.getElementById('filter-age').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const searchTerm = document.getElementById('search-input').value.trim();
    
    if (yearFilter) filters.push({ label: `Year: ${yearFilter}`, field: 'filter-year' });
    if (monthFilter) filters.push({ label: `Month: ${monthFilter}`, field: 'filter-month' });
    if (ageFilter) filters.push({ label: `Age: ${ageFilter}+ days`, field: 'filter-age' });
    if (categoryFilter) filters.push({ label: `Category: ${categoryFilter}`, field: 'filter-category' });
    if (searchTerm) filters.push({ label: `Search: "${searchTerm}"`, field: 'search-input' });
    
    if (filters.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = filters.map(f => 
        `<span class="filter-tag">${f.label} <span class="remove" onclick="removeFilter('${f.field}')">×</span></span>`
    ).join('');
}

// Remove specific filter
function removeFilter(fieldId) {
    const field = document.getElementById(fieldId);
    if (field.tagName === 'SELECT') {
        field.value = '';
    } else {
        field.value = '';
    }
    applyFilters();
}

// Clear all filters
function clearFilters() {
    document.getElementById('filter-year').value = '';
    document.getElementById('filter-month').value = '';
    document.getElementById('filter-age').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('search-input').value = '';
    
    filteredInvoices = [...allInvoices];
    currentPage = 1;
    updateStats();
    renderTable();
    document.getElementById('active-filters').innerHTML = '';
}

// Render table
function renderTable() {
    const container = document.getElementById('table-container');
    const pagination = document.getElementById('pagination');
    
    if (filteredInvoices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No Invoices Found</h3>
                <p>No invoices match your current filters.</p>
                <button class="btn btn-secondary" onclick="clearFilters()">Clear Filters</button>
            </div>
        `;
        pagination.style.display = 'none';
        return;
    }

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredInvoices.length);
    const pageInvoices = filteredInvoices.slice(startIdx, endIdx);

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
        const ageDisplay = inv.age > 0 ? `${inv.age} days` : '-';
        
        html += `
            <tr onclick="viewInvoice(${inv.id})" data-id="${inv.id}">
                <td><strong>${inv.invoiceNo}</strong></td>
                <td>
                    <div class="company-name">${inv.company}</div>
                    <div class="branch-name">${inv.branch}</div>
                </td>
                <td class="amount">${formatCurrency(inv.amount)}</td>
                <td>${inv.monthYear}</td>
                <td class="${ageClass}">${ageDisplay}</td>
                <td><span class="badge badge-${(inv.category || 'rtp').toLowerCase()}">${inv.category}</span></td>
                <td>
                    <button class="btn btn-secondary" onclick="event.stopPropagation(); viewInvoice(${inv.id})">View</button>
                </td>
            </tr>
        `;
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

// Pagination
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
        document.querySelector('.table-scroll').scrollTop = 0;
    }
}

function nextPage() {
    const maxPage = Math.ceil(filteredInvoices.length / pageSize);
    if (currentPage < maxPage) {
        currentPage++;
        renderTable();
        document.querySelector('.table-scroll').scrollTop = 0;
    }
}

// View invoice details
function viewInvoice(invoiceId) {
    const invoice = allInvoices.find(inv => inv.id == invoiceId);
    if (invoice) {
        alert(`Invoice #${invoice.invoiceNo}\n\nCompany: ${invoice.company}\nBranch: ${invoice.branch}\nAmount: ${formatCurrency(invoice.amount)}\nMonth: ${invoice.monthYear}\nAge: ${invoice.age} days\nCategory: ${invoice.category}\n\n(Detail view coming in Phase 2)`);
    }
}

// Export to Excel
function exportToExcel() {
    if (filteredInvoices.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = ['Invoice #', 'Company', 'Branch', 'Amount', 'Month', 'Year', 'Age (Days)', 'Category'];
    const rows = filteredInvoices.map(inv => [
        inv.invoiceNo,
        inv.company,
        inv.branch,
        inv.amount.toFixed(2),
        inv.month || '',
        inv.year || '',
        inv.age,
        inv.category
    ]);

    let csv = '\uFEFF';
    csv += headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unpaid-invoices-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Search on Enter
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') applyFilters();
    });
    
    // Auto-apply filters on change
    ['filter-year', 'filter-month', 'filter-age', 'filter-category'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });
    
    loadUnpaidInvoices();
});
