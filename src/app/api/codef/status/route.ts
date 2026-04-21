/**
 * Codef 연결 상태 조회 API
 * GET: 연결된 기관 목록 + Connected ID 상태 반환
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface CodefConnection {
  id: number;
  institution_code: string;
  institution_name: string;
  business_type: string;
  status: string;
  connected_id: string | null;
  connected_at: string;
  last_synced_at: string | null;
  error_message: string | null;
}

export async function GET() {
  const db = getDb();

  const connectedIdRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("codef_connected_id") as { value: string } | undefined;

  const ibkAccountRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("codef_ibk_account") as { value: string } | undefined;

  const connections = db
    .prepare("SELECT * FROM codef_connections ORDER BY connected_at DESC")
    .all() as CodefConnection[];

  const lastSync = db
    .prepare("SELECT * FROM codef_sync_history ORDER BY synced_at DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;

  return NextResponse.json({
    hasConnectedId: !!connectedIdRow,
    connectedId: connectedIdRow?.value ?? null,
    ibkAccount: ibkAccountRow?.value ?? null,
    connections,
    lastSync: lastSync ?? null,
  });
}
