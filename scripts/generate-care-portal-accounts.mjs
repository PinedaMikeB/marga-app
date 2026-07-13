#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const platformRequire = createRequire('/Volumes/Wotg Drive Mike/GitHub/marga-platform/package.json');
const { Pool } = platformRequire('pg');

const DEFAULT_ENV_FILE = '/Users/mike/.marga-launchd/margabase.env';
const ARGON2_MEMORY = Number(process.env.MARGA_CARE_ARGON2_MEMORY || 65536);
const ARGON2_PASSES = Number(process.env.MARGA_CARE_ARGON2_PASSES || 3);
const ARGON2_PARALLELISM = Number(process.env.MARGA_CARE_ARGON2_PARALLELISM || 1);
const ARGON2_TAG_LENGTH = Number(process.env.MARGA_CARE_ARGON2_TAG_LENGTH || 32);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    rotateExisting: false,
    outDir: '',
    envFile: DEFAULT_ENV_FILE,
    seedFile: ''
  };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--rotate-existing') args.rotateExisting = true;
    else if (raw.startsWith('--out-dir=')) args.outDir = raw.slice('--out-dir='.length);
    else if (raw.startsWith('--env-file=')) args.envFile = raw.slice('--env-file='.length);
    else if (raw.startsWith('--seed-file=')) args.seedFile = raw.slice('--seed-file='.length);
  }
  return args;
}

function loadEnvFile(filePath) {
  const out = {};
  if (!filePath || !fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function ensureEnv(args) {
  const envFromFile = loadEnvFile(args.envFile);
  for (const [key, value] of Object.entries(envFromFile)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function firstNonBlank(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function extractEmails(...values) {
  const seen = new Set();
  const emails = [];
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
  for (const value of values) {
    const text = String(value || '');
    const matches = text.match(regex) || [];
    for (const match of matches) {
      const email = String(match || '').trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      emails.push(email);
    }
  }
  return emails;
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

function padCode(value, width = 5) {
  return String(value || '').replace(/\D/g, '').padStart(width, '0');
}

function companyCode(company) {
  return `C${padCode(company.legacy_id || company.id, 5)}`;
}

function branchCode(company, branch) {
  return `${companyCode(company)}-B${padCode(branch.legacy_id || branch.id, 5)}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows, columns) {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))
  ].join('\n');
}

function nowStamp() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function findLatestSeedFile(explicitPath = '') {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const desktopDir = '/Users/mike/Desktop';
  if (!fs.existsSync(desktopDir)) return '';
  const candidates = fs.readdirSync(desktopDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^marga-care-credentials-\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => path.join(desktopDir, entry.name, 'credentials.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, mtime: fs.statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  return candidates[0]?.filePath || '';
}

function loadSeedPasswords(seedFile) {
  const map = new Map();
  if (!seedFile || !fs.existsSync(seedFile)) return map;
  try {
    const payload = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    rows.forEach((row) => {
      const password = cleanText(row.temporary_password);
      if (!password) return;
      const keys = [
        cleanText(row.primary_login || row.login).toLowerCase(),
        cleanText(row.login).toLowerCase(),
        cleanText(row.company_code).toLowerCase(),
        `${cleanText(row.company_code).toLowerCase()}-admin`,
        cleanText(row.branch_code).toLowerCase()
      ].filter(Boolean);
      keys.forEach((key) => map.set(key, password));
    });
  } catch (error) {
    console.warn(`Unable to read seed credentials file ${seedFile}: ${error.message}`);
  }
  return map;
}

function seedPasswordForDraft(draft, seededPasswords) {
  const keys = [
    cleanText(draft.primary_login || draft.login).toLowerCase(),
    cleanText(draft.login).toLowerCase(),
    cleanText(draft.fallback_company_code).toLowerCase(),
    `${cleanText(draft.fallback_company_code).toLowerCase()}-admin`,
    cleanText(draft.branch_code).toLowerCase(),
    cleanText(draft.company_code).toLowerCase()
  ].filter(Boolean);
  for (const key of keys) {
    if (seededPasswords.has(key)) return seededPasswords.get(key);
  }
  return '';
}

async function loadBillingCompanies(pool) {
  const { rows } = await pool.query(`
    with payment_matches as (
      select
        i.id as invoice_id,
        p.id as payment_id,
        p.payment_amount,
        p.balance_amount,
        coalesce(p.payment_date, p.updated_at, p.created_at) as payment_effective_at,
        p.updated_at
      from marga.payments p
      join marga.billing_invoices i on i.id = p.invoice_id
      union all
      select
        i.id as invoice_id,
        p.id as payment_id,
        p.payment_amount,
        p.balance_amount,
        coalesce(p.payment_date, p.updated_at, p.created_at) as payment_effective_at,
        p.updated_at
      from marga.payments p
      join marga.billing_invoices i on i.invoice_no = p.invoice_no
      where p.invoice_id is null
        and coalesce(p.invoice_no, '') <> ''
    ),
    payment_totals as (
      select
        invoice_id,
        coalesce(sum(payment_amount), 0) as paid_total
      from payment_matches
      group by invoice_id
    ),
    latest_balances as (
      select distinct on (invoice_id)
        invoice_id,
        balance_amount as latest_balance
      from payment_matches
      where balance_amount is not null
      order by invoice_id, payment_effective_at desc nulls last, updated_at desc nulls last, payment_id desc
    ),
    invoice_balances as (
      select
        i.id,
        i.company_id,
        i.branch_id,
        i.invoice_no,
        i.invoice_date,
        i.total_amount,
        case
          when lb.latest_balance is not null then greatest(0, least(i.total_amount, lb.latest_balance))
          else greatest(0, i.total_amount - least(i.total_amount, coalesce(pt.paid_total, 0)))
        end as outstanding
      from marga.billing_invoices i
      left join payment_totals pt on pt.invoice_id = i.id
      left join latest_balances lb on lb.invoice_id = i.id
      where i.company_id is not null
        and coalesce(i.invoice_no, '') <> ''
        and coalesce(i.status, '') !~* 'cancel'
    ),
    billing_companies as (
      select
        company_id,
        count(*)::integer as billed_invoice_count,
        count(*) filter (where outstanding > 0.01)::integer as open_invoice_count,
        max(invoice_date) as last_invoice_date,
        round(sum(outstanding)::numeric, 2) as outstanding_total
      from invoice_balances
      group by company_id
    ),
    branch_counts as (
      select company_id, count(*)::integer as active_branch_count
      from marga.branches
      where inactive is false
      group by company_id
    ),
    machine_counts as (
      select
        company_id,
        count(distinct coalesce(machine_id::text, 'contract:' || contract_id::text))::integer as active_machine_count
      from api.active_customer_graph
      group by company_id
    )
    select
      c.id,
      c.legacy_id,
      c.name,
      bc.billed_invoice_count,
      bc.open_invoice_count,
      bc.last_invoice_date,
      bc.outstanding_total,
      coalesce(br.active_branch_count, 0) as active_branch_count,
      coalesce(mc.active_machine_count, 0) as active_machine_count,
      coalesce(profile.representative_name, '') as profile_representative_name,
      coalesce(profile.representative_email, '') as profile_representative_email,
      coalesce(profile.representative_phone, '') as profile_representative_phone,
      coalesce(profile.portal_type, 'mixed') as portal_type
    from marga.companies c
    left join billing_companies bc on bc.company_id = c.id
    left join branch_counts br on br.company_id = c.id
    left join machine_counts mc on mc.company_id = c.id
    left join marga.care_company_profiles profile on profile.company_id = c.id
    where c.inactive is false
      and (
        coalesce(bc.outstanding_total, 0) > 0.01
        or coalesce(bc.billed_invoice_count, 0) > 0
        or coalesce(br.active_branch_count, 0) > 0
        or coalesce(mc.active_machine_count, 0) > 0
      )
    order by c.name
  `);
  return rows;
}

async function loadBranches(pool, companyIds) {
  const { rows } = await pool.query(`
    with payment_matches as (
      select
        i.id as invoice_id,
        p.id as payment_id,
        p.payment_amount,
        p.balance_amount,
        coalesce(p.payment_date, p.updated_at, p.created_at) as payment_effective_at,
        p.updated_at
      from marga.payments p
      join marga.billing_invoices i on i.id = p.invoice_id
      union all
      select
        i.id as invoice_id,
        p.id as payment_id,
        p.payment_amount,
        p.balance_amount,
        coalesce(p.payment_date, p.updated_at, p.created_at) as payment_effective_at,
        p.updated_at
      from marga.payments p
      join marga.billing_invoices i on i.invoice_no = p.invoice_no
      where p.invoice_id is null
        and coalesce(p.invoice_no, '') <> ''
    ),
    payment_totals as (
      select invoice_id, coalesce(sum(payment_amount), 0) as paid_total
      from payment_matches
      group by invoice_id
    ),
    latest_balances as (
      select distinct on (invoice_id)
        invoice_id,
        balance_amount as latest_balance
      from payment_matches
      where balance_amount is not null
      order by invoice_id, payment_effective_at desc nulls last, updated_at desc nulls last, payment_id desc
    ),
    invoice_balances as (
      select
        i.company_id,
        i.branch_id,
        case
          when lb.latest_balance is not null then greatest(0, least(i.total_amount, lb.latest_balance))
          else greatest(0, i.total_amount - least(i.total_amount, coalesce(pt.paid_total, 0)))
        end as outstanding,
        i.invoice_date
      from marga.billing_invoices i
      left join payment_totals pt on pt.invoice_id = i.id
      left join latest_balances lb on lb.invoice_id = i.id
      where i.company_id = any($1::bigint[])
        and i.branch_id is not null
        and coalesce(i.invoice_no, '') <> ''
        and coalesce(i.status, '') !~* 'cancel'
    ),
    branch_invoice_summary as (
      select
        branch_id,
        round(sum(outstanding)::numeric, 2) as outstanding_total,
        count(*) filter (where outstanding > 0.01)::integer as open_invoice_count,
        max(invoice_date) as last_invoice_date
      from invoice_balances
      group by branch_id
    ),
    machine_counts as (
      select
        branch_id,
        count(distinct coalesce(machine_id::text, 'contract:' || contract_id::text))::integer as active_machine_count
      from api.active_customer_graph
      where branch_id is not null
      group by branch_id
    )
    select
      b.id,
      b.legacy_id,
      b.company_id,
      b.name,
      b.address,
      b.source_data,
      coalesce(bis.outstanding_total, 0) as outstanding_total,
      coalesce(bis.open_invoice_count, 0) as open_invoice_count,
      bis.last_invoice_date,
      coalesce(mc.active_machine_count, 0) as active_machine_count
    from marga.branches b
    left join branch_invoice_summary bis on bis.branch_id = b.id
    left join machine_counts mc on mc.branch_id = b.id
    where b.company_id = any($1::bigint[])
      and b.inactive is false
      and (
        coalesce(bis.outstanding_total, 0) > 0.01
        or coalesce(mc.active_machine_count, 0) > 0
      )
    order by b.company_id, b.name
  `, [companyIds]);
  return rows;
}

async function loadExistingAccounts(pool) {
  const { rows } = await pool.query(`
    select
      id, login, mobile_user_id, display_name, role, company_id, branch_id, active,
      credential_delivery_email, last_password_generated_at
    from marga.portal_accounts
  `);
  return rows;
}

function buildCompanyContacts(companies, branchesByCompany) {
  return companies.map((company) => {
    const branches = branchesByCompany.get(company.id) || [];
    const branchSources = branches.map((branch) => branch.source_data || {});
    const emails = extractEmails(
      company.profile_representative_email,
      ...branchSources.flatMap((source) => [
        source.representative_email,
        source.email,
        source.contact_email,
        source.acct_email,
        source.billing_email
      ])
    );
    const name = firstNonBlank(
      company.profile_representative_name,
      ...branchSources.flatMap((source) => [
        source.representative_name,
        source.signatory,
        source.contact_person,
        source.contactperson,
        source.service_contact,
        source.delivery_contact
      ]),
      company.name
    );
    const phone = firstNonBlank(
      company.profile_representative_phone,
      ...branchSources.flatMap((source) => [
        source.representative_phone,
        source.contact_number,
        source.contactno,
        source.phone,
        source.mobile,
        source.mobile_no,
        source.tel_no,
        source.acct_num,
        source.endusercontactnum
      ])
    );
    return {
      ...company,
      preferred_email: emails[0] || '',
      all_emails: emails,
      representative_name: name,
      representative_phone: phone
    };
  });
}

function chooseCompanyLogins(companies) {
  const emailUsage = new Map();
  companies.forEach((company) => {
    const email = cleanText(company.preferred_email).toLowerCase();
    if (!email) return;
    emailUsage.set(email, (emailUsage.get(email) || 0) + 1);
  });
  return companies.map((company) => {
    const email = cleanText(company.preferred_email).toLowerCase();
    const fallback = companyCode(company);
    const login = email && emailUsage.get(email) === 1 ? email : fallback;
    return { ...company, manager_login: login, manager_login_type: login === email ? 'email' : 'company_code' };
  });
}

function buildBranchAccountDraft(company, branch) {
  const source = branch.source_data || {};
  const emails = extractEmails(
    source.representative_email,
    source.email,
    source.contact_email,
    source.acct_email,
    source.billing_email
  );
  const displayName = firstNonBlank(
    source.contact_person,
    source.contactperson,
    source.signatory,
    source.representative_name,
    source.service_contact,
    source.delivery_contact,
    branch.name
  );
  const phone = firstNonBlank(
    source.contact_number,
    source.contactno,
    source.phone,
    source.mobile,
    source.mobile_no,
    source.tel_no,
    source.acct_num,
    source.endusercontactnum
  );
  const email = emails[0] || '';
  const login = branchCode(company, branch);
  return {
    company_id: company.id,
    company_name: company.name,
    company_legacy_id: company.legacy_id,
    branch_id: branch.id,
    branch_legacy_id: branch.legacy_id,
    branch_name: branch.name,
    branch_address: cleanText(branch.address),
    branch_city: firstNonBlank(source.city),
    contact_person: displayName,
    contact_number: phone,
    email,
    login,
    login_type: 'company_code',
    company_code: companyCode(company),
    branch_code: branchCode(company, branch),
    outstanding_balance: parseMoney(branch.outstanding_total),
    open_invoice_count: Number(branch.open_invoice_count || 0),
    active_machine_count: Number(branch.active_machine_count || 0)
  };
}

async function ensurePortalSchema(pool) {
  const { rows } = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'marga'
      and table_name = any($1::text[])
  `, [['portal_accounts', 'care_company_profiles', 'care_account_scopes']]);
  const found = new Set(rows.map((row) => row.table_name));
  const missing = ['portal_accounts', 'care_company_profiles', 'care_account_scopes'].filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Required portal tables are missing: ${missing.join(', ')}. Start the care portal server once as the schema owner before running this generator.`);
  }
}

async function upsertCompanyProfile(client, company) {
  await client.query(`
    insert into marga.care_company_profiles (
      company_id, portal_type, representative_name, representative_email, representative_phone, active, notes, updated_at
    )
    values ($1, $2, $3, $4, $5, true, $6, now())
    on conflict (company_id) do update set
      portal_type = excluded.portal_type,
      representative_name = excluded.representative_name,
      representative_email = excluded.representative_email,
      representative_phone = excluded.representative_phone,
      active = true,
      notes = excluded.notes,
      updated_at = now()
  `, [
    company.id,
    cleanText(company.portal_type) || 'mixed',
    cleanText(company.representative_name),
    cleanText(company.preferred_email).toLowerCase(),
    cleanText(company.representative_phone),
    `Generated from billing-backed care portal provisioning on ${new Date().toISOString()}`
  ]);
}

async function upsertPortalAccount(client, draft, existingAccount, options) {
  const shouldRotate = !existingAccount || options.rotateExisting;
  const password = shouldRotate ? randomSixDigitPassword() : '';
  const hash = shouldRotate ? passwordHash(password) : null;
  const branchId = draft.branch_id ? Number(draft.branch_id) : null;
  const fallbackLogin = cleanText(draft.fallback_company_code).toUpperCase() || null;
  const changingPrimaryLogin = existingAccount && cleanText(existingAccount.login).toLowerCase() !== cleanText(draft.login).toLowerCase();

  if (changingPrimaryLogin) {
    const sql = shouldRotate
      ? `
        update marga.portal_accounts
        set login = $2,
            display_name = $3,
            role = $4,
            company_id = $5,
            branch_id = $6,
            mobile_user_id = $7,
            password_hash = $8,
            password_salt = $9,
            password_iterations = $10,
            password_algorithm = $11,
            password_memory = $12,
            password_passes = $13,
            password_parallelism = $14,
            password_tag_length = $15,
            active = true,
            must_change_password = true,
            last_password_generated_at = now(),
            credential_delivery_email = $16,
            updated_at = now()
        where id = $1
        returning id, login, role, company_id, branch_id
      `
      : `
        update marga.portal_accounts
        set login = $2,
            display_name = $3,
            role = $4,
            company_id = $5,
            branch_id = $6,
            mobile_user_id = $7,
            active = true,
            must_change_password = coalesce(must_change_password, true),
            credential_delivery_email = $8,
            updated_at = now()
        where id = $1
        returning id, login, role, company_id, branch_id
      `;
    const params = shouldRotate
      ? [
          existingAccount.id,
          draft.login,
          draft.display_name,
          draft.role,
          draft.company_id,
          branchId,
          fallbackLogin,
          hash.password_hash,
          hash.password_salt,
          hash.password_iterations,
          hash.password_algorithm,
          hash.password_memory,
          hash.password_passes,
          hash.password_parallelism,
          hash.password_tag_length,
          draft.credential_delivery_email
        ]
      : [
          existingAccount.id,
          draft.login,
          draft.display_name,
          draft.role,
          draft.company_id,
          branchId,
          fallbackLogin,
          draft.credential_delivery_email
        ];
    const { rows } = await client.query(sql, params);
    return { account: rows[0], password, rotated: shouldRotate };
  }

  const params = shouldRotate
    ? [
        draft.login,
        draft.display_name,
        draft.role,
        draft.company_id,
        branchId,
        fallbackLogin,
        hash.password_hash,
        hash.password_salt,
        hash.password_iterations,
        hash.password_algorithm,
        hash.password_memory,
        hash.password_passes,
        hash.password_parallelism,
        hash.password_tag_length,
        draft.credential_delivery_email
      ]
    : [
        draft.login,
        draft.display_name,
        draft.role,
        draft.company_id,
        branchId,
        fallbackLogin,
        draft.credential_delivery_email
      ];

  const sql = shouldRotate
    ? `
      insert into marga.portal_accounts (
        login, display_name, role, company_id, branch_id, mobile_user_id, password_hash, password_salt, password_iterations,
        password_algorithm, password_memory, password_passes, password_parallelism, password_tag_length,
        active, must_change_password, last_password_generated_at, credential_delivery_email, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, true, now(), $15, now())
      on conflict (login) do update set
        display_name = excluded.display_name,
        role = excluded.role,
        company_id = excluded.company_id,
        branch_id = excluded.branch_id,
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
      returning id, login, role, company_id, branch_id
    `
    : `
      insert into marga.portal_accounts (
        login, display_name, role, company_id, branch_id, mobile_user_id, password_hash, password_salt, password_iterations,
        active, must_change_password, credential_delivery_email, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, 'retained', 'retained', 0, true, true, $7, now())
      on conflict (login) do update set
        display_name = excluded.display_name,
        role = excluded.role,
        company_id = excluded.company_id,
        branch_id = excluded.branch_id,
        mobile_user_id = excluded.mobile_user_id,
        active = true,
        must_change_password = coalesce(marga.portal_accounts.must_change_password, true),
        credential_delivery_email = excluded.credential_delivery_email,
        updated_at = now()
      returning id, login, role, company_id, branch_id
    `;
  const { rows } = await client.query(sql, params);
  return { account: rows[0], password, rotated: shouldRotate };
}

async function upsertScope(client, accountId, draft) {
  const branchId = draft.branch_id ? Number(draft.branch_id) : null;
  await client.query(`
    insert into marga.care_account_scopes (
      account_id, scope_type, company_id, branch_id, can_view_billing, can_request_service,
      can_request_toner, can_manage_branch_credentials, active, updated_at
    )
    values ($1, $2, $3, $4, true, true, true, $5, true, now())
    on conflict do nothing
  `, [
    accountId,
    draft.scope_type,
    draft.company_id,
    branchId,
    draft.can_manage_branch_credentials === true
  ]);
}

async function removeDuplicateCompanyAdmins(client, companyId, keepAccountId) {
  await client.query(
    `delete from marga.portal_accounts
     where role = 'company_admin'
       and company_id = $1
       and id <> $2`,
    [companyId, keepAccountId]
  );
}

async function main() {
  const args = parseArgs();
  ensureEnv(args);
  const seedFile = findLatestSeedFile(args.seedFile);
  const seededPasswords = loadSeedPasswords(seedFile);
  const databaseUrl = process.env.MARGABASE_DATABASE_URL || 'postgresql://margabase_admin@127.0.0.1:5432/margabase';
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensurePortalSchema(pool);

    const companiesRaw = await loadBillingCompanies(pool);
    const companyIds = companiesRaw.map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);
    const branchesRaw = companyIds.length ? await loadBranches(pool, companyIds) : [];
    const existingAccounts = await loadExistingAccounts(pool);
    const existingByLogin = new Map(existingAccounts.map((row) => [String(row.login || '').toLowerCase(), row]));
    const existingCompanyAdminByCompany = new Map(
      existingAccounts
        .filter((row) => row.role === 'company_admin')
        .sort((left, right) => {
          const leftRank = String(left.login || '').includes('@') ? 0 : 1;
          const rightRank = String(right.login || '').includes('@') ? 0 : 1;
          return leftRank - rightRank || Number(right.id || 0) - Number(left.id || 0);
        })
        .map((row) => [String(row.company_id || ''), row])
    );
    const branchesByCompany = new Map();
    for (const branch of branchesRaw) {
      if (!branchesByCompany.has(branch.company_id)) branchesByCompany.set(branch.company_id, []);
      branchesByCompany.get(branch.company_id).push(branch);
    }

    const companyContacts = chooseCompanyLogins(buildCompanyContacts(companiesRaw, branchesByCompany));

    const companyDrafts = companyContacts.map((company) => ({
      kind: 'company_admin',
      company_id: company.id,
      company_legacy_id: company.legacy_id,
      company_name: company.name,
      branch_id: '',
      branch_legacy_id: '',
      branch_name: '',
      branch_address: '',
      branch_city: '',
      contact_person: company.representative_name,
      contact_number: company.representative_phone,
      email: cleanText(company.preferred_email).toLowerCase(),
      primary_login: cleanText(company.manager_login).toLowerCase(),
      fallback_company_code: companyCode(company),
      login: cleanText(company.manager_login).toLowerCase(),
      login_type: company.manager_login_type,
      display_name: company.representative_name || company.name,
      role: 'company_admin',
      credential_delivery_email: cleanText(company.preferred_email).toLowerCase(),
      scope_type: 'company',
      can_manage_branch_credentials: true,
      company_code: companyCode(company),
      branch_code: '',
      outstanding_balance: parseMoney(company.outstanding_total),
      open_invoice_count: Number(company.open_invoice_count || 0),
      active_branch_count: Number(company.active_branch_count || 0),
      active_machine_count: Number(company.active_machine_count || 0),
      billed_invoice_count: Number(company.billed_invoice_count || 0),
      last_invoice_date: company.last_invoice_date ? new Date(company.last_invoice_date).toISOString() : '',
      portal_type: company.portal_type || 'mixed'
    }));

    const branchDrafts = companyContacts.flatMap((company) => {
      const branches = branchesByCompany.get(company.id) || [];
      return branches.map((branch) => {
        const draft = buildBranchAccountDraft(company, branch);
        return {
          kind: 'branch_user',
          display_name: draft.contact_person || draft.branch_name || company.name,
          role: 'branch_user',
          credential_delivery_email: cleanText(draft.email).toLowerCase() || cleanText(company.preferred_email).toLowerCase(),
          primary_login: draft.login,
          fallback_company_code: '',
          scope_type: 'branch',
          can_manage_branch_credentials: false,
          billed_invoice_count: '',
          last_invoice_date: branch.last_invoice_date ? new Date(branch.last_invoice_date).toISOString() : '',
          portal_type: company.portal_type || 'mixed',
          ...draft
        };
      });
    });

    const drafts = [...companyDrafts, ...branchDrafts];
    const reportRows = [];

    if (args.apply) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const company of companyContacts) {
          await upsertCompanyProfile(client, company);
        }
        for (const draft of drafts) {
          const existing = draft.kind === 'company_admin'
            ? (existingByLogin.get(String(draft.login || '').toLowerCase())
              || existingCompanyAdminByCompany.get(String(draft.company_id || ''))
              || null)
            : (existingByLogin.get(String(draft.login || '').toLowerCase()) || null);
          const { account, password, rotated } = await upsertPortalAccount(client, draft, existing, {
            rotateExisting: args.rotateExisting
          });
          await upsertScope(client, account.id, draft);
          if (draft.kind === 'company_admin') {
            await removeDuplicateCompanyAdmins(client, draft.company_id, account.id);
          }
          reportRows.push({
            account_type: draft.kind,
            company_name: draft.company_name,
            company_id: draft.company_id,
            company_legacy_id: draft.company_legacy_id,
            company_code: draft.company_code,
            branch_name: draft.branch_name,
            branch_id: draft.branch_id,
            branch_legacy_id: draft.branch_legacy_id,
            branch_code: draft.branch_code,
            primary_login: draft.primary_login,
            fallback_company_code: draft.fallback_company_code,
            login: draft.login,
            login_type: draft.login_type,
            temporary_password: password || seedPasswordForDraft(draft, seededPasswords),
            password_status: rotated ? (existing ? 'rotated' : 'new') : 'unchanged',
            credential_delivery_email: draft.credential_delivery_email,
            contact_person: draft.contact_person,
            contact_number: draft.contact_number,
            outstanding_balance: Number(draft.outstanding_balance || 0).toFixed(2),
            open_invoice_count: draft.open_invoice_count,
            active_branch_count: draft.active_branch_count || '',
            active_machine_count: draft.active_machine_count || '',
            billed_invoice_count: draft.billed_invoice_count,
            portal_type: draft.portal_type
          });
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    } else {
      for (const draft of drafts) {
        const existing = draft.kind === 'company_admin'
          ? (existingByLogin.get(String(draft.login || '').toLowerCase())
            || existingCompanyAdminByCompany.get(String(draft.company_id || ''))
            || null)
          : (existingByLogin.get(String(draft.login || '').toLowerCase()) || null);
        reportRows.push({
          account_type: draft.kind,
          company_name: draft.company_name,
          company_id: draft.company_id,
          company_legacy_id: draft.company_legacy_id,
          company_code: draft.company_code,
          branch_name: draft.branch_name,
          branch_id: draft.branch_id,
          branch_legacy_id: draft.branch_legacy_id,
          branch_code: draft.branch_code,
          primary_login: draft.primary_login,
          fallback_company_code: draft.fallback_company_code,
          login: draft.login,
          login_type: draft.login_type,
          temporary_password: existing
            ? seedPasswordForDraft(draft, seededPasswords)
            : '(will generate on --apply)',
          password_status: existing ? 'existing' : 'new',
          credential_delivery_email: draft.credential_delivery_email,
          contact_person: draft.contact_person,
          contact_number: draft.contact_number,
          outstanding_balance: Number(draft.outstanding_balance || 0).toFixed(2),
          open_invoice_count: draft.open_invoice_count,
          active_branch_count: draft.active_branch_count || '',
          active_machine_count: draft.active_machine_count || '',
          billed_invoice_count: draft.billed_invoice_count,
          portal_type: draft.portal_type
        });
      }
    }

    const outputDir = path.resolve(args.outDir || `/Users/mike/Desktop/marga-care-credentials-${nowStamp()}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, 'credentials.json');
    const csvPath = path.join(outputDir, 'credentials.csv');
    const summaryPath = path.join(outputDir, 'summary.txt');

    const summary = {
      generated_at: new Date().toISOString(),
      apply: args.apply,
      rotate_existing: args.rotateExisting,
      seed_file: seedFile || null,
      output_dir: outputDir,
      total_accounts: reportRows.length,
      company_admin_accounts: reportRows.filter((row) => row.account_type === 'company_admin').length,
      branch_user_accounts: reportRows.filter((row) => row.account_type === 'branch_user').length,
      companies: new Set(reportRows.map((row) => `${row.company_id}`)).size,
      accounts_with_delivery_email: reportRows.filter((row) => row.credential_delivery_email).length,
      passwords_in_report: reportRows.filter((row) => row.temporary_password).length
    };

    fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows: reportRows }, null, 2));
    fs.writeFileSync(csvPath, toCsv(reportRows, [
      'account_type',
      'company_name',
      'company_id',
      'company_legacy_id',
      'company_code',
      'branch_name',
      'branch_id',
      'branch_legacy_id',
      'branch_code',
      'primary_login',
      'fallback_company_code',
      'login',
      'login_type',
      'temporary_password',
      'password_status',
      'credential_delivery_email',
      'contact_person',
      'contact_number',
      'outstanding_balance',
      'open_invoice_count',
      'active_branch_count',
      'active_machine_count',
      'billed_invoice_count',
      'portal_type'
    ]));
    fs.writeFileSync(summaryPath, [
      `Generated: ${summary.generated_at}`,
      `Apply mode: ${summary.apply}`,
      `Rotate existing passwords: ${summary.rotate_existing}`,
      `Companies: ${summary.companies}`,
      `Accounts: ${summary.total_accounts}`,
      `Company admins: ${summary.company_admin_accounts}`,
      `Branch users: ${summary.branch_user_accounts}`,
      `Rows with delivery email: ${summary.accounts_with_delivery_email}`,
      `Rows with visible passwords in this report: ${summary.passwords_in_report}`,
      '',
      `CSV: ${csvPath}`,
      `JSON: ${jsonPath}`
    ].join('\n'));

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
