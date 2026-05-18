import { hashSignerPin } from './pin-security.js';

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
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
    companyId: device.companyId == null ? null : Number(device.companyId),
    branchId: device.branchId == null ? null : Number(device.branchId),
    model: device.model || device.description || '-',
    serial: device.serial || '-',
    location: device.location || device.branchName || '',
    status: device.status || 'Active',
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
    address: branch.address || ''
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

  async login(email, password, { techOnly = false } = {}) {
    if (techOnly) throw new Error('Technician portal login is not available on Margabase yet.');
    const payload = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email, username: email, password })
    });
    return payload.user;
  }

  async logout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
  }

  async getUserById() {
    const payload = await api('/me');
    return payload.user;
  }

  async listBranches(user) {
    const payload = await api('/branches');
    return (payload.branches || []).map(normalizeBranch);
  }

  async getBranchById(branchId) {
    const branches = await this.listBranches();
    return branches.find((branch) => String(branch.id) === String(branchId)) || null;
  }

  async getCompanyById(companyId) {
    const payload = await api(`/company?companyId=${encodeURIComponent(companyId || '')}`);
    return normalizeCompany(payload.company);
  }

  async listDevices(user, { deviceId } = {}) {
    const payload = await api('/devices');
    const devices = (payload.devices || []).map(normalizeDevice);
    return deviceId ? devices.filter((device) => String(device.id) === String(deviceId)) : devices;
  }

  async getDeviceById(deviceId) {
    const devices = await this.listDevices(null, { deviceId });
    return devices[0] || null;
  }

  async listTickets() {
    const payload = await api('/tickets');
    return payload.tickets || [];
  }

  async getTicketById(ticketId) {
    const tickets = await this.listTickets();
    return tickets.find((ticket) => String(ticket.id) === String(ticketId)) || null;
  }

  async listTonerRequests() {
    const payload = await api('/toner-requests');
    return payload.tonerRequests || [];
  }

  async listInvoices() {
    const payload = await api('/invoices');
    return payload.invoices || [];
  }

  async listPayments() {
    const payload = await api('/payments');
    return payload.payments || [];
  }

  async listAuthorizedSigners() {
    const payload = await api('/signers');
    const signers = payload.signers || [];
    signers.forEach((signer) => this.cachedSigners.set(String(signer.id), signer));
    return signers;
  }

  async getSignerById(_user, signerId) {
    if (this.cachedSigners.has(String(signerId))) return this.cachedSigners.get(String(signerId));
    const signers = await this.listAuthorizedSigners();
    return signers.find((signer) => String(signer.id) === String(signerId)) || null;
  }

  async createTicket(user, payload) {
    const response = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.ticket;
  }

  async createTonerRequest(user, payload) {
    const response = await api('/toner-requests', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.tonerRequest;
  }

  async updateTicket(_user, ticketId, patch) {
    return { id: ticketId, ...patch };
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
    const payload = await api('/summary');
    return payload.summary;
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
}
