const KEY = 'msp_session_v1';
const PREVIEW_KEY = 'msp_preview_session_v1';
const TOKEN_KEY = 'msp_preview_token_v1';
const PREVIEW_COMPANY_KEY = 'msp_preview_company_v1';
const PREVIEW_BRANCH_KEY = 'msp_preview_branch_v1';

export function saveSession(user, { ephemeral = false } = {}) {
  const storage = ephemeral ? sessionStorage : localStorage;
  storage.setItem(ephemeral ? PREVIEW_KEY : KEY, JSON.stringify(user));
}

export function loadSession() {
  const raw = sessionStorage.getItem(PREVIEW_KEY) || localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to parse session', error);
    return null;
  }
}

export function clearSession({ keepPersistent = false } = {}) {
  sessionStorage.removeItem(PREVIEW_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PREVIEW_COMPANY_KEY);
  sessionStorage.removeItem(PREVIEW_BRANCH_KEY);
  if (!keepPersistent) localStorage.removeItem(KEY);
}

export function saveAuthToken(token) {
  if (!token) {
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, String(token));
}

export function loadAuthToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function clearAuthToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function savePreviewCompanyId(companyId) {
  if (!companyId) {
    sessionStorage.removeItem(PREVIEW_COMPANY_KEY);
    return;
  }
  sessionStorage.setItem(PREVIEW_COMPANY_KEY, String(companyId));
}

export function loadPreviewCompanyId() {
  return sessionStorage.getItem(PREVIEW_COMPANY_KEY) || '';
}

export function savePreviewBranchId(branchId) {
  if (!branchId) {
    sessionStorage.removeItem(PREVIEW_BRANCH_KEY);
    return;
  }
  sessionStorage.setItem(PREVIEW_BRANCH_KEY, String(branchId));
}

export function loadPreviewBranchId() {
  return sessionStorage.getItem(PREVIEW_BRANCH_KEY) || '';
}

export function roleLabel(role) {
  const map = {
    corporate_admin: 'Corporate Admin',
    company_admin: 'Company Account Manager',
    marga_admin: 'Marga Admin',
    marga_staff: 'Marga Staff',
    branch_user: 'Branch / Department User',
    branch_manager: 'Branch Manager',
    end_user: 'End User',
    tech: 'Technician'
  };
  return map[role] || role || 'User';
}
