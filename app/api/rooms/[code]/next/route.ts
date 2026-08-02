import {
  codeFromContext,
  roomErrorResponse,
  roomJson,
  trustedAccountIdFromRequest,
} from "@/lib/room-api";
import { nextCard } from "@/lib/room-service";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const room = await nextCard(
      await codeFromContext(context),
      request.headers.get("x-host-token"),
      trustedAccountIdFromRequest(request),
    );
    return roomJson({ room });
  } catch (error) {
    return roomErrorResponse(error);
  }
}
