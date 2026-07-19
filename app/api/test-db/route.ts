import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const db = getDb();
    const tables = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    return Response.json({ success: true, tables: tables.results });
  } catch (error) {
    const e = error as any;
    return Response.json({ success: false, error: e.message });
  }
}
