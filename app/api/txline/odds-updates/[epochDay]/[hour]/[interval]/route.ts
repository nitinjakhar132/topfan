import { txlineFetch } from "@/lib/txline/server";

export async function GET(_request: Request, context: { params: Promise<{ epochDay: string; hour: string; interval: string }> }) {
  const params = await context.params;
  if (![params.epochDay, params.hour, params.interval].every((value) => /^\d+$/.test(value))) {
    return Response.json({ error: "Invalid odds update interval." }, { status: 400 });
  }
  return txlineFetch(_request, `/odds/updates/${params.epochDay}/${params.hour}/${params.interval}`);
}

