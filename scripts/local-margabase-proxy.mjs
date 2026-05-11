#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 9100);
const API_ORIGIN = process.env.MARGABASE_API_ORIGIN || 'http://127.0.0.1:8787';

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

function send(res, status, body, headers = {}) {
    res.writeHead(status, {
        'access-control-allow-origin': '*',
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
    send(res, response.status, buffer, {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (url.pathname.startsWith('/margabase-api/')) {
        proxyToMargabase(req, res, url).catch((error) => {
            send(res, 502, JSON.stringify({ error: error.message || 'Margabase proxy failed.' }), {
                'content-type': 'application/json; charset=utf-8',
            });
        });
        return;
    }

    const target = resolveStaticPath(url.pathname);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
        return;
    }

    const ext = path.extname(target).toLowerCase();
    send(res, 200, fs.readFileSync(target), {
        'cache-control': 'no-store',
        'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`MARGA local Margabase proxy: http://127.0.0.1:${PORT}`);
    console.log(`Proxying /margabase-api/* to ${API_ORIGIN}`);
});
