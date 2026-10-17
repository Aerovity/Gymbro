import { vastStatus } from "@/lib/vast/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const status = vastStatus();
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
