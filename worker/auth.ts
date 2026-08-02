export interface AuthEnv {
  APP_PASSWORD_VERIFIER?: string;
  APP_SESSION_SECRET?: string;
}

type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
};

type PasswordVerifier = {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: ArrayBuffer;
};

type UnlockPayload = {
  password: string;
  returnTo: string;
  respondsWithJson: boolean;
};

type SessionPayload = {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
};

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SESSION_COOKIE_NAME = "__Host-mondat_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_CLOCK_SKEW_SECONDS = 60;
const SESSION_SECRET_MIN_BYTES = 32;
const MIN_PASSWORD_ITERATIONS = 100_000;
const MAX_COOKIE_LENGTH = 2_048;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_REQUEST_BODY_BYTES = 4_096;

const LOGIN_RATE_LIMIT = 6;
const LOGIN_RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_ENTRIES = 2_048;
const rateLimitEntries = new Map<string, RateLimitEntry>();
let rateLimitCalls = 0;

let cachedSessionSecret: string | undefined;
let cachedSessionKey: Promise<CryptoKey> | undefined;

export async function handleAuthRoute(
  request: Request,
  env: AuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/auth/unlock") {
    return handleUnlockRequest(request, env);
  }

  if (url.pathname === "/api/auth/lock") {
    return handleLockRequest(request);
  }

  return null;
}

export async function hasValidSession(
  request: Request,
  env: AuthEnv,
): Promise<boolean> {
  const secret = validSessionSecret(env.APP_SESSION_SECRET);
  if (!secret) return false;

  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  if (!cookieValue || cookieValue.length > MAX_COOKIE_LENGTH) return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return false;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = decodeBase64Url(encodedSignature);
  } catch {
    return false;
  }

  const key = await sessionKey(secret);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(encodedPayload),
  );
  if (!validSignature) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload))) as SessionPayload;
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1_000);
  return (
    payload.v === 1 &&
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp) &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 22 &&
    payload.iat <= now + SESSION_CLOCK_SKEW_SECONDS &&
    payload.exp > now &&
    payload.exp - payload.iat <=
      SESSION_TTL_SECONDS + SESSION_CLOCK_SKEW_SECONDS
  );
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isPublicVinextAsset(pathname: string): boolean {
  return (
    // Production Vinext emits the unlock page's browser bundle and local
    // fonts below /assets. Keep framework-static paths explicit so a future
    // dynamic /_vinext endpoint cannot accidentally bypass authentication.
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_vinext/static/") ||
    // Vite development runtime endpoints. These paths do not exist in the
    // production asset bundle, but must stay reachable before authentication
    // so the /unlock page can hydrate during local development.
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/node_modules/.vite/") ||
    pathname === "/@react-refresh" ||
    pathname === "/__vite_ping" ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/robots.txt"
  );
}

export function unauthorizedApiResponse(): Response {
  return secureJsonResponse(
    { error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Session realm="mondat"' },
    },
  );
}

export function unlockRedirect(requestUrl: URL): Response {
  const returnTo = safeReturnTo(`${requestUrl.pathname}${requestUrl.search}`);
  const location = `/unlock?returnTo=${encodeURIComponent(returnTo)}`;
  return secureRedirect(location, 302);
}

export function secureApplicationResponse(response: Response): Response {
  return withSecurityHeaders(response, true);
}

export function securePublicAssetResponse(response: Response): Response {
  return withSecurityHeaders(response, false);
}

async function handleUnlockRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isSameOriginMutation(request)) return forbiddenResponse();

  const verifier = parsePasswordVerifier(env.APP_PASSWORD_VERIFIER);
  const secret = validSessionSecret(env.APP_SESSION_SECRET);
  if (!verifier || !secret) {
    return secureJsonResponse(
      { error: "authentication_unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  // This limiter executes before reading the request body and before the
  // deliberately expensive PBKDF2 operation. Only a keyed digest of the
  // address is retained in this isolate for one short window.
  const rateLimit = await takeLoginRateLimit(request, secret);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(request, rateLimit.retryAfterSeconds);
  }

  let payload: UnlockPayload;
  try {
    payload = await readUnlockPayload(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return secureJsonResponse({ error: "payload_too_large" }, { status: 413 });
    }
    return secureJsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  if (encoder.encode(payload.password).byteLength > MAX_PASSWORD_BYTES) {
    return invalidPasswordResponse(payload);
  }

  const passwordMatches = await verifyPassword(payload.password, verifier);
  if (!passwordMatches) return invalidPasswordResponse(payload);

  rateLimitEntries.delete(rateLimit.key);

  const session = await createSessionCookie(secret);
  if (payload.respondsWithJson) {
    return secureJsonResponse(
      { ok: true, redirectTo: payload.returnTo },
      { headers: { "Set-Cookie": session } },
    );
  }

  return secureRedirect(payload.returnTo, 303, { "Set-Cookie": session });
}

async function handleLockRequest(request: Request): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") {
    return methodNotAllowed("POST, DELETE");
  }
  if (!isSameOriginMutation(request)) return forbiddenResponse();

  const clearCookie = expiredSessionCookie();
  const respondsWithJson = request.method === "DELETE" || wantsJson(request);
  if (respondsWithJson) {
    return secureJsonResponse(
      { ok: true },
      { headers: { "Set-Cookie": clearCookie } },
    );
  }

  return secureRedirect("/unlock", 303, { "Set-Cookie": clearCookie });
}

async function verifyPassword(
  candidate: string,
  verifier: PasswordVerifier,
): Promise<boolean> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(candidate),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const candidateHash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: verifier.salt,
      iterations: verifier.iterations,
    },
    sourceKey,
    verifier.hash.byteLength * 8,
  );

  const subtle = crypto.subtle as Partial<TimingSafeSubtleCrypto> & SubtleCrypto;
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(candidateHash, verifier.hash);
  }

  // Node's local Web Crypto runtime does not expose Cloudflare's extension.
  // Keep localhost usable while production Workers use timingSafeEqual above.
  const candidateBytes = new Uint8Array(candidateHash);
  const expectedBytes = new Uint8Array(verifier.hash);
  let difference = candidateBytes.byteLength ^ expectedBytes.byteLength;
  for (let index = 0; index < candidateBytes.byteLength; index += 1) {
    difference |= candidateBytes[index] ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

function parsePasswordVerifier(value: string | undefined): PasswordVerifier | null {
  if (!value || value.length > 2_048) return null;

  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;

  const iterations = Number(parts[1]);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_PASSWORD_ITERATIONS ||
    iterations > 10_000_000
  ) {
    return null;
  }

  try {
    const salt = decodeBase64(parts[2]);
    const hash = decodeBase64(parts[3]);
    if (salt.byteLength < 16 || hash.byteLength !== 32) return null;

    return {
      iterations,
      salt,
      hash: exactArrayBuffer(hash),
    };
  } catch {
    return null;
  }
}

function validSessionSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (encoder.encode(value).byteLength < SESSION_SECRET_MIN_BYTES) return null;
  return value;
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  if (cachedSessionSecret !== secret || !cachedSessionKey) {
    cachedSessionSecret = secret;
    cachedSessionKey = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return cachedSessionKey;
}

async function createSessionCookie(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const nonce = new Uint8Array(18);
  crypto.getRandomValues(nonce);

  const payload: SessionPayload = {
    v: 1,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: encodeBase64Url(nonce),
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(secret),
    encoder.encode(encodedPayload),
  );

  return serializeSessionCookie(
    `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`,
    SESSION_TTL_SECONDS,
  );
}

function expiredSessionCookie(): string {
  return serializeSessionCookie("", 0);
}

function serializeSessionCookie(value: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

async function takeLoginRateLimit(
  request: Request,
  secret: string,
): Promise<{ allowed: boolean; key: string; retryAfterSeconds: number }> {
  const rawAddress = request.headers.get("CF-Connecting-IP") ?? "local-or-unknown";
  const digest = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(secret),
    encoder.encode(`login-rate:${rawAddress}`),
  );
  const key = encodeBase64Url(new Uint8Array(digest));
  const now = Date.now();

  rateLimitCalls += 1;
  if (rateLimitCalls % 64 === 0 || rateLimitEntries.size >= MAX_RATE_LIMIT_ENTRIES) {
    pruneRateLimitEntries(now);
  }

  const current = rateLimitEntries.get(key);
  const entry =
    current && now - current.windowStartedAt < LOGIN_RATE_WINDOW_MS
      ? current
      : { count: 0, windowStartedAt: now };

  entry.count += 1;
  rateLimitEntries.set(key, entry);

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((entry.windowStartedAt + LOGIN_RATE_WINDOW_MS - now) / 1_000),
  );
  return {
    allowed: entry.count <= LOGIN_RATE_LIMIT,
    key,
    retryAfterSeconds,
  };
}

function pruneRateLimitEntries(now: number): void {
  for (const [key, entry] of rateLimitEntries) {
    if (now - entry.windowStartedAt >= LOGIN_RATE_WINDOW_MS) {
      rateLimitEntries.delete(key);
    }
  }

  while (rateLimitEntries.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = rateLimitEntries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateLimitEntries.delete(oldestKey);
  }
}

async function readUnlockPayload(request: Request): Promise<UnlockPayload> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const text = await readLimitedText(request);
    const json = JSON.parse(text) as { password?: unknown; returnTo?: unknown };
    if (typeof json.password !== "string") throw new Error("Invalid password");
    return {
      password: json.password,
      returnTo: safeReturnTo(typeof json.returnTo === "string" ? json.returnTo : "/"),
      respondsWithJson: true,
    };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await readLimitedText(request));
    const password = form.get("password");
    const returnTo = form.get("returnTo");
    if (password === null) throw new Error("Invalid password");
    return {
      password,
      returnTo: safeReturnTo(returnTo ?? "/"),
      respondsWithJson: false,
    };
  }

  throw new Error("Unsupported content type");
}

async function readLimitedText(request: Request): Promise<string> {
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  return text;
}

class PayloadTooLargeError extends Error {}

function invalidPasswordResponse(payload: UnlockPayload): Response {
  if (payload.respondsWithJson) {
    return secureJsonResponse(
      {
        error: "A jelszó nem megfelelő. Próbáld újra.",
        code: "invalid_credentials",
      },
      { status: 401 },
    );
  }

  const location = `/unlock?error=invalid&returnTo=${encodeURIComponent(payload.returnTo)}`;
  return secureRedirect(location, 303);
}

function rateLimitedResponse(request: Request, retryAfterSeconds: number): Response {
  const headers = { "Retry-After": String(retryAfterSeconds) };
  if (wantsJson(request)) {
    return secureJsonResponse(
      {
        error: "Túl sok próbálkozás. Várj egy percet.",
        code: "rate_limited",
      },
      { status: 429, headers },
    );
  }
  return secureRedirect("/unlock?error=rate", 303, headers);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

function wantsJson(request: Request): boolean {
  return (
    request.headers.get("Accept")?.includes("application/json") === true ||
    request.headers.get("Content-Type")?.includes("application/json") === true
  );
}

function isSameOriginMutation(request: Request): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  // Modern same-origin form submissions and fetches send either Origin or
  // Fetch Metadata. Fail closed for clients that provide neither signal.
  return fetchSite === "same-origin";
}

function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const parsed = new URL(value, "https://mondat.invalid");
    if (parsed.origin !== "https://mondat.invalid") return "/";
    if (
      parsed.pathname === "/unlock" ||
      parsed.pathname === "/unlock/" ||
      parsed.pathname.startsWith("/api/auth/")
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!value || value.length > 1_024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Invalid base64");
  }
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || value.length > MAX_COOKIE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function exactArrayBuffer(value: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function methodNotAllowed(allow: string): Response {
  return secureJsonResponse(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: allow } },
  );
}

function forbiddenResponse(): Response {
  return secureJsonResponse({ error: "forbidden" }, { status: 403 });
}

function secureJsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return withSecurityHeaders(
    new Response(JSON.stringify(value), { ...init, headers }),
    true,
  );
}

function secureRedirect(
  location: string,
  status: 302 | 303,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Location", location);
  return withSecurityHeaders(new Response(null, { status, headers }), true);
}

function withSecurityHeaders(response: Response, noStore: boolean): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (noStore) {
    secured.headers.set("Cache-Control", "no-store, max-age=0");
    secured.headers.set("Pragma", "no-cache");
    secured.headers.set("Expires", "0");
  }
  return secured;
}
