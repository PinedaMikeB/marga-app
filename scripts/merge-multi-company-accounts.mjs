#!/usr/bin/env node
/**
 * merge-multi-company-accounts.mjs
 * 
 * Finds company_admin portal accounts sharing the same credential_delivery_email
 * (same person managing multiple Marga billing entities). Merges secondary company
 * scopes into the primary account, deactivates secondary accounts.
 * 
 * Usage:
 *   node scripts/merge-multi-company-accounts.mjs          # dry-run (safe)
 *   node scripts/merge-multi-company-accounts.mjs --apply  # execute changes
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformRequire = createRequire('/Volumes/Wotg Drive Mike/GitHub/marga-platform/package.json');
const { Pool } = platformRequire('pg');

const apply = process.argv.includes('--apply');

const pool = new Pool({
  host: '127.0.0.1', port: 5432, database: 'margabase',
  user: 'margabase_admin', password: ''
});

async function main() {
  console.log(`\n=== Merge Multi-Company Accounts === ${apply ? '[ APPLY MODE ]' : '[ DRY RUN ]'}\n`);

  // Step 1: Find same-email company_admins across multiple companies
  const { rows: groups } = await pool.query(`
    SELECT
      pa.credential_delivery_email as email,
      COUNT(DISTINCT pa.company_id) as company_count,
      array_agg(pa.id ORDER BY pa.created_at ASC) as account_ids,
      array_agg(pa.company_id ORDER BY pa.created_at ASC) as company_ids,
      array_agg(pa.login ORDER BY pa.created_at ASC) as logins,
      array_agg(pa.display_name ORDER BY pa.created_at ASC) as names,
      array_agg(c.name ORDER BY pa.created_at ASC) as company_names,
      array_agg(pa.active ORDER BY pa.created_at ASC) as active_flags

    FROM marga.portal_accounts pa
    JOIN marga.companies c ON c.id = pa.company_id
    WHERE pa.role = 'company_admin'
      AND pa.credential_delivery_email IS NOT NULL
      AND pa.credential_delivery_email != ''
    GROUP BY pa.credential_delivery_email
    HAVING COUNT(DISTINCT pa.company_id) > 1
    ORDER BY COUNT(DISTINCT pa.company_id) DESC, pa.credential_delivery_email
  `);

  if (!groups.length) {
    console.log('No multi-company accounts found. Nothing to do.');
    await pool.end(); return;
  }

  console.log(`Found ${groups.length} person(s) managing multiple companies:\n`);

  const mergeOps = [];

  for (const group of groups) {
    // Primary = first created account (oldest). Secondary = all others.
    const primaryIdx = 0;
    const primaryId = group.account_ids[primaryIdx];
    const primaryLogin = group.logins[primaryIdx];
    const primaryCompanyId = group.company_ids[primaryIdx];

    console.log(`──────────────────────────────────────────────`);
    console.log(`  Email:   ${group.email}`);
    console.log(`  Person:  ${group.names[primaryIdx]}`);
    console.log(`  PRIMARY: account_id=${primaryId} | login=${primaryLogin} | company_id=${primaryCompanyId} | ${group.company_names[primaryIdx]}`);

    for (let i = 1; i < group.account_ids.length; i++) {
      const secId = group.account_ids[i];
      const secLogin = group.logins[i];
      const secCompanyId = group.company_ids[i];
      const secCompanyName = group.company_names[i];
      const secActive = group.active_flags[i];

      console.log(`  MERGE:   account_id=${secId} | login=${secLogin} | company_id=${secCompanyId} | ${secCompanyName}`);
      console.log(`           → Add company scope ${secCompanyId} to primary account ${primaryId}`);
      console.log(`           → Deactivate secondary account ${secId} (was active=${secActive})`);

      // Check existing scope on primary for this secondary company
      const { rows: existingScope } = await pool.query(`
        SELECT id FROM marga.care_account_scopes
        WHERE account_id = $1 AND scope_type = 'company' AND company_id = $2
      `, [primaryId, secCompanyId]);

      // Get secondary account's scope settings (billing, service, toner perms)
      const { rows: secScope } = await pool.query(`
        SELECT * FROM marga.care_account_scopes
        WHERE account_id = $1 AND scope_type = 'company' AND company_id = $2
      `, [secId, secCompanyId]);

      const secScopeRow = secScope[0] || {};

      mergeOps.push({
        email: group.email,
        primaryAccountId: primaryId,
        primaryLogin,
        primaryCompanyId,
        secondaryAccountId: secId,
        secondaryLogin: secLogin,
        secondaryCompanyId: secCompanyId,
        secondaryCompanyName: secCompanyName,
        scopeAlreadyExists: existingScope.length > 0,
        canViewBilling: secScopeRow.can_view_billing ?? true,
        canRequestService: secScopeRow.can_request_service ?? true,
        canRequestToner: secScopeRow.can_request_toner ?? true,
        canManageBranchCredentials: secScopeRow.can_manage_branch_credentials ?? true,
      });
    }
    console.log('');
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Merge operations: ${mergeOps.length}`);
  console.log(`  Scopes already exist (skip insert): ${mergeOps.filter(o => o.scopeAlreadyExists).length}`);
  console.log(`  New scope inserts: ${mergeOps.filter(o => !o.scopeAlreadyExists).length}`);
  console.log(`  Accounts to deactivate: ${mergeOps.length}`);

  if (!apply) {
    console.log(`\n[ DRY RUN ] No changes made. Re-run with --apply to execute.\n`);
    await pool.end(); return;
  }

  // === APPLY ===
  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const op of mergeOps) {
      // 1. Insert new company scope on primary account (if not exists)
      if (!op.scopeAlreadyExists) {
        await client.query(`
          INSERT INTO marga.care_account_scopes
            (account_id, scope_type, company_id, can_view_billing, can_request_service,
             can_request_toner, can_manage_branch_credentials, active, updated_at)
          VALUES ($1, 'company', $2, $3, $4, $5, $6, true, now())
          ON CONFLICT (account_id, scope_type,
            COALESCE(company_id,0), COALESCE(branch_id,0),
            COALESCE(machine_id,0), COALESCE(contractmain_id,0)) DO UPDATE
          SET active = true, updated_at = now()
        `, [
          op.primaryAccountId, op.secondaryCompanyId,
          op.canViewBilling, op.canRequestService,
          op.canRequestToner, op.canManageBranchCredentials
        ]);
        console.log(`  ✅ Inserted scope: account ${op.primaryAccountId} → company ${op.secondaryCompanyId} (${op.secondaryCompanyName})`);
      } else {
        console.log(`  ⏭  Scope already exists: account ${op.primaryAccountId} → company ${op.secondaryCompanyId}`);
      }

      // 2. Also migrate branch-level scopes from secondary to primary account
      const { rows: branchScopes } = await client.query(`
        SELECT * FROM marga.care_account_scopes
        WHERE account_id = $1 AND scope_type = 'branch' AND company_id = $2
      `, [op.secondaryAccountId, op.secondaryCompanyId]);

      for (const bs of branchScopes) {
        await client.query(`
          INSERT INTO marga.care_account_scopes
            (account_id, scope_type, company_id, branch_id, can_view_billing,
             can_request_service, can_request_toner, can_manage_branch_credentials, active, updated_at)
          VALUES ($1, 'branch', $2, $3, $4, $5, $6, $7, true, now())
          ON CONFLICT (account_id, scope_type,
            COALESCE(company_id,0), COALESCE(branch_id,0),
            COALESCE(machine_id,0), COALESCE(contractmain_id,0)) DO NOTHING
        `, [
          op.primaryAccountId, bs.company_id, bs.branch_id,
          bs.can_view_billing, bs.can_request_service,
          bs.can_request_toner, bs.can_manage_branch_credentials
        ]);
      }
      if (branchScopes.length) {
        console.log(`  ✅ Migrated ${branchScopes.length} branch scopes from account ${op.secondaryAccountId} → ${op.primaryAccountId}`);
      }

      // 3. Deactivate secondary account
      await client.query(`
        UPDATE marga.portal_accounts SET active = false, updated_at = now()
        WHERE id = $1
      `, [op.secondaryAccountId]);
      console.log(`  ✅ Deactivated secondary account ${op.secondaryAccountId} (${op.secondaryLogin})`);
    }

    await client.query('commit');
    console.log(`\n✅ All changes committed.\n`);
  } catch (err) {
    await client.query('rollback');
    console.error('❌ Error — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
