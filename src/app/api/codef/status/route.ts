/**
 * Codef 연결 상태 조회 API
 * GET: 연결된 기관 목록 + Connected ID 상태 반환
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface CodefConnection {
  id: number;
  connected_id: string;
  status: string;
  institutions: string;
  ibk_account: string | null;
  cert_name: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_imported: number;
  last_sync_skipped: number;
  created_at: string;
  updated_at: string;
}

interface SyncHistory {
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

export async function GET() {
  const db = getDb();

  const connectedIdRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("codef_connected_id") as { value: string } | undefined;

  const ibkAccountRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("codef_ibk_account") as { value: string } | undefined;

  const connections = db
    .prepare("SELECT * FROM codef_connections ORDER BY created_at DESC")
    .all() as CodefConnection[];

  const lastSync = db
    .prepare("SELECT * FROM codef_sync_history ORDER BY sync_date DESC LIMIT 1")
    .get() as SyncHistory | undefined;

  return NextResponse.json({
    hasConnectedId: !!connectedIdRow,
    connectedId: connectedIdRow?.value ?? null,
    ibkAccount: ibkAccountRow?.value ?? null,
    connections,
    lastSync: lastSync ?? null,
  });
}
