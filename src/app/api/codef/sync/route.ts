/**
 * Codef 거래내역 동기화 API
 * POST: 날짜 범위를 받아 기업은행 + BC카드 + 삼성카드 거래내역 조회 후 DB에 저장
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchIbkTransactions, fetchSamsungCardTransactions, fetchBcCardTransactions, CodefTransaction } from "@/lib/codef";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate, endDate 필수입니다 (YYYYMMDD 형식)" }, { status: 400 });
  }

  const db = getDb();
  const connectedRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("codef_connected_id") as { value: string } | undefined;
  const accountRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("codef_ibk_account") as { value: string } | undefined;

  if (!connectedRow) {
    return NextResponse.json({ error: "Connected ID가 등록되지 않았습니다. 먼저 계정을 연결해주세요." }, { status: 400 });
  }

  const connectedId = connectedRow.value;
  const ibkAccount = accountRow?.value ?? "";

  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  const syncStmt = db.prepare(`
    INSERT INTO codef_sync_history (institution_code, institution_name, start_date, end_date, imported, skipped, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 기업은행 거래내역 조회
  if (ibkAccount) {
    try {
      const rows = await fetchIbkTransactions({ connectedId, account: ibkAccount, startDate, endDate });
      const { imported, skipped } = insertTransactions(db, rows, "IBK");
      results.imported += imported;
      results.skipped += skipped;
      syncStmt.run("0003", "기업은행", startDate, endDate, imported, skipped, "success", null);
      db.prepare("UPDATE codef_connections SET last_synced_at = datetime('now', 'localtime') WHERE institution_code = ?").run("0003");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "오류";
      results.errors.push(`기업은행: ${msg}`);
      syncStmt.run("0003", "기업은행", startDate, endDate, 0, 0, "error", msg);
    }
  }

  // BC카드 거래내역 조회
  try {
    const rows = await fetchBcCardTransactions({ connectedId, startDate, endDate });
    const { imported, skipped } = insertTransactions(db, rows, "BC카드");
    results.imported += imported;
    results.skipped += skipped;
    syncStmt.run("0301", "BC카드", startDate, endDate, imported, skipped, "success", null);
    db.prepare("UPDATE codef_connections SET last_synced_at = datetime('now', 'localtime') WHERE institution_code = ?").run("0301");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "오류";
    results.errors.push(`BC카드: ${msg}`);
    syncStmt.run("0301", "BC카드", startDate, endDate, 0, 0, "error", msg);
  }

  // 삼성카드 거래내역 조회
  try {
    const rows = await fetchSamsungCardTransactions({ connectedId, startDate, endDate });
    const { imported, skipped } = insertTransactions(db, rows, "삼성카드");
    results.imported += imported;
    results.skipped += skipped;
    syncStmt.run("0325", "삼성카드", startDate, endDate, imported, skipped, "success", null);
    db.prepare("UPDATE codef_connections SET last_synced_at = datetime('now', 'localtime') WHERE institution_code = ?").run("0325");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "오류";
    results.errors.push(`삼성카드: ${msg}`);
    syncStmt.run("0325", "삼성카드", startDate, endDate, 0, 0, "error", msg);
  }

  return NextResponse.json(results);
}

function insertTransactions(
  db: ReturnType<typeof getDb>,
  rows: CodefTransaction[],
  source: string
): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, date, amount_in, amount_out, balance, description, major_category, minor_category, source_file, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, '미분류', '', ?, datetime('now', 'localtime'))
  `);

  const insertMany = db.transaction((items: CodefTransaction[]) => {
    for (const row of items) {
      // 날짜 + 적요 + 금액으로 중복 방지용 ID 생성
      const dedupeKey = `codef-${source}-${row.date}-${row.time}-${row.description}-${row.amount_in}-${row.amount_out}`;
      const id = `codef-${Buffer.from(dedupeKey).toString("base64url").slice(0, 32)}`;

      // INSERT OR IGNORE: 이미 있으면 건너뜀
      const info = stmt.run(
        id,
        row.date,
        row.amount_in,
        row.amount_out,
        row.balance || 0,
        row.description,
        `Codef/${source}`
      );

      if (info.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
  });

  insertMany(rows);

  return { imported, skipped };
}
