"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp, TrendingDown, DollarSign, ArrowDownCircle, ArrowUpCircle,
  Lock, Shuffle, AlertTriangle, Lightbulb, Shield, BarChart3, Download,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import Link from "next/link";

interface DashboardData {
  period: string;
  months: string[];
  summary: {
    총수입: number; 총지출: number; 순이익: number;
    고정비: number; 변동비: number;
    고정비비율: number; 변동비비율: number;
    거래건수: number; 미분류건수: number;
  };
  trend: { labels: string[]; datasets: Record<string, number[]> };
  fixed: { labels: string[]; values: number[] };
  variable: { labels: string[]; values: number[] };
  topExpenses: { major_category: string; minor_category: string; amount: number }[];
  anomalies: { cat: string; sub: string; current: number; avg: number; ratio: number }[];
  forecast: { 기준기간: string; 월평균수입: number; 월평균총지출: number; 최소필요자금: number; 권장보유자금: number } | null;
  advice: string[];
}

type ChartType = "composed" | "bar" | "line" | "area";
type Preset = "all" | "3m" | "6m" | "1y";

const PIE_COLORS = ["#6366f1","#8b5cf6","#a78bfa","#c4b5fd","#f59e0b","#f97316","#ef4444","#10b981","#3b82f6","#06b6d4"];
const SERIES_COLORS: Record<string, string> = { 총수입: "#22c55e", 총지출: "#ef4444", 순이익: "#3b82f6", 고정비: "#7c3aed", 변동비: "#f59e0b" };
const SERIES_LIST = ["총수입", "총지출", "순이익", "고정비", "변동비"];

function fmtShort(val: number): string {
  if (Math.abs(val) >= 1e6) return `₩${(val / 1e6).toFixed(1)}M`;
  if (Math.abs(val) >= 1e3) return `₩${(val / 1e3).toFixed(0)}K`;
  return `₩${val.toLocaleString()}`;
}
function fmt(val: number): string {
  return `₩${val.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [chartType, setChartType] = useState<ChartType>("composed");
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(["총수입", "총지출", "순이익"]));

  const fetchData = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await fetch(`/api/dashboard?${params}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 프리셋 적용
  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (!data?.months.length) return;
    const months = data.months;
    const last = months[months.length - 1];
    if (p === "all") { fetchData(); setMonthFrom(""); setMonthTo(""); return; }
    const n = p === "3m" ? 3 : p === "6m" ? 6 : 12;
    const from = months[Math.max(0, months.length - n)];
    setMonthFrom(from); setMonthTo(last);
    fetchData(from, last);
  };

  const applyFilter = () => {
    fetchData(monthFrom || undefined, monthTo || undefined);
  };

  const toggleSeries = (s: string) => {
    setActiveSeries(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  if (loading && !data) return <div className="flex items-center justify-center h-64 text-gray-400">데이터 로딩 중...</div>;
  if (!data?.months?.length) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
      <DollarSign size={48} /><p>데이터가 없습니다. 데이터 관리에서 파일을 업로드하세요.</p>
    </div>
  );

  const s = data.summary;
  const isProfit = s.순이익 >= 0;
  const marginRate = s.총수입 > 0 ? ((s.순이익 / s.총수입) * 100).toFixed(1) : "0";

  // 추이 차트 데이터
  const trendData = data.trend.labels.map((label, i) => {
    const row: Record<string, unknown> = { name: label };
    for (const key of SERIES_LIST) {
      if (activeSeries.has(key)) row[key] = data.trend.datasets[key]?.[i] ?? 0;
    }
    return row;
  });

  const fixedPie = data.fixed.labels.map((l, i) => ({ name: l, value: data.fixed.values[i] }));
  const variablePie = data.variable.labels.map((l, i) => ({ name: l, value: data.variable.values[i] }));

  // 차트 렌더
  const renderTrendChart = () => {
    const series = Array.from(activeSeries);
    const commonProps = { data: trendData, children: null };
    const axes = (
      <>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" fontSize={12} />
        <YAxis fontSize={12} tickFormatter={fmtShort} />
        <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
        <Legend />
      </>
    );

    if (chartType === "bar") {
      return <BarChart {...commonProps}>{axes}{series.map(s => <Bar key={s} dataKey={s} fill={SERIES_COLORS[s]} />)}</BarChart>;
    }
    if (chartType === "area") {
      return <AreaChart {...commonProps}>{axes}{series.map(s => <Area key={s} type="monotone" dataKey={s} stroke={SERIES_COLORS[s]} fill={SERIES_COLORS[s]} fillOpacity={0.15} />)}</AreaChart>;
    }
    if (chartType === "line") {
      return <LineChart {...commonProps}>{axes}{series.map(s => <Line key={s} type="monotone" dataKey={s} stroke={SERIES_COLORS[s]} strokeWidth={2} dot={false} />)}</LineChart>;
    }
    // composed: 수입/지출은 바, 나머지는 라인
    return (
      <ComposedChart {...commonProps}>
        {axes}
        {activeSeries.has("총수입") && <Bar dataKey="총수입" fill="#22c55e" opacity={0.7} />}
        {activeSeries.has("총지출") && <Bar dataKey="총지출" fill="#ef4444" opacity={0.7} />}
        {activeSeries.has("순이익") && <Line type="monotone" dataKey="순이익" stroke="#3b82f6" strokeWidth={2} dot={false} />}
        {activeSeries.has("고정비") && <Line type="monotone" dataKey="고정비" stroke="#7c3aed" strokeWidth={2} dot={false} strokeDasharray="4 4" />}
        {activeSeries.has("변동비") && <Line type="monotone" dataKey="변동비" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 4" />}
      </ComposedChart>
    );
  };

  return (
    <div className="space-y-5">
      {/* 헤더 + 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
          <p className="text-sm text-gray-500">{data.period} · {s.거래건수.toLocaleString()}건</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 프리셋 */}
          {(["all", "3m", "6m", "1y"] as Preset[]).map(p => (
            <Button key={p} variant={preset === p ? "default" : "outline"} size="sm"
              onClick={() => applyPreset(p)} className="text-xs h-7 px-3">
              {{ all: "전체", "3m": "3개월", "6m": "6개월", "1y": "1년" }[p]}
            </Button>
          ))}
          <span className="text-gray-300">|</span>
          {/* 월 셀렉트 */}
          <Select value={monthFrom || "all"} onValueChange={v => { setMonthFrom(!v || v === "all" ? "" : v); setPreset("all"); }}>
            <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="시작" /></SelectTrigger>
            <SelectContent>{data.months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-gray-400 text-xs">~</span>
          <Select value={monthTo || "all"} onValueChange={v => { setMonthTo(!v || v === "all" ? "" : v); setPreset("all"); }}>
            <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="종료" /></SelectTrigger>
            <SelectContent>{data.months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyFilter}>적용</Button>
          {s.미분류건수 > 0 && (
            <Link href="/classify">
              <Badge variant="destructive" className="gap-1 cursor-pointer">
                <AlertTriangle size={12} /> 미분류 {s.미분류건수}건
              </Badge>
            </Link>
          )}
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="총 수입" value={fmt(s.총수입)} icon={<ArrowDownCircle className="text-green-600" size={18} />} />
        <KpiCard title="총 지출" value={fmt(s.총지출)} icon={<ArrowUpCircle className="text-red-500" size={18} />} />
        <KpiCard title="순이익" value={fmt(s.순이익)} sub={`이익률 ${marginRate}%`}
          icon={isProfit ? <TrendingUp className="text-blue-600" size={18} /> : <TrendingDown className="text-red-600" size={18} />} />
        <KpiCard title="고정비" value={fmt(s.고정비)} sub={`${s.고정비비율.toFixed(1)}%`}
          icon={<Lock className="text-purple-600" size={18} />} />
        <KpiCard title="변동비" value={fmt(s.변동비)} sub={`${s.변동비비율.toFixed(1)}%`}
          icon={<Shuffle className="text-amber-600" size={18} />} />
        <KpiCard title="거래 건수" value={`${s.거래건수.toLocaleString()}건`}
          icon={<BarChart3 className="text-gray-500" size={18} />} />
      </div>

      {/* 추이 차트 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">추이 차트</CardTitle>
            <div className="flex items-center gap-2">
              {/* 시리즈 토글 */}
              {SERIES_LIST.map(s => (
                <button key={s} onClick={() => toggleSeries(s)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                    activeSeries.has(s) ? "text-white border-transparent" : "text-gray-400 border-gray-200 bg-white"
                  }`}
                  style={activeSeries.has(s) ? { backgroundColor: SERIES_COLORS[s] } : {}}>
                  {s}
                </button>
              ))}
              <span className="text-gray-200">|</span>
              {/* 차트 타입 */}
              {(["composed", "bar", "line", "area"] as ChartType[]).map(t => (
                <Button key={t} variant={chartType === t ? "default" : "ghost"} size="sm" className="h-6 text-[10px] px-2"
                  onClick={() => setChartType(t)}>
                  {{ composed: "복합", bar: "바", line: "라인", area: "영역" }[t]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            {renderTrendChart()}
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 카테고리 파이 + 지출 TOP */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">고정비 구성</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart><Pie data={fixedPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                label={({ name, percent }) => `${name} ${((percent??0)*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {fixedPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip formatter={(v: unknown) => fmt(Number(v))} /></PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">변동비 구성</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart><Pie data={variablePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                label={({ name, percent }) => `${name} ${((percent??0)*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {variablePie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip formatter={(v: unknown) => fmt(Number(v))} /></PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">지출 TOP 10</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.topExpenses.slice(0, 10).map((item, i) => {
                const pct = s.총지출 > 0 ? ((item.amount / s.총지출) * 100).toFixed(1) : "0";
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-gray-400 w-3">{i + 1}</span>
                      <Badge variant="outline" className="text-[9px] px-1 shrink-0">{item.major_category}</Badge>
                      <span className="text-gray-700 truncate">{item.minor_category}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-gray-400 text-[10px]">{pct}%</span>
                      <span className="font-medium text-gray-900 w-16 text-right">{fmtShort(item.amount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 이상 탐지 + 현금흐름 예측 + 재무 조언 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 이상 탐지 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> 이상 탐지
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.anomalies.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">이상 항목 없음 ✅</p>
            ) : (
              <div className="space-y-2">
                {data.anomalies.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 pb-1.5">
                    <div>
                      <Badge variant="outline" className="text-[9px] mr-1">{a.cat}</Badge>
                      <span className="text-gray-700">{a.sub}</span>
                    </div>
                    <div className="text-right">
                      <Badge className="bg-red-100 text-red-700 text-[10px]">{a.ratio}배</Badge>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        평균 {fmtShort(a.avg)} → {fmtShort(a.current)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 현금 흐름 예측 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield size={16} className="text-blue-500" /> 현금 흐름 예측
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.forecast ? (
              <div className="space-y-2 text-sm">
                <p className="text-[10px] text-gray-400">기준: {data.forecast.기준기간}</p>
                <div className="flex justify-between py-1"><span className="text-gray-500">월평균 수입</span><span className="text-green-600 font-medium">{fmt(data.forecast.월평균수입)}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">월평균 지출</span><span className="text-red-500 font-medium">{fmt(data.forecast.월평균총지출)}</span></div>
                <div className="border-t pt-1.5 flex justify-between"><span className="text-gray-500">최소 필요 자금</span><span className="font-medium">{fmt(data.forecast.최소필요자금)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">권장 보유 자금</span><span className="font-bold text-blue-600">{fmt(data.forecast.권장보유자금)}</span></div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 py-4 text-center">데이터 부족 (최소 2개월)</p>
            )}
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
                <p key={i} className="text-xs text-gray-700 py-1 border-b border-gray-100 last:border-0 leading-relaxed">{a}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, icon }: { title: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2.5 px-3">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] text-gray-500">{title}</span>{icon}
        </div>
        <div className="text-base font-bold text-gray-900">{value}</div>
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </CardContent>
    </Card>
  );
}
