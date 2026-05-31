#!/usr/bin/env node
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const platformRequire = createRequire('/Volumes/Wotg Drive Mike/GitHub/marga-platform/package.json');
const { Pool } = platformRequire('pg');

const DATABASE_URL = process.env.MARGABASE_DATABASE_URL || 'postgresql://margabase_admin@127.0.0.1:5432/margabase';
if (process.env.NODE_ENV === 'production' && !process.env.MARGABASE_DATABASE_URL) {
  throw new Error('MARGABASE_DATABASE_URL must be set in production.');
}
const pool = new Pool({ connectionString: DATABASE_URL });

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function usage() {
  console.error('Usage: node scripts/set-portal-account-password.mjs --login=name@example.com --password=TempPass123 --mobile-user-id=1');
  console.error('   or: node scripts/set-portal-account-password.mjs --login=name@example.com --password=TempPass123 --company-id=1 --branch-id=1 --name="Customer Name"');
  process.exit(1);
}

async function ensureTables() {
  await pool.query(`
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
  `);
}

async function inferScope(mobileUserId) {
  if (!mobileUserId) return {};
  const { rows } = await pool.query(
    `select u.data as user_data, d.data as detail_data, b.id as branch_id, b.company_id
     from app_meta.firestore_documents u
     left join app_meta.firestore_documents d
       on d.collection = 'tbl_mobileappusersdetails'
      and d.data->>'mau_id' = u.data->>'id'
     left join marga.branches b
       on b.legacy_id = d.data->>'branch_id'
     where u.collection = 'tbl_mobileappusers'
       and u.data->>'id' = $1
     order by d.doc_id
     limit 1`,
    [String(mobileUserId)]
  );
  const row = rows[0];
  if (!row) return {};
  return {
    displayName: row.user_data?.appuser || row.user_data?.username || '',
    branchId: row.branch_id || null,
    companyId: row.company_id || null
  };
}

async function run() {
  const login = arg('login').trim().toLowerCase();
  const password = arg('password');
  const mobileUserId = arg('mobile-user-id') || '';
  if (!login || !password || password.length < 8) usage();

  await ensureTables();
  const inferred = await inferScope(mobileUserId);
  const displayName = arg('name') || inferred.displayName || login;
  const companyId = arg('company-id') || inferred.companyId || null;
  const branchId = arg('branch-id') || inferred.branchId || null;
  const salt = crypto.randomBytes(16);
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');

  const { rows } = await pool.query(
    `insert into marga.portal_accounts
      (login, display_name, role, mobile_user_id, company_id, branch_id, password_hash, password_salt, password_iterations, active)
     values ($1, $2, 'end_user', $3, $4, $5, $6, $7, $8, true)
     on conflict (login) do update set
       display_name = excluded.display_name,
       mobile_user_id = excluded.mobile_user_id,
       company_id = excluded.company_id,
       branch_id = excluded.branch_id,
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       active = true,
       updated_at = now()
     returning id, login, display_name, company_id, branch_id`,
    [login, displayName, mobileUserId || null, companyId, branchId, hash, salt.toString('base64'), iterations]
  );

  console.log(JSON.stringify({ ok: true, account: rows[0] }, null, 2));
  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
