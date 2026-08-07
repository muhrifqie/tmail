import { randomBytes } from 'node:crypto';

export function newId(): string {
  return randomBytes(16).toString('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function randomLocalPart(len = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export function nowMs(): number {
  return Date.now();
}
