const SCHEDULE_SAFE_REVERSE_FIELDS = [
  "tech_id",
  "serial",
  "isongoing",
  "date_finished",
  "closedby",
  "phone_number",
  "meter_reading",
  "tl_status",
  "tl_remarks",
  "customer_request",
  "collocutor",
  "dev_remarks",
];

export const OFFICE_SYNC_MANIFEST_VERSION = "2026-04-22";

export const OFFICE_SYNC_MANIFEST = {
  version: OFFICE_SYNC_MANIFEST_VERSION,
  reverseBridge: {
    trackedTables: [
      "tbl_collectionhistory",
      "tbl_paymentinfo",
      "tbl_schedule",
      "tbl_schedtime",
      "tbl_closedscheds",
    ],
    scheduleSafeFields: SCHEDULE_SAFE_REVERSE_FIELDS,
  },
  tables: [
    {
      table: "tbl_schedule",
      domain: "service",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 60 },
      firebaseToMysql: { enabled: true, mode: "safe_fields", safeFields: SCHEDULE_SAFE_REVERSE_FIELDS },
    },
    {
      table: "tbl_printedscheds",
      domain: "service",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        bootstrap: true,
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 72,
        refreshLinkedTables: ["tbl_schedule"],
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_savedscheds",
      domain: "service",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        bootstrap: true,
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 72,
        refreshLinkedTables: ["tbl_schedule"],
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_schedtime",
      domain: "service",
      sourceOfTruth: "hybrid",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 72,
      },
      firebaseToMysql: { enabled: true, mode: "append_or_update" },
    },
    {
      table: "tbl_closedscheds",
      domain: "service",
      sourceOfTruth: "hybrid",
      mysqlToFirebase: { enabled: true, mode: "append_only" },
      firebaseToMysql: { enabled: true, mode: "append_only" },
    },
    {
      table: "tbl_collectionhistory",
      domain: "collections",
      sourceOfTruth: "hybrid",
      mysqlToFirebase: {
        enabled: true,
        mode: "append_only",
        fullResyncIntervalMinutes: 120,
      },
      firebaseToMysql: { enabled: true, mode: "append_only" },
    },
    {
      table: "tbl_trouble",
      domain: "lookups",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "reference_refresh" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_mstatus",
      domain: "lookups",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "reference_refresh" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_purpose",
      domain: "lookups",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "reference_refresh" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_companylist",
      domain: "customers",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "reference_refresh", fullResyncIntervalMinutes: 60 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_branchinfo",
      domain: "customers",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 60 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_branchcontact",
      domain: "customers",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 60 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_customerinfo",
      domain: "customers",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 60 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_customertype",
      domain: "customers",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "reference_refresh", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_machine",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "tmestamp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_model",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "reference_refresh", fullResyncIntervalMinutes: 360 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_brand",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "reference_refresh", fullResyncIntervalMinutes: 360 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_machineorder",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_machinepickupreceipt",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_machinereading",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 72,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_contractmain",
      domain: "contracts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "update_date",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_contractdep",
      domain: "contracts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_contractdetails",
      domain: "contracts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_contractinfo",
      domain: "contracts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_contracthistory",
      domain: "contracts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "tmestamp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_newmachinehistory",
      domain: "machines",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_billinfo",
      domain: "billing",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_billing",
      domain: "billing",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_invoicenum",
      domain: "billing",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_cancelledinvoices",
      domain: "billing",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_collectioninfo",
      domain: "collections",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_collections",
      domain: "collections",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_paymentinfo",
      domain: "payments",
      sourceOfTruth: "hybrid",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestamp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 60,
      },
      firebaseToMysql: { enabled: true, mode: "schedule_payment_test_bridge" },
    },
    {
      table: "tbl_payments",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestamp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 120,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_paymentcheck",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "date_added",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 120,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_checkpayments",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_depositslip",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timest",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_depositsliptransaction",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "date_created",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_ornumber",
      domain: "payments",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 120 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_dispatchment",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_deliveryinfo",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "mutable_no_timestamp", fullResyncIntervalMinutes: 180 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_dispatcheditems",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestamp",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_drmain",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_dr",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "date_requested",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_drhistory",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_finaldr",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "tmstmp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_finaldrdetails",
      domain: "delivery",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_pettycash",
      domain: "petty_cash",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_pcmain",
      domain: "petty_cash",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_pcdetails",
      domain: "petty_cash",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_newpettycash",
      domain: "petty_cash",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "timestmp",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_tonerink",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_refillitems",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_itemprepared",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_itemreceived",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: false,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "date_received",
        mutableLookbackHours: 168,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_releaseditems",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "mutable_no_timestamp" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_newtonerinkhistory",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_cartridgeprocorder",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_cartridgepartshistory",
      domain: "production",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: false, mode: "append_only" },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_inventoryparts",
      domain: "inventory_parts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: {
        enabled: true,
        mode: "mutable_with_timestamp",
        mutableDateColumn: "stamp",
        mutableLookbackHours: 168,
        fullResyncIntervalMinutes: 180,
      },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
    {
      table: "tbl_partstype",
      domain: "inventory_parts",
      sourceOfTruth: "mysql",
      mysqlToFirebase: { enabled: true, mode: "reference_refresh", fullResyncIntervalMinutes: 360 },
      firebaseToMysql: { enabled: false, mode: "none" },
    },
  ],
};

export function normalizeManifestTableName(tableName) {
  return String(tableName || "").trim().toLowerCase();
}

export function getManifestEntry(tableName) {
  const normalized = normalizeManifestTableName(tableName);
  return OFFICE_SYNC_MANIFEST.tables.find((entry) => entry.table === normalized) || null;
}

export function getMysqlToFirebaseEntries({ enabledOnly = true } = {}) {
  return OFFICE_SYNC_MANIFEST.tables.filter((entry) => {
    const enabled = Boolean(entry.mysqlToFirebase?.enabled);
    return enabledOnly ? enabled : entry.mysqlToFirebase;
  });
}

export function getFirebaseToMysqlEntries({ enabledOnly = true } = {}) {
  return OFFICE_SYNC_MANIFEST.tables.filter((entry) => {
    const enabled = Boolean(entry.firebaseToMysql?.enabled);
    return enabledOnly ? enabled : entry.firebaseToMysql;
  });
}

export function getMysqlToFirebaseDefaultConfig() {
  const entries = getMysqlToFirebaseEntries({ enabledOnly: true });
  const bootstrapEntries = entries.filter((entry) => Boolean(entry.mysqlToFirebase?.bootstrap));
  const mutableEntries = entries.filter((entry) => Boolean(entry.mysqlToFirebase?.mutableDateColumn));

  return {
    tables: entries.map((entry) => entry.table),
    bootstrapTables: bootstrapEntries.map((entry) => entry.table),
    mutableTables: mutableEntries.map((entry) => entry.table),
    mutableLookbackHours: mutableEntries.reduce((maxHours, entry) => (
      Math.max(maxHours, Number(entry.mysqlToFirebase?.mutableLookbackHours || 0) || 0)
    ), 0) || 72,
  };
}

export function getReverseBridgeConfig() {
  return {
    trackedTables: [...OFFICE_SYNC_MANIFEST.reverseBridge.trackedTables],
    scheduleSafeFields: [...OFFICE_SYNC_MANIFEST.reverseBridge.scheduleSafeFields],
  };
}
