/**
 * 데이터 현황 API — 파일 목록, 통계, 월별 현황
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  // 전체 통계
  const total = (db.prepare("SELECT COUNT(*) as cnt FROM transactions").get() as { cnt: number }).cnt;
  const dateRange = db.prepare("SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions").get() as { min_date: string; max_date: string };

  // 분류 통계
  const classifyStats = db.prepare(
    "SELECT major_category, COUNT(*) as cnt FROM transactions GROUP BY major_category ORDER BY cnt DESC"
  ).all() as { major_category: string; cnt: number }[];

  const classified = classifyStats.filter(c => c.major_category && c.major_category !== "미분류" && c.major_category !== "").reduce((s, c) => s + c.cnt, 0);
  const unclassified = total - classified;
  const classifyRate = total > 0 ? ((classified / total) * 100).toFixed(1) : "0";

  // 파일별 통계
  const fileStats = db.prepare(`
    SELECT source_file, COUNT(*) as cnt,
      MIN(date) as min_date, MAX(date) as max_date,
      MIN(imported_at) as imported_at
    FROM transactions
    WHERE source_file IS NOT NULL AND source_file != ''
    GROUP BY source_file ORDER BY imported_at DESC
  `).all() as { source_file: string; cnt: number; min_date: string; max_date: string; imported_at: string }[];

  // 월별 통계 (분석용: 자체이체 등 제외)
  const monthlyStats = db.prepare(`
    SELECT substr(date, 1, 7) as month,
      COUNT(*) as cnt,
      COALESCE(SUM(amount_in), 0) as income,
      COALESCE(SUM(amount_out), 0) as expense
    FROM transactions
    WHERE major_category NOT IN ('자체이체','카드대금','가수금','가지급금','미분류','')
      AND major_category IS NOT NULL
    GROUP BY month ORDER BY month DESC
  `).all() as { month: string; cnt: number; income: number; expense: number }[];

  // 거래유형 통계
  const typeStats = db.prepare(
    "SELECT type, COUNT(*) as cnt FROM transactions GROUP BY type ORDER BY cnt DESC"
  ).all() as { type: string; cnt: number }[];

  // 계좌 목록
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY id").all();
  const keywords = db.prepare("SELECT * FROM transfer_keywords ORDER BY id").all();
  const fileMappings = db.prepare("SELECT * FROM file_mappings ORDER BY id").all();

  return NextResponse.json({
    total, dateRange, classifyStats, classified, unclassified, classifyRate,
    fileStats, monthlyStats, typeStats, accounts, keywords, fileMappings,
  });
}
