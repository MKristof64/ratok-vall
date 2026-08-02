const PUBLIC_ALIAS_ORIGIN = "https://ratokvall-jatek.pages.dev";
const UPSTREAM_ORIGIN = "https://ratok-vall.kristof-madarasz159.chatgpt.site";
const SESSION_COOKIE_NAME = "__Host-mondat_session";
const ALIAS_CLIENT_KEY_HEADER = "x-ratok-alias-client-key";
const ALIAS_SIGNATURE_HEADER = "x-ratok-alias-signature";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RATE_LIMITED_AUTH_PATHS = new Set([
  "/api/auth/unlock",
  "/api/auth/register",
  "/api/auth/login",
]);

function securityHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function jsonError(status, code, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...securityHeaders(), ...extraHeaders },
  });
}

function misdirectedResponse() {
  return jsonError(421, "misdirected_request", "Ismeretlen alkalmazáscím.");
}

function forbiddenResponse() {
  return jsonError(403, "cross_origin_request", "Tiltott kérés.");
}

function unavailableResponse() {
  return jsonError(
    502,
    "upstream_unavailable",
    "A játék átmenetileg nem érhető el. Próbáld újra egy pillanat múlva.",
    { "Retry-After": "5" },
  );
}

function aliasConfigurationResponse() {
  return jsonError(
    503,
    "service_unavailable",
    "A bejelentkezés átmenetileg nem érhető el.",
    { "Retry-After": "30" },
  );
}

function sameOriginMutation(request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      return new URL(origin).origin === PUBLIC_ALIAS_ORIGIN;
    } catch {
      return false;
    }
  }

  return fetchSite === "same-origin";
}

function upstreamTarget(incomingUrl) {
  const targetUrl = new URL(UPSTREAM_ORIGIN);
  targetUrl.pathname = incomingUrl.pathname;
  targetUrl.search = incomingUrl.search;
  targetUrl.hash = "";

  if (targetUrl.origin !== UPSTREAM_ORIGIN) {
    throw new Error("Invalid upstream origin");
  }
  return targetUrl;
}

function stripUntrustedProxyHeaders(headers) {
  const exactNames = new Set([
    "host",
    "forwarded",
    "x-real-ip",
    "authorization",
    "proxy-authorization",
    "x-ratok-account-id",
    ALIAS_CLIENT_KEY_HEADER,
    ALIAS_SIGNATURE_HEADER,
  ]);

  for (const name of [...headers.keys()]) {
    const lowerName = name.toLowerCase();
    if (exactNames.has(lowerName) || lowerName.startsWith("x-forwarded-")) {
      headers.delete(name);
    }
  }
}

function sessionCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      return `${SESSION_COOKIE_NAME}=${item.slice(separator + 1).trim()}`;
    }
  }
  return null;
}

function encodeBase64Url(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
}

async function addAuthenticatedRateLimitKey(headers, request, targetUrl, env) {
  if (
    SAFE_METHODS.has(request.method.toUpperCase()) ||
    !RATE_LIMITED_AUTH_PATHS.has(targetUrl.pathname)
  ) {
    return true;
  }

  const secret = env?.ALIAS_PROXY_SECRET;
  const clientAddress = request.headers.get("CF-Connecting-IP")?.trim();
  if (
    typeof secret !== "string" ||
    new TextEncoder().encode(secret).byteLength < 32 ||
    !clientAddress ||
    clientAddress.length > 128
  ) {
    return false;
  }

  const clientKey = await hmac(secret, `ratok-alias-client:v1:${clientAddress}`);
  const signature = await hmac(
    secret,
    `ratok-alias-proof:v1:${clientKey}`,
  );
  headers.set(ALIAS_CLIENT_KEY_HEADER, clientKey);
  headers.set(ALIAS_SIGNATURE_HEADER, signature);
  return true;
}

async function upstreamRequest(request, incomingUrl, env) {
  const targetUrl = upstreamTarget(incomingUrl);
  const rebasedRequest = new Request(targetUrl, request);
  const headers = new Headers(rebasedRequest.headers);

  stripUntrustedProxyHeaders(headers);

  const sessionCookie = sessionCookieHeader(headers.get("Cookie"));
  headers.delete("Cookie");
  if (sessionCookie) headers.set("Cookie", sessionCookie);

  const origin = headers.get("Origin");
  if (!SAFE_METHODS.has(request.method.toUpperCase()) || origin === PUBLIC_ALIAS_ORIGIN) {
    headers.set("Origin", UPSTREAM_ORIGIN);
    headers.set("Sec-Fetch-Site", "same-origin");
  }

  if (!(await addAuthenticatedRateLimitKey(headers, request, targetUrl, env))) {
    return null;
  }

  return new Request(rebasedRequest, { headers, redirect: "manual" });
}

function aliasedLocation(location, targetUrl) {
  if (!location) return null;
  const resolved = new URL(location, targetUrl);
  if (resolved.origin !== UPSTREAM_ORIGIN) {
    throw new Error("Unexpected external redirect");
  }
  return `${PUBLIC_ALIAS_ORIGIN}${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const cookie = headers.get("Set-Cookie");
  return cookie ? [cookie] : [];
}

function allowedSessionSetCookie(cookie) {
  const parts = cookie.split(";").map((part) => part.trim());
  const separator = parts[0]?.indexOf("=") ?? -1;
  if (separator < 0 || parts[0].slice(0, separator) !== SESSION_COOKIE_NAME) {
    return false;
  }

  const attributes = new Map();
  for (const part of parts.slice(1)) {
    const attributeSeparator = part.indexOf("=");
    const name = (attributeSeparator < 0 ? part : part.slice(0, attributeSeparator))
      .trim()
      .toLowerCase();
    const value = attributeSeparator < 0 ? "" : part.slice(attributeSeparator + 1).trim();
    attributes.set(name, value);
  }

  return (
    !attributes.has("domain") &&
    attributes.get("path") === "/" &&
    attributes.has("secure") &&
    attributes.has("httponly") &&
    attributes.get("samesite")?.toLowerCase() === "lax"
  );
}

function responseHeaders(upstreamResponse, incomingUrl, targetUrl) {
  const headers = new Headers(upstreamResponse.headers);
  const sessionCookies = getSetCookies(upstreamResponse.headers).filter(
    allowedSessionSetCookie,
  );
  headers.delete("Set-Cookie");
  for (const cookie of sessionCookies) headers.append("Set-Cookie", cookie);

  const location = aliasedLocation(headers.get("Location"), targetUrl);
  if (location) headers.set("Location", location);

  const contentType = headers.get("Content-Type")?.toLowerCase() ?? "";
  if (
    sessionCookies.length > 0 ||
    incomingUrl.pathname.startsWith("/api/") ||
    contentType.includes("text/html") ||
    headers.has("Location")
  ) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.delete("Expires");
  }

  return headers;
}

export async function handleAliasRequest(request, env = {}, upstreamFetch = fetch) {
  const incomingUrl = new URL(request.url);
  if (incomingUrl.origin !== PUBLIC_ALIAS_ORIGIN) return misdirectedResponse();
  if (!sameOriginMutation(request)) return forbiddenResponse();

  try {
    const targetUrl = upstreamTarget(incomingUrl);
    const forwardedRequest = await upstreamRequest(request, incomingUrl, env);
    if (!forwardedRequest) return aliasConfigurationResponse();

    const upstreamResponse = await upstreamFetch(forwardedRequest);
    const headers = responseHeaders(upstreamResponse, incomingUrl, targetUrl);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch {
    return unavailableResponse();
  }
}

const worker = {
  fetch(request, env) {
    return handleAliasRequest(request, env);
  },
};

export default worker;
