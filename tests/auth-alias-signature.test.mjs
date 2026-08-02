import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAuthRoute,
  verifyAliasRateLimitKey,
} from "../worker/auth.ts";

const origin = "https://ratok-vall.kristof-madarasz159.chatgpt.site";
const aliasSecret = "origin-unit-test-alias-secret-that-is-at-least-32-bytes";
const sessionSecret = "origin-unit-test-session-secret-that-is-at-least-32-bytes";

async function hmac(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  ).toString("base64url");
}

async function validAliasHeaders() {
  const clientKey = await hmac(aliasSecret, "ratok-alias-client:v1:192.0.2.10");
  const signature = await hmac(
    aliasSecret,
    `ratok-alias-proof:v1:${clientKey}`,
  );
  return {
    "X-Ratok-Alias-Client-Key": clientKey,
    "X-Ratok-Alias-Signature": signature,
  };
}

function loginRequest(aliasHeaders = {}) {
  return new Request(`${origin}/api/auth/login`, {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "2a06:98c0:3600::103",
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      ...aliasHeaders,
    },
    body: "{}",
  });
}

function authEnv(secret = aliasSecret) {
  return {
    ALIAS_PROXY_SECRET: secret,
    APP_SESSION_SECRET: sessionSecret,
    DB: {
      prepare() {
        throw new Error("The database must not be reached for an empty login payload");
      },
    },
  };
}

function forgedSignature(signature) {
  return `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
}

test("the origin distinguishes absent, valid, and invalid alias proofs", async () => {
  assert.deepEqual(
    await verifyAliasRateLimitKey(loginRequest(), aliasSecret),
    { kind: "absent" },
  );

  const headers = await validAliasHeaders();
  const valid = await verifyAliasRateLimitKey(loginRequest(headers), aliasSecret);
  assert.equal(valid.kind, "valid");

  assert.deepEqual(
    await verifyAliasRateLimitKey(
      loginRequest({ "X-Ratok-Alias-Client-Key": headers["X-Ratok-Alias-Client-Key"] }),
      aliasSecret,
    ),
    { kind: "invalid" },
  );
  assert.deepEqual(
    await verifyAliasRateLimitKey(loginRequest(headers), `${aliasSecret}-different`),
    { kind: "invalid" },
  );
  assert.deepEqual(
    await verifyAliasRateLimitKey(
      loginRequest({
        ...headers,
        "X-Ratok-Alias-Signature": forgedSignature(
          headers["X-Ratok-Alias-Signature"],
        ),
      }),
      aliasSecret,
    ),
    { kind: "invalid" },
  );
});

test("invalid alias proofs fail closed while direct and valid requests proceed", async () => {
  const headers = await validAliasHeaders();
  const directResponse = await handleAuthRoute(loginRequest(), authEnv());
  const validResponse = await handleAuthRoute(loginRequest(headers), authEnv());
  const forgedResponse = await handleAuthRoute(
    loginRequest({
      ...headers,
      "X-Ratok-Alias-Signature": forgedSignature(
        headers["X-Ratok-Alias-Signature"],
      ),
    }),
    authEnv(),
  );
  const halfPairResponse = await handleAuthRoute(
    loginRequest({ "X-Ratok-Alias-Client-Key": headers["X-Ratok-Alias-Client-Key"] }),
    authEnv(),
  );
  const mismatchedSecretResponse = await handleAuthRoute(
    loginRequest(headers),
    authEnv(`${aliasSecret}-different`),
  );

  assert.equal(directResponse?.status, 400);
  assert.equal(validResponse?.status, 400);
  assert.equal(forgedResponse?.status, 503);
  assert.equal(halfPairResponse?.status, 503);
  assert.equal(mismatchedSecretResponse?.status, 503);
});
