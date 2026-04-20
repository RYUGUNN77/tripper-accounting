import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const presets = db.prepare(
    "SELECT id, name, pattern, transaction_type, created_at FROM import_presets ORDER BY id DESC"
  ).all();
  return NextResponse.json({ presets });
}
