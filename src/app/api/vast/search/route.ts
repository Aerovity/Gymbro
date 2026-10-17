import { searchVast, VastSearchInput } from "@/lib/vast/client";
import { VastError, vastErrorResponse, requireVastAccess } from "@/lib/vast/config";
import { readLimited } from "@/lib/vast/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    requireVastAccess(request);
    let raw: unknown;
    try {
      const bytes = await readLimited(request.body, 4096);
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof VastError) throw new VastError(413, "vast_request_too_large", "Workout search requests must be no larger than 4 KiB.");
      throw new VastError(400, "vast_invalid_request", "Send a valid workout search request.");
    }
    const parsed = VastSearchInput.safeParse(raw);
    if (!parsed.success) throw new VastError(400, "vast_invalid_request", "Use a search of 3 to 500 characters and request 1 to 10 results.");
    return Response.json(await searchVast(parsed.data, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return vastErrorResponse(error); }
}
