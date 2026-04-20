/**
 * 대시보드 API — KPI, 추이 차트, 카테고리별 분석
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 분석에서 제외할 카테고리
const EXCLUDE_CATS = ["자체이체", "카드대금", "가수금", "가지급금", "미분류", ""];

function excludeWhere(column: string = "major_category"): string {
  return EXCLUDE_CATS.map(() => `${column} != ?`).join(" AND ") +
    ` AND ${column} IS NOT NULL AND ${column} != ''`;
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;

  const monthFrom = params.get("from") || "";
  const monthTo = params.get("to") || "";

  // 사용 가능한 월 목록
  const allMonths = db
    .prepare("SELECT DISTINCT substr(date, 1, 7) as ym FROM transactions ORDER BY ym")
    .all() as { ym: string }[];
  const monthList = allMonths.map((m) => m.ym);

  const from = monthFrom || monthList[0] || "";
  const to = monthTo || monthList[monthList.length - 1] || "";

  if (!from || !to) {
    return NextResponse.json({ error: "데이터 없음", months: [] });
  }

  // KPI 요약 (제외 카테고리 빼고)
  const summaryRow = db
    .prepare(
      `SELECT
        COALESCE(SUM(amount_in), 0) as total_in,
        COALESCE(SUM(amount_out), 0) as total_out,
        COUNT(*) as tx_count
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금')
        AND major_category IS NOT NULL AND major_category != '' AND major_category != '미분류'`
    )
    .get(from, to) as { total_in: number; total_out: number; tx_count: number };

  const fixedRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_out), 0) as total
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ? AND major_category = '고정비'`
    )
    .get(from, to) as { total: number };

  const variableRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_out), 0) as total
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ? AND major_category = '변동비'`
    )
    .get(from, to) as { total: number };

  // 미분류 건수
  const unclassifiedRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM transactions
      WHERE (major_category = '미분류' OR major_category = '' OR major_category IS NULL)`
    )
    .get() as { cnt: number };

  const totalExpense = summaryRow.total_out;
  const summary = {
    총수입: summaryRow.total_in,
    총지출: totalExpense,
    순이익: summaryRow.total_in - totalExpense,
    고정비: fixedRow.total,
    변동비: variableRow.total,
    고정비비율: totalExpense > 0 ? (fixedRow.total / totalExpense) * 100 : 0,
    변동비비율: totalExpense > 0 ? (variableRow.total / totalExpense) * 100 : 0,
    거래건수: summaryRow.tx_count,
    미분류건수: unclassifiedRow.cnt,
  };

  // 월별 추이
  const trendRows = db
    .prepare(
      `SELECT substr(date, 1, 7) as ym,
        COALESCE(SUM(amount_in), 0) as income,
        COALESCE(SUM(amount_out), 0) as expense,
        COALESCE(SUM(CASE WHEN major_category = '고정비' THEN amount_out ELSE 0 END), 0) as fixed,
        COALESCE(SUM(CASE WHEN major_category = '변동비' THEN amount_out ELSE 0 END), 0) as variable
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금')
        AND major_category IS NOT NULL AND major_category != '' AND major_category != '미분류'
      GROUP BY ym ORDER BY ym`
    )
    .all(from, to) as {
      ym: string; income: number; expense: number; fixed: number; variable: number;
    }[];

  const trend = {
    labels: trendRows.map((r) => r.ym),
    datasets: {
      총수입: trendRows.map((r) => r.income),
      총지출: trendRows.map((r) => r.expense),
      순이익: trendRows.map((r) => r.income - r.expense),
      고정비: trendRows.map((r) => r.fixed),
      변동비: trendRows.map((r) => r.variable),
    },
  };

  // 고정비 구성
  const fixedCat = db
    .prepare(
      `SELECT minor_category as name, COALESCE(SUM(amount_out), 0) as value
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ? AND major_category = '고정비'
      GROUP BY minor_category ORDER BY value DESC`
    )
    .all(from, to) as { name: string; value: number }[];

  // 변동비 구성
  const variableCat = db
    .prepare(
      `SELECT minor_category as name, COALESCE(SUM(amount_out), 0) as value
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ? AND major_category = '변동비'
      GROUP BY minor_category ORDER BY value DESC`
    )
    .all(from, to) as { name: string; value: number }[];

  // 지출 TOP 10
  const topExpenses = db
    .prepare(
      `SELECT major_category, minor_category, COALESCE(SUM(amount_out), 0) as amount
      FROM transactions
      WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
        AND amount_out > 0
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금','미분류','')
      GROUP BY major_category, minor_category
      ORDER BY amount DESC LIMIT 10`
    )
    .all(from, to) as { major_category: string; minor_category: string; amount: number }[];

  // ── 이상 탐지: 마지막 달 vs 이전 3개월 평균 대비 1.5배 초과 항목 ──
  const lastMonth = to;
  const targetMonths = monthList.filter(m => m < lastMonth).slice(-3);
  const anomalies: { cat: string; sub: string; current: number; avg: number; ratio: number }[] = [];

  if (targetMonths.length > 0) {
    const currentCats = db.prepare(`
      SELECT major_category, minor_category, COALESCE(SUM(amount_out), 0) as total
      FROM transactions
      WHERE substr(date, 1, 7) = ? AND amount_out > 0
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금','미분류','')
      GROUP BY major_category, minor_category
    `).all(lastMonth) as { major_category: string; minor_category: string; total: number }[];

    const avgCats = db.prepare(`
      SELECT major_category, minor_category, COALESCE(SUM(amount_out), 0) / ${targetMonths.length} as avg_total
      FROM transactions
      WHERE substr(date, 1, 7) IN (${targetMonths.map(() => "?").join(",")}) AND amount_out > 0
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금','미분류','')
      GROUP BY major_category, minor_category
    `).all(...targetMonths) as { major_category: string; minor_category: string; avg_total: number }[];

    const avgMap = new Map(avgCats.map(a => [`${a.major_category}/${a.minor_category}`, a.avg_total]));
    for (const c of currentCats) {
      const avg = avgMap.get(`${c.major_category}/${c.minor_category}`) || 0;
      if (avg > 0 && c.total > avg * 1.5) {
        anomalies.push({
          cat: c.major_category, sub: c.minor_category,
          current: Math.round(c.total), avg: Math.round(avg),
          ratio: Math.round((c.total / avg) * 10) / 10,
        });
      }
    }
    anomalies.sort((a, b) => (b.current - b.avg) - (a.current - a.avg));
  }

  // ── 현금 흐름 예측 (최근 3개월 평균 기반) ──
  const recentForForecast = monthList.slice(-3);
  const forecastData = recentForForecast.length >= 2 ? (() => {
    const n = recentForForecast.length;
    const fRow = db.prepare(`
      SELECT
        COALESCE(SUM(amount_in), 0) / ${n} as avg_income,
        COALESCE(SUM(amount_out), 0) / ${n} as avg_expense,
        COALESCE(SUM(CASE WHEN major_category = '고정비' THEN amount_out ELSE 0 END), 0) / ${n} as avg_fixed
      FROM transactions
      WHERE substr(date, 1, 7) IN (${recentForForecast.map(() => "?").join(",")})
        AND major_category NOT IN ('자체이체','카드대금','가수금','가지급금','미분류','')
    `).get(...recentForForecast) as { avg_income: number; avg_expense: number; avg_fixed: number };
    return {
      기준기간: `${recentForForecast[0]} ~ ${recentForForecast[recentForForecast.length - 1]}`,
      월평균수입: Math.round(fRow.avg_income),
      월평균총지출: Math.round(fRow.avg_expense),
      최소필요자금: Math.round(fRow.avg_fixed),
      권장보유자금: Math.round(fRow.avg_expense * 1.2),
    };
  })() : null;

  // ── 재무 조언 ──
  const advice: string[] = [];
  if (summary.고정비비율 > 70) {
    advice.push(`⚠️ 고정비 비율이 ${summary.고정비비율.toFixed(1)}%로 매우 높습니다. 구독료, 리스 등 절감 가능한 고정비를 검토하세요.`);
  } else if (summary.고정비비율 > 50) {
    advice.push(`📊 고정비 비율 ${summary.고정비비율.toFixed(1)}%는 서비스업 평균 수준입니다. 변동비 효율화로 수익성을 더 개선할 수 있습니다.`);
  }
  if (summary.순이익 < 0) {
    advice.push(`🚨 선택 기간 적자 ${Math.abs(summary.순이익).toLocaleString()}원입니다. 즉각적인 비용 절감 또는 매출 확대 방안이 필요합니다.`);
  } else if (summary.총수입 > 0) {
    const margin = (summary.순이익 / summary.총수입) * 100;
    if (margin < 10) advice.push(`📉 순이익률이 ${margin.toFixed(1)}%로 낮습니다. 서비스업 목표 순이익률은 15~20%입니다.`);
  }
  for (const a of anomalies.slice(0, 3)) {
    advice.push(`🔍 '${a.sub}' 항목이 평소 대비 ${a.ratio}배 증가 (평균 ${a.avg.toLocaleString()}원 → ${a.current.toLocaleString()}원). 원인을 확인하세요.`);
  }
  if (forecastData && forecastData.월평균수입 < forecastData.월평균총지출) {
    advice.push(`💰 월평균 지출이 수입을 초과합니다. 최소 ${forecastData.최소필요자금.toLocaleString()}원의 운영자금 확보가 필요합니다.`);
  }
  if (advice.length === 0) advice.push("✅ 전반적으로 양호한 재무 상태입니다. 현재 추세를 유지하세요.");

  return NextResponse.json({
    period: from === to ? from : `${from} ~ ${to}`,
    months: monthList,
    summary,
    trend,
    fixed: { labels: fixedCat.map((c) => c.name), values: fixedCat.map((c) => c.value) },
    variable: { labels: variableCat.map((c) => c.name), values: variableCat.map((c) => c.value) },
    topExpenses,
    anomalies: anomalies.slice(0, 5),
    forecast: forecastData,
    advice,
  });
}
