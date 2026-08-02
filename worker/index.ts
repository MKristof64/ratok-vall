/** Cloudflare Worker entry point for Rátok vall. */
import handler from "vinext/server/app-router-entry";
import {
  type AuthEnv,
  handleAuthRoute,
  hasValidSession,
  isApiPath,
  isPublicVinextAsset,
  secureApplicationResponse,
  securePublicAssetResponse,
  unauthorizedApiResponse,
  unlockRedirect,
} from "./auth";

interface Env extends AuthEnv {
  ASSETS: Fetcher;
  DB: D1Database;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function isSameOriginMutation(request: Request, url: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      return new URL(origin).origin === url.origin;
    } catch {
      return false;
    }
  }

  return fetchSite === "same-origin";
}

function forbiddenMutationResponse(): Response {
  return secureApplicationResponse(
    Response.json({ error: "forbidden", code: "cross_origin_request" }, { status: 403 }),
  );
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const authResponse = await handleAuthRoute(request, env);
    if (authResponse) return authResponse;

    if (isPublicVinextAsset(url.pathname)) {
      return securePublicAssetResponse(await handler.fetch(request, env, ctx));
    }

    if (url.pathname === "/unlock" || url.pathname === "/unlock/") {
      return secureApplicationResponse(await handler.fetch(request, env, ctx));
    }

    if (!(await hasValidSession(request, env))) {
      return isApiPath(url.pathname)
        ? unauthorizedApiResponse()
        : unlockRedirect(url);
    }

    if (isApiPath(url.pathname) && !isSameOriginMutation(request, url)) {
      return forbiddenMutationResponse();
    }

    return secureApplicationResponse(await handler.fetch(request, env, ctx));
  },
};

export default worker;
