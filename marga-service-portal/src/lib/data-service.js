import { getFirebaseContext, isDemoMode, readRuntimeConfig } from '../config/firebase.js';
import { DemoStore } from './demo-store.js';
import { hashSignerPin, lockStatus } from './pin-security.js';
import { generateTicketNo, nowIso, uid, withoutUndefined } from './utils.js';

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeDoc(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

function ensureRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw new Error('You do not have permission for this action.');
  }
}

export class DataService {
  constructor() {
    this.config = readRuntimeConfig();
    this.demoMode = isDemoMode(this.config);
    this.demo = this.demoMode ? new DemoStore() : null;
    this.firebase = null;
    this.cachedSigners = new Map();
  }

  async init() {
    if (this.demoMode) return;
    this.firebase = await getFirebaseContext(this.config);
  }

  get usingDemo() {
    return this.demoMode;
  }

  async login(email, password, { techOnly = false } = {}) {
    if (this.demoMode) {
      return this.demo.login(email, password, { techOnly });
    }

    const { authPkg } = this.firebase;
    const credential = await authPkg.signInWithEmailAndPassword(this.firebase.auth, email, password);
    const profile = await this.getUserById(credential.user.uid);

    if (!profile) {
      await authPkg.signOut(this.firebase.auth);
      throw new Error('No user profile found. Create users/{uid} first.');
    }
    if (techOnly && profile.role !== 'tech') {
      await authPkg.signOut(this.firebase.auth);
      throw new Error('This account is not assigned as technician.');
    }
    if (!techOnly && profile.role === 'tech') {
      await authPkg.signOut(this.firebase.auth);
      throw new Error('Technician account should login at /tech.');
    }

    await this.touchLastLogin(profile.id);
    return profile;
  }

  async logout() {
    if (this.demoMode) {
      await this.demo.logout();
      return;
    }
    const { authPkg } = this.firebase;
    await authPkg.signOut(this.firebase.auth);
  }

  async getUserById(userId) {
    if (!userId) return null;
    if (this.demoMode) return this.demo.getUserById(userId);

    const { fsPkg, db } = this.firebase;
    const userRef = fsPkg.doc(db, 'users', userId);
    const snapshot = await fsPkg.getDoc(userRef);
    if (!snapshot.exists()) return null;
    return normalizeDoc(snapshot);
  }

  async touchLastLogin(userId) {
    if (!userId) return;
    if (this.demoMode) return;
    const { fsPkg, db } = this.firebase;
    const userRef = fsPkg.doc(db, 'users', userId);
    await fsPkg.updateDoc(userRef, { lastLogin: fsPkg.serverTimestamp() });
  }

  async listBranches(user) {
    if (this.demoMode) return this.demo.listBranches(user);
    const { fsPkg, db } = this.firebase;

    if (user.role === 'corporate_admin') {
      const q = fsPkg.query(
        fsPkg.collection(db, 'branches'),
        fsPkg.where('companyId', '==', user.companyId),
        fsPkg.orderBy('name', 'asc')
      );
      const snapshots = await fsPkg.getDocs(q);
      return snapshots.docs.map(normalizeDoc);
    }

    if (user.branchId) {
      const ref = fsPkg.doc(db, 'branches', user.branchId);
      const snap = await fsPkg.getDoc(ref);
      if (snap.exists()) return [normalizeDoc(snap)];
    }

    return [];
  }

  async getBranchById(branchId) {
    if (!branchId) return null;
    if (this.demoMode) return this.demo.getBranchById(branchId);
    const { fsPkg, db } = this.firebase;
    const snap = await fsPkg.getDoc(fsPkg.doc(db, 'branches', branchId));
    return snap.exists() ? normalizeDoc(snap) : null;
  }

  async getCompanyById(companyId) {
    if (!companyId) return null;
    if (this.demoMode) return this.demo.getCompanyById(companyId);
    const { fsPkg, db } = this.firebase;
    const snap = await fsPkg.getDoc(fsPkg.doc(db, 'companies', companyId));
    return snap.exists() ? normalizeDoc(snap) : null;
  }

  async listDevices(user, { deviceId } = {}) {
    if (this.demoMode) return this.demo.listDevices(user, { deviceId });

    const { fsPkg, db } = this.firebase;
    if (deviceId) {
      const deviceRef = fsPkg.doc(db, 'devices', deviceId);
      const snap = await fsPkg.getDoc(deviceRef);
      return snap.exists() ? [normalizeDoc(snap)] : [];
    }

    const constraints = [];
    if (user.role === 'corporate_admin') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
    } else if (['branch_manager', 'end_user'].includes(user.role)) {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
      constraints.unshift(fsPkg.where('branchId', '==', user.branchId));
    }

    const q = fsPkg.query(fsPkg.collection(db, 'devices'), ...constraints);
    const snapshots = await fsPkg.getDocs(q);
    return snapshots.docs.map(normalizeDoc).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  async getDeviceById(deviceId) {
    if (!deviceId) return null;
    if (this.demoMode) return this.demo.getDeviceById(deviceId);
    const { fsPkg, db } = this.firebase;
    const snap = await fsPkg.getDoc(fsPkg.doc(db, 'devices', deviceId));
    return snap.exists() ? normalizeDoc(snap) : null;
  }

  async listTickets(user, { status, deviceId, mode } = {}) {
    if (this.demoMode) return this.demo.listTickets(user, { status, deviceId, mode });

    const { fsPkg, db } = this.firebase;
    const constraints = [fsPkg.orderBy('updatedAt', 'desc')];

    if (user.role === 'corporate_admin') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
    } else if (user.role === 'branch_manager') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
      constraints.unshift(fsPkg.where('branchId', '==', user.branchId));
    } else if (user.role === 'end_user') {
      constraints.unshift(fsPkg.where('requesterUserId', '==', user.id));
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
    } else if (user.role === 'tech') {
      if (mode === 'assigned') {
        constraints.unshift(fsPkg.where('assignedTechId', '==', user.id));
      } else if (mode === 'unassigned') {
        constraints.unshift(fsPkg.where('assignedTechId', '==', null));
      } else if (mode === 'completed') {
        constraints.unshift(fsPkg.where('status', '==', 'Completed'));
      }
    }

    if (status) constraints.unshift(fsPkg.where('status', '==', status));
    if (deviceId) constraints.unshift(fsPkg.where('deviceId', '==', deviceId));

    const q = fsPkg.query(fsPkg.collection(db, 'tickets'), ...constraints);
    const snapshots = await fsPkg.getDocs(q);
    let tickets = snapshots.docs.map(normalizeDoc);

    if (user.role === 'tech' && mode === 'all') {
      tickets = tickets.filter((ticket) => String(ticket.status || '').toLowerCase() !== 'cancelled');
    }
    return tickets;
  }

  async getTicketById(ticketId) {
    if (!ticketId) return null;
    if (this.demoMode) return this.demo.getTicketById(ticketId);
    const { fsPkg, db } = this.firebase;
    const snap = await fsPkg.getDoc(fsPkg.doc(db, 'tickets', ticketId));
    return snap.exists() ? normalizeDoc(snap) : null;
  }

  async listTonerRequests(user) {
    if (this.demoMode) return this.demo.listTonerRequests(user);
    const { fsPkg, db } = this.firebase;
    const constraints = [fsPkg.orderBy('updatedAt', 'desc')];

    if (user.role === 'corporate_admin') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
    } else if (user.role === 'branch_manager') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
      constraints.unshift(fsPkg.where('branchId', '==', user.branchId));
    } else if (user.role === 'end_user') {
      constraints.unshift(fsPkg.where('requesterUserId', '==', user.id));
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
    } else {
      return [];
    }

    const snapshots = await fsPkg.getDocs(fsPkg.query(fsPkg.collection(db, 'toner_requests'), ...constraints));
    return snapshots.docs.map(normalizeDoc);
  }

  async listInvoices(user) {
    if (this.demoMode) return this.demo.listInvoices(user);
    if (user.role === 'end_user' || user.role === 'tech') return [];

    const { fsPkg, db } = this.firebase;
    const constraints = [
      fsPkg.where('companyId', '==', user.companyId),
      fsPkg.orderBy('dueDate', 'desc')
    ];

    const snapshots = await fsPkg.getDocs(fsPkg.query(fsPkg.collection(db, 'invoices'), ...constraints));
    const invoices = snapshots.docs.map(normalizeDoc);
    if (user.role === 'branch_manager') {
      return invoices.filter((invoice) => invoice.branchId === user.branchId || invoice.branchId == null);
    }
    return invoices;
  }

  async listPayments(user) {
    if (this.demoMode) return this.demo.listPayments(user);
    if (user.role === 'end_user' || user.role === 'tech') return [];

    const invoices = await this.listInvoices(user);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    if (!invoiceIds.length) return [];

    const { fsPkg, db } = this.firebase;
    const chunks = [];
    for (let i = 0; i < invoiceIds.length; i += 10) chunks.push(invoiceIds.slice(i, i + 10));

    const results = await Promise.all(
      chunks.map((ids) =>
        fsPkg.getDocs(
          fsPkg.query(fsPkg.collection(db, 'payments'), fsPkg.where('invoiceId', 'in', ids), fsPkg.orderBy('date', 'desc'))
        )
      )
    );

    return results.flatMap((snapshot) => snapshot.docs.map(normalizeDoc));
  }

  async listAuthorizedSigners(user, { branchId, companyId } = {}) {
    if (this.demoMode) {
      const data = await this.demo.listAuthorizedSigners(user, { branchId, companyId });
      data.forEach((signer) => this.cachedSigners.set(signer.id, signer));
      return data;
    }

    const { fsPkg, db } = this.firebase;
    const constraints = [fsPkg.orderBy('name', 'asc')];

    if (user.role === 'corporate_admin') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
      if (branchId) constraints.unshift(fsPkg.where('branchId', '==', branchId));
    } else if (user.role === 'branch_manager') {
      constraints.unshift(fsPkg.where('companyId', '==', user.companyId));
      constraints.unshift(fsPkg.where('branchId', '==', user.branchId));
    } else if (user.role === 'tech') {
      if (!branchId || !companyId) return [];
      constraints.unshift(fsPkg.where('companyId', '==', companyId));
      constraints.unshift(fsPkg.where('branchId', '==', branchId));
      constraints.unshift(fsPkg.where('active', '==', true));
    } else {
      return [];
    }

    const snapshots = await fsPkg.getDocs(fsPkg.query(fsPkg.collection(db, 'authorized_signers'), ...constraints));
    const signers = snapshots.docs.map(normalizeDoc);
    signers.forEach((signer) => this.cachedSigners.set(signer.id, signer));
    return signers;
  }

  async getSignerById(user, signerId) {
    if (this.demoMode) return this.demo.getSignerById(signerId);
    const cached = this.cachedSigners.get(signerId);
    if (cached && user?.role === 'tech') return cached;

    const { fsPkg, db } = this.firebase;
    const snap = await fsPkg.getDoc(fsPkg.doc(db, 'authorized_signers', signerId));
    if (!snap.exists()) return null;
    const signer = normalizeDoc(snap);
    this.cachedSigners.set(signer.id, signer);
    return signer;
  }

  async createTicket(user, payload, attachmentFile) {
    if (this.demoMode) {
      const attachmentUrls = attachmentFile ? ['demo://attachment/local-photo.jpg'] : [];
      return this.demo.createTicket(user, { ...payload, attachments: attachmentUrls });
    }

    ensureRole(user, ['corporate_admin', 'branch_manager', 'end_user']);

    const { fsPkg, db } = this.firebase;
    const ticketRef = fsPkg.doc(fsPkg.collection(db, 'tickets'));
    const ticketId = ticketRef.id;

    let attachments = [];
    if (attachmentFile) {
      const url = await this.uploadTicketAttachment({
        companyId: payload.companyId,
        branchId: payload.branchId,
        ticketId,
        file: attachmentFile
      });
      attachments = [url];
    }

    const docData = {
      id: ticketId,
      ticketNo: generateTicketNo(),
      companyId: payload.companyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
      requesterUserId: user.id,
      category: payload.category,
      description: payload.description,
      priority: payload.priority,
      status: 'Open',
      createdAt: fsPkg.serverTimestamp(),
      updatedAt: fsPkg.serverTimestamp(),
      assignedTechId: null,
      scheduledAt: null,
      attachments,
      workNotes: [],
      completion: null
    };

    await fsPkg.setDoc(ticketRef, docData);
    const snap = await fsPkg.getDoc(ticketRef);
    return normalizeDoc(snap);
  }

  async createTonerRequest(user, payload) {
    if (this.demoMode) return this.demo.createTonerRequest(user, payload);
    ensureRole(user, ['corporate_admin', 'branch_manager', 'end_user']);

    const { fsPkg, db } = this.firebase;
    const requestRef = fsPkg.doc(fsPkg.collection(db, 'toner_requests'));
    const docData = {
      id: requestRef.id,
      companyId: payload.companyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
      requesterUserId: user.id,
      status: 'Pending',
      createdAt: fsPkg.serverTimestamp(),
      updatedAt: fsPkg.serverTimestamp(),
      notes: payload.notes || ''
    };
    await fsPkg.setDoc(requestRef, docData);
    const snap = await fsPkg.getDoc(requestRef);
    return normalizeDoc(snap);
  }

  async updateTicket(user, ticketId, patch) {
    if (this.demoMode) return this.demo.updateTicket(user, ticketId, patch);

    const { fsPkg, db } = this.firebase;
    const ticketRef = fsPkg.doc(db, 'tickets', ticketId);
    const updatePayload = { ...patch, updatedAt: fsPkg.serverTimestamp() };
    if (updatePayload.workNote) {
      updatePayload.workNotes = fsPkg.arrayUnion(updatePayload.workNote);
      delete updatePayload.workNote;
    }
    delete updatePayload.id;
    await fsPkg.updateDoc(ticketRef, withoutUndefined(updatePayload));
    const snap = await fsPkg.getDoc(ticketRef);
    return normalizeDoc(snap);
  }

  async upsertBranch(user, payload) {
    if (this.demoMode) return this.demo.upsertBranch(user, payload);
    ensureRole(user, ['corporate_admin']);

    const { fsPkg, db } = this.firebase;
    const branchId = payload.id || uid('branch');
    const ref = fsPkg.doc(db, 'branches', branchId);
    await fsPkg.setDoc(ref, { ...payload, id: branchId }, { merge: true });
    const snap = await fsPkg.getDoc(ref);
    return normalizeDoc(snap);
  }

  async upsertDevice(user, payload) {
    if (this.demoMode) return this.demo.upsertDevice(user, payload);
    ensureRole(user, ['corporate_admin']);

    const { fsPkg, db } = this.firebase;
    const deviceId = payload.id || uid('device');
    const ref = fsPkg.doc(db, 'devices', deviceId);
    await fsPkg.setDoc(
      ref,
      {
        ...payload,
        id: deviceId,
        createdAt: payload.createdAt || fsPkg.serverTimestamp(),
        updatedAt: fsPkg.serverTimestamp()
      },
      { merge: true }
    );
    const snap = await fsPkg.getDoc(ref);
    return normalizeDoc(snap);
  }

  async upsertSigner(user, payload) {
    if (this.demoMode) return this.demo.upsertSigner(user, payload);
    ensureRole(user, ['corporate_admin']);

    const { fsPkg, db } = this.firebase;
    const signerId = payload.id || uid('signer');
    const ref = fsPkg.doc(db, 'authorized_signers', signerId);

    const signerPayload = {
      id: signerId,
      companyId: payload.companyId,
      branchId: payload.branchId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      active: payload.active !== false,
      pinHash: payload.pinHash,
      pinLastResetAt: payload.pinLastResetAt || fsPkg.serverTimestamp(),
      failedAttempts: payload.failedAttempts ?? 0,
      lockedUntil: payload.lockedUntil || null,
      updatedAt: fsPkg.serverTimestamp()
    };

    await fsPkg.setDoc(ref, withoutUndefined(signerPayload), { merge: true });
    const snap = await fsPkg.getDoc(ref);
    const signer = normalizeDoc(snap);
    this.cachedSigners.set(signer.id, signer);
    return signer;
  }

  async resetSignerPin(user, signerId, plainPin) {
    ensureRole(user, ['corporate_admin']);
    const pinHash = await hashSignerPin(signerId, plainPin);
    if (this.demoMode) {
      return this.demo.upsertSigner(user, { id: signerId, pinHash, pinLastResetAt: nowIso(), failedAttempts: 0, lockedUntil: null });
    }

    const { fsPkg, db } = this.firebase;
    const ref = fsPkg.doc(db, 'authorized_signers', signerId);
    await fsPkg.updateDoc(ref, {
      pinHash,
      pinLastResetAt: fsPkg.serverTimestamp(),
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: fsPkg.serverTimestamp()
    });
    const snap = await fsPkg.getDoc(ref);
    const signer = normalizeDoc(snap);
    this.cachedSigners.set(signer.id, signer);
    return signer;
  }

  async verifySignerPin({ signerId, enteredPin, techUser, ticket }) {
    const computedHash = await hashSignerPin(signerId, enteredPin);

    if (this.demoMode) {
      const signer = await this.demo.getSignerById(signerId);
      if (!signer || !signer.active) throw new Error('Signer is not active.');

      const lock = lockStatus(signer.lockedUntil);
      if (lock.locked) {
        throw new Error(`PIN locked. Try again in ${lock.remainingSeconds}s.`);
      }

      if (signer.pinHash !== computedHash) {
        const fail = await this.demo.recordFailedPinAttempt({
          signerId,
          techUserId: techUser.id,
          ticketId: ticket.id,
          companyId: ticket.companyId,
          branchId: ticket.branchId
        });
        if (fail.locked) {
          throw new Error('Too many failed attempts. PIN entry locked for 10 minutes.');
        }
        throw new Error('Invalid PIN.');
      }

      await this.demo.recordSuccessfulPinAttempt({
        signerId,
        techUserId: techUser.id,
        ticketId: ticket.id,
        companyId: ticket.companyId,
        branchId: ticket.branchId
      });
      return { signer, pinHash: computedHash };
    }

    const { fsPkg, db } = this.firebase;
    const signerRef = fsPkg.doc(db, 'authorized_signers', signerId);
    const attemptRef = fsPkg.doc(fsPkg.collection(db, 'authorized_signers', signerId, 'pin_attempts'));

    const result = await fsPkg.runTransaction(db, async (transaction) => {
      const signerSnap = await transaction.get(signerRef);
      if (!signerSnap.exists()) {
        throw new Error('Signer record not found.');
      }
      const signer = normalizeDoc(signerSnap);

      if (!signer.active) {
        throw new Error('Signer is not active.');
      }
      if (signer.companyId !== ticket.companyId || signer.branchId !== ticket.branchId) {
        throw new Error('Signer does not belong to this branch.');
      }

      const lock = lockStatus(signer.lockedUntil);
      if (lock.locked) {
        throw new Error(`PIN locked. Try again in ${lock.remainingSeconds}s.`);
      }

      const success = signer.pinHash === computedHash;
      const attemptPayload = {
        id: attemptRef.id,
        signerId,
        ticketId: ticket.id,
        companyId: ticket.companyId,
        branchId: ticket.branchId,
        techUserId: techUser.id,
        success,
        createdAt: fsPkg.serverTimestamp()
      };

      if (!success) {
        const failedAttempts = Number(signer.failedAttempts || 0) + 1;
        const shouldLock = failedAttempts >= 5;
        const lockDate = shouldLock ? new Date(Date.now() + 10 * 60 * 1000) : null;

        transaction.update(signerRef, {
          failedAttempts: shouldLock ? 0 : failedAttempts,
          lockedUntil: lockDate,
          lastFailedAttemptAt: fsPkg.serverTimestamp(),
          updatedAt: fsPkg.serverTimestamp()
        });
        transaction.set(attemptRef, attemptPayload);

        return {
          ok: false,
          signer,
          locked: shouldLock
        };
      }

      transaction.update(signerRef, {
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: fsPkg.serverTimestamp()
      });
      transaction.set(attemptRef, attemptPayload);
      return { ok: true, signer };
    });

    if (!result.ok) {
      if (result.locked) throw new Error('Too many failed attempts. PIN entry locked for 10 minutes.');
      throw new Error('Invalid PIN.');
    }

    this.cachedSigners.set(result.signer.id, result.signer);
    return { signer: result.signer, pinHash: computedHash };
  }

  async verifySignerHashOfflineCapable({ signerId, pinHash, ticket }) {
    if (this.demoMode) {
      const signer = await this.demo.getSignerById(signerId);
      if (!signer || signer.pinHash !== pinHash) throw new Error('Signer verification failed during sync.');
      return signer;
    }

    const signer = this.cachedSigners.get(signerId) || (await this.getSignerById({ role: 'tech' }, signerId));
    if (!signer) throw new Error('Signer cache unavailable. Reconnect before completion.');
    if (signer.companyId !== ticket.companyId || signer.branchId !== ticket.branchId) {
      throw new Error('Signer scope mismatch.');
    }
    if (signer.pinHash !== pinHash) {
      throw new Error('PIN hash mismatch.');
    }
    const lock = lockStatus(signer.lockedUntil);
    if (lock.locked) throw new Error(`PIN locked. Try again in ${lock.remainingSeconds}s.`);
    return signer;
  }

  async completeTicket({
    techUser,
    ticket,
    signer,
    pinHash,
    resolutionNotes,
    followUpNeeded,
    followUpNotes,
    signatureDataUrl,
    photoFile,
    photoDataUrl,
    workNote
  }) {
    const status = followUpNeeded ? 'Pending Follow Up' : 'Completed';

    let ackSignatureUrl = '';
    let ackPhotoUrl = '';

    if (!this.demoMode) {
      if (signatureDataUrl) {
        ackSignatureUrl = await this.uploadDataUrl({
          folder: 'ticket_completion_signatures',
          companyId: ticket.companyId,
          branchId: ticket.branchId,
          ticketId: ticket.id,
          dataUrl: signatureDataUrl,
          extension: 'png'
        });
      }
      if (photoFile) {
        ackPhotoUrl = await this.uploadTicketCompletionPhoto({
          companyId: ticket.companyId,
          branchId: ticket.branchId,
          ticketId: ticket.id,
          file: photoFile
        });
      } else if (photoDataUrl) {
        ackPhotoUrl = await this.uploadDataUrl({
          folder: 'ticket_completion_photos',
          companyId: ticket.companyId,
          branchId: ticket.branchId,
          ticketId: ticket.id,
          dataUrl: photoDataUrl,
          extension: 'jpg'
        });
      }
    } else {
      if (signatureDataUrl) ackSignatureUrl = 'demo://signature/captured.png';
      if (photoFile || photoDataUrl) ackPhotoUrl = 'demo://photo/captured.jpg';
    }

    const completionPayload = {
      completedAt: this.demoMode ? nowIso() : this.firebase.fsPkg.serverTimestamp(),
      completedByTechId: techUser.id,
      acknowledgedByUserId: signer.id,
      acknowledgedByName: signer.name,
      ackMethod: 'PIN',
      ackPinHash: pinHash,
      ackSignatureUrl,
      ackPhotoUrl,
      resolutionNotes,
      followUpNeeded,
      followUpNotes: followUpNeeded ? followUpNotes : ''
    };

    const updatePatch = {
      status,
      assignedTechId: techUser.id,
      completion: completionPayload,
      updatedAt: this.demoMode ? nowIso() : this.firebase.fsPkg.serverTimestamp()
    };

    if (workNote) {
      if (this.demoMode) {
        updatePatch.workNote = workNote;
      } else {
        updatePatch.workNotes = this.firebase.fsPkg.arrayUnion(workNote);
      }
    }

    return this.updateTicket(techUser, ticket.id, updatePatch);
  }

  async assignTicketToTech(techUser, ticketId) {
    return this.updateTicket(techUser, ticketId, {
      status: 'Assigned',
      assignedTechId: techUser.id
    });
  }

  async addTechWorkNote(techUser, ticketId, note) {
    const patch = this.demoMode
      ? { workNote: note }
      : { workNotes: this.firebase.fsPkg.arrayUnion(note), status: 'In Progress' };
    return this.updateTicket(techUser, ticketId, patch);
  }

  async getDashboardSummary(user) {
    if (this.demoMode) return this.demo.summaryForUser(user);

    const [devices, tickets, toner, invoices] = await Promise.all([
      this.listDevices(user),
      this.listTickets(user),
      this.listTonerRequests(user),
      this.listInvoices(user)
    ]);

    const openTickets = tickets.filter((ticket) => String(ticket.status || '').toLowerCase() !== 'completed').length;
    const pendingToner = toner.filter((request) => String(request.status || '').toLowerCase() !== 'fulfilled').length;
    const unpaidInvoices = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');

    return {
      activeDevices: devices.filter((device) => String(device.status || '').toLowerCase() === 'active').length,
      openTickets,
      pendingToner,
      unpaidInvoices: unpaidInvoices.length,
      unpaidAmount: unpaidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
    };
  }

  async getBranchTicketReport(user) {
    ensureRole(user, ['corporate_admin']);
    const [branches, tickets] = await Promise.all([this.listBranches(user), this.listTickets(user)]);

    const map = new Map(branches.map((branch) => [branch.id, { branch: branch.name, open: 0, inProgress: 0, completed: 0 }]));
    tickets.forEach((ticket) => {
      const row = map.get(ticket.branchId);
      if (!row) return;
      const status = String(ticket.status || '').toLowerCase();
      if (status.includes('complete')) row.completed += 1;
      else if (status.includes('progress') || status.includes('assign') || status.includes('pending')) row.inProgress += 1;
      else row.open += 1;
    });

    return [...map.values()];
  }

  async uploadTicketAttachment({ companyId, branchId, ticketId, file }) {
    return this.uploadFile({
      folder: 'ticket_attachments',
      companyId,
      branchId,
      ticketId,
      file
    });
  }

  async uploadTicketCompletionPhoto({ companyId, branchId, ticketId, file }) {
    return this.uploadFile({
      folder: 'ticket_completion_photos',
      companyId,
      branchId,
      ticketId,
      file
    });
  }

  async uploadFile({ folder, companyId, branchId, ticketId, file }) {
    const { storagePkg, storage } = this.firebase;
    const safeName = String(file.name || `file-${Date.now()}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
    const path = `${folder}/${companyId}/${branchId}/${ticketId}/${Date.now()}-${safeName}`;
    const fileRef = storagePkg.ref(storage, path);
    await storagePkg.uploadBytes(fileRef, file);
    return storagePkg.getDownloadURL(fileRef);
  }

  async uploadDataUrl({ folder, companyId, branchId, ticketId, dataUrl, extension }) {
    const { storagePkg, storage } = this.firebase;
    const path = `${folder}/${companyId}/${branchId}/${ticketId}/${Date.now()}-${uid('capture')}.${extension}`;
    const fileRef = storagePkg.ref(storage, path);
    await storagePkg.uploadString(fileRef, dataUrl, 'data_url');
    return storagePkg.getDownloadURL(fileRef);
  }

  async canQueueCompletionOffline({ signerId, pinHash, ticket }) {
    const signer = this.cachedSigners.get(signerId) || (await this.getSignerById({ role: 'tech' }, signerId));
    if (!signer) throw new Error('Signer data unavailable for offline completion. Open ticket once online to cache signer list.');
    if (signer.companyId !== ticket.companyId || signer.branchId !== ticket.branchId) {
      throw new Error('Signer is not scoped to ticket branch.');
    }
    const lock = lockStatus(signer.lockedUntil);
    if (lock.locked) throw new Error(`Signer PIN is locked for ${lock.remainingSeconds}s.`);
    if (signer.pinHash !== pinHash) {
      throw new Error('PIN invalid.');
    }
    return signer;
  }

  async syncQueuedCompletion(techUser, queueItem) {
    const ticket = await this.getTicketById(queueItem.ticketId);
    if (!ticket) throw new Error('Ticket missing during sync.');

    const signer = await this.verifySignerHashOfflineCapable({
      signerId: queueItem.signerId,
      pinHash: queueItem.pinHash,
      ticket
    });

    await this.completeTicket({
      techUser,
      ticket,
      signer,
      pinHash: queueItem.pinHash,
      resolutionNotes: queueItem.resolutionNotes,
      followUpNeeded: queueItem.followUpNeeded,
      followUpNotes: queueItem.followUpNotes,
      signatureDataUrl: queueItem.signatureDataUrl,
      photoDataUrl: queueItem.photoDataUrl,
      workNote: queueItem.workNote
    });
  }
}
