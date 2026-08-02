import {
  codeFromContext,
  roomErrorResponse,
  roomJson,
  trustedAccountIdFromRequest,
} from "@/lib/room-api";
import { getRoomHostAccess } from "@/lib/room-service";

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const access = await getRoomHostAccess(
      await codeFromContext(context),
      request.headers.get("x-host-token"),
      trustedAccountIdFromRequest(request),
    );
    return roomJson(access);
  } catch (error) {
    return roomErrorResponse(error);
  }
}
