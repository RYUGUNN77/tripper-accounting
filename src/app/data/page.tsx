"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, CheckCircle, AlertCircle, FileSpreadsheet, Loader2,
  Trash2, Plus, Undo2, Database, Clock,
} from "lucide-react";
import { toast } from "sonner";

type ColumnField = "거래일자" | "입금액" | "출금액" | "금액" | "잔액" | "적요" | "거래처" | "카드번호" | "무시";

interface Preview {
  headers: string[]; rows: string[][]; totalRows: number;
  headerRow: number; sheetName: string;
  suggestedMapping: Record<string, ColumnField> | null;
  presetName: string | null; autoDetected: boolean;
}

interface DataInfo {
  total: number; dateRange: { min_date: string; max_date: string };
  classified: number; unclassified: number; classifyRate: string;
  fileStats: { source_file: string; cnt: number; min_date: string; max_date: string; imported_at: string }[];
  monthlyStats: { month: string; cnt: number; income: number; expense: number }[];
  typeStats: { type: string; cnt: number }[];
  accounts: { id: number; name: string; number: string }[];
  keywords: { id: number; keyword: string }[];
}

interface LogEntry {
  id: string; timestamp: string; action: string; detail: string; count: number; has_undo: number;
}

const FIELD_OPTIONS: { value: ColumnField; label: string }[] = [
  { value: "거래일자", label: "거래일자" }, { value: "입금액", label: "입금액" },
  { value: "출금액", label: "출금액" }, { value: "금액", label: "금액(단일)" },
  { value: "잔액", label: "잔액" }, { value: "적요", label: "적요" },
  { value: "거래처", label: "거래처" }, { value: "카드번호", label: "카드번호" },
  { value: "무시", label: "무시" },
];

const ACTION_ICONS: Record<string, string> = {
  "분류 변경": "🏷️", "메모 수정": "📝", "파일 업로드": "📤", "파일 삭제": "🗑️",
  "백업 생성": "💾", "백업 복원": "🔄", "일괄 분류": "📦", "되돌리기": "↩️",
};

function fmt(v: number) { return `₩${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`; }

export default function DataPage() {
  const [activeTab, setActiveTab] = useState("upload");

  // 업로드 상태
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ColumnField>>({});
  const [uploading, setUploading] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [uploadResult, setUploadResult] = useState<{ newCount: number; dupCount: number; internalCount: number } | null>(null);
  const [uploadError, setUploadError] = useState("");

  // 데이터 현황
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // 계좌/키워드 추가 폼
  const [newAccName, setNewAccName] = useState("");
  const [newAccNum, setNewAccNum] = useState("");
  const [newKeyword, setNewKeyword] = useState("");

  const fetchInfo = useCallback(async () => {
    const [dataRes, logsRes] = await Promise.all([
      fetch("/api/data"), fetch("/api/logs?limit=50"),
    ]);
    setInfo(await dataRes.json());
    const logData = await logsRes.json();
    setLogs(logData.logs || []);
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // 파일 업로드 → 미리보기
  const handleFile = useCallback(async (f: File) => {
    setFile(f); setUploadResult(null); setUploadError("");
    setUploading(true);
    const fd = new FormData(); fd.append("file", f);
    try {
      const res = await fetch("/api/transactions/import?action=preview", { method: "POST", body: fd });
      const d = await res.json();
      if (d.ok) {
        setPreview(d.preview);
        setMapping(d.preview.suggestedMapping || {});
        if (d.preview.presetName) setPresetName(d.preview.presetName);
      } else { setUploadError(d.error); }
    } catch { setUploadError("서버 오류"); }
    setUploading(false);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setUploading(true); setUploadError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));
    fd.append("headerRow", String(preview?.headerRow || 0));
    if (presetName && !preview?.presetName) fd.append("presetName", presetName);

    try {
      const res = await fetch("/api/transactions/import?action=import", { method: "POST", body: fd });
      const d = await res.json();
      if (d.ok) {
        setUploadResult(d.result);
        setPreview(null); setFile(null);
        toast.success(`임포트 완료: 신규 ${d.result.newCount}건`);
        fetchInfo();
      } else { setUploadError(d.error); }
    } catch { setUploadError("서버 오류"); }
    setUploading(false);
  };

  const hasRequired = () => {
    const v = Object.values(mapping);
    return v.includes("거래일자") && (v.includes("입금액") || v.includes("출금액") || v.includes("금액"));
  };

  // 계좌/키워드 액션
  const accountAction = async (action: string, data: Record<string, string>) => {
    await fetch("/api/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
    });
    fetchInfo();
  };

  // 되돌리기
  const handleUndo = async (logId: string) => {
    const res = await fetch("/api/logs/undo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: logId }),
    });
    const d = await res.json();
    if (d.ok) { toast.success(`${d.restored}건 되돌리기 완료`); fetchInfo(); }
    else toast.error(d.error);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">데이터 관리</h1>

      {/* 통계 KPI */}
      {info && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-3 pb-2"><div className="text-[11px] text-gray-500">총 거래</div><div className="text-lg font-bold">{info.total.toLocaleString()}건</div></CardContent></Card>
          <Card><CardContent className="pt-3 pb-2"><div className="text-[11px] text-gray-500">기간</div><div className="text-sm font-medium">{info.dateRange.min_date?.substring(0,10)} ~ {info.dateRange.max_date?.substring(0,10)}</div></CardContent></Card>
          <Card><CardContent className="pt-3 pb-2"><div className="text-[11px] text-gray-500">분류율</div><div className="text-lg font-bold">{info.classifyRate}%</div><div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className="bg-green-500 h-1.5 rounded-full" style={{width: `${info.classifyRate}%`}} /></div></CardContent></Card>
          <Card><CardContent className="pt-3 pb-2"><div className="text-[11px] text-gray-500">미분류</div><div className="text-lg font-bold text-red-500">{info.unclassified}건</div></CardContent></Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload">파일 업로드</TabsTrigger>
          <TabsTrigger value="files">파일 목록</TabsTrigger>
          <TabsTrigger value="accounts">계좌/키워드</TabsTrigger>
          <TabsTrigger value="monthly">월별 현황</TabsTrigger>
          <TabsTrigger value="logs">변경 이력</TabsTrigger>
        </TabsList>

        {/* 파일 업로드 */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer hover:border-gray-300 border-gray-200`}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".xlsx,.xls,.csv,.tsv"; input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); }; input.click(); }}>
                {uploading ? (
                  <div className="flex flex-col items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={32} /><p>분석 중...</p></div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-400"><FileSpreadsheet size={32} /><p className="font-medium text-gray-600">엑셀/CSV 파일을 드래그하거나 클릭</p><p className="text-xs">.xlsx, .xls, .csv, .tsv</p></div>
                )}
              </div>
            </CardContent>
          </Card>

          {uploadError && <Card className="border-red-200 bg-red-50"><CardContent className="pt-4 flex items-center gap-2 text-red-700 text-sm"><AlertCircle size={16} />{uploadError}</CardContent></Card>}

          {uploadResult && (
            <Card className="border-green-200 bg-green-50"><CardContent className="pt-4 flex items-center gap-3 text-green-700 text-sm">
              <CheckCircle size={16} /><span>신규 <strong>{uploadResult.newCount}</strong>건</span>
              <span>중복 <strong>{uploadResult.dupCount}</strong>건 제외</span>
              {uploadResult.internalCount > 0 && <span>자체이체 <strong>{uploadResult.internalCount}</strong>건</span>}
            </CardContent></Card>
          )}

          {preview && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">미리보기</CardTitle>
                  <div className="flex items-center gap-2">
                    {preview.presetName && <Badge className="bg-blue-100 text-blue-700 text-[10px]">프리셋: {preview.presetName}</Badge>}
                    {preview.autoDetected ? <Badge className="bg-green-100 text-green-700 text-[10px]">자동 인식</Badge> : <Badge className="bg-amber-100 text-amber-700 text-[10px]">매핑 필요</Badge>}
                    <span className="text-[10px] text-gray-400">{preview.totalRows}행</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        {preview.headers.map((h, i) => (
                          <TableHead key={i} className="min-w-[120px] p-1">
                            <Select value={mapping[h] || "무시"} onValueChange={v => setMapping(p => ({ ...p, [h]: v as ColumnField }))}>
                              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                              <SelectContent>{FIELD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableHead>
                        ))}
                      </TableRow>
                      <TableRow>{preview.headers.map((h, i) => <TableHead key={i} className="text-[10px] whitespace-nowrap">{h}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row, i) => (
                        <TableRow key={i}>{row.map((c, j) => <TableCell key={j} className="text-[10px] whitespace-nowrap max-w-[180px] truncate">{c}</TableCell>)}</TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  {!preview.presetName && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-500 whitespace-nowrap">양식 이름:</label>
                      <Input className="h-7 w-36 text-xs" placeholder="예: 삼성카드" value={presetName} onChange={e => setPresetName(e.target.value)} />
                    </div>
                  )}
                  <div className="flex-1" />
                  {!hasRequired() && <span className="text-[10px] text-red-500">* 거래일자 + (입금/출금) 필수</span>}
                  <Button onClick={handleImport} disabled={uploading || !hasRequired()} size="sm" className="gap-1">
                    {uploading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />} 임포트
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 파일 목록 */}
        <TabsContent value="files">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>파일명</TableHead><TableHead className="text-right">건수</TableHead>
                <TableHead>기간</TableHead><TableHead>가져온 날짜</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {info?.fileStats.map(f => (
                  <TableRow key={f.source_file}>
                    <TableCell className="text-sm font-medium">{f.source_file}</TableCell>
                    <TableCell className="text-right text-sm">{f.cnt}건</TableCell>
                    <TableCell className="text-xs text-gray-500">{f.min_date?.substring(0,10)} ~ {f.max_date?.substring(0,10)}</TableCell>
                    <TableCell className="text-xs text-gray-400">{f.imported_at}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* 계좌/키워드 관리 */}
        <TabsContent value="accounts" className="space-y-4">
          {/* 자체 계좌 */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">자체 계좌</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>계좌명</TableHead><TableHead>계좌번호</TableHead><TableHead className="w-[60px]"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {info?.accounts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">{a.name}</TableCell>
                      <TableCell className="text-sm font-mono text-gray-600">{a.number}</TableCell>
                      <TableCell><button onClick={() => accountAction("delete_account", { number: a.number })} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex gap-2 mt-3">
                <Input className="h-7 text-xs flex-1" placeholder="계좌명" value={newAccName} onChange={e => setNewAccName(e.target.value)} />
                <Input className="h-7 text-xs flex-1" placeholder="계좌번호" value={newAccNum} onChange={e => setNewAccNum(e.target.value)} />
                <Button size="sm" className="h-7 gap-1" onClick={() => { accountAction("add_account", { name: newAccName, number: newAccNum }); setNewAccName(""); setNewAccNum(""); }}>
                  <Plus size={12} /> 추가
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 자체이체 키워드 */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">자체이체 키워드</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {info?.keywords.map((k: { id: number; keyword: string }) => (
                  <Badge key={k.id} variant="secondary" className="gap-1 pr-1">
                    {k.keyword}
                    <button onClick={() => accountAction("delete_keyword", { keyword: k.keyword })} className="hover:text-red-500"><Trash2 size={10} /></button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input className="h-7 text-xs flex-1" placeholder="키워드 입력" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} />
                <Button size="sm" className="h-7 gap-1" onClick={() => { accountAction("add_keyword", { keyword: newKeyword }); setNewKeyword(""); }}>
                  <Plus size={12} /> 추가
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 월별 현황 */}
        <TabsContent value="monthly">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>월</TableHead><TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">수입</TableHead><TableHead className="text-right">지출</TableHead>
                <TableHead className="text-right">순이익</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {info?.monthlyStats.map(m => {
                  const net = m.income - m.expense;
                  return (
                    <TableRow key={m.month}>
                      <TableCell className="text-sm font-medium">{m.month}</TableCell>
                      <TableCell className="text-right text-sm">{m.cnt}건</TableCell>
                      <TableCell className="text-right text-sm text-green-600">{fmt(m.income)}</TableCell>
                      <TableCell className="text-right text-sm text-red-500">{fmt(m.expense)}</TableCell>
                      <TableCell className={`text-right text-sm font-medium ${net >= 0 ? "text-blue-600" : "text-red-600"}`}>{fmt(net)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* 변경 이력 */}
        <TabsContent value="logs">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-[30px]"></TableHead><TableHead>동작</TableHead>
                <TableHead>상세</TableHead><TableHead className="text-right">건수</TableHead>
                <TableHead>시간</TableHead><TableHead className="w-[40px]"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {logs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="text-center">{ACTION_ICONS[log.action] || "📋"}</TableCell>
                    <TableCell className="text-sm font-medium">{log.action}</TableCell>
                    <TableCell className="text-xs text-gray-500 max-w-[200px] truncate">{log.detail}</TableCell>
                    <TableCell className="text-right text-xs">{log.count > 0 && <Badge variant="outline" className="text-[9px]">{log.count}</Badge>}</TableCell>
                    <TableCell className="text-[10px] text-gray-400 whitespace-nowrap">{log.timestamp}</TableCell>
                    <TableCell>
                      {log.has_undo ? (
                        <button onClick={() => handleUndo(log.id)} className="text-blue-500 hover:text-blue-700" title="되돌리기">
                          <Undo2 size={13} />
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
