"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ShieldCheck, AlertCircle, CheckCircle, KeyRound, Building2,
} from "lucide-react";
import { toast } from "sonner";

interface CertInfo {
  path: string;
  cn: string;
  certFile: string;
  keyFile: string;
}

interface OnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = "cert" | "password" | "connecting" | "result";

interface ConnectionResult {
  institution: string;
  status: string;
  message: string;
}

export function OnboardingModal({ open, onOpenChange, onSuccess }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>("cert");
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [selectedCert, setSelectedCert] = useState<CertInfo | null>(null);
  const [password, setPassword] = useState("");
  const [ibkAccount, setIbkAccount] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ConnectionResult[]>([]);
  const [error, setError] = useState("");

  // 인증서 탐지
  const detectCerts = useCallback(async () => {
    try {
      const res = await fetch("/api/codef/certs");
      const data = await res.json();
      setCerts(data.certs || []);
      if (data.certs?.length === 1) {
        setSelectedCert(data.certs[0]);
      }
    } catch {
      setCerts([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep("cert");
      setPassword("");
      setError("");
      setResults([]);
      detectCerts();
    }
  }, [open, detectCerts]);

  // 연결 실행
  const handleConnect = async () => {
    if (!selectedCert || !password) return;

    setStep("connecting");
    setLoading(true);
    setError("");

    try {
      // 인증서 파일을 Base64로 읽기
      const certRes = await fetch(`/api/codef/certs?action=read&path=${encodeURIComponent(selectedCert.path)}`);
      let certFile: string;
      let keyFile: string;

      if (certRes.ok) {
        const certData = await certRes.json();
        certFile = certData.certFile;
        keyFile = certData.keyFile;
      } else {
        // 파일 경로를 서버에 직접 전달
        certFile = selectedCert.certFile;
        keyFile = selectedCert.keyFile;
      }

      const res = await fetch("/api/codef/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certFile,
          keyFile,
          certPassword: password,
          institutions: ["ibk", "samsungCard", "bcCard"],
          ibkAccount: ibkAccount || undefined,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setStep("password");
      } else {
        setResults(data.connections || []);
        setStep("result");

        const successCount = (data.connections || []).filter(
          (c: ConnectionResult) => c.status === "connected"
        ).length;

        if (data.partial) {
          toast.warning(`부분 연결: ${successCount}/${data.connections?.length ?? 0}개 기관 성공`);
        } else {
          toast.success("모든 기관 연결 완료");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결 실패");
      setStep("password");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (step === "result") onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-600" />
            금융기관 자동 연결
          </DialogTitle>
          <DialogDescription>
            공인인증서로 기업은행, BC카드, 삼성카드를 한번에 연결합니다
          </DialogDescription>
        </DialogHeader>

        {/* 1단계: 인증서 선택 */}
        {step === "cert" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">인증서 선택</p>
              {certs.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <KeyRound size={32} className="mx-auto mb-2" />
                  <p className="text-sm">로컬에서 인증서를 찾을 수 없습니다</p>
                  <p className="text-xs mt-1">NPKI 폴더에 인증서가 설치되어 있는지 확인하세요</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {certs.map((cert, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedCert(cert)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedCert?.path === cert.path
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <KeyRound size={16} className={selectedCert?.path === cert.path ? "text-blue-600" : "text-gray-400"} />
                        <span className="text-sm font-medium">{cert.cn}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1 truncate">{cert.path}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              className="w-full"
              disabled={!selectedCert}
              onClick={() => setStep("password")}
            >
              다음
            </Button>
          </div>
        )}

        {/* 2단계: 비밀번호 입력 */}
        {step === "password" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">인증서 비밀번호</p>
              <Input
                type="password"
                placeholder="인증서 비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && password && handleConnect()}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">
                기업은행 계좌번호 <span className="text-gray-400 font-normal">(선택)</span>
              </p>
              <Input
                placeholder="하이픈 없이 입력 (예: 04912345678)"
                value={ibkAccount}
                onChange={(e) => setIbkAccount(e.target.value)}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-2 rounded">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-gray-400">연결 대상 기관:</p>
              <div className="flex gap-1.5">
                <Badge variant="outline" className="text-xs gap-1"><Building2 size={10} />기업은행</Badge>
                <Badge variant="outline" className="text-xs gap-1"><Building2 size={10} />BC카드</Badge>
                <Badge variant="outline" className="text-xs gap-1"><Building2 size={10} />삼성카드</Badge>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("cert")} className="flex-1">
                이전
              </Button>
              <Button onClick={handleConnect} disabled={!password} className="flex-1">
                연결 시작
              </Button>
            </div>
          </div>
        )}

        {/* 3단계: 연결 중 */}
        {step === "connecting" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 size={40} className="animate-spin text-blue-600" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">금융기관에 연결 중...</p>
              <p className="text-xs text-gray-400 mt-1">인증서 검증 및 계정 등록이 진행됩니다</p>
            </div>
          </div>
        )}

        {/* 4단계: 결과 */}
        {step === "result" && (
          <div className="space-y-4">
            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    r.status === "connected"
                      ? "border-green-200 bg-green-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.status === "connected" ? (
                      <CheckCircle size={16} className="text-green-600" />
                    ) : (
                      <AlertCircle size={16} className="text-red-500" />
                    )}
                    <span className="text-sm font-medium">{r.institution}</span>
                  </div>
                  <span className={`text-xs ${r.status === "connected" ? "text-green-600" : "text-red-500"}`}>
                    {r.message}
                  </span>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={handleClose}>
              완료
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
