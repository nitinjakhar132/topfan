import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.toString();
  if (!query) return Response.json({ error: "TxLINE validation query parameters are required." }, { status: 400 });
  return txlineFetch(request, `/scores/stat-validation?${query}`);
}

