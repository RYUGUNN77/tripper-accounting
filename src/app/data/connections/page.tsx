"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Plus, RefreshCw, CheckCircle, XCircle, Clock,
  Loader2, Download, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { OnboardingModal } from "@/components/codef/OnboardingModal";

interface Connection {
  id: number;
  institution_code: string;
  institution_name: string;
  business_type: string;
  status: string;
  connected_id: string | null;
  connected_at: string;
  last_synced_at: string | null;
  error_message: string | null;
}

interface SyncHistory {
  id: number;
  institution_code: string;
  institution_name: string;
  start_date: string;
  end_date: string;
  imported: number;
  skipped: number;
  status: string;
  error_message: string | null;
  synced_at: string;
}

interface StatusData {
  hasConnectedId: boolean;
  connectedId: string | null;
  ibkAccount: string | null;
  connections: Connection[];
  lastSync: Record<string, unknown> | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  connected: { label: "연결됨", color: "bg-green-100 text-green-700", icon: CheckCircle },
  error: { label: "오류", color: "bg-red-100 text-red-700", icon: XCircle },
  pending: { label: "대기", color: "bg-gray-100 text-gray-600", icon: Clock },
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

export default function ConnectionsPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [history, setHistory] = useState<SyncHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 동기화 날짜 범위
  const [syncStartDate, setSyncStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  });
  const [syncEndDate, setSyncEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/codef/status"),
        fetch("/api/codef/sync-history?limit=20"),
      ]);
      setStatus(await statusRes.json());
      const historyData = await historyRes.json();
      setHistory(historyData.history || []);
    } catch {
      toast.error("데이터 로딩 실패");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 거래내역 동기화
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/codef/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: syncStartDate, endDate: syncEndDate }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        const msg = [`신규 ${data.imported}건`, `중복 ${data.skipped}건`];
        if (data.errors?.length) msg.push(`오류 ${data.errors.length}건`);
        toast.success(`동기화 완료: ${msg.join(", ")}`);

        if (data.errors?.length) {
          for (const err of data.errors) {
            toast.warning(err);
          }
        }

        fetchData();
      }
    } catch {
      toast.error("동기화 실패");
    }
    setSyncing(false);
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        로딩 중...
      </div>
    );
  }

  const connectedCount = status?.connections.filter((c) => c.status === "connected").length ?? 0;

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">연결기관 관리</h1>
          <p className="text-sm text-gray-500">Codef API 기반 금융기관 자동 연결</p>
        </div>
        <Button onClick={() => setShowOnboarding(true)} className="gap-2">
          <Plus size={16} /> 기관 연결
        </Button>
      </div>

      {/* 연결 없을 때 안내 */}
      {!status?.hasConnectedId && (
        <Card className="border-dashed border-2 border-blue-200 bg-blue-50/50">
          <CardContent className="flex flex-col items-center py-10 gap-4">
            <Building2 size={48} className="text-blue-400" />
            <div className="text-center">
              <p className="font-medium text-gray-700">아직 연결된 금융기관이 없습니다</p>
              <p className="text-sm text-gray-500 mt-1">
                공인인증서 하나로 기업은행, BC카드, 삼성카드를 한번에 연결하세요
              </p>
            </div>
            <Button onClick={() => setShowOnboarding(true)} size="lg" className="gap-2">
              <Plus size={18} /> 지금 연결하기
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 연결된 기관 목록 */}
      {status?.connections && status.connections.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                연결 기관 <Badge variant="outline" className="ml-2">{connectedCount}개</Badge>
              </CardTitle>
              {status.connectedId && (
                <span className="text-[10px] text-gray-400 font-mono">
                  ID: {status.connectedId.slice(0, 12)}...
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {status.connections.map((conn) => {
                const s = STATUS_MAP[conn.status] || STATUS_MAP.pending;
                const Icon = s.icon;
                return (
                  <div
                    key={conn.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200"
                  >
                    <div className={`p-2 rounded-lg ${s.color}`}>
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{conn.institution_name}</p>
                      <p className="text-[10px] text-gray-400">
                        {conn.last_synced_at
                          ? `마지막 동기화: ${conn.last_synced_at}`
                          : `연결: ${conn.connected_at}`}
                      </p>
                      {conn.error_message && (
                        <p className="text-[10px] text-red-500 truncate">{conn.error_message}</p>
                      )}
                    </div>
                    <Badge className={`text-[9px] ${s.color}`}>{s.label}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 동기화 */}
      {status?.hasConnectedId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Download size={16} className="text-blue-500" />
              거래내역 동기화
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">시작일</label>
                <Input
                  className="w-32 h-8 text-sm"
                  placeholder="YYYYMMDD"
                  value={syncStartDate}
                  onChange={(e) => setSyncStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">종료일</label>
                <Input
                  className="w-32 h-8 text-sm"
                  placeholder="YYYYMMDD"
                  value={syncEndDate}
                  onChange={(e) => setSyncEndDate(e.target.value)}
                />
              </div>
              <Button
                onClick={handleSync}
                disabled={syncing || !syncStartDate || !syncEndDate}
                className="gap-2 h-8"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {syncing ? "동기화 중..." : "동기화 실행"}
              </Button>
              {status.ibkAccount && (
                <span className="text-[10px] text-gray-400">
                  기업은행 계좌: {status.ibkAccount}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 동기화 이력 */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} className="text-gray-500" />
              동기화 이력
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>기관</TableHead>
                  <TableHead>기간</TableHead>
                  <TableHead className="text-right">신규</TableHead>
                  <TableHead className="text-right">중복</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm font-medium">{h.institution_name}</TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatDate(h.start_date)} ~ {formatDate(h.end_date)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-green-600">
                      {h.imported > 0 ? `+${h.imported}` : "0"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-gray-400">{h.skipped}</TableCell>
                    <TableCell>
                      {h.status === "success" ? (
                        <Badge className="bg-green-100 text-green-700 text-[9px]">성공</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 text-[9px] gap-1">
                          <AlertTriangle size={8} /> 오류
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-[10px] text-gray-400 whitespace-nowrap">
                      {h.synced_at}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 온보딩 모달 */}
      <OnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onSuccess={fetchData}
      />
    </div>
  );
}
