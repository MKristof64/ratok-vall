interface AuthPreparedStatement {
  bind(...values: unknown[]): AuthPreparedStatement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}

export interface AuthDatabase {
  prepare(query: string): AuthPreparedStatement;
}

export interface AuthEnv {
  APP_PASSWORD_VERIFIER?: string;
  APP_SESSION_SECRET?: string;
  DB?: AuthDatabase;
}

export type AuthSession =
  | { kind: "guest" }
  | { kind: "account"; accountId: string };

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

type AccountCredentials = {
  email: string;
  password: string;
};

type LegacySessionPayload = {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
};

type SessionPayloadV2 = {
  v: 2;
  kind: "guest" | "account";
  accountId?: string;
  iat: number;
  exp: number;
  nonce: string;
};

type StoredAccount = {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
};

type PublicAccount = Pick<StoredAccount, "id" | "email">;

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
// Cloudflare Workers Web Crypto currently accepts PBKDF2 iteration counts up
// to 100,000. Keep verifier parsing pinned to that supported value so a bad
// record or secret fails closed instead of crashing the Worker at runtime.
const PASSWORD_ITERATIONS = 100_000;
const ACCOUNT_PASSWORD_ITERATIONS = PASSWORD_ITERATIONS;
const ACCOUNT_PASSWORD_MIN_CHARACTERS = 12;
const ACCOUNT_PASSWORD_SALT_BYTES = 16;
const MAX_COOKIE_LENGTH = 2_048;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_REQUEST_BODY_BYTES = 4_096;

const LOGIN_RATE_LIMIT = 6;
const LOGIN_RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_ENTRIES = 2_048;
const rateLimitEntries = new Map<string, RateLimitEntry>();
let rateLimitCalls = 0;

const accountSchemaPromises = new WeakMap<object, Promise<void>>();

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

  if (url.pathname === "/api/auth/register") {
    return handleRegisterRequest(request, env);
  }

  if (url.pathname === "/api/auth/login") {
    return handleAccountLoginRequest(request, env);
  }

  if (url.pathname === "/api/auth/me") {
    return handleMeRequest(request, env);
  }

  if (
    url.pathname === "/api/auth/lock" ||
    url.pathname === "/api/auth/logout"
  ) {
    return handleLockRequest(request);
  }

  return null;
}

export async function hasValidSession(
  request: Request,
  env: AuthEnv,
): Promise<boolean> {
  return (await getValidSession(request, env)) !== null;
}

export async function getValidSession(
  request: Request,
  env: AuthEnv,
): Promise<AuthSession | null> {
  const session = await readSignedSession(request, env);
  if (!session || session.kind === "guest") return session;

  if (!env.DB) return null;
  try {
    await ensureAccountSchema(env.DB);
    return (await findAccountById(env.DB, session.accountId)) ? session : null;
  } catch {
    return null;
  }
}

async function readSignedSession(
  request: Request,
  env: AuthEnv,
): Promise<AuthSession | null> {
  const secret = validSessionSecret(env.APP_SESSION_SECRET);
  if (!secret) return null;

  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  if (!cookieValue || cookieValue.length > MAX_COOKIE_LENGTH) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = decodeBase64Url(encodedSignature);
  } catch {
    return null;
  }

  const key = await sessionKey(secret);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(encodedPayload),
  );
  if (!validSignature) return null;

  let payload: LegacySessionPayload | SessionPayloadV2;
  try {
    payload = JSON.parse(
      decoder.decode(decodeBase64Url(encodedPayload)),
    ) as LegacySessionPayload | SessionPayloadV2;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1_000);
  const validLifetime =
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp) &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 22 &&
    payload.iat <= now + SESSION_CLOCK_SKEW_SECONDS &&
    payload.exp > now &&
    payload.exp - payload.iat <=
      SESSION_TTL_SECONDS + SESSION_CLOCK_SKEW_SECONDS;
  if (!validLifetime) return null;

  if (payload.v === 1) return { kind: "guest" };
  if (payload.v !== 2) return null;

  if (payload.kind === "guest" && payload.accountId === undefined) {
    return { kind: "guest" };
  }
  if (
    payload.kind === "account" &&
    typeof payload.accountId === "string" &&
    isValidAccountId(payload.accountId)
  ) {
    return { kind: "account", accountId: payload.accountId };
  }
  return null;
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
  const rateLimit = await takeAuthRateLimit(request, secret, "guest-unlock");
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

  const session = await createSessionCookie(secret, { kind: "guest" });
  if (payload.respondsWithJson) {
    return secureJsonResponse(
      { ok: true, redirectTo: payload.returnTo },
      { headers: { "Set-Cookie": session } },
    );
  }

  return secureRedirect(payload.returnTo, 303, { "Set-Cookie": session });
}

async function handleRegisterRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isSameOriginMutation(request)) return forbiddenResponse();

  const secret = validSessionSecret(env.APP_SESSION_SECRET);
  if (!secret || !env.DB) return authenticationUnavailableResponse();

  const currentSession = await readSignedSession(request, env);
  if (!currentSession) return unauthorizedApiResponse();
  if (currentSession.kind !== "guest") {
    return secureJsonResponse(
      { error: "guest_session_required" },
      { status: 403 },
    );
  }

  const rateLimit = await takeAuthRateLimit(request, secret, "account-register");
  if (!rateLimit.allowed) {
    return rateLimitedResponse(request, rateLimit.retryAfterSeconds);
  }

  let credentials: AccountCredentials;
  try {
    credentials = await readAccountCredentials(request);
  } catch (error) {
    return accountPayloadErrorResponse(error);
  }

  const email = normalizeEmail(credentials.email);
  if (!email) {
    return secureJsonResponse(
      { error: "invalid_email", message: "Adj meg egy érvényes e-mail-címet." },
      { status: 400 },
    );
  }
  if (!isValidNewAccountPassword(credentials.password)) {
    return secureJsonResponse(
      {
        error: "weak_password",
        message: `A jelszó legalább ${ACCOUNT_PASSWORD_MIN_CHARACTERS} karakter legyen.`,
      },
      { status: 400 },
    );
  }

  const salt = new Uint8Array(ACCOUNT_PASSWORD_SALT_BYTES);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePasswordHash(
    credentials.password,
    salt,
    ACCOUNT_PASSWORD_ITERATIONS,
    32,
  );
  const accountId = crypto.randomUUID();

  try {
    await ensureAccountSchema(env.DB);
    await env.DB.prepare(
      `INSERT INTO accounts
        (id, email, password_hash, password_salt, password_iterations)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        accountId,
        email,
        encodeBase64(passwordHash),
        encodeBase64(salt),
        ACCOUNT_PASSWORD_ITERATIONS,
      )
      .run();
  } catch (error) {
    if (isUniqueEmailError(error)) {
      return secureJsonResponse(
        { error: "account_exists", message: "Ehhez az e-mail-címhez már tartozik fiók." },
        { status: 409 },
      );
    }
    return databaseUnavailableResponse();
  }

  rateLimitEntries.delete(rateLimit.key);
  const session = await createSessionCookie(secret, {
    kind: "account",
    accountId,
  });
  return secureJsonResponse(
    {
      ok: true,
      authenticated: true,
      kind: "account",
      account: { id: accountId, email },
    },
    { status: 201, headers: { "Set-Cookie": session } },
  );
}

async function handleAccountLoginRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isSameOriginMutation(request)) return forbiddenResponse();

  const secret = validSessionSecret(env.APP_SESSION_SECRET);
  if (!secret || !env.DB) return authenticationUnavailableResponse();

  const rateLimit = await takeAuthRateLimit(request, secret, "account-login");
  if (!rateLimit.allowed) {
    return rateLimitedResponse(request, rateLimit.retryAfterSeconds);
  }

  let credentials: AccountCredentials;
  try {
    credentials = await readAccountCredentials(request);
  } catch (error) {
    return accountPayloadErrorResponse(error);
  }

  const email = normalizeEmail(credentials.email);
  const candidateWithinLimit =
    encoder.encode(credentials.password).byteLength <= MAX_PASSWORD_BYTES;

  let account: StoredAccount | null;
  try {
    await ensureAccountSchema(env.DB);
    // Query even for malformed addresses so account existence cannot be
    // inferred from the presence or absence of a database round trip.
    account = await findAccountByEmail(
      env.DB,
      email ?? "invalid-login-address@invalid.invalid",
    );
  } catch {
    return databaseUnavailableResponse();
  }

  const accountVerifier =
    email && candidateWithinLimit && account
      ? parseAccountVerifier(account)
      : null;
  const verifier = accountVerifier ?? dummyAccountVerifier();
  const passwordMatches = await verifyPassword(
    candidateWithinLimit ? credentials.password : "",
    verifier,
  );

  if (!account || !accountVerifier || !passwordMatches || !email) {
    return invalidAccountCredentialsResponse();
  }

  rateLimitEntries.delete(rateLimit.key);
  const session = await createSessionCookie(secret, {
    kind: "account",
    accountId: account.id,
  });
  return secureJsonResponse(
    {
      ok: true,
      authenticated: true,
      kind: "account",
      account: { id: account.id, email: account.email },
    },
    { headers: { "Set-Cookie": session } },
  );
}

async function handleMeRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");

  const session = await readSignedSession(request, env);
  if (!session) {
    return unauthorizedApiResponse();
  }
  if (session.kind === "guest") {
    return secureJsonResponse({
      authenticated: true,
      kind: "guest",
      account: null,
    });
  }
  if (!env.DB) return databaseUnavailableResponse();

  let account: PublicAccount | null;
  try {
    await ensureAccountSchema(env.DB);
    account = await findAccountById(env.DB, session.accountId);
  } catch {
    return databaseUnavailableResponse();
  }

  if (!account) {
    return secureJsonResponse(
      { error: "unauthorized" },
      {
        status: 401,
        headers: {
          "Set-Cookie": expiredSessionCookie(),
          "WWW-Authenticate": 'Session realm="mondat"',
        },
      },
    );
  }
  return secureJsonResponse({
    authenticated: true,
    kind: "account",
    account: { id: account.id, email: account.email },
  });
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
  const candidateHash = await derivePasswordHash(
    candidate,
    verifier.salt,
    verifier.iterations,
    verifier.hash.byteLength,
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

async function derivePasswordHash(
  candidate: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  outputBytes: number,
): Promise<ArrayBuffer> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(candidate),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    sourceKey,
    outputBytes * 8,
  );
}

function parsePasswordVerifier(value: string | undefined): PasswordVerifier | null {
  if (!value || value.length > 2_048) return null;

  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;

  const iterations = Number(parts[1]);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations !== PASSWORD_ITERATIONS
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

function parseAccountVerifier(account: StoredAccount): PasswordVerifier | null {
  if (
    !Number.isSafeInteger(account.passwordIterations) ||
    account.passwordIterations !== ACCOUNT_PASSWORD_ITERATIONS
  ) {
    return null;
  }

  try {
    const salt = decodeBase64(account.passwordSalt);
    const hash = decodeBase64(account.passwordHash);
    if (salt.byteLength < ACCOUNT_PASSWORD_SALT_BYTES || hash.byteLength !== 32) {
      return null;
    }
    return {
      iterations: account.passwordIterations,
      salt,
      hash: exactArrayBuffer(hash),
    };
  } catch {
    return null;
  }
}

function dummyAccountVerifier(): PasswordVerifier {
  return {
    iterations: ACCOUNT_PASSWORD_ITERATIONS,
    salt: decodeBase64("AAECAwQFBgcICQoLDA0ODw=="),
    hash: exactArrayBuffer(
      decodeBase64("EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8="),
    ),
  };
}

async function ensureAccountSchema(db: AuthDatabase): Promise<void> {
  const key = db as object;
  const existing = accountSchemaPromises.get(key);
  if (existing) return existing;

  const setup = (async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email
         ON accounts (email)`,
      )
      .run();
  })();

  accountSchemaPromises.set(key, setup);
  try {
    await setup;
  } catch (error) {
    accountSchemaPromises.delete(key);
    throw error;
  }
}

async function findAccountByEmail(
  db: AuthDatabase,
  email: string,
): Promise<StoredAccount | null> {
  return db
    .prepare(
      `SELECT
        id,
        email,
        password_hash AS passwordHash,
        password_salt AS passwordSalt,
        password_iterations AS passwordIterations
       FROM accounts
       WHERE email = ?
       LIMIT 1`,
    )
    .bind(email)
    .first<StoredAccount>();
}

async function findAccountById(
  db: AuthDatabase,
  accountId: string,
): Promise<PublicAccount | null> {
  return db
    .prepare(
      `SELECT id, email
       FROM accounts
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(accountId)
    .first<PublicAccount>();
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (normalized.length < 3 || normalized.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return null;
  return normalized;
}

function isValidNewAccountPassword(value: string): boolean {
  return (
    Array.from(value).length >= ACCOUNT_PASSWORD_MIN_CHARACTERS &&
    encoder.encode(value).byteLength <= MAX_PASSWORD_BYTES
  );
}

function isValidAccountId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isUniqueEmailError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UNIQUE constraint failed: accounts.email") ||
    message.includes("idx_accounts_email")
  );
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

async function createSessionCookie(
  secret: string,
  session: AuthSession,
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const nonce = new Uint8Array(18);
  crypto.getRandomValues(nonce);

  const payload: SessionPayloadV2 = {
    v: 2,
    kind: session.kind,
    ...(session.kind === "account" ? { accountId: session.accountId } : {}),
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

async function takeAuthRateLimit(
  request: Request,
  secret: string,
  scope: "guest-unlock" | "account-register" | "account-login",
): Promise<{ allowed: boolean; key: string; retryAfterSeconds: number }> {
  const rawAddress = request.headers.get("CF-Connecting-IP") ?? "local-or-unknown";
  const digest = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(secret),
    encoder.encode(`auth-rate:${scope}:${rawAddress}`),
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

async function readAccountCredentials(
  request: Request,
): Promise<AccountCredentials> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const json = JSON.parse(await readLimitedText(request)) as {
      email?: unknown;
      password?: unknown;
    };
    if (typeof json.email !== "string" || typeof json.password !== "string") {
      throw new Error("Invalid credentials payload");
    }
    return { email: json.email, password: json.password };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await readLimitedText(request));
    const email = form.get("email");
    const password = form.get("password");
    if (email === null || password === null) {
      throw new Error("Invalid credentials payload");
    }
    return { email, password };
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

function accountPayloadErrorResponse(error: unknown): Response {
  if (error instanceof PayloadTooLargeError) {
    return secureJsonResponse({ error: "payload_too_large" }, { status: 413 });
  }
  return secureJsonResponse({ error: "invalid_request" }, { status: 400 });
}

function authenticationUnavailableResponse(): Response {
  return secureJsonResponse(
    { error: "authentication_unavailable" },
    { status: 503, headers: { "Retry-After": "60" } },
  );
}

function databaseUnavailableResponse(): Response {
  return secureJsonResponse(
    { error: "account_storage_unavailable" },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

function invalidAccountCredentialsResponse(): Response {
  return secureJsonResponse(
    {
      error: "invalid_credentials",
      message: "Az e-mail-cím vagy a jelszó hibás.",
    },
    { status: 401 },
  );
}

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
  const pathname = new URL(request.url).pathname;
  if (
    wantsJson(request) ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/register"
  ) {
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

function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  return encodeBase64(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
