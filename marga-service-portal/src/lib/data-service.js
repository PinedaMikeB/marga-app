import { hashSignerPin } from './pin-security.js';
import { loadAuthToken } from './session.js';

async function api(path, options = {}) {
  const token = loadAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`/portal-api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || `Portal API failed (${response.status}).`);
  }
  return payload;
}

function normalizeDevice(device) {
  return {
    id: String(device.id),
    legacyId: device.legacyId == null ? null : Number(device.legacyId),
    companyId: device.companyId == null ? null : Number(device.companyId),
    branchId: device.branchId == null ? null : Number(device.branchId),
    model: device.model || device.description || '-',
    serial: device.serial || '-',
    location: device.location || device.branchName || '',
    status: device.status || 'Active',
    fleetStatus: device.fleetStatus || device.status || 'Active',
    attentionReason: device.attentionReason || '',
    attentionReasons: Array.isArray(device.attentionReasons) ? device.attentionReasons : [],
    machineStatusLabel: device.machineStatusLabel || '',
    graphStatusId: device.graphStatusId == null ? null : Number(device.graphStatusId),
    contractStart: device.contractStart || '',
    contractEnd: device.contractEnd || '',
    notes: device.notes || ''
  };
}

function normalizeBranch(branch) {
  return {
    id: Number(branch.id),
    companyId: branch.companyId == null ? null : Number(branch.companyId),
    name: branch.name || '-',
    address: branch.address || '',
    contactPerson: branch.contactPerson || '',
    contactNumber: branch.contactNumber || '',
    email: branch.email || '',
    city: branch.city || '',
    deviceCount: Number(branch.deviceCount || 0),
    serialNumbers: branch.serialNumbers || ''
  };
}

function normalizeCompany(company) {
  if (!company) return null;
  return {
    id: company.id,
    name: company.name || 'Marga Customer',
    status: company.inactive ? 'inactive' : 'active',
    announcements: company.announcements || []
  };
}

function normalizePreviewAccount(account) {
  return {
    id: Number(account.id),
    companyIds: Array.isArray(account.companyIds)
      ? account.companyIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [],
    legacyId: account.legacyId == null ? null : String(account.legacyId),
    name: account.name || 'Marga Customer',
    motherName: account.motherName || account.name || 'Marga Customer',
    groupLabel: account.groupLabel || '',
    type: account.type || 'company',
    branchCount: Number(account.branchCount || 0),
    machineCount: Number(account.machineCount || 0),
    companyMatchCount: Number(account.companyMatchCount || 0),
    matchSource: account.matchSource || 'company',
    note: account.note || ''
  };
}

function isInternalPortalUser(user) {
  return user?.role === 'marga_admin' || user?.role === 'marga_staff';
}

export class DataService {
  constructor() {
    this.cachedSigners = new Map();
  }

  async init() {
    return undefined;
  }

  get usingDemo() {
    return false;
  }

  async login(identifier, password, { techOnly = false } = {}) {
    if (techOnly) throw new Error('Technician portal login is not available on Margabase yet.');
    const payload = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, username: identifier, password })
    });
    return payload.user;
  }

  async previewLogin(previewToken) {
    const payload = await api('/preview-login', {
      method: 'POST',
      body: JSON.stringify({ token: previewToken })
    });
    return payload;
  }

  async logout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
  }

  async getUserById() {
    const payload = await api('/me');
    return payload.user;
  }

  queryWithCompany(path, user) {
    const params = new URLSearchParams();
    // For internal preview users, scope to preview company
    if (isInternalPortalUser(user) && user?.previewCompanyId) {
      params.set('companyId', user.previewCompanyId);
      if (Array.isArray(user?.previewCompanyIds) && user.previewCompanyIds.length) {
        params.set('companyIds', user.previewCompanyIds.join(','));
      }
      if (user?.previewBranchId) params.set('branchId', user.previewBranchId);
    } else if (!isInternalPortalUser(user)) {
      // Always pass activeCompanyId from global state so group switcher filters data
      // null = show all groups combined; number = filter to that company only
      const s = window.__margaCareState;
      const activeId = s?.activeCompanyId;
      if (activeId != null) params.set('activeCompanyId', String(activeId));
    }
    const qs = params.toString();
    if (!qs) return path;
    const joiner = path.includes('?') ? '&' : '?';
    return `${path}${joiner}${qs}`;
  }

  async listCompanies() {
    const payload = await api('/companies');
    return payload.companies || [];
  }

  async searchPreviewAccounts(query) {
    const payload = await api(`/admin/care/customer-search?q=${encodeURIComponent(query || '')}`);
    return (payload.accounts || []).map(normalizePreviewAccount);
  }

  async listPreviewBranches(companyIdOrIds) {
    const params = new URLSearchParams();
    if (Array.isArray(companyIdOrIds)) {
      const companyIds = companyIdOrIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (companyIds.length) {
        params.set('companyIds', companyIds.join(','));
        params.set('companyId', String(companyIds[0]));
      }
    } else if (companyIdOrIds) {
      params.set('companyId', String(companyIdOrIds));
    }
    const payload = await api(`/branches?${params.toString()}`);
    return (payload.branches || []).map(normalizeBranch);
  }

  async getPreviewBranchDetail({ companyId, branchId, companyIds = [] }) {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', String(companyId));
    if (branchId) params.set('branchId', String(branchId));
    if (Array.isArray(companyIds) && companyIds.length) params.set('companyIds', companyIds.join(','));
    const payload = await api(`/admin/care/branch-detail?${params.toString()}`);
    return payload.detail || null;
  }

  async createPreviewLaunch(body) {
    return api('/admin/care/preview-launch', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async getCareCompany(companyId) {
    const payload = await api(`/admin/care/companies/${encodeURIComponent(companyId)}`);
    return payload.company || null;
  }

  async listBranches(user) {
    const payload = await api(this.queryWithCompany('/branches', user));
    return (payload.branches || []).map(normalizeBranch);
  }

  async getBranchById(branchId) {
    const branches = await this.listBranches();
    return branches.find((branch) => String(branch.id) === String(branchId)) || null;
  }

  async getCompanyById(companyId, user = null) {
    const requestedCompanyId = companyId || (isInternalPortalUser(user) ? user?.previewCompanyId : '');
    const payload = await api(`/company?companyId=${encodeURIComponent(requestedCompanyId || '')}`);
    return normalizeCompany(payload.company);
  }

  async listDevices(user, { deviceId } = {}) {
    const payload = await api(this.queryWithCompany('/devices', user));
    const devices = (payload.devices || []).map(normalizeDevice);
    return deviceId ? devices.filter((device) => String(device.id) === String(deviceId)) : devices;
  }

  async getDeviceById(deviceId) {
    const devices = await this.listDevices(null, { deviceId });
    return devices[0] || null;
  }

  async getDeviceDetail(user, deviceId) {
    const path = this.queryWithCompany(`/device-detail?deviceId=${encodeURIComponent(deviceId || '')}`, user);
    const payload = await api(path);
    return payload.detail || null;
  }

  async listTickets() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/tickets', user));
    return payload.tickets || [];
  }

  async getTicketById(ticketId) {
    const tickets = await this.listTickets();
    return tickets.find((ticket) => String(ticket.id) === String(ticketId)) || null;
  }

  // Full ticket detail: computed customer-facing status + timeline + messages.
  // Falls back to the list-derived ticket (e.g. synthetic legacy schedule rows,
  // which have no dedicated detail row) if the detail endpoint 404s.
  async getTicketDetail(user, ticketId) {
    if (String(ticketId).startsWith('schedule:')) return this.getTicketById(ticketId);
    try {
      const payload = await api(this.queryWithCompany(`/tickets/${encodeURIComponent(ticketId)}`, user));
      return payload.ticket || null;
    } catch (error) {
      return this.getTicketById(ticketId);
    }
  }

  async sendTicketMessage(_user, ticketId, body, photoFile = null) {
    if (photoFile && photoFile.size > 0) {
      const form = new FormData();
      form.append('body', body || '');
      form.append('attachment', photoFile);
      const token = loadAuthToken();
      const response = await fetch(`/portal-api/tickets/${encodeURIComponent(ticketId)}/messages`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || `Message failed (${response.status}).`);
      return data.message;
    }
    const response = await api(`/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    return response.message;
  }

  async listTonerRequests() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/toner-requests', user));
    return payload.tonerRequests || [];
  }

  async listInvoices() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/invoices', user));
    return payload.invoices || [];
  }

  async listPayments() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/payments', user));
    return payload.payments || [];
  }

  async listAuthorizedSigners() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/signers', user));
    const signers = payload.signers || [];
    signers.forEach((signer) => this.cachedSigners.set(String(signer.id), signer));
    return signers;
  }

  async getSignerById(_user, signerId) {
    if (this.cachedSigners.has(String(signerId))) return this.cachedSigners.get(String(signerId));
    const signers = await this.listAuthorizedSigners();
    return signers.find((signer) => String(signer.id) === String(signerId)) || null;
  }

  async createTicket(user, payload, photoFile = null) {
    if (photoFile && photoFile.size > 0) {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value != null) form.append(key, String(value));
      });
      form.append('attachment', photoFile);
      const token = loadAuthToken();
      const response = await fetch('/portal-api/tickets', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || `Ticket submit failed (${response.status}).`);
      return data.ticket;
    }
    const response = await api('/tickets', { method: 'POST', body: JSON.stringify(payload) });
    return response.ticket;
  }

  async createTonerRequest(user, payload, photoFile = null) {
    if (photoFile && photoFile.size > 0) {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value != null) form.append(key, String(value));
      });
      form.append('attachment', photoFile);
      const token = loadAuthToken();
      const response = await fetch('/portal-api/toner-requests', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || `Toner request failed (${response.status}).`);
      return data.tonerRequest;
    }
    const response = await api('/toner-requests', { method: 'POST', body: JSON.stringify(payload) });
    return response.tonerRequest;
  }

  async updateTicket(_user, ticketId, patch) {
    return { id: ticketId, ...patch };
  }

  // ── Internal-only (marga_admin / marga_staff): assignment, status transitions, GPS ──
  // Used by the field-staff (tech) app. Backed by /portal-api/admin/tickets/:id/*.
  async assignTicketToMe(user, ticketId) {
    const response = await api(`/admin/tickets/${encodeURIComponent(ticketId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ staffId: user?.id, staffName: user?.name })
    });
    return response.ticket;
  }

  async updateTicketStatus(_user, ticketId, payload) {
    const response = await api(`/admin/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.ticket;
  }

  async pingTicketLocation(_user, ticketId, { latitude, longitude }) {
    return api(`/admin/tickets/${encodeURIComponent(ticketId)}/location`, {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude })
    });
  }

  async upsertBranch(_user, payload) {
    throw new Error('Branch management is read-only in the Margabase portal for now.');
  }

  async upsertDevice(_user, payload) {
    throw new Error('Device management is read-only in the Margabase portal for now.');
  }

  async upsertSigner(_user, payload) {
    throw new Error('Signer management is read-only in the Margabase portal for now.');
  }

  async resetSignerPin(user, signerId, plainPin) {
    return { id: signerId, pinHash: await hashSignerPin(signerId, plainPin) };
  }

  async verifySignerPin({ signerId, enteredPin }) {
    const signer = await this.getSignerById(null, signerId);
    return { signer, pinHash: await hashSignerPin(signerId, enteredPin) };
  }

  async verifySignerHashOfflineCapable({ signerId, pinHash }) {
    return { id: signerId, pinHash };
  }

  async completeTicket({ ticket, resolutionNotes }) {
    return { ...ticket, status: 'Completed', completion: { resolutionNotes } };
  }

  async assignTicketToTech(_techUser, ticketId) {
    return { id: ticketId, status: 'Assigned' };
  }

  async addTechWorkNote(_techUser, ticketId, note) {
    return { id: ticketId, workNote: note };
  }

  async getDashboardSummary() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/summary', user));
    return payload.summary;
  }

  async getServiceHistory() {
    const user = arguments[0];
    const payload = await api(this.queryWithCompany('/service-history', user));
    return {
      byBranch: payload.byBranch || {},
      recentEvents: payload.recentEvents || [],
      summary: payload.summary || null
    };
  }

  async getBranchTicketReport() {
    const branches = await this.listBranches();
    const tickets = await this.listTickets();
    return branches.map((branch) => {
      const branchTickets = tickets.filter((ticket) => String(ticket.branchId) === String(branch.id));
      return {
        branch: branch.name,
        open: branchTickets.filter((ticket) => String(ticket.status || '').toLowerCase() === 'open').length,
        inProgress: branchTickets.filter((ticket) => String(ticket.status || '').toLowerCase().includes('progress')).length,
        completed: branchTickets.filter((ticket) => String(ticket.status || '').toLowerCase().includes('complete')).length
      };
    });
  }

  // ── Rating & staff methods ──────────────────────────
  async rateTicket(user, ticketId, rating, comment = '') {
    return api('/rate-ticket', {
      method: 'POST',
      body: JSON.stringify({ ticketId, rating, comment })
    });
  }

  async getOpenScheduleCount(user) {
    const techId = user?.techId || user?.id;
    if (!techId) return { openCount: 0 };
    const payload = await api(`/staff/open-schedules?techId=${encodeURIComponent(techId)}`);
    return payload;
  }

  async acknowledgeSchedules(user, openCount) {
    const techId = user?.techId || user?.id;
    return api('/staff/acknowledge', {
      method: 'POST',
      body: JSON.stringify({ techId, openCount })
    });
  }

  async getStaffRatings(techId) {
    const q = techId ? `?techId=${encodeURIComponent(techId)}` : '';
    const payload = await api(`/staff/ratings${q}`);
    return payload.ratings || [];
  }
}
