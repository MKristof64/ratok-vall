import { env } from "cloudflare:workers";
import { RoomRequestError } from "@/lib/room-validation";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CIPHERTEXT_VERSION = "v1";
const AES_GCM_NONCE_BYTES = 12;
const AES_KEY_BYTES = 32;

let cachedEncodedKey: string | undefined;
let cachedKey: Promise<CryptoKey> | undefined;

function roomEncryptionSecret() {
  return (env as unknown as { ROOM_DATA_ENCRYPTION_KEY?: string })
    .ROOM_DATA_ENCRYPTION_KEY;
}

function configurationError() {
  return new RoomRequestError(
    503,
    "room_encryption_unavailable",
    "A játékadatok titkosítása jelenleg nem érhető el.",
  );
}

function unreadableDataError() {
  return new RoomRequestError(
    500,
    "room_data_unreadable",
    "A játék meghívókódja nem olvasható.",
  );
}

function decodeStandardBase64(value: string) {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw configurationError();
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw configurationError();
  }
}

function encodeBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw unreadableDataError();
  }
  try {
    const standard = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw unreadableDataError();
  }
}

async function encryptionKey() {
  const encodedKey = roomEncryptionSecret()?.trim();
  if (!encodedKey) throw configurationError();

  if (cachedEncodedKey !== encodedKey || !cachedKey) {
    const bytes = decodeStandardBase64(encodedKey);
    if (bytes.byteLength !== AES_KEY_BYTES) throw configurationError();
    cachedEncodedKey = encodedKey;
    cachedKey = crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return cachedKey;
}

function additionalData(roomId: string) {
  return encoder.encode(`ratok-room-share-code:${CIPHERTEXT_VERSION}:${roomId}`);
}

export async function encryptRoomShareCode(code: string, roomId: string) {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: additionalData(roomId),
      tagLength: 128,
    },
    await encryptionKey(),
    encoder.encode(code),
  );
  return `${CIPHERTEXT_VERSION}.${encodeBase64Url(nonce)}.${encodeBase64Url(
    new Uint8Array(encrypted),
  )}`;
}

export async function decryptRoomShareCode(
  ciphertext: string,
  roomId: string,
) {
  const parts = ciphertext.split(".");
  if (parts.length !== 3 || parts[0] !== CIPHERTEXT_VERSION) {
    throw unreadableDataError();
  }
  const nonce = decodeBase64Url(parts[1]);
  if (nonce.byteLength !== AES_GCM_NONCE_BYTES) throw unreadableDataError();

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: additionalData(roomId),
        tagLength: 128,
      },
      await encryptionKey(),
      decodeBase64Url(parts[2]),
    );
    const code = decoder.decode(decrypted);
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw unreadableDataError();
    return code;
  } catch (error) {
    if (error instanceof RoomRequestError) throw error;
    throw unreadableDataError();
  }
}
