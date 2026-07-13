import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return txlineFetch(request, `/fixtures/snapshot${query ? `?${query}` : ""}`);
}

