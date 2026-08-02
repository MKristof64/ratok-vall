/** Cloudflare Worker entry point for Rátok vall. */
import handler from "vinext/server/app-router-entry";
import {
  type AuthDatabase,
  type AuthEnv,
  getValidSession,
  handleAuthRoute,
  isApiPath,
  isPublicVinextAsset,
  secureApplicationResponse,
  securePublicAssetResponse,
  unauthorizedApiResponse,
  unlockRedirect,
} from "./auth";

interface Env extends AuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: AuthDatabase;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const ACCOUNT_ID_HEADER = "x-ratok-account-id";

function withoutUntrustedAccountHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(ACCOUNT_ID_HEADER);
  return new Request(request, { headers });
}

function withTrustedAccountHeader(
  request: Request,
  accountId: string,
): Request {
  const headers = new Headers(request.headers);
  headers.set(ACCOUNT_ID_HEADER, accountId);
  return new Request(request, { headers });
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
    const sanitizedRequest = withoutUntrustedAccountHeader(request);
    const url = new URL(sanitizedRequest.url);

    const authResponse = await handleAuthRoute(sanitizedRequest, env);
    if (authResponse) return authResponse;

    if (isPublicVinextAsset(url.pathname)) {
      return securePublicAssetResponse(
        await handler.fetch(sanitizedRequest, env, ctx),
      );
    }

    if (url.pathname === "/unlock" || url.pathname === "/unlock/") {
      return secureApplicationResponse(
        await handler.fetch(sanitizedRequest, env, ctx),
      );
    }

    const session = await getValidSession(sanitizedRequest, env);
    if (!session) {
      return isApiPath(url.pathname)
        ? unauthorizedApiResponse()
        : unlockRedirect(url);
    }

    if (isApiPath(url.pathname) && !isSameOriginMutation(sanitizedRequest, url)) {
      return forbiddenMutationResponse();
    }

    const handlerRequest =
      session.kind === "account"
        ? withTrustedAccountHeader(sanitizedRequest, session.accountId)
        : sanitizedRequest;
    return secureApplicationResponse(
      await handler.fetch(handlerRequest, env, ctx),
    );
  },
};

export default worker;
