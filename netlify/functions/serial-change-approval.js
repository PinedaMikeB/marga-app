const crypto = require('crypto');

const DEFAULT_APP_URL = process.env.MARGA_APP_BASE_URL || 'https://app.marga.biz';
const MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
const BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL
    || process.env.MARGABASE_FIRESTORE_BASE_URL
    || `${DEFAULT_APP_URL}/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents`;
const APPROVAL_SECRET = process.env.SERIAL_CHANGE_APPROVAL_SECRET || process.env.RESEND_API_KEY || MARGABASE_API_KEY;
const MAIL_FROM = process.env.MARGA_SERIAL_APPROVAL_EMAIL_FROM || process.env.MARGA_NOTIFY_EMAIL_FROM || 'Marga App <noreply@marga.biz>';
const DEFAULT_MIKE_EMAIL = 'michael.marga@gmail.com';

function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key'
        },
        body: JSON.stringify(body)
    };
}

function html(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body
    };
}

function firestoreValue(value) {
    if (value === null) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    return { stringValue: String(value ?? '') };
}

function readValue(field) {
    if (!field || typeof field !== 'object') return null;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    if (field.doubleValue !== undefined) return Number(field.doubleValue);
    if (field.booleanValue !== undefined) return Boolean(field.booleanValue);
    if (field.timestampValue !== undefined) return field.timestampValue;
    if (field.nullValue !== undefined) return null;
    return null;
}

function parseDoc(doc) {
    const row = {};
    Object.entries(doc?.fields || {}).forEach(([key, value]) => {
        row[key] = readValue(value);
    });
    row._docPath = doc?.name || '';
    row._docId = String(doc?.name || '').split('/').pop() || '';
    return row;
}

async function getDoc(collection, docId) {
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${encodeURIComponent(MARGABASE_API_KEY)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Unable to load ${collection}/${docId}`);
    }
    return parseDoc(payload);
}

async function patchDoc(collection, docId, fields) {
    const keys = Object.keys(fields);
    const params = keys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
    const body = { fields: {} };
    keys.forEach((key) => {
        body.fields[key] = firestoreValue(fields[key]);
    });
    const response = await fetch(`${BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${encodeURIComponent(MARGABASE_API_KEY)}&${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Unable to update ${collection}/${docId}`);
    }
    return parseDoc(payload);
}

function buildRecipients() {
    const configured = [
        DEFAULT_MIKE_EMAIL,
        process.env.MARGA_SERIAL_APPROVAL_EMAIL,
        process.env.MARGA_SERIAL_APPROVAL_EMAILS,
        process.env.MARGA_NOTIFY_EMAIL_TO,
        process.env.MARGA_SERIAL_APPROVAL_EMMAN_EMAIL
    ]
        .flatMap((value) => String(value || '').split(/[,\s;]+/g))
        .map((value) => value.trim())
        .filter(Boolean);
    return Array.from(new Set(configured));
}

function signToken(requestId, action, approver) {
    return crypto
        .createHmac('sha256', APPROVAL_SECRET)
        .update([requestId, action, approver].join('|'))
        .digest('hex');
}

function verifyToken(requestId, action, approver, token) {
    return signToken(requestId, action, approver) === String(token || '');
}

async function sendEmail({ to, subject, html: htmlBody }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !to.length) {
        return { sent: false, reason: 'RESEND_API_KEY or recipients not configured' };
    }
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: MAIL_FROM,
            to,
            subject,
            html: htmlBody
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Resend email failed: ${response.status} ${JSON.stringify(payload)}`);
    }
    return { sent: true, id: payload?.id || null };
}

function approvalLinks(requestId, recipient) {
    const approveToken = signToken(requestId, 'approve', recipient);
    const rejectToken = signToken(requestId, 'reject', recipient);
    return {
        approve: `${DEFAULT_APP_URL}/.netlify/functions/serial-change-approval?requestId=${encodeURIComponent(requestId)}&action=approve&approver=${encodeURIComponent(recipient)}&token=${encodeURIComponent(approveToken)}`,
        reject: `${DEFAULT_APP_URL}/.netlify/functions/serial-change-approval?requestId=${encodeURIComponent(requestId)}&action=reject&approver=${encodeURIComponent(recipient)}&token=${encodeURIComponent(rejectToken)}`
    };
}

function approvalEmailHtml(request, recipients) {
    const customer = [request.customer_name, request.branch_name].filter(Boolean).join(' · ') || `Schedule ${request.schedule_id || ''}`;
    const gpUrl = `${DEFAULT_APP_URL}/general-production/index.html?serial_request=${encodeURIComponent(request.id || '')}&serial=${encodeURIComponent(request.requested_serial || '')}`;
    const linkBlocks = recipients.map((recipient) => {
        const links = approvalLinks(request.id, recipient);
        return `
            <p><strong>${recipient}</strong><br>
            <a href="${links.approve}">Approve for General Production</a> |
            <a href="${links.reject}">Reject Request</a></p>
        `;
    }).join('');
    return `
        <h2>Field Serial Change Request</h2>
        <p><strong>Customer / Branch:</strong> ${customer}</p>
        <p><strong>Schedule ID:</strong> ${request.schedule_id || '-'}</p>
        <p><strong>Purpose:</strong> ${request.purpose_label || '-'}</p>
        <p><strong>Recorded Serial:</strong> ${request.current_serial || '(blank)'}</p>
        <p><strong>Requested Serial:</strong> ${request.requested_serial || '-'}</p>
        <p><strong>Requested By:</strong> ${request.requested_by_name || request.requested_by || '-'}</p>
        <p><strong>Requested At:</strong> ${request.requested_at || '-'}</p>
        <p><strong>General Production:</strong> <a href="${gpUrl}">${gpUrl}</a></p>
        ${linkBlocks}
    `;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

    try {
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const requestId = String(body.requestId || '').trim();
            if (!requestId) return json(400, { ok: false, error: 'requestId is required' });

            const request = await getDoc('tbl_serial_corrections', requestId);
            const recipients = buildRecipients();
            const email = await sendEmail({
                to: recipients,
                subject: `Serial change approval needed: ${request.customer_name || request.branch_name || requestId}`,
                html: approvalEmailHtml(request, recipients)
            });

            await patchDoc('tbl_serial_corrections', requestId, {
                email_sent_at: new Date().toISOString(),
                email_status: email.sent ? 'sent' : 'skipped',
                email_error: email.reason || '',
                approval_recipients: recipients.join(', ')
            });

            return json(200, { ok: true, email, recipients });
        }

        if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

        const requestId = String(event.queryStringParameters?.requestId || '').trim();
        const action = String(event.queryStringParameters?.action || '').trim().toLowerCase();
        const approver = String(event.queryStringParameters?.approver || '').trim().toLowerCase();
        const token = String(event.queryStringParameters?.token || '').trim();
        if (!requestId || !['approve', 'reject'].includes(action) || !approver || !token) {
            return html(400, '<h2>Invalid approval link.</h2>');
        }
        if (!verifyToken(requestId, action, approver, token)) {
            return html(403, '<h2>Approval token is invalid.</h2>');
        }

        const nowIso = new Date().toISOString();
        const request = await getDoc('tbl_serial_corrections', requestId);
        const nextStatus = action === 'approve' ? 'approved_for_general_production' : 'rejected';
        await patchDoc('tbl_serial_corrections', requestId, {
            status: nextStatus,
            approval_action: action,
            approval_acted_at: nowIso,
            approval_acted_by: approver,
            approved_at: action === 'approve' ? nowIso : '',
            approved_by: action === 'approve' ? approver : '',
            rejected_at: action === 'reject' ? nowIso : '',
            rejected_by: action === 'reject' ? approver : ''
        });
        if (request.schedule_doc_id) {
            await patchDoc('tbl_schedule', String(request.schedule_doc_id), {
                field_serial_verification_status: action === 'approve' ? 'approved_for_general_production' : 'rejected',
                field_serial_change_request_status: nextStatus,
                field_serial_change_email_status: 'actioned',
                field_updated_at: nowIso,
                bridge_updated_at: nowIso
            });
        }

        return html(200, `
            <html><body style="font-family:Arial,sans-serif;padding:24px;">
            <h2>Serial change request ${action === 'approve' ? 'approved' : 'rejected'}.</h2>
            <p>Request ID: ${requestId}</p>
            <p>Status: ${nextStatus}</p>
            <p><a href="${DEFAULT_APP_URL}/general-production/index.html?serial_request=${encodeURIComponent(requestId)}">Open General Production</a></p>
            </body></html>
        `);
    } catch (error) {
        if (event.httpMethod === 'GET') {
            return html(500, `<h2>Serial approval failed.</h2><p>${String(error.message || error)}</p>`);
        }
        return json(500, { ok: false, error: String(error.message || error) });
    }
};
