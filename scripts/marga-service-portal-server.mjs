#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const portalRoot = path.join(repoRoot, 'marga-service-portal');
const port = Number(process.env.MSP_PORT || 9200);
const platformRequire = createRequire('/Volumes/Wotg Drive Mike/GitHub/marga-platform/package.json');
const { Pool } = platformRequire('pg');
const DATABASE_URL = process.env.MARGABASE_DATABASE_URL || 'postgresql://margabase_admin@127.0.0.1:5432/margabase';
const SESSION_SECRET = process.env.MARGA_SESSION_SECRET || 'marga-local-session-secret-change-me';
const pool = new Pool({ connectionString: DATABASE_URL });
const loginAttempts = new Map();

if (process.env.NODE_ENV === 'production' && !process.env.MARGABASE_DATABASE_URL) {
  throw new Error('MARGABASE_DATABASE_URL must be set in production.');
}

if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'marga-local-session-secret-change-me') {
  throw new Error('MARGA_SESSION_SECRET must be set in production.');
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon']
]);

const OFFICE_PERMISSIONS = {
  admin: ['customers', 'billing', 'collections', 'service', 'settings', 'field', 'portal', 'marga-care'],
  billing: ['billing'],
  collection: ['collections'],
  service: ['service', 'field'],
  technician: ['field'],
  messenger: ['field'],
  viewer: []
};

function json(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 500);
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push('Path=/');
  parts.push('SameSite=Lax');
  parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Number(options.maxAge) || 0}`);
  return parts.join('; ');
}

function getCookie(req, name) {
  const cookie = String(req.headers.cookie || '');
  const item = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : '';
}

function rateLimitLogin(req) {
  const key = clientIp(req) || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry.count <= 12;
}

function clearLoginRateLimit(req) {
  const key = clientIp(req) || 'unknown';
  loginAttempts.delete(key);
}

async function auditLog({ userId = null, action, entityType = null, entityId = null, req = null, metadata = {} }) {
  try {
    await pool.query(
      `insert into marga.audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, metadata)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, entityType, entityId, req ? clientIp(req) : null, req ? userAgent(req) : null, metadata]
    );
  } catch (error) {
    console.warn('Audit log write failed', error.message);
  }
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = base64Url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'viewer';
}

function normalizeRoles(value) {
  if (Array.isArray(value)) return [...new Set(value.map(normalizeRole).filter(Boolean))];
  if (typeof value === 'string') return [...new Set(value.split(',').map(normalizeRole).filter(Boolean))];
  return [];
}

function normalizeModules(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

function roleModules(roles) {
  return [...new Set(roles.flatMap((role) => OFFICE_PERMISSIONS[role] || []))];
}

function inferEmployeeRole(user) {
  const positionName = String(user?.position || user?.position_name || user?.position_label || '').toLowerCase();
  const positionId = Number(user?.position_id || 0);
  if (user?.admin === 1 || user?.admin === true || positionName.includes('admin') || positionName.includes('manager')) return 'admin';
  if (positionId === 5 || positionName.includes('technician') || positionName.includes('tech')) return 'technician';
  if (positionId === 9 || positionName.includes('messenger') || positionName.includes('driver')) return 'messenger';
  if (positionName.includes('collection')) return 'collection';
  if (positionName.includes('billing') || positionName.includes('account') || positionName.includes('finance')) return 'billing';
  if (positionName.includes('service') || positionName.includes('csr')) return 'service';
  return 'viewer';
}

function activeEmployee(user) {
  if (!user) return false;
  if (user.marga_active === false || user.marga_account_active === false || user.active === false) return false;
  if (user.marga_active === true || user.marga_account_active === true || user.active === true) return true;
  const estatus = Number(user.estatus);
  if (Number.isFinite(estatus)) return estatus === 1;
  return true;
}

function verifyPassword(user, password) {
  const provided = String(password || '');
  if (user.password_hash && user.password_salt) {
    const iterations = Number(user.password_iterations || 120000);
    const derived = crypto.pbkdf2Sync(provided, Buffer.from(String(user.password_salt), 'base64'), iterations, 32, 'sha256');
    return derived.toString('base64') === String(user.password_hash);
  }
  if (user.password) return String(user.password) === provided;
  return false;
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha256');
  return {
    password_hash: hash.toString('base64'),
    password_salt: salt.toString('base64'),
    password_iterations: iterations
  };
}

function randomSixDigitPassword() {
  return String(crypto.randomInt(100000, 1000000));
}

function isInternalUser(user) {
  return user?.role === 'marga_admin' || user?.role === 'marga_staff';
}

function requireInternalUser(user) {
  if (!isInternalUser(user)) {
    const error = new Error('Marga Care is limited to internal Marga users.');
    error.statusCode = 403;
    throw error;
  }
}

function cleanText(value) {
  return String(value || '').trim();
}

function firstValue(records, keys) {
  for (const record of records) {
    for (const key of keys) {
      const value = cleanText(record?.[key]);
      if (value) return value;
    }
  }
  return '';
}

async function ensurePortalTables() {
  await pool.query(`
    create table if not exists marga.portal_toner_requests (
      id bigserial primary key,
      company_id bigint,
      branch_id bigint,
      machine_id bigint,
      requester_user_id text,
      requester_name text,
      status text not null default 'Pending',
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists marga.portal_service_tickets (
      id bigserial primary key,
      ticket_no text not null unique,
      company_id bigint,
      branch_id bigint,
      machine_id bigint,
      requester_user_id text,
      requester_name text,
      category text not null default 'Service',
      description text not null default '',
      priority text not null default 'Normal',
      status text not null default 'Open',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists marga.portal_accounts (
      id bigserial primary key,
      login text not null unique,
      display_name text not null default '',
      role text not null default 'end_user',
      mobile_user_id text,
      company_id bigint,
      branch_id bigint,
      password_hash text not null,
      password_salt text not null,
      password_iterations integer not null default 120000,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists marga.audit_logs (
      id bigserial primary key,
      user_id text,
      action text not null,
      entity_type text,
      entity_id text,
      ip_address text,
      user_agent text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table if not exists marga.care_company_profiles (
      id bigserial primary key,
      company_id bigint not null unique,
      portal_type text not null default 'mixed',
      representative_name text not null default '',
      representative_email text not null default '',
      representative_phone text not null default '',
      active boolean not null default true,
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists marga.care_account_scopes (
      id bigserial primary key,
      account_id bigint not null references marga.portal_accounts(id) on delete cascade,
      scope_type text not null default 'company',
      company_id bigint,
      branch_id bigint,
      machine_id bigint,
      contractmain_id bigint,
      can_view_billing boolean not null default true,
      can_request_service boolean not null default true,
      can_request_toner boolean not null default true,
      can_manage_branch_credentials boolean not null default false,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table marga.portal_accounts add column if not exists must_change_password boolean not null default false;
    alter table marga.portal_accounts add column if not exists last_password_generated_at timestamptz;
    alter table marga.portal_accounts add column if not exists last_credentials_sent_at timestamptz;
    alter table marga.portal_accounts add column if not exists credential_delivery_email text;
    create index if not exists care_account_scopes_account_idx on marga.care_account_scopes(account_id);
    create index if not exists care_account_scopes_company_idx on marga.care_account_scopes(company_id);
    create unique index if not exists care_account_scopes_unique_scope_idx
      on marga.care_account_scopes (
        account_id,
        scope_type,
        coalesce(company_id, 0),
        coalesce(branch_id, 0),
        coalesce(machine_id, 0),
        coalesce(contractmain_id, 0)
      );
  `);
}

function employeeSession(user, ident) {
  const roles = normalizeRoles(user.marga_roles || user.roles || user.marga_role || user.role || inferEmployeeRole(user));
  const resolvedRoles = roles.length ? roles : ['viewer'];
  const modules = normalizeModules(user.marga_allowed_modules || user.allowed_modules);
  const resolvedModules = modules.length ? modules : roleModules(resolvedRoles);
  const isAdmin = resolvedRoles.includes('admin') || resolvedModules.includes('settings') || resolvedModules.includes('customers');
  const name = String(user.marga_fullname || user.name || `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.nickname || ident).trim();
  return {
    id: `employee:${user._docId || user.id}`,
    uid: `employee:${user._docId || user.id}`,
    sourceId: String(user._docId || user.id),
    companyId: 'marga_internal',
    branchId: null,
    role: isAdmin ? 'marga_admin' : 'marga_staff',
    roles: resolvedRoles,
    modules: resolvedModules,
    name,
    email: String(user.email || user.marga_login_email || ident || '').trim().toLowerCase(),
    source: 'marga_employee'
  };
}

function portalScopeWhere(user, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (user.role === 'marga_admin' || user.role === 'marga_staff') return { sql: '', params: [] };
  if (user.companyId && user.branchId) return { sql: `and ${prefix}company_id = $1 and ${prefix}branch_id = $2`, params: [user.companyId, user.branchId] };
  if (user.companyId) return { sql: `and ${prefix}company_id = $1`, params: [user.companyId] };
  return { sql: 'and false', params: [] };
}

async function findEmployee(ident) {
  const raw = String(ident || '').trim();
  const lower = raw.toLowerCase();
  const username = lower.split('@')[0];
  const fields = lower.includes('@')
    ? [['email', lower], ['marga_login_email', lower], ['username', username]]
    : [['username', raw], ['marga_username', raw], ['email', lower], ['marga_login_email', lower]];
  for (const [field, value] of fields) {
    const { rows } = await pool.query(
      `select doc_id, data from app_meta.firestore_documents
       where collection = 'tbl_employee' and lower(coalesce(data->>$1, '')) = lower($2)
       limit 10`,
      [field, value]
    );
    const found = rows.map((row) => ({ _docId: row.doc_id, ...row.data })).find(activeEmployee) || null;
    if (found) return found;
  }
  return null;
}

async function findPortalAccount(ident) {
  const login = String(ident || '').trim().toLowerCase();
  if (!login) return null;
  const { rows } = await pool.query(
    `select id, login, display_name, role, mobile_user_id, company_id, branch_id, password_hash, password_salt, password_iterations, active
     from marga.portal_accounts
     where lower(login) = lower($1)
     limit 1`,
    [login]
  );
  return rows[0] || null;
}

function portalAccountSession(account) {
  return {
    id: `portal:${account.id}`,
    uid: `portal:${account.id}`,
    sourceId: String(account.id),
    companyId: account.company_id == null ? null : Number(account.company_id),
    branchId: account.branch_id == null ? null : Number(account.branch_id),
    role: account.role || 'end_user',
    roles: [account.role || 'end_user'],
    modules: ['portal'],
    name: account.display_name || account.login,
    email: account.login,
    source: 'marga_portal_account'
  };
}

async function login(body, req) {
  const ident = String(body.email || body.username || '').trim();
  const password = String(body.password || '');
  if (!ident || !password) return { status: 400, data: { ok: false, message: 'Email and password are required.' } };
  if (!rateLimitLogin(req)) {
    await auditLog({ action: 'login_rate_limited', req, metadata: { ident } });
    return { status: 429, data: { ok: false, message: 'Too many login attempts. Please wait and try again.' } };
  }
  const employee = await findEmployee(ident);
  let user = null;
  if (employee && verifyPassword(employee, password)) {
    user = employeeSession(employee, ident);
  } else {
    const account = await findPortalAccount(ident);
    if (!account || account.active !== true || !verifyPassword(account, password)) {
      await auditLog({ action: 'failed_login', req, metadata: { ident } });
      return { status: 401, data: { ok: false, message: 'Invalid email or password.' } };
    }
    user = portalAccountSession(account);
  }
  const token = signToken({ sub: user.id, user, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 });
  clearLoginRateLimit(req);
  await auditLog({ userId: user.id, action: 'successful_login', req, metadata: { source: user.source } });
  return { status: 200, data: { ok: true, token, user } };
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : getCookie(req, 'msp_session');
  const payload = verifyToken(token);
  return payload?.user || null;
}

async function listCompanies(user) {
  if (user.role !== 'marga_admin' && user.role !== 'marga_staff') {
    const { rows } = await pool.query('select id, legacy_id, name, inactive from marga.companies where id = $1', [user.companyId]);
    return rows;
  }
  const { rows } = await pool.query('select id, legacy_id, name, inactive from marga.companies where inactive is false order by name limit 500');
  return rows;
}

async function getCompany(companyId) {
  if (companyId === 'marga_internal') {
    return { id: 'marga_internal', name: 'Marga Internal', announcements: ['Internal Marga portal view.'] };
  }
  const { rows } = await pool.query('select id, legacy_id, name, inactive from marga.companies where id = $1', [companyId]);
  return rows[0] || null;
}

async function listBranches(user) {
  const scope = portalScopeWhere(user, 'b');
  const { rows } = await pool.query(
    `select b.id, b.legacy_id, b.company_id as "companyId", b.name, b.address, b.inactive
     from marga.branches b
     where b.inactive is false ${scope.sql}
     order by b.name limit 1000`,
    scope.params
  );
  return rows;
}

async function listDevices(user) {
  let scope = { sql: '', params: [] };
  if (user.role !== 'marga_admin' && user.role !== 'marga_staff') {
    if (user.companyId && user.branchId) scope = { sql: 'and m.current_company_id = $1 and m.current_branch_id = $2', params: [user.companyId, user.branchId] };
    else if (user.companyId) scope = { sql: 'and m.current_company_id = $1', params: [user.companyId] };
    else scope = { sql: 'and false', params: [] };
  }
  const { rows } = await pool.query(
    `select m.id, m.legacy_id, m.serial, coalesce(m.source_data->>'description', m.source_data->>'model', m.model_legacy_id, '') as model,
            m.current_company_id as "companyId", m.current_branch_id as "branchId",
            coalesce(b.name, m.current_branch_legacy_id, '') as "branchName",
            coalesce(m.status_id, '') as status,
            coalesce(m.source_data->>'remarks', '') as notes
     from marga.machines m
     left join marga.branches b on b.id = m.current_branch_id
     where coalesce(m.is_client, false) is true ${scope.sql}
     order by m.serial nulls last limit 1000`,
    scope.params
  );
  return rows;
}

async function listTonerRequests(user) {
  const scope = portalScopeWhere(user, 'r');
  const { rows: portalRows } = await pool.query(
    `select r.id::text, r.company_id as "companyId", r.branch_id as "branchId", r.machine_id as "deviceId",
            r.requester_user_id as "requesterUserId", r.status, r.notes, r.created_at as "createdAt", r.updated_at as "updatedAt"
     from marga.portal_toner_requests r
     where true ${scope.sql}
     order by r.updated_at desc limit 250`,
    scope.params
  );
  const rawScope = portalScopeWhere(user, 'b');
  const { rows: historyRows } = await pool.query(
    `select d.doc_id as id,
            b.company_id as "companyId",
            b.id as "branchId",
            m.id as "deviceId",
            'History' as status,
            coalesce(d.data->>'remarks', d.data->>'notes', '') as notes,
            coalesce(d.data->>'tmestamp', d.data->>'date_purchase', d.imported_at::text) as "createdAt",
            coalesce(d.data->>'tmestamp', d.data->>'date_purchase', d.updated_at::text) as "updatedAt"
     from app_meta.firestore_documents d
     left join marga.machines m on m.serial = d.data->>'serial'
     left join marga.branches b on b.id = m.current_branch_id
     where d.collection = 'tbl_newtonerinkhistory' ${rawScope.sql}
     order by d.doc_id desc limit 150`,
    rawScope.params
  );
  return [...portalRows, ...historyRows].slice(0, 250);
}

async function listTickets(user) {
  const scope = portalScopeWhere(user, 't');
  const { rows } = await pool.query(
    `select t.id::text, t.ticket_no as "ticketNo", t.company_id as "companyId", t.branch_id as "branchId",
            t.machine_id as "deviceId", t.requester_user_id as "requesterUserId", t.category,
            t.description, t.priority, t.status, t.created_at as "createdAt", t.updated_at as "updatedAt"
     from marga.portal_service_tickets t
     where true ${scope.sql}
     order by t.updated_at desc limit 250`,
    scope.params
  );
  return rows;
}

async function listInvoices(user) {
  const scope = portalScopeWhere(user, 'i');
  const { rows } = await pool.query(
    `select i.id::text, i.company_id as "companyId", i.branch_id as "branchId", i.invoice_no as "invoiceNo",
            concat(i.billing_year, '-', lpad(i.billing_month::text, 2, '0')) as period,
            i.total_amount as amount, i.invoice_date as "dueDate", coalesce(i.status, 'Unpaid') as status
     from marga.billing_invoices i
     where true ${scope.sql}
     order by i.invoice_date desc nulls last limit 250`,
    scope.params
  );
  return rows;
}

async function listPayments(user) {
  const scope = portalScopeWhere(user, 'i');
  const { rows } = await pool.query(
    `select p.id::text, p.invoice_id::text as "invoiceId", i.company_id as "companyId", i.branch_id as "branchId",
            p.payment_amount as amount, p.payment_date as date, p.or_no as "referenceNo",
            coalesce(p.deduction_type, 'Payment') as method
     from marga.payments p
     left join marga.billing_invoices i on i.id = p.invoice_id
     where true ${scope.sql}
     order by p.payment_date desc nulls last limit 250`,
    scope.params
  );
  return rows;
}

async function listSigners(user) {
  const scope = portalScopeWhere(user, 'b');
  const { rows } = await pool.query(
    `select concat('branch:', b.id) as id, b.company_id as "companyId", b.id as "branchId",
            coalesce(nullif(b.source_data->>'signatory', ''), b.name) as name,
            coalesce(b.source_data->>'email', '') as email,
            coalesce(b.source_data->>'designation', '') as phone,
            true as active
     from marga.branches b
     where b.inactive is false ${scope.sql}
     order by b.name limit 500`,
    scope.params
  );
  return rows;
}

async function createTonerRequest(user, body) {
  const internal = user.role === 'marga_admin' || user.role === 'marga_staff';
  const branchId = internal ? (Number(body.branchId || user.branchId || 0) || null) : (user.branchId || null);
  const companyId = internal ? (Number(body.companyId || user.companyId || 0) || null) : (user.companyId || null);
  const deviceId = Number(body.deviceId || body.machineId || 0) || null;
  const { rows } = await pool.query(
    `insert into marga.portal_toner_requests (company_id, branch_id, machine_id, requester_user_id, requester_name, notes)
     values ($1, $2, $3, $4, $5, $6)
     returning id::text, company_id as "companyId", branch_id as "branchId", machine_id as "deviceId",
       requester_user_id as "requesterUserId", status, notes, created_at as "createdAt", updated_at as "updatedAt"`,
    [companyId, branchId, deviceId, user.id, user.name, String(body.notes || '')]
  );
  await auditLog({ userId: user.id, action: 'ticket_created', entityType: 'portal_toner_request', entityId: rows[0].id, metadata: { branchId, companyId, deviceId } });
  return rows[0];
}

async function createTicket(user, body) {
  const internal = user.role === 'marga_admin' || user.role === 'marga_staff';
  const branchId = internal ? (Number(body.branchId || user.branchId || 0) || null) : (user.branchId || null);
  const companyId = internal ? (Number(body.companyId || user.companyId || 0) || null) : (user.companyId || null);
  const deviceId = Number(body.deviceId || body.machineId || 0) || null;
  const ticketNo = `CARE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;
  const { rows } = await pool.query(
    `insert into marga.portal_service_tickets (ticket_no, company_id, branch_id, machine_id, requester_user_id, requester_name, category, description, priority)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id::text, ticket_no as "ticketNo", company_id as "companyId", branch_id as "branchId",
       machine_id as "deviceId", requester_user_id as "requesterUserId", category, description, priority, status,
       created_at as "createdAt", updated_at as "updatedAt"`,
    [ticketNo, companyId, branchId, deviceId, user.id, user.name, String(body.category || 'Service'), String(body.description || ''), String(body.priority || 'Normal')]
  );
  await auditLog({ userId: user.id, action: 'ticket_created', entityType: 'portal_service_ticket', entityId: rows[0].id, metadata: { branchId, companyId, deviceId } });
  return rows[0];
}

async function summary(user) {
  const [devices, tickets, toner, invoices] = await Promise.all([
    listDevices(user),
    listTickets(user),
    listTonerRequests(user),
    listInvoices(user)
  ]);
  const unpaid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
  return {
    activeDevices: devices.length,
    openTickets: tickets.filter((ticket) => String(ticket.status || '').toLowerCase() !== 'completed').length,
    pendingToner: toner.filter((request) => String(request.status || '').toLowerCase() !== 'fulfilled').length,
    unpaidInvoices: unpaid.length,
    unpaidAmount: unpaid.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
  };
}

function inferPortalType({ activeDevices, activeBranches, directDevices }) {
  if (activeDevices <= 1) return 'single_machine';
  if (activeBranches > 1 && directDevices > 0) return 'mixed';
  if (directDevices > 1 && activeBranches <= 1) return 'individual_only';
  return 'group_only';
}

async function listCareCompanies(user, query = '') {
  requireInternalUser(user);
  const needle = `%${String(query || '').trim()}%`;
  const { rows } = await pool.query(
    `with machine_counts as (
       select current_company_id as company_id,
              count(*) filter (where coalesce(is_client, false) is true) as active_devices,
              count(*) filter (where coalesce(is_client, false) is true and current_branch_id is null) as direct_devices,
              count(distinct current_branch_id) filter (where coalesce(is_client, false) is true and current_branch_id is not null) as active_branches
       from marga.machines
       where current_company_id is not null
       group by current_company_id
     ),
     reps as (
       select distinct on (company_id)
              company_id,
              id as account_id,
              login,
              display_name,
              active,
              last_password_generated_at,
              last_credentials_sent_at,
              credential_delivery_email
       from marga.portal_accounts
       where role in ('company_representative', 'mother_representative', 'end_user')
       order by company_id, case when role in ('company_representative', 'mother_representative') then 0 else 1 end, updated_at desc
     )
     select c.id,
            c.legacy_id,
            c.name,
            coalesce(p.portal_type, '') as portal_type,
            coalesce(p.representative_name, reps.display_name, '') as representative_name,
            coalesce(p.representative_email, reps.login, '') as representative_email,
            coalesce(p.representative_phone, '') as representative_phone,
            coalesce(p.active, true) as care_active,
            coalesce(p.notes, '') as notes,
            coalesce(mc.active_devices, 0)::integer as active_devices,
            coalesce(mc.direct_devices, 0)::integer as direct_devices,
            coalesce(mc.active_branches, 0)::integer as active_branches,
            reps.account_id,
            reps.login as account_login,
            reps.active as account_active,
            reps.last_password_generated_at,
            reps.last_credentials_sent_at,
            reps.credential_delivery_email
     from marga.companies c
     left join marga.care_company_profiles p on p.company_id = c.id
     left join machine_counts mc on mc.company_id = c.id
     left join reps on reps.company_id = c.id
     where c.inactive is false
       and ($1 = '%%' or c.name ilike $1 or c.legacy_id::text ilike $1)
     order by coalesce(mc.active_devices, 0) desc, c.name
     limit 300`,
    [needle]
  );
  return rows.map((row) => {
    const portalType = row.portal_type || inferPortalType(row);
    const individualDevices = portalType === 'individual_only' || portalType === 'single_machine'
      ? row.active_devices
      : row.direct_devices;
    return {
      id: row.id,
      legacyId: row.legacy_id,
      name: row.name,
      portalType,
      representativeName: row.representative_name,
      representativeEmail: row.representative_email,
      representativePhone: row.representative_phone,
      active: row.care_active,
      notes: row.notes,
      activeGroupMachines: Math.max(0, Number(row.active_devices || 0) - Number(individualDevices || 0)),
      activeIndividualMachines: Number(individualDevices || 0),
      activeDevices: Number(row.active_devices || 0),
      activeBranches: Number(row.active_branches || 0),
      representativeAccount: row.account_id ? {
        id: row.account_id,
        login: row.account_login,
        active: row.account_active,
        lastPasswordGeneratedAt: row.last_password_generated_at,
        lastCredentialsSentAt: row.last_credentials_sent_at,
        credentialDeliveryEmail: row.credential_delivery_email
      } : null
    };
  });
}

async function getCareContactDefaults(companyId) {
  const { rows } = await pool.query(
    `select name, source_data
     from marga.branches
     where inactive is false and company_id = $1
     order by name
     limit 250`,
    [companyId]
  );
  const records = rows.map((row) => ({ branch_name: row.name, ...(row.source_data || {}) }));
  return {
    representativeName: firstValue(records, [
      'representative_name', 'rep_name', 'contact_person', 'contactperson', 'contact',
      'signatory', 'end_user', 'enduser', 'endusername', 'attention', 'branch_name'
    ]),
    representativeEmail: firstValue(records, [
      'representative_email', 'email', 'email_address', 'acct_email', 'contact_email',
      'billing_email', 'enduseremail', 'end_user_email'
    ]),
    representativePhone: firstValue(records, [
      'representative_phone', 'phone', 'phone_number', 'mobile', 'mobile_no', 'contact_number',
      'contactno', 'acct_num', 'endusercontactnum', 'tel_no', 'telephone'
    ])
  };
}

async function getCareCompany(user, companyId) {
  requireInternalUser(user);
  const companies = await listCareCompanies(user, '');
  const company = companies.find((item) => String(item.id) === String(companyId));
  if (!company) return null;
  const defaults = await getCareContactDefaults(company.id);
  const { rows: devices } = await pool.query(
    `select m.id,
            m.legacy_id,
            m.serial,
            coalesce(m.source_data->>'description', m.source_data->>'model', m.model_legacy_id, '') as model,
            m.current_branch_id as "branchId",
            coalesce(b.name, '') as "branchName"
     from marga.machines m
     left join marga.branches b on b.id = m.current_branch_id
     where coalesce(m.is_client, false) is true and m.current_company_id = $1
     order by b.name nulls last, m.serial nulls last
     limit 1000`,
    [company.id]
  );
  const { rows: accounts } = await pool.query(
    `select id, login, display_name as "displayName", role, active, company_id as "companyId", branch_id as "branchId",
            must_change_password as "mustChangePassword",
            last_password_generated_at as "lastPasswordGeneratedAt",
            last_credentials_sent_at as "lastCredentialsSentAt",
            credential_delivery_email as "credentialDeliveryEmail",
            created_at as "createdAt", updated_at as "updatedAt"
     from marga.portal_accounts
     where company_id = $1
     order by role, display_name, login`,
    [company.id]
  );
  return { ...company, defaults, devices, accounts };
}

async function saveCareCompanyProfile(user, body, req) {
  requireInternalUser(user);
  const companyId = Number(body.companyId || 0);
  if (!companyId) {
    const error = new Error('Company is required.');
    error.statusCode = 400;
    throw error;
  }
  const { rows } = await pool.query(
    `insert into marga.care_company_profiles (
       company_id, portal_type, representative_name, representative_email, representative_phone, active, notes, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (company_id) do update set
       portal_type = excluded.portal_type,
       representative_name = excluded.representative_name,
       representative_email = excluded.representative_email,
       representative_phone = excluded.representative_phone,
       active = excluded.active,
       notes = excluded.notes,
       updated_at = now()
     returning company_id as "companyId", portal_type as "portalType", representative_name as "representativeName",
       representative_email as "representativeEmail", representative_phone as "representativePhone", active, notes`,
    [
      companyId,
      cleanText(body.portalType || 'mixed') || 'mixed',
      cleanText(body.representativeName),
      cleanText(body.representativeEmail).toLowerCase(),
      cleanText(body.representativePhone),
      body.active !== false,
      cleanText(body.notes)
    ]
  );
  await auditLog({ userId: user.id, action: 'marga_care_profile_saved', entityType: 'company', entityId: String(companyId), req });
  return rows[0];
}

async function upsertRepresentativeAccount(user, body, req) {
  requireInternalUser(user);
  const companyId = Number(body.companyId || 0);
  const email = cleanText(body.email || body.representativeEmail).toLowerCase();
  const name = cleanText(body.name || body.representativeName);
  const phone = cleanText(body.phone || body.representativePhone);
  if (!companyId || !email) {
    const error = new Error('Company and representative email are required.');
    error.statusCode = 400;
    throw error;
  }
  const generate = body.generatePassword !== false;
  const password = generate ? randomSixDigitPassword() : null;
  const hash = passwordHash(password || randomSixDigitPassword());
  const params = generate
    ? [email, name, companyId, hash.password_hash, hash.password_salt, hash.password_iterations, email]
    : [email, name, companyId, email];
  const sql = generate
    ? `insert into marga.portal_accounts (
         login, display_name, role, company_id, password_hash, password_salt, password_iterations,
         active, must_change_password, last_password_generated_at, credential_delivery_email, updated_at
       )
       values ($1, $2, 'company_representative', $3, $4, $5, $6, true, true, now(), $7, now())
       on conflict (login) do update set
         display_name = excluded.display_name,
         role = 'company_representative',
         company_id = excluded.company_id,
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         password_iterations = excluded.password_iterations,
         active = true,
         must_change_password = true,
         last_password_generated_at = now(),
         credential_delivery_email = excluded.credential_delivery_email,
         updated_at = now()
       returning id, login, display_name as "displayName", role, company_id as "companyId",
         active, last_password_generated_at as "lastPasswordGeneratedAt", credential_delivery_email as "credentialDeliveryEmail"`
    : `insert into marga.portal_accounts (
         login, display_name, role, company_id, password_hash, password_salt, password_iterations,
         active, credential_delivery_email, updated_at
       )
       values ($1, $2, 'company_representative', $3, '', '', 120000, true, $4, now())
       on conflict (login) do update set
         display_name = excluded.display_name,
         role = 'company_representative',
         company_id = excluded.company_id,
         active = true,
         credential_delivery_email = excluded.credential_delivery_email,
         updated_at = now()
       returning id, login, display_name as "displayName", role, company_id as "companyId",
         active, last_password_generated_at as "lastPasswordGeneratedAt", credential_delivery_email as "credentialDeliveryEmail"`;
  const { rows } = await pool.query(sql, params);
  const account = rows[0];
  await pool.query(
    `insert into marga.care_account_scopes (account_id, scope_type, company_id, can_view_billing, can_request_service, can_request_toner, can_manage_branch_credentials, active, updated_at)
     values ($1, 'company', $2, true, true, true, true, true, now())
     on conflict do nothing`,
    [account.id, companyId]
  );
  await saveCareCompanyProfile(user, {
    companyId,
    representativeName: name,
    representativeEmail: email,
    representativePhone: phone,
    portalType: body.portalType || 'mixed',
    active: true,
    notes: body.notes || ''
  }, req);
  await auditLog({ userId: user.id, action: 'marga_care_representative_saved', entityType: 'portal_account', entityId: String(account.id), req });
  return { account, password };
}

async function generateAccountPassword(user, accountId, req) {
  requireInternalUser(user);
  const password = randomSixDigitPassword();
  const hash = passwordHash(password);
  const { rows } = await pool.query(
    `update marga.portal_accounts
     set password_hash = $2,
         password_salt = $3,
         password_iterations = $4,
         must_change_password = true,
         last_password_generated_at = now(),
         updated_at = now()
     where id = $1
     returning id, login, display_name as "displayName", role, company_id as "companyId",
       active, last_password_generated_at as "lastPasswordGeneratedAt", credential_delivery_email as "credentialDeliveryEmail"`,
    [Number(accountId), hash.password_hash, hash.password_salt, hash.password_iterations]
  );
  if (!rows[0]) {
    const error = new Error('Portal account not found.');
    error.statusCode = 404;
    throw error;
  }
  await auditLog({ userId: user.id, action: 'marga_care_password_generated', entityType: 'portal_account', entityId: String(accountId), req });
  return { account: rows[0], password };
}

function credentialEmail(account, password = '######') {
  const displayName = account.displayName || account.display_name || account.login || 'Marga Care user';
  const login = account.login || account.email || '';
  return {
    to: account.credentialDeliveryEmail || account.credential_delivery_email || login,
    subject: 'Your Marga Care portal credentials',
    body: [
      `Hi ${displayName},`,
      '',
      'Your Marga Care portal access is ready.',
      '',
      `Portal: https://care.marga.biz`,
      `Email: ${login}`,
      `Temporary password: ${password}`,
      '',
      'Please sign in and change the password before distributing branch access.'
    ].join('\n')
  };
}

async function emailCredentialPreview(user, accountId, body, req) {
  requireInternalUser(user);
  const { rows } = await pool.query(
    `select id, login, display_name as "displayName", credential_delivery_email as "credentialDeliveryEmail",
            last_password_generated_at as "lastPasswordGeneratedAt", last_credentials_sent_at as "lastCredentialsSentAt"
     from marga.portal_accounts
     where id = $1`,
    [Number(accountId)]
  );
  if (!rows[0]) {
    const error = new Error('Portal account not found.');
    error.statusCode = 404;
    throw error;
  }
  const preview = credentialEmail(rows[0], cleanText(body.password) || 'recent generated password');
  await auditLog({ userId: user.id, action: 'marga_care_credential_email_previewed', entityType: 'portal_account', entityId: String(accountId), req });
  return {
    sent: false,
    needsHostingerSmtp: true,
    message: 'Email preview is ready. Real sending needs Hostinger SMTP settings.',
    preview
  };
}

async function handlePortalApi(req, res, url) {
  await ensurePortalTables();
  if (url.pathname === '/portal-api/login' && req.method === 'POST') {
    const result = await login(await readJson(req), req);
    if (result.status === 200 && result.data.token) {
      res.setHeader('Set-Cookie', cookieHeader('msp_session', result.data.token, { maxAge: 60 * 60 * 12 }));
      delete result.data.token;
    }
    json(res, result.status, result.data);
    return;
  }

  if (url.pathname === '/portal-api/logout' && req.method === 'POST') {
    const user = authUser(req);
    if (user) await auditLog({ userId: user.id, action: 'logout', req });
    res.setHeader('Set-Cookie', cookieHeader('msp_session', '', { maxAge: 0 }));
    json(res, 200, { ok: true });
    return;
  }

  const user = authUser(req);
  if (!user) {
    json(res, 401, { ok: false, message: 'Session expired. Please sign in again.' });
    return;
  }

  if (url.pathname === '/portal-api/me') return json(res, 200, { ok: true, user });
  if (url.pathname === '/portal-api/admin/care/companies' && req.method === 'GET') {
    return json(res, 200, { ok: true, companies: await listCareCompanies(user, url.searchParams.get('q') || '') });
  }
  const careCompanyMatch = url.pathname.match(/^\/portal-api\/admin\/care\/companies\/(\d+)$/);
  if (careCompanyMatch && req.method === 'GET') {
    return json(res, 200, { ok: true, company: await getCareCompany(user, careCompanyMatch[1]) });
  }
  if (url.pathname === '/portal-api/admin/care/company-profile' && req.method === 'POST') {
    return json(res, 200, { ok: true, profile: await saveCareCompanyProfile(user, await readJson(req), req) });
  }
  if (url.pathname === '/portal-api/admin/care/representative' && req.method === 'POST') {
    return json(res, 200, { ok: true, ...(await upsertRepresentativeAccount(user, await readJson(req), req)) });
  }
  const passwordMatch = url.pathname.match(/^\/portal-api\/admin\/care\/accounts\/(\d+)\/generate-password$/);
  if (passwordMatch && req.method === 'POST') {
    return json(res, 200, { ok: true, ...(await generateAccountPassword(user, passwordMatch[1], req)) });
  }
  const emailMatch = url.pathname.match(/^\/portal-api\/admin\/care\/accounts\/(\d+)\/email-preview$/);
  if (emailMatch && req.method === 'POST') {
    return json(res, 200, { ok: true, ...(await emailCredentialPreview(user, emailMatch[1], await readJson(req), req)) });
  }
  if (url.pathname === '/portal-api/company') return json(res, 200, { ok: true, company: await getCompany(url.searchParams.get('companyId') || user.companyId) });
  if (url.pathname === '/portal-api/companies') return json(res, 200, { ok: true, companies: await listCompanies(user) });
  if (url.pathname === '/portal-api/branches') return json(res, 200, { ok: true, branches: await listBranches(user) });
  if (url.pathname === '/portal-api/devices') return json(res, 200, { ok: true, devices: await listDevices(user) });
  if (url.pathname === '/portal-api/tickets' && req.method === 'GET') return json(res, 200, { ok: true, tickets: await listTickets(user) });
  if (url.pathname === '/portal-api/tickets' && req.method === 'POST') return json(res, 200, { ok: true, ticket: await createTicket(user, await readJson(req)) });
  if (url.pathname === '/portal-api/toner-requests' && req.method === 'GET') return json(res, 200, { ok: true, tonerRequests: await listTonerRequests(user) });
  if (url.pathname === '/portal-api/toner-requests' && req.method === 'POST') return json(res, 200, { ok: true, tonerRequest: await createTonerRequest(user, await readJson(req)) });
  if (url.pathname === '/portal-api/invoices') return json(res, 200, { ok: true, invoices: await listInvoices(user) });
  if (url.pathname === '/portal-api/payments') return json(res, 200, { ok: true, payments: await listPayments(user) });
  if (url.pathname === '/portal-api/signers') return json(res, 200, { ok: true, signers: await listSigners(user) });
  if (url.pathname === '/portal-api/summary') return json(res, 200, { ok: true, summary: await summary(user) });
  if (url.pathname === '/health') return json(res, 200, { ok: true, app: 'marga-service-portal' });

  json(res, 404, { ok: false, message: 'Portal API route not found.' });
}

function stripQuery(url) {
  return decodeURIComponent(String(url || '/').split('?')[0]);
}

function resolvePortalPath(requestPath) {
  const cleanPath = stripQuery(requestPath).replace(/\/+/g, '/');

  if (cleanPath === '/' || cleanPath === '') return '/public/index.html';
  if (cleanPath === '/install' || cleanPath.startsWith('/install/')) return '/install/index.html';
  if (cleanPath === '/tech' || cleanPath.startsWith('/tech/')) return '/public/tech/index.html';

  return cleanPath;
}

async function existingFile(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = path.join(portalRoot, normalized);
  if (!absolutePath.startsWith(portalRoot)) return null;

  try {
    const fileStat = await stat(absolutePath);
    if (fileStat.isFile()) return absolutePath;
  } catch {
    return null;
  }
  return null;
}

function sendResponse(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);

  if (url.pathname.startsWith('/portal-api/')) {
    try {
      await handlePortalApi(req, res, url);
    } catch (error) {
      console.error(error);
      json(res, error.statusCode || 500, { ok: false, message: error.message || 'Portal API server error.' });
    }
    return;
  }

  if (url.pathname === '/health') {
    sendResponse(res, 200, JSON.stringify({ ok: true, app: 'marga-service-portal' }), 'application/json; charset=utf-8');
    return;
  }

  let relativePath = resolvePortalPath(req.url);
  let filePath = await existingFile(relativePath);

  if (!filePath) {
    relativePath = '/public/index.html';
    filePath = await existingFile(relativePath);
  }

  if (!filePath) {
    sendResponse(res, 404, 'Marga service portal file not found.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) || 'application/octet-stream';
  const cacheControl = ext === '.html' || ext === '.js' || ext === '.css'
    ? 'no-store'
    : 'public, max-age=86400';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendResponse(res, 500, 'Marga service portal server error.');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Marga service portal listening on http://127.0.0.1:${port}`);
});
