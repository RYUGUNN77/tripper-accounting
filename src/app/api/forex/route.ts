/**
 * 외화 계좌 API
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_count,
      COALESCE(SUM(amount_in), 0) as total_in,
      COALESCE(SUM(amount_out), 0) as total_out,
      currency
    FROM forex_transactions
    GROUP BY currency
  `).all() as { total_count: number; total_in: number; total_out: number; currency: string }[];

  const transactions = db.prepare(
    "SELECT * FROM forex_transactions ORDER BY date DESC LIMIT 100"
  ).all();

  // 월별 추이
  const trend = db.prepare(`
    SELECT substr(date, 1, 7) as ym,
      COALESCE(SUM(amount_in), 0) as income,
      COALESCE(SUM(amount_out), 0) as expense
    FROM forex_transactions
    GROUP BY ym ORDER BY ym
  `).all();

  // 플랫폼별
  const platforms = db.prepare(`
    SELECT platform, COUNT(*) as cnt, COALESCE(SUM(amount_in), 0) as total_in
    FROM forex_transactions
    WHERE platform != '' AND platform IS NOT NULL
    GROUP BY platform ORDER BY total_in DESC
  `).all();

  return NextResponse.json({ summary, transactions, trend, platforms });
}
