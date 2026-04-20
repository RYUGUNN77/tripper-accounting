/**
 * 투어별 정산 API
 * GET /api/settlement — 투어별 수익성 + 교차 검증
 *
 * 노션 OTA 정산 현황 DB 데이터가 필요하지만, MCP는 클라이언트(Claude)에서만 사용 가능.
 * 따라서 이 API는 회계 DB 데이터만으로 분석하고,
 * 노션 데이터는 클라이언트에서 별도 패칭 후 합산하는 구조.
 *
 * 회계 DB에서 할 수 있는 분석:
 * 1. 가이드비/차량비/보조비/투어비 분류된 거래를 월별 집계
 * 2. OTA 수입(환전) 데이터와 교차 매칭
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const month = req.nextUrl.searchParams.get("month") || "";

  // 사용 가능한 월 목록
  const months = (db.prepare(
    "SELECT DISTINCT substr(date, 1, 7) as ym FROM transactions ORDER BY ym DESC"
  ).all() as { ym: string }[]).map(m => m.ym);

  const targetMonth = month || months[0] || "";

  // 투어 관련 비용 (변동비 중 가이드비/차량비/보조비/투어비)
  const tourCosts = db.prepare(`
    SELECT minor_category,
      COUNT(*) as count,
      COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ?
      AND major_category = '변동비'
      AND minor_category IN ('가이드비', '차량비', '보조비', '투어비')
    GROUP BY minor_category
    ORDER BY total DESC
  `).all(targetMonth) as { minor_category: string; count: number; total: number }[];

  // 투어 비용 합계
  const tourCostTotal = tourCosts.reduce((s, c) => s + c.total, 0);

  // 고정비 합계 (해당 월)
  const fixedRow = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ? AND major_category = '고정비'
  `).get(targetMonth) as { total: number };

  // 기타 변동비 (투어 직접비 제외)
  const otherVarRow = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ?
      AND major_category = '변동비'
      AND minor_category NOT IN ('가이드비', '차량비', '보조비', '투어비')
  `).get(targetMonth) as { total: number };

  // 수입 합계
  const incomeRow = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ?
      AND major_category = '수입'
  `).get(targetMonth) as { total: number };

  // OTA 환전 수입 (외화에서)
  const forexIncome = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) as total_usd
    FROM forex_transactions
    WHERE substr(date, 1, 7) = ?
      AND transaction_type = 'OTA입금'
  `).get(targetMonth) as { total_usd: number };

  // 가이드별 지급 현황 (해당 월)
  const guidePayments = db.prepare(`
    SELECT merchant as name,
      COUNT(*) as count,
      COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ?
      AND major_category = '변동비'
      AND minor_category = '가이드비'
      AND merchant != ''
    GROUP BY merchant
    ORDER BY total DESC
    LIMIT 20
  `).all(targetMonth) as { name: string; count: number; total: number }[];

  // 차량 업체별 지급
  const vehiclePayments = db.prepare(`
    SELECT merchant as name,
      COUNT(*) as count,
      COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ?
      AND major_category = '변동비'
      AND minor_category = '차량비'
      AND merchant != ''
    GROUP BY merchant
    ORDER BY total DESC
    LIMIT 20
  `).all(targetMonth) as { name: string; count: number; total: number }[];

  // 월별 추이 (최근 6개월)
  const recentMonths = months.slice(0, 6).reverse();
  const monthlyTrend = recentMonths.map((ym) => {
    const costs = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN minor_category = '가이드비' THEN amount_out ELSE 0 END), 0) as guide,
        COALESCE(SUM(CASE WHEN minor_category = '차량비' THEN amount_out ELSE 0 END), 0) as vehicle,
        COALESCE(SUM(CASE WHEN minor_category = '투어비' THEN amount_out ELSE 0 END), 0) as tour,
        COALESCE(SUM(CASE WHEN minor_category = '보조비' THEN amount_out ELSE 0 END), 0) as assist
      FROM transactions
      WHERE substr(date, 1, 7) = ? AND major_category = '변동비'
    `).get(ym) as { guide: number; vehicle: number; tour: number; assist: number };

    return { month: ym, ...costs };
  });

  // 정산 종합
  const totalExpense = tourCostTotal + fixedRow.total + otherVarRow.total;
  const netProfit = incomeRow.total - totalExpense;
  const margin = incomeRow.total > 0 ? (netProfit / incomeRow.total) * 100 : 0;

  return NextResponse.json({
    month: targetMonth,
    months,
    summary: {
      income: incomeRow.total,
      tourCosts: tourCostTotal,
      fixedCosts: fixedRow.total,
      otherVariable: otherVarRow.total,
      totalExpense,
      netProfit,
      margin: Math.round(margin * 10) / 10,
      forexUSD: forexIncome.total_usd,
    },
    tourCosts,
    guidePayments,
    vehiclePayments,
    monthlyTrend,
  });
}
