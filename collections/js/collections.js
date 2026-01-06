/**
 * MARGA Collections Module
 * Phase 1: View Unpaid Invoices
 * Fixed: Fetch ALL records from all tables
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
async function firestoreGet(collection, pageSize = 500, pageToken = null) {
    let url = `${BASE_URL}/${collection}?pageSize=${pageSize}&key=${API_KEY}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${collection}`);
    return response.json();
}

// Fetch ALL documents from a collection (handles pagination)
async function firestoreGetAll(collection, statusCallback = null) {
    let allDocs = [];
    let pageToken = null;
    let page = 0;
    
    while (true) {
        const data = await firestoreGet(collection, 500, pageToken);
        if (data.documents) {
            allDocs = allDocs.concat(data.documents);
        }
        page++;
        
        if (statusCallback) {
            statusCallback(`Loading ${collection}... ${allDocs.length} records (page ${page})`);
        }
        
        // Check if there are more pages
        if (!data.nextPageToken || !data.documents || data.documents.length < 500) {
            break;
        }
        pageToken = data.nextPageToken;
    }
    
    console.log(`${collection}: ${allDocs.length} total records`);
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
        
        // Fetch ALL data from each collection
        updateLoadingStatus('Loading companies (1,143 records)...');
        const companyDocs = await firestoreGetAll('tbl_companylist', updateLoadingStatus);
        
        updateLoadingStatus('Loading branches (3,336 records)...');
        const branchDocs = await firestoreGetAll('tbl_branchinfo', updateLoadingStatus);
        
        updateLoadingStatus('Loading contracts (4,600 records)...');
        const contractDocs = await firestoreGetAll('tbl_contractmain', updateLoadingStatus);
        
        updateLoadingStatus('Loading payments (15,000+ records)...');
        const paymentDocs = await firestoreGetAll('tbl_paymentinfo', updateLoadingStatus);
        
        updateLoadingStatus('Loading billing records (15,000+ records)...');
        const billingDocs = await firestoreGetAll('tbl_billing', updateLoadingStatus);

        console.log('=== Data fetch complete ===');
        console.log({
            companies: companyDocs.length,
            branches: branchDocs.length,
            contracts: contractDocs.length,
            payments: paymentDocs.length,
            billing: billingDocs.length
        });

        // Build company lookup FIRST
        updateLoadingStatus('Building company lookup...');
        companyMap = {};
        companyDocs.forEach(doc => {
            const f = doc.fields;
            const id = getValue(f.id);
            companyMap[id] = getValue(f.companyname) || 'Unknown';
        });
        console.log('Company map size:', Object.keys(companyMap).length);

        // Build branch lookup
        updateLoadingStatus('Building branch lookup...');
        branchMap = {};
        branchDocs.forEach(doc => {
            const f = doc.fields;
            const id = getValue(f.id);
            branchMap[id] = {
                name: getValue(f.branchname) || 'Main',
                company_id: getValue(f.company_id)
            };
        });
        console.log('Branch map size:', Object.keys(branchMap).length);

        // Build contract lookup - KEY FIX: Map by contract ID
        updateLoadingStatus('Building contract lookup...');
        contractMap = {};
        contractDocs.forEach(doc => {
            const f = doc.fields;
            const id = getValue(f.id); // This is the contractmain_id that billing references
            contractMap[id] = {
                branch_id: getValue(f.contract_id), // contract_id in contractmain = branch_id in branchinfo
                mach_id: getValue(f.mach_id),
                category_id: getValue(f.category_id),
                status: getValue(f.status)
            };
        });
        console.log('Contract map size:', Object.keys(contractMap).length);
        
        // Debug: Check if contract 5485 exists now
        console.log('Contract 5485 exists?', contractMap[5485] ? 'YES' : 'NO');
        if (contractMap[5485]) {
            console.log('Contract 5485:', contractMap[5485]);
        }

        // Build payment lookup
        updateLoadingStatus('Processing payment data...');
        paidInvoiceIds = new Set();
        paymentDocs.forEach(doc => {
            const f = doc.fields;
            const invId = getValue(f.invoice_id);
            if (invId) {
                paidInvoiceIds.add(String(invId));
            }
        });
        console.log('Paid invoice IDs:', paidInvoiceIds.size);

        // Process billing records to find unpaid
        updateLoadingStatus('Finding unpaid invoices...');
        allInvoices = [];
        let linkedCount = 0;
        let unlinkedCount = 0;
        
        billingDocs.forEach(doc => {
            const f = doc.fields;
            const billingId = getValue(f.id);
            const invoiceId = getValue(f.invoice_id);
            
            // Check if this invoice is paid
            if (paidInvoiceIds.has(String(invoiceId))) {
                return; // Skip paid invoices
            }

            // Get contract info using contractmain_id
            const contractmainId = getValue(f.contractmain_id);
            const contract = contractMap[contractmainId];
            
            let companyName = 'Unknown';
            let branchName = 'Unknown';
            let categoryId = null;
            
            if (contract) {
                linkedCount++;
                const branch = branchMap[contract.branch_id];
                if (branch) {
                    branchName = branch.name || 'Main';
                    companyName = companyMap[branch.company_id] || 'Unknown';
                }
                categoryId = contract.category_id;
            } else {
                unlinkedCount++;
            }
            
            // Get month/year
            const monthStr = getValue(f.month);
            const yearStr = getValue(f.year);
            const dueDate = getValue(f.due_date);
            
            // Calculate age
            let age = calculateAgeFromDueDate(dueDate);
            if (age === 0 && monthStr && yearStr) {
                age = calculateAgeFromMonthYear(monthStr, yearStr);
            }
            
            // Get amount
            const totalAmount = parseFloat(getValue(f.totalamount) || getValue(f.amount) || 0);
            const vatAmount = parseFloat(getValue(f.vatamount) || 0);
            const finalAmount = totalAmount + vatAmount;

            // Format month/year
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

        console.log('=== Processing complete ===');
        console.log('Total unpaid:', allInvoices.length);
        console.log('Linked to company:', linkedCount);
        console.log('Unlinked (Unknown):', unlinkedCount);

        // Sort by amount descending
        allInvoices.sort((a, b) => b.amount - a.amount);

        // Apply initial filters
        filteredInvoices = [...allInvoices];
        
        // Update UI
        updateStats();
        populateMonthFilter();
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
    const categories = {
        1: 'RTP', 2: 'RTF', 3: 'STP', 4: 'MAT', 5: 'RTC',
        6: 'STC', 7: 'MAC', 8: 'MAP', 9: 'REF', 10: 'RD',
        11: 'PI', 12: 'OTH'
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
    
    const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    const sortedMonths = Array.from(months).sort((a, b) => {
        const [monthA, yearA] = a.split(' ');
        const [monthB, yearB] = b.split(' ');
        if (yearA !== yearB) return parseInt(yearB) - parseInt(yearA);
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
        if (monthFilter && inv.monthYear !== monthFilter) return false;
        if (ageFilter && inv.age < parseInt(ageFilter)) return false;
        if (searchTerm) {
            const searchStr = `${inv.company} ${inv.branch} ${inv.invoiceNo} ${inv.invoiceId}`.toLowerCase();
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
                    <button class="btn btn-secondary" onclick="event.stopPropagation(); viewInvoice(${inv.id})">
                        View
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

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
        console.log('View invoice:', invoice);
        alert(`Invoice #${invoice.invoiceNo}\n\nCompany: ${invoice.company}\nBranch: ${invoice.branch}\nAmount: ${formatCurrency(invoice.amount)}\nMonth: ${invoice.monthYear}\nAge: ${invoice.age} days\n\n(Detail view coming in Phase 2)`);
    }
}

// Export to Excel
function exportToExcel() {
    if (filteredInvoices.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = ['Invoice #', 'Invoice ID', 'Company', 'Branch', 'Amount', 'Month/Year', 'Due Date', 'Age (Days)', 'Category', 'Received By'];
    const rows = filteredInvoices.map(inv => [
        inv.invoiceNo,
        inv.invoiceId,
        inv.company,
        inv.branch,
        inv.amount.toFixed(2),
        inv.monthYear,
        inv.dueDate || '',
        inv.age,
        inv.category,
        inv.receivedBy || ''
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
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            applyFilters();
        }
    });
    
    loadUnpaidInvoices();
});
