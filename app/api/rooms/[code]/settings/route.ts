import {
  codeFromContext,
  readRoomJson,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { updateRoomSettings } from "@/lib/room-service";
import { parseSettingsInput } from "@/lib/room-validation";

type RouteContext = { params: Promise<{ code: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const input = parseSettingsInput(await readRoomJson(request));
    const room = await updateRoomSettings(
      await codeFromContext(context),
      request.headers.get("x-host-token"),
      input,
    );
    return roomJson({ room });
  } catch (error) {
    return roomErrorResponse(error);
  }
}
