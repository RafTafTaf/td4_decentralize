import { webcrypto } from "crypto";

// #############
// ### Utils ###
// #############

// Function to convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

// Function to convert Base64 string to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buff = Buffer.from(base64, "base64");
  return buff.buffer.slice(buff.byteOffset, buff.byteOffset + buff.byteLength);
}

// ################
// ### RSA keys ###
// ################

type GenerateRsaKeyPair = {
  publicKey: webcrypto.CryptoKey;
  privateKey: webcrypto.CryptoKey;
};

export async function generateRsaKeyPair(): Promise<GenerateRsaKeyPair> {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
  return keyPair;
}

export async function exportPubKey(key: webcrypto.CryptoKey): Promise<string> {
  const exportedKey = await webcrypto.subtle.exportKey("spki", key);
  return arrayBufferToBase64(exportedKey);
}

export async function exportPrvKey(key: webcrypto.CryptoKey): Promise<string | null> {
  if (!key) return null;
  const exportedKey = await webcrypto.subtle.exportKey("pkcs8", key);
  return arrayBufferToBase64(exportedKey);
}

export async function importPubKey(strKey: string): Promise<webcrypto.CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(strKey);
  return await webcrypto.subtle.importKey(
    "spki",
    keyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

export async function importPrvKey(strKey: string): Promise<webcrypto.CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(strKey);
  return await webcrypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

export async function rsaEncrypt(b64Data: string, strPublicKey: string): Promise<string> {
  const publicKey = await importPubKey(strPublicKey);
  const dataBuffer = base64ToArrayBuffer(b64Data);
  const encryptedBuffer = await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, dataBuffer);
  return arrayBufferToBase64(encryptedBuffer);
}

export async function rsaDecrypt(data: string, privateKey: webcrypto.CryptoKey): Promise<string> {
  const encryptedBuffer = base64ToArrayBuffer(data);
  const decryptedBuffer = await webcrypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedBuffer);
  return arrayBufferToBase64(decryptedBuffer);
}

// ######################
// ### Symmetric keys ###
// ######################

export async function createRandomSymmetricKey(): Promise<webcrypto.CryptoKey> {
  return await webcrypto.subtle.generateKey(
    {
      name: "AES-CBC",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportSymKey(key: webcrypto.CryptoKey): Promise<string> {
  const exportedKey = await webcrypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exportedKey);
}

export async function importSymKey(strKey: string): Promise<webcrypto.CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(strKey);
  return await webcrypto.subtle.importKey("raw", keyBuffer, { name: "AES-CBC" }, true, ["encrypt", "decrypt"]);
}

export async function symEncrypt(key: webcrypto.CryptoKey, data: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const encryptedBuffer = await webcrypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv: iv,
    },
    key,
    encoder.encode(data)
  );
  const combinedBuffer = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combinedBuffer.set(iv, 0);
  combinedBuffer.set(new Uint8Array(encryptedBuffer), iv.length);
  return arrayBufferToBase64(combinedBuffer.buffer);
}

export async function symDecrypt(strKey: string, encryptedData: string): Promise<string> {
  const key = await importSymKey(strKey);
  const encryptedBuffer = base64ToArrayBuffer(encryptedData);
  const iv = encryptedBuffer.slice(0, 16);
  const ciphertext = encryptedBuffer.slice(16);
  const decryptedBuffer = await webcrypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(iv) }, key, ciphertext);
  return new TextDecoder().decode(decryptedBuffer);
}
