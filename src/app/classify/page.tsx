"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tags, CheckCircle, Loader2, Search, ChevronDown, ChevronUp,
  Undo2, Check,
} from "lucide-react";
import { toast } from "sonner";

interface Group {
  desc: string; count: number; total_in: number; total_out: number;
  first_date: string; last_date: string;
}
interface ClassifyData {
  groups: Group[]; total: number; groupCount: number;
  categories: Record<string, string[]>;
}

const CAT_COLORS: Record<string, string> = {
  "고정비": "bg-purple-100 text-purple-700 border-purple-200",
  "변동비": "bg-amber-100 text-amber-700 border-amber-200",
  "수입": "bg-green-100 text-green-700 border-green-200",
  "자체이체": "bg-blue-100 text-blue-700 border-blue-200",
  "카드대금": "bg-pink-100 text-pink-700 border-pink-200",
  "가수금": "bg-orange-100 text-orange-700 border-orange-200",
  "가지급금": "bg-teal-100 text-teal-700 border-teal-200",
  "미분류": "bg-red-100 text-red-700 border-red-200",
};

function fmt(v: number) { return v === 0 ? "" : `₩${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`; }

type SortKey = "count" | "amount" | "name";

export default function ClassifyPage() {
  const [data, setData] = useState<ClassifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 검색/정렬
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("count");

  // 선택 상태
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 우측 패널: 분류 선택
  const [major, setMajor] = useState("");
  const [minor, setMinor] = useState("");
  const [autoRegister, setAutoRegister] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/transactions/classify");
    const d = await res.json();
    setData(d);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 필터 + 정렬
  const filteredGroups = useMemo(() => {
    if (!data) return [];
    let groups = data.groups;
    if (search) {
      const kw = search.toLowerCase();
      groups = groups.filter(g => g.desc.toLowerCase().includes(kw));
    }
    if (sortBy === "amount") {
      groups = [...groups].sort((a, b) => (b.total_out + b.total_in) - (a.total_out + a.total_in));
    } else if (sortBy === "name") {
      groups = [...groups].sort((a, b) => a.desc.localeCompare(b.desc));
    }
    // count는 기본 정렬
    return groups;
  }, [data, search, sortBy]);

  const toggleSelect = (desc: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(desc) ? n.delete(desc) : n.add(desc); return n; });
  };

  const selectAll = () => {
    if (selected.size === filteredGroups.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredGroups.map(g => g.desc)));
    }
  };

  const toggleExpand = (desc: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(desc) ? n.delete(desc) : n.add(desc); return n; });
  };

  const selectedCount = selected.size;
  const selectedTxCount = filteredGroups.filter(g => selected.has(g.desc)).reduce((s, g) => s + g.count, 0);

  const handleApply = async () => {
    if (!major || selectedCount === 0) return;
    setSaving(true);

    const items = filteredGroups
      .filter(g => selected.has(g.desc))
      .map(g => ({ desc: g.desc, major, minor }));

    const res = await fetch("/api/transactions/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, auto_register: autoRegister }),
    });
    const d = await res.json();
    setSaving(false);

    if (d.ok) {
      toast.success(`${d.changed}건 분류 완료`, {
        description: `${items.length}개 그룹 → ${major}/${minor}`,
        action: {
          label: "↩ 되돌리기",
          onClick: async () => {
            if (d.log_id) {
              await fetch("/api/logs/undo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: d.log_id }),
              });
              fetchData();
              toast.info("되돌리기 완료");
            }
          },
        },
      });
      setSelected(new Set());
      setMajor(""); setMinor("");
      fetchData();
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div className="flex gap-4 h-[calc(100vh-5rem)]">
      {/* 좌측: 그룹 목록 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">미분류 일괄 분류</h1>
            <p className="text-xs text-gray-500">{data?.total || 0}건 미분류 · {data?.groupCount || 0}개 그룹</p>
          </div>
        </div>

        {/* 검색/정렬/전체선택 */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
            <Input className="pl-7 h-7 text-xs" placeholder="적요 검색..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={sortBy} onValueChange={v => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">건수순</SelectItem>
              <SelectItem value="amount">금액순</SelectItem>
              <SelectItem value="name">이름순</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={selectAll}>
            {selected.size === filteredGroups.length ? "선택 해제" : `전체 선택 (${filteredGroups.length})`}
          </Button>
        </div>

        {/* 그룹 리스트 */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {(!data || filteredGroups.length === 0) ? (
            <Card><CardContent className="py-12 text-center text-gray-400">
              <CheckCircle size={48} className="mx-auto mb-4 text-green-400" />
              <p className="text-lg font-medium text-gray-600">모든 거래가 분류되었습니다!</p>
            </CardContent></Card>
          ) : filteredGroups.map(g => (
            <Card key={g.desc} className={`transition-colors ${selected.has(g.desc) ? "border-blue-300 bg-blue-50/40" : ""}`}>
              <CardContent className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.has(g.desc)}
                    onChange={() => toggleSelect(g.desc)} className="rounded border-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleSelect(g.desc)}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900 truncate">{g.desc}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">{g.count}건</Badge>
                    </div>
                    <div className="flex gap-3 text-[10px] text-gray-400 mt-0.5">
                      <span>{g.first_date.substring(0, 10)} ~ {g.last_date.substring(0, 10)}</span>
                      {g.total_out > 0 && <span className="text-red-400">출금 {fmt(g.total_out)}</span>}
                      {g.total_in > 0 && <span className="text-green-500">입금 {fmt(g.total_in)}</span>}
                    </div>
                  </div>
                  <button onClick={() => toggleExpand(g.desc)} className="text-gray-400 hover:text-gray-600 shrink-0">
                    {expanded.has(g.desc) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
                {/* 펼침: 샘플 거래 */}
                {expanded.has(g.desc) && (
                  <div className="mt-2 pt-2 border-t text-[11px] text-gray-500">
                    <p className="mb-1 font-medium">최근 거래 (최대 5건)</p>
                    <p className="text-gray-400 italic">상세 보기는 거래내역 페이지에서 확인</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 우측: 분류 패널 (Sticky) */}
      <div className="w-64 shrink-0">
        <Card className="sticky top-6">
          <CardContent className="pt-4 pb-3 space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-900">분류 적용</p>
              {selectedCount > 0 ? (
                <p className="text-xs text-gray-500 mt-0.5">{selectedCount}개 그룹 · {selectedTxCount}건</p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">그룹을 선택하세요</p>
              )}
            </div>

            {/* 대분류 그리드 */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">대분류</label>
              <div className="grid grid-cols-2 gap-1">
                {Object.keys(CAT_COLORS).map(c => (
                  <button key={c} onClick={() => { setMajor(c); setMinor(""); }}
                    className={`text-[10px] py-1.5 rounded border transition-colors ${
                      major === c ? `${CAT_COLORS[c]} font-medium` : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                    }`}>{c}</button>
                ))}
              </div>
            </div>

            {/* 중분류 */}
            {major && data?.categories[major]?.length ? (
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">중분류</label>
                <div className="flex flex-wrap gap-1">
                  {data.categories[major].map(s => (
                    <button key={s} onClick={() => setMinor(s)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        minor === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                      }`}>{s}</button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 키워드 자동 등록 */}
            <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={autoRegister} onChange={e => setAutoRegister(e.target.checked)}
                className="rounded border-gray-300" />
              분류 규칙에 자동 등록
            </label>

            {/* 적용 버튼 */}
            <Button onClick={handleApply} disabled={saving || selectedCount === 0 || !major}
              className="w-full gap-1" size="sm">
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Tags size={14} />}
              {selectedCount > 0 ? `${selectedCount}개 그룹 적용` : "그룹 선택 필요"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
