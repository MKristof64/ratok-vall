import {
  codeFromContext,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { revealCurrentTarget } from "@/lib/room-service";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const room = await revealCurrentTarget(
      await codeFromContext(context),
      request.headers.get("x-host-token"),
    );
    return roomJson({ room });
  } catch (error) {
    return roomErrorResponse(error);
  }
}
