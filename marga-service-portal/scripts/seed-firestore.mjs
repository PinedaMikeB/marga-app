#!/usr/bin/env node
import crypto from 'node:crypto';
import admin from 'firebase-admin';

/**
 * Usage:
 * 1) export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json
 * 2) npm i firebase-admin
 * 3) node scripts/seed-firestore.mjs
 */

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is required.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
});

const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

function hashSignerPin(signerId, pin) {
  return crypto.createHash('sha256').update(`${signerId}:${pin}`).digest('hex');
}

async function ensureAuthUser({ email, password, displayName }) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    return admin.auth().createUser({ email, password, displayName });
  }
}

async function upsertDoc(collectionName, id, data) {
  await db.collection(collectionName).doc(id).set(data, { merge: true });
}

async function run() {
  console.log('Seeding Firestore for Marga Service Portal...');

  const companyId = 'comp_marga_demo';
  const branchHq = 'branch_makati_hq';
  const branchCebu = 'branch_cebu';

  const authUsers = {
    corporate: await ensureAuthUser({
      email: 'corporate.admin@marga-demo.com',
      password: process.env.MSP_ADMIN_PASSWORD || 'Marga!2026',
      displayName: 'Corporate Admin'
    }),
    manager: await ensureAuthUser({
      email: 'branch.manager@marga-demo.com',
      password: process.env.MSP_MANAGER_PASSWORD || 'Marga!2026',
      displayName: 'Branch Manager'
    }),
    endUser: await ensureAuthUser({
      email: 'end.user@marga-demo.com',
      password: process.env.MSP_ENDUSER_PASSWORD || 'Marga!2026',
      displayName: 'End User'
    }),
    tech: await ensureAuthUser({
      email: 'tech.user@marga-demo.com',
      password: process.env.MSP_TECH_PASSWORD || 'Marga!2026',
      displayName: 'Field Technician'
    })
  };

  await upsertDoc('companies', companyId, {
    id: companyId,
    name: 'Marga Demo Corporate',
    status: 'active'
  });

  await upsertDoc('branches', branchHq, {
    id: branchHq,
    companyId,
    name: 'Makati HQ',
    address: 'Ayala Avenue, Makati City'
  });

  await upsertDoc('branches', branchCebu, {
    id: branchCebu,
    companyId,
    name: 'Cebu Operations',
    address: 'IT Park, Cebu City'
  });

  await upsertDoc('users', authUsers.corporate.uid, {
    id: authUsers.corporate.uid,
    companyId,
    branchId: null,
    role: 'corporate_admin',
    name: 'Corporate Admin',
    email: authUsers.corporate.email,
    phone: '+63 917 300 0001',
    createdAt: now,
    lastLogin: null
  });

  await upsertDoc('users', authUsers.manager.uid, {
    id: authUsers.manager.uid,
    companyId,
    branchId: branchHq,
    role: 'branch_manager',
    name: 'Branch Manager',
    email: authUsers.manager.email,
    phone: '+63 917 300 0002',
    createdAt: now,
    lastLogin: null
  });

  await upsertDoc('users', authUsers.endUser.uid, {
    id: authUsers.endUser.uid,
    companyId,
    branchId: branchHq,
    role: 'end_user',
    name: 'End User',
    email: authUsers.endUser.email,
    phone: '+63 917 300 0003',
    createdAt: now,
    lastLogin: null
  });

  await upsertDoc('users', authUsers.tech.uid, {
    id: authUsers.tech.uid,
    companyId: 'marga_internal',
    branchId: null,
    role: 'tech',
    name: 'Field Technician',
    email: authUsers.tech.email,
    phone: '+63 917 300 0004',
    createdAt: now,
    lastLogin: null
  });

  const device1 = 'device_makati_ricoh_1';
  const device2 = 'device_cebu_hp_1';

  await upsertDoc('devices', device1, {
    id: device1,
    companyId,
    branchId: branchHq,
    model: 'Ricoh IM C3000',
    serial: 'RC3000-MKT-01',
    location: 'Finance Department',
    contractStart: '2026-01-01',
    contractEnd: '2029-01-01',
    status: 'Active',
    notes: 'Managed under annual service contract',
    createdAt: now,
    updatedAt: now
  });

  await upsertDoc('devices', device2, {
    id: device2,
    companyId,
    branchId: branchCebu,
    model: 'HP LaserJet E52645',
    serial: 'HP52645-CEB-01',
    location: 'Operations Cluster',
    contractStart: '2026-01-01',
    contractEnd: '2029-01-01',
    status: 'Active',
    notes: '',
    createdAt: now,
    updatedAt: now
  });

  const signer1 = 'signer_makati_1';
  const signer2 = 'signer_cebu_1';

  await upsertDoc('authorized_signers', signer1, {
    id: signer1,
    companyId,
    branchId: branchHq,
    name: 'Maria Santos',
    email: 'maria.santos@marga-demo.com',
    phone: '+63 917 900 1101',
    pinHash: hashSignerPin(signer1, process.env.MSP_SIGNER1_PIN || '1234'),
    pinLastResetAt: now,
    active: true,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: now
  });

  await upsertDoc('authorized_signers', signer2, {
    id: signer2,
    companyId,
    branchId: branchCebu,
    name: 'Jasper Lim',
    email: 'jasper.lim@marga-demo.com',
    phone: '+63 917 900 1102',
    pinHash: hashSignerPin(signer2, process.env.MSP_SIGNER2_PIN || '6789'),
    pinLastResetAt: now,
    active: true,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: now
  });

  await upsertDoc('tickets', 'ticket_seed_1', {
    id: 'ticket_seed_1',
    ticketNo: 'TKT-20260220-101',
    companyId,
    branchId: branchHq,
    deviceId: device1,
    requesterUserId: authUsers.endUser.uid,
    category: 'Print Quality',
    description: 'Horizontal streaks during print jobs.',
    priority: 'High',
    status: 'Open',
    createdAt: now,
    updatedAt: now,
    assignedTechId: null,
    scheduledAt: null,
    attachments: [],
    workNotes: [],
    completion: null
  });

  await upsertDoc('toner_requests', 'toner_seed_1', {
    id: 'toner_seed_1',
    companyId,
    branchId: branchHq,
    deviceId: device1,
    requesterUserId: authUsers.endUser.uid,
    status: 'Pending',
    createdAt: now,
    updatedAt: now,
    notes: 'Black toner requested for month-end print run'
  });

  await upsertDoc('invoices', 'invoice_seed_1', {
    id: 'invoice_seed_1',
    companyId,
    branchId: null,
    period: '2026-02',
    amount: 98500,
    dueDate: '2026-03-15',
    status: 'Unpaid',
    pdfUrl: '',
    createdAt: now
  });

  await upsertDoc('payments', 'payment_seed_1', {
    id: 'payment_seed_1',
    invoiceId: 'invoice_seed_1',
    companyId,
    branchId: branchHq,
    amount: 20000,
    date: '2026-02-18',
    method: 'Bank Transfer',
    referenceNo: 'BTR-20260218-001'
  });

  console.log('Seed complete.');
  console.log('Portal login: corporate.admin@marga-demo.com /', process.env.MSP_ADMIN_PASSWORD || 'Marga!2026');
  console.log('Tech login: tech.user@marga-demo.com /', process.env.MSP_TECH_PASSWORD || 'Marga!2026');
  console.log('Signer sample PINs: signer_makati_1 =', process.env.MSP_SIGNER1_PIN || '1234', ', signer_cebu_1 =', process.env.MSP_SIGNER2_PIN || '6789');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
