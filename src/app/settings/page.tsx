"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Save, RotateCcw, Link, RefreshCw, CheckCircle2, Upload, FileCheck } from "lucide-react";
import { toast } from "sonner";

interface AppSettings {
  transactions: { apply_same_desc_checked: boolean; rows_per_page: number };
  classification: { apply_both_directions: boolean; auto_register_keyword: boolean; auto_classify_on_import: boolean };
  backup: { auto_backup_on_start: boolean; max_backups: number };
  display: { date_format: string; sidebar_collapsed: boolean };
}

const DEFAULTS: AppSettings = {
  transactions: { apply_same_desc_checked: true, rows_per_page: 0 },
  classification: { apply_both_directions: true, auto_register_keyword: true, auto_classify_on_import: true },
  backup: { auto_backup_on_start: true, max_backups: 20 },
  display: { date_format: "YYYY-MM-DD", sidebar_collapsed: false },
};

// ─── Codef 연동 상태 ─────────────────────────────────────────────────────────
interface CodefStatus { connected: boolean; connectedId: string | null; ibkAccount: string | null; }

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // data:...;base64,XXX → XXX
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const INSTITUTIONS = [
  { key: "ibk", label: "기업은행 (IBK)", desc: "법인 계좌" },
  { key: "samsungCard", label: "삼성카드", desc: "법인카드" },
  { key: "bcCard", label: "BC카드", desc: "법인카드" },
] as const;

function CodefSection() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fiveYearsAgo = String(new Date().getFullYear() - 5) + "0101";

  const [status, setStatus] = useState<CodefStatus>({ connected: false, connectedId: null, ibkAccount: null });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [selectedInstitutions, setSelectedInstitutions] = useState<string[]>(["ibk", "samsungCard"]);
  const [ibkAccount, setIbkAccount] = useState("");
  const [syncStart, setSyncStart] = useState(fiveYearsAgo);
  const [syncEnd, setSyncEnd] = useState(today);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/codef/connect").then(r => r.json()).then(setStatus);
  }, []);

  const toggleInstitution = (key: string) => {
    setSelectedInstitutions(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const connect = async () => {
    if (!certFile || !keyFile) {
      toast.error("인증서 파일(signCert.der, signPri.key)을 모두 선택해주세요");
      return;
    }
    if (!certPassword) {
      toast.error("인증서 비밀번호를 입력해주세요");
      return;
    }
    if (selectedInstitutions.length === 0) {
      toast.error("최소 1개 이상의 기관을 선택해주세요");
      return;
    }

    setConnecting(true);
    try {
      const [certB64, keyB64] = await Promise.all([
        readFileAsBase64(certFile),
        readFileAsBase64(keyFile),
      ]);

      const res = await fetch("/api/codef/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certFile: certB64,
          keyFile: keyB64,
          certPassword,
          institutions: selectedInstitutions,
          ibkAccount: ibkAccount || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Connected ID 등록 완료: ${data.connectedId}`);
      setStatus({ connected: true, connectedId: data.connectedId, ibkAccount: ibkAccount || null });
      setCertPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "연결 실패");
    } finally {
      setConnecting(false);
    }
  };

  const sync = async () => {
    if (!syncStart || !syncEnd) {
      toast.error("동기화 날짜 범위를 입력하세요");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/codef/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: syncStart, endDate: syncEnd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const errMsg = data.errors?.length ? ` (오류: ${data.errors.join(", ")})` : "";
      toast.success(`동기화 완료 — 신규 ${data.imported}건, 중복 ${data.skipped}건 건너뜀${errMsg}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          API 연동 (Codef)
          {status.connected && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-normal">
              <CheckCircle2 size={13} /> 연결됨
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.connected && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-800 space-y-0.5">
            <p>Connected ID: <span className="font-mono">{status.connectedId}</span></p>
            {status.ibkAccount && <p>기업은행 계좌: {status.ibkAccount}</p>}
          </div>
        )}

        {/* 인증서 파일 선택 */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">공동인증서</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 border rounded-md px-3 h-8 text-sm cursor-pointer hover:bg-gray-50">
              {certFile ? <FileCheck size={14} className="text-green-600 shrink-0" /> : <Upload size={14} className="text-gray-400 shrink-0" />}
              <span className="truncate text-gray-600">{certFile ? certFile.name : "signCert.der 선택"}</span>
              <input type="file" accept=".der" className="hidden" onChange={e => setCertFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="flex items-center gap-2 border rounded-md px-3 h-8 text-sm cursor-pointer hover:bg-gray-50">
              {keyFile ? <FileCheck size={14} className="text-green-600 shrink-0" /> : <Upload size={14} className="text-gray-400 shrink-0" />}
              <span className="truncate text-gray-600">{keyFile ? keyFile.name : "signPri.key 선택"}</span>
              <input type="file" accept=".key" className="hidden" onChange={e => setKeyFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <Input
            type="password"
            placeholder="인증서 비밀번호"
            value={certPassword}
            onChange={e => setCertPassword(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* 연동 기관 선택 */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">연동 기관</p>
          <div className="space-y-1.5">
            {INSTITUTIONS.map(inst => (
              <label key={inst.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedInstitutions.includes(inst.key)}
                  onChange={() => toggleInstitution(inst.key)}
                  className="rounded"
                />
                <span>{inst.label}</span>
                <span className="text-xs text-gray-400">({inst.desc})</span>
              </label>
            ))}
          </div>
        </div>

        {/* 기업은행 계좌번호 */}
        {selectedInstitutions.includes("ibk") && (
          <Input
            placeholder="기업은행 법인계좌번호 (하이픈 없이)"
            value={ibkAccount}
            onChange={e => setIbkAccount(e.target.value)}
            className="h-8 text-sm"
          />
        )}

        <Button onClick={connect} disabled={connecting} className="w-full gap-2" variant="outline">
          <Link size={14} /> {connecting ? "등록 중..." : (status.connected ? "재연동" : "Connected ID 등록")}
        </Button>

        {/* 동기화 */}
        {status.connected && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-sm font-medium text-gray-700">거래내역 동기화</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-gray-500 mb-1">시작일 (YYYYMMDD)</p>
                <Input value={syncStart} onChange={e => setSyncStart(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">종료일 (YYYYMMDD)</p>
                <Input value={syncEnd} onChange={e => setSyncEnd(e.target.value)} className="h-8 text-sm font-mono" />
              </div>
            </div>
            <Button onClick={sync} disabled={syncing} className="w-full gap-2">
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "동기화 중..." : "거래내역 동기화"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(d => {
      setSettings({ ...DEFAULTS, ...d });
      setLoading(false);
    });
  }, []);

  const update = <S extends keyof AppSettings, K extends keyof AppSettings[S]>(
    section: S, key: K, value: AppSettings[S][K]
  ) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const save = async () => {
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    toast.success("설정이 저장되었습니다");
  };

  const reset = () => {
    setSettings(DEFAULTS);
    toast.info("기본값으로 초기화되었습니다. 저장을 눌러 적용하세요.");
  };

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">설정</h1>

      {/* 거래내역 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">거래내역</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="같은 적요 모두 적용 기본 체크" description="거래 분류 시 같은 적요의 모든 거래에 일괄 적용 체크박스 기본값">
            <Switch checked={settings.transactions.apply_same_desc_checked}
              onCheckedChange={v => update("transactions", "apply_same_desc_checked", v)} />
          </SettingRow>
          <SettingRow label="페이지당 표시 행 수" description="0 = 전체 표시">
            <Input type="number" className="w-20 h-8 text-sm text-right" min={0} max={1000}
              value={settings.transactions.rows_per_page}
              onChange={e => update("transactions", "rows_per_page", parseInt(e.target.value) || 0)} />
          </SettingRow>
        </CardContent>
      </Card>

      {/* 일괄 분류 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">일괄 분류</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="입금/출금 동시 적용" description="일괄분류 시 입금/출금 거래 모두에 적용">
            <Switch checked={settings.classification.apply_both_directions}
              onCheckedChange={v => update("classification", "apply_both_directions", v)} />
          </SettingRow>
          <SettingRow label="분류 규칙(키워드) 자동 등록" description="분류 시 적요를 키워드로 자동 등록하여 다음부터 자동 분류">
            <Switch checked={settings.classification.auto_register_keyword}
              onCheckedChange={v => update("classification", "auto_register_keyword", v)} />
          </SettingRow>
          <SettingRow label="업로드 시 자동 분류" description="파일 업로드 후 등록된 규칙으로 자동 분류 실행">
            <Switch checked={settings.classification.auto_classify_on_import}
              onCheckedChange={v => update("classification", "auto_classify_on_import", v)} />
          </SettingRow>
        </CardContent>
      </Card>

      {/* 백업 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">백업</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="서버 시작 시 자동 백업" description="앱 시작 시 마스터 데이터를 자동으로 백업">
            <Switch checked={settings.backup.auto_backup_on_start}
              onCheckedChange={v => update("backup", "auto_backup_on_start", v)} />
          </SettingRow>
          <SettingRow label="최대 백업 수" description="이 수를 초과하면 오래된 백업부터 자동 삭제">
            <Input type="number" className="w-20 h-8 text-sm text-right" min={1} max={100}
              value={settings.backup.max_backups}
              onChange={e => update("backup", "max_backups", parseInt(e.target.value) || 20)} />
          </SettingRow>
        </CardContent>
      </Card>

      {/* 표시 */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">표시</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="날짜 표시 형식" description="거래내역 등에서 날짜를 표시하는 형식">
            <Select value={settings.display.date_format}
              onValueChange={v => v && update("display", "date_format", v)}>
              <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                <SelectItem value="YYYY.MM.DD">YYYY.MM.DD</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Codef API 연동 */}
      <CodefSection />

      {/* 저장/초기화 (Sticky) */}
      <div className="sticky bottom-0 bg-gray-50 py-3 flex justify-end gap-3 border-t -mx-6 px-6">
        <Button variant="outline" onClick={reset} className="gap-1">
          <RotateCcw size={14} /> 초기화
        </Button>
        <Button onClick={save} disabled={saving} className="gap-1">
          <Save size={14} /> {saving ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}

function SettingRow({ label, description, children }: {
  label: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
