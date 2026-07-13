import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  if (!/^\d+$/.test(fixtureId)) return Response.json({ error: "Invalid fixtureId" }, { status: 400 });
  const mode = new URL(request.url).searchParams.get("mode") === "historical" ? "historical" : "snapshot";
  return txlineFetch(request, `/scores/${mode}/${fixtureId}`);
}

