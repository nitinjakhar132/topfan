import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  if (!/^\d+$/.test(fixtureId)) return Response.json({ error: "Invalid fixtureId" }, { status: 400 });
  const mode = new URL(request.url).searchParams.get("mode") === "historical" ? "historical" : "snapshot";
  
  const response = await txlineFetch(request, `/scores/${mode}/${fixtureId}`);
  if (!response.ok) return response;

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("event-stream") || text.trim().startsWith("data:")) {
    try {
      const rows = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5).trim()));
      return Response.json(rows);
    } catch (error) {
      console.error("[Scores API] Failed to parse SSE text stream:", error);
      return new Response(text, { status: 200, headers: { "content-type": response.headers.get("content-type") ?? "text/plain" } });
    }
  }

  try {
    const json = JSON.parse(text);
    return Response.json(json);
  } catch {
    return new Response(text, { status: 200, headers: { "content-type": response.headers.get("content-type") ?? "text/plain" } });
  }
}

