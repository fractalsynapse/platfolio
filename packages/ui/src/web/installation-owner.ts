import { installationOwnerHash } from './installation-owner-policy.ts';

export async function createInstallationOwner() {
  const password = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) => value.toString(16).padStart(2, '0')).join('');
  const salt = crypto.getRandomValues(new Uint8Array(installationOwnerHash.saltBytes));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const verifier = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: installationOwnerHash.iterations, salt,
  }, key, installationOwnerHash.bits);
  return { password, verifier: btoa(String.fromCharCode(...new Uint8Array(verifier))), salt: btoa(String.fromCharCode(...salt)) };
}
