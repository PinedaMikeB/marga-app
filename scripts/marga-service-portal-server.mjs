#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import tls from 'node:tls';
import fs, { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
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
const CARE_SMTP_HOST = process.env.MARGA_CARE_SMTP_HOST || 'smtp.hostinger.com';
const CARE_SMTP_PORT = Number(process.env.MARGA_CARE_SMTP_PORT || 465);
const CARE_SMTP_USER = process.env.MARGA_CARE_SMTP_USER || 'solutions@marga.biz';
const CARE_SMTP_FROM = process.env.MARGA_CARE_SMTP_FROM || CARE_SMTP_USER;
const CARE_SMTP_PASSWORD = process.env.MARGA_CARE_SMTP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '';
const pool = new Pool({ connectionString: DATABASE_URL });
const loginAttempts = new Map();
const previewLaunches = new Map();
let portalSchemaReadyPromise = null;
let machineStatusCache = null;
let purposeLabelCache = null;

const REQUIRED_PORTAL_TABLES = [
  'portal_toner_requests',
  'portal_service_tickets',
  'portal_accounts',
  'audit_logs',
  'care_company_profiles',
  'care_account_scopes'
];

const REQUIRED_PORTAL_ACCOUNT_COLUMNS = [
  'must_change_password',
  'last_password_generated_at',
  'last_credentials_sent_at',
  'credential_delivery_email',
  'password_algorithm',
  'password_memory',
  'password_passes',
  'password_parallelism',
  'password_tag_length'
];

const ARGON2_MEMORY = Number(process.env.MARGA_CARE_ARGON2_MEMORY || 65536);
const ARGON2_PASSES = Number(process.env.MARGA_CARE_ARGON2_PASSES || 3);
const ARGON2_PARALLELISM = Number(process.env.MARGA_CARE_ARGON2_PARALLELISM || 1);
const ARGON2_TAG_LENGTH = Number(process.env.MARGA_CARE_ARGON2_TAG_LENGTH || 32);

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

// Parse multipart/form-data bodies (for ticket/toner photo uploads).
// Returns { fields: {key: value}, files: {key: {filename, mimeType, data: Buffer}} }
async function readMultipart(req) {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return { fields: {}, files: {} };
  const boundary = boundaryMatch[1];

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const fields = {};
  const files = {};
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const parts = splitBuffer(body, delimiter);

  for (const part of parts) {
    const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const contentData = part.slice(headerEnd + 4);
    const nameMatch = headerText.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const filenameMatch = headerText.match(/filename="([^"]*)"/);
    const mimeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    if (filenameMatch) {
      files[fieldName] = {
        filename: filenameMatch[1],
        mimeType: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
        data: contentData
      };
    } else {
      fields[fieldName] = contentData.toString('utf8');
    }
  }
  return { fields, files };
}

function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;
  let idx = buf.indexOf(delimiter, start);
  while (idx !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    idx = buf.indexOf(delimiter, start);
  }
  parts.push(buf.slice(start));
  return parts.filter((p) => p.length > 0);
}

function indexOfSequence(buf, seq) {
  for (let i = 0; i <= buf.length - seq.length; i++) {
    if (buf.slice(i, i + seq.length).equals(seq)) return i;
  }
  return -1;
}

// Save uploaded file to local storage and return a URL path.
async function saveUploadedFile(fileObj, prefix = 'portal') {
  if (!fileObj || !fileObj.data || fileObj.data.length === 0) return null;
  const ext = (fileObj.filename || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeName = `${prefix}_${Date.now()}_${crypto.randomInt(1000, 9999)}.${ext}`;
  const uploadDir = path.join(portalRoot, 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, safeName), fileObj.data);
  return `/uploads/${safeName}`;
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

function keepPortalTimelineRecord(value) {
  const parsed = Date.parse(String(value || '').trim());
  if (!Number.isFinite(parsed)) return true;
  return new Date(parsed).getUTCFullYear() >= 2025;
}

function verifyPassword(user, password) {
  const provided = String(password || '');
  if (String(user.password_algorithm || '').toLowerCase() === 'argon2id' && user.password_hash && user.password_salt) {
    const derived = crypto.argon2Sync('argon2id', {
      message: provided,
      nonce: Buffer.from(String(user.password_salt), 'base64'),
      memory: Number(user.password_memory || ARGON2_MEMORY),
      passes: Number(user.password_passes || ARGON2_PASSES),
      parallelism: Number(user.password_parallelism || ARGON2_PARALLELISM),
      tagLength: Number(user.password_tag_length || ARGON2_TAG_LENGTH)
    });
    return derived.toString('base64') === String(user.password_hash);
  }
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
  const hash = crypto.argon2Sync('argon2id', {
    message: String(password || ''),
    nonce: salt,
    memory: ARGON2_MEMORY,
    passes: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    tagLength: ARGON2_TAG_LENGTH
  });
  return {
    password_hash: hash.toString('base64'),
    password_salt: salt.toString('base64'),
    password_iterations: 0,
    password_algorithm: 'argon2id',
    password_memory: ARGON2_MEMORY,
    password_passes: ARGON2_PASSES,
    password_parallelism: ARGON2_PARALLELISM,
    password_tag_length: ARGON2_TAG_LENGTH
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

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
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
    alter table marga.portal_accounts add column if not exists password_algorithm text;
    alter table marga.portal_accounts add column if not exists password_memory integer;
    alter table marga.portal_accounts add column if not exists password_passes integer;
    alter table marga.portal_accounts add column if not exists password_parallelism integer;
    alter table marga.portal_accounts add column if not exists password_tag_length integer;
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

function isSchemaCreatePermissionError(error) {
  return error?.code === '42501' && /schema marga/i.test(String(error?.message || ''));
}

async function portalSchemaAlreadyBootstrapped() {
  const { rows: tableRows } = await pool.query(
    `select table_name
     from information_schema.tables
     where table_schema = 'marga'
       and table_name = any($1::text[])`,
    [REQUIRED_PORTAL_TABLES]
  );
  if (tableRows.length !== REQUIRED_PORTAL_TABLES.length) return false;

  const { rows: columnRows } = await pool.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'marga'
       and table_name = 'portal_accounts'
       and column_name = any($1::text[])`,
    [REQUIRED_PORTAL_ACCOUNT_COLUMNS]
  );
  return columnRows.length === REQUIRED_PORTAL_ACCOUNT_COLUMNS.length;
}

async function ensurePortalSchemaReady() {
  if (!portalSchemaReadyPromise) {
    portalSchemaReadyPromise = (async () => {
      try {
        await ensurePortalTables();
      } catch (error) {
        if (isSchemaCreatePermissionError(error) && await portalSchemaAlreadyBootstrapped()) {
          console.warn('Portal schema already exists; continuing without CREATE privilege on schema marga.');
          return;
        }
        throw error;
      }
    })();
  }
  return portalSchemaReadyPromise;
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

function portalScopeWhere(user, alias = '', columns = {}) {
  const prefix = alias ? `${alias}.` : '';
  const companyColumn = columns.company || 'company_id';
  const branchColumn = columns.branch || 'branch_id';
  if (user.previewRequired) return { sql: 'and false', params: [] };
  if (user.scopedPreview && Array.isArray(user.companyIds) && user.companyIds.length && user.branchId) {
    return { sql: `and ${prefix}${companyColumn} = any($1::bigint[]) and ${prefix}${branchColumn} = $2`, params: [user.companyIds, user.branchId] };
  }
  if (user.scopedPreview && Array.isArray(user.companyIds) && user.companyIds.length) {
    return { sql: `and ${prefix}${companyColumn} = any($1::bigint[])`, params: [user.companyIds] };
  }
  if (user.scopedPreview && user.companyId && user.branchId) {
    return { sql: `and ${prefix}${companyColumn} = $1 and ${prefix}${branchColumn} = $2`, params: [user.companyId, user.branchId] };
  }
  if (user.scopedPreview && user.companyId) {
    return { sql: `and ${prefix}${companyColumn} = $1`, params: [user.companyId] };
  }
  if (user.role === 'marga_admin' || user.role === 'marga_staff') return { sql: '', params: [] };
  // Multi-company overseer: use companyIds array when present (populated from care_account_scopes)
  // The activeCompanyId is set when the user selects a specific group in the portal switcher.
  const activeCompanyId = user.activeCompanyId ? Number(user.activeCompanyId) : null;
  const allCompanyIds = Array.isArray(user.companyIds) && user.companyIds.length > 0 ? user.companyIds : null;
  if (user.companyId && user.branchId) return { sql: `and ${prefix}${companyColumn} = $1 and ${prefix}${branchColumn} = $2`, params: [user.companyId, user.branchId] };
  if (activeCompanyId) return { sql: `and ${prefix}${companyColumn} = $1`, params: [activeCompanyId] };
  if (allCompanyIds && allCompanyIds.length > 1) return { sql: `and ${prefix}${companyColumn} = any($1::bigint[])`, params: [allCompanyIds] };
  if (user.companyId) return { sql: `and ${prefix}${companyColumn} = $1`, params: [user.companyId] };
  return { sql: 'and false', params: [] };
}

function activeGraphDeviceKeySql(alias = 'g') {
  return `coalesce(${alias}.machine_id::text, 'contract:' || ${alias}.contract_id::text)`;
}

function machineModelSql(alias = 'm') {
  return `coalesce(${alias}.source_data->>'description', ${alias}.source_data->>'model', ${alias}.model_legacy_id, '')`;
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
    `select id, login, display_name, role, mobile_user_id, company_id, branch_id,
            password_hash, password_salt, password_iterations, password_algorithm,
            password_memory, password_passes, password_parallelism, password_tag_length,
            active
     from marga.portal_accounts
     where lower(login) = lower($1)
        or lower(coalesce(mobile_user_id, '')) = lower($1)
     order by case when lower(login) = lower($1) then 0 else 1 end
     limit 1`,
    [login]
  );
  return rows[0] || null;
}

async function findPortalAccountById(accountId) {
  const { rows } = await pool.query(
    `select id, login, display_name, role, mobile_user_id, company_id, branch_id,
            password_hash, password_salt, password_iterations, password_algorithm,
            password_memory, password_passes, password_parallelism, password_tag_length,
            active
     from marga.portal_accounts
     where id = $1
     limit 1`,
    [Number(accountId)]
  );
  return rows[0] || null;
}

function portalAccountSession(account) {
  const rawRole = String(account.role || '').trim().toLowerCase();
  const mappedRole = rawRole === 'company_admin' || rawRole === 'company_representative' || rawRole === 'mother_representative'
    ? 'company_admin'
    : rawRole === 'branch_user' || rawRole === 'end_user'
      ? 'branch_user'
      : (rawRole || 'branch_user');
  return {
    id: `portal:${account.id}`,
    uid: `portal:${account.id}`,
    sourceId: String(account.id),
    companyId: account.company_id == null ? null : Number(account.company_id),
    companyIds: account.company_ids || [Number(account.company_id)].filter(Boolean),
    branchId: account.branch_id == null ? null : Number(account.branch_id),
    role: mappedRole,
    roles: [mappedRole],
    modules: ['portal'],
    name: account.display_name || account.login,
    email: account.login,
    source: 'marga_portal_account'
  };
}

async function fetchPortalAccountCompanyIds(accountId) {
  const numericId = Number(String(accountId).replace('portal:', ''));
  if (!numericId) return [];
  const { rows } = await pool.query(
    `select company_id from marga.care_account_scopes
     where account_id = $1 and scope_type = 'company' and active = true
     order by company_id`,
    [numericId]
  );
  return rows.map(r => Number(r.company_id)).filter(Boolean);
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
    // Try login by: code login (C00072-B00082), email login, or contact_email (self-registered)
    let account = await findPortalAccount(ident);
    if (!account) account = await findPortalAccountByContactEmail(ident);
    if (!account || account.active !== true || !verifyPassword(account, password)) {
      await auditLog({ action: 'failed_login', req, metadata: { ident } });
      return { status: 401, data: { ok: false, message: 'Invalid credentials. Check your login code or email and password.' } };
    }
    user = portalAccountSession(account);
    // Enrich user with ALL company scopes from care_account_scopes (multi-company support)
    const allCompanyIds = await fetchPortalAccountCompanyIds(user.sourceId);
    if (allCompanyIds.length > 0) {
      user = { ...user, companyIds: allCompanyIds };
      // If primary companyId is not in the list (edge case), use first scope
      if (!allCompanyIds.includes(user.companyId)) {
        user = { ...user, companyId: allCompanyIds[0] };
      }
    }
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

function isInternalPortalUser(user) {
  return user?.role === 'marga_admin' || user?.role === 'marga_staff';
}

// Derive customer-facing status
// Core rule: machine has serial = it is Active at the customer (in use, under repair, incoming - all Active)
// No serial + no status = Needs Attention (ops needs to investigate)
// For Replacement is set separately via machine history (CHANGE UNIT records), not here
function deriveCustomerStatus(serialAvailable, statusId) {
  const sid = Number(statusId || 0);

  // Machine is physically present (has serial) → always Active from customer's view
  // Whether it's being repaired, delivered, or anything else — it's their machine, it's Active
  if (serialAvailable) return 'Active';

  // No serial cases:
  if (!sid) return 'Needs Attention'; // no serial, no status = genuinely unknown, flag for ops
  return 'Active';                    // no serial but has status = Active contract, machine present
}

// Legacy map kept for internal admin views only (not shown to customers)
const CUSTOMER_STATUS_LABELS = new Map([
  [1,  'Staging'],
  [2,  'Incoming'],
  [3,  'Active'],
  [4,  'Active'],
  [5,  'For Replacement'],
  [6,  'Decommissioned'],
  [7,  'Under Repair'],
  [8,  'Under Repair'],
  [9,  'For Replacement'],
  [10, 'For Replacement'],
  [11, 'Transferred'],
  [12, 'Under Repair'],
  [13, 'Missing'],
  [14, 'Inactive'],
  [15, 'Under QC'],
  [17, 'Inactive'],
  [18, 'Incoming'],
]);

async function loadMachineStatuses() {
  if (machineStatusCache) return machineStatusCache;
  const fallback = new Map([
    [1, 'IN STOCK'],
    [2, 'FOR DELIVERY'],
    [3, 'DELIVERED'],
    [4, 'USED / IN THE COMPANY'],
    [5, 'FOR JUNK'],
    [6, 'JUNK'],
    [7, 'FOR OVERHAULING'],
    [8, 'UNDER REPAIR'],
    [9, 'FOR PARTS'],
    [10, 'FOR SALE'],
    [11, 'TRADE IN'],
    [12, 'OUTSIDE REPAIR'],
    [13, 'MISSING'],
    [14, 'OLD'],
    [15, 'UNDER QC'],
    [17, 'N/A'],
    [18, 'Delivered (No Contract/To Receive)']
  ]);
  try {
    const { rows } = await pool.query(
      `select cast(data->>'id' as integer) as id,
              coalesce(nullif(data->>'status', ''), nullif(data->>'description', ''), nullif(data->>'status_name', '')) as label
       from app_meta.firestore_documents
       where collection = 'tbl_newmachinestatus'
         and coalesce(data->>'id', '') ~ '^[0-9]+$'
       order by cast(data->>'id' as integer)`
    );
    const map = new Map(fallback);
    rows.forEach((row) => {
      if (Number(row.id || 0) > 0 && cleanText(row.label)) map.set(Number(row.id), cleanText(row.label));
    });
    machineStatusCache = map;
    return machineStatusCache;
  } catch (error) {
    console.warn('Unable to load tbl_newmachinestatus, using fallback labels.', error.message);
    machineStatusCache = fallback;
    return machineStatusCache;
  }
}

async function loadPurposeLabels() {
  if (purposeLabelCache) return purposeLabelCache;
  const fallback = new Map([
    ['1', 'Billing'],
    ['2', 'Collection'],
    ['3', 'Deliver Ink / Toner'],
    ['4', 'Deliver Cartridge'],
    ['5', 'Service'],
    ['6', 'Sales'],
    ['7', 'Purchasing'],
    ['8', 'Reading'],
    ['9', 'Others']
  ]);
  try {
    const { rows } = await pool.query(
      `select coalesce(data->>'id', '') as id,
              coalesce(nullif(data->>'purpose', ''), nullif(data->>'description', ''), nullif(data->>'name', '')) as label
       from app_meta.firestore_documents
       where collection = 'tbl_purpose'
         and coalesce(data->>'id', '') <> ''
       order by cast(data->>'id' as integer)`
    );
    const map = new Map(fallback);
    rows.forEach((row) => {
      const id = String(row.id || '').trim();
      const label = cleanText(row.label);
      if (id && label) map.set(id, label);
    });
    purposeLabelCache = map;
    return purposeLabelCache;
  } catch (error) {
    console.warn('Unable to load tbl_purpose, using fallback labels.', error.message);
    purposeLabelCache = fallback;
    return purposeLabelCache;
  }
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
}

function textMatchesSearch(searchTerm, values = []) {
  const needle = normalizeSearchText(searchTerm);
  if (!needle) return true;
  const textValues = values
    .filter(Boolean)
    .map((value) => String(value || '').toLowerCase());
  const haystack = textValues.join(' ').toLowerCase();
  const compactNeedle = needle.replace(/[^a-z0-9]/g, '');
  if (!compactNeedle) return false;
  if (compactNeedle.length <= 3) {
    return textValues
      .flatMap((value) => value.split(/[^a-z0-9]+/g))
      .filter(Boolean)
      .some((token) => token.startsWith(compactNeedle));
  }
  if (haystack.includes(needle)) return true;
  return textValues
    .map((value) => value.replace(/[^a-z0-9]/g, ''))
    .some((value) => value.includes(compactNeedle));
}

function parseCompanyIds(value) {
  return String(value || '')
    .split(',')
    .map((entry) => Number(String(entry || '').trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function previewDisplayName(name) {
  return String(name || '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewFamilyStem(name) {
  return previewDisplayName(String(name || '')
    .replace(/\s*-\s*branches$/i, '')
    .replace(/\s*\([^)]*\)\s*$/g, ''));
}

function previewFamilyKey(name) {
  return previewFamilyStem(name)
    .toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|ltd|limited)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isPreviewBranchGroup(name) {
  return /\s*-\s*branches$/i.test(String(name || '').trim());
}

function isPreviewVariant(name) {
  return /\([^)]*\)/.test(String(name || ''));
}

function previewMotherName(rows = []) {
  const preferred = rows.find((row) => !isPreviewBranchGroup(row.name) && !isPreviewVariant(row.name))
    || rows.find((row) => !isPreviewBranchGroup(row.name))
    || rows[0];
  return previewDisplayName(previewFamilyStem(preferred?.name || 'Marga Customer'));
}

function previewMatchSource(row) {
  if (row.machine_match) return 'machine';
  if (row.branch_match) return 'branch';
  return 'company';
}

function previewSearchValues(row) {
  return [
    row?.name,
    row?.legacy_id,
    row?.family_stem,
    row?.branch_names,
    row?.branch_addresses,
    row?.machine_serials,
    row?.machine_models
  ];
}

function previewResultFromRows(rows, familyLabel = '', motherNameOverride = '') {
  const companyIds = rows.map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);
  const motherName = motherNameOverride || previewMotherName(rows);
  const branchCount = rows.reduce((sum, row) => sum + Number(row.branch_count || 0), 0);
  const machineCount = rows.reduce((sum, row) => sum + Number(row.machine_count || 0), 0);
  const matchSources = rows.map(previewMatchSource);
  const matchSource = matchSources.includes('machine')
    ? 'machine'
    : matchSources.includes('branch')
      ? 'branch'
      : 'company';
  const representative = rows.find((row) => !isPreviewBranchGroup(row.name)) || rows[0];
  const name = familyLabel ? `${motherName} - ${familyLabel}` : previewDisplayName(representative?.name || motherName);
  return {
    id: Number(representative?.id || companyIds[0] || 0),
    companyIds,
    legacyId: representative?.legacy_id == null ? null : String(representative.legacy_id),
    name,
    motherName,
    groupLabel: familyLabel,
    type: companyIds.length > 1 || familyLabel ? 'grouped_account' : 'company',
    branchCount,
    machineCount,
    companyMatchCount: rows.length,
    matchSource,
    searchText: rows.map((row) => previewSearchValues(row).filter(Boolean).join(' ')).join(' '),
    note: familyLabel
      ? `${familyLabel} group under ${motherName}`
      : 'Matched by customer scope'
  };
}

function previewFamilyResultRows(rows) {
  if (!rows.length) return [];
  const familyMotherName = previewMotherName(rows);
  const branchRows = rows.filter((row) => isPreviewBranchGroup(row.name));
  const accountRows = rows.filter((row) => !isPreviewBranchGroup(row.name));
  if (branchRows.length && accountRows.length) {
    return [
      previewResultFromRows(branchRows, 'Branches', familyMotherName),
      previewResultFromRows(accountRows, 'Departments', familyMotherName)
    ];
  }
  if (branchRows.length) {
    return [previewResultFromRows(branchRows, 'Branches', familyMotherName)];
  }
  if (accountRows.length === 1) {
    return [previewResultFromRows(accountRows, '', familyMotherName)];
  }
  return [previewResultFromRows(accountRows, accountRows.some((row) => isPreviewVariant(row.name)) ? 'Departments' : 'Account', familyMotherName)];
}

function previewFamilySortRank(name, query) {
  const text = normalizeSearchText(name);
  const compactNeedle = compactSearchText(query);
  const tokens = text.split(/[^a-z0-9]+/g).filter(Boolean);
  if (tokens.some((token) => token.startsWith(compactNeedle))) return 0;
  if (text.startsWith(normalizeSearchText(query))) return 1;
  if (text.includes(normalizeSearchText(query))) return 2;
  return 3;
}

function previewScopedUser(user, requestedCompanyId, requestedBranchId, requestedCompanyIds) {
  if (!isInternalPortalUser(user)) return user;
  const companyIds = parseCompanyIds(requestedCompanyIds);
  const companyId = Number(requestedCompanyId || companyIds[0] || 0) || null;
  const branchId = Number(requestedBranchId || 0) || null;
  if (!companyId) {
    return { ...user, companyId: null, companyIds: [], branchId: null, previewRequired: true };
  }
  const scopedCompanyIds = companyIds.length ? companyIds : [companyId];
  return { ...user, companyId, companyIds: scopedCompanyIds, branchId, previewRequired: false, scopedPreview: true };
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

async function searchInternalPreviewAccounts(user, query = '') {
  requireInternalUser(user);
  const needle = normalizeSearchText(query);
  if (!needle) return [];

  const like = `%${needle}%`;
  const startsWith = `${needle}%`;
  const { rows } = await pool.query(
    `with matched_companies as (
       select c.id,
              c.legacy_id,
              c.name,
              exists(
                select 1
                from marga.branches b
                where b.company_id = c.id
                  and b.inactive is false
                  and (
                    lower(coalesce(b.name, '')) like $1
                    or lower(coalesce(b.address, '')) like $1
                  )
              ) as branch_match,
              exists(
                select 1
                from api.active_customer_graph g
                left join marga.machines m on m.id = g.machine_id
                where g.company_id = c.id
                  and (
                    lower(coalesce(g.display_serial, g.machine_serial, '')) like $1
                    or lower(${machineModelSql('m')}) like $1
                  )
              ) as machine_match,
              (
                select count(*)
                from marga.branches b
                where b.company_id = c.id
                  and b.inactive is false
              )::integer as branch_count,
              (
                select count(distinct ${activeGraphDeviceKeySql('g')})
                from api.active_customer_graph g
                where g.company_id = c.id
              )::integer as machine_count,
              (
                select string_agg(sample.name, ' • ' order by sample.name)
                from (
                  select b.name
                  from marga.branches b
                  where b.company_id = c.id
                    and b.inactive is false
                  order by b.name
                  limit 12
                ) sample
              ) as branch_names,
              (
                select string_agg(sample.address, ' • ' order by sample.address)
                from (
                  select nullif(trim(coalesce(b.address, '')), '') as address
                  from marga.branches b
                  where b.company_id = c.id
                    and b.inactive is false
                    and nullif(trim(coalesce(b.address, '')), '') is not null
                  order by b.address
                  limit 8
                ) sample
              ) as branch_addresses,
              (
                select string_agg(sample.serial, ' • ' order by sample.serial)
                from (
                  select distinct coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) as serial
                  from api.active_customer_graph g
                  where g.company_id = c.id
                    and coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) is not null
                  order by coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), ''))
                  limit 10
                ) sample
              ) as machine_serials,
              (
                select string_agg(sample.model, ' • ' order by sample.model)
                from (
                  select distinct ${machineModelSql('m')} as model
                  from api.active_customer_graph g
                  left join marga.machines m on m.id = g.machine_id
                  where g.company_id = c.id
                    and nullif(trim(${machineModelSql('m')}), '') is not null
                  order by ${machineModelSql('m')}
                  limit 10
                ) sample
              ) as machine_models
       from marga.companies c
       where c.inactive is false
         and (
           lower(c.name) like $1
           or exists(
             select 1 from marga.branches b
             where b.company_id = c.id
               and b.inactive is false
               and (
                 lower(coalesce(b.name, '')) like $1
                 or lower(coalesce(b.address, '')) like $1
               )
           )
           or exists(
             select 1 from api.active_customer_graph g
             left join marga.machines m on m.id = g.machine_id
             where g.company_id = c.id
               and (
                 lower(coalesce(g.display_serial, g.machine_serial, '')) like $1
                 or lower(${machineModelSql('m')}) like $1
               )
           )
         )
     )
     select *
     from matched_companies
     order by
       case when lower(name) like $2 then 0 else 1 end,
       branch_match desc,
       machine_match desc,
       machine_count desc,
       branch_count desc,
       name
     limit 200`,
    [like, startsWith]
  );
  const matchedRows = rows
    .map((row) => ({
      ...row,
      family_stem: previewFamilyStem(row.name),
      family_key: previewFamilyKey(row.name)
    }))
    .filter((row) => textMatchesSearch(needle, previewSearchValues(row)));
  if (!matchedRows.length) return [];

  const familyPatterns = [...new Set(
    matchedRows
      .map((row) => row.family_stem)
      .filter(Boolean)
      .map((stem) => `%${normalizeSearchText(stem)}%`)
  )];
  const relatedRows = familyPatterns.length
    ? (await pool.query(
      `select c.id,
              c.legacy_id,
              c.name,
              false as branch_match,
              false as machine_match,
              (
                select count(*)
                from marga.branches b
                where b.company_id = c.id
                  and b.inactive is false
              )::integer as branch_count,
              (
                select count(distinct ${activeGraphDeviceKeySql('g')})
                from api.active_customer_graph g
                where g.company_id = c.id
              )::integer as machine_count,
              (
                select string_agg(sample.name, ' • ' order by sample.name)
                from (
                  select b.name
                  from marga.branches b
                  where b.company_id = c.id
                    and b.inactive is false
                  order by b.name
                  limit 12
                ) sample
              ) as branch_names,
              (
                select string_agg(sample.address, ' • ' order by sample.address)
                from (
                  select nullif(trim(coalesce(b.address, '')), '') as address
                  from marga.branches b
                  where b.company_id = c.id
                    and b.inactive is false
                    and nullif(trim(coalesce(b.address, '')), '') is not null
                  order by b.address
                  limit 8
                ) sample
              ) as branch_addresses,
              (
                select string_agg(sample.serial, ' • ' order by sample.serial)
                from (
                  select distinct coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) as serial
                  from api.active_customer_graph g
                  where g.company_id = c.id
                    and coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) is not null
                  order by coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), ''))
                  limit 10
                ) sample
              ) as machine_serials,
              (
                select string_agg(sample.model, ' • ' order by sample.model)
                from (
                  select distinct ${machineModelSql('m')} as model
                  from api.active_customer_graph g
                  left join marga.machines m on m.id = g.machine_id
                  where g.company_id = c.id
                    and nullif(trim(${machineModelSql('m')}), '') is not null
                  order by ${machineModelSql('m')}
                  limit 10
                ) sample
              ) as machine_models
       from marga.companies c
       where c.inactive is false
         and exists (
           select 1
           from unnest($1::text[]) as pattern
           where lower(c.name) like pattern
         )
       order by c.name`,
      [familyPatterns]
    )).rows : [];

  const relatedMap = new Map();
  [...matchedRows, ...relatedRows].forEach((row) => {
    const normalized = {
      ...row,
      family_stem: previewFamilyStem(row.name),
      family_key: previewFamilyKey(row.name)
    };
    relatedMap.set(Number(normalized.id), normalized);
  });

  const families = new Map();
  matchedRows.forEach((row) => {
    const familyRows = [...relatedMap.values()].filter((entry) => entry.family_key === row.family_key);
    families.set(row.family_key, familyRows);
  });

  const items = [...families.entries()]
    .sort((left, right) => {
      const leftName = previewMotherName(left[1]);
      const rightName = previewMotherName(right[1]);
      return previewFamilySortRank(leftName, needle) - previewFamilySortRank(rightName, needle)
        || leftName.localeCompare(rightName);
    })
    .flatMap(([, familyRows]) => previewFamilyResultRows(familyRows))
    .filter((item) => textMatchesSearch(needle, [item.name, item.motherName, item.groupLabel, item.searchText]));

  const directNameMatches = items.filter((item) => textMatchesSearch(needle, [item.name, item.motherName, item.groupLabel]));
  return (directNameMatches.length ? directNameMatches : items).slice(0, 20);
}

async function listBranches(user) {
  const scope = portalScopeWhere(user, 'b', { branch: 'id' });
  const { rows } = await pool.query(
    `select b.id,
            b.legacy_id,
            b.company_id as "companyId",
            b.name,
            b.address,
            b.inactive,
            coalesce(
              nullif(b.source_data->>'signatory', ''),
              nullif(b.source_data->>'contact_person', ''),
              nullif(b.source_data->>'contactperson', ''),
              nullif(b.source_data->>'representative_name', ''),
              ''
            ) as "contactPerson",
            coalesce(
              nullif(b.source_data->>'contact_number', ''),
              nullif(b.source_data->>'contactno', ''),
              nullif(b.source_data->>'phone', ''),
              nullif(b.source_data->>'mobile', ''),
              nullif(b.source_data->>'mobile_no', ''),
              nullif(b.source_data->>'tel_no', ''),
              ''
            ) as "contactNumber",
            coalesce(
              nullif(b.source_data->>'email', ''),
              nullif(b.source_data->>'representative_email', ''),
              nullif(b.source_data->>'contact_email', ''),
              ''
            ) as email,
            coalesce(
              nullif(b.source_data->>'city', ''),
              ''
            ) as city,
            coalesce(machine_summary.device_count, 0)::integer as "deviceCount",
            coalesce(machine_summary.serial_numbers, '') as "serialNumbers"
     from marga.branches b
     left join lateral (
       select count(distinct ${activeGraphDeviceKeySql('g')}) as device_count,
              (
                select string_agg(sample.serial, ', ' order by sample.serial)
                from (
                  select distinct coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) as serial
                  from api.active_customer_graph g
                  where g.branch_id = b.id
                    and coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) is not null
                  order by coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), ''))
                  limit 6
                ) sample
              ) as serial_numbers
       from api.active_customer_graph g
       where g.branch_id = b.id
     ) machine_summary on true
     where b.inactive is false ${scope.sql}
     order by b.name limit 1000`,
    scope.params
  );
  return rows;
}

async function findCompanyPreviewAccount(companyId) {
  const { rows } = await pool.query(
    `select id, login, display_name as "displayName", role, company_id as "companyId", branch_id as "branchId"
     from marga.portal_accounts
     where active is true
       and company_id = $1
       and branch_id is null
     order by
       case
         when role in ('company_admin', 'company_representative', 'mother_representative') then 0
         when role = 'branch_manager' then 1
         else 2
       end,
       updated_at desc,
       id desc
     limit 1`,
    [Number(companyId)]
  );
  return rows[0] || null;
}

async function findBranchPreviewAccount(companyId, branchId) {
  const { rows } = await pool.query(
    `select id, login, display_name as "displayName", role, company_id as "companyId", branch_id as "branchId"
     from marga.portal_accounts
     where active is true
       and company_id = $1
       and branch_id = $2
     order by
       case
         when role in ('branch_user', 'branch_manager', 'end_user') then 0
         else 1
       end,
       updated_at desc,
       id desc
     limit 1`,
    [Number(companyId), Number(branchId)]
  );
  return rows[0] || null;
}

function buildPreviewLaunch(account) {
  const token = crypto.randomBytes(24).toString('base64url');
  previewLaunches.set(token, {
    accountId: Number(account.id),
    email: account.login,
    displayName: account.displayName || account.display_name || account.login,
    role: account.role,
    expiresAt: Date.now() + (5 * 60 * 1000)
  });
  return token;
}

function consumePreviewLaunch(token) {
  const key = String(token || '').trim();
  if (!key) return null;
  const launch = previewLaunches.get(key);
  if (!launch) return null;
  previewLaunches.delete(key);
  if (Number(launch.expiresAt || 0) < Date.now()) return null;
  return launch;
}

async function createPreviewLaunch(user, body, req) {
  requireInternalUser(user);
  let account = null;
  if (Number(body.accountId || 0) > 0) {
    account = await findPortalAccountById(body.accountId);
  } else if (Number(body.branchId || 0) > 0 && Number(body.companyId || 0) > 0) {
    account = await findBranchPreviewAccount(body.companyId, body.branchId);
  } else if (Number(body.companyId || 0) > 0) {
    account = await findCompanyPreviewAccount(body.companyId);
  }
  if (!account || account.active !== true) {
    const error = new Error('No active portal login is available for this preview target yet.');
    error.statusCode = 404;
    throw error;
  }
  const token = buildPreviewLaunch(account);
  await auditLog({
    userId: user.id,
    action: 'marga_care_preview_launch_created',
    entityType: 'portal_account',
    entityId: String(account.id),
    req,
    metadata: { login: account.login, role: account.role, companyId: account.companyId, branchId: account.branchId }
  });
  return {
    account: {
      id: account.id,
      login: account.login,
      displayName: account.displayName || account.display_name || account.login,
      role: account.role,
      companyId: account.companyId,
      branchId: account.branchId
    },
    previewToken: token,
    prefillEmail: account.login,
    prefillPassword: 'Preview Access',
    loginUrl: `/?preview_token=${encodeURIComponent(token)}&preview_email=${encodeURIComponent(account.login)}`
  };
}

async function previewLogin(body, req) {
  const launch = consumePreviewLaunch(body?.token);
  if (!launch) {
    const error = new Error('Preview launch expired. Generate a fresh preview tab from the internal portal.');
    error.statusCode = 401;
    throw error;
  }
  const account = await findPortalAccountById(launch.accountId);
  if (!account || account.active !== true) {
    const error = new Error('Preview account is no longer active.');
    error.statusCode = 404;
    throw error;
  }
  const user = portalAccountSession(account);
  const token = signToken({ sub: user.id, user, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 });
  await auditLog({
    userId: `portal:${account.id}`,
    action: 'preview_login',
    entityType: 'portal_account',
    entityId: String(account.id),
    req,
    metadata: { launchedFor: launch.email }
  });
  return { ok: true, token, user };
}

async function getPreviewBranchDetail(user, requestedCompanyId, requestedBranchId, requestedCompanyIds) {
  requireInternalUser(user);
  const scopedUser = previewScopedUser(user, requestedCompanyId, requestedBranchId, requestedCompanyIds);
  if (!scopedUser.branchId) {
    const error = new Error('Branch is required for branch detail.');
    error.statusCode = 400;
    throw error;
  }
  const [branches, devices, tickets, tonerRequests, invoices, payments, statusMap] = await Promise.all([
    listBranches(scopedUser),
    listDevices(scopedUser),
    listTickets(scopedUser),
    listTonerRequests(scopedUser),
    listInvoices(scopedUser),
    listPayments(scopedUser),
    loadMachineStatuses()
  ]);
  const branch = branches.find((entry) => Number(entry.id) === Number(scopedUser.branchId));
  if (!branch) {
    const error = new Error('Branch was not found in the selected customer scope.');
    error.statusCode = 404;
    throw error;
  }
  const outstandingAmount = invoices
    .filter((invoice) => !/paid/i.test(String(invoice.status || '')))
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const completedServices = tickets.filter((ticket) => /complete|closed|finished/i.test(String(ticket.status || ''))).length;
  const deliveredToner = tonerRequests.filter((request) => /fulfilled|history|delivered/i.test(String(request.status || ''))).length;
  const deviceConditions = [];
  const conditionMap = new Map();
  devices.forEach((device) => {
    const statusId = Number(device.status || 0);
    const hasSerial = Boolean(device.serial && device.serial !== 'N/A' && device.serial.trim() !== '');
    const label = deriveCustomerStatus(hasSerial, statusId);
    conditionMap.set(label, (conditionMap.get(label) || 0) + 1);
  });
  [...conditionMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .forEach(([label, count]) => deviceConditions.push({ label, count }));
  const previewAccount = await findBranchPreviewAccount(branch.companyId, branch.id);
  return {
    branch,
    summary: {
      machineCount: devices.length,
      outstandingAmount,
      unpaidInvoiceCount: invoices.filter((invoice) => !/paid/i.test(String(invoice.status || ''))).length,
      paidPaymentCount: payments.length,
      deliveredTonerCount: deliveredToner,
      completedServiceCount: completedServices,
      openServiceCount: tickets.length - completedServices,
      deviceConditions
    },
    devices: devices.map((device) => ({
      id: device.id,
      serial: device.serial,
      model: device.model,
      status: (() => {
        const sid = Number(device.status || 0);
        const hasSerial = Boolean(device.serial && device.serial !== 'N/A' && device.serial.trim() !== '');
        return deriveCustomerStatus(hasSerial, sid);
      })()
    })),
    previewAccount: previewAccount
      ? {
          id: previewAccount.id,
          login: previewAccount.login,
          displayName: previewAccount.displayName || previewAccount.display_name || previewAccount.login,
          role: previewAccount.role
        }
      : null
  };
}

async function listDevices(user) {
  const scope = portalScopeWhere(user, 'g');
  const statusMap = await loadMachineStatuses();
  const { rows } = await pool.query(
    `select distinct on (${activeGraphDeviceKeySql('g')})
            ${activeGraphDeviceKeySql('g')} as id,
            g.machine_id as "machineId",
            g.machine_legacy_id as "legacyId",
            g.contract_id as "contractId",
            g.company_id as "companyId",
            g.branch_id as "branchId",
            g.branch_legacy_id as "branchLegacyId",
            regexp_replace(coalesce(g.branch_name, ''), '^~x+\s*', '', 'i') as "branchName",
            coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), ''), 'N/A') as serial,
            ${machineModelSql('m')} as model,
            coalesce(m.status_id::text, g.machine_status_id::text, '') as status,
            case
              when g.machine_id is null then 'Machine assignment pending. Your service contract is active.'
              else coalesce(nullif(trim(coalesce(m.source_data->>'remarks','')), ''), '')
            end as notes,
            case when g.machine_id is null then true else false end as "pendingSetup",
            -- Detect change unit request from machine history (CHANGE UNIT remarks in tbl_newmachinehistory)
            exists (
              select 1 from app_meta.firestore_documents h
              where h.collection = 'tbl_newmachinehistory'
                and h.data->>'branch_id' = g.branch_legacy_id::text
                and upper(coalesce(h.data->>'remarks', '')) like '%CHANGE UNIT%'
                and coalesce(h.data->>'datex', h.data->>'tmstmp', '') >= to_char(now() - interval '2 years', 'YYYY-MM-DD')
            ) as "hasChangeUnitRequest"
     from api.active_customer_graph g
     left join marga.machines m on m.id = g.machine_id
     where true ${scope.sql}
     order by ${activeGraphDeviceKeySql('g')}, lower(coalesce(g.branch_name, '')) nulls last, coalesce(g.display_serial, g.machine_serial, '') nulls last, g.contract_id desc
     limit 1000`,
    scope.params
  );
  return rows.map((row) => {
    const hasSerial = Boolean(row.serial && row.serial !== 'N/A' && row.serial.trim() !== '');
    let customerLabel = deriveCustomerStatus(hasSerial, row.status);
    // Override to "For Replacement" if a CHANGE UNIT was formally requested
    if (row.hasChangeUnitRequest && customerLabel === 'Active') customerLabel = 'For Replacement';
    return {
      ...row,
      status: customerLabel,
      pendingSetup: !hasSerial && !Number(row.status),
      hasChangeUnitRequest: Boolean(row.hasChangeUnitRequest)
    };
  });
}

async function getDeviceDetail(user, requestedDeviceId) {
  const deviceId = String(requestedDeviceId || '').trim();
  if (!deviceId) {
    const error = new Error('Device is required.');
    error.statusCode = 400;
    throw error;
  }
  const [devices, statusMap, purposeMap] = await Promise.all([
    listDevices(user),
    loadMachineStatuses(),
    loadPurposeLabels()
  ]);
  const device = devices.find((entry) => String(entry.id) === deviceId);
  if (!device) {
    const error = new Error('Device was not found in your portal scope.');
    error.statusCode = 404;
    throw error;
  }

  const machineLegacyId = String(device.legacyId || '').trim();
  const branchId = Number(device.branchId || 0) || null;
  const branchLegacyId = String(device.branchLegacyId || '').trim();
  const timeline = [];

  // displaySerial is the actual serial string (e.g. E74075B8N980383); used for tbl_schedule lookup.
  // machineLegacyId is the numeric tbl_machine id; used for tbl_newmachinehistory / repair.
  const displaySerial = cleanText(device.serial !== 'N/A' ? device.serial : '');

  if (displaySerial || machineLegacyId) {
    const scheduleFilter = displaySerial
      ? `and coalesce(data->>'serial', '') = $1`
      : `and coalesce(data->>'mach_id', '') = $1`;
    const scheduleParam = displaySerial || String(machineLegacyId);
    const { rows: scheduleRows } = await pool.query(
      `select doc_id,
              data->>'purpose_id' as purpose_id,
              data->>'remarks' as remarks,
              data->>'customer_request' as customer_request,
              data->>'scheduled' as scheduled,
              data->>'task_datetime' as task_datetime,
              data->>'timestmp' as timestmp,
              data->>'date_finished' as date_finished,
              data->>'closedby' as closedby,
              data->>'iscancel' as iscancel,
              data->>'branch_id' as branch_id,
              data->>'company_id' as company_legacy_id
       from app_meta.firestore_documents
       where collection = 'tbl_schedule'
         ${scheduleFilter}
       order by cast(doc_id as bigint) desc
       limit 24`,
      [scheduleParam]
    );
    scheduleRows.forEach((row) => {
      const rowBranchId = String(row.branch_id || '').trim();
      if (branchLegacyId && rowBranchId && rowBranchId !== branchLegacyId) return;
      const purposeLabel = cleanText(purposeMap.get(String(row.purpose_id || '').trim()) || 'Request');
      const cancelled = String(row.iscancel || '').trim() === '1';
      const completed = String(row.closedby || '').trim() !== '0' || cleanText(row.date_finished);
      timeline.push({
        id: `schedule:${row.doc_id}`,
        type: 'request',
        label: purposeLabel,
        status: cancelled ? 'Cancelled' : (completed ? 'Completed' : 'Requested'),
        details: cleanText(row.customer_request || row.remarks) || `${purposeLabel} request`,
        at: cleanText(row.date_finished || row.task_datetime || row.timestmp || row.scheduled)
      });
    });

    const { rows: historyRows } = await pool.query(
      `select doc_id,
              data->>'status_id' as status_id,
              data->>'remarks' as remarks,
              data->>'datex' as datex,
              data->>'tmstmp' as tmstmp,
              data->>'branch_id' as branch_id
       from app_meta.firestore_documents
       where collection = 'tbl_newmachinehistory'
         and coalesce(data->>'mach_id', '') = $1
       order by cast(doc_id as bigint) desc
       limit 16`,
      [machineLegacyId]
    );
    historyRows.forEach((row) => {
      const rowBranchId = String(row.branch_id || '').trim();
      if (branchLegacyId && rowBranchId && rowBranchId !== branchLegacyId) return;
      const statusLabel = cleanText(statusMap.get(Number(row.status_id || 0)) || '');
      timeline.push({
        id: `history:${row.doc_id}`,
        type: 'movement',
        label: 'Machine Movement',
        status: statusLabel || 'Updated',
        details: cleanText(row.remarks) || statusLabel || 'Machine record updated',
        at: cleanText(row.tmstmp || row.datex)
      });
    });

    const { rows: repairRows } = await pool.query(
      `select doc_id,
              data->>'remarks' as remarks,
              data->>'action_taken' as action_taken,
              data->>'tech_remarks' as tech_remarks,
              data->>'parts_repaired' as parts_repaired,
              data->>'parts_replaced' as parts_replaced,
              data->>'start_date' as start_date,
              data->>'finish_date' as finish_date,
              data->>'status_id' as status_id
       from app_meta.firestore_documents
       where collection = 'tbl_newmachinerepair'
         and coalesce(data->>'mach_id', '') = $1
       order by cast(doc_id as bigint) desc
       limit 12`,
      [machineLegacyId]
    );
    repairRows.forEach((row) => {
      const details = [
        cleanText(row.action_taken),
        cleanText(row.tech_remarks),
        cleanText(row.parts_repaired),
        cleanText(row.parts_replaced),
        cleanText(row.remarks)
      ].filter(Boolean).join(' • ');
      timeline.push({
        id: `repair:${row.doc_id}`,
        type: 'repair',
        label: 'Repair Bench',
        status: cleanText(statusMap.get(Number(row.status_id || 0)) || 'Repair'),
        details: details || 'Repair activity recorded',
        at: cleanText(row.finish_date || row.start_date)
      });
    });
  }

  timeline.sort((left, right) => {
    const a = Date.parse(left.at || '') || 0;
    const b = Date.parse(right.at || '') || 0;
    return b - a;
  });

  const filteredTimeline = timeline.filter((item) => keepPortalTimelineRecord(item.at));

  return {
    device: {
      id: device.id,
      legacyId: device.legacyId || '',
      branchId: device.branchId,
      branchLegacyId: device.branchLegacyId || '',
      branchName: device.branchName || '',
      model: device.model,
      serial: device.serial,
      status: device.status,
      notes: device.notes || ''
    },
    timeline: filteredTimeline.slice(0, 40)
  };
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
  const graphScope = portalScopeWhere(user, 'g');
  const { rows: scheduleRows } = await pool.query(
    `with scoped_branches as (
       select distinct g.branch_id
       from api.active_customer_graph g
       where g.branch_id is not null ${graphScope.sql}
     )
     select concat('schedule:', s.id)::text as id,
            b.company_id as "companyId",
            s.branch_id as "branchId",
            s.machine_id as "deviceId",
            null as "requesterUserId",
            'Pending' as status,
            coalesce(nullif(s.customer_request, ''), nullif(s.remarks, ''), case when s.purpose_id = '3' then 'Pending toner / ink delivery' else 'Pending cartridge delivery' end) as notes,
            s.scheduled_date::text as "createdAt",
            s.scheduled_date::text as "updatedAt"
     from marga.service_schedules s
     left join marga.branches b on b.id = s.branch_id
     where s.branch_id in (select branch_id from scoped_branches)
       and s.purpose_id in ('3', '4')
       and s.date_finished is null
       and coalesce(s.is_ongoing, false) is false
       and s.scheduled_date >= current_date - interval '180 days'
     order by s.scheduled_date desc, s.id desc
     limit 150`,
    graphScope.params
  );
  const { rows: historyRows } = await pool.query(
    `with scoped_devices as (
       select distinct on (lower(trim(coalesce(nullif(g.display_serial, ''), nullif(g.machine_serial, '')))))
              g.company_id,
              g.branch_id,
              g.machine_id,
              lower(trim(coalesce(nullif(g.display_serial, ''), nullif(g.machine_serial, '')))) as serial_key
       from api.active_customer_graph g
       where coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) is not null
         ${graphScope.sql}
       order by lower(trim(coalesce(nullif(g.display_serial, ''), nullif(g.machine_serial, '')))), g.contract_id desc
     )
     select d.doc_id as id,
            sd.company_id as "companyId",
            sd.branch_id as "branchId",
            sd.machine_id as "deviceId",
            null as "requesterUserId",
            'Fulfilled' as status,
            coalesce(d.data->>'remarks', d.data->>'notes', '') as notes,
            coalesce(d.data->>'tmestamp', d.data->>'date_purchase', d.imported_at::text) as "createdAt",
            coalesce(d.data->>'tmestamp', d.data->>'date_purchase', d.updated_at::text) as "updatedAt"
     from app_meta.firestore_documents d
     join scoped_devices sd
       on sd.serial_key = lower(trim(coalesce(d.data->>'serial', '')))
     where d.collection = 'tbl_newtonerinkhistory'
     order by d.doc_id desc
     limit 150`,
    graphScope.params
  );
  return [...portalRows, ...scheduleRows, ...historyRows].slice(0, 250);
}

async function listTickets(user) {
  const scope = portalScopeWhere(user, 't');
  const { rows: portalRows } = await pool.query(
    `select t.id::text, t.ticket_no as "ticketNo", t.company_id as "companyId", t.branch_id as "branchId",
            t.machine_id as "deviceId", t.requester_user_id as "requesterUserId", t.category,
            t.description, t.priority, t.status, t.created_at as "createdAt", t.updated_at as "updatedAt"
     from marga.portal_service_tickets t
     where true ${scope.sql}
     order by t.updated_at desc limit 250`,
    scope.params
  );
  const graphScope = portalScopeWhere(user, 'g');
  const { rows: scheduleRows } = await pool.query(
    `with scoped_branches as (
       select distinct g.branch_id
       from api.active_customer_graph g
       where g.branch_id is not null ${graphScope.sql}
     )
     select concat('schedule:', s.id)::text as id,
            concat('LEG-', s.legacy_id::text) as "ticketNo",
            b.company_id as "companyId",
            s.branch_id as "branchId",
            s.machine_id as "deviceId",
            null as "requesterUserId",
            'Service' as category,
            coalesce(nullif(s.customer_request, ''), nullif(s.remarks, ''), 'Service schedule') as description,
            'Normal' as priority,
            'Open' as status,
            s.scheduled_date::text as "createdAt",
            coalesce(s.date_finished::text, s.scheduled_date::text) as "updatedAt"
     from marga.service_schedules s
     left join marga.branches b on b.id = s.branch_id
     where s.branch_id in (select branch_id from scoped_branches)
       and s.purpose_id = '5'
       and s.date_finished is null
       and coalesce(s.is_ongoing, false) is false
       and s.scheduled_date >= current_date - interval '180 days'
     order by s.scheduled_date desc, s.id desc
     limit 150`,
    graphScope.params
  );
  return [...portalRows, ...scheduleRows].slice(0, 250);
}

async function listInvoices(user) {
  const scope = portalScopeWhere(user, 'i');
  const { rows } = await pool.query(
    `select i.id::text, i.company_id as "companyId", i.branch_id as "branchId",
            coalesce(nullif(b.name,''), '') as "branchName",
            i.invoice_no as "invoiceNo",
            case
              when i.billing_year is not null and i.billing_month is not null and i.billing_month > 0
              then concat(i.billing_year::text, '-', lpad(i.billing_month::text, 2, '0'))
              when i.billing_year is not null and i.invoice_date is not null
              then concat(i.billing_year::text, '-', lpad(extract(month from i.invoice_date)::text, 2, '0'))
              when i.invoice_date is not null
              then to_char(i.invoice_date, 'YYYY-MM')
              else ''
            end as period,
            i.total_amount as amount,
            i.invoice_date as "dueDate",
            case
              when i.status is null or i.status = '' or i.status = '0' then 'Unpaid'
              else i.status
            end as status
     from marga.billing_invoices i
     left join marga.branches b on b.id = i.branch_id
     where true ${scope.sql}
     order by i.invoice_date desc nulls last, i.invoice_no, b.name limit 500`,
    scope.params
  );
  return rows;
}

async function listPayments(user) {
  // For grouped/company accounts, scope to company_id only (branch_id on payments can differ
  // from the grouped invoice's branch_id, causing empty results for CBS-style accounts).
  const companyScope = user.companyId
    ? { sql: 'and i.company_id = $1', params: [user.companyId] }
    : portalScopeWhere(user, 'i');
  const { rows } = await pool.query(
    `select p.id::text, p.invoice_id::text as "invoiceId", i.company_id as "companyId", i.branch_id as "branchId",
            p.payment_amount as amount, p.payment_date as date, p.or_no as "referenceNo",
            coalesce(nullif(p.deduction_type, ''), 'Payment') as method
     from marga.payments p
     join marga.billing_invoices i on i.id = p.invoice_id
     where true ${companyScope.sql}
     order by p.payment_date desc nulls last limit 250`,
    companyScope.params
  );
  return rows;
}

async function listSigners(user) {
  const scope = portalScopeWhere(user, 'b', { branch: 'id' });
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

async function createTonerRequest(user, body, photoFile = null) {
  const internal = user.role === 'marga_admin' || user.role === 'marga_staff';
  const branchId = internal ? (Number(body.branchId || user.branchId || 0) || null) : (user.branchId || null);
  const companyId = internal ? (Number(body.companyId || user.companyId || 0) || null) : (user.companyId || null);
  const deviceId = Number(body.deviceId || body.machineId || 0) || null;
  const photoUrl = photoFile ? (await saveUploadedFile(photoFile, 'toner').catch(() => null)) : null;
  const { rows } = await pool.query(
    `insert into marga.portal_toner_requests (company_id, branch_id, machine_id, requester_user_id, requester_name, notes, photo_url)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict do nothing
     returning id::text, company_id as "companyId", branch_id as "branchId", machine_id as "deviceId",
       requester_user_id as "requesterUserId", status, notes, photo_url as "photoUrl",
       created_at as "createdAt", updated_at as "updatedAt"`,
    [companyId, branchId, deviceId, user.id, user.name, String(body.notes || ''), photoUrl]
  ).catch(async () => {
    // Fallback if photo_url column does not exist yet
    return pool.query(
      `insert into marga.portal_toner_requests (company_id, branch_id, machine_id, requester_user_id, requester_name, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id::text, company_id as "companyId", branch_id as "branchId", machine_id as "deviceId",
         requester_user_id as "requesterUserId", status, notes,
         created_at as "createdAt", updated_at as "updatedAt"`,
      [companyId, branchId, deviceId, user.id, user.name, String(body.notes || '')]
    );
  });
  const result = rows[0] || {};
  await auditLog({ userId: user.id, action: 'toner_request_created', entityType: 'portal_toner_request', entityId: result.id, metadata: { branchId, companyId, deviceId, hasPhoto: !!photoUrl } });
  return result;
}

async function createTicket(user, body, photoFile = null) {
  const internal = user.role === 'marga_admin' || user.role === 'marga_staff';
  const branchId = internal ? (Number(body.branchId || user.branchId || 0) || null) : (user.branchId || null);
  const companyId = internal ? (Number(body.companyId || user.companyId || 0) || null) : (user.companyId || null);
  const deviceId = Number(body.deviceId || body.machineId || 0) || null;
  const ticketNo = `CARE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;
  const photoUrl = photoFile ? (await saveUploadedFile(photoFile, 'ticket').catch(() => null)) : null;
  const { rows } = await pool.query(
    `insert into marga.portal_service_tickets (ticket_no, company_id, branch_id, machine_id, requester_user_id, requester_name, category, description, priority, photo_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id::text, ticket_no as "ticketNo", company_id as "companyId", branch_id as "branchId",
       machine_id as "deviceId", requester_user_id as "requesterUserId", category, description, priority, status,
       photo_url as "photoUrl", created_at as "createdAt", updated_at as "updatedAt"`,
    [ticketNo, companyId, branchId, deviceId, user.id, user.name, String(body.category || 'Service'), String(body.description || ''), String(body.priority || 'Normal'), photoUrl]
  ).catch(async () => {
    // Fallback if photo_url column does not exist yet
    return pool.query(
      `insert into marga.portal_service_tickets (ticket_no, company_id, branch_id, machine_id, requester_user_id, requester_name, category, description, priority)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id::text, ticket_no as "ticketNo", company_id as "companyId", branch_id as "branchId",
         machine_id as "deviceId", requester_user_id as "requesterUserId", category, description, priority, status,
         created_at as "createdAt", updated_at as "updatedAt"`,
      [ticketNo, companyId, branchId, deviceId, user.id, user.name, String(body.category || 'Service'), String(body.description || ''), String(body.priority || 'Normal')]
    );
  });
  const result = rows[0] || {};
  await auditLog({ userId: user.id, action: 'ticket_created', entityType: 'portal_service_ticket', entityId: result.id, metadata: { branchId, companyId, deviceId, hasPhoto: !!photoUrl } });
  return result;
}

async function summary(user) {
  const [devices, tickets, toner, invoices] = await Promise.all([
    listDevices(user),
    listTickets(user),
    listTonerRequests(user),
    listInvoices(user)
  ]);
  const unpaid = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
  const openTickets = tickets.filter((ticket) => {
    const status = String(ticket.status || '').toLowerCase();
    return !['completed', 'closed', 'done', 'cancelled', 'canceled'].includes(status);
  }).length;
  const pendingToner = toner.filter((request) => {
    const status = String(request.status || '').toLowerCase();
    return ['pending', 'requested', 'open', 'assigned'].includes(status);
  }).length;
  return {
    activeDevices: devices.length,
    openTickets,
    pendingToner,
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
       select g.company_id,
              count(distinct ${activeGraphDeviceKeySql('g')})::integer as active_devices,
              count(distinct case when g.branch_id is null then ${activeGraphDeviceKeySql('g')} end)::integer as direct_devices,
              count(distinct g.branch_id) filter (where g.branch_id is not null)::integer as active_branches
       from api.active_customer_graph g
       group by g.company_id
     ),
     reps as (
       select distinct on (company_id)
              company_id,
              id as account_id,
              login,
              mobile_user_id,
              display_name,
              active,
              last_password_generated_at,
              last_credentials_sent_at,
              credential_delivery_email
       from marga.portal_accounts
       where role in ('company_admin', 'company_representative', 'mother_representative', 'branch_user', 'end_user')
       order by company_id, case when role in ('company_admin', 'company_representative', 'mother_representative') then 0 else 1 end, updated_at desc
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
            reps.mobile_user_id as fallback_login,
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
          fallbackLogin: row.fallback_login,
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
    `select distinct on (${activeGraphDeviceKeySql('g')})
            ${activeGraphDeviceKeySql('g')} as id,
            g.machine_legacy_id as legacy_id,
            coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), ''), 'N/A') as serial,
            ${machineModelSql('m')} as model,
            g.branch_id as "branchId",
            coalesce(g.branch_name, '') as "branchName"
     from api.active_customer_graph g
     left join marga.machines m on m.id = g.machine_id
     where g.company_id = $1
     order by ${activeGraphDeviceKeySql('g')}, g.branch_name nulls last, g.contract_id desc
     limit 1000`,
    [company.id]
  );
  const { rows: accounts } = await pool.query(
    `select id, login, mobile_user_id as "fallbackLogin", display_name as "displayName", role, active, company_id as "companyId", branch_id as "branchId",
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
  const { rows: companyRows } = await pool.query(
    `select concat('C', lpad(coalesce(legacy_id, id)::text, 5, '0')) as code
     from marga.companies
     where id = $1
     limit 1`,
    [companyId]
  );
  const companyCode = cleanText(companyRows[0]?.code);
  const generate = body.generatePassword !== false;
  const password = generate ? randomSixDigitPassword() : null;
  const hash = passwordHash(password || randomSixDigitPassword());
  const params = generate
    ? [
        email,
        name,
        companyId,
        companyCode,
        hash.password_hash,
        hash.password_salt,
        hash.password_iterations,
        hash.password_algorithm,
        hash.password_memory,
        hash.password_passes,
        hash.password_parallelism,
        hash.password_tag_length,
        email
      ]
    : [email, name, companyId, companyCode, email];
  const sql = generate
    ? `insert into marga.portal_accounts (
         login, display_name, role, company_id, mobile_user_id, password_hash, password_salt, password_iterations,
         password_algorithm, password_memory, password_passes, password_parallelism, password_tag_length,
         active, must_change_password, last_password_generated_at, credential_delivery_email, updated_at
       )
       values ($1, $2, 'company_admin', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, true, now(), $13, now())
       on conflict (login) do update set
         display_name = excluded.display_name,
         role = 'company_admin',
         company_id = excluded.company_id,
         mobile_user_id = excluded.mobile_user_id,
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         password_iterations = excluded.password_iterations,
         password_algorithm = excluded.password_algorithm,
         password_memory = excluded.password_memory,
         password_passes = excluded.password_passes,
         password_parallelism = excluded.password_parallelism,
         password_tag_length = excluded.password_tag_length,
         active = true,
         must_change_password = true,
         last_password_generated_at = now(),
         credential_delivery_email = excluded.credential_delivery_email,
         updated_at = now()
       returning id, login, mobile_user_id as "fallbackLogin", display_name as "displayName", role, company_id as "companyId",
         active, last_password_generated_at as "lastPasswordGeneratedAt", credential_delivery_email as "credentialDeliveryEmail"`
    : `insert into marga.portal_accounts (
         login, display_name, role, company_id, mobile_user_id, password_hash, password_salt, password_iterations,
         password_algorithm, password_memory, password_passes, password_parallelism, password_tag_length,
         active, credential_delivery_email, updated_at
       )
       values ($1, $2, 'company_admin', $3, $4, '', '', 120000, null, null, null, null, null, true, $5, now())
       on conflict (login) do update set
         display_name = excluded.display_name,
         role = 'company_admin',
         company_id = excluded.company_id,
         mobile_user_id = excluded.mobile_user_id,
         active = true,
         credential_delivery_email = excluded.credential_delivery_email,
         updated_at = now()
       returning id, login, mobile_user_id as "fallbackLogin", display_name as "displayName", role, company_id as "companyId",
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
         password_algorithm = $5,
         password_memory = $6,
         password_passes = $7,
         password_parallelism = $8,
         password_tag_length = $9,
         must_change_password = true,
         last_password_generated_at = now(),
         updated_at = now()
     where id = $1
     returning id, login, display_name as "displayName", role, company_id as "companyId",
       active, last_password_generated_at as "lastPasswordGeneratedAt", credential_delivery_email as "credentialDeliveryEmail"`,
    [
      Number(accountId),
      hash.password_hash,
      hash.password_salt,
      hash.password_iterations,
      hash.password_algorithm,
      hash.password_memory,
      hash.password_passes,
      hash.password_parallelism,
      hash.password_tag_length
    ]
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

function smtpEscape(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

function mailAddress(value) {
  return String(value || '').trim().replace(/[<>\r\n]/g, '');
}

function smtpSendCommand(socket, command, expectedCodes) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const expected = new Set(expectedCodes);
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      cleanup();
      if (expected.has(code)) resolve(buffer);
      else reject(new Error(`SMTP ${code}: ${buffer.trim()}`));
    };
    socket.on('data', onData);
    socket.on('error', onError);
    if (command) socket.write(`${command}\r\n`);
  });
}

async function sendHostingerEmail(message) {
  if (!CARE_SMTP_PASSWORD) {
    return {
      sent: false,
      needsHostingerSmtp: true,
      message: 'Hostinger SMTP password is not configured. Set MARGA_CARE_SMTP_PASSWORD on the server.'
    };
  }

  const from = mailAddress(CARE_SMTP_FROM);
  const to = mailAddress(message.to);
  if (!to) {
    const error = new Error('Target email is required before sending credentials.');
    error.statusCode = 400;
    throw error;
  }

  const socket = tls.connect({
    host: CARE_SMTP_HOST,
    port: CARE_SMTP_PORT,
    servername: CARE_SMTP_HOST,
    timeout: 15000
  });

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('timeout', () => reject(new Error('SMTP connection timed out.')));
    socket.once('error', reject);
  });

  try {
    await smtpSendCommand(socket, '', [220]);
    await smtpSendCommand(socket, `EHLO ${CARE_SMTP_HOST}`, [250]);
    await smtpSendCommand(socket, 'AUTH LOGIN', [334]);
    await smtpSendCommand(socket, Buffer.from(CARE_SMTP_USER).toString('base64'), [334]);
    await smtpSendCommand(socket, Buffer.from(CARE_SMTP_PASSWORD).toString('base64'), [235]);
    await smtpSendCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await smtpSendCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpSendCommand(socket, 'DATA', [354]);
    const payload = [
      `From: Marga Care <${from}>`,
      `To: ${to}`,
      `Subject: ${smtpEscape(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      smtpEscape(message.body),
      '.'
    ].join('\r\n');
    await smtpSendCommand(socket, payload, [250]);
    await smtpSendCommand(socket, 'QUIT', [221]);
    return { sent: true, needsHostingerSmtp: false, message: 'Credential email sent.' };
  } finally {
    socket.destroy();
  }
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
  const passwordText = cleanText(body.password);
  if (body.send === true && !passwordText) {
    const error = new Error('Generate a fresh password first, then send the credential email.');
    error.statusCode = 400;
    throw error;
  }
  const preview = credentialEmail(rows[0], passwordText || 'recent generated password');
  const delivery = body.send === true ? await sendHostingerEmail(preview) : {
    sent: false,
    needsHostingerSmtp: !CARE_SMTP_PASSWORD,
    message: CARE_SMTP_PASSWORD ? 'Email preview is ready.' : 'Email preview is ready. Real sending needs MARGA_CARE_SMTP_PASSWORD.'
  };
  if (delivery.sent) {
    await pool.query(
      `update marga.portal_accounts
       set last_credentials_sent_at = now(),
           credential_delivery_email = $2,
           updated_at = now()
       where id = $1`,
      [Number(accountId), preview.to]
    );
  }
  await auditLog({
    userId: user.id,
    action: delivery.sent ? 'marga_care_credential_email_sent' : 'marga_care_credential_email_previewed',
    entityType: 'portal_account',
    entityId: String(accountId),
    req,
    metadata: { to: preview.to, sent: delivery.sent }
  });
  return {
    ...delivery,
    preview
  };
}

async function handlePortalApi(req, res, url) {
  await ensurePortalSchemaReady();
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

  // ── Public Registration Routes (no auth required) ────────────────────
  // GET /portal-api/register/company?code=C00072
  if (url.pathname === '/portal-api/register/company' && req.method === 'GET') {
    const code = url.searchParams.get('code') || '';
    if (!code) return json(res, 400, { ok: false, message: 'Company code is required.' });
    const company = await lookupCompanyByCode(code);
    if (!company) return json(res, 404, { ok: false, message: 'Company code not found. Please check the code and try again.' });
    return json(res, 200, { ok: true, company: { id: company.id, name: company.name, code: company.company_code } });
  }

  // GET /portal-api/register/branches?companyId=836
  if (url.pathname === '/portal-api/register/branches' && req.method === 'GET') {
    const companyId = Number(url.searchParams.get('companyId') || 0);
    if (!companyId) return json(res, 400, { ok: false, message: 'companyId is required.' });
    const branches = await listRegistrableBranches(companyId);
    return json(res, 200, { ok: true, branches });
  }

  // POST /portal-api/register/claim
  if (url.pathname === '/portal-api/register/claim' && req.method === 'POST') {
    const result = await claimBranchAccount(await readJson(req), req);
    return json(res, result.status, result.data);
  }

  let user = authUser(req);
  if (!user) {
    if (url.pathname === '/portal-api/preview-login' && req.method === 'POST') {
      return json(res, 200, await previewLogin(await readJson(req), req));
    }
    json(res, 401, { ok: false, message: 'Session expired. Please sign in again.' });
    return;
  }

  // Allow client to scope queries to a specific active company (group switcher)
  // Only apply if the user is an overseer with multiple companies — single-company users
  // should never be able to switch scope to an arbitrary company.
  const activeCompanyParam = url.searchParams.get('activeCompanyId');
  const isMultiCompanyOverseer = Array.isArray(user.companyIds) && user.companyIds.length > 1;
  if (activeCompanyParam && isMultiCompanyOverseer && user.companyIds.includes(Number(activeCompanyParam))) {
    user = { ...user, activeCompanyId: Number(activeCompanyParam), companyId: Number(activeCompanyParam) };
  }

  if (url.pathname === '/portal-api/me') return json(res, 200, { ok: true, user });

  // Return all companies this user has access to (for group switcher UI)
  if (url.pathname === '/portal-api/my-companies') {
    const companyIds = Array.isArray(user.companyIds) && user.companyIds.length > 0
      ? user.companyIds : [user.companyId].filter(Boolean);
    if (!companyIds.length) return json(res, 200, { ok: true, companies: [] });
    const { rows } = await pool.query(
      `select id, name, inactive from marga.companies where id = any($1::bigint[]) order by name`,
      [companyIds]
    );
    return json(res, 200, { ok: true, companies: rows.map(c => ({
      id: Number(c.id), name: c.name, inactive: c.inactive
    })) });
  }
  if (url.pathname === '/portal-api/admin/care/customer-search' && req.method === 'GET') {
    return json(res, 200, { ok: true, accounts: await searchInternalPreviewAccounts(user, url.searchParams.get('q') || '') });
  }
  if (url.pathname === '/portal-api/admin/care/preview-launch' && req.method === 'POST') {
    return json(res, 200, { ok: true, ...(await createPreviewLaunch(user, await readJson(req), req)) });
  }
  if (url.pathname === '/portal-api/admin/care/branch-detail' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      detail: await getPreviewBranchDetail(
        user,
        url.searchParams.get('companyId'),
        url.searchParams.get('branchId'),
        url.searchParams.get('companyIds')
      )
    });
  }
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

  // ── Admin Credential & Access Management Routes ──────────────────────────

  // GET /portal-api/admin/pending-devices?companyId= — devices with no machine link or bad data
  if (url.pathname === '/portal-api/admin/pending-devices' && req.method === 'GET') {
    requireInternalUser(user);
    const companyId = url.searchParams.get('companyId') || '';
    const companyFilter = companyId ? `and g.company_id = ${Number(companyId)}` : '';
    const { rows } = await pool.query(`
      select 
        g.contract_id::text as "contractId",
        g.branch_id::text as "branchId",
        regexp_replace(coalesce(g.branch_name,''), '^~x+\s*', '', 'i') as "branchName",
        coalesce(nullif(trim(coalesce(g.display_serial,'')),  ''),
                 nullif(trim(coalesce(g.machine_serial,'')), ''), 'N/A') as serial,
        g.machine_id::text as "machineId",
        g.machine_status_id::text as "machineStatusId",
        g.company_id::text as "companyId",
        c.name as "companyName",
        (select count(*) from marga.billing_invoices i 
         where i.branch_id = g.branch_id and i.company_id = g.company_id) as "invoiceCount",
        (select max(i.invoice_date) from marga.billing_invoices i 
         where i.branch_id = g.branch_id and i.company_id = g.company_id) as "lastInvoice"
      from api.active_customer_graph g
      join marga.companies c on c.id = g.company_id
      where (g.machine_id is null or g.machine_status_id is null
             or coalesce(g.display_serial,'') = '')
        ${companyFilter}
      order by "invoiceCount" desc, "branchName"
      limit 200
    `);
    return json(res, 200, { ok: true, devices: rows });
  }

  // GET /portal-api/admin/credentials?q=&role=&status=&page=
  if (url.pathname === '/portal-api/admin/credentials' && req.method === 'GET') {
    return json(res, 200, await adminListCredentials(user, url.searchParams));
  }

  // PATCH /portal-api/admin/credentials/:id  — update name/email/login/active
  const credPatchMatch = url.pathname.match(/^\/portal-api\/admin\/credentials\/(\d+)$/);
  if (credPatchMatch && req.method === 'PATCH') {
    return json(res, 200, await adminUpdateCredential(user, credPatchMatch[1], await readJson(req), req));
  }

  // POST /portal-api/admin/credentials/:id/toggle-active
  const credToggleMatch = url.pathname.match(/^\/portal-api\/admin\/credentials\/(\d+)\/toggle-active$/);
  if (credToggleMatch && req.method === 'POST') {
    return json(res, 200, await adminToggleCredentialActive(user, credToggleMatch[1], req));
  }

  // POST /portal-api/admin/credentials/:id/link-company  — add company scope
  const credLinkMatch = url.pathname.match(/^\/portal-api\/admin\/credentials\/(\d+)\/link-company$/);
  if (credLinkMatch && req.method === 'POST') {
    return json(res, 200, await adminLinkCompany(user, credLinkMatch[1], await readJson(req), req));
  }

  // DELETE /portal-api/admin/credentials/:id/unlink-company/:companyId
  const credUnlinkMatch = url.pathname.match(/^\/portal-api\/admin\/credentials\/(\d+)\/unlink-company\/(\d+)$/);
  if (credUnlinkMatch && req.method === 'DELETE') {
    return json(res, 200, await adminUnlinkCompany(user, credUnlinkMatch[1], credUnlinkMatch[2], req));
  }
  if (url.pathname === '/portal-api/company') {
    const requestedCompanyId = url.searchParams.get('companyId');
    const companyId = isInternalPortalUser(user)
      ? (requestedCompanyId || 'marga_internal')
      : user.companyId;
    return json(res, 200, { ok: true, company: await getCompany(companyId) });
  }
  if (url.pathname === '/portal-api/companies') return json(res, 200, { ok: true, companies: await listCompanies(user) });
  if (url.pathname === '/portal-api/branches') {
    return json(res, 200, { ok: true, branches: await listBranches(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/devices') {
    return json(res, 200, { ok: true, devices: await listDevices(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/device-detail') {
    return json(res, 200, {
      ok: true,
      detail: await getDeviceDetail(
        previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds')),
        url.searchParams.get('deviceId')
      )
    });
  }
  if (url.pathname === '/portal-api/tickets' && req.method === 'GET') {
    return json(res, 200, { ok: true, tickets: await listTickets(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/tickets' && req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      const { fields, files } = await readMultipart(req);
      return json(res, 200, { ok: true, ticket: await createTicket(user, fields, files.attachment || null) });
    }
    return json(res, 200, { ok: true, ticket: await createTicket(user, await readJson(req)) });
  }
  if (url.pathname === '/portal-api/toner-requests' && req.method === 'GET') {
    return json(res, 200, { ok: true, tonerRequests: await listTonerRequests(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/toner-requests' && req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      const { fields, files } = await readMultipart(req);
      return json(res, 200, { ok: true, tonerRequest: await createTonerRequest(user, fields, files.attachment || null) });
    }
    return json(res, 200, { ok: true, tonerRequest: await createTonerRequest(user, await readJson(req)) });
  }
  if (url.pathname === '/portal-api/invoices') {
    return json(res, 200, { ok: true, invoices: await listInvoices(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/payments') {
    return json(res, 200, { ok: true, payments: await listPayments(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/signers') {
    return json(res, 200, { ok: true, signers: await listSigners(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
  if (url.pathname === '/portal-api/summary') {
    return json(res, 200, { ok: true, summary: await summary(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds'))) });
  }
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
  if (cleanPath === '/register' || cleanPath === '/register.html') return '/public/register.html';

  // For root-level paths like /register.html, /manifest.json etc — serve from /public/
  // Only if cleanPath doesn't already start with /public or /src or /assets
  if (!cleanPath.startsWith('/public/') && !cleanPath.startsWith('/src/') && !cleanPath.startsWith('/install/')) {
    const publicCandidate = '/public' + cleanPath;
    return publicCandidate;
  }

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

// ── Admin Credential & Access Management ─────────────────────────────────

async function adminListCredentials(user, params) {
  requireInternalUser(user);
  const q = String(params.get('q') || '').trim().toLowerCase();
  const roleFilter = params.get('role') || '';        // company_admin | branch_user
  const statusFilter = params.get('status') || '';    // new | changed | active
  const activeFilter = params.get('active') || '';    // true | false
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const conditions = ["1=1"];
  const vals = [];
  let p = 1;

  if (q) {
    conditions.push(`(lower(pa.login) like $${p} or lower(pa.display_name) like $${p} or lower(pa.credential_delivery_email) like $${p} or lower(c.name) like $${p})`);
    vals.push(`%${q}%`); p++;
  }
  if (roleFilter) { conditions.push(`pa.role = $${p}`); vals.push(roleFilter); p++; }
  if (statusFilter === 'new') { conditions.push(`pa.must_change_password = true`); }
  else if (statusFilter === 'changed') { conditions.push(`pa.must_change_password = false and pa.last_password_generated_at is not null`); }
  if (activeFilter === 'true') { conditions.push(`pa.active = true`); }
  else if (activeFilter === 'false') { conditions.push(`pa.active = false`); }

  const where = conditions.join(' and ');

  const countRes = await pool.query(
    `select count(*) as total from marga.portal_accounts pa
     left join marga.companies c on c.id = pa.company_id
     where ${where}`, vals);
  const total = Number(countRes.rows[0].total);

  const { rows } = await pool.query(
    `select pa.id, pa.login, pa.display_name as "displayName", pa.role,
            pa.company_id as "companyId", c.name as "companyName",
            pa.branch_id as "branchId",
            pa.active, pa.must_change_password as "mustChangePassword",
            pa.contact_email as "contactEmail",
            pa.registered_name as "registeredName",
            pa.registered_at as "registeredAt",
            pa.credential_delivery_email as "deliveryEmail",
            pa.last_password_generated_at as "lastPasswordGeneratedAt",
            pa.updated_at as "updatedAt",
            (select array_agg(cas.company_id order by cas.company_id)
             from marga.care_account_scopes cas
             where cas.account_id = pa.id and cas.scope_type = 'company' and cas.active = true
            ) as "linkedCompanyIds",
            (select array_agg(cn.name order by cn.name)
             from marga.care_account_scopes cas
             join marga.companies cn on cn.id = cas.company_id
             where cas.account_id = pa.id and cas.scope_type = 'company' and cas.active = true
            ) as "linkedCompanyNames"
     from marga.portal_accounts pa
     left join marga.companies c on c.id = pa.company_id
     where ${where}
     order by c.name, pa.role, pa.display_name
     limit ${pageSize} offset ${offset}`,
    vals
  );

  return { ok: true, accounts: rows, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

async function adminUpdateCredential(user, accountId, body, req) {
  requireInternalUser(user);
  const id = Number(accountId);
  const updates = [];
  const vals = [];
  let p = 1;

  if (body.displayName !== undefined) { updates.push(`display_name = $${p}`); vals.push(String(body.displayName || '').trim()); p++; }
  if (body.deliveryEmail !== undefined) { updates.push(`credential_delivery_email = $${p}`); vals.push(String(body.deliveryEmail || '').trim()); p++; }
  if (body.login !== undefined) { updates.push(`login = $${p}`); vals.push(String(body.login || '').trim()); p++; }

  if (!updates.length) return { ok: false, message: 'Nothing to update.' };
  updates.push(`updated_at = now()`);
  vals.push(id);

  const { rows } = await pool.query(
    `update marga.portal_accounts set ${updates.join(', ')}
     where id = $${p}
     returning id, login, display_name as "displayName", role,
       company_id as "companyId", active,
       credential_delivery_email as "deliveryEmail",
       must_change_password as "mustChangePassword",
       last_password_generated_at as "lastPasswordGeneratedAt"`,
    vals
  );
  if (!rows[0]) return { ok: false, message: 'Account not found.' };
  await auditLog({ userId: user.id, action: 'admin_credential_updated', entityType: 'portal_account', entityId: String(id), req, metadata: body });
  return { ok: true, account: rows[0] };
}

async function adminToggleCredentialActive(user, accountId, req) {
  requireInternalUser(user);
  const id = Number(accountId);
  const { rows } = await pool.query(
    `update marga.portal_accounts set active = not active, updated_at = now()
     where id = $1
     returning id, login, active, display_name as "displayName"`,
    [id]
  );
  if (!rows[0]) return { ok: false, message: 'Account not found.' };
  await auditLog({ userId: user.id, action: rows[0].active ? 'admin_credential_activated' : 'admin_credential_deactivated', entityType: 'portal_account', entityId: String(id), req });
  return { ok: true, account: rows[0] };
}

async function adminLinkCompany(user, accountId, body, req) {
  requireInternalUser(user);
  const id = Number(accountId);
  const companyId = Number(body.companyId);
  if (!companyId) return { ok: false, message: 'companyId required.' };

  // Verify company exists
  const { rows: coRows } = await pool.query(`select id, name from marga.companies where id = $1`, [companyId]);
  if (!coRows[0]) return { ok: false, message: 'Company not found.' };

  await pool.query(
    `insert into marga.care_account_scopes
       (account_id, scope_type, company_id, can_view_billing, can_request_service,
        can_request_toner, can_manage_branch_credentials, active, updated_at)
     values ($1, 'company', $2, true, true, true, true, true, now())
     on conflict (account_id, scope_type,
       coalesce(company_id,0), coalesce(branch_id,0),
       coalesce(machine_id,0), coalesce(contractmain_id,0))
     do update set active = true, updated_at = now()`,
    [id, companyId]
  );
  await auditLog({ userId: user.id, action: 'admin_company_linked', entityType: 'portal_account', entityId: String(id), req, metadata: { companyId, companyName: coRows[0].name } });
  return { ok: true, companyId, companyName: coRows[0].name };
}

async function adminUnlinkCompany(user, accountId, companyId, req) {
  requireInternalUser(user);
  const id = Number(accountId);
  const coId = Number(companyId);

  // Prevent unlinking the primary company_id (would orphan the account)
  const { rows: acct } = await pool.query(`select company_id from marga.portal_accounts where id = $1`, [id]);
  if (acct[0] && Number(acct[0].company_id) === coId) {
    return { ok: false, message: 'Cannot unlink the primary company. Change the primary company or deactivate the account instead.' };
  }

  await pool.query(
    `update marga.care_account_scopes set active = false, updated_at = now()
     where account_id = $1 and company_id = $2 and scope_type = 'company'`,
    [id, coId]
  );
  await auditLog({ userId: user.id, action: 'admin_company_unlinked', entityType: 'portal_account', entityId: String(id), req, metadata: { companyId: coId } });
  return { ok: true };
}


// ── Self-Registration Functions ───────────────────────────────────────────

async function lookupCompanyByCode(code) {
  // Accept C00072 or just 00072 or 72
  const clean = String(code || '').trim().toUpperCase().replace(/^C0*/, '');
  if (!clean) return null;
  const legacyId = String(parseInt(clean, 10));
  const { rows } = await pool.query(
    `select c.id, c.name, c.legacy_id,
            concat('C', lpad(c.legacy_id::text, 5, '0')) as company_code
     from marga.companies c
     where c.legacy_id = $1 and c.inactive is not true`,
    [legacyId]
  );
  return rows[0] || null;
}

async function listRegistrableBranches(companyId) {
  // Return all active branches for this company with registration status
  const { rows } = await pool.query(
    `select b.id, b.legacy_id,
            regexp_replace(b.name, '^~x+\s*', '', 'i') as name,
            coalesce(nullif(trim(b.address),''), '') as address,
            concat('C', lpad(c.legacy_id::text,5,'0'), '-B', lpad(b.legacy_id::text,5,'0')) as branch_code,
            case when pa.id is not null then 'taken' else 'available' end as status,
            pa.registered_name as registered_by
     from marga.branches b
     join marga.companies c on c.id = b.company_id
     left join marga.portal_accounts pa
       on pa.branch_id = b.id
       and pa.role = 'branch_user'
       and pa.active = true
       and pa.contact_email is not null
     where b.company_id = $1
       and b.inactive is not true
       and length(trim(regexp_replace(b.name, '^~x+\s*', '', 'i'))) > 0
     order by regexp_replace(b.name, '^~x+\s*', '', 'i')`,
    [companyId]
  );
  return rows;
}

async function claimBranchAccount(body, req) {
  const companyId = Number(body.companyId);
  const branchId = Number(body.branchId);
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!companyId || !branchId) return { status: 400, data: { ok: false, message: 'Company and branch are required.' } };
  if (!fullName || fullName.length < 2) return { status: 400, data: { ok: false, message: 'Full name is required.' } };
  if (!email || !email.includes('@')) return { status: 400, data: { ok: false, message: 'A valid email is required.' } };
  if (password.length < 8) return { status: 400, data: { ok: false, message: 'Password must be at least 8 characters.' } };

  // Check company exists
  const { rows: coRows } = await pool.query(
    `select id, name from marga.companies where id = $1 and inactive is not true`, [companyId]);
  if (!coRows[0]) return { status: 400, data: { ok: false, message: 'Invalid company.' } };

  // Check branch belongs to company
  const { rows: bRows } = await pool.query(
    `select b.id, regexp_replace(b.name, '^~x+\s*', '', 'i') as name,
            concat('C', lpad(c.legacy_id::text,5,'0'), '-B', lpad(b.legacy_id::text,5,'0')) as branch_code
     from marga.branches b
     join marga.companies c on c.id = b.company_id
     where b.id = $1 and b.company_id = $2 and b.inactive is not true`,
    [branchId, companyId]);
  if (!bRows[0]) return { status: 400, data: { ok: false, message: 'Branch not found in this company.' } };
  const branch = bRows[0];

  // Find the existing portal_account for this branch
  const { rows: acctRows } = await pool.query(
    `select id, login, contact_email, registered_at
     from marga.portal_accounts
     where branch_id = $1 and role = 'branch_user' and active = true`,
    [branchId]);

  if (!acctRows[0]) return { status: 400, data: { ok: false, message: 'No portal account exists for this branch. Please contact Marga.' } };
  const acct = acctRows[0];

  // Check not already self-registered
  if (acct.contact_email && acct.registered_at) {
    return { status: 409, data: { ok: false, message: 'This branch is already registered. If you need access, contact your company overseer or Marga support.' } };
  }

  // Check email not already used by another account
  const { rows: emailCheck } = await pool.query(
    `select id from marga.portal_accounts where contact_email = $1 and id != $2`, [email, acct.id]);
  if (emailCheck.length > 0) {
    return { status: 409, data: { ok: false, message: 'This email is already registered to another account. Please use a different email.' } };
  }

  // Hash the password
  const hash = passwordHash(password);

  // Claim the account
  await pool.query(
    `update marga.portal_accounts set
       contact_email = $1,
       registered_name = $2,
       display_name = $2,
       password_hash = $3,
       password_salt = $4,
       password_iterations = $5,
       password_algorithm = $6,
       password_memory = $7,
       password_passes = $8,
       password_parallelism = $9,
       password_tag_length = $10,
       must_change_password = false,
       registered_at = now(),
       updated_at = now()
     where id = $11`,
    [email, fullName, hash.password_hash, hash.password_salt, hash.password_iterations,
     hash.password_algorithm, hash.password_memory, hash.password_passes,
     hash.password_parallelism, hash.password_tag_length, acct.id]
  );

  await auditLog({ action: 'self_registration', req, metadata: {
    accountId: acct.id, login: acct.login, branchId, companyId, email
  }});

  return { status: 200, data: {
    ok: true,
    login: acct.login,
    branchName: branch.name,
    companyName: coRows[0].name,
    message: 'Registration successful! You can now log in.'
  }};
}

// Also update login to accept contact_email as identifier
async function findPortalAccountByContactEmail(email) {
  const { rows } = await pool.query(
    `select * from marga.portal_accounts where contact_email = $1 and active = true limit 1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
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
