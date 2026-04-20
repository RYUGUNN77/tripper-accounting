"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Shield, Calendar, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle, Lightbulb,
} from "lucide-react";

interface ForecastData {
  basePeriod: string;
  forecast: {
    income: number;
    fixed: number;
    tourCosts: { guide: number; vehicle: number; tour: number; assist: number; total: number };
    otherVariable: number;
    totalExpense: number;
    netProfit: number;
    margin: number;
  };
  fixedItems: { minor_category: string; avg_amount: number; month_count: number }[];
  liquidity: {
    currentBalance: number;
    expectedExpense: number;
    status: "safe" | "caution" | "danger";
    emoji: string;
    ratio: number;
  };
  advice: string[];
  cashFlowCalendar: { day: string; label: string; outflow: number; inflow: number }[];
}

function fmt(val: number): string {
  return `₩${val.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
}

function fmtShort(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `₩${(val / 1_000_000).toFixed(1)}M`;
  return `₩${(val / 1_000).toFixed(0)}K`;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  safe: { bg: "bg-green-50 border-green-200", text: "text-green-700", label: "안전" },
  caution: { bg: "bg-yellow-50 border-yellow-200", text: "text-yellow-700", label: "주의" },
  danger: { bg: "bg-red-50 border-red-200", text: "text-red-700", label: "위험" },
};

export default function ForecastPage() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/forecast")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-8 text-gray-400">분석 중...</div>;
  if (!data || data.forecast === undefined) {
    return <div className="text-center py-8 text-gray-400">데이터가 부족합니다 (최소 2개월 필요)</div>;
  }

  const f = data.forecast;
  const liq = data.liquidity;
  const st = STATUS_STYLES[liq.status];

  // 현금 흐름 차트 데이터
  const cfData = data.cashFlowCalendar.map((c) => ({
    name: `${c.day}\n${c.label}`,
    outflow: -c.outflow,
    inflow: c.inflow,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">재무 예측</h1>
        <p className="text-sm text-gray-500">기준: 최근 3개월 평균 ({data.basePeriod})</p>
      </div>

      {/* 유동자금 상태 (핵심) */}
      <Card className={`border-2 ${st.bg}`}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{liq.emoji}</div>
              <div>
                <div className={`font-bold text-lg ${st.text}`}>
                  유동자금 {st.label}
                </div>
                <p className="text-xs text-gray-500">
                  현재 잔고 {fmt(liq.currentBalance)} / 예상 지출 {fmt(liq.expectedExpense)} ({liq.ratio}%)
                </p>
              </div>
            </div>
            <Shield size={32} className={st.text} />
          </div>
        </CardContent>
      </Card>

      {/* 예측 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <ArrowDownCircle size={12} className="text-green-600" /> 예상 수입
            </div>
            <div className="text-xl font-bold text-green-600">{fmt(f.income)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <ArrowUpCircle size={12} className="text-red-500" /> 예상 지출
            </div>
            <div className="text-xl font-bold text-red-500">{fmt(f.totalExpense)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">예상 순이익</div>
            <div className={`text-xl font-bold ${f.netProfit >= 0 ? "text-blue-600" : "text-red-500"}`}>
              {fmt(f.netProfit)}
            </div>
            <span className="text-[10px] text-gray-400">마진 {f.margin}%</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">투어 직접비</div>
            <div className="text-xl font-bold">{fmt(f.tourCosts.total)}</div>
            <span className="text-[10px] text-gray-400">가이드 {fmtShort(f.tourCosts.guide)}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 현금 흐름 캘린더 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar size={16} /> 예상 현금 흐름
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>시점</TableHead>
                  <TableHead>항목</TableHead>
                  <TableHead className="text-right">나갈 돈</TableHead>
                  <TableHead className="text-right">들어올 돈</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cashFlowCalendar.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{c.day}</TableCell>
                    <TableCell className="text-xs">{c.label}</TableCell>
                    <TableCell className="text-right text-xs text-red-500">
                      {c.outflow > 0 ? fmt(c.outflow) : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs text-green-600">
                      {c.inflow > 0 ? fmt(c.inflow) : ""}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-gray-50 font-medium">
                  <TableCell colSpan={2} className="text-xs">합계</TableCell>
                  <TableCell className="text-right text-xs text-red-500">
                    {fmt(data.cashFlowCalendar.reduce((s, c) => s + c.outflow, 0))}
                  </TableCell>
                  <TableCell className="text-right text-xs text-green-600">
                    {fmt(data.cashFlowCalendar.reduce((s, c) => s + c.inflow, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* 고정비 세부 예측 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">월 고정비 예측 상세</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>항목</TableHead>
                  <TableHead className="text-right">월 평균</TableHead>
                  <TableHead className="text-right">발생 빈도</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.fixedItems.map((item) => (
                  <TableRow key={item.minor_category}>
                    <TableCell className="text-sm">{item.minor_category}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(item.avg_amount)}</TableCell>
                    <TableCell className="text-right text-xs text-gray-400">
                      {item.month_count}/3개월
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* 지출 예측 종합표 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">다음 달 예상 지출 종합</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b font-medium">
              <span>■ 고정비</span>
              <span>{fmt(f.fixed)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4">
              <span className="text-gray-500">가이드비</span>
              <span>{fmt(f.tourCosts.guide)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4">
              <span className="text-gray-500">차량비</span>
              <span>{fmt(f.tourCosts.vehicle)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4">
              <span className="text-gray-500">투어비</span>
              <span>{fmt(f.tourCosts.tour)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4 border-b">
              <span className="text-gray-500">보조비</span>
              <span>{fmt(f.tourCosts.assist)}</span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="font-medium">■ 기타 변동비</span>
              <span>{fmt(f.otherVariable)}</span>
            </div>
            <div className="flex justify-between py-2 font-bold text-base border-t-2">
              <span>예상 총 지출</span>
              <span className="text-red-500">{fmt(f.totalExpense)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 재무 조언 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-500" /> 재무 조언
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.advice.map((a, i) => (
              <div key={i} className="text-sm text-gray-700 py-1 border-b border-gray-100 last:border-0">
                {a}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
