import {
  codeFromContext,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { deleteRoom, getPublicRoom } from "@/lib/room-service";

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    return roomJson(await getPublicRoom(await codeFromContext(context)));
  } catch (error) {
    return roomErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await deleteRoom(
      await codeFromContext(context),
      request.headers.get("x-host-token"),
    );
    return roomJson({ deleted: true });
  } catch (error) {
    return roomErrorResponse(error);
  }
}
