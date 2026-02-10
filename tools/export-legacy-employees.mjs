import fs from 'node:fs/promises';
import path from 'node:path';

function parseFirebaseConfig(jsText) {
  const apiKey = (jsText.match(/apiKey:\s*'([^']+)'/) || [])[1];
  const baseUrl = (jsText.match(/baseUrl:\s*'([^']+)'/) || [])[1];
  if (!apiKey || !baseUrl) {
    throw new Error('Could not parse apiKey/baseUrl from shared/js/firebase-config.js');
  }
  return { apiKey, baseUrl };
}

function unwrapValue(v) {
  if (!v || typeof v !== 'object') return '';
  if ('stringValue' in v) return v.stringValue ?? '';
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return '';
  if ('mapValue' in v) {
    const out = {};
    const fields = v.mapValue?.fields || {};
    for (const [k, vv] of Object.entries(fields)) out[k] = unwrapValue(vv);
    return out;
  }
  if ('arrayValue' in v) {
    const values = v.arrayValue?.values || [];
    return values.map(unwrapValue);
  }
  return '';
}

function unwrapFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = unwrapValue(v);
  }
  return out;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[\n\r",]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
  return s;
}

async function fetchAllDocuments({ baseUrl, apiKey }, collection, pageSize = 2000) {
  let pageToken = '';
  const docs = [];

  while (true) {
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    if (pageToken) params.set('pageToken', pageToken);
    params.set('key', apiKey);

    const url = `${baseUrl}/${collection}?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `Failed to list ${collection}`);
    }

    for (const doc of json.documents || []) {
      const id = String(doc.name || '').split('/').pop();
      docs.push({ id, ...unwrapFields(doc.fields) });
    }

    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }

  return docs;
}

function roleGuess(employee, positionName) {
  const posId = Number(employee.position_id || 0);
  const pn = String(positionName || '').toLowerCase();
  if (posId === 5 || pn.includes('technician') || pn.includes('tech')) return 'Technician';
  if (posId === 9 || pn.includes('messenger') || pn.includes('driver')) return 'Messenger';
  return 'Staff';
}

async function main() {
  const cfgText = await fs.readFile('shared/js/firebase-config.js', 'utf8');
  const cfg = parseFirebaseConfig(cfgText);

  const [employees, positions] = await Promise.all([
    fetchAllDocuments(cfg, 'tbl_employee', 2000),
    fetchAllDocuments(cfg, 'tbl_empos', 1000)
  ]);

  const positionById = new Map();
  for (const pos of positions) {
    positionById.set(String(pos.id), pos.position || pos.name || '');
  }

  employees.sort((a, b) => Number(a.id) - Number(b.id));

  const headers = [
    'employee_id',
    'nickname',
    'firstname',
    'lastname',
    'legacy_username',
    'contact_number',
    'legacy_estatus',
    'date_hired',
    'date_end',
    'position_id',
    'position',
    'role_guess',
    'active',
    'email',
    'notes'
  ];

  const rows = [headers.join(',')];
  for (const emp of employees) {
    const positionName = positionById.get(String(emp.position_id || '')) || '';
    const row = {
      employee_id: emp.id,
      nickname: emp.nickname || '',
      firstname: emp.firstname || '',
      lastname: emp.lastname || '',
      legacy_username: emp.username || '',
      contact_number: emp.contact_number || '',
      legacy_estatus: emp.estatus ?? '',
      date_hired: emp.date_hired || '',
      date_end: emp.date_end || '',
      position_id: emp.position_id ?? '',
      position: positionName,
      role_guess: roleGuess(emp, positionName),
      active: '',
      email: '',
      notes: ''
    };
    rows.push(headers.map((h) => csvEscape(row[h])).join(','));
  }

  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const outPath = path.join('exports', `legacy_employees_${y}-${m}-${d}.csv`);

  await fs.writeFile(outPath, rows.join('\n') + '\n', 'utf8');

  console.log(outPath);
  console.log(`Employees exported: ${employees.length}`);
  console.log(`Positions loaded: ${positions.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
