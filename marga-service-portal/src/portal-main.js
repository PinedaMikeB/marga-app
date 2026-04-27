import { DataService } from './lib/data-service.js';
import { setupInstallGuide } from './lib/install-guide.js';
import { setupPwa } from './lib/pwa.js';
import { clearSession, loadSession, roleLabel, saveSession } from './lib/session.js';
import { hashSignerPin } from './lib/pin-security.js';
import { escapeHtml, formatDate, formatMoney, statusClass } from './lib/utils.js';

const service = new DataService();
const config = window.MSP_CONFIG || {};

const state = {
  user: null,
  company: null,
  currentView: 'dashboard',
  selectedDeviceId: null,
  selectedTicketId: null,
  ticketFilter: 'all'
};

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
  corporate_admin: [
    { key: 'dashboard', label: 'Dashboard', subtitle: 'Consolidated operational view' },
    { key: 'devices', label: 'Devices', subtitle: 'Machine inventory and service history' },
    { key: 'tickets', label: 'Service Tickets', subtitle: 'Service requests and follow-ups' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Supply requests and status' },
    { key: 'billing', label: 'Billing', subtitle: 'Invoices, payments, and statements' },
    { key: 'support', label: 'Support', subtitle: 'Contact Marga support channels' },
    { key: 'admin', label: 'Admin', subtitle: 'Branches, devices, signers, and reports' }
  ],
  branch_manager: [
    { key: 'dashboard', label: 'Dashboard', subtitle: 'Branch operational view' },
    { key: 'devices', label: 'Devices', subtitle: 'Branch machine inventory' },
    { key: 'tickets', label: 'Service Tickets', subtitle: 'Branch service requests' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Branch supply requests' },
    { key: 'billing', label: 'Billing', subtitle: 'Branch invoices and dues' },
    { key: 'support', label: 'Support', subtitle: 'Contact Marga support channels' }
  ],
  end_user: [
    { key: 'dashboard', label: 'Dashboard', subtitle: 'Personal ticket and device summary' },
    { key: 'devices', label: 'Devices', subtitle: 'Branch devices you can request service for' },
    { key: 'tickets', label: 'Service Tickets', subtitle: 'Create and track your tickets' },
    { key: 'toner', label: 'Toner / Ink', subtitle: 'Request consumables' },
    { key: 'support', label: 'Support', subtitle: 'Contact Marga support channels' }
  ]
};

function currentViews() {
  return roleViews[state.user?.role] || [];
}

function findView(viewKey) {
  return currentViews().find((entry) => entry.key === viewKey) || currentViews()[0];
}

function setTopMessage(text, type = 'info') {
  authMessage.textContent = text;
  authMessage.style.color = type === 'error' ? '#b91c1c' : '#335d86';
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
  announcements.prepend(note);
  setTimeout(() => {
    note.remove();
  }, 4800);
}

function renderAnnouncements() {
  const items = state.company?.announcements || config.announcements || [];
  announcements.innerHTML = items.map((item) => `<div class="announcement-item">${escapeHtml(item)}</div>`).join('');
}

function renderUserCard() {
  document.getElementById('userName').textContent = state.user?.name || 'User';
  document.getElementById('userRole').textContent = roleLabel(state.user?.role);
  document.getElementById('userAvatar').textContent = (state.user?.name || 'U').trim().charAt(0).toUpperCase();
}

function renderNav() {
  const viewList = currentViews();
  const markup = viewList
    .map(
      (view) =>
        `<a href="#${view.key}" class="nav-link ${state.currentView === view.key ? 'active' : ''}" data-view="${view.key}">${escapeHtml(
          view.label
        )}</a>`
    )
    .join('');
  navRoot.innerHTML = markup;
  bottomNav.innerHTML = markup;
}

function setView(viewKey, replaceHash = true) {
  const safe = findView(viewKey)?.key || 'dashboard';
  state.currentView = safe;
  const viewMeta = findView(safe);
  viewTitle.textContent = viewMeta?.label || 'Dashboard';
  viewSubtitle.textContent = viewMeta?.subtitle || '';
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

async function renderDashboard() {
  const [summary, tickets, toner] = await Promise.all([
    service.getDashboardSummary(state.user),
    service.listTickets(state.user),
    service.listTonerRequests(state.user)
  ]);

  const latestTickets = tickets.slice(0, 5);
  const latestToner = toner.slice(0, 4);

  const billingBlock = ['corporate_admin', 'branch_manager'].includes(state.user.role)
    ? `<div class="kpi-card"><div class="value">${summary.unpaidInvoices}</div><div class="label">Unpaid Invoices</div></div>
       <div class="kpi-card"><div class="value">${formatMoney(summary.unpaidAmount)}</div><div class="label">Unpaid Amount</div></div>`
    : '';

  viewContainer.innerHTML = `
    <div class="panel glass">
      <h3 style="margin-bottom:.8rem;">Dashboard Summary</h3>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="value">${summary.activeDevices}</div><div class="label">Active Devices</div></div>
        <div class="kpi-card"><div class="value">${summary.openTickets}</div><div class="label">Open Tickets</div></div>
        <div class="kpi-card"><div class="value">${summary.pendingToner}</div><div class="label">Pending Toner Requests</div></div>
        ${billingBlock}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Recent Tickets</h3><span class="muted">Ticket numbers and timestamps</span></div>
        ${
          latestTickets.length
            ? `<div class="timeline">${latestTickets
                .map(
                  (ticket) => `<article class="timeline-item">
                    <strong>${escapeHtml(ticket.ticketNo || ticket.id)}</strong>
                    <div class="tag ${statusClass(ticket.status)}">${escapeHtml(ticket.status || 'Open')}</div>
                    <p>${escapeHtml(ticket.description || '')}</p>
                    <p>${formatDate(ticket.updatedAt || ticket.createdAt)}</p>
                  </article>`
                )
                .join('')}</div>`
            : '<div class="empty-state">No tickets yet.</div>'
        }
      </div>
      <div class="panel glass">
        <div class="panel-head"><h3>Recent Toner Requests</h3></div>
        ${
          latestToner.length
            ? `<div class="timeline">${latestToner
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
}

async function renderDevices() {
  const [devices, tickets, branches] = await Promise.all([
    service.listDevices(state.user),
    service.listTickets(state.user),
    service.listBranches(state.user)
  ]);

  if (!state.selectedDeviceId && devices.length) state.selectedDeviceId = devices[0].id;
  const selectedDevice = devices.find((device) => device.id === state.selectedDeviceId) || devices[0] || null;
  const deviceHistory = selectedDevice ? tickets.filter((ticket) => ticket.deviceId === selectedDevice.id) : [];

  const branchMap = new Map(branches.map((branch) => [branch.id, branch.name]));

  viewContainer.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Rented Devices</h3><span class="muted">${devices.length} devices</span></div>
      ${
        devices.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr>
            <th>Model</th><th>Serial</th><th>Branch</th><th>Status</th><th>Contract</th><th></th>
          </tr></thead><tbody>
          ${devices
            .map(
              (device) => `<tr>
              <td>${escapeHtml(device.model)}</td>
              <td>${escapeHtml(device.serial)}</td>
              <td>${escapeHtml(branchMap.get(device.branchId) || device.branchId || '-')}</td>
              <td><span class="tag ${statusClass(device.status)}">${escapeHtml(device.status || '')}</span></td>
              <td>${escapeHtml(device.contractStart || '-')} to ${escapeHtml(device.contractEnd || '-')}</td>
              <td><button class="btn btn-secondary btn-sm" data-device-id="${device.id}">Details</button></td>
            </tr>`
            )
            .join('')}
          </tbody></table></div>`
          : '<div class="empty-state">No devices found for your scope.</div>'
      }
    </div>

    <div class="panel glass">
      <div class="panel-head"><h3>Device Detail</h3></div>
      ${
        selectedDevice
          ? `<div class="summary-line"><span>Model</span><strong>${escapeHtml(selectedDevice.model)}</strong></div>
             <div class="summary-line"><span>Serial</span><strong>${escapeHtml(selectedDevice.serial)}</strong></div>
             <div class="summary-line"><span>Location</span><strong>${escapeHtml(selectedDevice.location || '-')}</strong></div>
             <div class="summary-line"><span>Status</span><strong>${escapeHtml(selectedDevice.status || '-')}</strong></div>
             <div class="summary-line"><span>Service History</span><strong>${deviceHistory.length} tickets</strong></div>
             <div class="timeline">
               ${
                 deviceHistory.length
                   ? deviceHistory
                       .slice(0, 6)
                       .map(
                         (ticket) => `<article class="timeline-item">
                          <strong>${escapeHtml(ticket.ticketNo || ticket.id)}</strong>
                          <div class="tag ${statusClass(ticket.status)}">${escapeHtml(ticket.status || '')}</div>
                          <p>${escapeHtml(ticket.description || '')}</p>
                          <p>${formatDate(ticket.updatedAt || ticket.createdAt)}</p>
                        </article>`
                       )
                       .join('')
                   : '<div class="empty-state">No service history yet.</div>'
               }
             </div>`
          : '<div class="empty-state">Choose a device to inspect details.</div>'
      }
    </div>
  `;
}

function renderTicketTimeline(ticket) {
  if (!ticket) return '<div class="empty-state">Select a ticket to see timeline.</div>';

  const items = [
    {
      label: 'Created',
      details: ticket.description,
      at: ticket.createdAt
    },
    {
      label: 'Latest Update',
      details: `Status: ${ticket.status || 'Open'}`,
      at: ticket.updatedAt
    }
  ];

  const notes = Array.isArray(ticket.workNotes) ? ticket.workNotes : [];
  notes.slice(0, 4).forEach((note) => {
    items.push({ label: 'Work Note', details: note, at: ticket.updatedAt });
  });

  if (ticket.completion) {
    items.push({
      label: 'Completed',
      details: `Ack: ${ticket.completion.acknowledgedByName || '-'} (${ticket.completion.ackMethod || 'PIN'})`,
      at: ticket.completion.completedAt
    });
  }

  return `<div class="timeline">${items
    .map(
      (item) => `<article class="timeline-item">
      <strong>${escapeHtml(item.label)}</strong>
      <p>${escapeHtml(item.details || '')}</p>
      <p>${formatDate(item.at)}</p>
    </article>`
    )
    .join('')}</div>`;
}

async function renderTickets() {
  const [devices, branches, tickets] = await Promise.all([
    service.listDevices(state.user),
    service.listBranches(state.user),
    service.listTickets(state.user)
  ]);

  let visibleTickets = tickets;
  if (state.ticketFilter !== 'all') {
    visibleTickets = tickets.filter((ticket) => String(ticket.status || '').toLowerCase() === state.ticketFilter);
  }

  if (!state.selectedTicketId && visibleTickets.length) state.selectedTicketId = visibleTickets[0].id;
  const selectedTicket = tickets.find((ticket) => ticket.id === state.selectedTicketId) || null;

  const deviceOptions = devices
    .map((device) => `<option value="${device.id}">${escapeHtml(device.model)} - ${escapeHtml(device.serial)}</option>`)
    .join('');
  const branchOptions = branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('');

  viewContainer.innerHTML = `
    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Create Service Ticket</h3></div>
        <form id="createTicketForm" class="form-grid">
          ${
            state.user.role === 'corporate_admin'
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
          <label class="full">Description<textarea name="description" rows="3" required placeholder="Describe the issue clearly..."></textarea></label>
          <label class="full">Attach Photo (optional)<input type="file" name="attachment" accept="image/*" /></label>
          <button type="submit" class="btn btn-primary full">Submit Ticket</button>
        </form>
      </div>

      <div class="panel glass">
        <div class="panel-head">
          <h3>Ticket Timeline</h3>
          <span class="muted">${selectedTicket ? escapeHtml(selectedTicket.ticketNo || selectedTicket.id) : 'No ticket selected'}</span>
        </div>
        ${renderTicketTimeline(selectedTicket)}
      </div>
    </div>

    <div class="panel glass">
      <div class="panel-head stack-on-mobile">
        <h3>Ticket List</h3>
        <div class="panel-actions">
          <select id="ticketStatusFilter" class="input">
            <option value="all" ${state.ticketFilter === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="open" ${state.ticketFilter === 'open' ? 'selected' : ''}>Open</option>
            <option value="assigned" ${state.ticketFilter === 'assigned' ? 'selected' : ''}>Assigned</option>
            <option value="in progress" ${state.ticketFilter === 'in progress' ? 'selected' : ''}>In Progress</option>
            <option value="pending follow up" ${state.ticketFilter === 'pending follow up' ? 'selected' : ''}>Pending Follow Up</option>
            <option value="completed" ${state.ticketFilter === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
      </div>
      ${
        visibleTickets.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr>
              <th>Ticket No</th><th>Category</th><th>Priority</th><th>Status</th><th>Updated</th><th></th>
            </tr></thead><tbody>
            ${visibleTickets
              .map(
                (ticket) => `<tr>
                  <td>${escapeHtml(ticket.ticketNo || ticket.id)}</td>
                  <td>${escapeHtml(ticket.category || '-')}</td>
                  <td>${escapeHtml(ticket.priority || '-')}</td>
                  <td><span class="tag ${statusClass(ticket.status)}">${escapeHtml(ticket.status || '-')}</span></td>
                  <td>${formatDate(ticket.updatedAt || ticket.createdAt)}</td>
                  <td><button class="btn btn-secondary btn-sm" data-ticket-id="${ticket.id}">View</button></td>
                </tr>`
              )
              .join('')}
            </tbody></table></div>`
          : '<div class="empty-state">No tickets found for this filter.</div>'
      }
    </div>
  `;

  document.getElementById('createTicketForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const branchId = state.user.role === 'corporate_admin' ? formData.get('branchId') : state.user.branchId;
    const payload = {
      companyId: state.user.companyId,
      branchId,
      deviceId: formData.get('deviceId'),
      category: formData.get('category'),
      priority: formData.get('priority'),
      description: formData.get('description')
    };

    const attachment = formData.get('attachment');
    const hasFile = attachment && attachment.size > 0;

    try {
      await service.createTicket(state.user, payload, hasFile ? attachment : null);
      showNotice('Ticket submitted successfully.', 'success');
      form.reset();
      await renderTickets();
    } catch (error) {
      showNotice(error.message || 'Unable to create ticket.', 'error');
    }
  });

  document.getElementById('ticketStatusFilter')?.addEventListener('change', async (event) => {
    state.ticketFilter = event.target.value;
    await renderTickets();
  });
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
  const branchOptions = branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join('');

  viewContainer.innerHTML = `
    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Request Toner / Ink</h3></div>
        <form id="createTonerForm" class="form-grid">
          ${
            state.user.role === 'corporate_admin'
              ? `<label>Branch<select name="branchId" required>${branchOptions}</select></label>`
              : `<input type="hidden" name="branchId" value="${escapeHtml(state.user.branchId || '')}" />`
          }
          <label>Device<select name="deviceId" required>${deviceOptions}</select></label>
          <label class="full">Notes<textarea name="notes" rows="3" placeholder="Add toner color or urgency details"></textarea></label>
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

    const payload = {
      companyId: state.user.companyId,
      branchId: state.user.role === 'corporate_admin' ? formData.get('branchId') : state.user.branchId,
      deviceId: formData.get('deviceId'),
      notes: formData.get('notes')
    };

    try {
      await service.createTonerRequest(state.user, payload);
      showNotice('Toner request submitted.', 'success');
      event.currentTarget.reset();
      await renderToner();
    } catch (error) {
      showNotice(error.message || 'Failed to submit toner request.', 'error');
    }
  });
}

async function renderBilling() {
  if (!['corporate_admin', 'branch_manager'].includes(state.user.role)) {
    viewContainer.innerHTML = '<div class="panel glass"><div class="empty-state">Billing access is not available for this role.</div></div>';
    return;
  }

  const [invoices, payments] = await Promise.all([service.listInvoices(state.user), service.listPayments(state.user)]);
  const unpaid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
  const totalUnpaid = unpaid.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

  viewContainer.innerHTML = `
    <div class="panel glass">
      <div class="panel-head"><h3>Billing Summary</h3></div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="value">${invoices.length}</div><div class="label">Total Invoices</div></div>
        <div class="kpi-card"><div class="value">${unpaid.length}</div><div class="label">Unpaid Invoices</div></div>
        <div class="kpi-card"><div class="value">${formatMoney(totalUnpaid)}</div><div class="label">Unpaid Amount</div></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Invoices</h3></div>
        ${
          invoices.length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr>
              <th>Period</th><th>Amount</th><th>Due Date</th><th>Status</th><th>PDF</th>
            </tr></thead><tbody>
            ${invoices
              .map(
                (invoice) => `<tr>
                <td>${escapeHtml(invoice.period || '-')}</td>
                <td>${formatMoney(invoice.amount)}</td>
                <td>${escapeHtml(invoice.dueDate || '-')}</td>
                <td><span class="tag ${statusClass(invoice.status)}">${escapeHtml(invoice.status || '-')}</span></td>
                <td>${invoice.pdfUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(invoice.pdfUrl)}" target="_blank" rel="noopener">Download</a>` : '-'}</td>
              </tr>`
              )
              .join('')}
            </tbody></table></div>`
            : '<div class="empty-state">No invoices found.</div>'
        }
      </div>
      <div class="panel glass">
        <div class="panel-head"><h3>Payments</h3></div>
        ${
          payments.length
            ? `<div class="timeline">${payments
                .slice(0, 10)
                .map(
                  (payment) => `<article class="timeline-item">
                    <strong>${formatMoney(payment.amount)}</strong>
                    <p>${escapeHtml(payment.method || '-')}, Ref: ${escapeHtml(payment.referenceNo || '-')}</p>
                    <p>${escapeHtml(payment.date || '-')}</p>
                  </article>`
                )
                .join('')}</div>`
            : '<div class="empty-state">No payments recorded.</div>'
        }
      </div>
    </div>
  `;
}

function renderSupport() {
  const support = state.company?.support || config.support || {};
  const escalation = state.company?.escalationContacts || [
    { title: 'Service Desk', value: support.callNumber || '-' },
    { title: 'Billing Team', value: 'billing@marga.biz' },
    { title: 'Account Manager', value: 'accounts@marga.biz' }
  ];

  viewContainer.innerHTML = `
    <div class="grid-2">
      <div class="panel glass">
        <div class="panel-head"><h3>Contact Marga Support</h3></div>
        <div class="inline-actions">
          <a class="btn btn-primary" href="tel:${escapeHtml(support.callNumber || '')}">Call Support</a>
          <a class="btn btn-secondary" href="mailto:${escapeHtml(support.email || '')}">Email</a>
          <a class="btn btn-secondary" href="${escapeHtml(support.whatsappUrl || '#')}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn btn-secondary" href="${escapeHtml(support.viberUrl || '#')}" target="_blank" rel="noopener">Viber</a>
        </div>
      </div>

      <div class="panel glass">
        <div class="panel-head"><h3>Escalation Contacts</h3></div>
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
      state.selectedDeviceId = button.getAttribute('data-device-id');
      await renderDevices();
    });
  });

  viewContainer.querySelectorAll('[data-ticket-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.selectedTicketId = button.getAttribute('data-ticket-id');
      await renderTickets();
    });
  });
}

async function showPortal(user) {
  if (!roleViews[user?.role]) {
    throw new Error('This account role is not allowed in customer portal.');
  }
  state.user = user;
  state.company = await service.getCompanyById(user.companyId);
  saveSession(user);

  authView.classList.add('hidden');
  portalView.classList.remove('hidden');

  renderUserCard();
  renderAnnouncements();
  renderNav();

  const hashView = location.hash.replace('#', '');
  setView(hashView || findView('dashboard').key, false);
}

async function restoreSession() {
  const session = loadSession();
  if (!session || session.role === 'tech') return false;

  const profile = await service.getUserById(session.id || session.uid);
  if (!profile) {
    clearSession();
    return false;
  }

  await showPortal(profile);
  return true;
}

function bindGlobalActions() {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      const user = await service.login(formData.get('email'), formData.get('password'), { techOnly: false });
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
    clearSession();
    location.href = '/';
  });

  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  window.addEventListener('hashchange', () => {
    const hashView = location.hash.replace('#', '');
    if (!hashView || hashView === state.currentView) return;
    setView(hashView, false);
  });
}

async function init() {
  await service.init();

  setupInstallGuide({
    appName: 'MARGA Service Portal',
    tagline: 'Corporate customer access for support, devices, and billing.',
    appIcon: '/public/assets/icons/icon-192.svg',
    storagePrefix: 'msp-portal',
    installHelpUrl: '/install/?target=portal'
  });

  setupPwa({
    installButton: installBtn,
    onConnectivityChange: (isOnline) => {
      syncBadge.textContent = isOnline ? 'Online' : 'Offline';
      syncBadge.className = `status-badge ${isOnline ? 'neutral' : 'warn'}`;
    }
  });

  if (service.usingDemo) {
    setTopMessage('Demo mode active. Try admin@acme-demo.com / demo1234.', 'info');
  }

  bindGlobalActions();
  const restored = await restoreSession();
  if (!restored) {
    authView.classList.remove('hidden');
    portalView.classList.add('hidden');
  }
}

init().catch((error) => {
  console.error(error);
  setTopMessage(`Startup error: ${error.message}`, 'error');
});
