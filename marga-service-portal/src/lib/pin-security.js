import { digitsOnly } from './utils.js';

export function validatePinFormat(pin) {
  const clean = digitsOnly(pin);
  if (!/^\d{4,6}$/.test(clean)) {
    throw new Error('PIN must be 4 to 6 digits.');
  }
  return clean;
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashSignerPin(signerId, pin) {
  const cleanPin = validatePinFormat(pin);
  return sha256Hex(`${signerId}:${cleanPin}`);
}

export function lockStatus(lockedUntil) {
  if (!lockedUntil) return { locked: false, remainingSeconds: 0 };
  const ms = new Date(lockedUntil).getTime() - Date.now();
  if (ms <= 0) return { locked: false, remainingSeconds: 0 };
  return { locked: true, remainingSeconds: Math.ceil(ms / 1000) };
}
