const crypto = require("crypto");

const GOOGLE_SCOPE_FIRESTORE = "https://www.googleapis.com/auth/datastore";
const FIREBASE_BASE_URL = "https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const tokenCache = new Map();

const PERMISSIONS = {
  admin: ["customers", "ai-product-consultant", "billing", "schedule", "master-schedule", "apd", "accounting", "collections", "service", "general-production", "releasing", "receiving", "inventory", "hr", "reports", "settings", "sync", "field", "purchasing", "pettycash", "sales"],
  "ai-consultant-admin": ["ai-product-consultant"],
  billing: ["customers", "billing", "schedule", "apd", "accounting", "pettycash", "reports"],
  collection: ["customers", "collections", "schedule", "master-schedule", "reports"],
  service: ["customers", "ai-product-consultant", "master-schedule", "service", "schedule", "general-production", "releasing", "receiving", "inventory", "field"],
  hr: ["hr", "settings"],
  technician: ["field"],
  messenger: ["field", "schedule"],
  viewer: ["customers", "reports"],
};

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function json(data, status = 200) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

function sanitizePrivateKey(key) {
  return String(key || "").replace(/\\n/g, "\n");
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(scopes = [GOOGLE_SCOPE_FIRESTORE]) {
  const serviceEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = sanitizePrivateKey(env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  if (!serviceEmail || !privateKey) return "";

  const scopeKey = [...new Set(scopes)].join(" ");
  const cached = tokenCache.get(scopeKey);
  const nowTs = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > nowTs + 60) return cached.accessToken;

  const signingInput = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(JSON.stringify({
    iss: serviceEmail,
    scope: scopeKey,
    aud: "https://oauth2.googleapis.com/token",
    exp: nowTs + 3600,
    iat: nowTs,
  }))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${signingInput}.${signature}`,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google token request failed.");
  }
  const accessToken = payload.access_token;
  tokenCache.set(scopeKey, {
    accessToken,
    expiresAt: nowTs + Math.max(300, Number(payload.expires_in || 3600) - 30),
  });
  return accessToken;
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseFirestoreValue);
  if (value.mapValue !== undefined) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, entry]) => {
      out[key] = parseFirestoreValue(entry);
    });
    return out;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  if (!doc?.fields) return null;
  const out = {};
  Object.entries(doc.fields).forEach(([key, value]) => {
    out[key] = parseFirestoreValue(value);
  });
  if (doc.name) out._docId = doc.name.split("/").pop();
  return out;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "viewer";
}

function normalizeRoles(roles) {
  if (Array.isArray(roles)) return [...new Set(roles.map(normalizeRole).filter(Boolean))];
  if (typeof roles === "string" && roles.trim()) return [...new Set(roles.split(",").map(normalizeRole).filter(Boolean))];
  return [];
}

function inferRole(user) {
  const positionName = String(user?.position || user?.position_name || user?.position_label || "").toLowerCase();
  const positionId = Number(user?.position_id || 0);
  if (positionId === 5 || positionName.includes("technician") || positionName.includes("tech")) return "technician";
  if (positionId === 9 || positionName.includes("messenger") || positionName.includes("driver")) return "messenger";
  if (positionName.includes("collection")) return "collection";
  if (positionName.includes("billing") || positionName.includes("account") || positionName.includes("finance") || positionName.includes("cashier")) return "billing";
  if (positionName.includes("service") || positionName.includes("csr") || positionName.includes("sales")) return "service";
  if (positionName.includes("hr")) return "hr";
  if (positionName.includes("admin") || positionName.includes("manager")) return "admin";
  return "viewer";
}

function normalizeModules(modules) {
  if (!modules) return [];
  const raw = Array.isArray(modules) ? modules : String(modules).split(",");
  return [...new Set(raw.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
}

function roleModules(roles) {
  return [...new Set(normalizeRoles(roles).flatMap((role) => normalizeModules(PERMISSIONS[role] || [])))];
}

function isEmployeeActive(user) {
  if (!user || typeof user !== "object") return false;
  if (user.marga_active === false || user.marga_account_active === false || user.active === false) return false;
  if (user.marga_active === true || user.marga_account_active === true || user.active === true) return true;
  const estatus = Number(user.estatus);
  if (Number.isFinite(estatus)) return estatus === 1;
  return true;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "").replace(/^[._-]+|[._-]+$/g, "").slice(0, 48);
}

async function queryEmployee(fieldPath, value) {
  const lookupValue = String(value || "").trim();
  if (!lookupValue) return null;
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "tbl_employee" }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op: "EQUAL",
          value: { stringValue: lookupValue },
        },
      },
      limit: 10,
    },
  };
  const response = await fetch(`${env("FIREBASE_BASE_URL") || env("FIRESTORE_BASE_URL") || FIREBASE_BASE_URL}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Firestore login lookup failed (${response.status}).`);
  }
  const users = Array.isArray(payload)
    ? payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean)
    : [];
  return users.find(isEmployeeActive) || users[0] || null;
}

async function findEmployee(ident) {
  const rawIdent = String(ident || "").trim();
  const normalizedIdent = rawIdent.toLowerCase();
  const looksLikeEmail = normalizedIdent.includes("@");
  const username = normalizeUsername(rawIdent);
  const emailLocalPart = looksLikeEmail ? normalizeUsername(normalizedIdent.split("@")[0]) : "";
  const lookups = looksLikeEmail
    ? [["email", normalizedIdent], ["marga_login_email", normalizedIdent], ["username", emailLocalPart]]
    : [["username", username], ["marga_username", username], ["email", normalizedIdent], ["marga_login_email", normalizedIdent]];
  const seen = new Set();
  for (const [fieldPath, value] of lookups) {
    const key = `${fieldPath}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const employee = await queryEmployee(fieldPath, value);
    if (employee) return employee;
  }
  return null;
}

function verifyPassword(user, password) {
  const provided = String(password || "");
  if (user.password && !user.password_hash) return String(user.password) === provided;
  const hashB64 = String(user.password_hash || "").trim();
  const saltB64 = String(user.password_salt || "").trim();
  const iterations = Number(user.password_iterations || 120000);
  if (!hashB64 || !saltB64 || !Number.isFinite(iterations) || iterations < 20000) return false;
  const derived = crypto.pbkdf2Sync(provided, Buffer.from(saltB64, "base64"), iterations, 32, "sha256");
  return derived.toString("base64") === hashB64;
}

function buildSession(user, ident) {
  const roles = normalizeRoles(user.marga_roles || user.roles || user.marga_role || user.role || inferRole(user));
  const resolvedRoles = roles.length ? roles : ["viewer"];
  const role = resolvedRoles[0] || "viewer";
  const userModulesConfigured = user.allowed_modules_configured === true;
  const allowedModules = userModulesConfigured ? normalizeModules(user.marga_allowed_modules || user.allowed_modules) : [];
  const sessionName = String(
    user.marga_fullname
      || user.name
      || `${String(user.firstname || "").trim()} ${String(user.lastname || "").trim()}`.trim()
      || user.nickname
      || user.username
      || user.email
      || ident
  ).trim();
  const sessionEmail = String(user.email || user.marga_login_email || "").trim().toLowerCase();
  return {
    id: user._docId,
    username: user.username || sessionEmail || ident,
    name: sessionName,
    role,
    roles: resolvedRoles,
    email: sessionEmail,
    staff_id: user.id || user.staff_id || user.staffId || null,
    allowed_modules: allowedModules,
    role_modules: resolvedRoles.includes("admin") ? normalizeModules(PERMISSIONS.admin) : roleModules(resolvedRoles),
    allowed_modules_configured: userModulesConfigured,
  };
}

exports.handler = async function login(event) {
  if (event.httpMethod !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  try {
    if (!env("GOOGLE_SERVICE_ACCOUNT_EMAIL") || !env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")) {
      return json({ success: false, unavailable: true, message: "Server login is not configured." }, 503);
    }
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (error) {
      body = {};
    }
    const ident = String(body.username || body.email || "").trim();
    const password = String(body.password || "");
    if (!ident || !password) return json({ success: false, message: "Email and password are required." }, 400);
    const employee = await findEmployee(ident);
    if (!employee || !isEmployeeActive(employee) || !verifyPassword(employee, password)) {
      return json({ success: false, message: "Invalid email or password" }, 401);
    }
    return json({ success: true, user: buildSession(employee, ident) });
  } catch (error) {
    console.error("Server login failed:", error);
    return json({ success: false, unavailable: true, message: "Login service is temporarily busy. Please wait a minute and sign in again." }, 503);
  }
};
