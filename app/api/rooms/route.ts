import {
  readRoomJson,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { createRoom } from "@/lib/room-service";
import { parseCreateRoomInput } from "@/lib/room-validation";

export async function POST(request: Request) {
  try {
    const input = parseCreateRoomInput(await readRoomJson(request));
    const created = await createRoom(input);
    return roomJson(created, 201);
  } catch (error) {
    return roomErrorResponse(error);
  }
}
