// Strip legacy ~xx / ~x prefixes from branch names before displaying to customers
export function cleanBranchName(value) {
  return String(value || '').replace(/^~x+\s*/i, '').trim() || '-';
}

// Format billing period: handles "2026-" (truncated), "2026-06", or falls back to invoice_date
export function formatBillingPeriod(period, fallbackDate) {
  if (!period && !fallbackDate) return '-';
  const raw = String(period || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const d = new Date(`${match[1]}-${match[2]}-01`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    }
  }
  if (fallbackDate) {
    const d = new Date(fallbackDate);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    }
  }
  return raw || '-';
}

// Format any date/ISO string to "Jun 30, 2026" in Manila timezone
export function formatDatePH(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatDate(value) {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2
  }).format(amount);
}

export function statusClass(status) {
  const s = String(status || '').toLowerCase().trim();

  // Device / machine statuses
  if (s === 'active')            return 'status-active';
  if (s === 'incoming')          return 'status-incoming';
  if (s === 'under repair')      return 'status-repair';
  if (s === 'needs attention')   return 'status-attention';
  if (s === 'for replacement')   return 'status-inactive';
  if (s === 'decommissioned')    return 'status-inactive';
  if (s === 'missing')           return 'status-attention';
  if (s === 'pending setup')     return 'status-attention';
  if (s === 'inactive')          return 'status-inactive';
  if (s === 'staging')           return 'status-incoming';

  // Ticket / billing statuses
  if (s.includes('complete') || s.includes('resolved') || s === 'paid') return 'done';
  if (s.includes('progress') || s.includes('assigned'))                  return 'progress';
  if (s.includes('open') || s.includes('overdue') || s === 'unpaid')     return 'open';
  if (s.includes('repair') || s.includes('attention') || s === 'missing') return 'status-attention';
  return 'pending';
}

export function uid(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

export function generateTicketNo() {
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = `${stamp.getMonth() + 1}`.padStart(2, '0');
  const d = `${stamp.getDate()}`.padStart(2, '0');
  const r = Math.floor(Math.random() * 900 + 100);
  return `TKT-${y}${m}${d}-${r}`;
}

export function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(obj, key)) acc[key] = obj[key];
    return acc;
  }, {});
}

export function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function parseBranchScope(user) {
  if (!user) return { companyId: null, branchId: null };
  return {
    companyId: user.companyId || null,
    branchId: user.branchId || null
  };
}

export function withoutUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => withoutUndefined(entry));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      if (entry === undefined) return acc;
      acc[key] = withoutUndefined(entry);
      return acc;
    }, {});
  }
  return value;
}

export function digitsOnly(input) {
  return String(input || '').replace(/\D+/g, '');
}
