import fs from 'node:fs';
import path from 'node:path';

const CSV_PATH = process.argv[2] || 'tools/model-error-guides-import.csv';
const COLLECTION = process.argv[3] || 'marga_model_error_guides';
const CONFIG_PATH = 'shared/js/firebase-config.js';

function parseConfig() {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  const projectId = text.match(/projectId:\s*['"]([^'"]+)['"]/)?.[1];
  const baseUrl = text.match(/baseUrl:\s*['"]([^'"]+)['"]/)?.[1];
  if (!projectId || !baseUrl) throw new Error(`Unable to read projectId/baseUrl from ${CONFIG_PATH}`);
  return { projectId, baseUrl };
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function readServiceAccount() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const json = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    return { email: json.client_email, privateKey: json.private_key };
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY before importing.');
  }
  return { email, privateKey };
}

async function getAccessToken() {
  const { createSign } = await import('node:crypto');
  const serviceAccount = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(serviceAccount.privateKey, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || 'Unable to get Google access token.');
  return payload.access_token;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  const header = rows.shift().map((cell) => cell.trim().replace(/^\uFEFF/, ''));
  return rows.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || ''])));
}

function toFirestoreValue(value) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => ({ stringValue: String(item) })) } };
  if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
  return { stringValue: String(value ?? '') };
}

function docId(row) {
  return [
    row.model,
    row.trouble_id,
    row.lcd_error_message,
    row.service_level_code
  ].join('__').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
}

async function writeDoc({ baseUrl, token }, row) {
  const aliases = String(row.model_aliases || '').split('|').map((item) => item.trim()).filter(Boolean);
  const fields = {
    model: toFirestoreValue(row.model),
    model_aliases: toFirestoreValue(aliases),
    family: toFirestoreValue(row.family),
    trouble_id: toFirestoreValue(Number(row.trouble_id || 0)),
    trouble_label: toFirestoreValue(row.trouble_label),
    lcd_error_message: toFirestoreValue(row.lcd_error_message),
    meaning: toFirestoreValue(row.meaning),
    what_to_do: toFirestoreValue(row.what_to_do),
    service_level_code: toFirestoreValue(row.service_level_code),
    source_reference: toFirestoreValue(row.source_reference),
    source_file: toFirestoreValue(row.source_file),
    updated_at: { timestampValue: new Date().toISOString() }
  };
  const response = await fetch(`${baseUrl}/${COLLECTION}/${docId(row)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Import failed with ${response.status}`);
}

const config = parseConfig();
const token = await getAccessToken();
const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
let written = 0;
for (const row of rows) {
  await writeDoc({ ...config, token }, row);
  written += 1;
  if (written % 100 === 0) console.log(`Imported ${written}/${rows.length}`);
}

console.log(`Imported ${written} rows into ${COLLECTION} from ${path.resolve(CSV_PATH)}`);
