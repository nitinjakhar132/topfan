import { txlineFetch } from "@/lib/txline/server";

export async function GET(request: Request) {
  return txlineFetch(request, "/scores/stream");
}

