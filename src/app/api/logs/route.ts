import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const logs = db.prepare(
    "SELECT id, timestamp, action, detail, count, CASE WHEN undo_data IS NOT NULL THEN 1 ELSE 0 END as has_undo FROM changelog ORDER BY timestamp DESC LIMIT ?"
  ).all(limit);
  return NextResponse.json({ logs });
}
