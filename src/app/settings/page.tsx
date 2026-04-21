"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Save, RotateCcw } from "lucide-react";
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
