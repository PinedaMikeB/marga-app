const crypto = require("crypto");

const GOOGLE_SCOPE_FIRESTORE = "https://www.googleapis.com/auth/datastore";
const FIREBASE_BASE_URL = "https://firestore.googleapis.com/v1/projects/sah-spiritual-journal/databases/(default)/documents";
const tokenCache = new Map();

const PERMISSIONS = {
  admin: ["customers", "ai-product-consultant", "billing", "schedule", "master-schedule", "apd", "accounting", "collections", "service", "marga-care", "general-production", "releasing", "receiving", "inventory", "hr", "reports", "settings", "sync", "field", "purchasing", "pettycash", "sales"],
  "ai-consultant-admin": ["ai-product-consultant"],
  billing: ["customers", "billing", "schedule", "apd", "accounting", "pettycash", "reports"],
  cashier: ["customers", "billing", "collections", "schedule", "apd", "accounting", "pettycash", "reports"],
  collection: ["customers", "collections", "schedule", "master-schedule", "reports"],
  service: ["customers", "ai-product-consultant", "master-schedule", "service", "schedule", "general-production", "releasing", "receiving", "inventory", "purchasing", "field"],
  "purchasing-staff": ["purchasing"],
  "account-payables": ["apd", "accounting", "pettycash"],
  "inventory-controller": ["inventory", "receiving"],
  hr: ["hr", "settings"],
  technician: ["field"],
  messenger: ["field", "schedule"],
  viewer: ["customers", "reports"],
};

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function requestHost(event) {
  return String(
    event?.headers?.["x-forwarded-host"]
    || event?.headers?.["X-Forwarded-Host"]
    || event?.headers?.host
    || event?.headers?.Host
    || ""
  ).trim().toLowerCase();
}

function isLegacyNetlifyHost(event) {
  const host = requestHost(event);
  return host.endsWith(".netlify.app");
}

function firestoreBaseUrl() {
  return env("FIREBASE_BASE_URL") || env("FIRESTORE_BASE_URL") || FIREBASE_BASE_URL;
}

function usesGoogleFirestore() {
  return firestoreBaseUrl().includes("firestore.googleapis.com");
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
  const aliases = {
    collection: "collections",
    "collection-module": "collections",
    "collections-module": "collections",
    "petty-cash": "pettycash",
    "pettycash-module": "pettycash",
    "accounting-module": "accounting",
    "inventory-module": "inventory",
    "logistics-inventory": "inventory",
    "production-machine-module": "general-production",
    "production-toner-module": "general-production",
    "payroll-module": "hr",
    "billing-module": "billing",
    "service-module": "service",
    "field-app": "field",
    "purchasing-module": "purchasing",
  };
  const normalizeModule = (module) => String(module || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const resolveModule = (module) => aliases[module] || module;
  if (Array.isArray(modules)) {
    return [...new Set(modules.map((item) => resolveModule(normalizeModule(item))).filter(Boolean))];
  }
  if (typeof modules === "string" && modules.trim()) {
    return [...new Set(modules.split(",").map((item) => resolveModule(normalizeModule(item))).filter(Boolean))];
  }
  return [];
}

function roleModulesFromDefaults(roles) {
  return [...new Set(normalizeRoles(roles).flatMap((role) => normalizeModules(PERMISSIONS[role] || [])))];
}

async function fetchRolePermissionDoc(role) {
  const normalizedRole = normalizeRole(role);
  const key = env("FIREBASE_API_KEY") || env("FIRESTORE_API_KEY") || "margabase-local";
  const token = usesGoogleFirestore() ? await getGoogleAccessToken() : "";
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `${firestoreBaseUrl()}/marga_role_permissions/${encodeURIComponent(normalizedRole)}?key=${encodeURIComponent(key)}`,
    { headers }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) return null;
  return parseFirestoreDoc(payload);
}

async function resolveRoleModules(roles) {
  const normalizedRoles = normalizeRoles(roles);
  if (!normalizedRoles.length) return roleModulesFromDefaults(["viewer"]);
  if (normalizedRoles.includes("admin")) return normalizeModules(PERMISSIONS.admin);
  const resolved = [];
  for (const role of normalizedRoles) {
    const codeDefaults = normalizeModules(PERMISSIONS[role] || []);
    const doc = await fetchRolePermissionDoc(role);
    if (doc && doc.active !== false) {
      resolved.push(...normalizeModules(doc.allowed_modules), ...codeDefaults);
    } else {
      resolved.push(...codeDefaults);
    }
  }
  return [...new Set(resolved)];
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

function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function queryEmployee(fieldPath, value) {
  const lookupValue = String(value || "").trim();
  if (!lookupValue) return null;
  const token = usesGoogleFirestore() ? await getGoogleAccessToken() : "";
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
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const key = env("FIREBASE_API_KEY") || env("FIRESTORE_API_KEY") || "margabase-local";
  const response = await fetch(`${firestoreBaseUrl()}:runQuery?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers,
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

function dedupeEmployees(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = String(row?._docId || row?.id || row?.staff_id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function queryEmployees(fieldPath, value, limit = 25) {
  const lookupValue = String(value || "").trim();
  if (!lookupValue) return [];
  const token = usesGoogleFirestore() ? await getGoogleAccessToken() : "";
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
      limit,
    },
  };
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const key = env("FIREBASE_API_KEY") || env("FIRESTORE_API_KEY") || "margabase-local";
  const response = await fetch(`${firestoreBaseUrl()}:runQuery?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Firestore employee lookup failed (${response.status}).`);
  }
  return Array.isArray(payload)
    ? payload.map((row) => row.document).filter(Boolean).map(parseFirestoreDoc).filter(Boolean)
    : [];
}

async function findEmployee(ident) {
  const rawIdent = String(ident || "").trim();
  const normalizedIdent = rawIdent.toLowerCase();
  const normalizedNameIdent = normalizeNameKey(rawIdent);
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

  const nicknameMatches = await queryEmployees("nickname", rawIdent, 20).catch(() => []);
  const exactNickname = nicknameMatches.find((employee) => normalizeNameKey(employee?.nickname) === normalizedNameIdent && isEmployeeActive(employee));
  if (exactNickname) return exactNickname;

  const fullNameCandidates = [];
  const pushCandidates = (rows) => {
    rows.forEach((row) => {
      const key = String(row?._docId || row?.id || "").trim();
      if (!key) return;
      if (!fullNameCandidates.some((item) => String(item?._docId || item?.id || "").trim() === key)) {
        fullNameCandidates.push(row);
      }
    });
  };
  if (rawIdent.includes(" ")) {
    const parts = rawIdent.split(/\s+/).filter(Boolean);
    if (parts[0]) pushCandidates(await queryEmployees("firstname", parts[0], 20).catch(() => []));
    if (parts.length > 1) pushCandidates(await queryEmployees("lastname", parts[parts.length - 1], 20).catch(() => []));
  } else if (normalizedNameIdent) {
    const firstNameMatches = await queryEmployees("firstname", rawIdent, 20).catch(() => []);
    pushCandidates(firstNameMatches);
    const lastNameMatches = await queryEmployees("lastname", rawIdent, 20).catch(() => []);
    pushCandidates(lastNameMatches);
    if (!fullNameCandidates.length && normalizedNameIdent.length >= 8) {
      const firstBlock = rawIdent.slice(0, Math.min(7, rawIdent.length));
      pushCandidates(await queryEmployees("firstname", firstBlock.charAt(0).toUpperCase() + firstBlock.slice(1).toLowerCase(), 20).catch(() => []));
    }
  }

  const exactFullName = fullNameCandidates.find((employee) => {
    const candidateKeys = [
      employee?.marga_fullname,
      employee?.name,
      `${String(employee?.firstname || "").trim()} ${String(employee?.lastname || "").trim()}`.trim(),
      `${String(employee?.firstname || "").trim()}${String(employee?.lastname || "").trim()}`.trim()
    ].map(normalizeNameKey).filter(Boolean);
    return candidateKeys.includes(normalizedNameIdent) && isEmployeeActive(employee);
  });
  if (exactFullName) return exactFullName;

  return null;
}

async function findEmployeeCandidates(ident) {
  const rawIdent = String(ident || "").trim();
  const normalizedIdent = rawIdent.toLowerCase();
  const normalizedNameIdent = normalizeNameKey(rawIdent);
  const looksLikeEmail = normalizedIdent.includes("@");
  const username = normalizeUsername(rawIdent);
  const emailLocalPart = looksLikeEmail ? normalizeUsername(normalizedIdent.split("@")[0]) : "";
  const lookups = looksLikeEmail
    ? [["email", normalizedIdent], ["marga_login_email", normalizedIdent], ["username", emailLocalPart], ["username", username]]
    : [["username", username], ["marga_username", username], ["email", normalizedIdent], ["marga_login_email", normalizedIdent]];
  const directCandidates = [];
  const seenLookups = new Set();
  for (const [fieldPath, value] of lookups) {
    const key = `${fieldPath}:${value}`;
    if (seenLookups.has(key)) continue;
    seenLookups.add(key);
    directCandidates.push(...await queryEmployees(fieldPath, value, 10).catch(() => []));
  }

  const nameCandidates = [];
  const pushNameCandidates = (rows) => {
    rows.forEach((row) => {
      const keys = [
        row?.nickname,
        row?.marga_fullname,
        row?.name,
        `${String(row?.firstname || "").trim()} ${String(row?.lastname || "").trim()}`.trim(),
        `${String(row?.firstname || "").trim()}${String(row?.lastname || "").trim()}`.trim(),
      ].map(normalizeNameKey).filter(Boolean);
      if (keys.includes(normalizedNameIdent)) nameCandidates.push(row);
    });
  };
  if (rawIdent.includes(" ")) {
    const parts = rawIdent.split(/\s+/).filter(Boolean);
    if (parts[0]) pushNameCandidates(await queryEmployees("firstname", parts[0], 20).catch(() => []));
    if (parts.length > 1) pushNameCandidates(await queryEmployees("lastname", parts[parts.length - 1], 20).catch(() => []));
  } else if (!looksLikeEmail && normalizedNameIdent) {
    pushNameCandidates(await queryEmployees("nickname", rawIdent, 20).catch(() => []));
    pushNameCandidates(await queryEmployees("firstname", rawIdent, 20).catch(() => []));
    pushNameCandidates(await queryEmployees("lastname", rawIdent, 20).catch(() => []));
  }

  const candidates = dedupeEmployees([...directCandidates, ...nameCandidates]);
  const active = candidates.filter(isEmployeeActive);
  return active.length ? active : candidates;
}

function verifyPassword(user, password) {
  const provided = String(password || "");
  if (user.password && String(user.password) === provided) return true;
  const hashB64 = String(user.password_hash || "").trim();
  const saltB64 = String(user.password_salt || "").trim();
  const iterations = Number(user.password_iterations || 120000);
  if (!hashB64 || !saltB64 || !Number.isFinite(iterations) || iterations < 20000) return false;
  const derived = crypto.pbkdf2Sync(provided, Buffer.from(saltB64, "base64"), iterations, 32, "sha256");
  return derived.toString("base64") === hashB64;
}

async function buildSession(user, ident) {
  const roles = normalizeRoles(user.marga_roles || user.roles || user.marga_role || user.role || inferRole(user));
  const resolvedRoles = roles.length ? roles : ["viewer"];
  const role = resolvedRoles[0] || "viewer";
  const userModulesConfigured = user.allowed_modules_configured === true;
  const allowedModules = userModulesConfigured ? normalizeModules(user.marga_allowed_modules || user.allowed_modules) : [];
  const savedRoleModules = userModulesConfigured
    ? allowedModules
    : [...new Set([
      ...(await resolveRoleModules(resolvedRoles)),
      ...normalizeModules(user.marga_allowed_modules || user.allowed_modules || []),
    ])];
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
    role_modules: savedRoleModules,
    allowed_modules_configured: userModulesConfigured,
  };
}

exports.handler = async function login(event) {
  if (event.httpMethod !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  try {
    if (isLegacyNetlifyHost(event)) {
      return json({
        success: false,
        blocked: true,
        message: "This MARGA login address is retired. Please open https://app.marga.biz"
      }, 403);
    }
    if (usesGoogleFirestore() && (!env("GOOGLE_SERVICE_ACCOUNT_EMAIL") || !env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"))) {
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
    const candidates = await findEmployeeCandidates(ident);
    const employee = candidates.find((candidate) => isEmployeeActive(candidate) && verifyPassword(candidate, password));
    if (!employee || !isEmployeeActive(employee) || !verifyPassword(employee, password)) {
      return json({ success: false, message: "Invalid email or password" }, 401);
    }
    return json({ success: true, user: await buildSession(employee, ident) });
  } catch (error) {
    console.error("Server login failed:", error);
    const details = String(error?.message || error || "").toLowerCase();
    const reason = details.includes("quota")
      ? "firestore-quota"
      : details.includes("token") || details.includes("credential") || details.includes("private")
        ? "google-credentials"
        : "server-login-error";
    return json({
      success: false,
      unavailable: true,
      reason,
      message: "Login service is temporarily busy. Please wait a minute and sign in again."
    }, 503);
  }
};
