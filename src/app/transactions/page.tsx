"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, ChevronLeft, ChevronRight, ArrowUpDown, X, ArrowRight,
  Check, Loader2,
} from "lucide-react";

interface Transaction {
  id: string; date: string; type: string;
  amount_in: number; amount_out: number; balance: number | null;
  description: string; merchant: string;
  major_category: string; minor_category: string;
  memo: string; source_file: string; card_number: string;
}

interface TxData {
  rows: Transaction[];
  total: number; page: number; perPage: number; totalPages: number;
  months: string[];
  categories: Record<string, string[]>;
  summary: { total_in: number; total_out: number };
}

const CAT_COLORS: Record<string, string> = {
  "고정비": "bg-purple-100 text-purple-700", "변동비": "bg-amber-100 text-amber-700",
  "수입": "bg-green-100 text-green-700", "미분류": "bg-red-100 text-red-700",
  "자체이체": "bg-blue-100 text-blue-700", "카드대금": "bg-pink-100 text-pink-700",
  "가수금": "bg-orange-100 text-orange-700", "가지급금": "bg-teal-100 text-teal-700",
};
const ALL_CATS = ["고정비", "변동비", "수입", "자체이체", "카드대금", "가수금", "가지급금", "미분류"];
type Preset = "" | "1m" | "3m" | "6m" | "1y";

function fmt(v: number) { return `₩${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`; }

export default function TransactionsPage() {
  const [data, setData] = useState<TxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [direction, setDirection] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [preset, setPreset] = useState<Preset>("");

  // 분류 모달
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [editMajor, setEditMajor] = useState("");
  const [editMinor, setEditMinor] = useState("");
  const [applyAll, setApplyAll] = useState(true);
  const [sameDescCount, setSameDescCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (monthFrom) p.set("from", monthFrom);
    if (monthTo) p.set("to", monthTo);
    if (category) p.set("category", category);
    if (subcategory) p.set("subcategory", subcategory);
    if (direction) p.set("direction", direction);
    if (keyword) p.set("q", keyword);
    p.set("page", String(page));
    p.set("sort", sortCol);
    p.set("dir", sortDir);
    p.set("perPage", "50");
    const res = await fetch(`/api/transactions?${p}`);
    setData(await res.json());
    setLoading(false);
  }, [monthFrom, monthTo, category, subcategory, direction, keyword, page, sortCol, sortDir]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 프리셋
  const applyPreset = (pr: Preset) => {
    setPreset(pr);
    if (!data?.months.length) return;
    const ms = data.months;
    if (!pr) { setMonthFrom(""); setMonthTo(""); setPage(1); return; }
    const n = pr === "1m" ? 1 : pr === "3m" ? 3 : pr === "6m" ? 6 : 12;
    setMonthFrom(ms[Math.max(0, ms.length - n)]);
    setMonthTo(ms[ms.length - 1]);
    setPage(1);
  };

  const toggleSort = (col: string) => {
    setSortCol(col); setSortDir(sortCol === col && sortDir === "desc" ? "asc" : "desc"); setPage(1);
  };

  // 활성 필터 목록
  const activeFilters: { label: string; clear: () => void }[] = [];
  if (monthFrom) activeFilters.push({ label: `시작: ${monthFrom}`, clear: () => setMonthFrom("") });
  if (monthTo) activeFilters.push({ label: `종료: ${monthTo}`, clear: () => setMonthTo("") });
  if (category) activeFilters.push({ label: category, clear: () => { setCategory(""); setSubcategory(""); } });
  if (subcategory) activeFilters.push({ label: subcategory, clear: () => setSubcategory("") });
  if (direction) activeFilters.push({ label: direction, clear: () => setDirection("") });
  if (keyword) activeFilters.push({ label: `"${keyword}"`, clear: () => setKeyword("") });

  // 분류 모달 열기
  const openEditModal = async (tx: Transaction) => {
    setEditTx(tx);
    setEditMajor(tx.major_category || "");
    setEditMinor(tx.minor_category || "");
    setApplyAll(true);
    // 같은 적요 건수 조회
    if (tx.description) {
      try {
        const res = await fetch(`/api/transactions/${tx.id}/../same-desc?desc=${encodeURIComponent(tx.description)}`);
        // 간단히 카운트만
        setSameDescCount(0); // API 없으면 기본값
      } catch { setSameDescCount(0); }
    }
  };

  const saveClassify = async () => {
    if (!editTx) return;
    setSaving(true);
    await fetch(`/api/transactions/${editTx.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        major_category: editMajor, minor_category: editMinor,
        apply_all: applyAll, auto_register: true,
      }),
    });
    setSaving(false);
    setEditTx(null);
    fetchData();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">거래내역</h1>

      {/* 필터 바 */}
      <Card>
        <CardContent className="pt-3 pb-2 space-y-2">
          {/* 1행: 프리셋 + 기간 + 검색 */}
          <div className="flex flex-wrap items-center gap-2">
            {(["", "1m", "3m", "6m", "1y"] as Preset[]).map(pr => (
              <Button key={pr} variant={preset === pr ? "default" : "outline"} size="sm" className="h-7 text-xs px-2.5"
                onClick={() => applyPreset(pr)}>
                {{ "": "전체", "1m": "1개월", "3m": "3개월", "6m": "6개월", "1y": "1년" }[pr]}
              </Button>
            ))}
            <span className="text-gray-300">|</span>
            <Select value={monthFrom || "all"} onValueChange={v => { setMonthFrom(!v || v === "all" ? "" : v); setPreset(""); setPage(1); }}>
              <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="시작월" /></SelectTrigger>
              <SelectContent>{data?.months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-gray-400 text-xs">~</span>
            <Select value={monthTo || "all"} onValueChange={v => { setMonthTo(!v || v === "all" ? "" : v); setPreset(""); setPage(1); }}>
              <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="종료월" /></SelectTrigger>
              <SelectContent>{data?.months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
              <Input className="pl-7 h-7 text-xs" placeholder="적요, 거래처, 분류 검색..." value={keyword}
                onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchData()} />
            </div>
          </div>

          {/* 2행: 방향 + 카테고리 토글 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* 방향 */}
            {["", "입금", "출금"].map(d => (
              <Button key={d} variant={direction === d ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2"
                onClick={() => { setDirection(d); setPage(1); }}>
                {d || "전체"}
              </Button>
            ))}
            <span className="text-gray-200 mx-1">|</span>
            {/* 카테고리 토글 */}
            {ALL_CATS.map(c => (
              <button key={c} onClick={() => { setCategory(category === c ? "" : c); setSubcategory(""); setPage(1); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  category === c
                    ? `${CAT_COLORS[c] || "bg-gray-100 text-gray-700"} border-transparent font-medium`
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}>{c}</button>
            ))}
            {/* 중분류 (대분류 선택 시) */}
            {category && data?.categories[category]?.length ? (
              <>
                <span className="text-gray-200 mx-1">›</span>
                <Select value={subcategory || "all"} onValueChange={v => { setSubcategory(!v || v === "all" ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-6 w-24 text-[10px]"><SelectValue placeholder="중분류" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    {data.categories[category].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>

          {/* 활성 필터 태그 + KPI */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {activeFilters.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] gap-1 pr-1">
                  {f.label}
                  <button onClick={() => { f.clear(); setPage(1); }} className="hover:text-red-500"><X size={10} /></button>
                </Badge>
              ))}
            </div>
            {data && (
              <div className="flex gap-3 text-[11px] text-gray-500">
                <span>{data.total.toLocaleString()}건</span>
                <span className="text-green-600">입금 {fmt(data.summary.total_in)}</span>
                <span className="text-red-500">출금 {fmt(data.summary.total_out)}</span>
                <span className={data.summary.total_in - data.summary.total_out >= 0 ? "text-blue-600" : "text-red-600"}>
                  순 {fmt(data.summary.total_in - data.summary.total_out)}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 테이블 */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px] cursor-pointer" onClick={() => toggleSort("date")}>
                    <span className="flex items-center gap-1">날짜 <ArrowUpDown size={11} /></span>
                  </TableHead>
                  <TableHead className="w-[50px]">유형</TableHead>
                  <TableHead>적요</TableHead>
                  <TableHead>거래처</TableHead>
                  <TableHead className="text-right w-[100px] cursor-pointer" onClick={() => toggleSort("amount_in")}>
                    <span className="flex items-center justify-end gap-1">입금 <ArrowUpDown size={11} /></span>
                  </TableHead>
                  <TableHead className="text-right w-[100px] cursor-pointer" onClick={() => toggleSort("amount_out")}>
                    <span className="flex items-center justify-end gap-1">출금 <ArrowUpDown size={11} /></span>
                  </TableHead>
                  <TableHead className="w-[150px]">분류</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">로딩 중...</TableCell></TableRow>
                ) : !data?.rows.length ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">검색 결과 없음</TableCell></TableRow>
                ) : data.rows.map(tx => (
                  <TableRow key={tx.id} className="hover:bg-gray-50 group">
                    <TableCell className="text-xs text-gray-600 whitespace-nowrap">{tx.date.substring(0, 10)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px] px-1">{tx.type}</Badge></TableCell>
                    <TableCell className="text-sm max-w-[220px]">
                      <div className="flex items-center gap-1">
                        <span className="truncate" title={tx.description}>{tx.description}</span>
                        {/* 태그 */}
                        {tx.memo?.includes("[자동]") && <Badge className="bg-sky-100 text-sky-600 text-[8px] px-0.5">자동</Badge>}
                        {tx.memo?.includes("[자체이체]") && <Badge className="bg-blue-100 text-blue-600 text-[8px] px-0.5">이체</Badge>}
                        {tx.memo && !tx.memo.includes("[") && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1 rounded" title={tx.memo}>M</span>}
                      </div>
                      {/* 자체이체 경로 */}
                      {tx.major_category === "자체이체" && (
                        <div className="text-[10px] text-blue-500 mt-0.5 flex items-center gap-1">
                          <ArrowRight size={10} /> 자체이체
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500 max-w-[120px] truncate">{tx.merchant}</TableCell>
                    <TableCell className="text-right text-sm">
                      {tx.amount_in > 0 && <span className="text-green-600">{fmt(tx.amount_in)}</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {tx.amount_out > 0 && <span className="text-red-500">{fmt(tx.amount_out)}</span>}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => openEditModal(tx)} className="flex items-center gap-1 hover:opacity-80 w-full">
                        {tx.major_category && (
                          <Badge className={`text-[9px] px-1 ${CAT_COLORS[tx.major_category] || "bg-gray-100 text-gray-600"}`}>
                            {tx.major_category}
                          </Badge>
                        )}
                        <span className="text-[10px] text-gray-500 truncate">{tx.minor_category || "-"}</span>
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 페이지네이션 */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t">
              <span className="text-[11px] text-gray-500">
                {data.total.toLocaleString()}건 중 {(data.page - 1) * data.perPage + 1}~{Math.min(data.page * data.perPage, data.total)}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="text-xs text-gray-600">{data.page} / {data.totalPages}</span>
                <Button variant="outline" size="sm" className="h-7" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 분류 변경 모달 */}
      <Dialog open={!!editTx} onOpenChange={() => setEditTx(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">분류 변경</DialogTitle>
          </DialogHeader>
          {editTx && (
            <div className="space-y-4">
              {/* 거래 정보 */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">날짜</span>
                  <span>{editTx.date.substring(0, 10)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">적요</span>
                  <span className="text-right max-w-[200px] truncate">{editTx.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">금액</span>
                  <span className={editTx.amount_out > 0 ? "text-red-500" : "text-green-600"}>
                    {editTx.amount_out > 0 ? fmt(editTx.amount_out) : fmt(editTx.amount_in)}
                  </span>
                </div>
              </div>

              {/* 대분류 선택 */}
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">대분류</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {["고정비", "변동비", "수입", "자체이체", "카드대금", "가수금", "가지급금", "미분류"].map(c => (
                    <button key={c} onClick={() => { setEditMajor(c); setEditMinor(""); }}
                      className={`text-xs py-1.5 rounded-md border transition-colors ${
                        editMajor === c
                          ? `${CAT_COLORS[c] || "bg-gray-200"} border-transparent font-medium`
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}>{c}</button>
                  ))}
                </div>
              </div>

              {/* 중분류 선택 */}
              {editMajor && data?.categories[editMajor]?.length ? (
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">중분류</label>
                  <div className="flex flex-wrap gap-1.5">
                    {data.categories[editMajor].map(s => (
                      <button key={s} onClick={() => setEditMinor(s)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          editMinor === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 같은 적요 일괄 적용 */}
              {editTx.description && (
                <label className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 p-2 rounded-md cursor-pointer">
                  <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)}
                    className="rounded border-gray-300" />
                  같은 적요 &quot;{editTx.description.substring(0, 20)}{editTx.description.length > 20 ? "..." : ""}&quot; 모두 적용
                </label>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditTx(null)}>취소</Button>
                <Button size="sm" onClick={saveClassify} disabled={!editMajor || saving} className="gap-1">
                  {saving ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                  적용
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
