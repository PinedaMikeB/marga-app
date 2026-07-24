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
const MARGABASE_DOCUMENTS_BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL || 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
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
let portalSchemaBootstrapSkipped = false;
let machineStatusCache = null;
let purposeLabelCache = null;

const REQUIRED_PORTAL_TABLES = [
  'portal_toner_requests',
  'portal_service_tickets',
  'portal_accounts',
  'audit_logs',
  'care_company_profiles',
  'care_account_scopes',
  'portal_ticket_events',
  'portal_ticket_messages'
];

// Canonical customer-facing ticket status machine (spec §10).
// routeStatus values are internal/backend-facing; customer-facing labels are derived
// by computeCustomerFacingStatus() below so we never expose internal dispatch language.
const TICKET_ROUTE_STATUSES = [
  'submitted', 'under_review', 'assigned', 'queued', 'included_in_route',
  'next_destination', 'on_the_way', 'arrived', 'in_progress',
  'waiting_customer', 'waiting_parts', 'for_follow_up', 'completed', 'cancelled'
];

// Legacy free-text `status` values (as currently stored) mapped to the new route_status enum.
// Used to backfill/interpret old tickets without breaking existing data (spec: "map existing
// database statuses to the new customer-facing labels where practical").
const LEGACY_STATUS_TO_ROUTE_STATUS = {
  'open': 'submitted',
  'assigned': 'assigned',
  'in progress': 'in_progress',
  'pending follow up': 'for_follow_up',
  'completed': 'completed',
  'fulfilled': 'completed',
  'cancelled': 'cancelled'
};

// Ticket-linked messaging channel modes (spec §25/§29).
const TECH_CHAT_MODES = ['marga_support_only', 'shared_service_team', 'assigned_technician_direct', 'read_only', 'closed'];

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
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.ogv', 'video/ogg'],
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

    -- ── Care Portal: Service Request tracking / assignment / communication (additive) ──
    alter table marga.portal_service_tickets add column if not exists assigned_staff_id text;
    alter table marga.portal_service_tickets add column if not exists assigned_staff_name text;
    alter table marga.portal_service_tickets add column if not exists assignment_id text;
    alter table marga.portal_service_tickets add column if not exists assignment_status text not null default 'unassigned';
    alter table marga.portal_service_tickets add column if not exists route_status text not null default 'submitted';
    alter table marga.portal_service_tickets add column if not exists customer_is_next_destination boolean not null default false;
    alter table marga.portal_service_tickets add column if not exists tracking_enabled boolean not null default false;
    alter table marga.portal_service_tickets add column if not exists staff_latitude double precision;
    alter table marga.portal_service_tickets add column if not exists staff_longitude double precision;
    alter table marga.portal_service_tickets add column if not exists last_location_update timestamptz;
    alter table marga.portal_service_tickets add column if not exists destination_latitude double precision;
    alter table marga.portal_service_tickets add column if not exists destination_longitude double precision;
    alter table marga.portal_service_tickets add column if not exists live_eta_minutes integer;
    alter table marga.portal_service_tickets add column if not exists broad_visit_period text;
    alter table marga.portal_service_tickets add column if not exists confirmed_window_start timestamptz;
    alter table marga.portal_service_tickets add column if not exists confirmed_window_end timestamptz;
    alter table marga.portal_service_tickets add column if not exists on_the_way_at timestamptz;
    alter table marga.portal_service_tickets add column if not exists arrived_at timestamptz;
    alter table marga.portal_service_tickets add column if not exists service_started_at timestamptz;
    alter table marga.portal_service_tickets add column if not exists completed_at timestamptz;
    alter table marga.portal_service_tickets add column if not exists location_permission_status text;
    alter table marga.portal_service_tickets add column if not exists technician_contact_enabled boolean not null default false;
    alter table marga.portal_service_tickets add column if not exists technician_chat_mode text not null default 'marga_support_only';
    alter table marga.portal_service_tickets add column if not exists communication_grace_period_ends_at timestamptz;
    alter table marga.portal_service_tickets add column if not exists cancel_reason text;
    alter table marga.portal_service_tickets add column if not exists internal_priority_score integer;
    alter table marga.portal_service_tickets add column if not exists field_work_machine_status_id integer;
    alter table marga.portal_service_tickets add column if not exists field_work_machine_status text;
    alter table marga.portal_service_tickets add column if not exists schedule_legacy_id text;
    alter table marga.portal_service_tickets add column if not exists schedule_created_at timestamptz;

    create table if not exists marga.portal_ticket_events (
      id bigserial primary key,
      ticket_id bigint not null references marga.portal_service_tickets(id) on delete cascade,
      status text not null,
      customer_visible_note text not null default '',
      internal_note text not null default '',
      reason text,
      next_action text,
      responsible_staff_id text,
      responsible_staff_name text,
      staff_latitude double precision,
      staff_longitude double precision,
      tracking_enabled boolean,
      assignment_id text,
      customer_visible boolean not null default true,
      created_by_user_id text,
      created_at timestamptz not null default now()
    );
    create index if not exists portal_ticket_events_ticket_idx on marga.portal_ticket_events(ticket_id, created_at);

    create table if not exists marga.portal_ticket_messages (
      id bigserial primary key,
      ticket_id bigint not null references marga.portal_service_tickets(id) on delete cascade,
      channel text not null default 'shared_service_team',
      sender_type text not null,
      sender_user_id text,
      sender_name text not null default '',
      body text not null default '',
      photo_url text,
      video_url text,
      visible_to_customer boolean not null default true,
      read_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index if not exists portal_ticket_messages_ticket_idx on marga.portal_ticket_messages(ticket_id, created_at);
  `);
}

function isSchemaCreatePermissionError(error) {
  return error?.code === '42501';
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
    })().catch((error) => {
      portalSchemaReadyPromise = null;
      throw error;
    });
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

function machineWorkStatusLabel(statusId) {
  const id = Number(statusId || 0);
  if (id === 1) return 'Running / Print OK';
  if (id === 2) return 'Running / Print Problem';
  if (id === 3) return 'Down / No Print';
  if (id === 4) return 'Running / Best Mode Only';
  return '';
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

async function patchFirestoreDocument(collection, docId, fields) {
  const body = { fields: {} };
  Object.entries(fields).forEach(([key, value]) => {
    body.fields[key] = firestoreValue(value);
  });
  const url = `${MARGABASE_DOCUMENTS_BASE_URL}/${encodeURIComponent(collection)}/${encodeURIComponent(String(docId))}?key=${encodeURIComponent(MARGABASE_API_KEY)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Failed to write ${collection}/${docId}.`);
  }
  return payload;
}

function manilaDateTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    datetime: `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`
  };
}

function purposeForPortalTicket(category = '') {
  const value = String(category || '').toLowerCase();
  if (value.includes('cartridge')) return { id: 4, label: 'Deliver Cartridge' };
  if (value.includes('toner') || value.includes('ink')) return { id: 3, label: 'Deliver Ink / Toner' };
  return { id: 5, label: 'Service' };
}

function nextManilaServiceSlotParts(date = new Date()) {
  const today = manilaDateTimeParts(date).date;
  const nextDay = new Date(`${today}T00:00:00+08:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDate = manilaDateTimeParts(nextDay).date;
  return {
    date: nextDate,
    datetime: `${nextDate} 08:00:00`
  };
}

function allowedCompanyIdsForPortalUser(user) {
  if (user.activeCompanyId) return [Number(user.activeCompanyId)].filter((id) => Number.isFinite(id) && id > 0);
  if (Array.isArray(user.companyIds) && user.companyIds.length) {
    return user.companyIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  }
  return [Number(user.companyId || 0)].filter((id) => Number.isFinite(id) && id > 0);
}

async function resolvePortalRequestScope(user, body = {}) {
  const internal = user.role === 'marga_admin' || user.role === 'marga_staff';
  const requestedBranchId = Number(body.branchId || user.branchId || 0) || null;
  const requestedCompanyId = Number(body.companyId || user.activeCompanyId || user.companyId || 0) || null;
  if (!requestedBranchId) {
    const error = new Error('Branch is required.');
    error.statusCode = 400;
    throw error;
  }
  if (internal) return { branchId: requestedBranchId, companyId: requestedCompanyId };
  if (user.branchId && Number(user.branchId) !== requestedBranchId) {
    const error = new Error('Selected branch is outside this account.');
    error.statusCode = 403;
    throw error;
  }

  const { rows } = await pool.query(
    `select id as branch_id, company_id
     from marga.branches
     where id = $1
     limit 1`,
    [requestedBranchId]
  );
  const resolvedCompanyId = Number(rows[0]?.company_id || requestedCompanyId || 0) || null;
  const allowedCompanyIds = allowedCompanyIdsForPortalUser(user);
  if (!resolvedCompanyId || (allowedCompanyIds.length && !allowedCompanyIds.includes(resolvedCompanyId))) {
    const error = new Error('Selected branch is outside this account.');
    error.statusCode = 403;
    throw error;
  }
  return { branchId: requestedBranchId, companyId: resolvedCompanyId };
}

async function allocateNextScheduleLegacyId() {
  const { rows } = await pool.query(`
    select greatest(
      coalesce((select max(legacy_id::bigint) from marga.service_schedules where legacy_id ~ '^[0-9]+$'), 0),
      coalesce((select max((data->>'id')::bigint) from app_meta.firestore_documents where collection = 'tbl_schedule' and coalesce(data->>'id', '') ~ '^[0-9]+$'), 0)
    ) + 1 as next_id
  `);
  const nextId = Number(rows[0]?.next_id || 0);
  if (!Number.isFinite(nextId) || nextId <= 0) throw new Error('Unable to allocate schedule id.');
  return nextId;
}

async function buildPortalScheduleContext({ companyId, branchId, deviceId }) {
  const { rows } = await pool.query(
    `select g.company_id, g.company_name, g.branch_id, g.branch_name, g.branch_legacy_id,
            g.machine_id, g.machine_legacy_id, g.contract_id, g.display_serial, g.machine_serial,
            coalesce(nullif(b.area_id, ''), '0') as area_id,
            ${machineModelSql('m')} as machine_model
     from api.active_customer_graph g
     left join marga.branches b on b.id = g.branch_id
     left join marga.machines m on m.id = g.machine_id
     where g.branch_id = $1
       and ($2::bigint is null or g.machine_id = $2)
     order by case when g.company_id = $3 then 0 else 1 end, g.contract_id desc
     limit 1`,
    [branchId, deviceId || null, companyId || null]
  );
  if (rows[0]) return rows[0];

  const fallback = await pool.query(
    `select b.company_id, c.name as company_name, b.id as branch_id, b.name as branch_name,
            b.legacy_id as branch_legacy_id, $2::bigint as machine_id, null as machine_legacy_id,
            null as contract_id, null as display_serial, null as machine_serial,
            coalesce(nullif(b.area_id, ''), '0') as area_id, '' as machine_model
     from marga.branches b
     left join marga.companies c on c.id = b.company_id
     where b.id = $1
     limit 1`,
    [branchId, deviceId || null]
  );
  return fallback.rows[0] || null;
}

async function createScheduleForPortalTicket({ user, ticket, body, machineStatusId, machineStatusLabel }) {
  const branchId = Number(ticket.branchId || body.branchId || 0) || null;
  const companyId = Number(ticket.companyId || body.companyId || 0) || null;
  if (!branchId) throw new Error('Branch is required before creating a service schedule.');
  const deviceId = Number(ticket.deviceId || body.deviceId || body.machineId || 0) || null;
  const context = await buildPortalScheduleContext({ companyId, branchId, deviceId });
  if (!context) throw new Error('Unable to resolve customer branch for service schedule.');

  const nextId = await allocateNextScheduleLegacyId();
  const slot = nextManilaServiceSlotParts();
  const purpose = purposeForPortalTicket(ticket.category || body.category);
  const description = cleanText(body.description || ticket.description || 'Customer portal service request');
  const trouble = cleanText(body.trouble || body.category || ticket.category || 'Customer Portal Request');
  const serialNumber = cleanText(context.display_serial || context.machine_serial || '');
  const scheduleDoc = {
    id: nextId,
    source_module: 'customer_portal',
    portal_ticket_id: Number(ticket.id || 0) || ticket.id,
    portal_ticket_no: ticket.ticketNo || '',
    company_id: Number(context.company_id || companyId || 0) || 0,
    branch_id: Number(context.branch_id || branchId || 0) || 0,
    company_name: cleanText(context.company_name || ''),
    branch_name: cleanText(context.branch_name || ''),
    area_id: Number(context.area_id || 0) || 0,
    serial: Number(context.machine_id || deviceId || 0) || 0,
    field_serial_selected: serialNumber,
    machine_model: cleanText(context.machine_model || ''),
    caller: cleanText(user?.name || ticket.requesterName || 'Customer Portal'),
    phone_number: '',
    purpose_id: purpose.id,
    purpose: purpose.label,
    task_datetime: slot.datetime,
    original_sched: slot.datetime,
    tech_id: 0,
    trouble_id: 0,
    trouble,
    remarks: description,
    status: 1,
    field_work_machine_status_id: machineStatusId,
    field_work_machine_status: machineStatusLabel,
    isongoing: 0,
    date_finished: '0000-00-00 00:00:00',
    iscancel: 0,
    iscancelled: 0,
    scheduled: 1,
    withcomplain: 0,
    withrequest: 1,
    super_urgent: String(ticket.priority || body.priority || '').toLowerCase() === 'critical' ? 1 : 0,
    request_origin: 'customer_portal',
    request_serial_number: serialNumber,
    customer_request: description,
    contractmain_id: Number(context.contract_id || 0) || 0,
    active_customer_graph_source: 'active_contract_customer_graph',
    from_mobileapp: 1,
    from_customer_portal: 1,
    bridge_updated_at: new Date().toISOString(),
    bridge_updated_by: 0,
    automove: 0,
    empty_cart: 0,
    order_cart: 0,
    priority: 0,
    user_id: 0,
    pcname: 'CARE-PORTAL',
    ipadd: '',
    invoice_num: 0,
    collectioninfo_id: 0,
    returning_cart: 0,
    userlog_id: 0,
    closedby: 0,
    amt_collected: 0,
    from_other_source: 0,
    invoice_count: 0,
    commitment_date: '0000-00-00 00:00:00',
    shutdown_date: '0000-00-00 00:00:00',
    committed_by: '',
    oldest_invoice_age: 0,
    soa_status: 0,
    willsettle: 0,
    firebase_key: '',
    iscancelleddate: '',
    csr_status: 0,
    csr_remarks: '',
    meter_reading: 0,
    tl_status: 0,
    tl_remarks: '',
    collocutor: '',
    dev_remarks: ''
  };

  await patchFirestoreDocument('tbl_schedule', nextId, scheduleDoc);
  return { id: nextId, taskDatetime: slot.datetime };
}

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
            g.machine_status_id::text as "graphStatusId",
            coalesce(attention.reasons, array[]::text[]) as "attentionReasons",
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
     left join lateral (
       select array_agg(distinct reason order by reason) as reasons
       from (
         select case
                  when lower(coalesce(t.category, '') || ' ' || coalesce(t.description, '')) like '%change%unit%' then 'Open change unit request'
                  when lower(coalesce(t.category, '') || ' ' || coalesce(t.description, '')) like '%part%' then 'Open change parts request'
                  when lower(coalesce(t.category, '') || ' ' || coalesce(t.description, '')) like '%toner%'
                    or lower(coalesce(t.category, '') || ' ' || coalesce(t.description, '')) like '%ink%' then 'Open toner / ink request'
                  else 'Open service request'
                end as reason
         from marga.portal_service_tickets t
         where t.branch_id = g.branch_id
           and (t.machine_id is null or t.machine_id = g.machine_id)
           and lower(coalesce(t.status, '')) not in ('completed','closed','done','cancelled','canceled')

         union all

         select 'Open toner / ink request' as reason
         from marga.portal_toner_requests r
         where r.branch_id = g.branch_id
           and (r.machine_id is null or r.machine_id = g.machine_id)
           and lower(coalesce(r.status, '')) not in ('fulfilled','completed','closed','done','cancelled','canceled')

         union all

         select case
                  when lower(coalesce(s.customer_request, '') || ' ' || coalesce(s.remarks, '')) like '%change%unit%' then 'Scheduled change unit'
                  when lower(coalesce(s.customer_request, '') || ' ' || coalesce(s.remarks, '')) like '%part%' then 'Scheduled change parts'
                  when coalesce(s.source_data->>'field_work_machine_status', '') <> '' then 'Machine status: ' || (s.source_data->>'field_work_machine_status')
                  when coalesce(s.source_data->>'trouble', '') <> '' then 'Trouble: ' || (s.source_data->>'trouble')
                  when s.purpose_id in ('3','4') then 'Scheduled toner / ink delivery'
                  when s.purpose_id in ('5','9') then 'Scheduled service / repair'
                  else 'Scheduled customer service'
                end as reason
         from marga.service_schedules s
         where s.branch_id = g.branch_id
           and (s.machine_id is null or s.machine_id = g.machine_id)
           and s.purpose_id in ('3','4','5','9')
           and s.date_finished is null
           and coalesce(s.source_data->>'iscancel', '0') <> '1'
           and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
       ) reasons
     ) attention on true
     where true ${scope.sql}
     order by ${activeGraphDeviceKeySql('g')}, lower(coalesce(g.branch_name, '')) nulls last, coalesce(g.display_serial, g.machine_serial, '') nulls last, g.contract_id desc
     limit 1000`,
    scope.params
  );
  return rows.map((row) => {
    const graphStatusId = Number(row.graphStatusId || row.status || 0);
    const machineStatusLabel = statusMap.get(graphStatusId) || (graphStatusId ? `Status ${graphStatusId}` : '');
    const attentionReasons = Array.isArray(row.attentionReasons) ? row.attentionReasons.filter(Boolean) : [];
    const customerLabel = attentionReasons.length ? 'Needs Attention' : 'Active';
    const attentionReason = attentionReasons.join(', ');
    return {
      ...row,
      status: customerLabel,
      fleetStatus: customerLabel,
      graphStatusId,
      machineStatusLabel,
      attentionReasons,
      attentionReason,
      pendingSetup: false,
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
  const [devices, purposeMap] = await Promise.all([
    listDevices(user),
    loadPurposeLabels()
  ]);
  const device = devices.find((entry) => String(entry.id) === deviceId);
  if (!device) {
    const error = new Error('Device was not found in your portal scope.');
    error.statusCode = 404;
    throw error;
  }

  const branchLegacyId = String(device.branchLegacyId || '').trim();
  const displaySerial = cleanText(device.serial !== 'N/A' ? device.serial : '');
  const timeline = [];

  // Customer-visible purpose IDs only — what happens AT their location
  // 3=Deliver Ink/Toner, 4=Deliver Cartridge, 5=Service, 8=Reading, 9=Others
  // Excluded: 1=Billing, 2=Collection, 6=Sales, 7=Purchasing (internal Marga ops)
  const CUSTOMER_PURPOSE_IDS = new Set(['3', '4', '5', '8', '9']);
  const PURPOSE_LABELS = new Map([
    ['3', 'Toner / Ink Delivery'],
    ['4', 'Cartridge Delivery'],
    ['5', 'Maintenance Visit'],
    ['8', 'Meter Reading'],
    ['9', 'Service Visit'],
  ]);

  if (displaySerial || branchLegacyId) {
    // Filter by serial (preferred) then scope to branch
    const scheduleFilter = displaySerial
      ? `and (coalesce(data->>'field_serial_selected', '') = $1 or coalesce(data->>'serial', '') = $1)`
      : `and coalesce(data->>'branch_id', '') = $1`;
    const scheduleParam = displaySerial || branchLegacyId;

    const { rows: scheduleRows } = await pool.query(
      `select doc_id,
              data->>'purpose_id'         as purpose_id,
              data->>'purpose'            as purpose,
              data->>'schedule_purpose'   as schedule_purpose,
              data->>'customer_request'   as customer_request,
              data->>'dev_remarks'        as dev_remarks,
              data->>'remarks'            as remarks,
              data->>'task_datetime'      as task_datetime,
              data->>'created_at'         as created_at,
              data->>'date_finished'      as date_finished,
              data->>'closedby'           as closedby,
              data->>'iscancel'           as iscancel,
              data->>'branch_id'          as branch_id,
              data->>'field_serial_selected' as field_serial
       from app_meta.firestore_documents
       where collection = 'tbl_schedule'
         ${scheduleFilter}
       order by coalesce(data->>'task_datetime', data->>'created_at') desc
       limit 40`,
      [scheduleParam]
    );

    scheduleRows.forEach((row) => {
      // If we searched by serial, scope-check branch to avoid other customers' history
      if (displaySerial && branchLegacyId) {
        const rowBranch = String(row.branch_id || '').trim();
        if (rowBranch && rowBranch !== branchLegacyId) return;
      }
      const purposeId = String(row.purpose_id || '').trim();
      if (!CUSTOMER_PURPOSE_IDS.has(purposeId)) return;

      const cancelled = String(row.iscancel || '').trim() === '1';
      const closedBy = String(row.closedby || '').trim();
      const dateFinished = cleanText(row.date_finished || '');
      const completed = (closedBy && closedBy !== '0') || (dateFinished && dateFinished !== '0000-00-00 00:00:00');
      const status = cancelled ? 'Cancelled' : completed ? 'Completed' : 'Scheduled';

      // Use purpose label from map, fall back to schedule_purpose field, then generic
      const label = PURPOSE_LABELS.get(purposeId)
        || cleanText(row.schedule_purpose || row.purpose)
        || 'Service Visit';

      // Customer-visible notes: prefer customer_request, then dev_remarks summary, skip internal remarks
      const notes = cleanText(row.customer_request || '');

      const at = cleanText(dateFinished && dateFinished !== '0000-00-00 00:00:00'
        ? dateFinished
        : (row.task_datetime || row.created_at || ''));

      timeline.push({
        id: `schedule:${row.doc_id}`,
        type: purposeId === '5' || purposeId === '9' ? 'service' : purposeId === '3' || purposeId === '4' ? 'delivery' : 'visit',
        label,
        status,
        details: notes,
        at
      });
    });
  }

  // Sort by date desc, filter to recent records only
  timeline.sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));
  const filteredTimeline = timeline.filter((item) => keepPortalTimelineRecord(item.at));

  // Billing summary for this branch — unpaid invoices
  let billingSummary = null;
  if (device.branchId) {
    try {
      const { rows: invoiceRows } = await pool.query(
        `select bi.id, bi.invoice_no, bi.invoice_date, bi.due_date, bi.total_amount, bi.status,
                bi.month_label, bi.year_label
         from marga.billing_invoices bi
         where bi.branch_id = $1
           and coalesce(bi.status, '') !~* 'cancel'
         order by bi.invoice_date desc
         limit 24`,
        [device.branchId]
      );
      const unpaid = invoiceRows.filter((r) => !/paid/i.test(String(r.status || '')));
      const totalUnpaid = unpaid.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
      billingSummary = {
        unpaidCount: unpaid.length,
        unpaidAmount: Math.round(totalUnpaid * 100) / 100,
        unpaidInvoices: unpaid.slice(0, 6).map((r) => ({
          invoiceNo: cleanText(r.invoice_no || ''),
          period: cleanText(r.month_label || r.year_label || ''),
          amount: Number(r.total_amount || 0),
          dueDate: cleanText(r.due_date ? String(r.due_date).slice(0, 10) : ''),
          status: cleanText(r.status || 'Pending')
        }))
      };
    } catch (_) {
      billingSummary = null;
    }
  }

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
    billing: billingSummary,
    timeline: filteredTimeline.slice(0, 30)
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
  const { rows: portalRowsRaw } = await pool.query(
    `select t.id::text, t.ticket_no as "ticketNo", t.company_id as "companyId", t.branch_id as "branchId",
            regexp_replace(coalesce(b.name, ''), '^~x+\\s*', '', 'i') as "branchName",
            t.machine_id as "deviceId", t.requester_user_id as "requesterUserId", t.category,
            t.description, t.priority, t.status, t.created_at as "createdAt", t.updated_at as "updatedAt",
            t.field_work_machine_status as "fieldWorkMachineStatus",
            t.field_work_machine_status_id as "fieldWorkMachineStatusId",
            t.assigned_staff_name as "assignedStaffName", t.assignment_status as "assignmentStatus",
            t.route_status as "routeStatus", t.customer_is_next_destination as "customerIsNextDestination",
            t.tracking_enabled as "trackingEnabled", t.live_eta_minutes as "liveEtaMinutes",
            t.broad_visit_period as "broadVisitPeriod", t.confirmed_window_start as "confirmedWindowStart",
            t.confirmed_window_end as "confirmedWindowEnd", t.on_the_way_at as "onTheWayAt",
            t.arrived_at as "arrivedAt", t.service_started_at as "serviceStartedAt", t.completed_at as "completedAt",
            t.technician_contact_enabled as "technicianContactEnabled", t.technician_chat_mode as "technicianChatMode",
            t.communication_grace_period_ends_at as "communicationGracePeriodEndsAt", t.cancel_reason as "cancelReason",
            t.schedule_legacy_id as "scheduleLegacyId", t.schedule_created_at as "scheduleCreatedAt",
            coalesce(
              nullif(s.source_data->>'task_datetime', ''),
              nullif(s.source_data->>'original_sched', ''),
              nullif(s.scheduled_date::text, '2000-12-31')
            ) as "scheduledDate"
     from marga.portal_service_tickets t
     left join marga.branches b on b.id = t.branch_id
     left join marga.service_schedules s on s.legacy_id = t.schedule_legacy_id
     where true ${scope.sql}
     order by t.updated_at desc limit 250`,
    scope.params
  );
  const portalRows = portalRowsRaw.map((t) => ({ ...t, customerStatus: computeCustomerFacingStatus(t) }));
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
            case when s.purpose_id in ('3','4') then 'Toner / Ink' else 'Service' end as category,
            coalesce(nullif(s.customer_request, ''), nullif(s.remarks, ''), 'Service schedule') as description,
            nullif(s.source_data->>'trouble', '') as trouble,
            nullif(s.source_data->>'trouble_id', '') as "troubleId",
            nullif(s.source_data->>'field_work_machine_status', '') as "fieldWorkMachineStatus",
            nullif(s.source_data->>'field_work_machine_status_id', '') as "fieldWorkMachineStatusId",
            'Normal' as priority,
            'Open' as status,
            s.created_at::text as "createdAt",
            coalesce(
              nullif(s.source_data->>'task_datetime', ''),
              nullif(s.source_data->>'original_sched', ''),
              nullif(s.scheduled_date::text, '2000-12-31')
            ) as "scheduledDate",
            coalesce(s.updated_at::text, s.scheduled_date::text) as "updatedAt",
            regexp_replace(coalesce(b.name, ''), '^~x+\\s*', '', 'i') as "branchName"
     from marga.service_schedules s
     left join marga.branches b on b.id = s.branch_id
     where s.branch_id in (select branch_id from scoped_branches)
       and s.purpose_id in ('3','4','5','9')
       and s.date_finished is null
       and coalesce(s.source_data->>'iscancel', '0') <> '1'
       and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
       and coalesce(s.source_data->>'portal_ticket_id', '') = ''
     order by s.created_at asc nulls last, s.scheduled_date asc nulls last, s.id desc
     limit 250`,
    graphScope.params
  );
  const scheduleRowsWithStatus = scheduleRows.map((t) => ({ ...t, customerStatus: computeCustomerFacingStatus(t) }));
  return [...portalRows, ...scheduleRowsWithStatus].slice(0, 250);
}

async function getTicketDetail(user, ticketId) {
  const scope = portalScopeWhere(user, 't');
  const { rows } = await pool.query(
    `select t.id::text, t.ticket_no as "ticketNo", t.company_id as "companyId", t.branch_id as "branchId",
            regexp_replace(coalesce(b.name, ''), '^~x+\s*', '', 'i') as "branchName",
            t.machine_id as "deviceId", t.requester_user_id as "requesterUserId", t.category,
            t.description, t.priority, t.status, t.photo_url as "photoUrl",
            t.field_work_machine_status as "fieldWorkMachineStatus",
            t.field_work_machine_status_id as "fieldWorkMachineStatusId",
            t.created_at as "createdAt", t.updated_at as "updatedAt",
            t.assigned_staff_name as "assignedStaffName", t.assignment_status as "assignmentStatus",
            t.route_status as "routeStatus", t.customer_is_next_destination as "customerIsNextDestination",
            t.tracking_enabled as "trackingEnabled", t.staff_latitude as "staffLatitude",
            t.staff_longitude as "staffLongitude", t.last_location_update as "lastLocationUpdate",
            t.live_eta_minutes as "liveEtaMinutes", t.broad_visit_period as "broadVisitPeriod",
            t.confirmed_window_start as "confirmedWindowStart", t.confirmed_window_end as "confirmedWindowEnd",
            t.on_the_way_at as "onTheWayAt", t.arrived_at as "arrivedAt",
            t.service_started_at as "serviceStartedAt", t.completed_at as "completedAt",
            t.technician_contact_enabled as "technicianContactEnabled", t.technician_chat_mode as "technicianChatMode",
            t.communication_grace_period_ends_at as "communicationGracePeriodEndsAt", t.cancel_reason as "cancelReason"
     from marga.portal_service_tickets t
     left join marga.branches b on b.id = t.branch_id
     where t.id = $1 ${scope.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}
     limit 1`,
    [Number(ticketId), ...scope.params]
  ).catch(() => ({ rows: [] }));
  const ticket = rows[0];
  if (!ticket) return null;
  const includeInternal = isInternalUser(user);
  const [events, messages] = await Promise.all([
    listTicketEvents(ticket.id, { includeInternal }),
    listTicketMessages(user, ticket.id, { includeInternal })
  ]);
  return { ...ticket, customerStatus: computeCustomerFacingStatus(ticket), events, messages };
}

// ── Ticket-linked messaging (spec §4, §25) ───────────────────────────────────
// Separate from the permanent Marga Care top-bar channel. `channel` reflects the
// mode at send time (shared_service_team vs assigned_technician_direct) so history
// stays accurate even after the ticket moves to a different phase.
async function listTicketMessages(user, ticketId, { includeInternal = false } = {}) {
  const { rows } = await pool.query(
    `select id::text, channel, sender_type as "senderType", sender_name as "senderName",
            body, photo_url as "photoUrl", video_url as "videoUrl", created_at as "createdAt"
     from marga.portal_ticket_messages
     where ticket_id = $1 ${includeInternal ? '' : 'and visible_to_customer = true'}
     order by created_at asc`,
    [ticketId]
  );
  return rows;
}

async function sendTicketMessage(user, ticketId, body, photoFile = null) {
  const ticket = await getTicketDetail(user, ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found or not accessible.'), { status: 404 });

  const mode = ticket.technicianChatMode || 'shared_service_team';
  if (mode === 'closed') throw Object.assign(new Error('This conversation is closed.'), { status: 403 });
  if (mode === 'read_only' && !isInternalUser(user)) throw Object.assign(new Error('This conversation is now read-only.'), { status: 403 });

  const senderType = isInternalUser(user) ? 'staff' : 'customer';
  const photoUrl = photoFile ? (await saveUploadedFile(photoFile, 'ticket-message').catch(() => null)) : null;
  const { rows } = await pool.query(
    `insert into marga.portal_ticket_messages (ticket_id, channel, sender_type, sender_user_id, sender_name, body, photo_url)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id::text, channel, sender_type as "senderType", sender_name as "senderName",
       body, photo_url as "photoUrl", created_at as "createdAt"`,
    [Number(ticketId), mode, senderType, user.id, user.name, String(body || ''), photoUrl]
  );
  await pool.query(`update marga.portal_service_tickets set updated_at = now() where id = $1`, [Number(ticketId)]);
  await auditLog({ userId: user.id, action: 'ticket_message_sent', entityType: 'portal_service_ticket', entityId: String(ticketId), metadata: { channel: mode } });
  return rows[0];
}

// ── Internal-only: assignment, status transitions, live location (spec §5, §12-§20, §30) ──
// These are called from Marga-internal tooling (dispatcher UI / tech app), never directly
// by the customer portal. Every call is required to write a timeline event.
async function assignTicketStaff(user, ticketId, { staffId, staffName }) {
  requireInternalUser(user);
  const assignmentId = `AS-${Date.now()}`;
  await pool.query(
    `update marga.portal_service_tickets
     set assigned_staff_id = $2, assigned_staff_name = $3, assignment_id = $4,
         assignment_status = 'assigned', route_status = 'assigned', updated_at = now()
     where id = $1`,
    [Number(ticketId), staffId, staffName, assignmentId]
  );
  await insertTicketEvent(Number(ticketId), {
    status: 'assigned',
    customerVisibleNote: `${staffName} is now assigned to this request.`,
    staffId, staffName, assignmentId, createdByUserId: user.id
  });
  await auditLog({ userId: user.id, action: 'ticket_assigned', entityType: 'portal_service_ticket', entityId: String(ticketId), metadata: { staffId, staffName } });
  return getTicketDetail(user, ticketId);
}

// Allowed route_status transitions and the side effects each one applies, per spec:
// tracking only turns on for on_the_way; technician direct contact only for
// on_the_way/arrived/in_progress/waiting_customer (+ configurable grace period after completed).
const STATUS_SIDE_EFFECTS = {
  under_review: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'marga_support_only' },
  assigned: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'shared_service_team' },
  queued: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'shared_service_team' },
  included_in_route: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'shared_service_team' },
  next_destination: { trackingEnabled: false, customerIsNextDestination: true, technicianChatMode: 'shared_service_team' },
  on_the_way: { trackingEnabled: true, customerIsNextDestination: true, technicianContactEnabled: true, technicianChatMode: 'assigned_technician_direct', stampField: 'on_the_way_at' },
  arrived: { trackingEnabled: false, technicianContactEnabled: true, technicianChatMode: 'assigned_technician_direct', stampField: 'arrived_at' },
  in_progress: { trackingEnabled: false, technicianContactEnabled: true, technicianChatMode: 'assigned_technician_direct', stampField: 'service_started_at' },
  waiting_customer: { trackingEnabled: false, technicianContactEnabled: true, technicianChatMode: 'assigned_technician_direct' },
  waiting_parts: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'shared_service_team' },
  for_follow_up: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'shared_service_team' },
  completed: { trackingEnabled: false, stampField: 'completed_at', gracePeriodHours: 2 },
  cancelled: { trackingEnabled: false, technicianContactEnabled: false, technicianChatMode: 'closed' }
};

async function updateTicketStatus(user, ticketId, { routeStatus, customerVisibleNote, internalNote, reason, liveEtaMinutes, broadVisitPeriod, cancelReason }) {
  requireInternalUser(user);
  if (!TICKET_ROUTE_STATUSES.includes(routeStatus)) {
    throw Object.assign(new Error('Invalid status.'), { status: 400 });
  }
  const effects = STATUS_SIDE_EFFECTS[routeStatus] || {};
  const sets = ['route_status = $2', 'updated_at = now()'];
  const params = [Number(ticketId), routeStatus];
  let i = params.length;

  if ('trackingEnabled' in effects) { sets.push(`tracking_enabled = $${++i}`); params.push(effects.trackingEnabled); }
  if ('customerIsNextDestination' in effects) { sets.push(`customer_is_next_destination = $${++i}`); params.push(effects.customerIsNextDestination); }
  if ('technicianContactEnabled' in effects) { sets.push(`technician_contact_enabled = $${++i}`); params.push(effects.technicianContactEnabled); }
  if (effects.technicianChatMode) { sets.push(`technician_chat_mode = $${++i}`); params.push(effects.technicianChatMode); }
  if (effects.stampField) { sets.push(`${effects.stampField} = now()`); }
  if (effects.gracePeriodHours) { sets.push(`communication_grace_period_ends_at = now() + interval '${Number(effects.gracePeriodHours)} hours'`); }
  if (liveEtaMinutes !== undefined) { sets.push(`live_eta_minutes = $${++i}`); params.push(liveEtaMinutes); }
  if (broadVisitPeriod !== undefined) { sets.push(`broad_visit_period = $${++i}`); params.push(broadVisitPeriod); }
  if (routeStatus === 'cancelled' && cancelReason) { sets.push(`cancel_reason = $${++i}`); params.push(cancelReason); }

  await pool.query(`update marga.portal_service_tickets set ${sets.join(', ')} where id = $1`, params);
  await insertTicketEvent(Number(ticketId), {
    status: routeStatus,
    customerVisibleNote: customerVisibleNote || '',
    internalNote: internalNote || '',
    reason: reason || null,
    trackingEnabled: 'trackingEnabled' in effects ? effects.trackingEnabled : null,
    createdByUserId: user.id
  });
  await auditLog({ userId: user.id, action: 'ticket_status_changed', entityType: 'portal_service_ticket', entityId: String(ticketId), metadata: { routeStatus } });
  return getTicketDetail(user, ticketId);
}

// Field-staff location ping while status = on_the_way. Auto-disables tracking on any
// condition from spec §30 (not on_the_way, stale ping, no assignment, etc.).
async function updateTicketLocation(user, ticketId, { latitude, longitude }) {
  requireInternalUser(user);
  const { rows } = await pool.query(
    `update marga.portal_service_tickets
     set staff_latitude = $2, staff_longitude = $3, last_location_update = now()
     where id = $1 and route_status = 'on_the_way' and tracking_enabled = true
     returning id::text`,
    [Number(ticketId), latitude, longitude]
  );
  if (!rows.length) throw Object.assign(new Error('Tracking is not active for this ticket.'), { status: 409 });
  return { ok: true };
}

async function listInvoices(user) {
  const scope = portalScopeWhere(user, 'i');
  const { rows } = await pool.query(
    `with scoped_invoices as (
       select i.id, i.company_id, i.branch_id, i.invoice_no, i.invoice_date,
              i.billing_year, i.billing_month, coalesce(i.total_amount, 0) as total_amount
       from marga.billing_invoices i
       where true ${scope.sql}
         and nullif(trim(coalesce(i.invoice_no, '')), '') is not null
         and coalesce(i.total_amount, 0) > 0
     ),
     payments_by_invoice_id as (
       select p.invoice_id,
              max(p.balance_amount) filter (where p.balance_amount is not null) as recorded_balance,
              coalesce(sum(p.payment_amount), 0) as paid_amount
       from marga.payments p
       join scoped_invoices i on i.id = p.invoice_id
       group by p.invoice_id
     ),
     payments_by_invoice_no as (
       select i.id as invoice_id,
              max(p.balance_amount) filter (where p.balance_amount is not null) as recorded_balance,
              coalesce(sum(p.payment_amount), 0) as paid_amount
       from scoped_invoices i
       join marga.payments p on p.invoice_no = i.invoice_no
       where p.invoice_id is null
       group by i.id
     ),
     invoice_balances as (
       select i.*,
              case
                when coalesce(pid.recorded_balance, pno.recorded_balance) is not null
                then greatest(coalesce(pid.recorded_balance, pno.recorded_balance), 0)
                else greatest(i.total_amount - coalesce(pid.paid_amount, 0) - coalesce(pno.paid_amount, 0), 0)
              end as unpaid_balance
       from scoped_invoices i
       left join payments_by_invoice_id pid on pid.invoice_id = i.id
       left join payments_by_invoice_no pno on pno.invoice_id = i.id
     )
     select i.id::text, i.company_id as "companyId", i.branch_id as "branchId",
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
            i.unpaid_balance as amount,
            i.total_amount as "originalAmount",
            i.invoice_date as "dueDate",
            'Unpaid' as status
     from invoice_balances i
     left join marga.branches b on b.id = i.branch_id
     where i.unpaid_balance > 0.01
     order by i.invoice_date desc nulls last, i.invoice_no, b.name`,
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
  const { branchId, companyId } = await resolvePortalRequestScope(user, body);
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
  const { branchId, companyId } = await resolvePortalRequestScope(user, body);
  const deviceId = Number(body.deviceId || body.machineId || 0) || null;
  const ticketNo = `CARE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;
  const photoUrl = photoFile ? (await saveUploadedFile(photoFile, 'ticket').catch(() => null)) : null;
  const machineStatusId = Number(body.fieldWorkMachineStatusId || body.machineStatusId || 0) || null;
  const machineStatusLabel = cleanText(body.fieldWorkMachineStatus || machineWorkStatusLabel(machineStatusId));
  if (!machineStatusId || !machineStatusLabel || machineStatusId < 1 || machineStatusId > 4) {
    const error = new Error('Field Machine Status is required.');
    error.statusCode = 400;
    throw error;
  }
  const { rows } = await pool.query(
    `insert into marga.portal_service_tickets (ticket_no, company_id, branch_id, machine_id, requester_user_id, requester_name, category, description, priority, photo_url, field_work_machine_status_id, field_work_machine_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id::text, ticket_no as "ticketNo", company_id as "companyId", branch_id as "branchId",
       machine_id as "deviceId", requester_user_id as "requesterUserId", category, description, priority, status,
       field_work_machine_status as "fieldWorkMachineStatus", field_work_machine_status_id as "fieldWorkMachineStatusId",
       schedule_legacy_id as "scheduleLegacyId", schedule_created_at as "scheduleCreatedAt",
       photo_url as "photoUrl", created_at as "createdAt", updated_at as "updatedAt"`,
    [ticketNo, companyId, branchId, deviceId, user.id, user.name, String(body.category || 'Service'), String(body.description || ''), String(body.priority || 'Normal'), photoUrl, machineStatusId, machineStatusLabel]
  );
  const result = rows[0] || {};
  try {
    const schedule = await createScheduleForPortalTicket({
      user,
      ticket: result,
      body,
      machineStatusId,
      machineStatusLabel
    });
    await pool.query(
      `update marga.portal_service_tickets
       set schedule_legacy_id = $2, schedule_created_at = now(), route_status = 'queued', updated_at = now()
       where id = $1`,
      [Number(result.id), String(schedule.id)]
    );
    result.scheduleLegacyId = String(schedule.id);
    result.scheduleCreatedAt = new Date().toISOString();
    result.scheduledDate = schedule.taskDatetime;
  } catch (error) {
    await pool.query(
      `delete from marga.portal_service_tickets where id = $1`,
      [Number(result.id)]
    ).catch(() => {});
    throw error;
  }
  await auditLog({ userId: user.id, action: 'ticket_created', entityType: 'portal_service_ticket', entityId: result.id, metadata: { branchId, companyId, deviceId, hasPhoto: !!photoUrl } });
  if (result.id) {
    await insertTicketEvent(result.id, {
      status: 'submitted',
      customerVisibleNote: 'We are reviewing your service request.',
      createdByUserId: user.id
    }).catch(() => {});
  }
  return result;
}

// ── Ticket timeline / status-event log (spec §10, §26) ──────────────────────
// Every status change is recorded here. Internal notes never reach the customer
// unless explicitly marked customer_visible.
async function insertTicketEvent(ticketId, {
  status,
  customerVisibleNote = '',
  internalNote = '',
  reason = null,
  nextAction = null,
  staffId = null,
  staffName = null,
  staffLat = null,
  staffLng = null,
  trackingEnabled = null,
  assignmentId = null,
  customerVisible = true,
  createdByUserId = null
}) {
  await pool.query(
    `insert into marga.portal_ticket_events
      (ticket_id, status, customer_visible_note, internal_note, reason, next_action,
       responsible_staff_id, responsible_staff_name, staff_latitude, staff_longitude,
       tracking_enabled, assignment_id, customer_visible, created_by_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [ticketId, status, customerVisibleNote, internalNote, reason, nextAction, staffId, staffName,
     staffLat, staffLng, trackingEnabled, assignmentId, customerVisible, createdByUserId]
  );
}

async function listTicketEvents(ticketId, { includeInternal = false } = {}) {
  const { rows } = await pool.query(
    `select id::text, status, customer_visible_note as "customerVisibleNote",
            ${includeInternal ? 'internal_note as "internalNote", reason, next_action as "nextAction",' : ''}
            responsible_staff_name as "staffName", customer_visible as "customerVisible",
            created_at as "createdAt"
     from marga.portal_ticket_events
     where ticket_id = $1 ${includeInternal ? '' : 'and customer_visible = true'}
     order by created_at asc`,
    [ticketId]
  );
  return rows;
}

// ── Customer-facing status derivation (spec §5, §10-§20) ────────────────────
// route_status is the internal/dispatch-facing state. This function is the single
// place that turns it into what the customer is allowed to see: label, supporting
// copy, which communication channels are enabled, and whether tracking may show.
// Never let the frontend infer these rules independently from raw status text.
function computeCustomerFacingStatus(ticket) {
  const routeStatus = ticket.routeStatus || LEGACY_STATUS_TO_ROUTE_STATUS[String(ticket.status || '').toLowerCase()] || 'submitted';
  const graceExpired = ticket.communicationGracePeriodEndsAt
    ? new Date(ticket.communicationGracePeriodEndsAt).getTime() < Date.now()
    : false;

  const base = {
    routeStatus,
    label: 'Request Received',
    message: 'We are reviewing your service request.',
    showArrivalNotConfirmed: false,
    showBroadVisitPeriod: false,
    broadVisitPeriod: ticket.broadVisitPeriod || null,
    showLiveEta: false,
    liveEtaMinutes: null,
    showTracking: false,
    showAssignedStaffProfile: false,
    assignedStaffName: ticket.assignedStaffName || null,
    ticketMessageLabel: 'Message Service Team',
    ticketMessageAvailable: false,
    chatTechnicianEnabled: false,
    callTechnicianEnabled: false,
    callMargaCareEnabled: true,
    chatMargaCareEnabled: true,
    progressSteps: ['Received']
  };

  switch (routeStatus) {
    case 'submitted':
    case 'under_review':
      return { ...base, label: 'Request Received', message: 'We are reviewing your service request. We will update you once it has been assigned or included in a field route.' };

    case 'assigned':
      return {
        ...base, label: 'Assigned to Service Team', message: 'Arrival time is not yet confirmed.',
        showAssignedStaffProfile: !!ticket.assignedStaffName,
        ticketMessageAvailable: true,
        progressSteps: ['Received', 'Assigned']
      };

    case 'queued':
      return {
        ...base, label: 'Assigned to Service Team', message: 'Messages are attached to this service request. The assigned team will respond when available.',
        showAssignedStaffProfile: !!ticket.assignedStaffName,
        ticketMessageAvailable: true,
        progressSteps: ['Received', 'Assigned', 'Queued']
      };

    case 'included_in_route':
      return {
        ...base, label: 'Scheduled for Today', message: 'Your request is included in today\u2019s service route. Exact arrival time is not yet available. We\u2019ll notify you when your assigned field staff is approaching.',
        showArrivalNotConfirmed: !ticket.confirmedWindowStart,
        showBroadVisitPeriod: !!ticket.broadVisitPeriod,
        showAssignedStaffProfile: !!ticket.assignedStaffName,
        ticketMessageAvailable: true,
        progressSteps: ['Received', 'Assigned', 'Queued']
      };

    case 'next_destination':
      return {
        ...base, label: 'You Are the Next Destination', message: 'Your assigned field staff will travel to your location next. We\u2019ll notify you as soon as the trip begins.',
        showAssignedStaffProfile: !!ticket.assignedStaffName,
        ticketMessageAvailable: true,
        chatTechnicianEnabled: !!ticket.technicianContactEnabled,
        progressSteps: ['Received', 'Assigned', 'Queued']
      };

    case 'on_the_way':
      return {
        ...base, label: 'Technician On the Way', message: 'You are the technician\u2019s next stop.',
        showLiveEta: true, liveEtaMinutes: ticket.liveEtaMinutes ?? null,
        showTracking: !!ticket.trackingEnabled,
        showAssignedStaffProfile: true,
        ticketMessageLabel: 'Chat Assigned Technician',
        ticketMessageAvailable: true,
        chatTechnicianEnabled: true, callTechnicianEnabled: true,
        progressSteps: ['Received', 'Assigned', 'On the Way']
      };

    case 'arrived':
      return {
        ...base, label: 'Technician Has Arrived', message: ticket.arrivedAt ? `Arrival confirmed at ${new Date(ticket.arrivedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.` : 'Your technician has arrived.',
        showAssignedStaffProfile: true,
        ticketMessageLabel: 'Chat Assigned Technician', ticketMessageAvailable: true,
        chatTechnicianEnabled: true, callTechnicianEnabled: true,
        progressSteps: ['Received', 'Assigned', 'On the Way', 'Arrived']
      };

    case 'in_progress':
      return {
        ...base, label: 'Service in Progress', message: ticket.serviceStartedAt ? `Started at ${new Date(ticket.serviceStartedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.` : 'Your technician is working on this request.',
        showAssignedStaffProfile: true,
        ticketMessageLabel: 'Chat Assigned Technician', ticketMessageAvailable: true,
        chatTechnicianEnabled: true, callTechnicianEnabled: true,
        progressSteps: ['Received', 'Assigned', 'On the Way', 'Arrived', 'In Progress']
      };

    case 'waiting_customer':
      return {
        ...base, label: 'Waiting for Customer Access', message: 'Our technician is waiting for access to the machine or service area.',
        showAssignedStaffProfile: true,
        ticketMessageLabel: 'Chat Assigned Technician', ticketMessageAvailable: true,
        chatTechnicianEnabled: true, callTechnicianEnabled: true,
        progressSteps: ['Received', 'Assigned', 'On the Way', 'Arrived', 'In Progress']
      };

    case 'waiting_parts':
      return {
        ...base, label: 'Waiting for Parts', message: 'A required part is being prepared. We\u2019ll notify you when the follow-up visit is scheduled.',
        showAssignedStaffProfile: !!ticket.assignedStaffName,
        ticketMessageAvailable: true,
        callTechnicianEnabled: !!ticket.technicianContactEnabled,
        progressSteps: ['Received', 'Assigned', 'On the Way', 'Arrived', 'In Progress']
      };

    case 'for_follow_up':
      return {
        ...base, label: 'Follow-up Scheduled', message: 'A follow-up visit is being arranged for this request.',
        ticketMessageAvailable: true,
        progressSteps: ['Received', 'Assigned', 'Completed (Follow-up Pending)']
      };

    case 'completed':
      return {
        ...base, label: 'Service Completed', message: ticket.completedAt ? `Completed at ${new Date(ticket.completedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.` : 'This request has been completed.',
        showAssignedStaffProfile: true,
        ticketMessageLabel: graceExpired ? 'Message Service Team' : 'Chat Assigned Technician',
        ticketMessageAvailable: true,
        chatTechnicianEnabled: !graceExpired,
        callTechnicianEnabled: !graceExpired,
        progressSteps: ['Received', 'Assigned', 'On the Way', 'Arrived', 'In Progress', 'Completed']
      };

    case 'cancelled':
      return {
        ...base, label: 'Request Cancelled', message: ticket.cancelReason || 'This service request was cancelled.',
        chatTechnicianEnabled: false, callTechnicianEnabled: false,
        progressSteps: ['Received', 'Cancelled']
      };

    default:
      return base;
  }
}

// Get per-branch service history from marga.service_schedules (relational, clean typed dates).
// Returns lastService, lastToner, lastReading per branch + recent activity feed.
async function listServiceHistory(user) {
  const graphScope = portalScopeWhere(user, 'g');

  // Single query: join active_customer_graph → service_schedules via branch_legacy_id
  // Use DISTINCT ON per (branch_legacy_id, purpose_group) to get the latest event per branch per type
  const { rows } = await pool.query(
    `with scoped_branches as (
       select distinct
              g.branch_id,
              g.branch_legacy_id::text as branch_legacy_id,
              regexp_replace(coalesce(g.branch_name, ''), '^~x+\\s*', '', 'i') as branch_name
       from api.active_customer_graph g
       where g.branch_legacy_id is not null ${graphScope.sql}
     ),
     schedule_events as (
       select
         s.branch_legacy_id,
         sb.branch_id,
         sb.branch_name,
         s.purpose_id,
         case
           when s.purpose_id in ('5','9') then 'service'
           when s.purpose_id in ('3','4') then 'toner'
           when s.purpose_id = '8'        then 'reading'
           else 'other'
         end as event_type,
         case
           when s.purpose_id = '3' then 'Toner / Ink Delivery'
           when s.purpose_id = '4' then 'Cartridge Delivery'
           when s.purpose_id = '5' then 'Maintenance Visit'
           when s.purpose_id = '8' then 'Meter Reading'
           when s.purpose_id = '9' then 'Service Visit'
           else 'Service Visit'
         end as event_label,
         s.date_finished,
         coalesce(nullif(s.customer_request,''), nullif(s.remarks,''), '') as notes,
         s.id
       from marga.service_schedules s
       join scoped_branches sb on sb.branch_legacy_id = s.branch_legacy_id
       where s.purpose_id in ('3','4','5','8','9')
         and s.date_finished is not null
         and s.date_finished >= now() - interval '3 years'
         and s.date_finished <= now() + interval '1 day'
     ),
     latest_per_branch_type as (
       select distinct on (branch_legacy_id, event_type)
              branch_legacy_id, branch_id, branch_name,
              event_type, event_label, purpose_id,
              date_finished, notes, id
       from schedule_events
       order by branch_legacy_id, event_type, date_finished desc
     )
     select * from latest_per_branch_type
     order by date_finished desc`,
    graphScope.params
  );

  // Build byBranch map and recentEvents feed
  const byBranch = {};
  rows.forEach((row) => {
    const key = String(row.branch_legacy_id || '').trim();
    if (!byBranch[key]) {
      byBranch[key] = {
        branchId: row.branch_id,
        branchName: row.branch_name || key,
        lastService: null,
        lastToner: null,
        lastReading: null
      };
    }
    const entry = {
      date: row.date_finished ? new Date(row.date_finished).toISOString() : null,
      notes: cleanText(row.notes),
      label: row.event_label
    };
    if (row.event_type === 'service')  byBranch[key].lastService  = entry;
    if (row.event_type === 'toner')    byBranch[key].lastToner    = entry;
    if (row.event_type === 'reading')  byBranch[key].lastReading  = entry;
  });

  // recentEvents: top 20 service/toner events sorted by date desc
  const recentEvents = rows
    .filter((r) => r.event_type === 'service' || r.event_type === 'toner')
    .slice(0, 20)
    .map((row) => ({
      type: row.event_type,
      label: row.event_label,
      branchLegacyId: String(row.branch_legacy_id),
      branchId: row.branch_id,
      branchName: row.branch_name || String(row.branch_legacy_id),
      date: row.date_finished ? new Date(row.date_finished).toISOString() : null,
      notes: cleanText(row.notes)
    }));

  // Global most-recent service and toner across all branches
  const allService = rows.filter((r) => r.event_type === 'service').sort((a, b) => new Date(b.date_finished) - new Date(a.date_finished))[0];
  const allToner   = rows.filter((r) => r.event_type === 'toner').sort((a, b) => new Date(b.date_finished) - new Date(a.date_finished))[0];

  return {
    byBranch,
    recentEvents,
    summary: {
      lastService: allService ? {
        date: new Date(allService.date_finished).toISOString(),
        branchName: allService.branch_name || String(allService.branch_legacy_id),
        branchId: allService.branch_id,
        notes: cleanText(allService.notes)
      } : null,
      lastToner: allToner ? {
        date: new Date(allToner.date_finished).toISOString(),
        branchName: allToner.branch_name || String(allToner.branch_legacy_id),
        branchId: allToner.branch_id,
        notes: cleanText(allToner.notes)
      } : null
    }
  };
}

async function summary(user) {
  const graphScope = portalScopeWhere(user, 'g');
  const invoiceScope = portalScopeWhere(user, 'i');

  const [devices, tickets, toner, billingSummaryData, serviceHistory, fleetData] = await Promise.all([
    listDevices(user),
    listTickets(user),
    listTonerRequests(user),
    pool.query(`
      with scoped_invoices as (
        select i.id, i.invoice_no, i.invoice_date, coalesce(i.total_amount, 0) as total_amount
        from marga.billing_invoices i
        where true ${invoiceScope.sql}
          and nullif(trim(coalesce(i.invoice_no, '')), '') is not null
          and coalesce(i.total_amount, 0) > 0
      ),
      payments_by_invoice_id as (
        select p.invoice_id,
               max(p.balance_amount) filter (where p.balance_amount is not null) as recorded_balance,
               coalesce(sum(p.payment_amount), 0) as paid_amount
        from marga.payments p
        join scoped_invoices i on i.id = p.invoice_id
        group by p.invoice_id
      ),
      payments_by_invoice_no as (
        select i.id as invoice_id,
               max(p.balance_amount) filter (where p.balance_amount is not null) as recorded_balance,
               coalesce(sum(p.payment_amount), 0) as paid_amount
        from scoped_invoices i
        join marga.payments p on p.invoice_no = i.invoice_no
        where p.invoice_id is null
        group by i.id
      ),
      invoice_balances as (
        select i.id,
               i.invoice_date,
               case
                 when coalesce(pid.recorded_balance, pno.recorded_balance) is not null
                 then greatest(coalesce(pid.recorded_balance, pno.recorded_balance), 0)
                 else greatest(i.total_amount - coalesce(pid.paid_amount, 0) - coalesce(pno.paid_amount, 0), 0)
               end as unpaid_balance
        from scoped_invoices i
        left join payments_by_invoice_id pid on pid.invoice_id = i.id
        left join payments_by_invoice_no pno on pno.invoice_id = i.id
      )
      select count(*) filter (where unpaid_balance > 0.01)::int as unpaid_invoices,
             coalesce(sum(unpaid_balance) filter (where unpaid_balance > 0.01), 0)::numeric as unpaid_amount,
             min(invoice_date) filter (where unpaid_balance > 0.01) as next_billing_due
      from invoice_balances
    `, invoiceScope.params),
    listServiceHistory(user).catch(() => ({ summary: null })),
    // Real fleet health: customer-safe "printing normally" means active graph status DELIVERED.
    pool.query(`
      with scoped as (
        select distinct g.branch_id, g.branch_legacy_id
        from api.active_customer_graph g
        where true ${graphScope.sql}
      ),
      fleet_devices as (
        select distinct on (${activeGraphDeviceKeySql('g')})
               ${activeGraphDeviceKeySql('g')} as device_key,
               g.branch_id,
               g.machine_id,
               g.machine_status_id::text as machine_status_id,
               coalesce(nullif(trim(coalesce(g.display_serial, '')), ''), nullif(trim(coalesce(g.machine_serial, '')), '')) as serial
        from api.active_customer_graph g
        where true ${graphScope.sql}
        order by ${activeGraphDeviceKeySql('g')}, lower(coalesce(g.branch_name, '')) nulls last, coalesce(g.display_serial, g.machine_serial, '') nulls last, g.contract_id desc
      ),
      open_customer_machine_issues as (
        select distinct fd.device_key
        from fleet_devices fd
        join marga.service_schedules s
          on s.branch_id = fd.branch_id
         and (s.machine_id is null or s.machine_id = fd.machine_id)
        where s.purpose_id in ('3','4','5','9')
          and s.date_finished is null
          and coalesce(s.source_data->>'iscancel', '0') <> '1'
          and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
          and (
            case
              when coalesce(s.source_data->>'field_work_machine_status_id', '') ~ '^[0-9]+$'
              then (s.source_data->>'field_work_machine_status_id')::int between 2 and 4
              else false
            end
            or lower(coalesce(s.source_data->>'field_work_machine_status', '')) ~ '(print problem|down|no print|best mode)'
          )

        union

        select distinct ${activeGraphDeviceKeySql('g')} as device_key
        from marga.portal_service_tickets t
        join api.active_customer_graph g
          on g.branch_id = t.branch_id
         and (t.machine_id is null or t.machine_id = g.machine_id)
        where true ${graphScope.sql}
          and lower(coalesce(t.status,'')) not in ('completed','closed','done','cancelled','canceled')
          and t.field_work_machine_status_id between 2 and 4
      ),
      fleet_status as (
        select count(*) as total,
               count(*) filter (
                 where machine_status_id = '3'
                   and serial is not null
                   and issue.device_key is null
               ) as printing_normally,
               count(*) filter (
                 where serial is null
               ) as missing_serial,
               count(distinct issue.device_key) as customer_issue_machines
        from fleet_devices fd
        left join open_customer_machine_issues issue on issue.device_key = fd.device_key
      ),
      open_ticket_branches as (
        select count(distinct t.branch_id) as cnt
        from marga.portal_service_tickets t
        join scoped s on s.branch_id = t.branch_id
        where lower(coalesce(t.status,'')) not in ('completed','closed','done','cancelled','canceled')
      ),
      unlinked_portal_tickets as (
        select count(*) as cnt
        from marga.portal_service_tickets t
        join scoped s on s.branch_id = t.branch_id
        where lower(coalesce(t.status,'')) not in ('completed','closed','done','cancelled','canceled')
          and nullif(trim(coalesce(t.schedule_legacy_id, '')), '') is null
      ),
      open_schedules as (
        select
          -- Customer-facing open work is unfinished by completion date. Numeric
          -- schedule status is not reliable for old CSR-created schedules.
          count(*) filter (
            where s.purpose_id in ('5','9')
            and s.date_finished is null
            and coalesce(s.source_data->>'iscancel', '0') <> '1'
            and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
          ) as service_open,
          count(*) filter (
            where s.purpose_id in ('3','4')
            and s.date_finished is null
            and coalesce(s.source_data->>'iscancel', '0') <> '1'
            and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
          ) as toner_open,
          count(*) filter (
            where s.purpose_id in ('5','9')
            and s.date_finished is null
            and coalesce(s.source_data->>'iscancel', '0') <> '1'
            and lower(coalesce(s.status, '')) not in ('completed','done','cancelled','canceled')
            and s.scheduled_date = current_date
          ) as service_today
        from marga.service_schedules s
        join scoped sc on sc.branch_id = s.branch_id
        where coalesce(s.status,'') not in ('cancelled','canceled')
      )
      select
        (select total from fleet_status)::int as total_machines,
        (select printing_normally from fleet_status)::int as printing_normally,
        (select missing_serial from fleet_status)::int as missing_serial_machines,
        (select customer_issue_machines from fleet_status)::int as customer_issue_machines,
        (select cnt from open_ticket_branches)::int as open_ticket_branches,
        (select cnt from unlinked_portal_tickets)::int as unlinked_portal_open,
        (select service_open from open_schedules)::int as service_open,
        (select toner_open from open_schedules)::int as toner_open,
        (select service_today from open_schedules)::int as service_today
    `, graphScope.params)
  ]);

  // fleet must be declared BEFORE using it
  const fleet = fleetData.rows[0] || {};
  const billingSummary = billingSummaryData.rows[0] || {};
  const totalMachines      = devices.length || Number(fleet.total_machines || 0);
  const affectedMachines   = Number(fleet.customer_issue_machines || 0);
  const printingNormally   = Number(fleet.printing_normally ?? Math.max(0, totalMachines - affectedMachines));
  const statusAttention    = affectedMachines;
  const missingSerialCount = Number(fleet.missing_serial_machines || 0);
  const openTicketBranches = Number(fleet.open_ticket_branches || 0);
  const uptimePct          = totalMachines > 0 ? Math.round((printingNormally / totalMachines) * 100) : 100;
  const serviceOpen        = Number(fleet.service_open  || 0);
  const tonerOpen          = Number(fleet.toner_open    || 0);
  const serviceToday       = Number(fleet.service_today || 0);

  // Open tickets = real unfinished schedules plus any older portal-only tickets not yet linked.
  const portalOpenTickets = Number(fleet.unlinked_portal_open || 0);
  const openTickets = portalOpenTickets + serviceOpen + tonerOpen;
  const pendingToner = toner.filter((request) => {
    const status = String(request.status || '').toLowerCase();
    return ['pending', 'requested', 'open', 'assigned'].includes(status);
  }).length;
  const nextBillingDue = cleanText(billingSummary.next_billing_due || '') || null;
  const unpaidInvoices = Number(billingSummary.unpaid_invoices || 0);
  const unpaidAmount = Number(billingSummary.unpaid_amount || 0);

  // (fleet, totalMachines, etc already declared above — no duplicate needed)
  return {
    activeDevices: totalMachines,
    openTickets,
    pendingToner,
    unpaidInvoices,
    unpaidAmount,
    nextBillingDue,
    lastService: serviceHistory?.summary?.lastService || null,
    lastToner:   serviceHistory?.summary?.lastToner   || null,
    // Honest fleet health
    fleet: {
      total:           totalMachines,
      printingNormally,
      affectedMachines,
      uptimePct,
      attentionCount: affectedMachines,
      nonDeliveredCount: statusAttention,
      missingSerialCount,
      openTicketBranches,
      serviceOpen,
      tonerOpen,
      serviceToday
    }
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
  if (!portalSchemaBootstrapSkipped) {
    ensurePortalSchemaReady().catch((error) => {
      if (isSchemaCreatePermissionError(error)) portalSchemaBootstrapSkipped = true;
      console.warn('Portal schema bootstrap skipped:', error.message || error);
    });
  }
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

  // ── Ticket Details / messaging / internal dispatch actions (spec §9, §25, §5) ──
  const ticketDetailMatch = url.pathname.match(/^\/portal-api\/tickets\/(\d+)$/);
  if (ticketDetailMatch && req.method === 'GET') {
    const detail = await getTicketDetail(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds')), ticketDetailMatch[1]);
    if (!detail) return json(res, 404, { ok: false, message: 'Ticket not found.' });
    return json(res, 200, { ok: true, ticket: detail });
  }
  const ticketMessagesMatch = url.pathname.match(/^\/portal-api\/tickets\/(\d+)\/messages$/);
  if (ticketMessagesMatch && req.method === 'POST') {
    try {
      const ct = String(req.headers['content-type'] || '');
      let message;
      if (ct.includes('multipart/form-data')) {
        const { fields, files } = await readMultipart(req);
        message = await sendTicketMessage(user, ticketMessagesMatch[1], fields.body, files.attachment || null);
      } else {
        const body = await readJson(req);
        message = await sendTicketMessage(user, ticketMessagesMatch[1], body.body);
      }
      return json(res, 200, { ok: true, message });
    } catch (error) {
      return json(res, error.statusCode || error.status || 500, { ok: false, message: error.message || 'Failed to send message.' });
    }
  }
  const ticketAssignMatch = url.pathname.match(/^\/portal-api\/admin\/tickets\/(\d+)\/assign$/);
  if (ticketAssignMatch && req.method === 'POST') {
    try {
      const body = await readJson(req);
      return json(res, 200, { ok: true, ticket: await assignTicketStaff(user, ticketAssignMatch[1], { staffId: body.staffId, staffName: body.staffName }) });
    } catch (error) {
      return json(res, error.statusCode || error.status || 500, { ok: false, message: error.message || 'Failed to assign ticket.' });
    }
  }
  const ticketStatusMatch = url.pathname.match(/^\/portal-api\/admin\/tickets\/(\d+)\/status$/);
  if (ticketStatusMatch && req.method === 'POST') {
    try {
      const body = await readJson(req);
      return json(res, 200, { ok: true, ticket: await updateTicketStatus(user, ticketStatusMatch[1], body) });
    } catch (error) {
      return json(res, error.statusCode || error.status || 500, { ok: false, message: error.message || 'Failed to update ticket status.' });
    }
  }
  const ticketLocationMatch = url.pathname.match(/^\/portal-api\/admin\/tickets\/(\d+)\/location$/);
  if (ticketLocationMatch && req.method === 'POST') {
    try {
      const body = await readJson(req);
      return json(res, 200, { ok: true, ...(await updateTicketLocation(user, ticketLocationMatch[1], { latitude: Number(body.latitude), longitude: Number(body.longitude) })) });
    } catch (error) {
      return json(res, error.statusCode || error.status || 500, { ok: false, message: error.message || 'Failed to update location.' });
    }
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
  if (url.pathname === '/portal-api/service-history') {
    return json(res, 200, { ok: true, ...(await listServiceHistory(previewScopedUser(user, url.searchParams.get('companyId'), url.searchParams.get('branchId'), url.searchParams.get('companyIds')))) });
  }

  // Staff open schedule count (for gate check)
  if (url.pathname === '/portal-api/staff/open-schedules') {
    const techId = url.searchParams.get('techId');
    if (!techId) return json(res, 400, { ok: false, message: 'techId required' });
    const { rows } = await pool.query(
      `SELECT COUNT(*) as open_count
       FROM marga.service_schedules
       WHERE tech_id = $1
         AND date_finished IS NULL
         AND coalesce(status,'') NOT IN ('cancelled','canceled')
         AND purpose_id IN ('3','4','5','9')`,
      [techId]
    );
    return json(res, 200, { ok: true, openCount: Number(rows[0]?.open_count || 0) });
  }

  // Rate a completed service ticket
  if (url.pathname === '/portal-api/rate-ticket' && req.method === 'POST') {
    const body = await readBody(req);
    const { ticketId, rating, comment } = body;
    if (!ticketId || !rating || rating < 1 || rating > 5) {
      return json(res, 400, { ok: false, message: 'Invalid rating' });
    }
    await pool.query(
      `UPDATE marga.portal_service_tickets
       SET customer_rating = $1, customer_comment = $2, rated_at = now()
       WHERE id = $3 AND company_id IN (
         SELECT DISTINCT company_id FROM api.active_customer_graph g WHERE true ${portalScopeWhere(user,'g').sql}
       )`,
      [rating, comment || null, ticketId, ...portalScopeWhere(user,'g').params]
    );
    return json(res, 200, { ok: true });
  }

  // Staff acknowledgement log
  if (url.pathname === '/portal-api/staff/acknowledge' && req.method === 'POST') {
    const body = await readBody(req);
    const { techId, openCount } = body;
    if (!techId) return json(res, 400, { ok: false, message: 'techId required' });
    await pool.query(
      `INSERT INTO marga.staff_schedule_acknowledgements (tech_id, open_schedule_count) VALUES ($1, $2)`,
      [techId, openCount || 0]
    );
    return json(res, 200, { ok: true });
  }

  // Staff ratings (internal — field app use)
  if (url.pathname === '/portal-api/staff/ratings') {
    requireInternalUser(user);
    const techId = url.searchParams.get('techId');
    const { rows } = await pool.query(
      `SELECT * FROM marga.v_staff_ratings ${techId ? 'WHERE tech_id = $1' : ''} ORDER BY avg_rating DESC LIMIT 50`,
      techId ? [techId] : []
    );
    return json(res, 200, { ok: true, ratings: rows });
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

  // Emergency SW nuke page — clears all caches and unregisters all service workers, then reloads
  if (url.pathname === '/nuke-sw') {
    const nukePage = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Clearing cache…</title>
<style>body{background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
.dot{width:8px;height:8px;border-radius:50%;background:#6C63FF;animation:pulse 1s infinite}@keyframes pulse{0%,100%{opacity:.2}50%{opacity:1}}</style></head>
<body><div class="dot"></div><p id="msg">Clearing service worker cache…</p>
<script>
(async()=>{
  const msg=document.getElementById('msg');
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const r of regs){await r.unregister();}
      msg.textContent='Unregistered '+regs.length+' service worker(s)…';
    }
    if('caches' in self){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
      msg.textContent='Cleared '+keys.length+' cache(s). Reloading…';
    }
  }catch(e){msg.textContent='Done ('+e.message+'). Reloading…';}
  setTimeout(()=>location.replace('/'),1200);
})();
</script></body></html>`;
    sendResponse(res, 200, nukePage, 'text/html; charset=utf-8');
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
  const isVideo = contentType.startsWith('video/');
  const fileStat = await stat(filePath);

  if (isVideo) {
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', contentType);

    if (range) {
      const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` });
        res.end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : fileStat.size - 1;
      if (start >= fileStat.size || end >= fileStat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
        'Content-Length': String(end - start + 1)
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Length': String(fileStat.size) });
    createReadStream(filePath).pipe(res);
    return;
  }

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
