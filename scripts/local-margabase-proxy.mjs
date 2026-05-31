#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 9100);
const HOST = process.env.HOST || '127.0.0.1';
const API_ORIGIN = process.env.MARGABASE_API_ORIGIN || 'http://127.0.0.1:8787';
const MARGABASE_DOCUMENTS_BASE_URL = `${API_ORIGIN}/v1/projects/sah-spiritual-journal/databases/(default)/documents`;
const require = createRequire(import.meta.url);
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
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
};

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

    const previousDocumentsBaseUrl = process.env.MARGABASE_DOCUMENTS_BASE_URL;
    const previousBaseUrl = process.env.FIRESTORE_BASE_URL;
    const previousMargabaseApiKey = process.env.MARGABASE_API_KEY;
    process.env.MARGABASE_DOCUMENTS_BASE_URL = MARGABASE_DOCUMENTS_BASE_URL;
    process.env.FIRESTORE_BASE_URL = MARGABASE_DOCUMENTS_BASE_URL;
    process.env.MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';

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

    if (previousDocumentsBaseUrl === undefined) delete process.env.MARGABASE_DOCUMENTS_BASE_URL;
    else process.env.MARGABASE_DOCUMENTS_BASE_URL = previousDocumentsBaseUrl;
    if (previousBaseUrl === undefined) delete process.env.FIRESTORE_BASE_URL;
    else process.env.FIRESTORE_BASE_URL = previousBaseUrl;
    if (previousMargabaseApiKey === undefined) delete process.env.MARGABASE_API_KEY;
    else process.env.MARGABASE_API_KEY = previousMargabaseApiKey;

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
