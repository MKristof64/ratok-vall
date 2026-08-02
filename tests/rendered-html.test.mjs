import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const projectRoot = new URL("../", import.meta.url);
const projectPath = fileURLToPath(projectRoot);
const serverPort = 32117;
const baseUrl = `http://127.0.0.1:${serverPort}`;
let serverProcess;
let serverOutput = "";

before(async () => {
  const cliPath = fileURLToPath(new URL("node_modules/vinext/dist/cli.js", projectRoot));
  serverProcess = spawn(
    process.execPath,
    [cliPath, "dev", "--hostname", "127.0.0.1", "--port", String(serverPort)],
    {
      cwd: projectPath,
      env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/test.log" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`The test server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/unlock`);
      if (response.ok) return;
    } catch {
      // The fixed local test endpoint is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`The test server did not become ready.\n${serverOutput}`);
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
});

test("renders the Hungarian account and guest entry page", async () => {
  const response = await fetch(`${baseUrl}/unlock`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang=["']hu["']/i);
  assert.match(html, /Rátok vall/);
  assert.match(html, /Hogyan szeretnél belépni\?/);
  assert.match(html, /Belépés fiókkal/);
  assert.match(html, /Belépés közös jelszóval/);
  assert.match(html, /előbb lépj be a közös jelszóval/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/i);
});

test("protects browser pages and APIs before a valid session", async () => {
  const pageResponse = await fetch(`${baseUrl}/`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(pageResponse.status, 302);
  assert.equal(pageResponse.headers.get("location"), "/unlock?returnTo=%2F");

  const apiResponse = await fetch(`${baseUrl}/api/rooms/${"a".repeat(43)}`, {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  assert.equal(apiResponse.status, 401);
  assert.deepEqual(await apiResponse.json(), { error: "unauthorized" });
  assert.match(apiResponse.headers.get("cache-control") ?? "", /no-store/i);
});

test("removes the starter preview and legacy provider auth surface", async () => {
  const [page, layout, accountPage, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("app/account/page.tsx", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(page, /Rátok vall|Egy mondat/);
  assert.match(page, /AccountLink/);
  assert.match(layout, /lang="hu"/);
  assert.match(accountPage, /AccountClient/);
  assert.doesNotMatch(page, /_sites-preview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)),
  );
  await assert.rejects(access(new URL("app/chatgpt-auth.ts", projectRoot)));
});

test("removes the two retired homepage sections and their styles", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  assert.doesNotMatch(
    page,
    /how-it-works|privacy-note|Három egyszerű lépés|A mondat számít/,
  );
  assert.doesNotMatch(
    styles,
    /\.how-it-works|\.steps-grid|\.step-card|\.step-number|\.privacy-note|\.privacy-symbol/,
  );
});
