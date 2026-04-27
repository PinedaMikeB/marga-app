const KEY = 'msp_session_v1';

export function saveSession(user) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function loadSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to parse session', error);
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function roleLabel(role) {
  const map = {
    corporate_admin: 'Corporate Admin',
    branch_manager: 'Branch Manager',
    end_user: 'End User',
    tech: 'Technician'
  };
  return map[role] || role || 'User';
}
