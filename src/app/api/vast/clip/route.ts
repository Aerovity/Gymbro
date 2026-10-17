import { streamVastClip } from "@/lib/vast/client";
import { VastError, vastErrorResponse } from "@/lib/vast/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== "ticket") || query.getAll("ticket").length !== 1) throw new VastError(400, "vast_invalid_clip", "Use a clip link from workout search.");
    return await streamVastClip(query.get("ticket") ?? "", request.headers.get("range"), request.signal);
  } catch (error) { return vastErrorResponse(error); }
}
