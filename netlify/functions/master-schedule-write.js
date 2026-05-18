const crypto = require("crypto");

const GOOGLE_SCOPE_FIRESTORE = "https://www.googleapis.com/auth/datastore";
const FIREBASE_BASE_URL = "https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const tokenCache = new Map();

const ROUTE_PATCH_FIELDS = [
  "tech_id",
  "task_datetime",
  "status",
  "iscancelled",
  "date_finished",
  "remarks",
  "forwarded_to_date",
  "superseded_by_route_id",
  "forwarded_from_date",
  "forwarded_from_schedule_id",
  "forwarded_by",
  "forwarded_at",
  "timestmp",
  "bridge_pushed_at"
];

const ALLOWED_PATCH_FIELDS = {
  tbl_schedule: new Set([
    "tech_id",
    "task_datetime",
    "date_finished",
    "closedby",
    "master_schedule_status",
    "master_schedule_status_label",
    "master_schedule_status_updated_at",
    "master_schedule_status_updated_by",
    "priority",
    "master_priority_order",
    "master_priority_updated_at",
    "master_priority_updated_by",
    "dispatch_consolidated_at",
    "dispatch_consolidated_by_module",
    "dispatch_consolidated_reason",
    "original_sched"
  ]),
  marga_master_schedule: new Set([
    "assigned_to_id",
    "assigned_to",
    "updated_at",
    "priority",
    "master_priority_order",
    "master_priority_updated_at",
    "master_priority_updated_by",
    "master_schedule_status",
    "master_schedule_status_label",
    "master_schedule_status_updated_at",
    "master_schedule_status_updated_by"
  ]),
  tbl_schedule_planner: new Set([
    "assigned_staff_id",
    "assigned_staff_name",
    "updated_at",
    "priority",
    "master_priority_order",
    "master_priority_updated_at",
    "master_priority_updated_by",
    "master_schedule_status",
    "master_schedule_status_label",
    "master_schedule_status_updated_at",
    "master_schedule_status_updated_by"
  ]),
  tbl_schedule_close_requests: new Set([
    "status",
    "approved_at",
    "approved_by",
    "updated_at"
  ]),
  tbl_printedscheds: new Set(ROUTE_PATCH_FIELDS),
  tbl_savedscheds: new Set(ROUTE_PATCH_FIELDS),
  tbl_scheduledate: new Set(ROUTE_PATCH_FIELDS),
  tbl_schedtime: new Set(ROUTE_PATCH_FIELDS)
};

const CONFIG_COLLECTION_FIELDS = {
  marga_master_schedule_area_cities: new Set([
    "area",
    "city",
    "updated_at"
  ]),
  marga_master_schedule_tech_areas: new Set([
    "tech_id",
    "tech_name",
    "area",
    "updated_at"
  ]),
  marga_master_schedule_client_areas: new Set([
    "branch_id",
    "company_id",
    "company_name",
    "branch_name",
    "service_address",
    "service_contact_person",
    "service_contact_number",
    "service_area",
    "service_city",
    "billing_address",
    "billing_contact_person",
    "billing_contact_number",
    "billing_area",
    "billing_city",
    "collection_address",
    "collection_contact_person",
    "collection_contact_number",
    "collection_area",
    "collection_city",
    "delivery_address",
    "delivery_contact_person",
    "delivery_contact_number",
    "delivery_area",
    "delivery_city",
    "updated_at"
  ])
};

const ALLOWED_DELETE_COLLECTIONS = new Set(Object.keys(CONFIG_COLLECTION_FIELDS));

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function firestoreBaseUrl() {
  return env("FIREBASE_BASE_URL") || env("FIRESTORE_BASE_URL") || FIREBASE_BASE_URL;
}

function usesGoogleFirestore() {
  return firestoreBaseUrl().includes("firestore.googleapis.com");
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body)
  };
}

function sanitizePrivateKey(key) {
  return String(key || "").replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken() {
  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = sanitizePrivateKey(env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  if (!serviceEmail || !privateKey) throw new Error("Missing Google service account environment variables.");

  const cached = tokenCache.get(GOOGLE_SCOPE_FIRESTORE);
  const nowTs = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > nowTs + 60) return cached.accessToken;

  const signingInput = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(JSON.stringify({
    iss: serviceEmail,
    scope: GOOGLE_SCOPE_FIRESTORE,
    aud: "https://oauth2.googleapis.com/token",
    exp: nowTs + 3600,
    iat: nowTs
  }))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${signingInput}.${signature}`
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google token request failed.");
  }
  tokenCache.set(GOOGLE_SCOPE_FIRESTORE, {
    accessToken: payload.access_token,
    expiresAt: nowTs + Math.max(300, Number(payload.expires_in || 3600) - 30)
  });
  return payload.access_token;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, entry]) => {
      fields[key] = firestoreValue(entry);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function cleanIdentifier(value) {
  return String(value || "").trim();
}

function requestHost(event) {
  return String(event.headers?.host || event.headers?.Host || "").toLowerCase();
}

function isLegacyNetlifyHost(event) {
  return requestHost(event).includes("margaapp.netlify.app");
}

function validatePatch(collection, fields) {
  const allowed = ALLOWED_PATCH_FIELDS[collection] || CONFIG_COLLECTION_FIELDS[collection];
  if (!allowed) throw new Error(`Collection ${collection} is not allowed for master schedule writes.`);
  const entries = Object.entries(fields || {}).filter(([key]) => allowed.has(key));
  if (!entries.length) throw new Error("No allowed fields to update.");
  const blocked = Object.keys(fields || {}).filter((key) => !allowed.has(key));
  if (blocked.length) throw new Error(`Blocked field(s): ${blocked.join(", ")}`);
  return entries;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (isLegacyNetlifyHost(event)) {
    return json(410, {
      ok: false,
      error: "margaapp.netlify.app is retired. Open https://app.marga.biz to avoid writing bad Firebase records."
    });
  }
  if (!["PATCH", "DELETE"].includes(event.httpMethod)) return json(405, { ok: false, error: "Method not allowed" });

  try {
    const body = JSON.parse(event.body || "{}");
    const collection = cleanIdentifier(body.collection);
    const docId = cleanIdentifier(body.docId);
    if (!collection || !docId) return json(400, { ok: false, error: "Missing collection or docId." });

    const accessToken = usesGoogleFirestore() ? await getGoogleAccessToken() : "";
    const baseUrl = firestoreBaseUrl();
    const key = env("FIREBASE_API_KEY") || env("FIRESTORE_API_KEY") || "margabase-local";

    if (event.httpMethod === "DELETE") {
      if (!ALLOWED_DELETE_COLLECTIONS.has(collection)) {
        return json(403, { ok: false, error: `Collection ${collection} is not allowed for master schedule deletes.` });
      }
      const response = await fetch(`${baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        return json(response.status || 500, { ok: false, error: payload?.error?.message || "Firestore delete failed." });
      }
      return json(200, { ok: true });
    }

    const entries = validatePatch(collection, body.fields || {});
    const params = new URLSearchParams();
    entries.forEach(([key]) => params.append("updateMask.fieldPaths", key));

    const fields = {};
    entries.forEach(([key, value]) => {
      fields[key] = firestoreValue(value);
    });

    params.set("key", key);
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${baseUrl}/${collection}/${encodeURIComponent(docId)}?${params.toString()}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      return json(response.status || 500, { ok: false, error: payload?.error?.message || "Firestore update failed." });
    }
    return json(200, { ok: true, doc: payload });
  } catch (error) {
    return json(500, { ok: false, error: error.message || String(error) });
  }
};
