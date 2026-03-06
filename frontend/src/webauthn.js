// Helpers for WebAuthn buffer conversions
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function strToUint8Array(str) {
  return new TextEncoder().encode(str);
}

export function randomChallenge(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

const webauthnUtils = { bufferToBase64, strToUint8Array, randomChallenge };

export default webauthnUtils;
