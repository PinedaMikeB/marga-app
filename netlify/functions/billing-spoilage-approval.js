const crypto = require('crypto');
const tls = require('tls');

const DEFAULT_APP_URL = process.env.MARGA_APP_BASE_URL || 'https://app.marga.biz';
const MARGABASE_API_KEY = process.env.MARGABASE_API_KEY || 'margabase-local';
const BASE_URL = process.env.MARGABASE_DOCUMENTS_BASE_URL
    || process.env.MARGABASE_FIRESTORE_BASE_URL
    || `${DEFAULT_APP_URL}/margabase-api/v1/projects/sah-spiritual-journal/databases/(default)/documents`;
const APPROVAL_SECRET = process.env.BILLING_SPOILAGE_APPROVAL_SECRET || process.env.RESEND_API_KEY || MARGABASE_API_KEY;
const MAIL_FROM = process.env.MARGA_BILLING_APPROVAL_EMAIL_FROM || process.env.MARGA_NOTIFY_EMAIL_FROM || 'Marga App <noreply@marga.biz>';
const DEFAULT_MIKE_EMAIL = 'michael.marga@gmail.com';
const CARE_SMTP_HOST = process.env.MARGA_CARE_SMTP_HOST || 'smtp.hostinger.com';
const CARE_SMTP_PORT = Number(process.env.MARGA_CARE_SMTP_PORT || 465);
const CARE_SMTP_USER = process.env.MARGA_CARE_SMTP_USER || 'solutions@marga.biz';
const CARE_SMTP_FROM = process.env.MARGA_CARE_SMTP_FROM || CARE_SMTP_USER;
const CARE_SMTP_PASSWORD = process.env.MARGA_CARE_SMTP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '';

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

function formatAmount(value) {
    const number = Number(value || 0) || 0;
    return number.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function buildRecipients() {
    const configured = [
        DEFAULT_MIKE_EMAIL,
        process.env.MARGA_BILLING_SPOILAGE_APPROVAL_EMAIL,
        process.env.MARGA_BILLING_SPOILAGE_APPROVAL_EMAILS,
        process.env.MARGA_NOTIFY_EMAIL_TO
    ]
        .flatMap((value) => String(value || '').split(/[,\s;]+/g))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(configured));
}

function signToken(docId, action, approver) {
    return crypto
        .createHmac('sha256', APPROVAL_SECRET)
        .update([docId, action, approver].join('|'))
        .digest('hex');
}

function verifyToken(docId, action, approver, token) {
    return signToken(docId, action, approver) === String(token || '');
}

async function sendEmail({ to, subject, html: htmlBody }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !to.length) {
        return sendViaHostinger({ to, subject, html: htmlBody });
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
        return sendViaHostinger({
            to,
            subject,
            html: htmlBody,
            resendError: `Resend email failed: ${response.status} ${JSON.stringify(payload)}`
        });
    }
    return { sent: true, id: payload?.id || null, provider: 'resend' };
}

function smtpEscape(value) {
    return String(value || '').replace(/\r?\n/g, '\r\n');
}

function mailAddress(value) {
    return String(value || '').trim().replace(/[<>\r\n]/g, '');
}

function smtpSendCommand(socket, command, expectedCodes) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const expected = new Set(expectedCodes);
        const cleanup = () => {
            socket.off('data', onData);
            socket.off('error', onError);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onData = (chunk) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split(/\r?\n/).filter(Boolean);
            const last = lines[lines.length - 1] || '';
            if (!/^\d{3} /.test(last)) return;
            const code = Number(last.slice(0, 3));
            cleanup();
            if (expected.has(code)) resolve(buffer);
            else reject(new Error(`SMTP ${code}: ${buffer.trim()}`));
        };
        socket.on('data', onData);
        socket.on('error', onError);
        if (command) socket.write(`${command}\r\n`);
    });
}

async function sendHostingerMessage({ to, subject, html }) {
    if (!CARE_SMTP_PASSWORD || !to.length) {
        return { sent: false, reason: 'Hostinger SMTP password or recipients not configured', provider: 'hostinger' };
    }

    const from = mailAddress(CARE_SMTP_FROM);
    const recipients = Array.from(new Set((to || []).map((entry) => mailAddress(entry)).filter(Boolean)));
    if (!recipients.length) {
        return { sent: false, reason: 'Recipients not configured', provider: 'hostinger' };
    }

    const socket = tls.connect({
        host: CARE_SMTP_HOST,
        port: CARE_SMTP_PORT,
        servername: CARE_SMTP_HOST,
        timeout: 15000
    });

    await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('timeout', () => reject(new Error('SMTP connection timed out.')));
        socket.once('error', reject);
    });

    try {
        await smtpSendCommand(socket, '', [220]);
        await smtpSendCommand(socket, `EHLO ${CARE_SMTP_HOST}`, [250]);
        await smtpSendCommand(socket, 'AUTH LOGIN', [334]);
        await smtpSendCommand(socket, Buffer.from(CARE_SMTP_USER).toString('base64'), [334]);
        await smtpSendCommand(socket, Buffer.from(CARE_SMTP_PASSWORD).toString('base64'), [235]);
        await smtpSendCommand(socket, `MAIL FROM:<${from}>`, [250]);
        for (const recipient of recipients) {
            await smtpSendCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
        }
        await smtpSendCommand(socket, 'DATA', [354]);
        const payload = [
            `From: Marga Billing <${from}>`,
            `To: ${recipients.join(', ')}`,
            `Subject: ${smtpEscape(subject)}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            String(html || ''),
            '.'
        ].join('\r\n');
        await smtpSendCommand(socket, payload, [250]);
        await smtpSendCommand(socket, 'QUIT', [221]);
        return { sent: true, provider: 'hostinger' };
    } finally {
        socket.destroy();
    }
}

async function sendViaHostinger({ to, subject, html, resendError = '' }) {
    const result = await sendHostingerMessage({ to, subject, html });
    if (result.sent) {
        return {
            ...result,
            fallback_from_resend: Boolean(resendError),
            fallback_reason: resendError || ''
        };
    }
    return {
        ...result,
        sent: false,
        reason: resendError ? `${resendError}; ${result.reason}` : result.reason
    };
}

function approvalLinks(docId, recipient) {
    const approveToken = signToken(docId, 'approve', recipient);
    const rejectToken = signToken(docId, 'reject', recipient);
    return {
        approve: `${DEFAULT_APP_URL}/.netlify/functions/billing-spoilage-approval?docId=${encodeURIComponent(docId)}&action=approve&approver=${encodeURIComponent(recipient)}&token=${encodeURIComponent(approveToken)}`,
        reject: `${DEFAULT_APP_URL}/.netlify/functions/billing-spoilage-approval?docId=${encodeURIComponent(docId)}&action=reject&approver=${encodeURIComponent(recipient)}&token=${encodeURIComponent(rejectToken)}`
    };
}

function buildInvoiceLabel(doc = {}) {
    const parts = [
        String(doc.company_name || '').trim(),
        String(doc.branch_name || '').trim(),
        String(doc.machine_label || doc.machine_model || '').trim()
    ].filter(Boolean);
    return parts.join(' • ') || `Invoice ${String(doc.invoice_no || doc.invoiceno || doc.invoiceid || '').trim()}`;
}

function computeBaseAmountFromDoc(doc = {}) {
    const quotaAmount = Number(doc.quota_amount || 0) || 0;
    const succeedingAmount = Number(doc.succeeding_amount || 0) || 0;
    if (quotaAmount > 0 || succeedingAmount > 0) return quotaAmount + succeedingAmount;
    return Number(doc.totalamount || doc.amount || 0) || 0;
}

function approvalEmailHtml(doc, recipient) {
    const invoiceNo = String(doc.invoice_no || doc.invoiceno || doc.invoiceid || '').trim() || '(pending)';
    const customerLabel = buildInvoiceLabel(doc);
    const requestedAt = String(doc.actual_spoilage_requested_at || doc.saved_at || '').trim() || '-';
    const requestedBy = String(doc.actual_spoilage_requested_by || doc.saved_by || doc.prepared_by || '').trim() || '-';
    const proofStatus = String(doc.actual_spoilage_proof_name || '').trim()
        ? `Saved in app as ${doc.actual_spoilage_proof_name}`
        : 'Saved in app';
    const rawPages = Number(doc.field_total_consumed || 0) || 0;
    const systemSpoilagePages = Number(doc.system_spoilage_pages || doc.spoilage_pages || 0) || 0;
    const actualSpoilagePages = Number(doc.actual_spoilage_pages || 0) || 0;
    const totalSpoilagePages = Number(doc.total_spoilage_pages || doc.spoilage_pages || 0) || 0;
    const finalAmount = Number(doc.totalamount || doc.amount || 0) || 0;
    const baseAmount = computeBaseAmountFromDoc(doc);
    const spoilageAdjustmentAmount = Math.max(0, Number((baseAmount - finalAmount).toFixed(2)));
    const links = approvalLinks(doc._docId || doc.id || '', recipient);
    return `
        <div style="font-family:Arial,sans-serif;color:#17324d;line-height:1.5;padding:8px 0;">
            <h2 style="margin:0 0 12px;">Billing spoilage approval needed</h2>
            <p><strong>Request ID:</strong> ${String(doc._docId || doc.id || '').trim() || '-'}</p>
            <p><strong>Invoice #:</strong> ${invoiceNo}</p>
            <p><strong>Customer:</strong> ${customerLabel}</p>
            <p><strong>Reading month:</strong> ${String(doc.month || '').trim()} ${String(doc.year || '').trim()}</p>
            <p><strong>Gross total consumed:</strong> ${rawPages}</p>
            <p><strong>System spoilage:</strong> ${systemSpoilagePages}</p>
            <p><strong>Proposed actual spoilage:</strong> ${actualSpoilagePages}</p>
            <p><strong>Total spoilage used in this bill:</strong> ${totalSpoilagePages}</p>
            <p><strong>Billing amount for approval:</strong> PHP ${formatAmount(finalAmount)}</p>
            <p><strong>Spoilage adjustment applied in this bill:</strong> PHP ${formatAmount(spoilageAdjustmentAmount)}</p>
            <p><strong>Final amount if approved:</strong> PHP ${formatAmount(finalAmount)}</p>
            <p><strong>Reason:</strong> ${String(doc.actual_spoilage_reason || '').trim() || '-'}</p>
            <p><strong>Proof:</strong> ${proofStatus}</p>
            <p><strong>Requested by:</strong> ${requestedBy}</p>
            <p><strong>Requested at:</strong> ${requestedAt}</p>
            <p>This email approval updates the billing request directly. No need to open the app.</p>
            <p style="margin:12px 0;"><strong>${recipient}</strong><br>
            <a href="${links.approve}" style="display:inline-block;padding:10px 16px;background:#0f6df2;color:#fff;text-decoration:none;border-radius:8px;margin-right:8px;">Approve Spoilage</a>
            <a href="${links.reject}" style="display:inline-block;padding:10px 16px;background:#f4f6fb;color:#17324d;text-decoration:none;border-radius:8px;border:1px solid #d3dceb;">Reject Request</a></p>
        </div>
    `;
}

function renderResultPage({ title, subtitle, status }) {
    return `
        <html>
            <body style="font-family:Arial,sans-serif;background:#eef5ff;padding:32px;color:#17324d;">
                <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #d4e3f7;border-radius:16px;padding:28px;box-shadow:0 20px 48px rgba(18,55,100,.12);">
                    <h2 style="margin-top:0;">${title}</h2>
                    <p>${subtitle}</p>
                    <p><strong>Status:</strong> ${status}</p>
                    <p>No app action is needed after this email approval.</p>
                </div>
            </body>
        </html>
    `;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });

    try {
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const docId = String(body.docId || '').trim();
            if (!docId) return json(400, { ok: false, error: 'docId is required' });

            const doc = await getDoc('tbl_billing', docId);
            const recipients = buildRecipients();
            const emailResults = [];
            for (const recipient of recipients) {
                const email = await sendEmail({
                    to: [recipient],
                    subject: `Billing spoilage approval needed: invoice ${String(doc.invoice_no || doc.invoiceno || doc.invoiceid || docId).trim()}`,
                    html: approvalEmailHtml(doc, recipient)
                });
                emailResults.push({ recipient, ...email });
            }
            const emailFailures = emailResults.filter((entry) => !entry.sent);
            const email = {
                sent: emailResults.length > 0 && emailFailures.length === 0,
                provider: emailResults.find((entry) => entry.provider)?.provider || '',
                details: emailResults,
                reason: emailFailures.map((entry) => `${entry.recipient}: ${entry.reason || 'send failed'}`).join('; ')
            };
            const nowIso = new Date().toISOString();
            await patchDoc('tbl_billing', docId, {
                approval_email_sent_at: nowIso,
                approval_email_status: email.sent ? 'sent' : 'skipped',
                approval_email_error: email.reason || '',
                approval_recipients: recipients.join(', '),
                approval_action: '',
                approval_acted_at: '',
                approval_acted_by: '',
                approval_action_source: ''
            });

            return json(200, { ok: true, email, recipients, docId });
        }

        if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

        const docId = String(event.queryStringParameters?.docId || '').trim();
        const action = String(event.queryStringParameters?.action || '').trim().toLowerCase();
        const approver = String(event.queryStringParameters?.approver || '').trim().toLowerCase();
        const token = String(event.queryStringParameters?.token || '').trim();
        if (!docId || !['approve', 'reject'].includes(action) || !approver || !token) {
            return html(400, renderResultPage({
                title: 'Invalid approval link.',
                subtitle: 'This spoilage approval link is incomplete.',
                status: 'invalid'
            }));
        }
        if (!verifyToken(docId, action, approver, token)) {
            return html(403, renderResultPage({
                title: 'Approval token is invalid.',
                subtitle: 'This spoilage approval link is no longer valid.',
                status: 'invalid'
            }));
        }

        const doc = await getDoc('tbl_billing', docId);
        const currentStatus = String(doc.approval_status || '').trim().toLowerCase();
        if (['approved', 'rejected'].includes(currentStatus)) {
            return html(200, renderResultPage({
                title: `This spoilage request was already ${currentStatus}.`,
                subtitle: `Invoice ${String(doc.invoice_no || doc.invoiceno || doc.invoiceid || '').trim()} does not need another action from this link.`,
                status: currentStatus
            }));
        }

        const nowIso = new Date().toISOString();
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        const approvalNote = action === 'approve'
            ? 'Approved actual spoilage discount from email link.'
            : 'Rejected actual spoilage discount from email link.';
        await patchDoc('tbl_billing', docId, {
            approval_status: nextStatus,
            approval_note: approvalNote,
            approved_by: action === 'approve' ? approver : '',
            approved_at: action === 'approve' ? nowIso : '',
            approval_updated_by: approver,
            approval_updated_at: nowIso,
            approval_email_status: 'actioned',
            approval_action: action,
            approval_acted_at: nowIso,
            approval_acted_by: approver,
            approval_action_source: 'email_link',
            updated_at: nowIso
        });

        return html(200, renderResultPage({
            title: `Spoilage request ${action === 'approve' ? 'approved' : 'rejected'}.`,
            subtitle: `Invoice ${String(doc.invoice_no || doc.invoiceno || doc.invoiceid || '').trim()} is now marked as ${nextStatus}.`,
            status: nextStatus
        }));
    } catch (error) {
        if (event.httpMethod === 'GET') {
            return html(500, renderResultPage({
                title: 'Billing spoilage approval failed.',
                subtitle: String(error.message || error),
                status: 'error'
            }));
        }
        return json(500, { ok: false, error: String(error.message || error) });
    }
};
