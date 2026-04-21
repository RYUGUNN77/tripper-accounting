/**
 * Codef 금융기관 자동 연결 API
 * POST: 인증서 + 비밀번호만 받아 모든 기관 자동 연결 + 계좌 자동 조회
 */

import { NextRequest, NextResponse } from "next/server";
import { autoConnectAll, encryptRSA } from "@/lib/codef";
import { getDb } from "@/lib/db";
import fs from "fs";
import path from "path";

interface ConnectBody {
  certId: string;
  certPassword: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ConnectBody;
  const { certId, certPassword } = body;

  if (!certId || !certPassword) {
    return NextResponse.json({ error: "인증서와 비밀번호를 입력해주세요" }, { status: 400 });
  }

  // 인증서 파일 읽기
  const certDir = Buffer.from(certId, "base64url").toString("utf-8");
  const certFilePath = path.join(certDir, "signCert.der");
  const keyFilePath = path.join(certDir, "signPri.key");

  if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    return NextResponse.json({ error: "인증서 파일을 찾을 수 없습니다" }, { status: 400 });
  }

  const certFile = fs.readFileSync(certFilePath).toString("base64");
  const keyFile = fs.readFileSync(keyFilePath).toString("base64");
  const certName = path.basename(certDir).match(/cn=([^,]+)/)?.[1] ?? "인증서";

  let encryptedPassword: string;
  try {
    encryptedPassword = encryptRSA(certPassword);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "RSA 암호화 실패",
    }, { status: 500 });
  }

  try {
    // 모든 기관 자동 연결 + 계좌 자동 조회
    const result = await autoConnectAll(certFile, keyFile, encryptedPassword);

    if (result.succeeded.length === 0) {
      const reasons = result.failed.map(f => `${f.label}: ${f.reason}`).join(", ");
      return NextResponse.json({
        error: `연결된 기관이 없습니다. 인증서 비밀번호를 확인해주세요. (${reasons})`,
      }, { status: 400 });
    }

    // DB 저장
    const db = getDb();
    const institutions = result.succeeded.map(s => s.key);

    // 은행 계좌 자동 감지
    const bankInst = result.succeeded.find(s => s.accounts && s.accounts.length > 0);
    const ibkAccount = bankInst?.accounts?.[0]?.number ?? null;

    db.prepare(`
      INSERT OR REPLACE INTO codef_connections
        (connected_id, status, institutions, ibk_account, cert_name)
      VALUES (?, 'connected', ?, ?, ?)
    `).run(result.connectedId, JSON.stringify(institutions), ibkAccount, certName);

    // 하위 호환
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    stmt.run("codef_connected_id", result.connectedId);
    if (ibkAccount) stmt.run("codef_ibk_account", ibkAccount);

    return NextResponse.json({
      connectedId: result.connectedId,
      succeeded: result.succeeded,
      failed: result.failed,
      ibkAccount,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "연결 실패",
    }, { status: 500 });
  }
}

export async function GET() {
  const db = getDb();

  const conn = db.prepare(`
    SELECT connected_id, status, institutions, ibk_account, cert_name
    FROM codef_connections ORDER BY id DESC LIMIT 1
  `).get() as {
    connected_id: string;
    status: string;
    institutions: string;
    ibk_account: string | null;
    cert_name: string | null;
  } | undefined;

  if (conn) {
    return NextResponse.json({
      connected: conn.status === "connected",
      connectedId: conn.connected_id,
      institutions: JSON.parse(conn.institutions),
      ibkAccount: conn.ibk_account,
      certName: conn.cert_name,
    });
  }

  return NextResponse.json({
    connected: false,
    connectedId: null,
    institutions: [],
    ibkAccount: null,
    certName: null,
  });
}
