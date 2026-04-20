/**
 * Codef Connected ID 등록 API
 * POST: 인증서 기반으로 기업은행 + BC카드 + 삼성카드 Connected ID 등록
 */

import { NextRequest, NextResponse } from "next/server";
import { createConnectedId, encryptRSA, AccountInput } from "@/lib/codef";
import { getDb } from "@/lib/db";

interface ConnectBody {
  certFile: string;       // signCert.der Base64
  keyFile: string;        // signPri.key Base64
  certPassword: string;   // 인증서 비밀번호 (평문 → 서버에서 RSA 암호화)
  institutions: string[]; // ["ibk", "samsungCard", "bcCard"]
  ibkAccount?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ConnectBody;
  const { certFile, keyFile, certPassword, institutions, ibkAccount } = body;

  if (!certFile || !keyFile || !certPassword) {
    return NextResponse.json({ error: "인증서 파일과 비밀번호를 모두 입력해주세요" }, { status: 400 });
  }
  if (!institutions || institutions.length === 0) {
    return NextResponse.json({ error: "최소 1개 이상의 기관을 선택해주세요" }, { status: 400 });
  }

  let encryptedPassword: string;
  try {
    encryptedPassword = encryptRSA(certPassword);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "RSA 암호화 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const orgMap: Record<string, { businessType: string; organization: string }> = {
    ibk:         { businessType: "BK", organization: "0003" },
    samsungCard: { businessType: "CD", organization: "0325" },
    bcCard:      { businessType: "CD", organization: "0301" },
  };

  const accounts: AccountInput[] = institutions
    .filter((inst) => orgMap[inst])
    .map((inst) => ({
      countryCode: "KR",
      businessType: orgMap[inst].businessType,
      clientType: "B",
      organization: orgMap[inst].organization,
      loginType: "0",
      certFile,
      keyFile,
      password: encryptedPassword,
    }));

  if (accounts.length === 0) {
    return NextResponse.json({ error: "유효한 기관이 선택되지 않았습니다" }, { status: 400 });
  }

  try {
    const connectedId = await createConnectedId(accounts);

    const db = getDb();
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    stmt.run("codef_connected_id", connectedId);
    if (ibkAccount) {
      stmt.run("codef_ibk_account", ibkAccount);
    }

    return NextResponse.json({ connectedId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("codef_connected_id") as { value: string } | undefined;
  const accountRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("codef_ibk_account") as { value: string } | undefined;

  return NextResponse.json({
    connected: !!row,
    connectedId: row?.value ?? null,
    ibkAccount: accountRow?.value ?? null,
  });
}
