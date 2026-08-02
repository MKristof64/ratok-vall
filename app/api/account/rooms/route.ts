import {
  requireTrustedAccountId,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { listOwnedRooms } from "@/lib/room-service";

export async function GET(request: Request) {
  try {
    const rooms = await listOwnedRooms(requireTrustedAccountId(request));
    return roomJson({ rooms });
  } catch (error) {
    return roomErrorResponse(error);
  }
}
