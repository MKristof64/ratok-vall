import { RoomRequestError } from "@/lib/room-validation";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

export function roomJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  });
}

export async function readRoomJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new RoomRequestError(413, "body_too_large", "A kérés túl nagy.");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RoomRequestError(
      415,
      "json_required",
      "JSON formátumú kérés szükséges.",
    );
  }
  try {
    return await request.json();
  } catch {
    throw new RoomRequestError(400, "invalid_json", "A JSON kérés érvénytelen.");
  }
}

export function roomErrorResponse(error: unknown) {
  if (error instanceof RoomRequestError) {
    return roomJson({ error: error.message, code: error.code }, error.status);
  }
  console.error("Room API error", error);
  return roomJson(
    { error: "Váratlan kiszolgálóhiba történt.", code: "internal_error" },
    500,
  );
}

export async function codeFromContext(context: {
  params: Promise<{ code: string }>;
}) {
  return (await context.params).code;
}
