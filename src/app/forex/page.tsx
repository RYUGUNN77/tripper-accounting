"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { DollarSign, Upload, FileSpreadsheet, Loader2 } from "lucide-react";

const PLATFORM_COLORS: Record<string, string> = {
  GetYourGuide: "#ff5533", Viator: "#00aa6c", Klook: "#ff5722",
  Beyonder: "#6366f1", Airbnb: "#ff385c",
};
const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#06b6d4", "#f97316"];

interface ForexData {
  summary: { currency: string; total_in: number; total_out: number; total_count: number }[];
  transactions: Record<string, unknown>[];
  trend: { ym: string; income: number; expense: number }[];
  platforms: { platform: string; cnt: number; total_in: number }[];
}

function fmtUsd(v: number) { return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }

export default function ForexPage() {
  const [data, setData] = useState<ForexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch("/api/forex").then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    // 외화 업로드 API (향후 구현)
    setUploading(false);
  };

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;
  if (!data) return null;

  const usd = data.summary.find(s => s.currency === "USD");
  const totalPlatformIn = data.platforms.reduce((s, p) => s + p.total_in, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">외화 계좌</h1>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[11px] text-gray-500">총 거래</div>
          <div className="text-lg font-bold">{usd?.total_count || 0}건</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[11px] text-gray-500">OTA 수입 (USD)</div>
          <div className="text-lg font-bold text-green-600">{fmtUsd(usd?.total_in || 0)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[11px] text-gray-500">환전/출금 (USD)</div>
          <div className="text-lg font-bold text-red-500">{fmtUsd(usd?.total_out || 0)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-[11px] text-gray-500">플랫폼</div>
          <div className="text-lg font-bold">{data.platforms.length}개</div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">개요</TabsTrigger>
          <TabsTrigger value="platforms">플랫폼별</TabsTrigger>
          <TabsTrigger value="transactions">전체 내역</TabsTrigger>
          <TabsTrigger value="upload">업로드</TabsTrigger>
        </TabsList>

        {/* 개요 */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">월별 추이 (USD)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="ym" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="income" name="입금" fill="#22c55e" />
                    <Bar dataKey="expense" name="출금" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">플랫폼별 수입 비중</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={data.platforms} dataKey="total_in" nameKey="platform" cx="50%" cy="50%" outerRadius={90}
                      label={({ name, percent }) => `${name} ${((percent??0)*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                      {data.platforms.map((p, i) => (
                        <Cell key={p.platform} fill={PLATFORM_COLORS[p.platform] || COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => fmtUsd(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 플랫폼별 */}
        <TabsContent value="platforms">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>플랫폼</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">총 입금 (USD)</TableHead>
                <TableHead className="text-right">비중</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.platforms.map(p => (
                  <TableRow key={p.platform}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] || "#94a3b8" }} />
                        <span className="text-sm font-medium">{p.platform}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{p.cnt}건</TableCell>
                    <TableCell className="text-right text-sm text-green-600">{fmtUsd(p.total_in)}</TableCell>
                    <TableCell className="text-right text-sm text-gray-500">
                      {totalPlatformIn > 0 ? ((p.total_in / totalPlatformIn) * 100).toFixed(1) : "0"}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* 전체 내역 */}
        <TabsContent value="transactions">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>날짜</TableHead><TableHead>통화</TableHead><TableHead>적요</TableHead>
                <TableHead>플랫폼</TableHead>
                <TableHead className="text-right">입금</TableHead><TableHead className="text-right">출금</TableHead>
                <TableHead className="text-right">잔액</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.transactions.slice(0, 50).map((tx, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs whitespace-nowrap">{String(tx.date || "").substring(0, 10)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{String(tx.currency)}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">{String(tx.description)}</TableCell>
                    <TableCell className="text-xs">
                      {tx.platform ? (
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[String(tx.platform)] || "#94a3b8" }} />
                          {String(tx.platform)}
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-green-600">
                      {Number(tx.amount_in) > 0 ? fmtUsd(Number(tx.amount_in)) : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs text-red-500">
                      {Number(tx.amount_out) > 0 ? fmtUsd(Number(tx.amount_out)) : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs text-gray-500">
                      {Number(tx.balance) > 0 ? fmtUsd(Number(tx.balance)) : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* 업로드 */}
        <TabsContent value="upload">
          <Card><CardContent className="pt-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center border-gray-200 cursor-pointer hover:border-gray-300"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".xlsx,.xls"; input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleUpload(f); }; input.click(); }}>
              {uploading ? (
                <div className="flex flex-col items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={32} /><p>업로드 중...</p></div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <FileSpreadsheet size={32} />
                  <p className="font-medium text-gray-600">IBK 외화통장 엑셀 파일 업로드</p>
                  <p className="text-xs">.xlsx, .xls</p>
                </div>
              )}
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
