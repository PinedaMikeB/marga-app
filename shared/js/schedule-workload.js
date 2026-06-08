commit 8ea4af496834376c5941ec46d281a4ac5c12f001
Author: PinedaMikeB <michael.marga@gmail.com>
Date:   Mon Jun 8 21:38:41 2026 +0800

    backup: auto push main 2026-06-08 21:38:27 +0800

diff --git a/HANDOFF.md b/HANDOFF.md
index 38f5dc8..2f4cad1 100644
--- a/HANDOFF.md
+++ b/HANDOFF.md
@@ -1,6 +1,6 @@
 # MARGA Handoff
 
-Last Updated: 2026-06-03
+Last Updated: 2026-06-08
 Canonical Status: Single source of truth for current operational handoff
 
 Start every new Marga-App thread by reading:
@@ -29,6 +29,25 @@ Start every new Marga-App thread by reading:
     - `GET /admin/file-assets/search`
     - `GET /admin/file-assets/read`
   - Keep schedule rows as summary pointers only (`field_billing_invoice_*` fields). The searchable truth for retrieval should stay in `tbl_field_invoice_images`.
+- 2026-06-08 reimbursement receipt storage rule:
+  - Field reimbursement / cash advance / liquidation receipt images must not use Firebase Storage anymore.
+  - Reuse the same owner-controlled Margabase file-asset pattern used by billing and collection proof images.
+  - Reimbursement receipts now belong under local storage category `pettycash-requests` in `/Volumes/Wotg Drive Mike/GitHub/marga-platform/apps/margabase/storage/` with metadata saved through `POST /admin/file-assets/upload`.
+  - Do not add a second receipt-upload backend for petty cash requests unless there is a deliberate migration plan and retrieval/search rule.
+- 2026-06-08 Collections follow-up unpaid list / dual-line billing lesson (ANCJ Architecture):
+  - Symptom: the month matrix showed correct unpaid months and amounts (Dec 2025 through May 2026), but the follow-up workspace **Unpaid Invoices In This List** showed only 2 invoices and one was **₱1,625** instead of the full invoice total.
+  - Root cause 1 — wrong data source: the matrix loads from the permanent Postgres summary `app_meta.collections_matrix_snapshot`, but follow-up was still building the unpaid list from sparse browser `allInvoices` and only the clicked cell's `records`. That dropped older unpaid months on the same account row. Do **not** bring back the old 7-minute full `tbl_billing` browser scan for normal Collections use.
+  - Root cause 2 — dual-line billing amount: some contracts bill two meter lines on one invoice (`amount`/`totalamount` plus `amount2`/`totalamount2`). Billing already sums both in `billing/js/billing.js` `getBillingDocAmount()`. Collections snapshot builder and follow-up loader were reading only line 1, so invoices like ANCJ **127133** stored **₱1,625** instead of **₱4,875** (1625 + 3250).
+  - Permanent-table truth: the one-time server matrix build already had all unpaid months on the row (example ANCJ `contract:4074`: 127133, 128184, 129407, 130336, 131221). The full scan did not miss the invoices; follow-up was reading the wrong source and the record amount formula was wrong.
+  - Fix applied 2026-06-08:
+    - Follow-up unpaid list, list balance, and SOA candidates must read **all open unpaid cells on the account row** from the matrix snapshot (`getCollectorRowOpenCells`, `getCollectorSoaListGroupCells`, `getCollectorMatrixRowUnpaidInvoices`), not sparse `allInvoices`.
+    - On-demand detail only: `ensureCollectorCellDetailData` may fetch billing/payment/history for invoice keys already on that row (narrow per-invoice queries). That is not a full billing scan.
+    - Amount rule: reuse Billing's `amount + amount2` in `collections/js/collections.js` (`getBillingDocAmountFromFields`) and `marga-platform/scripts/lib/collections-matrix-snapshot.mjs` (`billingDocAmountFromData`).
+    - Until the next server rebuild, if a cell has one invoice record but `displayBilledTotal` is higher than the stored record amount, the UI prefers the cell total so dual-line invoices display correctly.
+  - Rebuild rule: to correct stored `cell.records` amounts in Postgres, run one server job only: `node scripts/rebuild-collections-matrix-snapshot.mjs`. Staff **Load Data** must stay GET-summary-only; do not re-enable `collectionsFullScanAuthorized` / full browser billing scan as the default path.
+  - Verification example: ANCJ Architecture contract **4074** / machine **2617** — follow-up should list unpaid invoices **127133, 128184, 129407, 130336, 131221** with full totals (~**₱42,646** list balance), not 2 rows at **₱14,781**.
+  - Guardrail for future work: matrix grid, follow-up unpaid list, list balance, and Print SOA must all use the same permanent-summary row cells and the same billing amount formula. If matrix and follow-up disagree, inspect data source first (snapshot row vs browser scan), then inspect dual-line amount handling before touching payment logic.
+  - Reusable skill: `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-billing-collections` for unpaid statements, payment matching, and receivable totals.
 - 2026-06-01 DigitalOcean managed Postgres incident and infrastructure direction:
   - 2026-06-01 10:37 PM Manila Collections summary checkpoint:
     - After the DO-to-local raw-document backfill for May 30 and June 1, the accepted browser calculation was run once from the Collections **Load Data** button and saved to local Postgres permanent summary table `app_meta.collections_matrix_snapshot`.
diff --git a/MASTERPLAN.md b/MASTERPLAN.md
index 970053e..1cb41a7 100644
--- a/MASTERPLAN.md
+++ b/MASTERPLAN.md
@@ -1,6 +1,6 @@
 # MARGA Masterplan
 
-Last Updated: 2026-06-03
+Last Updated: 2026-06-08
 Canonical Status: Single source of truth for product strategy, guardrails, and migration rules
 
 Read first in every new Marga-App thread:
@@ -339,6 +339,21 @@ Billing protection rule:
 - `Machine ####` is a machine label fallback, not a valid steady-state SN display.
 - If the true serial is missing, use an explicit missing-serial label such as `No serial on file`.
 
+Collections permanent summary / follow-up workspace rule (2026-06-08):
+- Month matrix, summary table, and scorecard totals: Postgres `app_meta.collections_matrix_snapshot` only. Staff **Load Data** / **Refresh** must stay GET-summary-only.
+- Follow-up workspace **Unpaid Invoices In This List**, **List Balance**, and Print SOA candidates: same permanent summary — all open unpaid cells on the clicked account row, deduped by invoice identity (`invoice_no` / `invoice_id` / `invoiceKey`).
+- Do **not** use the retired full browser `tbl_billing` scan as the default source for matrix or follow-up unpaid lists. Do **not** rebuild unpaid lists from sparse browser `allInvoices` or from only the clicked month cell.
+- Allowed narrow reads: when staff open follow-up, fetch billing/payment/history only for invoice keys already present on that matrix row. Per-invoice queries are acceptable; broad billing walks are not.
+- If the matrix shows unpaid months but follow-up shows fewer invoices, inspect source split first (snapshot row vs browser billing) before changing payment or status logic.
+- Correct stored snapshot record amounts with one server rebuild: `node scripts/rebuild-collections-matrix-snapshot.mjs` in `marga-platform`. That is not a staff browser scan.
+
+Collections billing amount rule (dual-line invoices, 2026-06-08):
+- Collections invoice amount must match Billing: primary line (`totalamount` or `amount`) plus secondary line (`totalamount2` or `amount2`) when present.
+- Applies everywhere Collections stores or displays billed/unpaid amount: snapshot builder (`billingDocAmountFromData`), browser billing record builder (`getBillingDocAmountFromFields`), follow-up workspace, SOA, and matrix cell records.
+- Do not read only `amount`/`totalamount` for dual-meter contracts. Example: ANCJ invoice **127133** is **₱4,875** (1625 + 3250), not **₱1,625**.
+- Until snapshot records are rebuilt, a single-record cell may temporarily prefer `displayBilledTotal` when it is higher than the stored record amount. After rebuild, `cell.records` and cell totals must agree.
+- Use skill `/Volumes/Wotg Drive Mike/GitHub/marga-platform/skills/marga-billing-collections` for unpaid statements, payment matching, grouped invoices, and receivable-total work.
+
 Collections grouped-customer rules:
 - Some customers are billed with one mother invoice but have many branches/machines that must still be meter-read. These should appear as one clean parent row in the month-to-month matrix, with a `View Branches` expansion for the branch/machine reading breakdown.
 - `China Bank Savings - Branches` is the verified example and must be treated separately from similarly named individually billed China Bank Savings customers.
diff --git a/apd/index.html b/apd/index.html
index aa00791..0580a1a 100644
--- a/apd/index.html
+++ b/apd/index.html
@@ -71,6 +71,13 @@
                     </svg>
                     <span>Petty Cash</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../collections.html" class="nav-item" data-module="collections">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <rect x="1" y="4" width="22" height="16" rx="2"/>
diff --git a/billing/index.html b/billing/index.html
index 2fb6458..2816ae3 100644
--- a/billing/index.html
+++ b/billing/index.html
@@ -86,6 +86,13 @@
                     </svg>
                     <span>Petty Cash</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../collections.html" class="nav-item" data-module="collections">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <rect x="1" y="4" width="22" height="16" rx="2"/>
diff --git a/collections.html b/collections.html
index 9830e97..32b4f47 100644
--- a/collections.html
+++ b/collections.html
@@ -4672,6 +4672,7 @@
                 <a href="billing/" class="nav-item"><span class="icon">📄</span> Billing</a>
                 <a href="collections.html" class="nav-item active"><span class="icon">💰</span> Collections</a>
                 <a href="accounting/" class="nav-item" data-module="accounting"><span class="icon">AC</span> Accounting</a>
+                <a href="expenses/" class="nav-item" data-module="expenses"><span class="icon">💸</span> Money Requests</a>
                 <a href="master-schedule.html" class="nav-item"><span class="icon">📅</span> Master Schedule</a>
                 <a href="#" class="nav-item"><span class="icon">🔧</span> Service</a>
                 <a href="#" class="nav-item"><span class="icon">📈</span> Reports</a>
@@ -5069,6 +5070,6 @@
     <script src="/shared/js/pwa-install.js"></script>
     <script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
     <script src="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
-    <script src="collections/js/collections.js?v=20260601-summary-autoupdate-1"></script>
+    <script src="collections/js/collections.js?v=20260608-matrix-unpaid-list-1"></script>
 </body>
 </html>
diff --git a/collections/js/collections.js b/collections/js/collections.js
index 32bdb48..53dc6e3 100644
--- a/collections/js/collections.js
+++ b/collections/js/collections.js
@@ -58,6 +58,7 @@ let billingEntriesForDuration = [];
 let billingMetaByInvoiceKey = new Map();
 let collectorBillingRecords = [];
 let collectorBillingRecordKeys = new Set();
+let collectorInvoiceSourceDocKeys = new Set();
 let collectorCellMap = new Map();
 let collectorCellsByRowId = new Map();
 let collectionHistoryBulkLoaded = false;
@@ -1646,18 +1647,30 @@ function finalizeCollectorCellRecords(cellMap) {
     });
 }
 
-function getCollectorRecordOutstandingBalance(record) {
+function getCollectorRecordOutstandingBalance(record, cell = null) {
     if (!record) return 0;
-    const billed = Number(record.billedAmount || record.amount || 0);
+    const billed = getMatrixRecordBilledAmount(record, cell);
     if (billed <= 0) return 0;
-    return Math.max(0, billed - Number(record.collectedAmount || 0));
+    const collected = Number(record.collectedAmount || 0);
+    const recordBalance = Number(record.latestBalanceAmount);
+    if (Number.isFinite(recordBalance) && recordBalance > 0.01) {
+        const billedRecords = (cell?.records || []).filter((item) => Number(item.billedAmount || item.amount || 0) > 0.01);
+        if (billedRecords.length !== 1 || billed <= recordBalance + 0.01) {
+            return Math.max(0, Math.min(recordBalance, billed - collected));
+        }
+    }
+    return Math.max(0, billed - collected);
 }
 
 function getCellOutstandingBalance(cell) {
     if (!cell) return 0;
     const records = Array.isArray(cell.records) ? cell.records : [];
     if (records.length) {
-        return records.reduce((sum, record) => sum + getCollectorRecordOutstandingBalance(record), 0);
+        const fromRecords = records.reduce((sum, record) => sum + getCollectorRecordOutstandingBalance(record, cell), 0);
+        const cellBilled = Number(cell.displayBilledTotal || cell.billedTotal || 0);
+        const collected = Number(cell.collectedTotal || 0);
+        const fromCell = Math.max(0, cellBilled - collected);
+        return Math.max(fromRecords, fromCell);
     }
     const explicit = Number(cell.outstandingBalance || 0);
     if (explicit > 0) return explicit;
@@ -4492,6 +4505,109 @@ function buildAccountLabel(companyName, branchName) {
     return `${company} - ${branch}`;
 }
 
+function roundCollectionBillingAmount(value) {
+    const amount = Number(value || 0);
+    if (!Number.isFinite(amount)) return 0;
+    return Math.round(amount * 100) / 100;
+}
+
+function getBillingDocAmountFromFields(f = {}) {
+    const primaryAmount = Number(getField(f, ['totalamount']) || 0) > 0
+        ? Number(getField(f, ['totalamount']) || 0)
+        : Number(getField(f, ['amount']) || 0);
+    const secondaryAmount = Number(getField(f, ['totalamount2']) || 0) > 0
+        ? Number(getField(f, ['totalamount2']) || 0)
+        : Number(getField(f, ['amount2']) || 0);
+    return roundCollectionBillingAmount(primaryAmount + secondaryAmount);
+}
+
+function getMatrixRecordBilledAmount(record = {}, cell = null) {
+    const recordBilled = Number(record.billedAmount || record.amount || 0);
+    const cellBilled = Number(cell?.displayBilledTotal || cell?.billedTotal || 0);
+    const billedRecords = (cell?.records || []).filter((item) => Number(item.billedAmount || item.amount || 0) > 0.01);
+    if (billedRecords.length === 1 && cellBilled > recordBilled + 0.01) {
+        return cellBilled;
+    }
+    return recordBilled > 0 ? recordBilled : cellBilled;
+}
+
+function invoiceFromMatrixSnapshotRecord(record = {}, cell = null) {
+    const amount = getMatrixRecordBilledAmount(record, cell);
+    const collected = Number(record.collectedAmount || 0);
+    let latestBalanceAmount = Number(record.latestBalanceAmount);
+    const billedRecords = (cell?.records || []).filter((item) => Number(item.billedAmount || item.amount || 0) > 0.01);
+    if (!Number.isFinite(latestBalanceAmount) || latestBalanceAmount <= 0.01
+        || (billedRecords.length === 1 && amount > latestBalanceAmount + 0.01)) {
+        latestBalanceAmount = Math.max(0, amount - collected);
+    }
+    const invoiceNo = String(record.invoiceNo || record.invoiceId || record.invoiceKey || '').trim();
+    return {
+        ...record,
+        invoiceId: String(record.invoiceId || invoiceNo || '').trim(),
+        invoiceNo: invoiceNo || String(record.invoiceId || '').trim(),
+        invoiceKey: String(record.invoiceKey || invoiceNo || record.invoiceId || '').trim(),
+        invoiceDate: normalizeDate(record.invoiceDate || record.dueDate),
+        amount,
+        billedAmount: amount,
+        latestBalanceAmount,
+        company: record.company || cell?.customer || '',
+        branch: record.branch || cell?.branchName || '',
+        companyId: record.companyId || cell?.companyId || '',
+        branchId: record.branchId || cell?.branchId || '',
+        fromMatrixSnapshot: true
+    };
+}
+
+function collectCollectorRowInvoiceKeys(cell) {
+    const keys = new Set();
+    const appendFromRecords = (records = []) => {
+        records.forEach((record) => {
+            [record.invoiceNo, record.invoiceId, record.invoiceKey, record.id].forEach((value) => {
+                const key = String(value || '').trim();
+                if (key) keys.add(key);
+            });
+        });
+    };
+
+    appendFromRecords(cell?.records || []);
+    const rowId = String(cell?.rowId || '').trim();
+    if (!rowId || !collectorDashboardData?.customerRows?.length) {
+        return Array.from(keys);
+    }
+
+    const row = collectorDashboardData.customerRows.find((item) => String(item.rowId || '').trim() === rowId);
+    if (!row) return Array.from(keys);
+
+    getCollectorRowOpenCells(row).forEach((rowCell) => appendFromRecords(rowCell.records || []));
+    return Array.from(keys);
+}
+
+function getCollectorMatrixRowUnpaidInvoices(cell) {
+    if (!cell || !canUseCollectorMatrixSnapshot()) return [];
+
+    const workspace = { cell, context: resolveCollectorCellContext(cell) };
+    const seen = new Set();
+    const invoices = [];
+
+    getCollectorSoaListGroupCells(workspace).forEach((rowCell) => {
+        (rowCell.records || []).forEach((record) => {
+            const invoice = invoiceFromMatrixSnapshotRecord(record, rowCell);
+            const key = String(invoice.invoiceKey || invoice.invoiceNo || invoice.invoiceId || '').trim();
+            const outstanding = getOutstandingInvoiceAmount(invoice);
+            if (!key || seen.has(key) || outstanding <= 0.01) return;
+            seen.add(key);
+            invoices.push(invoice);
+        });
+    });
+
+    return invoices.sort((left, right) => {
+        const leftTime = (left.invoiceDate || new Date(0)).getTime();
+        const rightTime = (right.invoiceDate || new Date(0)).getTime();
+        if (leftTime !== rightTime) return leftTime - rightTime;
+        return String(left.invoiceNo || '').localeCompare(String(right.invoiceNo || ''));
+    });
+}
+
 function processInvoice(doc) {
     const f = doc.fields || {};
 
@@ -4502,7 +4618,6 @@ function processInvoice(doc) {
     const invoiceNoKey = invoiceNo !== null && invoiceNo !== undefined ? String(invoiceNo).trim() : '';
 
     if (!invoiceIdKey && !invoiceNoKey) return null;
-    if (paidInvoiceIds.has(invoiceIdKey) || paidInvoiceIds.has(invoiceNoKey)) return null;
 
     const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
     const location = getBillingLocationFromFields(f, contractmainId);
@@ -4517,7 +4632,8 @@ function processInvoice(doc) {
     const billingContactNumber = getField(f, ['contact_number']) || '';
 
     const age = calculateAge(dueDate, month, year);
-    const totalAmount = Number(getField(f, ['totalamount', 'amount']) || 0);
+    const totalAmount = getBillingDocAmountFromFields(f);
+    if (totalAmount <= 0) return null;
 
     const history = getHistoryForInvoice(invoiceIdKey, invoiceNoKey);
     const lastHistory = history.length > 0 ? history[0] : null;
@@ -4565,6 +4681,95 @@ function processInvoice(doc) {
     };
 }
 
+function mergeCollectorInvoice(existing, incoming) {
+    const mergedAmount = Number((Number(existing?.amount || 0) + Number(incoming?.amount || 0)).toFixed(2));
+    const mergedLastContactDate = [existing?.lastContactDate, incoming?.lastContactDate]
+        .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()))
+        .sort((left, right) => right.getTime() - left.getTime())[0] || null;
+    const mergedAge = Math.max(Number(existing?.age || 0), Number(incoming?.age || 0));
+    const mergedHistory = Array.isArray(existing?.history) && existing.history.length
+        ? existing.history
+        : (Array.isArray(incoming?.history) ? incoming.history : []);
+
+    return {
+        ...existing,
+        ...incoming,
+        id: existing?.id ?? incoming?.id,
+        invoiceId: existing?.invoiceId || incoming?.invoiceId,
+        invoiceNo: existing?.invoiceNo || incoming?.invoiceNo,
+        invoiceKey: existing?.invoiceKey || incoming?.invoiceKey,
+        amount: mergedAmount,
+        month: existing?.month || incoming?.month,
+        year: existing?.year || incoming?.year,
+        monthYear: existing?.monthYear && existing.monthYear !== '-' ? existing.monthYear : (incoming?.monthYear || '-'),
+        invoiceDate: existing?.invoiceDate || incoming?.invoiceDate,
+        invoiceDateRaw: existing?.invoiceDateRaw || incoming?.invoiceDateRaw,
+        dueDate: existing?.dueDate || incoming?.dueDate,
+        dateReceived: existing?.dateReceived || incoming?.dateReceived,
+        receivedBy: existing?.receivedBy || incoming?.receivedBy,
+        billingStatus: existing?.billingStatus || incoming?.billingStatus,
+        billingLocation: existing?.billingLocation || incoming?.billingLocation,
+        billingRemarks: existing?.billingRemarks || incoming?.billingRemarks,
+        age: mergedAge,
+        priority: getPriority(mergedAge),
+        company: existing?.company || incoming?.company,
+        branch: existing?.branch || incoming?.branch,
+        accountLabel: existing?.accountLabel || incoming?.accountLabel,
+        companyId: existing?.companyId || incoming?.companyId,
+        branchId: existing?.branchId || incoming?.branchId,
+        machineId: existing?.machineId || incoming?.machineId,
+        contractmainId: existing?.contractmainId || incoming?.contractmainId,
+        serialNumber: existing?.serialNumber || incoming?.serialNumber,
+        modelName: existing?.modelName || incoming?.modelName,
+        machineLabel: existing?.machineLabel || incoming?.machineLabel,
+        contactNumber: existing?.contactNumber || incoming?.contactNumber,
+        category: existing?.category || incoming?.category,
+        lastRemarks: existing?.lastRemarks || incoming?.lastRemarks,
+        lastContactDate: mergedLastContactDate,
+        lastContactDays: mergedLastContactDate ? Math.max(0, daysBetween(mergedLastContactDate, new Date())) : null,
+        nextFollowup: existing?.nextFollowup || incoming?.nextFollowup,
+        historyCount: mergedHistory.length,
+        history: mergedHistory
+    };
+}
+
+function upsertCollectorInvoice(invoice, sourceDocKey = '') {
+    if (!invoice) return false;
+
+    const safeDocKey = String(sourceDocKey || '').trim();
+    if (safeDocKey) {
+        if (collectorInvoiceSourceDocKeys.has(safeDocKey)) return false;
+        collectorInvoiceSourceDocKeys.add(safeDocKey);
+    }
+
+    const invoiceKeys = new Set([
+        invoice.invoiceKey,
+        invoice.invoiceNo,
+        invoice.invoiceId
+    ].map((value) => String(value || '').trim()).filter(Boolean));
+    if (!invoiceKeys.size) return false;
+
+    const existingIndex = allInvoices.findIndex((item) => {
+        const itemKeys = [
+            item?.invoiceKey,
+            item?.invoiceNo,
+            item?.invoiceId
+        ].map((value) => String(value || '').trim()).filter(Boolean);
+        return itemKeys.some((key) => invoiceKeys.has(key));
+    });
+
+    if (existingIndex === -1) {
+        allInvoices.push({
+            ...invoice,
+            amount: Number(Number(invoice.amount || 0).toFixed(2))
+        });
+        return true;
+    }
+
+    allInvoices[existingIndex] = mergeCollectorInvoice(allInvoices[existingIndex], invoice);
+    return true;
+}
+
 function rebuildPaidInvoiceIdsFromPayments() {
     paidInvoiceIds = new Set();
     paymentEntries.forEach((payment) => {
@@ -4585,6 +4790,10 @@ function rebuildInvoiceIndex() {
     });
 }
 
+function pruneSettledCollectorInvoices() {
+    allInvoices = allInvoices.filter((invoice) => getOutstandingInvoiceAmount(invoice) > 0.01);
+}
+
 function findInvoiceByKey(key) {
     if (key === null || key === undefined) return null;
     return invoiceIndexMap.get(String(key).trim()) || null;
@@ -4635,7 +4844,7 @@ function buildCollectorBillingRecordFromDoc(doc) {
     const billingPeriodMonthKey = getBillingPeriodMonthKey(billingMonth, billingYear, invoiceDate);
     const dateReceived = normalizeDate(getField(f, ['date_received']));
     const receivedBy = String(getField(f, ['receivedby']) || '').trim();
-    const amount = Number(getField(f, ['totalamount', 'amount']) || 0);
+    const amount = getBillingDocAmountFromFields(f);
     const contractmainId = String(getField(f, ['contractmain_id']) || '').trim();
     const location = getBillingLocationFromFields(f, contractmainId);
     const billingMeta = {
@@ -4857,10 +5066,7 @@ async function queryCollectionPaymentDocsByInvoice(invoiceKey) {
 
 async function ensureCollectorCellDetailData(cell) {
     if (!cell) return;
-    const invoiceKeys = Array.from(new Set((cell.records || [])
-        .flatMap((record) => [record.invoiceNo, record.invoiceId, record.invoiceKey, record.id])
-        .map((value) => String(value || '').trim())
-        .filter(Boolean)));
+    const invoiceKeys = collectCollectorRowInvoiceKeys(cell);
     if (!invoiceKeys.length) return;
 
     const billingDocs = (await Promise.all(invoiceKeys.map((key) => queryCollectionBillingDocsByInvoice(key)))).flat();
@@ -4872,14 +5078,7 @@ async function ensureCollectorCellDetailData(cell) {
         changedInvoices = ingestCollectorBillingRecord(detail.record) || changedInvoices;
 
         const invoice = processInvoice(doc);
-        if (invoice && !allInvoices.some((item) => (
-            item.invoiceKey === invoice.invoiceKey
-            || item.invoiceNo === invoice.invoiceNo
-            || item.invoiceId === invoice.invoiceId
-        ))) {
-            allInvoices.push(invoice);
-            changedInvoices = true;
-        }
+        changedInvoices = upsertCollectorInvoice(invoice, collectionBillingDocKey(doc)) || changedInvoices;
     });
 
     const paymentDocs = (await Promise.all(invoiceKeys.map((key) => queryCollectionPaymentDocsByInvoice(key)))).flat();
@@ -4921,10 +5120,7 @@ async function ensureCollectorInvoiceSearchSupplement() {
             changed = ingestCollectorBillingRecord(detail.record) || changed;
 
             const invoice = processInvoice(doc);
-            if (invoice && !allInvoices.some((item) => item.invoiceKey === invoice.invoiceKey || item.invoiceNo === invoice.invoiceNo)) {
-                allInvoices.push(invoice);
-                changed = true;
-            }
+            changed = upsertCollectorInvoice(invoice, collectionBillingDocKey(doc)) || changed;
         });
         collectorInvoiceSearchSupplementedTerms.add(normalizedTerm);
         if (changed) {
@@ -5000,6 +5196,7 @@ async function loadInvoices(mode) {
         billingMetaByInvoiceKey = new Map();
         collectorBillingRecords = [];
         collectorBillingRecordKeys = new Set();
+        collectorInvoiceSourceDocKeys = new Set();
         collectorInvoiceSearchSupplementedTerms.clear();
         const years = new Set();
 
@@ -5014,7 +5211,7 @@ async function loadInvoices(mode) {
             if (!invoice) return;
             if (!isAllMode && invoice.age > 180) return;
 
-            allInvoices.push(invoice);
+            upsertCollectorInvoice(invoice, collectionBillingDocKey(doc));
             if (invoice.year) years.add(String(invoice.year));
         });
 
@@ -5024,6 +5221,7 @@ async function loadInvoices(mode) {
             return b.amount - a.amount;
         });
 
+        pruneSettledCollectorInvoices();
         rebuildInvoiceIndex();
         populateYearFilter(years);
 
@@ -8419,16 +8617,38 @@ function resolveCollectorCellContext(cell) {
 }
 
 function sameBranch(invoice, context) {
+    if (matchesCollectorAccountIdentity(invoice, context)) return true;
     if (context.branchId && invoice.branchId && String(invoice.branchId) === String(context.branchId)) return true;
     return normalizeText(invoice.branch) === normalizeText(context.branchName)
         && normalizeText(invoice.company) === normalizeText(context.customer);
 }
 
 function sameCompany(invoice, context) {
+    if (matchesCollectorAccountIdentity(invoice, context)) return true;
     if (context.companyId && invoice.companyId && String(invoice.companyId) === String(context.companyId)) return true;
     return normalizeText(invoice.company) === normalizeText(context.customer);
 }
 
+function matchesCollectorAccountIdentity(invoice, context) {
+    const invoiceContractId = normalizeLookupId(invoice?.contractmainId);
+    const contextContractId = normalizeLookupId(context?.contractmainId);
+    if (invoiceContractId && contextContractId && invoiceContractId === contextContractId) return true;
+
+    const invoiceMachineId = normalizeLookupId(invoice?.machineId);
+    const contextMachineId = normalizeLookupId(context?.machineId);
+    if (invoiceMachineId && contextMachineId && invoiceMachineId === contextMachineId) return true;
+
+    const invoiceSerial = normalizeSerialNumber(invoice?.serialNumber);
+    const contextSerial = normalizeSerialNumber(context?.serialNumber);
+    if (invoiceSerial && contextSerial && invoiceSerial === contextSerial) return true;
+
+    const invoiceAccountLabel = normalizeText(invoice?.accountLabel);
+    const contextAccountLabel = normalizeText(context?.accountLabel);
+    if (invoiceAccountLabel && contextAccountLabel && invoiceAccountLabel === contextAccountLabel) return true;
+
+    return false;
+}
+
 function normalizeText(value) {
     return String(value || '')
         .toLowerCase()
@@ -8499,7 +8719,13 @@ function getSelectedInvoiceForCell(cell, context, branchInvoices) {
 function getOutstandingInvoiceAmount(invoice) {
     const baseAmount = Number(invoice?.amount || invoice?.billedAmount || 0);
     const payments = getPaymentsForSelectedInvoice(invoice);
-    if (!payments.length) return baseAmount;
+    if (!payments.length) {
+        const matrixBalance = Number(invoice?.latestBalanceAmount);
+        if (invoice?.fromMatrixSnapshot && Number.isFinite(matrixBalance) && matrixBalance > 0.01) {
+            return Math.min(matrixBalance, baseAmount);
+        }
+        return baseAmount;
+    }
 
     const latestWithBalance = payments
         .filter((payment) => payment.balanceAmount !== null && payment.balanceAmount !== undefined && Number.isFinite(Number(payment.balanceAmount)))
@@ -8867,14 +9093,19 @@ async function buildCollectorFollowupWorkspace(cell, options = {}) {
     const context = resolveCollectorCellContext(cell);
     const profile = getCollectionProfileForContext(context);
     const override = getCollectionOverrideForContext(context);
-    const branchInvoices = getRelatedUnpaidInvoices(context, 'branch');
-    const companyInvoices = getRelatedUnpaidInvoices(context, 'company');
+    const matrixRowInvoices = getCollectorMatrixRowUnpaidInvoices(cell);
+    let branchInvoices = getRelatedUnpaidInvoices(context, 'branch');
+    let companyInvoices = getRelatedUnpaidInvoices(context, 'company');
+    if (matrixRowInvoices.length) {
+        branchInvoices = matrixRowInvoices.filter((invoice) => sameBranch(invoice, context));
+        companyInvoices = matrixRowInvoices.filter((invoice) => sameCompany(invoice, context));
+    }
     const selectedInvoice = getSelectedInvoiceForCell(cell, context, branchInvoices);
     await loadCollectionHistoryForKeys([
         selectedInvoice?.invoiceNo,
         selectedInvoice?.invoiceId,
         selectedInvoice?.invoiceKey,
-        ...(cell.records || []).flatMap((record) => [record.invoiceNo, record.invoiceId, record.invoiceKey, record.id]),
+        ...collectCollectorRowInvoiceKeys(cell),
         ...collectionAccountHistoryKeys(context),
         ...collectionAccountHistoryKeys(cell)
     ]);
@@ -8969,8 +9200,8 @@ function renderCollectorWorkspaceInvoiceList(workspace, selectedInvoice) {
         return `
             <section class="collection-account-invoices-panel">
                 <div class="collection-account-invoices-head">
-                    <div class="collection-account-invoices-title">Invoices Linked To This Cell</div>
-                    <div class="collection-account-invoices-total">No linked unpaid invoices</div>
+                    <div class="collection-account-invoices-title">Unpaid Invoices In This List</div>
+                    <div class="collection-account-invoices-total">No unpaid invoices in this list</div>
                 </div>
                 <div class="collection-followup-empty">No unpaid invoice list is available for this account row yet.</div>
             </section>
@@ -8993,7 +9224,7 @@ function renderCollectorWorkspaceInvoiceList(workspace, selectedInvoice) {
     return `
         <section class="collection-account-invoices-panel">
             <div class="collection-account-invoices-head">
-                <div class="collection-account-invoices-title">Invoices Linked To This Cell</div>
+                <div class="collection-account-invoices-title">Unpaid Invoices In This List</div>
                 <div class="collection-account-invoices-total">${escapeHtml(sortedInvoices.length.toLocaleString())} row(s) • ${escapeHtml(formatCurrency(totalBalance))}</div>
             </div>
             <div class="collection-followup-table-wrap">
@@ -9059,9 +9290,8 @@ function openCollectorSoaPeriodModal() {
 
 function getCollectorSoaCandidateInvoices(workspace) {
     const context = workspace?.context || {};
-    const selectedCell = workspace?.cell || null;
     const candidates = [];
-    const append = (invoice, source = 'workspace', cell = null) => {
+    const append = (invoice, source = 'workspace', cell = workspace?.cell || null) => {
         if (!invoice) return;
         const cellAmount = cell ? getPriorityCellAmount(cell) : 0;
         candidates.push({
@@ -9076,29 +9306,26 @@ function getCollectorSoaCandidateInvoices(workspace) {
         });
     };
 
-    const selectedCellRecords = Array.isArray(selectedCell?.records) ? selectedCell.records : [];
-    if (selectedCellRecords.length) {
-        selectedCellRecords.forEach((record) => append(record, 'selected_cell', selectedCell));
-    } else if (selectedCell) {
-        append({
-            invoiceNo: selectedCell.pendingBilling ? 'Pending billing' : selectedCell.id,
-            invoiceId: selectedCell.id,
-            invoiceKey: selectedCell.id,
-            invoiceDate: normalizeDate(selectedCell.monthKey ? `${selectedCell.monthKey}-01` : ''),
-            amount: getPriorityCellAmount(selectedCell),
-            company: selectedCell.customer,
-            branch: selectedCell.branchName,
-            companyId: selectedCell.companyId,
-            branchId: selectedCell.branchId
-        }, 'selected_cell_projection', selectedCell);
+    if (canUseCollectorMatrixSnapshot()) {
+        getCollectorSoaListGroupCells(workspace).forEach((rowCell) => {
+            (rowCell.records || []).forEach((record) => {
+                const invoice = invoiceFromMatrixSnapshotRecord(record, rowCell);
+                if (getOutstandingInvoiceAmount(invoice) > 0.01) {
+                    append(invoice, 'matrix_row', rowCell);
+                }
+            });
+        });
     }
 
+    if (!candidates.length) {
+        (workspace?.companyInvoices || []).forEach((invoice) => append(invoice, 'company'));
+    }
     if (!candidates.length && workspace?.selectedInvoice) append(workspace.selectedInvoice, 'selected');
     if (!candidates.length) {
-        (workspace?.branchInvoices || []).forEach((invoice) => append(invoice, 'branch_fallback'));
+        (workspace?.branchInvoices || []).forEach((invoice) => append(invoice, 'branch'));
     }
     if (!candidates.length) {
-        (workspace?.cell?.records || []).forEach((record) => append(record, 'cell', workspace?.cell));
+        (workspace?.cell?.records || []).forEach((record) => append(invoiceFromMatrixSnapshotRecord(record, workspace?.cell), 'cell', workspace?.cell));
     }
 
     if (!candidates.length) {
@@ -9115,7 +9342,7 @@ function getCollectorSoaCandidateInvoices(workspace) {
             seen.add(key);
             return true;
         })
-        .filter((invoice) => Number(invoice.amount || invoice.billedAmount || 0) > 0);
+        .filter((invoice) => getOutstandingInvoiceAmount(invoice) > 0.01);
 }
 
 function getCollectorSoaListGroupCells(workspace) {
@@ -9175,7 +9402,7 @@ function getPaymentsForInvoiceKeys(invoice) {
     return paymentEntries.filter((entry) => (
         keys.has(String(entry.invoiceId || '').trim())
         || keys.has(String(entry.invoiceNo || '').trim())
-    ));
+    )).filter((entry) => isCollectorPaymentChronologicallyRelevant(entry, invoice));
 }
 
 function buildCollectorSoaRows(workspace, fromDate, toDate) {
@@ -9632,6 +9859,7 @@ function getPaymentsForSelectedInvoice(invoice) {
 
     return paymentEntries
         .filter((entry) => keys.has(String(entry.invoiceId || '').trim()) || keys.has(String(entry.invoiceNo || '').trim()))
+        .filter((entry) => isCollectorPaymentChronologicallyRelevant(entry, invoice))
         .sort((left, right) => {
             const leftTime = (left.paymentDate || new Date(0)).getTime();
             const rightTime = (right.paymentDate || new Date(0)).getTime();
@@ -9639,6 +9867,13 @@ function getPaymentsForSelectedInvoice(invoice) {
         });
 }
 
+function isCollectorPaymentChronologicallyRelevant(payment, invoice) {
+    const paymentDate = getCollectorPaymentTotalDate(payment);
+    const invoiceDate = normalizeDate(invoice?.invoiceDate || invoice?.dueDate);
+    if (!paymentDate || !invoiceDate) return true;
+    return paymentDate.getTime() >= invoiceDate.getTime();
+}
+
 function getPaymentDeductionAmount(payment) {
     const explicit = Number(payment?.deductionAmount || 0);
     if (explicit > 0) return explicit;
diff --git a/expenses/js/expenses.js b/expenses/js/expenses.js
index df91e94..e97f5e3 100644
--- a/expenses/js/expenses.js
+++ b/expenses/js/expenses.js
@@ -458,7 +458,9 @@ function fillReimbursementForm(request) {
 }
 
 function getReimbursementGroup(groupId) {
-    return FIELD_REIMBURSEMENT_ITEM_GROUPS.find((group) => group.id === groupId) || null;
+    return window.MargaExpenseRequestCatalog?.getGroupById?.(groupId)
+        || FIELD_REIMBURSEMENT_ITEM_GROUPS.find((group) => group.id === groupId)
+        || null;
 }
 
 function renderReimbursementItemEntry() {
diff --git a/inventory/index.html b/inventory/index.html
index 3d38a41..f09b24e 100644
--- a/inventory/index.html
+++ b/inventory/index.html
@@ -86,6 +86,13 @@
                     </svg>
                     <span>Petty Cash</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
             </div>
 
             <div class="nav-section">
diff --git a/pettycash/index.html b/pettycash/index.html
index 98f0b44..3a16d46 100644
--- a/pettycash/index.html
+++ b/pettycash/index.html
@@ -105,6 +105,13 @@
                     </svg>
                     <span>Inventory</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../settings/index.html" class="nav-item" data-module="settings">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <circle cx="12" cy="12" r="3"/>
diff --git a/receiving/index.html b/receiving/index.html
index e85d029..fbe676c 100644
--- a/receiving/index.html
+++ b/receiving/index.html
@@ -43,6 +43,7 @@
                 <a href="../inventory/" class="nav-item" data-module="inventory"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg><span>Inventory</span></a>
                 <a href="../billing/" class="nav-item" data-module="billing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg><span>Billing</span></a>
                 <a href="../collections.html" class="nav-item" data-module="collections"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg><span>Collections</span></a>
+                <a href="../expenses/" class="nav-item" data-module="expenses"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg><span>Money Requests</span></a>
                 <a href="../settings/index.html" class="nav-item" data-module="settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span>Settings</span></a>
             </div>
         </nav>
diff --git a/releasing/index.html b/releasing/index.html
index 45a30e9..aa47d06 100644
--- a/releasing/index.html
+++ b/releasing/index.html
@@ -113,6 +113,13 @@
                     </svg>
                     <span>Collections</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../settings/index.html" class="nav-item" data-module="settings">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <circle cx="12" cy="12" r="3"/>
diff --git a/schedule/index.html b/schedule/index.html
index b0494f0..b80f53d 100644
--- a/schedule/index.html
+++ b/schedule/index.html
@@ -85,6 +85,13 @@
                     </svg>
                     <span>Petty Cash</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../collections.html" class="nav-item" data-module="collections">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <rect x="1" y="4" width="22" height="16" rx="2"/>
diff --git a/service/index.html b/service/index.html
index 9d22948..2210f3e 100644
--- a/service/index.html
+++ b/service/index.html
@@ -91,6 +91,13 @@
                     </svg>
                     <span>Service</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
 
                 <a href="../marga-care/" class="nav-item" data-module="marga-care">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
diff --git a/settings/index.html b/settings/index.html
index 087b13e..da679ce 100644
--- a/settings/index.html
+++ b/settings/index.html
@@ -87,6 +87,13 @@
                     </svg>
                     <span>Petty Cash</span>
                 </a>
+                <a href="../expenses/" class="nav-item" data-module="expenses">
+                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
+                        <path d="M12 1v22"/>
+                        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
+                    </svg>
+                    <span>Money Requests</span>
+                </a>
                 <a href="../collections.html" class="nav-item" data-module="collections">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <rect x="1" y="4" width="22" height="16" rx="2"/>
diff --git a/shared/js/expense-request-catalog.js b/shared/js/expense-request-catalog.js
index 2e16b52..26ef27e 100644
--- a/shared/js/expense-request-catalog.js
+++ b/shared/js/expense-request-catalog.js
@@ -23,6 +23,16 @@ const MargaExpenseRequestCatalog = (() => {
         'petty_cash_fund'
     ]);
 
+    const GROUP_ALIASES = {
+        fuel: 'gasoline',
+        meal: 'meal_allowance',
+        toll: 'commute_fare',
+        fare: 'commute_fare',
+        delivery: 'commute_fare',
+        parts: 'field_parts',
+        emergency: 'other_materials'
+    };
+
     function clone(value) {
         return JSON.parse(JSON.stringify(value));
     }
@@ -36,7 +46,9 @@ const MargaExpenseRequestCatalog = (() => {
     }
 
     function getGroupById(groupId) {
-        return getGroups().find((group) => group.id === String(groupId || '').trim()) || null;
+        const normalized = String(groupId || '').trim();
+        const resolved = GROUP_ALIASES[normalized] || normalized;
+        return getGroups().find((group) => group.id === resolved) || null;
     }
 
     function getAccounts() {
