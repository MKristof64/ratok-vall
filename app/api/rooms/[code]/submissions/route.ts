import {
  codeFromContext,
  readRoomJson,
  roomErrorResponse,
  roomJson,
} from "@/lib/room-api";
import { addSubmission } from "@/lib/room-service";
import { parseSubmissionInput } from "@/lib/room-validation";

type RouteContext = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const input = parseSubmissionInput(await readRoomJson(request));
    const result = await addSubmission(await codeFromContext(context), input);
    return roomJson(result, result.created ? 201 : 200);
  } catch (error) {
    return roomErrorResponse(error);
  }
}
