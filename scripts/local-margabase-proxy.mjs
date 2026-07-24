#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 9100);
const HOST = process.env.HOST || '127.0.0.1';
const API_ORIGIN = process.env.MARGABASE_API_ORIGIN || 'http://127.0.0.1:8787';
const MARGABASE_FIRESTORE_BASE_URL = `${API_ORIGIN}/v1/projects/sah-spiritual-journal/databases/(default)/documents`;
const require = createRequire(import.meta.url);
const platformRequire = createRequire('/Volumes/Wotg Drive Mike/GitHub/marga-platform/package.json');
const { Pool } = platformRequire('pg');
const ALLOWED_ORIGINS = new Set([
    'https://app.marga.biz',
    'https://care.marga.biz',
    'http://127.0.0.1:9100',
    'http://127.0.0.1:9200',
    'http://127.0.0.1:5178',
    'http://localhost:9100',
    'http://localhost:9200',
    'http://localhost:5178',
]);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function loadEnvFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        raw.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
            const [key, ...rest] = trimmed.split('=');
            if (!process.env[key]) {
                process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
            }
        });
    } catch {
        // Optional env file.
    }
}

loadEnvFile(path.join(ROOT_DIR, '.env'));
loadEnvFile(path.join(ROOT_DIR, '.env.local'));
loadEnvFile(path.join(process.env.HOME || '', '.codex', 'env', 'marga-app.env'));
loadEnvFile(path.join(process.env.HOME || '', '.marga-launchd', 'margabase.env'));
loadEnvFile('/Volumes/Wotg Drive Mike/GitHub/marga-platform/apps/margabase/.env');

const authPool = new Pool({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: ['require', 'verify-ca', 'verify-full'].includes(String(process.env.POSTGRES_SSLMODE || process.env.PGSSLMODE || '').toLowerCase())
        ? { rejectUnauthorized: false }
        : undefined,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
});

const AUTH_ROLE_PERMISSIONS = {
    admin: ['customers', 'ai-product-consultant', 'billing', 'schedule', 'master-schedule', 'apd', 'accounting', 'collections', 'service', 'marga-care', 'general-production', 'releasing', 'receiving', 'inventory', 'hr', 'reports', 'settings', 'sync', 'field', 'purchasing', 'pettycash', 'sales'],
    billing: ['customers', 'billing', 'schedule', 'apd', 'accounting', 'pettycash', 'reports'],
    cashier: ['customers', 'billing', 'collections', 'schedule', 'apd', 'accounting', 'pettycash', 'reports'],
    collection: ['customers', 'collections', 'schedule', 'master-schedule', 'reports'],
    service: ['customers', 'ai-product-consultant', 'master-schedule', 'service', 'schedule', 'general-production', 'releasing', 'receiving', 'inventory', 'purchasing', 'field'],
    'purchasing-staff': ['purchasing'],
    'account-payables': ['apd', 'accounting', 'pettycash'],
    'inventory-controller': ['inventory', 'receiving'],
    hr: ['hr', 'settings'],
    technician: ['field'],
    messenger: ['field', 'schedule'],
    viewer: ['customers', 'reports'],
};

function normalizeAuthRole(role) {
    return String(role || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'viewer';
}

function normalizeAuthRoles(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(values.map(normalizeAuthRole).filter(Boolean))];
}

function normalizeAuthModules(value) {
    const aliases = { collection: 'collections', 'petty-cash': 'pettycash', 'field-app': 'field' };
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(values.map((item) => {
        const normalized = String(item || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return aliases[normalized] || normalized;
    }).filter(Boolean))];
}

function inferAuthRole(user) {
    const positionName = String(user?.position || user?.position_name || user?.position_label || '').toLowerCase();
    const positionId = Number(user?.position_id || 0);
    if (positionId === 5 || positionName.includes('technician') || positionName.includes('tech')) return 'technician';
    if (positionId === 9 || positionName.includes('messenger') || positionName.includes('driver')) return 'messenger';
    if (positionName.includes('collection')) return 'collection';
    if (positionName.includes('billing') || positionName.includes('account') || positionName.includes('finance') || positionName.includes('cashier')) return 'billing';
    if (positionName.includes('service') || positionName.includes('csr') || positionName.includes('sales')) return 'service';
    if (positionName.includes('hr')) return 'hr';
    if (positionName.includes('admin') || positionName.includes('manager')) return 'admin';
    return 'viewer';
}

function isAuthEmployeeActive(user) {
    if (!user || user.marga_active === false || user.marga_account_active === false || user.active === false) return false;
    if (user.marga_active === true || user.marga_account_active === true || user.active === true) return true;
    const status = Number(user.estatus);
    return !Number.isFinite(status) || status === 1;
}

function verifyAuthPassword(user, password) {
    const provided = String(password || '');
    if (user.password && String(user.password) === provided) return true;
    const hash = String(user.password_hash || '').trim();
    const salt = String(user.password_salt || '').trim();
    const iterations = Number(user.password_iterations || 120000);
    if (!hash || !salt || !Number.isFinite(iterations) || iterations < 20000) return false;
    const crypto = require('node:crypto');
    const derived = crypto.pbkdf2Sync(provided, Buffer.from(salt, 'base64'), iterations, 32, 'sha256');
    return derived.toString('base64') === hash;
}

async function nativeEmployeeLogin(body) {
    const ident = String(body?.username || body?.email || '').trim();
    const password = String(body?.password || '');
    if (!ident || !password) return { status: 400, body: { success: false, message: 'Email and password are required.' } };
    const normalized = ident.toLowerCase();
    const username = normalized.includes('@') ? normalized.split('@')[0] : normalized;
    const { rows } = await authPool.query(
        `select doc_id, data
           from app_meta.firestore_documents
          where collection = 'tbl_employee'
            and (
                lower(coalesce(data->>'email', '')) = $1
                or lower(coalesce(data->>'marga_login_email', '')) = $1
                or lower(coalesce(data->>'username', '')) = $1
                or lower(coalesce(data->>'marga_username', '')) = $1
                or lower(coalesce(data->>'username', '')) = $2
            )
          order by doc_id
          limit 50`,
        [normalized, username]
    );
    const employee = rows
        .map((row) => ({ _docId: row.doc_id, ...(row.data || {}) }))
        .find((candidate) => isAuthEmployeeActive(candidate) && verifyAuthPassword(candidate, password));
    if (!employee) return { status: 401, body: { success: false, message: 'Invalid email or password' } };

    const roles = normalizeAuthRoles(employee.marga_roles || employee.roles || employee.marga_role || employee.role || inferAuthRole(employee));
    const resolvedRoles = roles.length ? roles : ['viewer'];
    const configured = employee.allowed_modules_configured === true;
    const email = String(employee.email || employee.marga_login_email || '').trim().toLowerCase();
    return {
        status: 200,
        body: {
            success: true,
            user: {
                id: employee._docId,
                username: employee.username || email || ident,
                name: String(employee.marga_fullname || employee.name || `${employee.firstname || ''} ${employee.lastname || ''}`.trim() || employee.nickname || employee.username || employee.email || ident).trim(),
                role: resolvedRoles[0] || 'viewer',
                roles: resolvedRoles,
                email,
                staff_id: employee.id || employee.staff_id || employee.staffId || null,
                allowed_modules: configured ? normalizeAuthModules(employee.marga_allowed_modules || employee.allowed_modules) : [],
                role_modules: [...new Set(resolvedRoles.flatMap((role) => AUTH_ROLE_PERMISSIONS[role] || []))],
                allowed_modules_configured: configured,
                source: 'margabase-postgres',
            },
        },
    };
}

function corsOrigin(req) {
    const origin = String(req?.headers?.origin || '');
    return ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.marga.biz';
}

function send(req, res, status, body, headers = {}) {
    res.writeHead(status, {
        'access-control-allow-origin': corsOrigin(req),
        'vary': 'Origin',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization,X-API-Key',
        ...headers,
    });
    res.end(body);
}

function resolveStaticPath(urlPath) {
    const cleanPath = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
    const relativePath = cleanPath || 'index.html';
    const target = path.resolve(ROOT_DIR, relativePath);
    if (!target.startsWith(ROOT_DIR)) return null;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        return path.join(target, 'index.html');
    }
    return target;
}

async function proxyToMargabase(req, res, url) {
    const targetPath = `${url.pathname.replace(/^\/margabase-api/, '')}${url.search}`;
    const target = new URL(targetPath || '/', API_ORIGIN);
    const body = req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
        });

    const response = await fetch(target, {
        method: req.method,
        headers: {
            'content-type': req.headers['content-type'] || 'application/json',
            authorization: req.headers.authorization || '',
            'x-api-key': req.headers['x-api-key'] || '',
        },
        body,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    send(req, res, response.status, buffer, {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    });
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function runLocalNetlifyFunction(req, res, url) {
    const functionName = url.pathname.replace(/^\/\.netlify\/functions\//, '').split('/')[0];
    const functionPath = path.join(ROOT_DIR, 'netlify', 'functions', `${functionName}.js`);
    if (!functionName || !fs.existsSync(functionPath)) {
        send(req, res, 404, JSON.stringify({ ok: false, error: `Local Netlify function not found: ${functionName}` }), {
            'content-type': 'application/json; charset=utf-8',
        });
        return;
    }

    const previousBaseUrl = process.env.FIRESTORE_BASE_URL;
    const previousMargabaseDocumentsBaseUrl = process.env.MARGABASE_DOCUMENTS_BASE_URL;
    const previousMargabaseFirestoreBaseUrl = process.env.MARGABASE_FIRESTORE_BASE_URL;
    const previousMargabaseApiKey = process.env.MARGABASE_API_KEY;
    const previousLegacyApiKey = process.env.FIREBASE_API_KEY;
    process.env.FIRESTORE_BASE_URL = MARGABASE_FIRESTORE_BASE_URL;
    process.env.MARGABASE_DOCUMENTS_BASE_URL = MARGABASE_FIRESTORE_BASE_URL;
    process.env.MARGABASE_FIRESTORE_BASE_URL = MARGABASE_FIRESTORE_BASE_URL;
    process.env.MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
    process.env.FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || process.env.MARGABASE_API_KEY;

    const bodyBuffer = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRequestBody(req);
    const handlerModule = require(functionPath);
    const handler = handlerModule.handler || handlerModule.default;
    if (typeof handler !== 'function') throw new Error(`Local Netlify function has no handler: ${functionName}`);

    const queryStringParameters = {};
    url.searchParams.forEach((value, key) => {
        queryStringParameters[key] = value;
    });

    const result = await handler({
        httpMethod: req.method,
        path: url.pathname,
        rawUrl: url.href,
        headers: req.headers,
        queryStringParameters,
        body: bodyBuffer.length ? bodyBuffer.toString('utf8') : null,
        isBase64Encoded: false,
    });

    if (previousBaseUrl === undefined) delete process.env.FIRESTORE_BASE_URL;
    else process.env.FIRESTORE_BASE_URL = previousBaseUrl;
    if (previousMargabaseDocumentsBaseUrl === undefined) delete process.env.MARGABASE_DOCUMENTS_BASE_URL;
    else process.env.MARGABASE_DOCUMENTS_BASE_URL = previousMargabaseDocumentsBaseUrl;
    if (previousMargabaseFirestoreBaseUrl === undefined) delete process.env.MARGABASE_FIRESTORE_BASE_URL;
    else process.env.MARGABASE_FIRESTORE_BASE_URL = previousMargabaseFirestoreBaseUrl;
    if (previousMargabaseApiKey === undefined) delete process.env.MARGABASE_API_KEY;
    else process.env.MARGABASE_API_KEY = previousMargabaseApiKey;
    if (previousLegacyApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = previousLegacyApiKey;

    const responseBody = result?.isBase64Encoded
        ? Buffer.from(result.body || '', 'base64')
        : (result?.body || '');
    send(req, res, Number(result?.statusCode || 200), responseBody, result?.headers || {
        'content-type': 'application/json; charset=utf-8',
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

    if (req.method === 'OPTIONS') return send(req, res, 204, '');

    if (url.pathname.startsWith('/margabase-api/')) {
        proxyToMargabase(req, res, url).catch((error) => {
            send(req, res, 502, JSON.stringify({ error: error.message || 'Margabase proxy failed.' }), {
                'content-type': 'application/json; charset=utf-8',
            });
        });
        return;
    }

    const apiFunctionMap = {
        '/api/login': 'login',
        '/api/marga-care': 'marga-care',
        '/api/master-schedule-write': 'master-schedule-write',
        '/api/collections': 'collections',
    };
    if (apiFunctionMap[url.pathname]) {
        if (url.pathname === '/api/login') {
            const handleLogin = (bodyBuffer) => {
                let body = {};
                try {
                    body = bodyBuffer.length ? JSON.parse(bodyBuffer.toString('utf8')) : {};
                } catch {
                    body = {};
                }
                nativeEmployeeLogin(body).then((result) => {
                    send(req, res, result.status, JSON.stringify(result.body), {
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store',
                    });
                }).catch((error) => {
                    send(req, res, 503, JSON.stringify({ success: false, unavailable: true, message: 'Login service is temporarily unavailable.' }), {
                        'content-type': 'application/json; charset=utf-8',
                    });
                    console.error('Native Margabase login failed:', error?.message || error);
                });
            };
            if (req.method === 'GET' || req.method === 'HEAD') handleLogin(Buffer.alloc(0));
            else readRequestBody(req).then(handleLogin).catch((error) => {
                send(req, res, 400, JSON.stringify({ success: false, message: error?.message || 'Invalid login request.' }), {
                    'content-type': 'application/json; charset=utf-8',
                });
            });
            return;
        }
        url.pathname = `/.netlify/functions/${apiFunctionMap[url.pathname]}`;
        runLocalNetlifyFunction(req, res, url).catch((error) => {
            send(req, res, 502, JSON.stringify({ ok: false, error: error.message || 'Local API function failed.' }), {
                'content-type': 'application/json; charset=utf-8',
            });
        });
        return;
    }

    if (url.pathname.startsWith('/.netlify/functions/')) {
        runLocalNetlifyFunction(req, res, url).catch((error) => {
            send(req, res, 502, JSON.stringify({ ok: false, error: error.message || 'Local Netlify function failed.' }), {
                'content-type': 'application/json; charset=utf-8',
            });
        });
        return;
    }

    const target = resolveStaticPath(url.pathname);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        send(req, res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
        return;
    }

    const ext = path.extname(target).toLowerCase();
    send(req, res, 200, fs.readFileSync(target), {
        'cache-control': 'no-store',
        'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    });
});

server.listen(PORT, HOST, () => {
    console.log(`MARGA local Margabase proxy: http://${HOST}:${PORT}`);
    console.log(`Proxying /margabase-api/* to ${API_ORIGIN}`);
});
