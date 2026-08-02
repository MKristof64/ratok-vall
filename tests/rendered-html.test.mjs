import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const projectRoot = new URL("../", import.meta.url);
const projectPath = fileURLToPath(projectRoot);
const serverPort = 32117;
const baseUrl = `http://127.0.0.1:${serverPort}`;
const serverStartupTimeoutMs = 60_000;
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

  const startupDeadline = Date.now() + serverStartupTimeoutMs;
  while (Date.now() < startupDeadline) {
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

test("uses the account as home and keeps game creation on its own route", async () => {
  const [page, newGamePage, layout, accountPage, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/new-game/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("app/account/page.tsx", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(page, /AccountClient/);
  assert.match(newGamePage, /CreateGameForm/);
  assert.match(newGamePage, /Egy mondat\. Egy ismerős\. Sok nevetés\./);
  assert.match(layout, /lang="hu"/);
  assert.match(accountPage, /AccountClient/);
  assert.doesNotMatch(newGamePage, /_sites-preview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)),
  );
  await assert.rejects(access(new URL("app/chatgpt-auth.ts", projectRoot)));
});

test("removes the two retired homepage sections and their styles", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("app/new-game/page.tsx", projectRoot), "utf8"),
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

test("keeps target choices random and the started game screen distraction free", async () => {
  const [guestRoom, hostRoom, styles, account] = await Promise.all([
    readFile(new URL("app/components/RoomGuest.tsx", projectRoot), "utf8"),
    readFile(new URL("app/components/HostRoom.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
    readFile(new URL("app/components/AccountClient.tsx", projectRoot), "utf8"),
  ]);

  assert.match(guestRoom, /shuffleWithSeed\(room\?\.participants \?\? \[\], targetOrderSeed\)/);
  assert.match(guestRoom, /randomizedParticipants\.map/);
  assert.match(guestRoom, /gameStarted \? null : \(/);
  assert.doesNotMatch(guestRoom, /host-controls-note/);
  assert.doesNotMatch(guestRoom, /A játékot a házigazda irányítja/);

  assert.match(hostRoom, /const gameStarted = room\.status !== "collecting"/);
  assert.match(hostRoom, /room\.status === "collecting" \? \(\s*<section className="danger-zone"/);
  assert.match(account, /onClick=\{\(\) => void deleteRoom\(room\.code\)\}/);

  assert.match(styles, /\.game-shell-immersive\s*\{[^}]*height: 100dvh;/s);
  assert.match(styles, /grid-template-rows: auto auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.game-shell-immersive \.reveal-card,[\s\S]*?min-height: 0;/);
});

test("confirms finishing, supports replay, and keeps account-first navigation", async () => {
  const [
    hostRoom,
    account,
    createGame,
    chrome,
    roomService,
    restartRoute,
    polling,
    styles,
  ] =
    await Promise.all([
      readFile(new URL("app/components/HostRoom.tsx", projectRoot), "utf8"),
      readFile(new URL("app/components/AccountClient.tsx", projectRoot), "utf8"),
      readFile(new URL("app/components/CreateGameForm.tsx", projectRoot), "utf8"),
      readFile(new URL("app/components/AppChrome.tsx", projectRoot), "utf8"),
      readFile(new URL("lib/room-service.ts", projectRoot), "utf8"),
      readFile(new URL("app/api/rooms/[code]/restart/route.ts", projectRoot), "utf8"),
      readFile(new URL("app/components/useRoomPolling.ts", projectRoot), "utf8"),
      readFile(new URL("app/globals.css", projectRoot), "utf8"),
    ]);

  assert.match(hostRoom, /aria-haspopup="dialog"/);
  assert.match(hostRoom, /<dialog[\s\S]*id="finish-game-dialog"/);
  assert.match(hostRoom, /Biztosan befejezed a játékot\?/);
  assert.match(hostRoom, /Igen, befejezem/);
  assert.match(hostRoom, /runAndUpdate\("finish", "\/finish"\)/);
  assert.match(hostRoom, /runAndUpdate\("restart", "\/restart"\)/);
  assert.match(hostRoom, /finishedTitleRef\.current\?\.focus\(\)/);
  assert.match(hostRoom, /Játék újrajátszása/);

  assert.match(roomService, /export async function restartRoom/);
  assert.match(roomService, /room\.status !== "finished"/);
  assert.match(roomService, /lower\(hex\(randomblob\(16\)\)\) \|\| ':' \|\| id/);
  assert.match(roomService, /status = 'playing', current_card_index = 0/);
  assert.match(roomService, /status = 'finished' AND version = \?/);
  assert.match(roomService, /const submissionId = crypto\.randomUUID\(\)/);
  assert.match(roomService, /d1\.batch\(/);
  assert.match(roomService, /WHERE id = \? AND room_id = rooms\.id/);
  assert.match(restartRoute, /trustedAccountIdFromRequest/);
  assert.match(restartRoute, /restartRoom/);

  assert.match(polling, /new AbortController\(\)/);
  assert.match(polling, /requestGenerationRef/);
  assert.match(polling, /visibilitychange/);

  assert.match(account, /href="\/new-game"/);
  assert.match(account, /returnTo="\/"/);
  assert.doesNotMatch(account, /returnTo=%2Faccount/);
  assert.match(createGame, /returnTo=%2Fnew-game/);
  assert.match(chrome, /className=\{`account-link[\s\S]*?href="\/"/);

  assert.match(styles, /\.finish-dialog::backdrop/);
  assert.match(styles, /\.game-finish-trigger/);
});
