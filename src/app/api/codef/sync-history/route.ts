/**
 * Codef 동기화 이력 조회 API
 * GET: 최근 동기화 이력 반환
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface SyncHistoryRow {
  id: number;
  connection_id: number;
  sync_date: string;
  start_date: string;
  end_date: string;
  status: string;
  imported_count: number;
  skipped_count: number;
  error_message: string | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM codef_sync_history ORDER BY sync_date DESC LIMIT ?")
    .all(limit) as SyncHistoryRow[];

  const totalImported = db
    .prepare("SELECT COALESCE(SUM(imported_count), 0) as total FROM codef_sync_history WHERE status = 'success'")
    .get() as { total: number };

  return NextResponse.json({
    history: rows,
    totalImported: totalImported.total,
  });
}
