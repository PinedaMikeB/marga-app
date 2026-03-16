# Master Sync Coverage

This document is the live-database sync coverage list for `margaco_db`.

It is based on the actual MySQL tables visible on `2026-03-16`, not only on old dump presets or guessed table names.

## Sync Rules

Use one sync strategy per table, not one generic rule for the whole database.

- `reference_refresh`
  - master data, mostly stable
  - full refresh nightly or periodic timestamp refresh
- `append_only`
  - new rows are added, old rows rarely edited
  - sync by `id > last_id`
- `mutable_with_timestamp`
  - rows are created and later edited
  - sync by `id > last_id` plus rolling rescan on `timestmp`, `timestamp`, `update_date`, or similar
- `mutable_no_timestamp`
  - rows are edited but no reliable update column exists
  - use periodic reconcile or domain-specific refresh rules
- `reverse_bridge_safe`
  - Firebase can write back only approved fields to existing MySQL columns

## Source Of Truth

For the current hybrid phase:

- MySQL is the source of truth for:
  - customer records
  - branch records
  - machines
  - contracts
  - invoices
  - payments
  - collections
  - delivery and pullout records
  - petty cash
  - refill production
- Firebase is the operational web read model and field update layer
- Firebase -> MySQL writeback must stay limited to approved operational fields already present in legacy SQL

## Current Live Coverage

Already active in the office sync runner:

- `tbl_schedule`
- `tbl_printedscheds`
- `tbl_savedscheds`
- `tbl_schedtime`
- `tbl_closedscheds`

Current reverse bridge coverage:

- `tbl_collectionhistory`
- `tbl_schedule`
- `tbl_schedtime`
- optional `tbl_closedscheds`

This means service routing is now partly live-synced, but the rest of the business domains below still need explicit onboarding.

## Tier 1 Operational Domains

These should be brought into managed sync first because daily operations depend on them.

### Customers And Branches

These drive customer active/inactive state, contact details, and delivery/service targets.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_companylist` | main customer/company master | `reference_refresh` |
| `tbl_branchinfo` | customer branch master, includes `inactive` | `mutable_no_timestamp` |
| `tbl_branchcontact` | branch contacts | `mutable_no_timestamp` |
| `tbl_customerinfo` | customer detail/master table | `mutable_no_timestamp` |
| `tbl_customertype` | lookup | `reference_refresh` |
| `tbl_wyicustomerinfo` | WYi-specific customer data | `reference_refresh` |

Notes:

- `tbl_branchinfo.inactive` must be reflected in Firebase/web.
- New customers and new branches must appear before scheduling, delivery, billing, or contract workflows use them.

### Machines And Machine Master Data

These must sync before delivery, service, or contract attachment can be trusted.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_machine` | machine master list | `mutable_no_timestamp` |
| `tbl_model` | model lookup | `reference_refresh` |
| `tbl_brand` | brand lookup | `reference_refresh` |
| `tbl_machineorder` | machine ordering / acquisition | `append_only` |
| `tbl_machinepickupreceipt` | pullout / pickup receipt, has `datex`, `status` | `mutable_no_timestamp` |
| `tbl_machinemonthlystatus` | monthly machine state | `mutable_no_timestamp` |
| `tbl_machinereading` | meter reading log, has `timestmp` | `mutable_with_timestamp` |
| `tbl_machineverifier` | machine verification status | `mutable_no_timestamp` |

Notes:

- A machine must exist in Firebase before web delivery or service screens can safely use it.
- `tbl_machine` has no obvious reliable update timestamp, so it needs reconcile logic, not only `id`.

### Contracts And Shutdown / Termination

These affect billing, service entitlement, and customer lifecycle.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_contractmain` | main contract header, has `update_date` | `mutable_with_timestamp` |
| `tbl_contractdetails` | contract detail rows | `mutable_no_timestamp` |
| `tbl_contractinfo` | contract info / status | `mutable_no_timestamp` |
| `tbl_contractstatus` | lookup | `reference_refresh` |
| `tbl_contracthistory` | contract history | `append_only` |
| `tbl_terminationrecords` | termination workflow, has `datex`, `status` | `mutable_no_timestamp` |
| `tbl_terminatedrecords` | terminated record set | `mutable_no_timestamp` |
| `tbl_forshutdown` | shutdown candidates/status | `mutable_no_timestamp` |
| `tbl_shutdownmachines` | shutdown machine state | `mutable_no_timestamp` |

Notes:

- `tbl_contractmain.update_date` is a good candidate for mutable live refresh.
- Termination/shutdown tables likely need domain reconcile because status changes are operationally important.

### Service / Dispatch

This is the most advanced live-sync domain today.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_schedule` | master schedule/ticket | `mutable_no_timestamp` with linked refresh |
| `tbl_printedscheds` | printed route rows, has `timestmp` | `mutable_with_timestamp` |
| `tbl_savedscheds` | saved route rows, has `timestmp` | `mutable_with_timestamp` |
| `tbl_schedtime` | field execution log | `append_only` / `mutable_with_timestamp` |
| `tbl_closedscheds` | closure markers | `append_only` |
| `tbl_serviceinfo` | service-related master data | `reference_refresh` |
| `tbl_trouble` | lookup | `reference_refresh` |
| `tbl_mstatus` | lookup | `reference_refresh` |
| `tbl_purpose` | lookup | `reference_refresh` |
| `tbl_reading` | reading operational data | `mutable_no_timestamp` |

Notes:

- Route rows now rescan by `timestmp`, which fixed Hener’s stale close counts.
- `tbl_schedule` still needs a broader mutable strategy because many edits happen to existing rows.

### Billing / Invoices / Unpaid Monitoring

These tables must support invoice visibility, unpaid monitoring, and billing operations.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_billinfo` | invoice/billing header | `mutable_no_timestamp` |
| `tbl_billing` | billing records, includes `status` | `mutable_no_timestamp` |
| `tbl_billingsearch` | helper/search table | `reference_refresh` or skip if derived |
| `tbl_invoicenum` | invoice numbering/status | `mutable_no_timestamp` |
| `tbl_invoiceage` | unpaid aging | `reference_refresh` or rebuild-from-SQL |
| `tbl_cancelledinvoices` | cancelled invoices, has `timestmp` | `mutable_with_timestamp` |
| `enduser_invoices` | view/report object | `read-only derived` |
| `collectionview` | view/report object | `read-only derived` |

Notes:

- `enduser_invoices` and `collectionview` look like views or special report objects; do not treat them like normal mutable tables.
- Invoice aging and unpaid views are often better rebuilt from source tables than blindly mirrored.

### Collections / Payments / OR / Deposits

These tables track actual money movement and follow-up.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_collectioninfo` | collection header/workflow | `mutable_no_timestamp` |
| `tbl_collections` | collection records | `mutable_no_timestamp` |
| `tbl_collectionhistory` | follow-up log, has `timestamp` | `append_only` |
| `tbl_collectionstatus` | lookup | `reference_refresh` |
| `tbl_paymentinfo` | payment details, has `timestamp` | `mutable_with_timestamp` |
| `tbl_payments` | payment records, has `timestamp` | `mutable_with_timestamp` |
| `tbl_paymentcheck` | payment check rows, has `date_added` | `mutable_with_timestamp` |
| `tbl_checkpayments` | check payments | `mutable_no_timestamp` |
| `tbl_depositslip` | deposit slip header, has `timest` | `mutable_with_timestamp` |
| `tbl_depositsliptransaction` | deposit slip transaction rows | `mutable_with_timestamp` |
| `tbl_ornumber` | OR issuance | `mutable_no_timestamp` |

Notes:

- `tbl_collectionhistory` is already in reverse bridge coverage and is a good append-only example.
- `tbl_paymentinfo`, `tbl_payments`, `tbl_paymentcheck`, and deposit tables are good candidates for live mutable sync because they have timestamps.

### Delivery / DR / Pullout

These cover releases, deliveries, DR processing, and retrievals.

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_dispatchment` | dispatch header | `mutable_no_timestamp` |
| `tbl_deliveryinfo` | delivery information | `mutable_no_timestamp` |
| `tbl_dispatcheditems` | dispatched line items, has `timestamp` | `mutable_with_timestamp` |
| `tbl_drmain` | DR header, has `timestmp` | `mutable_with_timestamp` |
| `tbl_dr` | delivery request / DR workflow, has `date_requested` | `mutable_with_timestamp` |
| `tbl_drhistory` | DR history | `append_only` |
| `tbl_finaldr` | final DR, cancellation/receipt state | `mutable_no_timestamp` |
| `tbl_finaldrdetails` | final DR detail rows | `append_only` |
| `tbl_machinepickupreceipt` | pullout receipt | `mutable_no_timestamp` |

Notes:

- Delivery should not be considered valid in Firebase if machine and DR rows are not yet synced.
- DR headers and dispatched items have timestamp-style columns and should be onboarded with mutable refresh.

### Petty Cash And Office Cash Movement

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_pettycash` | legacy petty cash | `mutable_no_timestamp` |
| `tbl_pcmain` | petty cash header | `mutable_no_timestamp` |
| `tbl_pcdetails` | petty cash detail rows | `append_only` |
| `tbl_newpettycash` | newer petty cash, has `timestmp` | `mutable_with_timestamp` |

Notes:

- `tbl_newpettycash` is easier to live-sync correctly than legacy petty cash tables because it has `timestmp`.

### Toner Refill / Production / Release

| Table | Role | Suggested Sync |
| --- | --- | --- |
| `tbl_tonerink` | toner/ink item master/status | `mutable_no_timestamp` |
| `tbl_refillitems` | refill line items | `append_only` |
| `tbl_itemprepared` | preparation records | `append_only` |
| `tbl_itemreceived` | received items, has `date_received`, `status` | `mutable_with_timestamp` |
| `tbl_releaseditems` | released items / receipt state | `mutable_no_timestamp` |
| `tbl_newtonerinkhistory` | toner/ink history | `append_only` |
| `tbl_cartridgeprocorder` | production/process order | `append_only` |
| `tbl_cartridgepartshistory` | cartridge parts history | `append_only` |

Notes:

- Refill production is a mix of append-only history and mutable fulfillment status.
- Release/receipt state should be treated as mutable operational data.

## Tier 2 Supporting Master Data

These should sync, but after Tier 1.

- `tbl_area`
- `tbl_city`
- `tbl_employee`
- `tbl_empos`
- `tbl_status`
- `tbl_origin`
- `tbl_supplier`
- `tbl_parts`
- `tbl_partstype`
- `tbl_inventoryparts`
- `tbl_paymenttype`
- `tbl_checktype`
- `tbl_contractstatus`
- `tbl_collectionstatus`

Suggested strategy:

- mostly `reference_refresh`
- nightly or on-demand reload

## Gaps In The Current Sync Setup

Current known architectural gaps:

- some old preset names do not match the live database exactly
  - example: live DB has `tbl_collections` and `tbl_collectioninfo`, not only `tbl_collection`
- `id` watermark alone is not enough for mutable operational rows
- many important masters have no reliable update timestamp
  - these require periodic reconcile, not just incremental insert sync
- Firebase -> MySQL reverse bridge is intentionally narrow today
  - this is correct for safety, but it does not yet cover full finance and logistics transactions

## Recommended Rollout

1. Keep service live sync running as now.
2. Add Tier 1 domains to a table manifest in the office sync runner.
3. For each table, set:
   - source of truth
   - sync direction
   - sync mode
   - linked parent refresh rules
4. Add nightly reconcile jobs for all `mutable_no_timestamp` masters.
5. Add per-domain audit reports:
   - MySQL count
   - Firebase count
   - recent changed rows
   - mismatch samples
6. Expand reverse bridge only for fields already proven safe in legacy VB.NET.

## Immediate Priority List

These should be the next tables brought into active managed sync after service:

- `tbl_companylist`
- `tbl_branchinfo`
- `tbl_branchcontact`
- `tbl_machine`
- `tbl_contractmain`
- `tbl_billinfo`
- `tbl_billing`
- `tbl_collectioninfo`
- `tbl_collections`
- `tbl_paymentinfo`
- `tbl_payments`
- `tbl_drmain`
- `tbl_dr`
- `tbl_finaldr`
- `tbl_newpettycash`
- `tbl_itemreceived`

These tables cover the user-visible business events you called out:

- inactive customers
- new customer creation
- new machine creation
- contract creation and changes
- invoice and unpaid movement
- delivery and pullout
- payments and deposits
- petty cash
- toner refill production
