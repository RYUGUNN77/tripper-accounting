/**
 * Codef 거래내역 동기화 API
 * POST: 날짜 범위를 받아 기업은행 + BC카드 + 삼성카드 거래내역 조회 후 DB에 저장
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchIbkTransactions, fetchSamsungCardTransactions, fetchBcCardTransactions, CodefTransaction } from "@/lib/codef";
import { getDb } from "@/lib/db";

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

  // 연결 ID로 connection 레코드 조회
  const connection = db.prepare("SELECT id FROM codef_connections WHERE connected_id = ?").get(connectedId) as { id: number } | undefined;
  const connectionId = connection?.id ?? null;

  const results = { imported: 0, skipped: 0, classified: 0, errors: [] as string[] };

  // codef_sync_history: 실제 스키마에 맞춤 (connection_id FK 기반)
  const syncStmt = db.prepare(`
    INSERT INTO codef_sync_history (connection_id, start_date, end_date, imported_count, skipped_count, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // codef_connections 동기화 상태 업데이트
  const updateConnectionSync = (imported: number, skipped: number, syncStatus: string, errorMsg: string | null) => {
    if (!connectionId) return;
    db.prepare(`
      UPDATE codef_connections
      SET last_sync_at = datetime('now', 'localtime'),
          last_sync_status = ?,
          last_sync_error = ?,
          last_sync_imported = last_sync_imported + ?,
          last_sync_skipped = last_sync_skipped + ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(syncStatus, errorMsg, imported, skipped, connectionId);
  };

  // 기업은행 거래내역 조회
  if (ibkAccount) {
    try {
      const rows = await fetchIbkTransactions({ connectedId, account: ibkAccount, startDate, endDate });
      const { imported, skipped } = insertTransactions(db, rows, "IBK");
      results.imported += imported;
      results.skipped += skipped;
      if (connectionId) syncStmt.run(connectionId, startDate, endDate, imported, skipped, "success", null);
      updateConnectionSync(imported, skipped, "success", null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "오류";
      results.errors.push(`기업은행: ${msg}`);
      if (connectionId) syncStmt.run(connectionId, startDate, endDate, 0, 0, "error", msg);
      updateConnectionSync(0, 0, "error", msg);
    }
  }

  // BC카드 거래내역 조회
  try {
    const rows = await fetchBcCardTransactions({ connectedId, startDate, endDate });
    const { imported, skipped } = insertTransactions(db, rows, "BC카드");
    results.imported += imported;
    results.skipped += skipped;
    if (connectionId) syncStmt.run(connectionId, startDate, endDate, imported, skipped, "success", null);
    updateConnectionSync(imported, skipped, "success", null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "오류";
    results.errors.push(`BC카드: ${msg}`);
    if (connectionId) syncStmt.run(connectionId, startDate, endDate, 0, 0, "error", msg);
    updateConnectionSync(0, 0, "error", msg);
  }

  // 삼성카드 거래내역 조회
  try {
    const rows = await fetchSamsungCardTransactions({ connectedId, startDate, endDate });
    const { imported, skipped } = insertTransactions(db, rows, "삼성카드");
    results.imported += imported;
    results.skipped += skipped;
    if (connectionId) syncStmt.run(connectionId, startDate, endDate, imported, skipped, "success", null);
    updateConnectionSync(imported, skipped, "success", null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "오류";
    results.errors.push(`삼성카드: ${msg}`);
    if (connectionId) syncStmt.run(connectionId, startDate, endDate, 0, 0, "error", msg);
    updateConnectionSync(0, 0, "error", msg);
  }

  // 동기화된 거래 자동분류 실행
  if (results.imported > 0) {
    results.classified = classifyNewTransactions(db);
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

/**
 * 미분류 거래에 대해 classification_rules + people aliases 기반 자동분류 실행
 * 반환: 분류된 거래 수
 */
function classifyNewTransactions(db: ReturnType<typeof getDb>): number {
  let classified = 0;

  // 1. 규칙 기반 분류 (keyword 길이 역순 = 더 구체적인 규칙 우선)
  const rules = db.prepare(
    "SELECT major_category, minor_category, keyword FROM classification_rules ORDER BY priority DESC, LENGTH(keyword) DESC"
  ).all() as { major_category: string; minor_category: string; keyword: string }[];

  const updateStmt = db.prepare(
    "UPDATE transactions SET major_category = ?, minor_category = ? WHERE id = ?"
  );

  const unclassified = db.prepare(
    "SELECT id, description FROM transactions WHERE major_category IN ('', '미분류') OR major_category IS NULL"
  ).all() as { id: string; description: string }[];

  // 2. 인력 이름/aliases 로드
  const people = db.prepare(
    "SELECT name, aliases FROM people"
  ).all() as { name: string; aliases: string | null }[];

  const personNames: string[] = [];
  for (const p of people) {
    personNames.push(p.name);
    if (p.aliases) {
      try {
        const parsed = JSON.parse(p.aliases) as string[];
        personNames.push(...parsed);
      } catch { /* aliases 파싱 실패 무시 */ }
    }
  }

  const classifyBatch = db.transaction(() => {
    for (const tx of unclassified) {
      const desc = (tx.description || "").trim();

      // 규칙 매칭
      const matched = rules.find(r => desc.includes(r.keyword));
      if (matched) {
        updateStmt.run(matched.major_category, matched.minor_category, tx.id);
        classified++;
        continue;
      }

      // 인력 이름 매칭 → 변동비/가이드비
      const personMatch = personNames.find(name => desc.includes(name));
      if (personMatch) {
        updateStmt.run("변동비", "가이드비", tx.id);
        classified++;
      }
    }
  });

  classifyBatch();

  return classified;
}
