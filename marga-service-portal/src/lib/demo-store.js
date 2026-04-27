import { generateTicketNo, nowIso, uid } from './utils.js';

const STORAGE_KEY = 'msp_demo_db_v1';

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function seed() {
  const now = nowIso();
  return {
    companies: [
      {
        id: 'comp_demo_1',
        name: 'Acme Holdings Inc.',
        status: 'active',
        support: {
          callNumber: '+63-2-8555-0134',
          email: 'support@acme-demo.com',
          whatsappUrl: 'https://wa.me/639171234567',
          viberUrl: 'viber://chat?number=%2B639171234567'
        },
        announcements: [
          'Acme maintenance window every Saturday 8:00 PM.',
          'Escalate critical downtime through hotline for immediate dispatch.'
        ],
        escalationContacts: [
          { title: 'Service Desk', value: '+63-2-8555-0134' },
          { title: 'Account Manager', value: 'accounts@acme-demo.com' },
          { title: 'Billing Team', value: 'billing@acme-demo.com' }
        ]
      }
    ],
    branches: [
      { id: 'branch_demo_hq', companyId: 'comp_demo_1', name: 'Makati HQ', address: 'Ayala Avenue, Makati City' },
      { id: 'branch_demo_cebu', companyId: 'comp_demo_1', name: 'Cebu Branch', address: 'IT Park, Cebu City' }
    ],
    users: [
      {
        id: 'user_demo_admin',
        uid: 'user_demo_admin',
        companyId: 'comp_demo_1',
        branchId: null,
        role: 'corporate_admin',
        name: 'Demo Corporate Admin',
        email: 'admin@acme-demo.com',
        password: 'demo1234',
        phone: '+63 917 000 1001',
        createdAt: now,
        lastLogin: null
      },
      {
        id: 'user_demo_manager',
        uid: 'user_demo_manager',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        role: 'branch_manager',
        name: 'Demo Branch Manager',
        email: 'manager@acme-demo.com',
        password: 'demo1234',
        phone: '+63 917 000 1002',
        createdAt: now,
        lastLogin: null
      },
      {
        id: 'user_demo_end',
        uid: 'user_demo_end',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        role: 'end_user',
        name: 'Demo End User',
        email: 'user@acme-demo.com',
        password: 'demo1234',
        phone: '+63 917 000 1003',
        createdAt: now,
        lastLogin: null
      },
      {
        id: 'user_demo_tech',
        uid: 'user_demo_tech',
        companyId: 'marga_internal',
        branchId: null,
        role: 'tech',
        name: 'Demo Technician',
        email: 'tech@marga-demo.com',
        password: 'demo1234',
        phone: '+63 917 000 2001',
        createdAt: now,
        lastLogin: null
      }
    ],
    devices: [
      {
        id: 'dev_demo_1',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        model: 'Ricoh IM C3000',
        serial: 'RC3000-001',
        location: 'Finance Floor 5',
        contractStart: '2025-01-01',
        contractEnd: '2028-01-01',
        status: 'Active',
        notes: 'Managed print contract'
      },
      {
        id: 'dev_demo_2',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_cebu',
        model: 'HP LaserJet MFP E52645',
        serial: 'HP52645-019',
        location: 'Operations Bay',
        contractStart: '2025-02-01',
        contractEnd: '2028-02-01',
        status: 'Active',
        notes: ''
      }
    ],
    tickets: [
      {
        id: 'tkt_demo_1',
        ticketNo: 'TKT-20260115-101',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        deviceId: 'dev_demo_1',
        requesterUserId: 'user_demo_end',
        category: 'Paper Jam',
        description: 'Paper jam in tray 2 after 20 pages.',
        priority: 'High',
        status: 'In Progress',
        createdAt: '2026-01-15T03:00:00.000Z',
        updatedAt: '2026-01-15T05:00:00.000Z',
        assignedTechId: 'user_demo_tech',
        scheduledAt: '2026-01-15T06:30:00.000Z',
        attachments: [],
        workNotes: ['Checked feeder rollers; temporary fix applied.'],
        completion: null
      },
      {
        id: 'tkt_demo_2',
        ticketNo: 'TKT-20260110-205',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        deviceId: 'dev_demo_1',
        requesterUserId: 'user_demo_end',
        category: 'Print Quality',
        description: 'Printout has streaks on left side.',
        priority: 'Medium',
        status: 'Completed',
        createdAt: '2026-01-10T01:00:00.000Z',
        updatedAt: '2026-01-10T07:30:00.000Z',
        assignedTechId: 'user_demo_tech',
        scheduledAt: '2026-01-10T03:00:00.000Z',
        attachments: [],
        workNotes: ['Replaced drum unit and calibrated colors.'],
        completion: {
          completedAt: '2026-01-10T07:15:00.000Z',
          completedByTechId: 'user_demo_tech',
          acknowledgedByUserId: 'sign_demo_1',
          acknowledgedByName: 'Maria Santos',
          ackMethod: 'PIN',
          ackSignatureUrl: '',
          ackPhotoUrl: '',
          resolutionNotes: 'Issue resolved after part replacement.',
          followUpNeeded: false,
          followUpNotes: ''
        }
      }
    ],
    toner_requests: [
      {
        id: 'toner_demo_1',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        deviceId: 'dev_demo_1',
        requesterUserId: 'user_demo_end',
        status: 'Pending',
        createdAt: '2026-01-17T02:00:00.000Z',
        updatedAt: '2026-01-17T02:00:00.000Z',
        notes: 'Black toner low warning'
      }
    ],
    invoices: [
      {
        id: 'inv_demo_1',
        companyId: 'comp_demo_1',
        branchId: null,
        period: '2026-01',
        amount: 85420,
        dueDate: '2026-02-15',
        status: 'Unpaid',
        pdfUrl: '#',
        createdAt: '2026-01-31T00:00:00.000Z'
      },
      {
        id: 'inv_demo_2',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        period: '2026-01',
        amount: 24100,
        dueDate: '2026-02-15',
        status: 'Paid',
        pdfUrl: '#',
        createdAt: '2026-01-31T00:00:00.000Z'
      }
    ],
    payments: [
      {
        id: 'pay_demo_1',
        invoiceId: 'inv_demo_2',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        amount: 24100,
        date: '2026-02-01',
        method: 'Bank Transfer',
        referenceNo: 'BTR-998731'
      }
    ],
    authorized_signers: [
      {
        id: 'sign_demo_1',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        name: 'Maria Santos',
        email: 'maria.santos@acme-demo.com',
        phone: '+63 917 000 1101',
        pinHash: 'bf2b1768b4981cc1e207e9c26393f9dad56ed1d38f10626fd1ab06c792971348',
        pinLastResetAt: '2026-01-05T00:00:00.000Z',
        active: true,
        failedAttempts: 0,
        lockedUntil: null
      },
      {
        id: 'sign_demo_2',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_hq',
        name: 'Paolo Reyes',
        email: 'paolo.reyes@acme-demo.com',
        phone: '+63 917 000 1102',
        pinHash: '7f43afa843630a4639ea0ad6ff25b241a21b661744f923e0b1efab17423ba730',
        pinLastResetAt: '2026-01-05T00:00:00.000Z',
        active: true,
        failedAttempts: 0,
        lockedUntil: null
      },
      {
        id: 'sign_demo_3',
        companyId: 'comp_demo_1',
        branchId: 'branch_demo_cebu',
        name: 'Jasper Lim',
        email: 'jasper.lim@acme-demo.com',
        phone: '+63 917 000 1103',
        pinHash: '2f07b4afc131c2a85b2170ac9c52c79200405b4f524e070100776eb9e37ad0be',
        pinLastResetAt: '2026-01-05T00:00:00.000Z',
        active: true,
        failedAttempts: 0,
        lockedUntil: null
      }
    ],
    pin_attempt_logs: []
  };
}

function userCanAccessTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'tech') return true;
  if (user.role === 'corporate_admin') return user.companyId === ticket.companyId;
  if (user.role === 'branch_manager') return user.companyId === ticket.companyId && user.branchId === ticket.branchId;
  if (user.role === 'end_user') return user.id === ticket.requesterUserId;
  return false;
}

function userCanAccessBranch(user, companyId, branchId) {
  if (!user) return false;
  if (user.role === 'tech') return true;
  if (user.role === 'corporate_admin') return user.companyId === companyId;
  return user.companyId === companyId && user.branchId === branchId;
}

export class DemoStore {
  constructor() {
    this.db = this.#load();
  }

  #load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn('Demo DB parse failed, reseeding', error);
      }
    }
    const seeded = seed();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  #save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
  }

  #findById(collection, id) {
    return this.db[collection].find((entry) => entry.id === id) || null;
  }

  async login(email, password, { techOnly = false } = {}) {
    const user = this.db.users.find((entry) => entry.email.toLowerCase() === String(email || '').toLowerCase());
    if (!user || user.password !== password) {
      throw new Error('Invalid credentials. Demo password is demo1234.');
    }
    if (techOnly && user.role !== 'tech') {
      throw new Error('This account is not a technician profile.');
    }
    if (!techOnly && user.role === 'tech') {
      throw new Error('Technician account should login at /tech.');
    }
    user.lastLogin = nowIso();
    this.#save();
    return clone(user);
  }

  async logout() {
    return true;
  }

  async getUserById(id) {
    return clone(this.#findById('users', id));
  }

  async listBranches(user) {
    if (user.role === 'corporate_admin') {
      return clone(this.db.branches.filter((branch) => branch.companyId === user.companyId));
    }
    if (user.branchId) {
      return clone(this.db.branches.filter((branch) => branch.id === user.branchId));
    }
    return [];
  }

  async listDevices(user, filters = {}) {
    const { deviceId } = filters;
    const devices = this.db.devices.filter((device) => {
      if (deviceId && device.id !== deviceId) return false;
      if (user.role === 'tech') return true;
      if (user.role === 'corporate_admin') return device.companyId === user.companyId;
      return device.companyId === user.companyId && device.branchId === user.branchId;
    });
    return clone(devices);
  }

  async listTickets(user, filters = {}) {
    const { status, deviceId, mode } = filters;
    const tickets = this.db.tickets.filter((ticket) => {
      if (status && String(ticket.status).toLowerCase() !== String(status).toLowerCase()) return false;
      if (deviceId && ticket.deviceId !== deviceId) return false;
      if (user.role === 'tech') {
        if (mode === 'assigned') return ticket.assignedTechId === user.id;
        if (mode === 'unassigned') return !ticket.assignedTechId && ticket.status !== 'Completed';
        if (mode === 'completed') return String(ticket.status).toLowerCase() === 'completed';
        if (mode === 'all') return String(ticket.status).toLowerCase() !== 'cancelled';
        return ticket.assignedTechId === user.id;
      }
      return userCanAccessTicket(user, ticket);
    });
    tickets.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return clone(tickets);
  }

  async listTonerRequests(user) {
    return clone(
      this.db.toner_requests.filter((request) => {
        if (user.role === 'corporate_admin') return request.companyId === user.companyId;
        if (user.role === 'branch_manager') return request.companyId === user.companyId && request.branchId === user.branchId;
        if (user.role === 'end_user') return request.requesterUserId === user.id;
        return false;
      })
    );
  }

  async listInvoices(user) {
    return clone(
      this.db.invoices.filter((invoice) => {
        if (user.role === 'corporate_admin') return invoice.companyId === user.companyId;
        if (user.role === 'branch_manager') {
          return invoice.companyId === user.companyId && (invoice.branchId === user.branchId || invoice.branchId === null);
        }
        return false;
      })
    );
  }

  async listPayments(user) {
    const invoices = await this.listInvoices(user);
    const allowedInvoiceIds = new Set(invoices.map((invoice) => invoice.id));
    return clone(this.db.payments.filter((payment) => allowedInvoiceIds.has(payment.invoiceId)));
  }

  async listAuthorizedSigners(user, { branchId, companyId } = {}) {
    return clone(
      this.db.authorized_signers.filter((signer) => {
        const branchMatch = branchId ? signer.branchId === branchId : true;
        const companyMatch = companyId ? signer.companyId === companyId : true;
        if (!branchMatch || !companyMatch) return false;
        if (user.role === 'tech') return signer.active;
        if (user.role === 'corporate_admin') return signer.companyId === user.companyId;
        if (user.role === 'branch_manager') return signer.companyId === user.companyId && signer.branchId === user.branchId;
        return false;
      })
    );
  }

  async createTicket(user, payload) {
    if (!userCanAccessBranch(user, payload.companyId, payload.branchId)) {
      throw new Error('Not allowed to create ticket for this branch.');
    }
    const ticket = {
      id: uid('tkt'),
      ticketNo: generateTicketNo(),
      companyId: payload.companyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
      requesterUserId: user.id,
      category: payload.category,
      description: payload.description,
      priority: payload.priority,
      status: 'Open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      assignedTechId: null,
      scheduledAt: null,
      attachments: payload.attachments || [],
      workNotes: [],
      completion: null
    };
    this.db.tickets.push(ticket);
    this.#save();
    return clone(ticket);
  }

  async updateTicket(user, ticketId, patch) {
    const ticket = this.#findById('tickets', ticketId);
    if (!ticket) throw new Error('Ticket not found.');

    if (user.role === 'tech') {
      if (patch.status) ticket.status = patch.status;
      if (patch.assignedTechId !== undefined) ticket.assignedTechId = patch.assignedTechId;
      if (patch.workNote) {
        ticket.workNotes = ticket.workNotes || [];
        ticket.workNotes.unshift(String(patch.workNote));
      }
      if (patch.completion) {
        ticket.completion = clone(patch.completion);
        ticket.status = patch.status || 'Completed';
      }
      ticket.updatedAt = nowIso();
      this.#save();
      return clone(ticket);
    }

    if (!userCanAccessTicket(user, ticket)) throw new Error('Not allowed to update this ticket.');

    ['status', 'priority', 'description'].forEach((key) => {
      if (patch[key] !== undefined) ticket[key] = patch[key];
    });
    ticket.updatedAt = nowIso();
    this.#save();
    return clone(ticket);
  }

  async createTonerRequest(user, payload) {
    if (user.role === 'tech') throw new Error('Tech account cannot request toner.');
    if (!userCanAccessBranch(user, payload.companyId, payload.branchId)) {
      throw new Error('Not allowed to request toner for this branch.');
    }
    const request = {
      id: uid('toner'),
      companyId: payload.companyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
      requesterUserId: user.id,
      status: 'Pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      notes: payload.notes || ''
    };
    this.db.toner_requests.push(request);
    this.#save();
    return clone(request);
  }

  async upsertBranch(user, payload) {
    if (user.role !== 'corporate_admin') throw new Error('Only corporate_admin can manage branches.');
    if (!payload.id) {
      payload.id = uid('branch');
      this.db.branches.push(clone(payload));
    } else {
      const branch = this.#findById('branches', payload.id);
      if (!branch) throw new Error('Branch not found.');
      Object.assign(branch, payload);
    }
    this.#save();
    return clone(payload);
  }

  async upsertDevice(user, payload) {
    if (user.role !== 'corporate_admin') {
      throw new Error('Not allowed to manage devices.');
    }
    if (!payload.id) {
      payload.id = uid('device');
      this.db.devices.push(clone(payload));
    } else {
      const device = this.#findById('devices', payload.id);
      if (!device) throw new Error('Device not found.');
      Object.assign(device, payload);
    }
    this.#save();
    return clone(payload);
  }

  async upsertSigner(user, payload) {
    if (user.role !== 'corporate_admin') throw new Error('Only corporate_admin can manage signers.');
    if (!payload.id) {
      payload.id = uid('signer');
      payload.failedAttempts = 0;
      payload.lockedUntil = null;
      this.db.authorized_signers.push(clone(payload));
    } else {
      const signer = this.#findById('authorized_signers', payload.id);
      if (!signer) throw new Error('Signer not found.');
      Object.assign(signer, payload);
    }
    this.#save();
    return clone(payload);
  }

  async recordFailedPinAttempt({ signerId, techUserId, ticketId, companyId, branchId }) {
    const signer = this.#findById('authorized_signers', signerId);
    if (!signer) throw new Error('Signer not found.');

    const now = Date.now();
    const lockedUntilMs = signer.lockedUntil ? new Date(signer.lockedUntil).getTime() : 0;
    if (lockedUntilMs > now) {
      return {
        locked: true,
        lockedUntil: signer.lockedUntil,
        failedAttempts: signer.failedAttempts || 0
      };
    }

    signer.failedAttempts = Number(signer.failedAttempts || 0) + 1;
    if (signer.failedAttempts >= 5) {
      signer.lockedUntil = new Date(now + 10 * 60 * 1000).toISOString();
      signer.failedAttempts = 0;
    }

    this.db.pin_attempt_logs.push({
      id: uid('pinlog'),
      signerId,
      techUserId,
      ticketId,
      companyId,
      branchId,
      success: false,
      at: nowIso()
    });
    this.#save();

    return {
      locked: Boolean(signer.lockedUntil && new Date(signer.lockedUntil).getTime() > now),
      lockedUntil: signer.lockedUntil,
      failedAttempts: signer.failedAttempts || 0
    };
  }

  async recordSuccessfulPinAttempt({ signerId, techUserId, ticketId, companyId, branchId }) {
    const signer = this.#findById('authorized_signers', signerId);
    if (!signer) return;
    signer.failedAttempts = 0;
    signer.lockedUntil = null;
    this.db.pin_attempt_logs.push({
      id: uid('pinlog'),
      signerId,
      techUserId,
      ticketId,
      companyId,
      branchId,
      success: true,
      at: nowIso()
    });
    this.#save();
  }

  async getSignerById(signerId) {
    return clone(this.#findById('authorized_signers', signerId));
  }

  async getBranchById(branchId) {
    return clone(this.#findById('branches', branchId));
  }

  async getCompanyById(companyId) {
    return clone(this.#findById('companies', companyId));
  }

  async getDeviceById(deviceId) {
    return clone(this.#findById('devices', deviceId));
  }

  async getTicketById(ticketId) {
    return clone(this.#findById('tickets', ticketId));
  }

  async summaryForUser(user) {
    const [devices, tickets, toner, invoices] = await Promise.all([
      this.listDevices(user),
      this.listTickets(user),
      this.listTonerRequests(user),
      this.listInvoices(user)
    ]);

    const openTickets = tickets.filter((ticket) => String(ticket.status).toLowerCase() !== 'completed').length;
    const pendingToner = toner.filter((request) => String(request.status).toLowerCase() !== 'fulfilled').length;
    const unpaidInvoices = invoices.filter((invoice) => String(invoice.status).toLowerCase() !== 'paid');

    return {
      activeDevices: devices.filter((device) => String(device.status).toLowerCase() === 'active').length,
      openTickets,
      pendingToner,
      unpaidInvoices: unpaidInvoices.length,
      unpaidAmount: unpaidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
    };
  }
}
