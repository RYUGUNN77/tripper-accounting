"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Users,
  Truck,
} from "lucide-react";

interface SettlementData {
  month: string;
  months: string[];
  summary: {
    income: number;
    tourCosts: number;
    fixedCosts: number;
    otherVariable: number;
    totalExpense: number;
    netProfit: number;
    margin: number;
    forexUSD: number;
  };
  tourCosts: { minor_category: string; count: number; total: number }[];
  guidePayments: { name: string; count: number; total: number }[];
  vehiclePayments: { name: string; count: number; total: number }[];
  monthlyTrend: { month: string; guide: number; vehicle: number; tour: number; assist: number }[];
}

const COST_COLORS: Record<string, string> = {
  "가이드비": "#6366f1",
  "차량비": "#f59e0b",
  "투어비": "#10b981",
  "보조비": "#8b5cf6",
};

function fmt(val: number): string {
  return `₩${val.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
}

function fmtShort(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `₩${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `₩${(val / 1_000).toFixed(0)}K`;
  return `₩${val.toLocaleString()}`;
}

export default function SettlementPage() {
  const [data, setData] = useState<SettlementData | null>(null);
  const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = async (m?: string) => {
    setLoading(true);
    const params = m ? `?month=${m}` : "";
    const res = await fetch(`/api/settlement${params}`);
    const d = await res.json();
    setData(d);
    setMonth(d.month);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading || !data) {
    return <div className="text-center py-8 text-gray-400">로딩 중...</div>;
  }

  const s = data.summary;
  const isProfit = s.netProfit >= 0;

  // 비용 구성 파이 차트
  const costPie = data.tourCosts.map((c) => ({
    name: c.minor_category,
    value: c.total,
  }));

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">투어 정산</h1>
          <p className="text-sm text-gray-500">회계 데이터 기반 분석</p>
        </div>
        <Select value={month} onValueChange={(v) => fetchData(v ?? undefined)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.months.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 정산 종합 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">수입 (KRW)</div>
            <div className="text-xl font-bold text-green-600">{fmt(s.income)}</div>
            {s.forexUSD > 0 && (
              <span className="text-[10px] text-gray-400">외화 ${s.forexUSD.toLocaleString()}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">투어 직접비용</div>
            <div className="text-xl font-bold text-red-500">{fmt(s.tourCosts)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">총 비용</div>
            <div className="text-xl font-bold">{fmt(s.totalExpense)}</div>
            <span className="text-[10px] text-gray-400">고정 {fmtShort(s.fixedCosts)} · 기타변동 {fmtShort(s.otherVariable)}</span>
          </CardContent>
        </Card>
        <Card className={isProfit ? "border-green-200" : "border-red-200"}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              순이익
              {isProfit ? <TrendingUp size={12} className="text-green-600" /> : <TrendingDown size={12} className="text-red-500" />}
            </div>
            <div className={`text-xl font-bold ${isProfit ? "text-green-600" : "text-red-500"}`}>
              {fmt(s.netProfit)}
            </div>
            <span className="text-[10px] text-gray-400">마진율 {s.margin}%</span>
          </CardContent>
        </Card>
      </div>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 비용 구성 파이 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">투어 비용 구성</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={costPie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={12}
                >
                  {costPie.map((entry) => (
                    <Cell key={entry.name} fill={COST_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 월별 추이 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">투어 비용 월별 추이</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => fmtShort(v)} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Legend />
                <Bar dataKey="guide" name="가이드비" fill="#6366f1" stackId="a" />
                <Bar dataKey="vehicle" name="차량비" fill="#f59e0b" stackId="a" />
                <Bar dataKey="tour" name="투어비" fill="#10b981" stackId="a" />
                <Bar dataKey="assist" name="보조비" fill="#8b5cf6" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* 가이드별 / 차량 업체별 지급 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} /> 가이드별 지급 현황
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>가이드</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.guidePayments.map((g) => (
                  <TableRow key={g.name}>
                    <TableCell className="text-sm font-medium">{g.name}</TableCell>
                    <TableCell className="text-right text-xs text-gray-500">{g.count}건</TableCell>
                    <TableCell className="text-right text-sm">{fmt(g.total)}</TableCell>
                  </TableRow>
                ))}
                {data.guidePayments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-gray-400 py-4">
                      해당 월 가이드비 지급 내역이 없습니다
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck size={16} /> 차량 업체별 지급 현황
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>업체/기사</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.vehiclePayments.map((v) => (
                  <TableRow key={v.name}>
                    <TableCell className="text-sm font-medium">{v.name}</TableCell>
                    <TableCell className="text-right text-xs text-gray-500">{v.count}건</TableCell>
                    <TableCell className="text-right text-sm">{fmt(v.total)}</TableCell>
                  </TableRow>
                ))}
                {data.vehiclePayments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-gray-400 py-4">
                      해당 월 차량비 지급 내역이 없습니다
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* 정산 종합표 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{data.month} 정산 종합</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-600">■ 수입 (KRW 입금)</span>
              <span className="font-medium text-green-600">{fmt(s.income)}</span>
            </div>
            {data.tourCosts.map((c) => (
              <div key={c.minor_category} className="flex justify-between py-1 pl-4">
                <span className="text-gray-500">{c.minor_category} ({c.count}건)</span>
                <span className="text-red-500">-{fmt(c.total)}</span>
              </div>
            ))}
            <div className="flex justify-between py-1 border-b pl-4">
              <span className="text-gray-500">소계: 투어 직접비용</span>
              <span className="font-medium text-red-500">-{fmt(s.tourCosts)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4">
              <span className="text-gray-500">고정비</span>
              <span className="text-red-500">-{fmt(s.fixedCosts)}</span>
            </div>
            <div className="flex justify-between py-1 pl-4 border-b">
              <span className="text-gray-500">기타 변동비</span>
              <span className="text-red-500">-{fmt(s.otherVariable)}</span>
            </div>
            <div className="flex justify-between py-2 font-bold text-base">
              <span>순이익</span>
              <span className={isProfit ? "text-green-600" : "text-red-500"}>
                {fmt(s.netProfit)} ({s.margin}%)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
