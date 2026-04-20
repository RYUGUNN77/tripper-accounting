/**
 * 재무 예측 API
 * GET /api/forecast — 다음 달 지출 예측 + 유동자금 가이드 + 재무 조언
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  // 사용 가능한 월 목록
  const months = (db.prepare(
    "SELECT DISTINCT substr(date, 1, 7) as ym FROM transactions ORDER BY ym"
  ).all() as { ym: string }[]).map(m => m.ym);

  if (months.length < 2) {
    return NextResponse.json({ error: "데이터 부족 (최소 2개월 필요)" });
  }

  const latestMonth = months[months.length - 1];
  const recentMonths = months.slice(-3); // 최근 3개월

  // ── A. 고정비 예측 (최근 3개월 평균) ──
  const fixedAvg = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) / ? as avg_fixed
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.map(() => "?").join(",")})
      AND major_category = '고정비'
  `).get(recentMonths.length, ...recentMonths) as { avg_fixed: number };

  // 고정비 세부 항목 (반복되는 항목)
  const fixedItems = db.prepare(`
    SELECT minor_category, COALESCE(SUM(amount_out), 0) / ? as avg_amount,
      COUNT(DISTINCT substr(date, 1, 7)) as month_count
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.map(() => "?").join(",")})
      AND major_category = '고정비'
    GROUP BY minor_category
    ORDER BY avg_amount DESC
  `).all(recentMonths.length, ...recentMonths) as { minor_category: string; avg_amount: number; month_count: number }[];

  // ── B. 투어 비용 예측 (최근 3개월 평균) ──
  const tourCostAvg = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN minor_category = '가이드비' THEN amount_out ELSE 0 END), 0) / ? as guide,
      COALESCE(SUM(CASE WHEN minor_category = '차량비' THEN amount_out ELSE 0 END), 0) / ? as vehicle,
      COALESCE(SUM(CASE WHEN minor_category = '투어비' THEN amount_out ELSE 0 END), 0) / ? as tour,
      COALESCE(SUM(CASE WHEN minor_category = '보조비' THEN amount_out ELSE 0 END), 0) / ? as assist
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.map(() => "?").join(",")})
      AND major_category = '변동비'
  `).get(
    recentMonths.length, recentMonths.length, recentMonths.length, recentMonths.length,
    ...recentMonths
  ) as { guide: number; vehicle: number; tour: number; assist: number };

  // ── C. 기타 변동비 예측 ──
  const otherVarAvg = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) / ? as avg_other
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.map(() => "?").join(",")})
      AND major_category = '변동비'
      AND minor_category NOT IN ('가이드비', '차량비', '투어비', '보조비')
  `).get(recentMonths.length, ...recentMonths) as { avg_other: number };

  // ── D. 수입 예측 ──
  const incomeAvg = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) / ? as avg_income
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.map(() => "?").join(",")})
      AND major_category = '수입'
  `).get(recentMonths.length, ...recentMonths) as { avg_income: number };

  // ── 현재 잔고 (가장 최근 거래의 잔액) ──
  const lastBalance = db.prepare(`
    SELECT balance FROM transactions
    WHERE balance IS NOT NULL AND balance > 0
    ORDER BY date DESC LIMIT 1
  `).get() as { balance: number } | undefined;

  const currentBalance = lastBalance?.balance || 0;

  // ── 예측 계산 ──
  const tourCostTotal = tourCostAvg.guide + tourCostAvg.vehicle + tourCostAvg.tour + tourCostAvg.assist;
  const totalExpectedExpense = fixedAvg.avg_fixed + tourCostTotal + otherVarAvg.avg_other;
  const expectedNetProfit = incomeAvg.avg_income - totalExpectedExpense;

  // ── 유동자금 상태 ──
  let liquidityStatus: "safe" | "caution" | "danger";
  let liquidityEmoji: string;
  if (currentBalance >= totalExpectedExpense * 1.5) {
    liquidityStatus = "safe";
    liquidityEmoji = "🟢";
  } else if (currentBalance >= totalExpectedExpense) {
    liquidityStatus = "caution";
    liquidityEmoji = "🟡";
  } else {
    liquidityStatus = "danger";
    liquidityEmoji = "🔴";
  }

  // ── 재무 조언 ──
  const advice: string[] = [];

  // 고정비 비율
  const fixedRatio = totalExpectedExpense > 0 ? (fixedAvg.avg_fixed / totalExpectedExpense) * 100 : 0;
  if (fixedRatio > 70) {
    advice.push(`⚠️ 고정비 비율이 ${fixedRatio.toFixed(0)}%로 매우 높습니다. 구독료/리스 등 절감 가능한 항목을 검토하세요.`);
  }

  // 순이익
  if (expectedNetProfit < 0) {
    advice.push(`🚨 다음 달 적자 예상 (${Math.abs(Math.round(expectedNetProfit)).toLocaleString()}원). 비용 절감 또는 매출 확대 방안이 필요합니다.`);
  } else {
    const marginRate = incomeAvg.avg_income > 0 ? (expectedNetProfit / incomeAvg.avg_income) * 100 : 0;
    if (marginRate < 10) {
      advice.push(`📉 순이익률이 ${marginRate.toFixed(1)}%로 낮습니다. 서비스업 목표 순이익률은 15~20%입니다.`);
    }
  }

  // 가이드 급여 (15일 전 현금 확인)
  if (tourCostAvg.guide > 0) {
    advice.push(`💰 다음 달 가이드 급여 예상: ${Math.round(tourCostAvg.guide).toLocaleString()}원 (매월 15일 지급)`);
  }

  // 유동자금
  if (liquidityStatus === "danger") {
    advice.push(`🔴 현재 잔고(${currentBalance.toLocaleString()}원)가 예상 지출(${Math.round(totalExpectedExpense).toLocaleString()}원)보다 적습니다. 즉각적인 자금 확보가 필요합니다.`);
  } else if (liquidityStatus === "caution") {
    advice.push(`🟡 현재 잔고가 예상 지출 대비 여유가 적습니다. OTA 정산 입금 시점을 확인하세요.`);
  }

  // 이상 항목 (최근 월 vs 3개월 평균 비교)
  const latestMonthCosts = db.prepare(`
    SELECT minor_category, COALESCE(SUM(amount_out), 0) as total
    FROM transactions
    WHERE substr(date, 1, 7) = ? AND amount_out > 0
      AND major_category NOT IN ('자체이체', '카드대금', '가수금', '가지급금', '미분류')
    GROUP BY minor_category
  `).all(latestMonth) as { minor_category: string; total: number }[];

  const avgByCat = db.prepare(`
    SELECT minor_category, COALESCE(SUM(amount_out), 0) / ? as avg_total
    FROM transactions
    WHERE substr(date, 1, 7) IN (${recentMonths.slice(0, -1).map(() => "?").join(",") || "''"})
      AND amount_out > 0
      AND major_category NOT IN ('자체이체', '카드대금', '가수금', '가지급금', '미분류')
    GROUP BY minor_category
  `).all(Math.max(recentMonths.length - 1, 1), ...recentMonths.slice(0, -1)) as { minor_category: string; avg_total: number }[];

  const avgMap = new Map(avgByCat.map(a => [a.minor_category, a.avg_total]));
  for (const item of latestMonthCosts) {
    const avg = avgMap.get(item.minor_category) || 0;
    if (avg > 0 && item.total > avg * 1.5) {
      advice.push(`🔍 '${item.minor_category}'이(가) 평소 대비 ${(item.total / avg).toFixed(1)}배 증가 (평균 ${Math.round(avg).toLocaleString()}원 → ${Math.round(item.total).toLocaleString()}원)`);
    }
  }

  if (advice.length === 0) {
    advice.push("✅ 전반적으로 양호한 재무 상태입니다. 현재 추세를 유지하세요.");
  }

  // ── 현금 흐름 캘린더 (간이) ──
  const cashFlowCalendar = [
    { day: "1일", label: "고정비 (임대/관리)", outflow: Math.round(fixedAvg.avg_fixed * 0.4), inflow: 0 },
    { day: "5일", label: "카드 결제일", outflow: Math.round(otherVarAvg.avg_other * 0.3), inflow: 0 },
    { day: "~10일", label: "투어 비용 (차량/입장)", outflow: Math.round(tourCostAvg.vehicle + tourCostAvg.tour), inflow: 0 },
    { day: "15일", label: "가이드 급여", outflow: Math.round(tourCostAvg.guide + tourCostAvg.assist), inflow: 0 },
    { day: "~15일", label: "Viator 정산", outflow: 0, inflow: Math.round(incomeAvg.avg_income * 0.45) },
    { day: "~20일", label: "GYG/Klook 정산", outflow: 0, inflow: Math.round(incomeAvg.avg_income * 0.35) },
    { day: "~25일", label: "기타 OTA 정산", outflow: 0, inflow: Math.round(incomeAvg.avg_income * 0.2) },
  ];

  return NextResponse.json({
    basePeriod: `${recentMonths[0]} ~ ${recentMonths[recentMonths.length - 1]}`,
    forecast: {
      income: Math.round(incomeAvg.avg_income),
      fixed: Math.round(fixedAvg.avg_fixed),
      tourCosts: {
        guide: Math.round(tourCostAvg.guide),
        vehicle: Math.round(tourCostAvg.vehicle),
        tour: Math.round(tourCostAvg.tour),
        assist: Math.round(tourCostAvg.assist),
        total: Math.round(tourCostTotal),
      },
      otherVariable: Math.round(otherVarAvg.avg_other),
      totalExpense: Math.round(totalExpectedExpense),
      netProfit: Math.round(expectedNetProfit),
      margin: incomeAvg.avg_income > 0
        ? Math.round((expectedNetProfit / incomeAvg.avg_income) * 1000) / 10
        : 0,
    },
    fixedItems: fixedItems.map(f => ({
      ...f,
      avg_amount: Math.round(f.avg_amount),
    })),
    liquidity: {
      currentBalance: Math.round(currentBalance),
      expectedExpense: Math.round(totalExpectedExpense),
      status: liquidityStatus,
      emoji: liquidityEmoji,
      ratio: totalExpectedExpense > 0
        ? Math.round((currentBalance / totalExpectedExpense) * 100)
        : 999,
    },
    advice,
    cashFlowCalendar,
  });
}
