import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path?.length || path.some((part) => !/^\d+$/.test(part))) {
    return Response.json({ error: "Expected a fixture ID or epoch-day/hour/interval path." }, { status: 400 });
  }
  return txlineFetch(request, `/scores/updates/${path.join("/")}`);
}

