import assert from "node:assert/strict";
import test from "node:test";
import { handleAliasRequest } from "../infrastructure/pages-alias/_worker.js";

const aliasOrigin = "https://ratokvall-jatek.pages.dev";
const upstreamOrigin = "https://ratok-vall.kristof-madarasz159.chatgpt.site";
const aliasSecret = "unit-test-alias-secret-that-is-longer-than-32-bytes";

function testEnv() {
  return { ALIAS_PROXY_SECRET: aliasSecret };
}

async function hmac(message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(aliasSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  return Buffer.from(bytes).toString("base64url");
}

test("the Pages alias safely forwards a same-origin mutation once", async () => {
  let forwardedRequest;
  let fetchCalls = 0;
  const response = await handleAliasRequest(
    new Request(`${aliasOrigin}/api/rooms?source=alias`, {
      method: "POST",
      headers: {
        Authorization: "Bearer must-not-forward",
        Cookie:
          "theme=night; __Host-mondat_session=signed.session; __cf_bm=discard-me",
        Connection: "X-Remove-Me",
        "Content-Type": "application/json",
        Forwarded: "for=attacker.example",
        Origin: aliasOrigin,
        "Proxy-Authorization": "Basic must-not-forward",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-For": "203.0.113.10",
        "X-Ratok-Account-Id": "spoofed-account",
        "X-Ratok-Alias-Client-Key": "spoofed-key",
        "X-Ratok-Alias-Signature": "spoofed-signature",
        "X-Real-IP": "203.0.113.11",
        "X-Remove-Me": "connection-scoped",
      },
      body: JSON.stringify({ title: "Teszt" }),
    }),
    testEnv(),
    async (request) => {
      fetchCalls += 1;
      forwardedRequest = request;
      return new Response(null, {
        status: 303,
        headers: { Location: `${upstreamOrigin}/account?created=1` },
      });
    },
  );

  assert.equal(fetchCalls, 1);
  assert.equal(forwardedRequest.url, `${upstreamOrigin}/api/rooms?source=alias`);
  assert.equal(forwardedRequest.headers.get("Origin"), upstreamOrigin);
  assert.equal(forwardedRequest.headers.get("Sec-Fetch-Site"), "same-origin");
  assert.equal(forwardedRequest.headers.get("Authorization"), null);
  assert.equal(forwardedRequest.headers.get("Connection"), null);
  assert.equal(forwardedRequest.headers.get("Forwarded"), null);
  assert.equal(forwardedRequest.headers.get("Proxy-Authorization"), null);
  assert.equal(forwardedRequest.headers.get("X-Forwarded-For"), null);
  assert.equal(forwardedRequest.headers.get("X-Ratok-Account-Id"), null);
  assert.equal(forwardedRequest.headers.get("X-Ratok-Alias-Client-Key"), null);
  assert.equal(forwardedRequest.headers.get("X-Ratok-Alias-Signature"), null);
  assert.equal(forwardedRequest.headers.get("X-Real-IP"), null);
  assert.equal(forwardedRequest.headers.get("X-Remove-Me"), null);
  assert.equal(
    forwardedRequest.headers.get("Cookie"),
    "__Host-mondat_session=signed.session",
  );
  assert.deepEqual(await forwardedRequest.json(), { title: "Teszt" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), `${aliasOrigin}/account?created=1`);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/i);
});

test("rate-limited auth requests carry an authenticated anonymous client key", async () => {
  let forwardedRequest;
  const response = await handleAliasRequest(
    new Request(`${aliasOrigin}/api/auth/login`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "2001:db8::42",
        "Content-Type": "application/json",
        Origin: aliasOrigin,
        "Sec-Fetch-Site": "same-origin",
        "X-Ratok-Alias-Client-Key": "client-spoof",
        "X-Ratok-Alias-Signature": "signature-spoof",
      },
      body: "{}",
    }),
    testEnv(),
    async (request) => {
      forwardedRequest = request;
      return Response.json({ ok: false }, { status: 401 });
    },
  );

  const expectedClientKey = await hmac("ratok-alias-client:v1:2001:db8::42");
  const expectedSignature = await hmac(
    `ratok-alias-proof:v1:${expectedClientKey}`,
  );
  assert.equal(
    forwardedRequest.headers.get("X-Ratok-Alias-Client-Key"),
    expectedClientKey,
  );
  assert.equal(
    forwardedRequest.headers.get("X-Ratok-Alias-Signature"),
    expectedSignature,
  );
  assert.equal(response.status, 401);
});

test("an auth mutation fails closed without the alias secret", async () => {
  let fetchCalled = false;
  const response = await handleAliasRequest(
    new Request(`${aliasOrigin}/api/auth/login`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "192.0.2.3",
        "Content-Type": "application/json",
        Origin: aliasOrigin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    }),
    {},
    async () => {
      fetchCalled = true;
      return new Response();
    },
  );

  assert.equal(fetchCalled, false);
  assert.equal(response.status, 503);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/i);
});

test("cross-origin and unverifiable mutations are rejected before forwarding", async () => {
  const rejectedHeaders = [
    { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    { Origin: "null", "Sec-Fetch-Site": "same-origin" },
    {},
  ];

  for (const headers of rejectedHeaders) {
    let fetchCalled = false;
    const response = await handleAliasRequest(
      new Request(`${aliasOrigin}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      }),
      testEnv(),
      async () => {
        fetchCalled = true;
        return new Response();
      },
    );
    assert.equal(fetchCalled, false);
    assert.equal(response.status, 403);
  }
});

test("unknown Pages hosts are rejected without an upstream request", async () => {
  let fetchCalled = false;
  const response = await handleAliasRequest(
    new Request("https://preview.ratokvall-jatek.pages.dev/unlock"),
    testEnv(),
    async () => {
      fetchCalled = true;
      return new Response();
    },
  );

  assert.equal(fetchCalled, false);
  assert.equal(response.status, 421);
});

test("network-path-looking paths can never replace the pinned upstream", async () => {
  for (const path of ["//evil.example/collect", "/%2F%2Fevil.example/collect"]) {
    let forwardedRequest;
    const response = await handleAliasRequest(
      new Request(`${aliasOrigin}${path}`),
      testEnv(),
      async (request) => {
        forwardedRequest = request;
        return new Response("ok");
      },
    );

    assert.equal(new URL(forwardedRequest.url).origin, upstreamOrigin);
    assert.equal(response.status, 200);
  }
});

test("only the secure host-only session cookie crosses the response boundary", async () => {
  const upstreamHeaders = new Headers({ "Content-Type": "application/json" });
  upstreamHeaders.append(
    "Set-Cookie",
    "__Host-mondat_session=value; Path=/; Secure; HttpOnly; SameSite=Lax",
  );
  upstreamHeaders.append(
    "Set-Cookie",
    "__cf_bm=edge-cookie; Domain=chatgpt.site; Path=/; Secure; HttpOnly",
  );
  upstreamHeaders.append(
    "Set-Cookie",
    "__Host-mondat_session=bad; Domain=chatgpt.site; Path=/; Secure; HttpOnly; SameSite=Lax",
  );

  const response = await handleAliasRequest(
    new Request(`${aliasOrigin}/api/auth/me`),
    testEnv(),
    async () => new Response(JSON.stringify({ ok: true }), { headers: upstreamHeaders }),
  );

  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^__Host-mondat_session=value;/);
  assert.doesNotMatch(cookies[0], /Domain=/i);
  assert.doesNotMatch(response.headers.get("Set-Cookie") ?? "", /__cf_bm/i);
});

test("upstream-local redirects are rebased and external redirects are blocked", async () => {
  const localLocations = [
    "/unlock?returnTo=%2F",
    `${upstreamOrigin}/account#games`,
    `//${new URL(upstreamOrigin).host}/room/ABCD`,
  ];

  for (const location of localLocations) {
    const response = await handleAliasRequest(
      new Request(`${aliasOrigin}/account`),
      testEnv(),
      async () => new Response(null, { status: 302, headers: { Location: location } }),
    );
    assert.equal(new URL(response.headers.get("Location")).origin, aliasOrigin);
  }

  const blocked = await handleAliasRequest(
    new Request(`${aliasOrigin}/account`),
    testEnv(),
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/collect" },
      }),
  );
  assert.equal(blocked.status, 502);
  assert.equal(blocked.headers.get("Location"), null);
});

test("upstream failures stay generic and non-cacheable", async () => {
  const unavailable = await handleAliasRequest(
    new Request(`${aliasOrigin}/`),
    testEnv(),
    async () => {
      throw new Error("private upstream detail");
    },
  );
  assert.equal(unavailable.status, 502);
  assert.match(unavailable.headers.get("Cache-Control") ?? "", /no-store/i);
  assert.equal(unavailable.headers.get("Retry-After"), "5");
  assert.doesNotMatch(await unavailable.text(), /private upstream detail/);
});
