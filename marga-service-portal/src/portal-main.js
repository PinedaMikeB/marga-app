import { DataService } from './lib/data-service.js';
import { setupInstallGuide } from './lib/install-guide.js';
import { setupPwa } from './lib/pwa.js';
import { clearAuthToken, clearSession, loadAuthToken, loadPreviewBranchId, loadPreviewCompanyId, loadSession, roleLabel, saveAuthToken, savePreviewBranchId, savePreviewCompanyId, saveSession } from './lib/session.js';
import { hashSignerPin } from './lib/pin-security.js';
import { cleanBranchName, escapeHtml, formatBillingPeriod, formatDate, formatDatePH, formatMoney, statusClass } from './lib/utils.js';

const service = new DataService();
const config = window.MSP_CONFIG || {};

const state = {
  user: null,
  company: null,
  activeCompanyId: null,   // null = show all; number = specific group selected
  portalCompanies: [],     // all companies this user can see (for switcher)
  previewSearchQuery: '',
  previewSearchResults: [],
  previewDraftAccount: null,
  adminTab: 'preview',          // 'preview' | 'credentials'
  deviceStatusFilter: '',  // '' = all | 'Active' | 'Needs Attention' | 'For Replacement' | 'Inactive'
  credSearch: '',
  credRoleFilter: '',
  credStatusFilter: '',
  credActiveFilter: 'true',
  credPage: 1,
  credTotal: 0,
  credPages: 1,
  credAccounts: [],
  credEditId: null,
  credLinkSearchResults: [],
  credLinkQuery: '',
  previewBranches: [],
  previewBranchDetail: null,
  previewCompanyId: '',
  previewCompanyIds: [],
  previewCompanyName: '',
  previewBranchId: '',
  previewLaunch: null,
  previewPickerExpanded: true,
  currentView: 'dashboard',
  deviceSearchQuery: '',
  selectedDeviceId: null,
  deviceDetailOpen: false,
  deviceDetailLoading: false,
  deviceDetail: null,
  deviceDetailRequestId: 0,
  selectedTicketId: null,
  ticketFilter: 'all',
  ticketTab: 'my-tickets',    // 'my-tickets' | 'create'
  ticketDetailOpen: false,
  ticketDetailLoading: false,
  ticketDetail: null,
  ticketDetailRequestId: 0,
  ticketMessageSending: false,
  highlightTicketId: null     // newly created ticket to visually highlight in My Tickets
};

// Expose state for data-service group switcher integration
window.__margaCareState = state;

const authView = document.getElementById('authView');
const portalView = document.getElementById('portalView');
const loginForm = document.getElementById('loginForm');
const authMessage = document.getElementById('authMessage');
const navRoot = document.getElementById('portalNav');
const bottomNav = document.getElementById('bottomNav');
const viewTitle = document.getElementById('viewTitle');
const viewSubtitle = document.getElementById('viewSubtitle');
const announcements = document.getElementById('announcements');
const viewContainer = document.getElementById('viewContainer');
const syncBadge = document.getElementById('syncBadge');
const menuToggle = document.getElementById('menuToggle');
const installBtn = document.getElementById('installBtn');
const sidebar = document.getElementById('portalSidebar');

const roleViews = {
  marga_admin: [
    { key: 'dashboard', label: 'Home', subtitle: 'Customer care command view' },
    { key: 'devices', label: 'Machines', subtitle: 'Machine inventory and service history' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Service requests and follow-ups' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Supply requests and status' },
    { key: 'billing', label: 'Billing & Payments', subtitle: 'Invoices, payments, and statements' },
    { key: 'history', label: 'Proof & History', subtitle: 'Customer-facing activity and proof trail' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ],
  marga_staff: [
    { key: 'dashboard', label: 'Home', subtitle: 'Marga care overview' },
    { key: 'devices', label: 'Machines', subtitle: 'Machine inventory and service history' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Service requests and follow-ups' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Supply requests and status' },
    { key: 'history', label: 'Proof & History', subtitle: 'Recent customer-facing updates and proof' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ],
  corporate_admin: [
    { key: 'dashboard', label: 'Home', subtitle: 'Your service, billing, and request overview' },
    { key: 'devices', label: 'Machines', subtitle: 'Machine inventory and service history' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Service requests and follow-ups' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Supply requests and status' },
    { key: 'billing', label: 'Billing & Payments', subtitle: 'Invoices, payments, and statements' },
    { key: 'history', label: 'Proof & History', subtitle: 'Timeline of updates, service proof, and posted payments' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' },
    { key: 'admin', label: 'Admin', subtitle: 'Branches, devices, signers, and reports' }
  ],
  company_admin: [
    { key: 'dashboard', label: 'Home', subtitle: 'Your service, billing, and request overview' },
    { key: 'devices', label: 'Machines', subtitle: 'Machine inventory and service history' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Service requests and follow-ups' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Supply requests and status' },
    { key: 'billing', label: 'Billing & Payments', subtitle: 'Invoices, payments, and statements' },
    { key: 'history', label: 'Proof & History', subtitle: 'Timeline of updates, service proof, and posted payments' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ],
  branch_manager: [
    { key: 'dashboard', label: 'Home', subtitle: 'Branch service, billing, and support overview' },
    { key: 'devices', label: 'Machines', subtitle: 'Branch machine inventory' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Branch service requests' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Branch supply requests' },
    { key: 'billing', label: 'Billing & Payments', subtitle: 'Branch invoices and dues' },
    { key: 'history', label: 'Proof & History', subtitle: 'Branch request, payment, and service history' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ],
  end_user: [
    { key: 'dashboard', label: 'Home', subtitle: 'Request support and track your updates' },
    { key: 'devices', label: 'Machines', subtitle: 'Branch devices you can request service for' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Create and track your requests' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Request consumables' },
    { key: 'history', label: 'Proof & History', subtitle: 'Your request history and completed service proof' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ],
  branch_user: [
    { key: 'dashboard', label: 'Home', subtitle: 'Request support and track your updates' },
    { key: 'devices', label: 'Machines', subtitle: 'Branch devices you can request service for' },
    { key: 'tickets', label: 'Service Requests', subtitle: 'Create and track your requests' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Request consumables' },
    { key: 'history', label: 'Proof & History', subtitle: 'Your request history and completed service proof' },
    { key: 'support', label: 'Contact Marga', subtitle: 'Support channels and escalation' }
  ]
};

function currentViews() {
  return roleViews[state.user?.role] || [];
}

function isInternalPortalUser(user = state.user) {
  return user?.role === 'marga_admin' || user?.role === 'marga_staff';
}

function findView(viewKey) {
  return currentViews().find((entry) => entry.key === viewKey) || currentViews()[0];
}

function activeCompanyId() {
  if (isInternalPortalUser()) return state.previewCompanyId;
  return state.activeCompanyId || state.user?.companyId;
}

function hasMultipleCompanies() {
  return state.portalCompanies.length > 1;
}

// Build the URL query string to scope API calls to the active company
function companyQs() {
  const id = state.activeCompanyId;
  return id ? `activeCompanyId=${encodeURIComponent(id)}` : '';
}

function canViewBilling() {
  return ['marga_admin', 'corporate_admin', 'company_admin', 'branch_manager'].includes(state.user?.role);
}

function shortDate(value) {
  if (!value) return 'Waiting update';
  return formatDate(value);
}

function timestampValue(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function statusTone(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('complete') || text.includes('paid') || text.includes('fulfilled') || text.includes('posted')) return 'ok';
  if (text.includes('pending') || text.includes('assigned') || text.includes('open') || text.includes('progress')) return 'watch';
  return 'calm';
}

function activityChip(label, tone = 'calm') {
  return `<span class="activity-chip activity-chip-${tone}">${escapeHtml(label)}</span>`;
}

function buildActivityFeed({ tickets = [], requests = [], payments = [], invoices = [] }) {
  const items = [];

  tickets.forEach((ticket) => {
    items.push({
      type: 'Service Request',
      tone: statusTone(ticket.status),
      title: ticket.ticketNo || ticket.id || 'Service ticket',
      summary: ticket.description || ticket.category || 'Service issue reported',
      detail: ticket.status ? `Status: ${ticket.status}` : 'Waiting for update',
      at: ticket.updatedAt || ticket.createdAt
    });
    if (ticket.completion) {
      items.push({
        type: 'Service Proof',
        tone: 'ok',
        title: ticket.ticketNo || ticket.id || 'Completed service',
        summary: ticket.completion.acknowledgedByName
          ? `Confirmed by ${ticket.completion.acknowledgedByName}`
          : 'Service completed and recorded',
        detail: ticket.completion.ackMethod ? `Proof: ${ticket.completion.ackMethod}` : 'Completion proof saved',
        at: ticket.completion.completedAt || ticket.updatedAt || ticket.createdAt
      });
    }
  });

  requests.forEach((request) => {
    items.push({
      type: 'Toner / Ink',
      tone: statusTone(request.status),
      title: request.id || 'Supply request',
      summary: request.notes || 'Supply request sent to Marga',
      detail: request.status ? `Status: ${request.status}` : 'Pending fulfillment',
      at: request.updatedAt || request.createdAt
    });
  });

  payments.forEach((payment) => {
    items.push({
      type: 'Payment Proof',
      tone: 'ok',
      title: formatMoney(payment.amount || 0),
      summary: `Payment posted${payment.referenceNo ? ` · Ref ${payment.referenceNo}` : ''}`,
      detail: payment.method || 'Payment recorded',
      at: payment.date
    });
  });

  invoices.forEach((invoice) => {
    items.push({
      type: 'Billing',
      tone: statusTone(invoice.status),
      title: formatBillingPeriod(invoice.period, invoice.dueDate) || invoice.invoiceNo || 'Invoice',
      summary: `${formatMoney(invoice.amount || 0)}${invoice.status ? ` · ${invoice.status}` : ''}`,
      detail: invoice.dueDate ? `Due: ${formatDatePH(invoice.dueDate)}` : 'Invoice available in portal',
      at: invoice.dueDate
    });
  });

  return items.sort((a, b) => timestampValue(b.at) - timestampValue(a.at));
}

function setTopMessage(text, type = 'info') {
  authMessage.textContent = text;
  authMessage.style.color = type === 'error' ? '#b91c1c' : '#335d86';
}

function bindDragScroll(container) {
  if (!container || container.dataset.dragScrollBound === '1') return;
  container.dataset.dragScrollBound = '1';
  let pointerDown = false;
  let startX = 0;
  let startScrollLeft = 0;

  const finishDrag = () => {
    pointerDown = false;
    container.classList.remove('is-dragging');
  };

  container.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    pointerDown = true;
    startX = event.pageX;
    startScrollLeft = container.scrollLeft;
    container.classList.add('is-dragging');
  });

  container.addEventListener('mousemove', (event) => {
    if (!pointerDown) return;
    event.preventDefault();
    container.scrollLeft = startScrollLeft - (event.pageX - startX);
  });

  container.addEventListener('wheel', (event) => {
    const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
    if (!hasHorizontalOverflow) return;
    if (Math.abs(event.deltaX) > 0) {
      container.scrollLeft += event.deltaX;
      event.preventDefault();
      return;
    }
    if (event.shiftKey && Math.abs(event.deltaY) > 0) {
      container.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, { passive: false });

  container.addEventListener('mouseleave', finishDrag);
  container.addEventListener('mouseup', finishDrag);
  window.addEventListener('mouseup', finishDrag);
}

function showNotice(message, type = 'neutral') {
  const note = document.createElement('div');
  note.className = 'announcement-item';
  if (type === 'error') {
    note.style.borderColor = 'rgba(239,68,68,0.4)';
    note.style.color = '#b91c1c';
  }
  if (type === 'success') {
    note.style.borderColor = 'rgba(5,150,105,0.4)';
    note.style.color = '#065f46';
  }
  note.textContent = message;
  announcements.style.display = 'grid';
  announcements.prepend(note);
  setTimeout(() => {
    note.remove();
    if (!announcements.children.length) {
      announcements.style.display = 'none';
    }
  }, 4800);
}

function renderAnnouncements() {
  const items = state.company?.announcements || config.announcements || [];
  announcements.innerHTML = items.map((item) => `<div class="announcement-item">${escapeHtml(item)}</div>`).join('');
  announcements.style.display = items.length ? 'grid' : 'none';
}

function renderUserCard() {
  const user = state.user;
  if (!user) return;
  const initials = (user.name || user.email || 'U').trim().charAt(0).toUpperCase();
  const roleText  = roleLabel(user.role);

  // Sidebar elements (still exist in slide-out)
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (nameEl) nameEl.textContent = user.name || user.email || 'User';
  if (roleEl) roleEl.textContent = roleText;

  // Topbar avatar
  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) avatarEl.textContent = initials;

  // Topbar popup name/role
  const name2El = document.getElementById('userName2');
  const role2El = document.getElementById('userRole2');
  if (name2El) name2El.textContent = user.name || user.email || '';
  if (role2El) role2El.textContent = roleText;

  // Toggle popup on avatar click
  const popup = document.getElementById('topbarUserPopup');
  if (avatarEl && popup) {
    avatarEl.onclick = (e) => {
      e.stopPropagation();
      popup.classList.toggle('open');
    };
    document.addEventListener('click', () => popup.classList.remove('open'), { once: false });
  }

  // Topbar logout button
  const logoutBtn2 = document.getElementById('logoutBtn2');
  if (logoutBtn2) {
    logoutBtn2.onclick = () => {
      clearSession({ keepPersistent: String(user?.id || '').startsWith('portal:') });
      location.href = '/';
    };
  }
}

async function applyCustomerPreview(companyId, branchId = '') {
  const account = typeof companyId === 'object' && companyId
    ? companyId
    : { id: companyId, companyIds: companyId ? [companyId] : [], name: state.company?.name || 'Customer' };
  const resolvedCompanyIds = Array.isArray(account.companyIds) && account.companyIds.length
    ? account.companyIds.map((value) => String(value))
    : (account.id ? [String(account.id)] : []);
  state.previewCompanyId = account?.id ? String(account.id) : '';
  state.previewCompanyIds = resolvedCompanyIds;
  state.previewCompanyName = account?.name || account?.motherName || '';
  state.previewBranchId = branchId ? String(branchId) : '';
  if (state.user) {
    state.user.previewCompanyId = state.previewCompanyId;
    state.user.previewCompanyIds = state.previewCompanyIds.slice();
    state.user.previewCompanyName = state.previewCompanyName;
    state.user.previewBranchId = state.previewBranchId;
    saveSession(state.user);
  }
  savePreviewCompanyId(state.previewCompanyId);
  savePreviewBranchId(state.previewBranchId);
  state.company = state.previewCompanyName
    ? {
        id: state.previewCompanyId || state.user?.companyId || 'marga_internal',
        name: state.previewCompanyName,
        status: 'active',
        announcements: ['Internal Marga portal view.']
      }
    : await service.getCompanyById(state.previewCompanyId || state.user?.companyId, state.user);
  await renderView();
  renderAnnouncements();
}

function renderNav() {
  const viewList = currentViews();
  const navLinks = viewList
    .map(
      (view) =>
        `<a href="#${view.key}" class="nav-link ${state.currentView === view.key ? 'active' : ''}" data-view="${view.key}">${escapeHtml(
          view.label
        )}</a>`
    )
    .join('');

  // Group switcher — shown only when overseer manages multiple companies
  const switcherHtml = hasMultipleCompanies()
    ? `<div class="group-switcher">
        <span class="group-switcher-label">Viewing</span>
        <select id="companySwitcher" class="group-switcher-select">
          <option value="">All Groups</option>
          ${state.portalCompanies.map(c =>
            `<option value="${c.id}" ${String(state.activeCompanyId) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
          ).join('')}
        </select>
      </div>`
    : '';

  navRoot.innerHTML = switcherHtml + navLinks;
  bottomNav.innerHTML = navLinks;

  // Wire the switcher
  document.getElementById('companySwitcher')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    state.activeCompanyId = val ? Number(val) : null;
    // Update company name shown in header
    const co = state.portalCompanies.find(c => String(c.id) === val);
    state.company = co ? { ...state.company, name: co.name } : state.company;
    await reloadCurrentView();
  });
}

async function reloadCurrentView() {
  const view = state.currentView;
  if (view === 'dashboard') await renderDashboard();
  else if (view === 'devices') await renderDevices();
  else if (view === 'tickets') await renderTickets();
  else if (view === 'toner') await renderToner();
  else if (view === 'billing') await renderBilling();
  else if (view === 'history') await renderHistory();
  else if (view === 'support') renderSupport();
}

function setView(viewKey, replaceHash = true) {
  const safe = findView(viewKey)?.key || 'dashboard';
  state.currentView = safe;
  const viewMeta = findView(safe);
  if (viewTitle) viewTitle.textContent = viewMeta?.label || 'Dashboard';
  if (viewSubtitle) viewSubtitle.textContent = viewMeta?.subtitle || '';
  renderNav();
  if (replaceHash && location.hash !== `#${safe}`) {
    history.replaceState(null, '', `#${safe}`);
  }
  renderView().catch((error) => {
    console.error(error);
    showNotice(error.message || 'Failed to render view.', 'error');
  });
}

function rbacBranchOptions(branches) {
  return branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('');
}

async function updatePreviewSearch(query) {
  state.previewSearchQuery = String(query || '');
  if (!state.previewPickerExpanded) state.previewPickerExpanded = true;
  state.previewDraftAccount = null;
  state.previewBranches = [];
  state.previewBranchId = '';
  if (!state.previewSearchQuery.trim()) {
    state.previewSearchResults = [];
    await renderView();
    return;
  }
  state.previewSearchResults = await service.searchPreviewAccounts(state.previewSearchQuery);
  await renderView();
}

async function selectPreviewAccount(accountId) {
  const selected = state.previewSearchResults.find((entry) => String(entry.id) === String(accountId)) || null;
  if (!selected) return;
  state.previewDraftAccount = selected;
  state.previewSearchQuery = '';
  state.previewPickerExpanded = true;
  state.previewBranchId = '';
  state.previewBranchDetail = null;
  state.previewLaunch = null;
  state.previewBranches = await service.listPreviewBranches(selected.companyIds?.length ? selected.companyIds : selected.id);
  state.previewSearchResults = [];
  await renderView();
}

async function previewCompanyHere() {
  if (!state.previewDraftAccount) {
    showNotice('Choose a customer account first.', 'error');
    return;
  }
  await applyCustomerPreview(state.previewDraftAccount, '');
  state.previewLaunch = null;
  showNotice(`Previewing ${state.previewDraftAccount.name}.`, 'success');
}

async function loadBranchDetail(branchId) {
  if (!state.previewDraftAccount) return;
  state.previewBranchDetail = await service.getPreviewBranchDetail({
    companyId: state.previewDraftAccount.id,
    branchId,
    companyIds: state.previewDraftAccount.companyIds
  });
  state.previewBranchId = String(branchId || '');
  await renderView();
}

async function openPreviewLaunch(kind, branchId = '') {
  if (!state.previewDraftAccount) {
    showNotice('Choose a customer account first.', 'error');
    return;
  }
  if (kind === 'branch' && !branchId) {
    showNotice('Choose a branch first.', 'error');
    return;
  }
  let payload = null;
  if (kind === 'branch') {
    const branch = state.previewBranches.find((entry) => String(entry.id) === String(branchId));
    if (!branch) {
      showNotice('Branch was not found.', 'error');
      return;
    }
    payload = {
      kind,
      branchId: String(branch.id),
      branchName: branch.name,
      companyId: branch.companyId,
      prefillEmail: '',
      loginUrl: ''
    };
  } else {
    payload = {
      kind,
      companyId: state.previewDraftAccount.id,
      companyIds: state.previewDraftAccount.companyIds,
      customerName: state.previewDraftAccount.name,
      prefillEmail: '',
      loginUrl: ''
    };
  }
  state.previewLaunch = payload;
  await renderView();
}

async function openPreviewInSeparateTab() {
  if (!state.previewLaunch) return;
  const launchPayload = state.previewLaunch.kind === 'branch'
    ? {
        companyId: state.previewLaunch.companyId,
        branchId: state.previewLaunch.branchId
      }
    : {
        companyId: state.previewLaunch.companyId
      };
  const launch = await service.createPreviewLaunch(launchPayload);
  state.previewLaunch = null;
  window.open(launch.loginUrl, '_blank', 'noopener,noreferrer');
  await renderView();
  showNotice(`Opened ${launch.prefillEmail} in a separate preview tab.`, 'success');
}

function renderPreviewSearchResults() {
  if (!state.previewSearchQuery.trim()) {
    return '';
  }
  if (!state.previewSearchResults.length) {
    return `<div class="care-preview-hint">No customer account matched "${escapeHtml(state.previewSearchQuery)}".</div>`;
  }
  const groups = [];
  state.previewSearchResults.forEach((account) => {
    const motherName = account.motherName || account.name;
    let bucket = groups.find((entry) => entry.motherName === motherName);
    if (!bucket) {
      bucket = { motherName, accounts: [] };
      groups.push(bucket);
    }
    bucket.accounts.push(account);
  });

  return `
    <div class="care-preview-results" role="listbox" aria-label="Customer search results">
      ${groups.map((group) => `
        <section class="care-preview-group">
          <header class="care-preview-group-head">
            <strong>${escapeHtml(group.motherName)}</strong>
            <span>${group.accounts.length}</span>
          </header>
          ${group.accounts.map((account) => `
            <button type="button" class="care-preview-result ${String(state.previewDraftAccount?.id) === String(account.id) ? 'active' : ''}" data-preview-account="${account.id}" role="option" aria-selected="${String(state.previewDraftAccount?.id) === String(account.id)}">
              <span class="care-preview-result-name">${escapeHtml(account.groupLabel || account.name)}</span>
              <span class="care-preview-result-meta">${account.branchCount} branches${account.machineCount ? ` • ${account.machineCount} machines` : ''}</span>
            </button>
          `).join('')}
        </section>
      `).join('')}
    </div>
  `;
}

function selectedPreviewCompanyIsGrouped() {
  return Array.isArray(state.previewDraftAccount?.companyIds) && state.previewDraftAccount.companyIds.length > 1;
}

function branchLocationLabel(branch) {
  return branch.city || branch.address || '-';
}

function renderPreviewBranchTable() {
  if (!state.previewDraftAccount) return '';
  return `
    <div class="care-preview-branch-block">
      <div class="panel-head">
        <h3>Branches / Departments</h3>
        <span class="muted">${state.previewBranches.length} record${state.previewBranches.length === 1 ? '' : 's'}</span>
      </div>
      ${
        state.previewBranches.length
          ? `<div class="table-wrap care-preview-table-wrap">
              <table class="data-table care-preview-table">
                <thead>
                  <tr>
                    <th>Department Name</th>
                    <th>Contact Person</th>
                    <th>Contact Number</th>
                    <th>Email</th>
                    <th>Location (City)</th>
                    <th>Serial Number</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.previewBranches.map((branch) => `
                    <tr>
                      <td>${escapeHtml(cleanBranchName(branch.name))}</td>
                      <td>${escapeHtml(branch.contactPerson || '-')}</td>
                      <td>${escapeHtml(branch.contactNumber || '-')}</td>
                      <td>${escapeHtml(branch.email || '-')}</td>
                      <td>${escapeHtml(branchLocationLabel(branch))}</td>
                      <td>${escapeHtml(branch.serialNumbers || '-')}</td>
                      <td><button type="button" class="btn btn-secondary btn-sm" data-branch-detail="${branch.id}">View Branch Detail</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty-state">No branches or departments were found for this customer.</div>'
      }
    </div>
  `;
}

function renderPreviewBranchDetail() {
  const detail = state.previewBranchDetail;
  if (!detail) return '';
  const outstanding = Number(detail.summary?.outstandingAmount || 0);
  const conditionLines = Array.isArray(detail.summary?.deviceConditions) ? detail.summary.deviceConditions : [];
  return `
    <section class="panel glass care-branch-detail">
      <div class="panel-head stack-on-mobile">
        <h3>${escapeHtml(detail.branch?.name || 'Branch detail')}</h3>
        <div class="care-preview-actions">
          <button type="button" class="btn btn-primary" id="previewBranchLocalBtn">Local View</button>
          <button type="button" class="btn btn-secondary" id="previewBranchTabBtn" ${detail.previewAccount ? '' : 'disabled'}>Separate Tab</button>
        </div>
      </div>
      <div class="kpi-grid care-branch-kpis">
        <div class="kpi-card"><div class="value">${detail.summary?.machineCount || 0}</div><div class="label">Machines</div></div>
        <div class="kpi-card"><div class="value money-value">${formatMoney(outstanding)}</div><div class="label">${outstanding > 0 ? 'Unpaid Balance' : 'Paid / Updated'}</div></div>
        <div class="kpi-card"><div class="value">${detail.summary?.deliveredTonerCount || 0}</div><div class="label">Successful Toner Deliveries</div></div>
        <div class="kpi-card"><div class="value">${detail.summary?.completedServiceCount || 0}</div><div class="label">Successful Repairs</div></div>
      </div>
      <div class="grid-2 care-branch-detail-grid">
        <article class="panel glass care-branch-condition-card">
          <div class="panel-head"><h3>Condition Of Unit</h3></div>
          ${
            conditionLines.length
              ? `<div class="care-condition-list">
                  ${conditionLines.map((item) => `<div class="summary-line"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>`).join('')}
                </div>`
              : '<div class="empty-state">No machine condition data yet.</div>'
          }
        </article>
        <article class="panel glass care-branch-machine-card">
          <div class="panel-head"><h3>Machines</h3></div>
          ${
            detail.devices?.length
              ? `<div class="table-wrap">
                  <table class="data-table">
                    <thead><tr><th>Serial</th><th>Model</th><th>Status</th></tr></thead>
                    <tbody>
                      ${detail.devices.map((device) => `<tr><td>${escapeHtml(device.serial || '-')}</td><td>${escapeHtml(device.model || '-')}</td><td>${escapeHtml(device.status || '-')}</td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>`
              : '<div class="empty-state">No machines are assigned to this branch yet.</div>'
          }
        </article>
      </div>
    </section>
  `;
}

function renderPreviewLaunchModal() {
  if (!state.previewLaunch) return '';
  const canOpenTab = state.previewLaunch.kind === 'branch' || !selectedPreviewCompanyIsGrouped();
  return `
    <div class="care-modal-backdrop" id="carePreviewModal">
      <div class="care-modal glass">
        <div class="panel-head">
          <h3>${state.previewLaunch.kind === 'branch' ? 'Open Branch Preview' : 'Open Customer Preview'}</h3>
          <button type="button" class="btn btn-secondary btn-sm" id="closePreviewModal">Close</button>
        </div>
        <div class="care-preview-choice-list">
          <button type="button" class="care-preview-choice" id="previewLocalChoice">
            <strong>Local View</strong>
            <span>Stay in this internal screen and preview the scoped portal here.</span>
          </button>
          <button type="button" class="care-preview-choice" id="previewTabChoice" ${canOpenTab ? '' : 'disabled'}>
            <strong>Separate Tab</strong>
            <span>${canOpenTab ? `Open the real customer login screen with ${escapeHtml(state.previewLaunch.prefillEmail || '')} prefilled.` : 'Grouped customer previews only support local view until one real portal login is assigned to that exact grouped scope.'}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderInternalCustomerPicker() {
  if (!isInternalPortalUser()) return '';

  return `
    <section class="panel glass care-preview-bar">
      <form id="internalCustomerPicker" class="care-preview-form">
        <div class="care-preview-field">
          <label for="internalCustomerSearch">Customer</label>
          <input id="internalCustomerSearch" name="customerSearch" placeholder="" value="${escapeHtml(state.previewSearchQuery)}" autocomplete="off" />
        </div>
        ${renderPreviewSearchResults()}
        ${state.previewDraftAccount ? `
          <div class="care-preview-selected">
            <strong>${escapeHtml(state.previewDraftAccount.name)}</strong>
          </div>
        ` : ''}
        ${renderPreviewBranchTable()}
        <div class="care-preview-actions">
          <button type="submit" class="btn btn-primary" ${state.previewDraftAccount ? '' : 'disabled'}>Preview Customer</button>
          ${state.previewCompanyId ? '<button type="button" class="btn btn-secondary" id="clearCustomerPreview">Back To Internal</button>' : ''}
        </div>
      </form>
    </section>
    ${renderPreviewBranchDetail()}
    ${renderPreviewLaunchModal()}
  `;
}

function bindInternalCustomerPicker() {
  const form = document.getElementById('internalCustomerPicker');
  if (!form || !isInternalPortalUser()) return;

  document.getElementById('internalCustomerSearch')?.addEventListener('input', (event) => {
    window.clearTimeout(bindInternalCustomerPicker.searchTimer);
    bindInternalCustomerPicker.searchTimer = window.setTimeout(() => {
      updatePreviewSearch(event.target.value).catch((error) => showNotice(error.message || 'Unable to search customers.', 'error'));
    }, 250);
  });

  viewContainer.querySelectorAll('[data-preview-account]').forEach((button) => {
    button.addEventListener('click', () => {
      selectPreviewAccount(button.getAttribute('data-preview-account')).catch((error) => showNotice(error.message || 'Unable to load customer branches.', 'error'));
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.previewDraftAccount) {
      showNotice('Choose a customer account first.', 'error');
      return;
    }
    await openPreviewLaunch('company');
  });

  document.getElementById('clearCustomerPreview')?.addEventListener('click', async () => {
    state.previewDraftAccount = null;
    state.previewSearchQuery = '';
    state.previewSearchResults = [];
    state.previewBranches = [];
    state.previewBranchDetail = null;
    state.previewCompanyIds = [];
    state.previewCompanyName = '';
    state.previewLaunch = null;
    state.previewPickerExpanded = true;
    await applyCustomerPreview('', '');
    showNotice('Returned to internal preview mode.', 'success');
  });

  viewContainer.querySelectorAll('[data-branch-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      loadBranchDetail(button.getAttribute('data-branch-detail')).catch((error) => showNotice(error.message || 'Unable to load branch detail.', 'error'));
    });
  });

  document.getElementById('previewBranchLocalBtn')?.addEventListener('click', async () => {
    if (!state.previewBranchDetail?.branch?.id) return;
    const targetBranchId = String(state.previewBranchDetail.branch.id);
    await applyCustomerPreview(state.previewDraftAccount, targetBranchId);
    state.previewLaunch = null;
    showNotice(`Previewing ${state.previewBranchDetail.branch.name}.`, 'success');
  });

  document.getElementById('previewBranchTabBtn')?.addEventListener('click', async () => {
    if (!state.previewBranchDetail?.branch?.id) return;
    await openPreviewLaunch('branch', String(state.previewBranchDetail.branch.id));
  });

  document.getElementById('previewLocalChoice')?.addEventListener('click', async () => {
    if (state.previewLaunch?.kind === 'branch') {
      if (!state.previewBranchDetail?.branch?.id) return;
      state.previewLaunch = null;
      await applyCustomerPreview(state.previewDraftAccount, String(state.previewBranchDetail.branch.id));
      showNotice(`Previewing ${state.previewBranchDetail.branch.name}.`, 'success');
    } else {
      await previewCompanyHere();
    }
  });

  document.getElementById('previewTabChoice')?.addEventListener('click', () => {
    openPreviewInSeparateTab().catch((error) => showNotice(error.message || 'Unable to open separate preview tab.', 'error'));
  });

  document.getElementById('closePreviewModal')?.addEventListener('click', async () => {
    state.previewLaunch = null;
    await renderView();
  });
}

async function renderDashboard() {
  // ── Marga Admin Home — tabbed: Preview | Credentials & Access ──────────
  if (isInternalPortalUser() && !state.previewCompanyId) {
    viewContainer.innerHTML = `
      <div class="admin-tabs">
        <button class="admin-tab-btn ${state.adminTab === 'preview' ? 'active' : ''}" data-tab="preview">Customer Preview</button>
        <button class="admin-tab-btn ${state.adminTab === 'credentials' ? 'active' : ''}" data-tab="credentials">Credentials &amp; Access</button>
      </div>
      <div id="adminTabBody"></div>
    `;
    viewContainer.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.adminTab = btn.getAttribute('data-tab');
        await renderDashboard();
      });
    });
    if (state.adminTab === 'preview') {
      document.getElementById('adminTabBody').innerHTML = renderInternalCustomerPicker();
      bindInternalCustomerPicker();
    } else {
      await renderCredentialsTab();
    }
    return;
  }

  const customerPreviewRequired = isInternalPortalUser() && !state.previewCompanyId;
  if (customerPreviewRequired) {
    viewContainer.innerHTML = `${renderInternalCustomerPicker()}`;
    bindInternalCustomerPicker();
    return;
  }

  let summary, serviceHistoryResult, devicesForFleet, tickets, requests, invoices, payments;
  viewContainer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3)">Loading dashboard...</div>';
  try {
    [summary, serviceHistoryResult, devicesForFleet, tickets, requests, invoices, payments] = await Promise.all([
      service.getDashboardSummary(state.user),
      service.getServiceHistory(state.user).catch(() => ({ summary: null, recentEvents: [] })),
      service.listDevices(state.user).catch(() => []),
      service.listTickets(state.user),
      service.listTonerRequests(state.user),
      canViewBilling() ? service.listInvoices(state.user) : Promise.resolve([]),
      canViewBilling() ? service.listPayments(state.user) : Promise.resolve([])
    ]);
  } catch (err) {
    // Session expired or API error — show login
    console.error('Dashboard load failed:', err.message);
    clearSession();
    authView.classList.remove('hidden');
    portalView.classList.add('hidden');
    setTimeout(() => {
      document.querySelectorAll('.reveal-up').forEach((el, i) => {
        setTimeout(() => el.classList.add('revealed'), 60 + i * 110);
      });
    }, 100);
    return;
  }
  const groupMachines = summary.activeGroupMachines ?? summary.groupActiveMachines ?? summary.groupMachines ?? summary.activeDevices ?? 0;
  const individualMachines = summary.activeIndividualMachines ?? summary.individualActiveMachines ?? summary.individualMachines ?? 0;
  const allMachines = Number(groupMachines || 0) + Number(individualMachines || 0);
  const recentActivityCount = tickets.length + requests.length;

  // Build "last service" smart text from service history
  const histSummary = serviceHistoryResult?.summary || summary;
  const lastServiceData = histSummary?.lastService || null;
  const lastTonerData = histSummary?.lastToner || null;
  const recentEvents = serviceHistoryResult?.recentEvents || [];

  function daysAgo(dateStr) {
    if (!dateStr) return null;
    const ms = Date.now() - Date.parse(dateStr);
    if (!Number.isFinite(ms) || ms < 0) return null;
    const days = Math.floor(ms / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
    if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
    return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
  }

  function smartServiceText(data, fallback) {
    if (!data) return fallback;
    const ago = daysAgo(data.date);
    const branch = data.branchName ? ` · ${escapeHtml(data.branchName)}` : '';
    return ago ? `${ago}${branch}` : fallback;
  }

  const lastServiceText = smartServiceText(lastServiceData, 'No service on record');
  const lastTonerText = smartServiceText(lastTonerData, 'No deliveries on record');
  const billingCardText = summary.unpaidAmount > 0
    ? formatMoney(summary.unpaidAmount)
    : (summary.nextBillingDue ? `Due ${formatDatePH(summary.nextBillingDue)}` : 'No outstanding balance');
  const billingCardLabel = summary.unpaidInvoices > 0
    ? `${summary.unpaidInvoices} open balance line${summary.unpaidInvoices > 1 ? 's' : ''}`
    : 'Billing & payments';

  // Honest fleet health from server
  const fleetData = summary.fleet || {};
  const fleetTotal          = fleetData.total          || devicesForFleet.length;
  const fleetPrintingOk     = fleetData.printingNormally ?? fleetTotal;
  const fleetAffected       = fleetData.affectedMachines ?? 0;
  const fleetUptimePct      = fleetData.uptimePct      ?? 100;
  const fleetActive         = devicesForFleet.filter(d => (d.fleetStatus || d.status) === 'Active').length;
  const fleetAttention      = fleetData.attentionCount  ?? devicesForFleet.filter(d => (d.fleetStatus || d.status) === 'Needs Attention').length;
  const fleetReplacement    = devicesForFleet.filter(d => d.status === 'For Replacement').length;
  const fleetInactive       = devicesForFleet.filter(d => d.status === 'Inactive').length;
  const fleetUptimeClass    = fleetUptimePct >= 95 ? 'uptime-green' : fleetUptimePct >= 80 ? 'uptime-amber' : 'uptime-red';
  const serviceOpen         = fleetData.serviceOpen  || 0;
  const serviceToday        = fleetData.serviceToday || 0;

  // openTickets = portal tickets + truly open field schedules (combined)
  const portalOpenTickets = tickets.filter((ticket) => {
    const s = String(ticket.status || '').toLowerCase();
    return !['completed', 'closed', 'done', 'cancelled', 'canceled'].includes(s);
  }).length;
  const openTickets = portalOpenTickets + serviceOpen;

  // 30-day stats from service history
  const now30 = Date.now() - 30 * 86400000;
  const svc30   = (serviceHistoryResult?.recentEvents || []).filter(e => e.type === 'service' && Date.parse(e.date) > now30).length;
  const toner30 = (serviceHistoryResult?.recentEvents || []).filter(e => e.type === 'toner'   && Date.parse(e.date) > now30).length;
  const fleet30Parts = [];
  if (svc30 > 0)   fleet30Parts.push(`${svc30} service visit${svc30 > 1 ? 's' : ''}`);
  if (toner30 > 0) fleet30Parts.push(`${toner30} cartridge deliver${toner30 > 1 ? 'ies' : 'y'}`);
  const fleet30Stats = fleet30Parts.join(' · ');

  // Recent activity feed from tbl_schedule — top 5 events
  const activityFeedHtml = recentEvents.length
    ? `<div class="dashboard-activity-feed">
        <div class="activity-feed-heading">Recent Activity</div>
        ${recentEvents.slice(0, 5).map(ev => `
          <div class="activity-feed-row">
            <span class="activity-feed-icon activity-feed-icon--${ev.type}">
              ${ev.type === 'service' ? '🔧' : '🖨️'}
            </span>
            <div class="activity-feed-body">
              <div class="activity-feed-label">${escapeHtml(ev.label)}</div>
              <div class="activity-feed-meta">${escapeHtml(ev.branchName || '')}${ev.date ? ` · ${daysAgo(ev.date) || formatDate(ev.date)}` : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>`
    : '';

  viewContainer.innerHTML = `
    ${renderInternalCustomerPicker()}

    <!-- COMBINED HERO + FLEET HEALTH — repair video background -->
    <section class="care-combined-hero">
      <video class="care-combined-video" autoplay muted loop playsinline poster="/public/assets/marga-bg-poster.jpg">
        <source src="/public/assets/fleet-repair-desktop.mp4?v=20260717c" media="(min-width: 640px)" type="video/mp4" />
        <source src="/public/assets/fleet-repair-mobile.mp4?v=20260717c" type="video/mp4" />
      </video>
      <div class="care-combined-veil"></div>
      <div class="care-combined-content">
        <div class="care-combined-top">
          <span class="care-eyebrow">MARGA Care</span>
          <h2>${escapeHtml(state.company?.name || 'Your account')} — Service tracked. Billing visible. Always reachable.</h2>
        </div>
        <div class="care-combined-fleet">
          <div class="fleet-pill">
            <span class="fleet-pill-num ${fleetUptimeClass}">${fleetUptimePct}%</span>
            <span class="fleet-pill-label">Fleet Uptime</span>
          </div>
          <div class="fleet-pill-div"></div>
          <div class="fleet-pill">
            <span class="fleet-pill-num fleet-green">${fleetPrintingOk} <span style="font-size:11px;font-weight:500">of ${fleetTotal}</span></span>
            <span class="fleet-pill-label">Printing Normally</span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel glass dashboard-summary-card care-metric-strip">
      <div class="kpi-grid kpi-grid--alive">
        <div class="kpi-card kpi-card--link" data-nav="tickets" role="button" tabindex="0">
          <div class="kpi-card-inner">
            <div class="value">${openTickets}</div>
            <div class="label">Open Service Requests</div>
          </div>
          <div class="kpi-arrow">→</div>
        </div>
        ${canViewBilling() ? `
        <div class="kpi-card kpi-card--billing kpi-card--link" data-nav="billing" role="button" tabindex="0">
          <div class="kpi-card-inner">
            <div class="kpi-eyebrow">${summary.unpaidAmount > 0 ? 'Open Balance' : 'Next Billing'}</div>
            <div class="value value--text">${billingCardText}</div>
            <div class="label">${billingCardLabel}</div>
          </div>
          <div class="kpi-arrow">→</div>
        </div>` : ''}
      </div>
    </section>

    <!-- SCROLLING ACTIVITY TICKER -->
    ${recentEvents.length ? `
    <div class="activity-ticker-wrap">
      <div class="activity-ticker-label">LIVE ACTIVITY</div>
      <div class="activity-ticker-track">
        <div class="activity-ticker-inner" id="activityTicker">
          ${[...recentEvents, ...recentEvents].map(ev => {
            const label = ev.type === 'service' ? '✅ Maintenance completed' : '✅ Cartridge delivered';
            const ago = daysAgo(ev.date) || 'recently';
            return `<span class="ticker-item">
              <span class="ticker-icon">${ev.type === 'service' ? '🔧' : '🖨️'}</span>
              <span class="ticker-text">${label} · ${escapeHtml(ev.branchName || '')} · <em>${ago}</em></span>
            </span>`;
          }).join('<span class="ticker-sep">·</span>')}
        </div>
      </div>
    </div>` : ''}
  `;

  // Fleet pill clicks
  viewContainer.querySelectorAll('.fleet-pill--link').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      state.deviceStatusFilter = el.getAttribute('data-filter') || '';
      setView('devices');
    });
  });

  // KPI card click navigation
  viewContainer.querySelectorAll('.kpi-card--link').forEach(card => {
    const nav = card.getAttribute('data-nav');
    if (!nav) return;
    card.addEventListener('click', () => setView(nav));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') setView(nav); });
  });

  // Fleet health count clicks → Machines tab with filter pre-set
  viewContainer.querySelectorAll('.fleet-count[data-nav]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const filter = el.getAttribute('data-filter') || '';
      state.deviceStatusFilter = filter;
      setView('devices');
    });
  });

  // Hero video — ensure it plays (mobile may need a tap)
  const heroBg = document.getElementById('careHeroBg');
  if (heroBg) {
    heroBg.play().catch(() => {
      // Mobile blocked autoplay — show poster, hide video
      heroBg.style.display = 'none';
    });
  }
  document.getElementById('careActionBilling')?.addEventListener('click', () => setView('billing'));
  document.getElementById('careActionSupport')?.addEventListener('click', () => setView('support'));
  bindInternalCustomerPicker();
}

// ── Quick Request — 2-tap flow ──────────────────────────────────────────
// State
const quickReq = { open: false, type: null, devices: [], branches: [] };

function renderQuickRequestFab() {
  const existing = document.getElementById('quickReqFab');
  if (existing) return; // already in DOM
  const fab = document.createElement('div');
  fab.id = 'quickReqFab';
  fab.innerHTML = `
    <button class="fab-btn" id="fabMainBtn" aria-label="Quick request">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </button>`;
  document.body.appendChild(fab);
  document.getElementById('fabMainBtn').addEventListener('click', () => openQuickRequest(null));
}

function openQuickRequest(type) {
  quickReq.type = type;
  quickReq.open = true;
  quickReq.devices = []; // refresh device list on each open
  renderQuickSheet();
}

function closeQuickRequest() {
  quickReq.open = false;
  quickReq.type = null;
  document.getElementById('quickReqSheet')?.remove();
  document.getElementById('quickReqOverlay')?.remove();
}

async function renderQuickSheet() {
  // Remove stale sheet
  document.getElementById('quickReqSheet')?.remove();
  document.getElementById('quickReqOverlay')?.remove();

  // Load devices once (cached in quickReq)
  if (!quickReq.devices.length) {
    try {
      quickReq.devices  = await service.listDevices(state.user);
      quickReq.branches = await service.listBranches(state.user);
    } catch (_) {}
  }

  const overlay = document.createElement('div');
  overlay.id = 'quickReqOverlay';
  overlay.addEventListener('click', closeQuickRequest);
  document.body.appendChild(overlay);

  const sheet = document.createElement('div');
  sheet.id = 'quickReqSheet';

  // Step 1 — choose type (if not pre-selected)
  if (!quickReq.type) {
    sheet.innerHTML = `
      <div class="qr-header">
        <span class="qr-title">What do you need?</span>
        <button class="qr-close" id="qrCloseBtn">✕</button>
      </div>
      <div class="qr-type-grid">
        <button class="qr-type-btn" data-type="service">
          <span class="qr-type-icon">🔧</span>
          <span class="qr-type-label">Machine Issue</span>
          <span class="qr-type-sub">Request a service visit</span>
        </button>
        <button class="qr-type-btn" data-type="toner">
          <span class="qr-type-icon">🖨️</span>
          <span class="qr-type-label">Need Toner / Ink</span>
          <span class="qr-type-sub">Request cartridge delivery</span>
        </button>
      </div>`;
    document.body.appendChild(sheet);
    document.getElementById('qrCloseBtn').addEventListener('click', closeQuickRequest);
    sheet.querySelectorAll('.qr-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        quickReq.type = btn.getAttribute('data-type');
        renderQuickSheet();
      });
    });
    return;
  }

  // Step 2 — submit form (auto-fills if single machine)
  const isSingle = quickReq.devices.length === 1;
  const singleDevice = isSingle ? quickReq.devices[0] : null;
  const deviceOptions = quickReq.devices.map(d =>
    `<option value="${d.id}">${escapeHtml(cleanBranchName(d.branchName || d.location || ''))} — ${escapeHtml(d.model)} (${escapeHtml(d.serial)})</option>`
  ).join('');

  const isService = quickReq.type === 'service';
  const typeLabel = isService ? 'Machine Issue' : 'Toner / Ink';
  const typeIcon  = isService ? '🔧' : '🖨️';

  sheet.innerHTML = `
    <div class="qr-header">
      <span class="qr-title">${typeIcon} ${typeLabel}</span>
      <button class="qr-close" id="qrCloseBtn">✕</button>
    </div>
    <form id="qrForm" class="qr-form">
      ${isSingle
        ? `<div class="qr-auto-branch">
             <span class="qr-auto-label">Machine</span>
             <span class="qr-auto-value">${escapeHtml(cleanBranchName(singleDevice.branchName || singleDevice.location || ''))} · ${escapeHtml(singleDevice.model)}</span>
             <input type="hidden" name="deviceId" value="${singleDevice.id}">
             <input type="hidden" name="branchId" value="${singleDevice.branchId}">
           </div>`
        : `<div class="qr-field">
             <label class="qr-label">Which machine?</label>
             <select name="deviceId" class="qr-select" required>
               <option value="">Select machine…</option>
               ${deviceOptions}
             </select>
           </div>`
      }
      <div class="qr-field">
        <label class="qr-label">Field Machine Status</label>
        <select name="fieldWorkMachineStatusId" class="qr-select" required>
          ${machineWorkStatusOptionsHtml()}
        </select>
      </div>
      ${isService
        ? `<div class="qr-field">
             <label class="qr-label">What's the issue? <span class="qr-optional">(optional)</span></label>
             <input name="description" class="qr-input" placeholder="e.g. Paper jam, print quality, blinking error…" autocomplete="off">
           </div>`
        : `<div class="qr-field">
             <label class="qr-label">Notes <span class="qr-optional">(optional)</span></label>
             <input name="notes" class="qr-input" placeholder="e.g. Black cartridge low, urgent…" autocomplete="off">
           </div>`
      }
      <button type="submit" class="btn btn-primary qr-submit" id="qrSubmitBtn">
        Send Request
      </button>
      <button type="button" class="qr-back" id="qrBackBtn">← Change type</button>
    </form>`;

  document.body.appendChild(sheet);
  document.getElementById('qrCloseBtn').addEventListener('click', closeQuickRequest);
  document.getElementById('qrBackBtn').addEventListener('click', () => {
    quickReq.type = null;
    renderQuickSheet();
  });

  // Auto-submit if single machine and no description needed (toner)
  document.getElementById('qrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const btn = document.getElementById('qrSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const deviceId = fd.get('deviceId') || (isSingle ? singleDevice.id : null);
      const device = quickReq.devices.find(d => String(d.id) === String(deviceId));
      const branchId = device?.branchId || fd.get('branchId') || state.user.branchId;
      const companyId = device?.companyId || activeCompanyId();
      const fieldWorkMachineStatusId = Number(fd.get('fieldWorkMachineStatusId') || 0);
      const fieldWorkMachineStatus = machineWorkStatusLabel(fieldWorkMachineStatusId);
      if (!fieldWorkMachineStatusId || !fieldWorkMachineStatus) {
        throw new Error('Please choose a Field Machine Status.');
      }

      if (isService) {
        await service.createTicket(state.user, {
          companyId, branchId, deviceId,
          category: 'Service',
          priority: 'Normal',
          description: fd.get('description') || 'Service request via portal',
          fieldWorkMachineStatusId,
          fieldWorkMachineStatus
        });
      } else {
        await service.createTicket(state.user, {
          companyId, branchId, deviceId,
          category: 'Toner / Ink',
          priority: 'Normal',
          description: fd.get('notes') || 'Toner request via portal',
          fieldWorkMachineStatusId,
          fieldWorkMachineStatus
        });
      }
      closeQuickRequest();
      showNotice(`${typeLabel} request submitted. Marga will follow up shortly.`, 'success');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Send Request';
      showNotice(err.message || 'Could not submit request.', 'error');
    }
  });
}

function daysAgoShort(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - Date.parse(dateStr);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

// ── Customer Rating Widget ──────────────────────────────
function showRatingWidget(ticketId, containerEl) {
  if (!containerEl) return;
  let selected = 0;
  const widget = document.createElement('div');
  widget.className = 'rating-widget';
  widget.innerHTML = `
    <div class="rating-widget-title">How was your service experience?</div>
    <div class="rating-widget-sub">Rate the technician or support staff who helped you.</div>
    <div class="rating-stars" id="ratingStars">
      ${[1,2,3,4,5].map(n => `<span class="rating-star" data-val="${n}">⭐</span>`).join('')}
    </div>
    <textarea class="rating-comment" placeholder="Optional comment…" id="ratingComment"></textarea>
    <button class="btn btn-primary rating-submit" id="ratingSubmit" disabled>Submit Rating</button>`;
  containerEl.appendChild(widget);

  widget.querySelectorAll('.rating-star').forEach(star => {
    star.addEventListener('click', () => {
      selected = Number(star.getAttribute('data-val'));
      widget.querySelectorAll('.rating-star').forEach(s => {
        s.classList.toggle('active', Number(s.getAttribute('data-val')) <= selected);
      });
      widget.querySelector('#ratingSubmit').disabled = false;
    });
  });

  widget.querySelector('#ratingSubmit').addEventListener('click', async () => {
    const comment = widget.querySelector('#ratingComment').value.trim();
    try {
      await service.rateTicket(state.user, ticketId, selected, comment);
      widget.innerHTML = '<div class="rating-thankyou">✅ Thank you for your feedback!</div>';
    } catch (e) {
      showNotice('Could not save rating. Please try again.', 'error');
    }
  });
}

// ── Staff blocking gate (check unclosed schedules) ──────
async function checkStaffGate(user) {
  if (!['marga_staff','marga_tech'].includes(user.role)) return;
  try {
    const data = await service.getOpenScheduleCount(user);
    const openCount = data?.openCount || 0;
    if (openCount === 0) return;

    const modal = document.createElement('div');
    modal.className = 'staff-gate-modal';
    modal.innerHTML = `
      <div class="staff-gate-card">
        <div class="staff-gate-icon">⚠️</div>
        <div class="staff-gate-title">You have ${openCount} unclosed schedule${openCount > 1 ? 's' : ''}</div>
        <div class="staff-gate-body">
          You must acknowledge your open schedules before using the app.
          Unclosed schedules affect your performance score and team reports.
        </div>
        <div class="staff-gate-acknowledge" id="gateAckRow">
          <input type="checkbox" id="gateCheck" />
          <label for="gateCheck">I acknowledge my open schedules and commit to closing them today.</label>
        </div>
        <button class="btn btn-primary staff-gate-proceed" id="gateProceed" disabled>Proceed to App</button>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#gateCheck').addEventListener('change', e => {
      modal.querySelector('#gateProceed').disabled = !e.target.checked;
    });
    modal.querySelector('#gateProceed').addEventListener('click', async () => {
      await service.acknowledgeSchedules(user, openCount).catch(() => {});
      modal.remove();
    });
  } catch (_) {}
}

function renderBackBar(title = '') {
  return `<div class="back-bar">
    <button class="back-btn" onclick="window._goHome()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      Home
    </button>
    ${title ? `<span class="back-bar-title">${escapeHtml(title)}</span>` : ''}
  </div>`;
}
window._goHome = () => setView('dashboard');

async function renderDevices() {
  const [devicesRaw, branches, serviceHistoryResult] = await Promise.all([
    service.listDevices(state.user),
    service.listBranches(state.user),
    service.getServiceHistory(state.user).catch(() => ({ byBranch: {} }))
  ]);
  const histByBranch = serviceHistoryResult?.byBranch || {};
  const branchMap = new Map(branches.map((branch) => [branch.id, cleanBranchName(branch.name)]));
  const devices = [...devicesRaw].sort((left, right) =>
    (left.location || left.branchName || '').localeCompare(right.location || right.branchName || '')
    || (left.serial || '').localeCompare(right.serial || '')
    || (left.model || '').localeCompare(right.model || '')
  );
  const searchNeedle = state.deviceSearchQuery.trim().toLowerCase();
  const statusNeedle = (state.deviceStatusFilter || '').trim().toLowerCase();
  const filteredDevices = devices.filter((device) => {
    const branchName = branchMap.get(device.branchId) || device.location || device.branchName || '';
    const matchSearch = !searchNeedle || [branchName, device.serial, device.model]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(searchNeedle));
    const matchStatus = !statusNeedle || String(device.fleetStatus || device.status || '').toLowerCase() === statusNeedle;
    return matchSearch && matchStatus;
  });

  if (state.selectedDeviceId && !devices.some((device) => String(device.id) === String(state.selectedDeviceId))) {
    state.selectedDeviceId = null;
    state.deviceDetailOpen = false;
    state.deviceDetail = null;
    state.deviceDetailLoading = false;
  }
  if (!state.selectedDeviceId && filteredDevices.length) state.selectedDeviceId = filteredDevices[0].id;
  const selectedDevice = devices.find((device) => String(device.id) === String(state.selectedDeviceId)) || filteredDevices[0] || null;
  const detail = state.deviceDetailOpen && selectedDevice && String(state.deviceDetail?.device?.id) === String(selectedDevice.id)
    ? state.deviceDetail
    : null;
  const showingAttention = statusNeedle === 'needs attention';
  const attentionRowsHtml = showingAttention && filteredDevices.length
    ? `<div class="care-attention-list">
        <div class="care-attention-head">
          <div>Account / Branch</div>
          <div>Why It Needs Attention</div>
          <div>Machine</div>
          <div></div>
        </div>
        <div class="care-attention-body">
          ${filteredDevices.map((device) => {
            const branchName = branchMap.get(device.branchId) || cleanBranchName(device.branchName) || device.branchId || '-';
            const reason = device.attentionReason || device.machineStatusLabel || 'Not marked as printing normally';
            return `<div class="care-attention-row${selectedDevice && device.id === selectedDevice.id ? ' is-selected' : ''}">
              <div>
                <strong>${escapeHtml(branchName)}</strong>
                <span>${escapeHtml(state.company?.name || 'MARGA Care account')}</span>
              </div>
              <div><span class="tag tag-attention">${escapeHtml(reason)}</span></div>
              <div>
                <strong>${escapeHtml(device.model || '-')}</strong>
                <span>${escapeHtml(device.serial || 'No serial')}</span>
              </div>
              <div><button class="btn btn-secondary btn-sm" data-device-id="${device.id}" ${state.deviceDetailLoading && String(selectedDevice?.id) === String(device.id) ? 'disabled' : ''}>${state.deviceDetailLoading && String(selectedDevice?.id) === String(device.id) ? 'Loading...' : 'Details'}</button></div>
            </div>`;
          }).join('')}
        </div>
      </div>`
    : '';

  viewContainer.innerHTML = `
    ${renderBackBar('Machines')}
    <div class="panel glass">
        <div class="care-device-title-block">
          <h3>${showingAttention ? 'Accounts Needing Attention' : 'Rented Devices'}</h3>
          <span class="muted">${filteredDevices.length} of ${devices.length}</span>
        </div>
        <div class="care-device-toolbar">
          <label class="care-device-search">
            <span class="sr-only">Search devices</span>
            <input
              id="deviceSearchInput"
              type="text"
              value="${escapeHtml(state.deviceSearchQuery)}"
              placeholder="Search branch or serial"
              autocomplete="off"
            />
          </label>
        </div>
      </div>
      <div class="device-filter-chips">
        ${[
          ['', 'All'],
          ['Active', 'Active'],
          ['Needs Attention', 'Needs Attention'],
          ['For Replacement', 'For Replacement'],
          ['Inactive', 'Inactive']
        ].map(([val, label]) => {
          const count = val ? devices.filter(d => (d.fleetStatus || d.status) === val).length : devices.length;
          const active = state.deviceStatusFilter === val;
          return `<button class="device-filter-chip ${active ? 'active' : ''} ${val ? 'chip-' + val.toLowerCase().replace(/\s+/g,'-') : ''}"
            data-status="${escapeHtml(val)}">${escapeHtml(label)} <span class="chip-count">${count}</span></button>`;
        }).join('')}
      </div>
      ${
        filteredDevices.length
          ? showingAttention
            ? attentionRowsHtml
            : `<div class="care-device-table-wrap" data-drag-scroll="devices" tabindex="0" role="region" aria-label="Rented devices table. Swipe or drag horizontally to view more columns.">
              <div class="care-device-grid care-device-grid--with-history">
                <div class="care-device-grid-head">
                  <div>Model</div>
                  <div>Serial</div>
                  <div>Branch</div>
                  <div>Status</div>
                  <div>Last Service</div>
                  <div>Last Toner</div>
                  <div></div>
                </div>
                <div class="care-device-grid-body">
                  ${filteredDevices
                    .map((device) => {
                      const legacyKey = String(device.branchLegacyId || '').trim();
                      const hist = histByBranch[legacyKey] || {};
                      const lastSvc = hist.lastService ? (daysAgoShort(hist.lastService.date) || formatDate(hist.lastService.date)) : '—';
                      const lastToner = hist.lastToner ? (daysAgoShort(hist.lastToner.date) || formatDate(hist.lastToner.date)) : '—';
                      const svcClass = hist.lastService ? 'device-hist--ok' : 'device-hist--none';
                      const tonerClass = hist.lastToner ? 'device-hist--ok' : 'device-hist--none';
                      return `<div class="care-device-grid-row${selectedDevice && device.id === selectedDevice.id ? ' is-selected' : ''}">
                        <div>${escapeHtml(device.model)}</div>
                        <div>${escapeHtml(device.serial)}</div>
                        <div>${escapeHtml(branchMap.get(device.branchId) || cleanBranchName(device.branchName) || device.branchId || '-')}</div>
                        <div><span class="tag ${statusClass(device.status)}">${escapeHtml(device.status || '')}</span></div>
                        <div class="device-hist ${svcClass}" title="${hist.lastService ? escapeHtml(hist.lastService.date) : 'No data'}">${lastSvc}</div>
                        <div class="device-hist ${tonerClass}" title="${hist.lastToner ? escapeHtml(hist.lastToner.date) : 'No data'}">${lastToner}</div>
                        <div><button class="btn btn-secondary btn-sm" data-device-id="${device.id}" ${state.deviceDetailLoading && String(selectedDevice?.id) === String(device.id) ? 'disabled' : ''}>${state.deviceDetailLoading && String(selectedDevice?.id) === String(device.id) ? 'Loading...' : 'Details'}</button></div>
                      </div>`;
                    })
                    .join('')}
                </div>
              </div>
            </div>`
            + `<div class="care-device-scroll-hint">Swipe or drag to see more columns</div>`
          : `<div class="empty-state">No ${showingAttention ? 'account needs attention' : 'device matched that branch or serial'}.</div>`
      }
    </div>

    ${state.deviceDetailOpen && selectedDevice ? `
      <div class="care-modal-backdrop" id="deviceDetailModal">
        <div class="care-modal glass care-device-modal">
          <div class="panel-head">
            <h3>Device Detail</h3>
            <button type="button" class="btn btn-secondary btn-sm" id="closeDeviceDetail">Close</button>
          </div>
          ${
            state.deviceDetailLoading
              ? `<div class="care-device-loading">
                   <div class="care-loading-spinner" aria-hidden="true"></div>
                   <p>Loading device history...</p>
                 </div>`
              : detail
              ? `<div class="care-device-detail-head">
                   <div>
                     <strong>${escapeHtml(detail.device?.serial && detail.device.serial !== 'N/A' ? detail.device.serial : (selectedDevice.serial !== 'N/A' ? selectedDevice.serial : 'Serial pending'))}</strong>
                     <p>${escapeHtml(detail.device?.model || selectedDevice.model || '-')} · ${escapeHtml(cleanBranchName(detail.device?.branchName || selectedDevice.location || ''))}</p>
                   </div>
                   <span class="tag ${statusClass(detail.device?.status || selectedDevice.status)}">${escapeHtml(detail.device?.status || selectedDevice.status || '')}</span>
                 </div>
                 ${detail.device?.notes ? `<div class="care-device-note"><span class="care-device-note-icon">ℹ</span> ${escapeHtml(detail.device.notes)}</div>` : ''}
                 ${(() => {
                   const b = detail.billing;
                   if (!b) return '';
                   if (b.unpaidCount === 0) return `<div class="care-billing-summary care-billing-ok"><span class="care-billing-icon">✓</span> Account is up to date — no outstanding balance.</div>`;
                   const rows = (b.unpaidInvoices || []).map(inv =>
                     `<div class="care-invoice-row">
                       <span class="care-invoice-period">${escapeHtml(inv.period || inv.invoiceNo || 'Invoice')}</span>
                       <span class="care-invoice-amount">₱${Number(inv.amount || 0).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                       ${inv.dueDate ? `<span class="care-invoice-due">Due ${escapeHtml(inv.dueDate)}</span>` : ''}
                     </div>`
                   ).join('');
                   return `<div class="care-billing-summary care-billing-unpaid">
                     <div class="care-billing-header">
                       <span class="care-billing-label">Outstanding Balance</span>
                       <span class="care-billing-total">₱${Number(b.unpaidAmount||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
                     </div>
                     <div class="care-invoice-list">${rows}</div>
                     ${b.unpaidCount > (b.unpaidInvoices||[]).length ? `<p class="care-billing-more">+ ${b.unpaidCount - (b.unpaidInvoices||[]).length} more invoice(s)</p>` : ''}
                   </div>`;
                 })()}
                 <div class="timeline care-device-timeline">
                   <p class="care-timeline-label">Service &amp; Delivery History</p>
                   ${
                     Array.isArray(detail.timeline) && detail.timeline.length
                       ? detail.timeline.map((item) => {
                           const icon = item.type === 'delivery' ? '📦'
                             : item.type === 'service' ? '🔧'
                             : item.type === 'visit' ? '📋' : '•';
                           return `<article class="timeline-item timeline-item-${escapeHtml(item.type || 'visit')}">
                             <div class="timeline-item-head">
                               <span class="timeline-icon" aria-hidden="true">${icon}</span>
                               <strong>${escapeHtml(item.label || '')}</strong>
                               <span class="tag tag-sm ${item.status === 'Completed' ? 'tag-success' : item.status === 'Cancelled' ? 'tag-muted' : 'tag-pending'}">${escapeHtml(item.status || '')}</span>
                             </div>
                             ${item.details ? `<p class="timeline-details">${escapeHtml(item.details)}</p>` : ''}
                             <p class="timeline-date">${formatDate(item.at)}</p>
                           </article>`;
                         }).join('')
                       : `<div class="empty-state">
                            <p>No service history recorded yet for this machine.</p>
                            <p style="margin-top:.5rem;font-size:.8rem;color:var(--text-muted)">History appears here after your first service or delivery visit.</p>
                          </div>`
                   }
                 </div>`
              : '<div class="empty-state">No machine history found yet.</div>'
          }
        </div>
      </div>
    ` : ''}
  `;

  document.getElementById('deviceSearchInput')?.addEventListener('input', async (event) => {
    state.deviceSearchQuery = event.target.value || '';
    await renderDevices();
  });

  viewContainer.querySelectorAll('.device-filter-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      state.deviceStatusFilter = chip.getAttribute('data-status') || '';
      state.deviceSearchQuery = '';
      await renderDevices();
    });
  });

  viewContainer.querySelectorAll('[data-device-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await openDeviceDetail(button.getAttribute('data-device-id'));
    });
  });

  bindDragScroll(document.querySelector('[data-drag-scroll="devices"]'));

  document.getElementById('closeDeviceDetail')?.addEventListener('click', async () => {
    state.deviceDetailOpen = false;
    state.deviceDetailLoading = false;
    await renderDevices();
  });

  document.getElementById('deviceDetailModal')?.addEventListener('click', async (event) => {
    if (event.target?.id !== 'deviceDetailModal') return;
    state.deviceDetailOpen = false;
    state.deviceDetailLoading = false;
    await renderDevices();
  });
}

async function openDeviceDetail(deviceId) {
  state.selectedDeviceId = deviceId;
  state.deviceDetailOpen = true;
  state.deviceDetailLoading = true;
  state.deviceDetail = null;
  state.deviceDetailRequestId += 1;
  const requestId = state.deviceDetailRequestId;
  await renderDevices();
  try {
    const detail = await service.getDeviceDetail(state.user, deviceId);
    if (requestId !== state.deviceDetailRequestId) return;
    state.deviceDetail = detail;
  } catch (error) {
    if (requestId !== state.deviceDetailRequestId) return;
    showNotice(error.message || 'Failed to load device detail.', 'error');
    state.deviceDetail = null;
  } finally {
    if (requestId !== state.deviceDetailRequestId) return;
    state.deviceDetailLoading = false;
    await renderDevices();
  }
}

const TICKET_STATUS_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
const INFO_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;
const CHAT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
const CALL_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.24 1.24 2 2 0 012.24 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>`;

const MACHINE_WORK_STATUS_OPTIONS = [
  [1, 'Running / Print OK'],
  [2, 'Running / Print Problem'],
  [3, 'Down / No Print'],
  [4, 'Running / Best Mode Only']
];

function machineWorkStatusOptionsHtml(selected = '') {
  const selectedNumber = Number(selected || 0);
  return `<option value="">Select field machine status...</option>` + MACHINE_WORK_STATUS_OPTIONS
    .map(([value, label]) => `<option value="${value}" ${selectedNumber === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function machineWorkStatusLabel(value) {
  const found = MACHINE_WORK_STATUS_OPTIONS.find(([id]) => Number(value) === id);
  return found ? found[1] : '';
}

// Display order for the My Tickets list (spec §7): active/in-motion states first,
// completed/cancelled last. Independent from the raw DB status column.
const TICKET_STATUS_ORDER = [
  'on_the_way', 'arrived', 'in_progress', 'waiting_customer', 'waiting_parts',
  'included_in_route', 'next_destination', 'assigned', 'queued', 'submitted', 'under_review',
  'for_follow_up', 'completed', 'cancelled'
];

function ticketSortWeight(ticket) {
  const idx = TICKET_STATUS_ORDER.indexOf(ticket.customerStatus?.routeStatus || 'submitted');
  return idx === -1 ? TICKET_STATUS_ORDER.length : idx;
}

// Pill color per route_status — teal is reserved for "technician engaged" states
// to match the live-tracking design language (spec §33).
function ticketStatusTagClass(routeStatus) {
  if (['on_the_way', 'arrived', 'in_progress', 'waiting_customer'].includes(routeStatus)) return 'tag-live';
  if (routeStatus === 'completed') return 'tag-ok';
  if (routeStatus === 'cancelled') return 'tag-attention';
  if (['waiting_parts', 'for_follow_up'].includes(routeStatus)) return 'tag-watch';
  return 'tag-accent';
}

function ticketCardHtml(ticket) {
  const cs = ticket.customerStatus || {};
  const tagClass = ticketStatusTagClass(cs.routeStatus);
  const requestedAt = ticket.createdAt || ticket.scheduledDate || ticket.updatedAt;
  const scheduledAt = ticket.scheduledDate || null;
  const requestedAge = daysAgoShort(requestedAt);
  const isLate = requestedAt && Date.parse(requestedAt) < Date.now() - 2 * 86400000;
  let note = '';
  if (cs.showLiveEta) {
    note = `<div class="ticket-card-note">Live ETA: <b>${cs.liveEtaMinutes != null ? `${cs.liveEtaMinutes} min` : 'Calculating\u2026'}</b></div>`;
  } else if (cs.showArrivalNotConfirmed) {
    note = `<div class="ticket-card-note">Arrival time not yet confirmed.${cs.routeStatus === 'included_in_route' ? ' Included in today\u2019s service route.' : ''}</div>`;
  } else if (cs.showBroadVisitPeriod && cs.broadVisitPeriod) {
    note = `<div class="ticket-card-note">Expected visit period: <b>${escapeHtml(cs.broadVisitPeriod)}</b></div>`;
  }

  return `<div class="ticket-card">
    <div class="ticket-card-head">
      <div>
        <p class="ticket-card-title">${escapeHtml(ticket.category || 'Service Request')}</p>
        <p class="ticket-card-sub">Ticket #${escapeHtml(ticket.ticketNo || ticket.id)}</p>
      </div>
      <span class="tag ${tagClass}">${escapeHtml(cs.label || ticket.status || '-')}</span>
    </div>
    <div class="ticket-card-meta">
      <span>Branch: <b>${escapeHtml(ticket.branchName || '-')}</b></span>
      ${ticket.trouble ? `<span>Trouble: <b>${escapeHtml(ticket.trouble)}</b></span>` : ''}
      ${ticket.fieldWorkMachineStatus ? `<span>Field Machine Status: <b>${escapeHtml(ticket.fieldWorkMachineStatus)}</b></span>` : ''}
      <span>Priority: <b>${escapeHtml(ticket.priority || '-')}</b></span>
      <span>Date Requested: <b>${formatDate(requestedAt)}</b></span>
      ${scheduledAt ? `<span>Scheduled: <b>${formatDate(scheduledAt)}</b></span>` : ''}
      ${requestedAge ? `<span class="${isLate ? 'ticket-age ticket-age--late' : 'ticket-age'}">Age: <b>${escapeHtml(requestedAge)}</b></span>` : ''}
    </div>
    ${note}
    <div class="ticket-card-actions">
      ${cs.showTracking ? `<button class="btn btn-primary btn-sm" data-ticket-id="${ticket.id}">Track Technician</button>` : ''}
      ${cs.ticketMessageAvailable ? `<button class="btn btn-secondary btn-sm" data-ticket-id="${ticket.id}">${escapeHtml(cs.ticketMessageLabel || 'Message Service Team')}</button>` : ''}
      <button class="btn btn-secondary btn-sm" data-ticket-id="${ticket.id}">View Details</button>
    </div>
  </div>`;
}

function renderMyTicketsTab(tickets) {
  let visible = tickets;
  if (state.ticketFilter !== 'all') {
    visible = tickets.filter((ticket) => (ticket.customerStatus?.routeStatus || '') === state.ticketFilter);
  }
  const totalCount = tickets.length;
  const visibleCount = visible.length;
  visible = [...visible].sort(
    (a, b) => ticketSortWeight(a) - ticketSortWeight(b) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );

  const filterOptions = [
    ['all', 'All'],
    ['on_the_way', 'On the Way'], ['arrived', 'Arrived'], ['in_progress', 'In Progress'],
    ['waiting_customer', 'Waiting for Customer'], ['waiting_parts', 'Waiting for Parts'],
    ['included_in_route', 'Scheduled for Today'], ['assigned', 'Assigned / Queued'],
    ['submitted', 'Submitted / Under Review'], ['for_follow_up', 'Follow-up'],
    ['completed', 'Completed'], ['cancelled', 'Cancelled']
  ];

  return `
    <div class="panel glass">
      <div class="panel-head stack-on-mobile">
        <h3>My Tickets <span class="ticket-total-count">${state.ticketFilter === 'all' ? totalCount : `${visibleCount} of ${totalCount}`}</span></h3>
        <div class="panel-actions">
          <select id="ticketStatusFilter" class="input">
            ${filterOptions.map(([value, label]) => `<option value="${value}" ${state.ticketFilter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${visible.length ? visible.map(ticketCardHtml).join('') : '<div class="empty-state">No tickets found for this filter.</div>'}
    </div>
  `;
}

function renderCreateTicketTab(devices, branches) {
  const deviceOptions = devices
    .map((device) => `<option value="${device.id}">${escapeHtml(device.model)} - ${escapeHtml(device.serial)}</option>`)
    .join('');
  const branchOptions = branches.map((branch) => `<option value="${branch.id}">${escapeHtml(cleanBranchName(branch.name))}</option>`).join('');

  return `
    <div class="panel glass">
      <div class="panel-head"><h3>Create Service Ticket</h3></div>
      <form id="createTicketForm" class="form-grid">
        ${
          ['marga_admin', 'marga_staff', 'corporate_admin', 'company_admin'].includes(state.user.role)
            ? `<label>Branch<select name="branchId" required>${branchOptions}</select></label>`
            : `<input type="hidden" name="branchId" value="${escapeHtml(state.user.branchId || '')}" />`
        }
        <label>Device<select name="deviceId" required>${deviceOptions}</select></label>
        <label>Category
          <select name="category" required>
            <option>Paper Jam</option>
            <option>Print Quality</option>
            <option>Connectivity</option>
            <option>Hardware Error</option>
            <option>Preventive Maintenance</option>
          </select>
        </label>
        <label>Priority
          <select name="priority" required>
            <option>Low</option>
            <option selected>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>
        </label>
        <label>Field Machine Status
          <select name="fieldWorkMachineStatusId" required>
            ${machineWorkStatusOptionsHtml()}
          </select>
        </label>
        <label class="full">Description<textarea name="description" rows="3" required placeholder="Describe the issue clearly..."></textarea></label>
        <label class="full">Attach Photo (optional)<input type="file" name="attachment" accept="image/*" /></label>
        <button type="submit" class="btn btn-primary full">Submit Ticket</button>
      </form>
    </div>
  `;
}

// ── Ticket Details overlay (spec §9): status hero + step tracker + assigned staff
// + ticket-linked messaging + timeline. Appended to <body> (not viewContainer) so it
// survives sibling re-renders and never gets clipped by the module grid.
function renderStatusHero(cs) {
  const heroClass = cs.routeStatus === 'on_the_way' ? 'status-hero live' : 'status-hero';
  let box = '';
  if (cs.showLiveEta) {
    box = `<div class="status-hero-box live">
      <p class="status-hero-box-label">Live ETA</p>
      <p class="status-hero-box-value live">${cs.liveEtaMinutes != null ? `${cs.liveEtaMinutes} min` : 'Calculating\u2026'}</p>
      <p class="status-hero-box-note">You are the technician\u2019s next stop.</p>
    </div>`;
  } else if (cs.showArrivalNotConfirmed) {
    box = `<div class="status-hero-box">
      <p class="status-hero-box-label">Arrival Time</p>
      <p class="status-hero-box-value">Not Yet Confirmed</p>
      <p class="status-hero-box-note">We\u2019ll notify you when your assigned field staff is approaching.</p>
    </div>`;
  } else if (cs.showBroadVisitPeriod && cs.broadVisitPeriod) {
    box = `<div class="status-hero-box">
      <p class="status-hero-box-label">Expected Visit Period</p>
      <p class="status-hero-box-value">${escapeHtml(cs.broadVisitPeriod)}</p>
      <p class="status-hero-box-note">This is an estimate, not a guarantee.</p>
    </div>`;
  }
  return `<div class="${heroClass}">
    <div class="status-hero-icon-row">
      <div class="status-hero-icon">${TICKET_STATUS_ICON}</div>
      <div>
        <p class="status-hero-title">${escapeHtml(cs.label || 'Request Received')}</p>
        <span class="tag ${ticketStatusTagClass(cs.routeStatus)}">${escapeHtml((cs.routeStatus || '').replace(/_/g, ' '))}</span>
      </div>
    </div>
    ${box}
    <p class="status-hero-info">${INFO_ICON} <span>${escapeHtml(cs.message || '')}</span></p>
  </div>`;
}

function renderStepTracker(steps) {
  const currentIdx = steps.length - 1;
  return `<div class="step-tracker">${steps
    .map((label, i) => {
      const cls = i < currentIdx ? 'done' : i === currentIdx ? 'current' : '';
      const dot = i < currentIdx ? '\u2713' : String(i + 1);
      return `${i > 0 ? `<div class="step-line ${i <= currentIdx ? 'done' : ''}"></div>` : ''}<div class="step ${cls}">
          <div class="step-dot">${dot}</div>
          <div class="step-label">${escapeHtml(label)}</div>
        </div>`;
    })
    .join('')}</div>`;
}

function renderTechCard(cs, isLive) {
  const initials = (cs.assignedStaffName || '').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  return `<div class="tech-card">
    <div class="avatar">${initials}</div>
    <div class="tech-card-body">
      <p class="tech-card-name">${escapeHtml(cs.assignedStaffName)}</p>
      <p class="tech-card-role">${isLive ? 'Assigned Field Staff' : 'Assigned to your request'}</p>
    </div>
  </div>`;
}

function renderTicketDetailContent(ticket) {
  const cs = ticket.customerStatus || {};
  const isLive = ['on_the_way', 'arrived', 'in_progress', 'waiting_customer'].includes(cs.routeStatus);
  const steps = cs.progressSteps && cs.progressSteps.length ? cs.progressSteps : ['Received'];
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const events = Array.isArray(ticket.events) ? ticket.events : [];

  return `
    <div class="panel-head">
      <h3>${escapeHtml(ticket.category || 'Service Request')}</h3>
      <button class="btn btn-ghost-dark" id="closeTicketDetail" style="width:auto">Close</button>
    </div>
    <div class="ticket-detail-columns">
      <div>
        ${renderStatusHero(cs)}
        ${renderStepTracker(steps)}
        ${cs.showAssignedStaffProfile && cs.assignedStaffName ? renderTechCard(cs, isLive) : ''}
        <div class="ticket-card-actions" style="margin-top:10px">
          <a class="btn btn-secondary btn-sm" href="tel:+63281234567">${CALL_ICON} Call Marga Care</a>
          <a class="btn btn-secondary btn-sm" href="mailto:support@marga.biz">${CHAT_ICON} Chat with Marga Care</a>
        </div>
      </div>
      <div>
        <div class="panel glass" style="margin-bottom:14px">
          <div class="panel-head"><h3>Request Details</h3></div>
          <div class="ticket-card-meta" style="flex-direction:column;align-items:flex-start;gap:6px">
            <span>Ticket No: <b>${escapeHtml(ticket.ticketNo || ticket.id)}</b></span>
            <span>Branch: <b>${escapeHtml(ticket.branchName || '-')}</b></span>
            <span>Priority: <b>${escapeHtml(ticket.priority || '-')}</b></span>
            <span>Submitted: <b>${formatDate(ticket.createdAt)}</b></span>
          </div>
          <p style="font-size:12px;color:var(--ink-2);margin-top:10px">${escapeHtml(ticket.description || '')}</p>
        </div>

        ${
          cs.ticketMessageAvailable
            ? `<div class="panel glass">
                <div class="panel-head"><h3>${escapeHtml(cs.ticketMessageLabel || 'Message Service Team')}</h3></div>
                <div class="message-thread">
                  ${
                    messages.length
                      ? messages
                          .map(
                            (m) => `<div class="message-bubble ${m.senderType === 'customer' ? 'mine' : ''}">
                              <p class="msg-sender">${escapeHtml(m.senderName || (m.senderType === 'customer' ? 'You' : 'Marga Service Team'))}</p>
                              <p class="msg-body">${escapeHtml(m.body || '')}</p>
                              <p class="msg-time">${formatDate(m.createdAt)}</p>
                            </div>`
                          )
                          .join('')
                      : '<div class="empty-state">Messages are attached to this service request. The assigned team will respond when available.</div>'
                  }
                </div>
                <form id="ticketMessageForm" class="message-composer">
                  <textarea name="body" placeholder="Type a message..." required></textarea>
                  <button type="submit" class="btn btn-primary btn-sm">Send</button>
                </form>
                ${cs.callTechnicianEnabled ? `<button type="button" class="btn btn-secondary btn-sm" data-tech-call style="margin-top:8px;width:100%">${CALL_ICON} Call Assigned Technician</button>` : ''}
              </div>`
            : '<div class="panel glass"><div class="empty-state">Messaging opens once your request is assigned.</div></div>'
        }

        <div class="panel glass" style="margin-top:14px">
          <div class="panel-head"><h3>Timeline</h3></div>
          ${
            events.length
              ? `<div class="timeline">${events
                  .map(
                    (e) => `<article class="timeline-item">
                      <strong>${escapeHtml((e.status || '').replace(/_/g, ' '))}</strong>
                      <p>${escapeHtml(e.customerVisibleNote || '')}</p>
                      <p>${formatDate(e.createdAt)}</p>
                    </article>`
                  )
                  .join('')}</div>`
              : '<div class="empty-state">No timeline events yet.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function closeTicketDetailOverlay() {
  document.getElementById('ticketDetailOverlay')?.remove();
  state.ticketDetailOpen = false;
  state.ticketDetail = null;
}

function renderTicketDetailOverlay() {
  document.getElementById('ticketDetailOverlay')?.remove();
  if (!state.ticketDetailOpen) return;

  const overlay = document.createElement('div');
  overlay.id = 'ticketDetailOverlay';
  overlay.className = 'ticket-detail-overlay';
  overlay.innerHTML = `<div class="ticket-detail-panel">${
    state.ticketDetailLoading || !state.ticketDetail
      ? '<div class="empty-state">Loading ticket details\u2026</div>'
      : renderTicketDetailContent(state.ticketDetail)
  }</div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeTicketDetailOverlay();
      renderTickets();
    }
  });
  document.getElementById('closeTicketDetail')?.addEventListener('click', () => {
    closeTicketDetailOverlay();
    renderTickets();
  });
  document.querySelectorAll('#ticketDetailOverlay [data-tech-call]').forEach((btn) => {
    btn.addEventListener('click', () => {
      showNotice('In-app technician calling is coming soon. Use Chat Assigned Technician for now.', 'info');
    });
  });

  const messageForm = document.getElementById('ticketMessageForm');
  messageForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.ticketMessageSending) return;
    const textarea = messageForm.querySelector('textarea[name="body"]');
    const body = (textarea?.value || '').trim();
    if (!body) return;
    state.ticketMessageSending = true;
    try {
      await service.sendTicketMessage(state.user, state.ticketDetail.id, body);
      state.ticketDetail = await service.getTicketDetail(state.user, state.ticketDetail.id);
      renderTicketDetailOverlay();
    } catch (error) {
      showNotice(error.message || 'Failed to send message.', 'error');
    } finally {
      state.ticketMessageSending = false;
    }
  });
}

async function openTicketDetail(ticketId) {
  state.selectedTicketId = ticketId;
  state.ticketDetailOpen = true;
  state.ticketDetailLoading = true;
  state.ticketDetail = null;
  state.ticketDetailRequestId += 1;
  const requestId = state.ticketDetailRequestId;
  renderTicketDetailOverlay();
  try {
    const detail = await service.getTicketDetail(state.user, ticketId);
    if (requestId !== state.ticketDetailRequestId) return;
    state.ticketDetail = detail;
  } catch (error) {
    if (requestId !== state.ticketDetailRequestId) return;
    showNotice(error.message || 'Failed to load ticket detail.', 'error');
  } finally {
    if (requestId !== state.ticketDetailRequestId) return;
    state.ticketDetailLoading = false;
    renderTicketDetailOverlay();
  }
}

async function renderTickets() {
  const [devices, branches, tickets] = await Promise.all([
    service.listDevices(state.user),
    service.listBranches(state.user),
    service.listTickets(state.user)
  ]);

  viewContainer.innerHTML = `
    ${renderBackBar('Service Requests')}
    <div class="ticket-tabs">
      <button class="ticket-tab ${state.ticketTab === 'my-tickets' ? 'active' : ''}" data-ticket-tab="my-tickets" type="button">My Tickets</button>
      <button class="ticket-tab ${state.ticketTab === 'create' ? 'active' : ''}" data-ticket-tab="create" type="button">Create Ticket</button>
    </div>
    ${state.ticketTab === 'create' ? renderCreateTicketTab(devices, branches) : renderMyTicketsTab(tickets)}
  `;

  viewContainer.querySelectorAll('[data-ticket-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.ticketTab = btn.getAttribute('data-ticket-tab');
      await renderTickets();
    });
  });

  document.getElementById('ticketStatusFilter')?.addEventListener('change', async (event) => {
    state.ticketFilter = event.target.value;
    await renderTickets();
  });

  document.getElementById('createTicketForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const branchId = ['marga_admin', 'marga_staff', 'corporate_admin', 'company_admin'].includes(state.user.role) ? formData.get('branchId') : state.user.branchId;
    const selectedBranch = branches.find((branch) => String(branch.id) === String(branchId));
    const payload = {
      companyId: selectedBranch?.companyId || activeCompanyId(),
      branchId,
      deviceId: formData.get('deviceId'),
      category: formData.get('category'),
      priority: formData.get('priority'),
      description: formData.get('description'),
      fieldWorkMachineStatusId: formData.get('fieldWorkMachineStatusId'),
      fieldWorkMachineStatus: machineWorkStatusLabel(formData.get('fieldWorkMachineStatusId'))
    };
    if (!payload.fieldWorkMachineStatusId || !payload.fieldWorkMachineStatus) {
      showNotice('Please choose a Field Machine Status.', 'error');
      return;
    }

    const attachment = formData.get('attachment');
    const hasFile = attachment && attachment.size > 0;

    try {
      const ticket = await service.createTicket(state.user, payload, hasFile ? attachment : null);
      showNotice('Ticket submitted successfully.', 'success');
      form.reset();
      state.ticketTab = 'my-tickets';
      state.highlightTicketId = ticket?.id || null;
      await renderTickets();
    } catch (error) {
      showNotice(error.message || 'Unable to create ticket.', 'error');
    }
  });

  // Just-created ticket: land on My Tickets and open its detail (spec §8).
  if (state.highlightTicketId) {
    const idToOpen = state.highlightTicketId;
    state.highlightTicketId = null;
    await openTicketDetail(idToOpen);
  }
}


async function renderToner() {
  const [devices, requests, branches] = await Promise.all([
    service.listDevices(state.user),
    service.listTonerRequests(state.user),
    service.listBranches(state.user)
  ]);

  const deviceOptions = devices
    .map((device) => `<option value="${device.id}">${escapeHtml(device.model)} - ${escapeHtml(device.serial)}</option>`)
    .join('');
  const branchOptions = branches.map((branch) => `<option value="${branch.id}">${escapeHtml(cleanBranchName(branch.name))}</option>`).join('');
  const tonerPhotoLabel = `<label class="full">Attach Photo <small>(optional — ink level or empty cartridge)</small><input type="file" name="attachment" accept="image/*" /></label>`;

  viewContainer.innerHTML = `
    ${renderBackBar('Toner / Ink')}
    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Request Toner / Ink</h3></div>
        <form id="createTonerForm" class="form-grid">
          ${
            ['marga_admin', 'marga_staff', 'corporate_admin', 'company_admin'].includes(state.user.role)
              ? `<label>Branch<select name="branchId" required>${branchOptions}</select></label>`
              : `<input type="hidden" name="branchId" value="${escapeHtml(state.user.branchId || '')}" />`
          }
          <label>Device<select name="deviceId" required>${deviceOptions}</select></label>
          <label class="full">Notes<textarea name="notes" rows="3" placeholder="Add toner color or urgency details"></textarea></label>
          ${tonerPhotoLabel}
          <button type="submit" class="btn btn-primary full">Submit Toner Request</button>
        </form>
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>Request Status</h3></div>
        ${
          requests.length
            ? `<div class="timeline">${requests
                .slice(0, 8)
                .map(
                  (request) => `<article class="timeline-item">
                    <strong>${escapeHtml(request.id)}</strong>
                    <div class="tag ${statusClass(request.status)}">${escapeHtml(request.status)}</div>
                    <p>${escapeHtml(request.notes || 'No notes')}</p>
                    <p>${formatDate(request.updatedAt || request.createdAt)}</p>
                  </article>`
                )
                .join('')}</div>`
            : '<div class="empty-state">No toner requests yet.</div>'
        }
      </div>
    </div>
  `;

  document.getElementById('createTonerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const branchId = ['marga_admin', 'marga_staff', 'corporate_admin', 'company_admin'].includes(state.user.role) ? formData.get('branchId') : state.user.branchId;
    const selectedBranch = branches.find((branch) => String(branch.id) === String(branchId));

    const payload = {
      companyId: selectedBranch?.companyId || activeCompanyId(),
      branchId,
      deviceId: formData.get('deviceId'),
      notes: formData.get('notes')
    };

    const tonerPhoto = formData.get('attachment');
    const hasTonerPhoto = tonerPhoto && tonerPhoto.size > 0;
    try {
      await service.createTonerRequest(state.user, payload, hasTonerPhoto ? tonerPhoto : null);
      showNotice('Toner request submitted.', 'success');
      event.currentTarget.reset();
      await renderToner();
    } catch (error) {
      showNotice(error.message || 'Failed to submit toner request.', 'error');
    }
  });
}

async function renderBilling() {
  if (!canViewBilling()) {
    viewContainer.innerHTML = '<div class="panel glass"><div class="empty-state">Billing access is not available for this role.</div></div>';
    return;
  }

  const invoices = await service.listInvoices(state.user);
  const unpaid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
  const totalUnpaid = unpaid.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

  // ── Group invoices by invoice_no ────────────────────────────────────────
  // When multiple rows share the same invoice_no, they're branches of one grouped invoice.
  // When each row has a unique invoice_no (or no invoice_no), treat as individual.
  const groupMap = new Map();
  invoices.forEach((inv) => {
    const key = inv.invoiceNo || inv.id;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        invoiceNo: inv.invoiceNo,
        period: inv.period,
        dueDate: inv.dueDate,
        status: inv.status,
        total: 0,
        branches: [],
        isGrouped: false
      });
    }
    const g = groupMap.get(key);
    g.total += Number(inv.amount || 0);
    if (inv.branchName || inv.branchId) {
      g.branches.push({
        name: cleanBranchName(inv.branchName || String(inv.branchId)),
        amount: Number(inv.amount || 0),
        status: inv.status
      });
      if (g.branches.length > 1) g.isGrouped = true;
    }
    // Normalize status: if any branch is Unpaid, whole group is Unpaid
    if (!g.status || g.status === '0' || g.status === 'Unpaid') g.status = 'Unpaid';
  });

  const invoiceGroups = [...groupMap.values()].sort((a, b) =>
    (new Date(b.dueDate || 0).getTime()) - (new Date(a.dueDate || 0).getTime())
  );

  const state_expanded = state.expandedInvoiceGroups || new Set();
  state.expandedInvoiceGroups = state_expanded;

  function renderInvoiceRows() {
    return invoiceGroups.map((group, idx) => {
      const displayStatus = group.status && group.status !== '0' ? group.status : 'Unpaid';
      const groupKey = group.key || String(idx);
      const isExpanded = state_expanded.has(groupKey);
      const branchRows = isExpanded
        ? group.branches.map(b => `
            <tr class="invoice-branch-row">
              <td></td>
              <td class="invoice-branch-name">${escapeHtml(b.name)}</td>
              <td></td>
              <td>${formatMoney(b.amount)}</td>
              <td><span class="tag ${statusClass(displayStatus)}">${escapeHtml(displayStatus)}</span></td>
              <td></td>
            </tr>`).join('')
        : '';
      return `
        <tr class="invoice-group-row${group.isGrouped ? ' invoice-grouped' : ''}" data-invoice-key="${escapeHtml(groupKey)}">
          <td><strong>${escapeHtml(group.invoiceNo || '-')}</strong></td>
          <td>${group.branches.length} ${group.branches.length === 1 ? 'branch / department' : 'branches / departments'}</td>
          <td>${escapeHtml(formatDatePH(group.dueDate))}</td>
          <td>${formatMoney(group.total)}</td>
          <td><span class="tag ${statusClass(displayStatus)}">${escapeHtml(displayStatus)}</span></td>
          <td><button class="btn btn-secondary btn-sm invoice-expand-btn" data-invoice-key="${escapeHtml(groupKey)}">
            ${isExpanded ? 'Hide Details' : 'View Details'}
          </button></td>
        </tr>
        ${branchRows}`;
    }).join('');
  }

  viewContainer.innerHTML = `
    ${renderBackBar('Billing & Payments')}
    <div class="panel glass">
      <div class="panel-head"><h3>Billing Summary</h3>${activityChip('Visible proof', 'ok')}</div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="value">${invoiceGroups.length}</div><div class="label">Open Invoices</div></div>
        <div class="kpi-card"><div class="value">${unpaid.length}</div><div class="label">Branch / Department Lines</div></div>
        <div class="kpi-card"><div class="value">${formatMoney(totalUnpaid)}</div><div class="label">Open Balance</div></div>
      </div>
    </div>

    <div class="panel glass">
      <div class="panel-head"><h3>Open Invoices</h3><span class="muted">Click View Details to see branch / department lines</span></div>
      ${
        invoiceGroups.length
          ? `<div class="table-wrap"><table class="data-table" id="billingTable"><thead><tr>
              <th>Invoice No</th><th>Branches / Departments</th><th>Invoice Date</th><th>Open Amount</th><th>Status</th><th>Details</th>
            </tr></thead><tbody id="billingTableBody">
            ${renderInvoiceRows()}
            </tbody></table></div>`
          : '<div class="empty-state">No invoices found.</div>'
      }
    </div>
  `;

  // Wire expand/collapse
  document.getElementById('billingTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.invoice-expand-btn');
    if (!btn) return;
    const key = btn.getAttribute('data-invoice-key');
    if (state_expanded.has(key)) state_expanded.delete(key);
    else state_expanded.add(key);
    document.getElementById('billingTableBody').innerHTML = renderInvoiceRows();
  });
}

async function renderHistory() {
  const [tickets, requests, invoices, payments] = await Promise.all([
    service.listTickets(state.user),
    service.listTonerRequests(state.user),
    canViewBilling() ? service.listInvoices(state.user) : Promise.resolve([]),
    canViewBilling() ? service.listPayments(state.user) : Promise.resolve([])
  ]);

  const items = buildActivityFeed({ tickets, requests, invoices, payments });
  const proofCount = items.filter((item) => ['Payment Proof', 'Service Proof'].includes(item.type)).length;

  viewContainer.innerHTML = `
    ${renderBackBar('Proof & History')}
    <div class="panel glass">
      <div class="panel-head">
        <h3>Proof & History</h3>
        <span class="muted">${items.length} visible update${items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="value">${tickets.length}</div><div class="label">Service Records</div></div>
        <div class="kpi-card"><div class="value">${requests.length}</div><div class="label">Supply Requests</div></div>
        <div class="kpi-card"><div class="value">${proofCount}</div><div class="label">Proof Events</div></div>
        <div class="kpi-card"><div class="value">${payments.length}</div><div class="label">Posted Payments</div></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Activity Timeline</h3>${activityChip('Customer-facing history')}</div>
        ${
          items.length
            ? `<div class="timeline care-activity-feed">${items
                .map(
                  (item) => `<article class="timeline-item care-activity-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${activityChip(item.type, item.tone)}
                    <p>${escapeHtml(item.summary)}</p>
                    <p>${escapeHtml(item.detail)}${item.at ? ` · ${shortDate(item.at)}` : ''}</p>
                  </article>`
                )
                .join('')}</div>`
            : '<div class="empty-state">No history is visible yet.</div>'
        }
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>What This Proves</h3>${activityChip('Trust layer', 'ok')}</div>
        <div class="care-promise-list">
          <div class="summary-line"><span>Request trail</span><strong>${tickets.length + requests.length} visible records</strong></div>
          <div class="summary-line"><span>Service proof</span><strong>${items.filter((item) => item.type === 'Service Proof').length} completion event${items.filter((item) => item.type === 'Service Proof').length === 1 ? '' : 's'}</strong></div>
          <div class="summary-line"><span>Payment proof</span><strong>${payments.length} posted payment${payments.length === 1 ? '' : 's'}</strong></div>
          <div class="summary-line"><span>Billing visibility</span><strong>${invoices.length} invoice${invoices.length === 1 ? '' : 's'} available</strong></div>
        </div>
        <div class="care-history-note">
          Use this page whenever you need to verify what was requested, what was completed, and what Marga has already recorded.
        </div>
      </div>
    </div>
  `;
}

const aiChatState = { messages: [], loading: false };

async function sendAiChatMessage(userText) {
  if (!userText.trim() || aiChatState.loading) return;
  aiChatState.loading = true;
  aiChatState.messages.push({ role: 'user', content: userText.trim() });
  renderAiChat();

  const companyName = state.company?.name || 'your company';
  const systemPrompt = `You are Marga Care Assistant, the 24/7 AI support agent for Marga Enterprises, the leading copier and printer rental company in the Philippines.
You are speaking with a customer from ${companyName}.
Your job is to help customers with: checking service request status, requesting toner or ink delivery, understanding their billing and balance, reporting machine problems, and escalating to a human agent when needed.
Be friendly, helpful, and concise. Answer in plain English. If the customer writes in Filipino or Taglish, respond in the same language.
If you cannot answer a specific question (e.g. exact ticket status, payment records), tell them to use the portal sections or say you will escalate to the team.
Never make up specific numbers, dates, or invoice details you do not know.
To escalate to a human agent, say: "I'll connect you with our team now — please call +63-2-8123-4567 or email solutions@marga.biz."`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: aiChatState.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    const data = await resp.json();
    const reply = data?.content?.[0]?.text || 'Sorry, I could not get a response. Please try again or call our service desk.';
    aiChatState.messages.push({ role: 'assistant', content: reply });
  } catch {
    aiChatState.messages.push({ role: 'assistant', content: 'Connection issue. Please try again or call +63-2-8123-4567.' });
  }
  aiChatState.loading = false;
  renderAiChat();
}

function renderAiChat() {
  const chatBox = document.getElementById('aiChatMessages');
  const input = document.getElementById('aiChatInput');
  const btn = document.getElementById('aiChatSend');
  if (!chatBox) return;
  chatBox.innerHTML = aiChatState.messages.length
    ? aiChatState.messages.map((m) => `
        <div class="ai-chat-msg ai-chat-msg--${m.role}">
          <span class="ai-chat-sender">${m.role === 'user' ? 'You' : 'Marga AI'}</span>
          <p>${escapeHtml(m.content)}</p>
        </div>`).join('')
    + (aiChatState.loading ? '<div class="ai-chat-msg ai-chat-msg--assistant"><p class="ai-chat-typing">Typing…</p></div>' : '')
    : '<div class="ai-chat-empty">Ask anything about your machines, service, toner, or billing.</div>';
  chatBox.scrollTop = chatBox.scrollHeight;
  if (btn) btn.disabled = aiChatState.loading;
  if (input) input.disabled = aiChatState.loading;
}

function renderSupport() {
  const support = state.company?.support || config.support || {};
  const escalation = state.company?.escalationContacts || [
    { title: 'Service Desk', value: support.callNumber || '+63-2-8123-4567' },
    { title: 'Billing Team', value: 'billing@marga.biz' },
    { title: 'Account Manager', value: 'accounts@marga.biz' }
  ];

  viewContainer.innerHTML = `
    <div class="panel glass">
      <div class="panel-head">
        <h3>Marga AI Assistant</h3>
        <span class="tag done">Online 24/7</span>
      </div>
      <div id="aiChatMessages" class="ai-chat-box"></div>
      <div class="ai-chat-input-row">
        <input id="aiChatInput" type="text" class="input" placeholder="Ask about your machines, service, or billing…" autocomplete="off" />
        <button id="aiChatSend" class="btn btn-primary">Send</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Contact Marga</h3>${activityChip('Fast handoff')}</div>
        <div class="inline-actions">
          <a class="btn btn-primary" href="tel:${escapeHtml(support.callNumber || '+6328123456')}">Call Support</a>
          <a class="btn btn-secondary" href="mailto:${escapeHtml(support.email || 'solutions@marga.biz')}">Email</a>
          <a class="btn btn-secondary" href="${escapeHtml(support.whatsappUrl || '#')}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn btn-secondary" href="${escapeHtml(support.viberUrl || '#')}" target="_blank" rel="noopener">Viber</a>
        </div>
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>Escalation Contacts</h3><span class="muted">When you need a clearer follow-up path</span></div>
        <div class="timeline">
          ${escalation
            .map(
              (entry) =>
                `<article class="timeline-item"><strong>${escapeHtml(entry.title || 'Contact')}</strong><p>${escapeHtml(
                  entry.value || '-'
                )}</p></article>`
            )
            .join('')}
        </div>
      </div>
    </div>
  `;

  renderAiChat();

  document.getElementById('aiChatSend')?.addEventListener('click', () => {
    const input = document.getElementById('aiChatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendAiChatMessage(text);
  });

  document.getElementById('aiChatInput')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = event.target.value.trim();
    if (!text) return;
    event.target.value = '';
    sendAiChatMessage(text);
  });
}

// ── Credentials & Access Tab ─────────────────────────────────────────────

async function fetchCredentials() {
  const qs = new URLSearchParams({
    q: state.credSearch || '',
    role: state.credRoleFilter || '',
    status: state.credStatusFilter || '',
    active: state.credActiveFilter ?? 'true',
    page: String(state.credPage || 1)
  });
  const token = loadAuthToken();
  const r = await fetch(`/portal-api/admin/credentials?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'same-origin'
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => r.statusText);
    throw new Error(`Server returned ${r.status}: ${errText.slice(0, 120)}`);
  }
  const d = await r.json();
  state.credAccounts = d.accounts || [];
  state.credTotal = d.total || 0;
  state.credPages = d.pages || 1;
}

async function renderCredentialsTab() {
  const tabBody = document.getElementById('adminTabBody');
  if (!tabBody) return;

  // Show loading with timeout guard — never hang silently
  tabBody.innerHTML = `
    <div class="cred-loading">
      <div class="cred-loading-spinner"></div>
      <p>Loading credentials…</p>
    </div>`;

  const timeout = setTimeout(() => {
    const loadEl = tabBody.querySelector('.cred-loading');
    if (loadEl) loadEl.innerHTML = '<p style="color:#ef4444">⚠️ Taking too long. Check server connection or try again.</p><button class="btn btn-secondary" onclick="location.reload()">Reload</button>';
  }, 8000);

  try {
    await fetchCredentials();
    clearTimeout(timeout);
    tabBody.innerHTML = buildCredentialsHTML();
    bindCredentialsTab();
  } catch (err) {
    clearTimeout(timeout);
    tabBody.innerHTML = `<div class="panel glass"><div class="empty-state" style="color:#ef4444">⚠️ Failed to load credentials: ${escapeHtml(err.message || 'Unknown error')}.<br><br><button class="btn btn-secondary" id="credRetry">Retry</button></div></div>`;
    tabBody.querySelector('#credRetry')?.addEventListener('click', renderCredentialsTab);
  }
}

function buildCredentialsHTML() {
  const statusIcon = (acct) => {
    if (!acct.active) return '<span class="cred-status cred-status--off">● Inactive</span>';
    if (acct.role === 'branch_user') {
      // Branch users: "Registered" = self-registered with own email/password; "Pending" = not yet claimed
      if (acct.contactEmail) return '<span class="cred-status cred-status--ok">● Registered</span>';
      return '<span class="cred-status cred-status--new">● Pending</span>';
    }
    if (acct.mustChangePassword) return '<span class="cred-status cred-status--new">● New PIN</span>';
    return '<span class="cred-status cred-status--ok">● Active</span>';
  };

  const linkedTags = (acct) => {
    const names = acct.linkedCompanyNames || [];
    if (names.length <= 1) return '';
    return names.map(n => `<span class="cred-co-tag">${escapeHtml(n)}</span>`).join('');
  };

  const rows = state.credAccounts.map(acct => `
    <tr class="cred-row ${acct.active ? '' : 'cred-row--inactive'}" data-id="${acct.id}">
      <td>
        <div class="cred-name">${escapeHtml(acct.displayName || acct.login)}</div>
        <div class="cred-login muted">${escapeHtml(acct.login)}</div>
        ${linkedTags(acct)}
      </td>
      <td>
        <div>${escapeHtml(acct.companyName || '-')}</div>
        <div class="muted" style="font-size:.78rem">${acct.role === 'company_admin' ? 'Overseer' : 'Branch User'}</div>
      </td>
      <td>${escapeHtml(acct.deliveryEmail || '—')}</td>
      <td>${statusIcon(acct)}</td>
      <td>
        <div class="cred-actions">
          <button class="btn btn-secondary btn-sm cred-edit-btn" data-id="${acct.id}">Edit</button>
          <button class="btn btn-secondary btn-sm cred-pin-btn" data-id="${acct.id}">New PIN</button>
          <button class="btn btn-secondary btn-sm cred-toggle-btn" data-id="${acct.id}" data-active="${acct.active}">${acct.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </td>
    </tr>
    ${state.credEditId === acct.id ? buildEditRow(acct) : ''}
  `).join('');

  const pagination = state.credPages > 1 ? `
    <div class="cred-pagination">
      <button class="btn btn-secondary btn-sm" id="credPrev" ${state.credPage <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${state.credPage} of ${state.credPages} &nbsp;(${state.credTotal} total)</span>
      <button class="btn btn-secondary btn-sm" id="credNext" ${state.credPage >= state.credPages ? 'disabled' : ''}>Next →</button>
    </div>` : `<div class="cred-pagination muted">${state.credTotal} account${state.credTotal !== 1 ? 's' : ''}</div>`;

  return `
    <div class="panel glass" style="margin-bottom:.75rem">
      <div class="cred-filters">
        <input id="credSearchInput" class="input" placeholder="Search name, login, email, company…" value="${escapeHtml(state.credSearch)}" />
        <select id="credRoleSelect" class="input">
          <option value="">All Roles</option>
          <option value="company_admin" ${state.credRoleFilter === 'company_admin' ? 'selected' : ''}>Overseer (company_admin)</option>
          <option value="branch_user" ${state.credRoleFilter === 'branch_user' ? 'selected' : ''}>Branch User</option>
        </select>
        <select id="credStatusSelect" class="input">
          <option value="">All Statuses</option>
          <option value="new" ${state.credStatusFilter === 'new' ? 'selected' : ''}>New (never logged in)</option>
          <option value="changed" ${state.credStatusFilter === 'changed' ? 'selected' : ''}>Changed password</option>
        </select>
        <select id="credActiveSelect" class="input">
          <option value="true" ${state.credActiveFilter === 'true' ? 'selected' : ''}>Active only</option>
          <option value="false" ${state.credActiveFilter === 'false' ? 'selected' : ''}>Inactive only</option>
          <option value="" ${state.credActiveFilter === '' ? 'selected' : ''}>All</option>
        </select>
      </div>
    </div>

    <div class="panel glass">
      <div class="table-wrap">
        <table class="data-table cred-table">
          <thead><tr>
            <th>Name / Login</th>
            <th>Company / Role</th>
            <th>Contact Email</th>
            <th>Delivery Email</th>
            <th>Status</th>
            <th>Actions</th>
          </tr></thead>
          <tbody id="credTableBody">${rows || '<tr><td colspan="5" class="empty-state">No accounts found.</td></tr>'}</tbody>
        </table>
      </div>
      ${pagination}
    </div>

    <!-- PIN Modal -->
    <div id="credPinModal" class="cred-modal hidden">
      <div class="cred-modal-box">
        <h3>New Temporary PIN</h3>
        <p id="credPinName" class="muted"></p>
        <div class="cred-pin-display" id="credPinDisplay">——</div>
        <p class="cred-pin-warning">Show this PIN to the customer once. It cannot be recovered after closing.</p>
        <button class="btn btn-primary full" id="credPinCopy">Copy PIN</button>
        <button class="btn btn-secondary full" style="margin-top:.4rem" id="credPinClose">Done</button>
      </div>
    </div>
  `;
}

function buildEditRow(acct) {
  const linkedIds = acct.linkedCompanyIds || [];
  const linkedNames = acct.linkedCompanyNames || [];
  const linkedHtml = linkedIds.map((id, i) => `
    <span class="cred-co-tag">
      ${escapeHtml(linkedNames[i] || String(id))}
      ${Number(acct.companyId) !== Number(id)
        ? `<button class="cred-unlink-btn" data-account="${acct.id}" data-company="${id}" title="Remove access">✕</button>`
        : '<small>(primary)</small>'}
    </span>`).join('');

  return `
    <tr class="cred-edit-row" id="credEditRow_${acct.id}">
      <td colspan="5">
        <div class="cred-edit-panel">
          <h4>Edit: ${escapeHtml(acct.displayName || acct.login)}</h4>
          <div class="cred-edit-grid">
            <label>Display Name
              <input class="input" id="editName_${acct.id}" value="${escapeHtml(acct.displayName || '')}" />
            </label>
            <label>Delivery Email
              <input class="input" id="editEmail_${acct.id}" type="email" value="${escapeHtml(acct.deliveryEmail || '')}" />
            </label>
            <label>Login (username)
              <input class="input" id="editLogin_${acct.id}" value="${escapeHtml(acct.login || '')}" />
              <small class="muted">Changing login changes how the customer signs in</small>
            </label>
          </div>
          <div class="cred-edit-actions">
            <button class="btn btn-primary cred-save-btn" data-id="${acct.id}">Save Changes</button>
            <button class="btn btn-secondary cred-cancel-btn" data-id="${acct.id}">Cancel</button>
          </div>

          <div class="cred-access-section">
            <h4>Company Access <span class="muted">(what this account can see)</span></h4>
            <div class="cred-linked-cos" id="linkedCos_${acct.id}">${linkedHtml || '<span class="muted">None linked</span>'}</div>
            <div class="cred-link-form">
              <input class="input" id="linkSearch_${acct.id}" placeholder="Search company to link…" autocomplete="off" />
              <div id="linkResults_${acct.id}" class="cred-link-results hidden"></div>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
}

function bindCredentialsTab() {
  const tabBody = document.getElementById('adminTabBody');
  if (!tabBody) return;

  // Search + filter debounce
  let searchTimer;
  tabBody.querySelector('#credSearchInput')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.credSearch = e.target.value;
      state.credPage = 1;
      await renderCredentialsTab();
    }, 350);
  });
  ['#credRoleSelect','#credStatusSelect','#credActiveSelect'].forEach(sel => {
    tabBody.querySelector(sel)?.addEventListener('change', async e => {
      if (sel === '#credRoleSelect') state.credRoleFilter = e.target.value;
      if (sel === '#credStatusSelect') state.credStatusFilter = e.target.value;
      if (sel === '#credActiveSelect') state.credActiveFilter = e.target.value;
      state.credPage = 1;
      await renderCredentialsTab();
    });
  });

  // Pagination
  tabBody.querySelector('#credPrev')?.addEventListener('click', async () => { state.credPage--; await renderCredentialsTab(); });
  tabBody.querySelector('#credNext')?.addEventListener('click', async () => { state.credPage++; await renderCredentialsTab(); });

  // PIN modal close
  tabBody.querySelector('#credPinClose')?.addEventListener('click', () => {
    tabBody.querySelector('#credPinModal')?.classList.add('hidden');
  });
  tabBody.querySelector('#credPinCopy')?.addEventListener('click', () => {
    const pin = tabBody.querySelector('#credPinDisplay')?.textContent || '';
    navigator.clipboard.writeText(pin).then(() => showNotice('PIN copied.', 'success'));
  });

  // Table body event delegation
  const tbody = tabBody.querySelector('#credTableBody');
  if (!tbody) return;

  tbody.addEventListener('click', async e => {
    // Edit
    const editBtn = e.target.closest('.cred-edit-btn');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-id'));
      state.credEditId = state.credEditId === id ? null : id;
      tbody.innerHTML = state.credAccounts.map(a => `
        <tr class="cred-row ${a.active ? '' : 'cred-row--inactive'}" data-id="${a.id}">
          <td>
            <div class="cred-name">${escapeHtml(a.displayName || a.login)}</div>
            <div class="cred-login muted">${escapeHtml(a.login)}</div>
            ${(a.linkedCompanyNames||[]).length > 1 ? (a.linkedCompanyNames||[]).map(n=>`<span class="cred-co-tag">${escapeHtml(n)}</span>`).join('') : ''}
          </td>
          <td><div>${escapeHtml(a.companyName||'-')}</div><div class="muted" style="font-size:.78rem">${a.role==='company_admin'?'Overseer':'Branch User'}</div></td>
          <td>${escapeHtml(a.deliveryEmail||'—')}</td>
          <td>${a.active ? (a.mustChangePassword ? '<span class="cred-status cred-status--new">● New</span>' : '<span class="cred-status cred-status--ok">● Active</span>') : '<span class="cred-status cred-status--off">● Inactive</span>'}</td>
          <td><div class="cred-actions">
            <button class="btn btn-secondary btn-sm cred-edit-btn" data-id="${a.id}">Edit</button>
            <button class="btn btn-secondary btn-sm cred-pin-btn" data-id="${a.id}">New PIN</button>
            <button class="btn btn-secondary btn-sm cred-toggle-btn" data-id="${a.id}" data-active="${a.active}">${a.active?'Deactivate':'Activate'}</button>
          </div></td>
        </tr>
        ${state.credEditId === a.id ? buildEditRow(a) : ''}
      `).join('');
      bindEditRow(id, tabBody);
      return;
    }

    // New PIN
    const pinBtn = e.target.closest('.cred-pin-btn');
    if (pinBtn) {
      const id = Number(pinBtn.getAttribute('data-id'));
      const token = loadAuthToken();
      pinBtn.disabled = true; pinBtn.textContent = '…';
      try {
        const r = await fetch(`/portal-api/admin/care/accounts/${id}/generate-password`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'same-origin'
        });
        const d = await r.json();
        if (d.ok) {
          const modal = tabBody.querySelector('#credPinModal');
          const nameEl = tabBody.querySelector('#credPinName');
          const pinEl = tabBody.querySelector('#credPinDisplay');
          const acct = state.credAccounts.find(a => a.id === id);
          if (nameEl) nameEl.textContent = acct?.displayName || acct?.login || '';
          if (pinEl) pinEl.textContent = d.password;
          modal?.classList.remove('hidden');
          // Update in-state
          if (acct) acct.mustChangePassword = true;
        } else {
          showNotice(d.message || 'Failed to generate PIN.', 'error');
        }
      } catch { showNotice('Network error.', 'error'); }
      pinBtn.disabled = false; pinBtn.textContent = 'New PIN';
      return;
    }

    // Toggle active
    const toggleBtn = e.target.closest('.cred-toggle-btn');
    if (toggleBtn) {
      const id = Number(toggleBtn.getAttribute('data-id'));
      const token = loadAuthToken();
      toggleBtn.disabled = true;
      try {
        const r = await fetch(`/portal-api/admin/credentials/${id}/toggle-active`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'same-origin'
        });
        const d = await r.json();
        if (d.ok) {
          const acct = state.credAccounts.find(a => a.id === id);
          if (acct) acct.active = d.account.active;
          await renderCredentialsTab();
        } else showNotice(d.message || 'Failed.', 'error');
      } catch { showNotice('Network error.', 'error'); }
      toggleBtn.disabled = false;
    }
  });
}

function bindEditRow(editId, tabBody) {
  const row = tabBody.querySelector(`#credEditRow_${editId}`);
  if (!row) return;

  // Save
  row.querySelector('.cred-save-btn')?.addEventListener('click', async () => {
    const token = loadAuthToken();
    const body = {
      displayName: row.querySelector(`#editName_${editId}`)?.value || '',
      deliveryEmail: row.querySelector(`#editEmail_${editId}`)?.value || '',
      login: row.querySelector(`#editLogin_${editId}`)?.value || ''
    };
    const r = await fetch(`/portal-api/admin/credentials/${editId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.ok) {
      showNotice('Saved.', 'success');
      state.credEditId = null;
      await renderCredentialsTab();
    } else showNotice(d.message || 'Failed to save.', 'error');
  });

  // Cancel
  row.querySelector('.cred-cancel-btn')?.addEventListener('click', async () => {
    state.credEditId = null;
    await renderCredentialsTab();
  });

  // Unlink company
  row.querySelectorAll('.cred-unlink-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const accountId = btn.getAttribute('data-account');
      const companyId = btn.getAttribute('data-company');
      if (!confirm('Remove this company from the account? The account will no longer see that company\'s data.')) return;
      const token = loadAuthToken();
      const r = await fetch(`/portal-api/admin/credentials/${accountId}/unlink-company/${companyId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin'
      });
      const d = await r.json();
      if (d.ok) { showNotice('Company unlinked.', 'success'); state.credEditId = editId; await renderCredentialsTab(); }
      else showNotice(d.message || 'Failed.', 'error');
    });
  });

  // Company link search
  const linkInput = row.querySelector(`#linkSearch_${editId}`);
  const linkResults = row.querySelector(`#linkResults_${editId}`);
  if (!linkInput || !linkResults) return;

  let linkTimer;
  linkInput.addEventListener('input', () => {
    clearTimeout(linkTimer);
    const q = linkInput.value.trim();
    if (!q) { linkResults.classList.add('hidden'); return; }
    linkTimer = setTimeout(async () => {
      const token = loadAuthToken();
      const r = await fetch(`/portal-api/admin/care/companies?q=${encodeURIComponent(q)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin'
      });
      const d = await r.json().catch(() => ({}));
      const companies = d.companies || [];
      if (!companies.length) { linkResults.innerHTML = '<div class="cred-link-hint">No companies found.</div>'; linkResults.classList.remove('hidden'); return; }
      linkResults.innerHTML = companies.slice(0, 8).map(co =>
        `<button class="cred-link-result" data-id="${co.id}" data-name="${escapeHtml(co.name)}">${escapeHtml(co.name)}</button>`
      ).join('');
      linkResults.classList.remove('hidden');
      linkResults.querySelectorAll('.cred-link-result').forEach(btn => {
        btn.addEventListener('click', async () => {
          const token2 = loadAuthToken();
          const r2 = await fetch(`/portal-api/admin/credentials/${editId}/link-company`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token2 ? { Authorization: `Bearer ${token2}` } : {}) },
            credentials: 'same-origin',
            body: JSON.stringify({ companyId: Number(btn.getAttribute('data-id')) })
          });
          const d2 = await r2.json();
          if (d2.ok) {
            showNotice(`Linked: ${d2.companyName}`, 'success');
            linkInput.value = '';
            linkResults.classList.add('hidden');
            state.credEditId = editId;
            await renderCredentialsTab();
          } else showNotice(d2.message || 'Failed.', 'error');
        });
      });
    }, 300);
  });
}


async function renderAdmin() {
  if (state.user.role !== 'corporate_admin') {
    viewContainer.innerHTML = '<div class="panel glass"><div class="empty-state">Admin view is available to corporate_admin only.</div></div>';
    return;
  }

  const [branches, devices, signers, reportRows] = await Promise.all([
    service.listBranches(state.user),
    service.listDevices(state.user),
    service.listAuthorizedSigners(state.user, { companyId: state.user.companyId }),
    service.getBranchTicketReport(state.user)
  ]);

  const branchOptions = branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('');

  viewContainer.innerHTML = `
    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Manage Branches</h3></div>
        <form id="adminBranchForm" class="form-grid">
          <label>Branch Name<input name="name" required /></label>
          <label>Address<input name="address" required /></label>
          <button type="submit" class="btn btn-primary full">Add Branch</button>
        </form>
        <div class="timeline" style="margin-top:.7rem;">
          ${branches.map((branch) => `<article class="timeline-item"><strong>${escapeHtml(branch.name)}</strong><p>${escapeHtml(branch.address || '-')}</p></article>`).join('')}
        </div>
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>Manage Devices</h3></div>
        <form id="adminDeviceForm" class="form-grid">
          <label>Branch<select name="branchId" required>${branchOptions}</select></label>
          <label>Model<input name="model" required /></label>
          <label>Serial<input name="serial" required /></label>
          <label>Location<input name="location" required /></label>
          <label>Status<select name="status"><option>Active</option><option>Inactive</option><option>Maintenance</option></select></label>
          <label>Contract Start<input type="date" name="contractStart" /></label>
          <label>Contract End<input type="date" name="contractEnd" /></label>
          <label class="full">Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit" class="btn btn-primary full">Add Device</button>
        </form>
        <p class="muted" style="margin-top:.45rem;">Total devices: ${devices.length}</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Authorized Signers</h3></div>
        <form id="adminSignerForm" class="form-grid">
          <label>Branch<select name="branchId" required>${branchOptions}</select></label>
          <label>Name<input name="name" required /></label>
          <label>Email<input type="email" name="email" required /></label>
          <label>Phone<input name="phone" /></label>
          <label>PIN (4-6 digits)<input name="pin" type="password" pattern="[0-9]{4,6}" minlength="4" maxlength="6" required /></label>
          <button type="submit" class="btn btn-primary full">Add Signer</button>
        </form>

        <form id="adminPinResetForm" class="form-grid" style="margin-top:.8rem;">
          <label>Signer
            <select name="signerId" required>
              <option value="">Select signer</option>
              ${signers.map((signer) => `<option value="${signer.id}">${escapeHtml(signer.name)} - ${escapeHtml(signer.branchId)}</option>`).join('')}
            </select>
          </label>
          <label>New PIN<input name="newPin" type="password" pattern="[0-9]{4,6}" minlength="4" maxlength="6" required /></label>
          <button type="submit" class="btn btn-secondary full">Reset PIN</button>
        </form>
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>Consolidated Ticket Report</h3></div>
        ${
          reportRows.length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr>
            <th>Branch</th><th>Open</th><th>In Progress</th><th>Completed</th>
          </tr></thead><tbody>
          ${reportRows
            .map(
              (row) => `<tr><td>${escapeHtml(row.branch)}</td><td>${row.open}</td><td>${row.inProgress}</td><td>${row.completed}</td></tr>`
            )
            .join('')}
          </tbody></table></div>`
            : '<div class="empty-state">No ticket data yet.</div>'
        }
      </div>
    </div>
  `;

  document.getElementById('adminBranchForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await service.upsertBranch(state.user, {
        companyId: state.user.companyId,
        name: formData.get('name'),
        address: formData.get('address')
      });
      showNotice('Branch saved.', 'success');
      await renderAdmin();
    } catch (error) {
      showNotice(error.message || 'Failed to save branch.', 'error');
    }
  });

  document.getElementById('adminDeviceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await service.upsertDevice(state.user, {
        companyId: state.user.companyId,
        branchId: formData.get('branchId'),
        model: formData.get('model'),
        serial: formData.get('serial'),
        location: formData.get('location'),
        status: formData.get('status'),
        contractStart: formData.get('contractStart'),
        contractEnd: formData.get('contractEnd'),
        notes: formData.get('notes')
      });
      showNotice('Device saved.', 'success');
      await renderAdmin();
    } catch (error) {
      showNotice(error.message || 'Failed to save device.', 'error');
    }
  });

  document.getElementById('adminSignerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const branchId = formData.get('branchId');
    const signerId = `signer_${Date.now()}`;

    try {
      const pinHash = await hashSignerPin(signerId, formData.get('pin'));
      await service.upsertSigner(state.user, {
        id: signerId,
        companyId: state.user.companyId,
        branchId,
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        pinHash,
        active: true
      });
      showNotice('Authorized signer created.', 'success');
      await renderAdmin();
    } catch (error) {
      showNotice(error.message || 'Failed to create signer.', 'error');
    }
  });

  document.getElementById('adminPinResetForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await service.resetSignerPin(state.user, formData.get('signerId'), formData.get('newPin'));
      showNotice('Signer PIN reset successful.', 'success');
      event.currentTarget.reset();
    } catch (error) {
      showNotice(error.message || 'Failed to reset PIN.', 'error');
    }
  });
}

async function renderView() {
  if (!state.user) return;
  if (isInternalPortalUser() && !state.previewCompanyId && state.currentView !== 'dashboard') {
    state.currentView = 'dashboard';
  }

  switch (state.currentView) {
    case 'dashboard':
      await renderDashboard();
      break;
    case 'devices':
      await renderDevices();
      break;
    case 'tickets':
      await renderTickets();
      break;
    case 'toner':
      await renderToner();
      break;
    case 'billing':
      await renderBilling();
      break;
    case 'history':
      await renderHistory();
      break;
    case 'support':
      renderSupport();
      break;
    case 'admin':
      await renderAdmin();
      break;
    default:
      await renderDashboard();
  }

  viewContainer.querySelectorAll('[data-device-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await openDeviceDetail(button.getAttribute('data-device-id'));
    });
  });

  viewContainer.querySelectorAll('[data-ticket-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await openTicketDetail(button.getAttribute('data-ticket-id'));
    });
  });
}

async function showPortal(user, { ephemeral = false } = {}) {
  if (!roleViews[user?.role]) {
    throw new Error('This account role is not allowed in customer portal.');
  }
  if (isInternalPortalUser(user)) {
    state.previewCompanyId = '';
    state.previewCompanyIds = [];
    state.previewCompanyName = '';
    state.previewBranchId = '';
    state.previewSearchQuery = '';
    state.previewSearchResults = [];
    state.previewDraftAccount = null;
    state.previewBranches = [];
    state.previewPickerExpanded = true;
    user.previewCompanyId = '';
    user.previewCompanyIds = [];
    user.previewCompanyName = '';
    user.previewBranchId = '';
    savePreviewCompanyId('');
    savePreviewBranchId('');
  } else {
    state.previewCompanyId = '';
    state.previewCompanyIds = [];
    state.previewCompanyName = '';
    state.previewBranchId = '';
  }
  state.user = user;
  state.company = isInternalPortalUser(user) && state.previewCompanyName
    ? {
        id: state.previewCompanyId || user.companyId || 'marga_internal',
        name: state.previewCompanyName,
        status: 'active',
        announcements: ['Internal Marga portal view.']
      }
    : await service.getCompanyById(activeCompanyId() || user.companyId, user);

  // Load all companies this user can access (powers group switcher)
  if (!isInternalPortalUser(user)) {
    try {
      const myCompaniesResp = await fetch('/portal-api/my-companies', {
        headers: { Authorization: `Bearer ${loadAuthToken() || ''}` },
        credentials: 'same-origin'
      });
      const myCompaniesData = await myCompaniesResp.json().catch(() => ({}));
      state.portalCompanies = myCompaniesData.companies || [];
    } catch { state.portalCompanies = []; }
    // Default: show all groups (no filter)
    state.activeCompanyId = null;
  }

  if (isInternalPortalUser(user) && state.previewCompanyId) {
    state.previewDraftAccount = {
      id: Number(state.previewCompanyId),
      companyIds: state.previewCompanyIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
      name: state.previewCompanyName || state.company?.name || 'Customer',
      motherName: state.previewCompanyName || state.company?.name || 'Customer',
      groupLabel: '',
      type: state.previewCompanyIds.length > 1 ? 'grouped_account' : 'company',
      branchCount: 0,
      machineCount: 0,
      companyMatchCount: 1,
      matchSource: 'company',
      note: ''
    };
    state.previewBranches = await service.listPreviewBranches(state.previewCompanyIds.length ? state.previewCompanyIds : state.previewCompanyId);
    state.previewPickerExpanded = false;
  } else if (isInternalPortalUser(user)) {
    state.previewDraftAccount = null;
    state.previewBranches = [];
    state.previewPickerExpanded = true;
  }
  saveSession(user, { ephemeral });

  authView.classList.add('hidden');
  portalView.classList.remove('hidden');

  renderUserCard();
  renderAnnouncements();
  renderNav();

  // Check staff gate for unclosed schedules (blocks field staff)
  checkStaffGate(user).catch(() => {});

  // Mount FAB for non-internal users (customers only)
  if (!isInternalPortalUser(user)) {
    renderQuickRequestFab();
  }

  const hashView = location.hash.replace('#', '');
  setView(hashView || findView('dashboard').key, false);
}

async function restoreSession() {
  const session = loadSession();
  if (!session || session.role === 'tech') return false;
  const ephemeral = String(session.id || '').startsWith('portal:');

  const profile = await service.getUserById(session.id || session.uid);
  if (!profile) {
    clearSession();
    return false;
  }

  await showPortal(profile, { ephemeral });
  return true;
}

function bindGlobalActions() {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const params = new URLSearchParams(window.location.search);
    const previewToken = params.get('preview_token') || '';

    try {
      if (previewToken) {
        const result = await service.previewLogin(previewToken);
        saveSession(result.user, { ephemeral: true });
        saveAuthToken(result.token);
        window.history.replaceState({}, '', '/');
        await showPortal(result.user, { ephemeral: true });
        setTopMessage('Customer preview loaded.', 'info');
        return;
      }
      clearAuthToken();
      const user = await service.login(formData.get('login'), formData.get('password'), { techOnly: false });
      await showPortal(user);
    } catch (error) {
      setTopMessage(error.message || 'Login failed.', 'error');
    }
  });

  navRoot.addEventListener('click', (event) => {
    const target = event.target.closest('[data-view]');
    if (!target) return;
    event.preventDefault();
    setView(target.getAttribute('data-view'));
    sidebar.classList.remove('open');
  });

  bottomNav.addEventListener('click', (event) => {
    const target = event.target.closest('[data-view]');
    if (!target) return;
    event.preventDefault();
    setView(target.getAttribute('data-view'));
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await service.logout();
    clearAuthToken();
    clearSession({ keepPersistent: String(state.user?.id || '').startsWith('portal:') });
    location.href = '/';
  });

  // Mobile sidebar toggle — single listener only
  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // Close sidebar when clicking outside
  document.addEventListener('click', (e) => {
    if (sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !menuToggle.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });

  window.addEventListener('hashchange', () => {
    const hashView = location.hash.replace('#', '');
    if (!hashView || hashView === state.currentView) return;
    setView(hashView, false);
  });
}

async function refreshBackendStatus() {
  if (!navigator.onLine) {
    syncBadge.textContent = 'Offline';
    syncBadge.className = 'status-badge warn';
    syncBadge.title = 'Browser is offline.';
    return;
  }
  syncBadge.textContent = 'Checking';
  syncBadge.className = 'status-badge neutral';
  syncBadge.title = 'Checking Marga Care backend and database connection...';
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error('Backend health check failed.');
    syncBadge.textContent = 'Online';
    syncBadge.className = 'status-badge neutral';
    syncBadge.title = 'Connected to Marga Care backend and database.';
  } catch {
    syncBadge.textContent = 'Backend Offline';
    syncBadge.className = 'status-badge warn';
    syncBadge.title = 'Cannot reach Marga Care backend/database.';
  }
}

async function init() {
  // Wait for intro FIRST — before any network calls or setup
  await waitForIntro();

  await service.init();

  setupInstallGuide({
    appName: 'MARGA Care Portal',
    tagline: 'Request support, track updates, and keep your proof in one place.',
    appIcon: '/public/assets/icons/icon-192.svg',
    storagePrefix: 'msp-portal',
    installHelpUrl: '/install/?target=portal'
  });

  setupPwa({
    installButton: null,
    onConnectivityChange: (isOnline) => {
      if (!isOnline) {
        syncBadge.textContent = 'Offline';
        syncBadge.className = 'status-badge warn';
        syncBadge.title = 'Browser is offline.';
        return;
      }
      refreshBackendStatus();
    }
  });
  await refreshBackendStatus();
  window.setInterval(refreshBackendStatus, 60000);

  if (service.usingDemo) {
    setTopMessage('Demo mode active. Try admin@acme-demo.com / demo1234.', 'info');
  }

  bindGlobalActions();
  const params = new URLSearchParams(window.location.search);
  const previewToken = params.get('preview_token') || '';
  const previewEmail = params.get('preview_email') || '';
  if (previewToken) {
    clearAuthToken();
    authView.classList.remove('hidden');
    portalView.classList.add('hidden');
    loginForm.elements.login.value = previewEmail;
    loginForm.elements.password.value = 'Preview Access';
    setTopMessage('Separate-tab customer preview is ready. Press Sign In to open the customer-facing portal.', 'info');
    return;
  }

  // Wait for intro FIRST before anything else
  const restored = await restoreSession().catch(() => false);
  if (!restored) {
    authView.classList.remove('hidden');
    portalView.classList.add('hidden');
    setTimeout(() => {
      document.querySelectorAll('.reveal-up').forEach((el, i) => {
        setTimeout(() => el.classList.add('revealed'), 60 + i * 110);
      });
    }, 100);
  }
}

function waitForIntro() {
  return new Promise(function(resolve) {
    // Check if intro already finished before we started listening (race condition fix)
    if (window.__margaIntroDone) return resolve();
    // Listen for the event
    window.addEventListener('marga:intro:done', resolve, { once: true });
    // Safety net: always resolve after 8s max
    setTimeout(resolve, 8000);
  });
}

init().catch((error) => {
  console.error('Init failed:', error);
  // ALWAYS show auth on any init failure — never leave black screen
  const av = document.getElementById('authView');
  const pv = document.getElementById('portalView');
  if (av) av.classList.remove('hidden');
  if (pv) pv.classList.add('hidden');
  setTimeout(() => {
    document.querySelectorAll('.reveal-up').forEach((el, i) => {
      setTimeout(() => el.classList.add('revealed'), 60 + i * 110);
    });
  }, 100);
});
