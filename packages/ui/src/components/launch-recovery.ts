const algorithm = { name: 'RSA-OAEP', hash: 'SHA-256' };

const bytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const base64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));

export interface OwnerRecoveryKey { publicKey: string; privateKey: string }

export async function createOwnerKey(): Promise<OwnerRecoveryKey> {
  const keys = await crypto.subtle.generateKey({ ...algorithm, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  return {
    publicKey: base64(await crypto.subtle.exportKey('spki', keys.publicKey)),
    privateKey: base64(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
  };
}

export async function recoverOwnerFile(key: OwnerRecoveryKey, encrypted: string) {
  const privateKey = await crypto.subtle.importKey('pkcs8', bytes(key.privateKey), algorithm, false, ['decrypt']);
  const data = await crypto.subtle.decrypt(algorithm, privateKey, bytes(encrypted));
  return new TextDecoder().decode(data);
}

export async function sealOwnerRecovery(publicKey: string, contents: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  if (contents.byteLength > 300) throw new Error('Choose the OpenBao recovery file');
  const key = await crypto.subtle.importKey('spki', bytes(publicKey), algorithm, false, ['encrypt']);
  return base64(await crypto.subtle.encrypt(algorithm, key, contents));
}
