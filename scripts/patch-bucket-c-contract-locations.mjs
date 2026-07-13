#!/usr/bin/env node
/**
 * patch-bucket-c-contract-locations.mjs
 * Patches the `location` field in tbl_contractmain Firestore documents
 * for Bucket C companies that are missing the branch location link.
 * This makes them visible in the billing grid month-to-month comparison.
 * Ronald Aguilar is intentionally excluded (refill/non-rental).
 * Run: node scripts/patch-bucket-c-contract-locations.mjs [--apply]
 */
const FIRESTORE_BASE = 'http://127.0.0.1:8787/v1/projects/sah-spiritual-journal/databases/(default)/documents';
const DRY_RUN = !process.argv.includes('--apply');

const PATCHES = [
  { contractId: '3011', location: '1598', company: '3K & Percz Digital Printing', branch: '3K & Percz' },
  { contractId: '1970', location: '983',  company: 'ASYM Enterprises', branch: 'ASYM Enterprises' },
  { contractId: '3577', location: '983',  company: 'ASYM Enterprises', branch: 'ASYM Enterprises' },
  { contractId: '4367', location: '983',  company: 'ASYM Enterprises', branch: 'ASYM Enterprises' },
  { contractId: '5189', location: '3464', company: 'Attila Inc', branch: 'Attila Inc. Upgrade' },
  { contractId: '5194', location: '3464', company: 'Attila Inc', branch: 'Attila Inc. Upgrade' },
  { contractId: '1930', location: '936',  company: 'Equity Homes Inc.', branch: 'Equity Homes Inc.' },
  { contractId: '5097', location: '3407', company: 'Metropolis Construction', branch: 'Metropolis Construction Inc.' },
  { contractId: '2239', location: '1137', company: 'N/A', branch: 'N/A' },
  { contractId: '4812', location: '1137', company: 'N/A', branch: 'N/A' },
  { contractId: '5734', location: '1137', company: 'N/A', branch: 'N/A' },
  { contractId: '4836', location: '3236', company: 'Salvador Llanillo', branch: 'Salvador Llanillo MP2851' },
  { contractId: '4839', location: '3236', company: 'Salvador Llanillo', branch: 'Salvador Llanillo MP2851' },
  { contractId: '5103', location: '3797', company: 'Storeminder Philippines', branch: 'Storeminder - Operations' },
  { contractId: '5104', location: '3796', company: 'Storeminder Philippines', branch: 'Storeminder - Sales' },
  { contractId: '929',  location: '715',  company: 'Tesda Provincial Training Center', branch: 'Tesda - Rosario' },
  { contractId: '2003', location: '750',  company: 'Uplift Cares', branch: 'Uplift Cares - CCF' },
  { contractId: '2039', location: '751',  company: 'Uplift Cares', branch: 'Uplift Cares' },
  { contractId: '2040', location: '750',  company: 'Uplift Cares', branch: 'Uplift Cares - CCF' },
];

async function getDocument(contractId) {
  const url = `${FIRESTORE_BASE}/tbl_contractmain/${contractId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${contractId} failed: ${res.status}`);
  return res.json();
}

async function patchDocument(contractId, location) {
  const url = `${FIRESTORE_BASE}/tbl_contractmain/${contractId}?updateMask.fieldPaths=location`;
  const body = { fields: { location: { integerValue: String(location) } } };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${contractId} failed: ${res.status} — ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`patch-bucket-c-contract-locations`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --apply to write)' : '*** APPLYING CHANGES ***'}`);
  console.log(`Contracts to patch: ${PATCHES.length}`);
  console.log(`${'='.repeat(60)}\n`);

  const results = { patched: 0, skipped: 0, failed: 0, alreadySet: 0 };

  for (const patch of PATCHES) {
    const { contractId, location, company, branch } = patch;
    try {
      const doc = await getDocument(contractId);
      const currentLocation = doc?.fields?.location?.integerValue
        || doc?.fields?.location?.stringValue || null;

      if (currentLocation && String(currentLocation) === String(location)) {
        console.log(`✓ SKIP  contract ${contractId} (${company}) — location already = ${location}`);
        results.alreadySet++;
        continue;
      }

      console.log(`→ PATCH contract ${contractId} (${company} / ${branch})`);
      console.log(`         location: ${currentLocation || 'NULL'} → ${location}`);

      if (!DRY_RUN) {
        await patchDocument(contractId, location);
        console.log(`  ✅ Done`);
        results.patched++;
      } else {
        console.log(`  [DRY RUN — not written]`);
        results.skipped++;
      }
    } catch (err) {
      console.error(`  ❌ FAILED contract ${contractId}: ${err.message}`);
      results.failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Already set:   ${results.alreadySet}`);
  console.log(`  Patched:       ${results.patched}`);
  console.log(`  Skipped (dry): ${results.skipped}`);
  console.log(`  Failed:        ${results.failed}`);
  if (DRY_RUN) console.log(`\n  Run with --apply to write changes.`);
  else console.log(`\n  ✅ Done. Reload billing grid and run generate-care-portal-accounts.mjs --apply next.`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
