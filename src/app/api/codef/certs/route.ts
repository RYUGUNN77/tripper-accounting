/**
 * NPKI 인증서 자동 탐지 API
 * GET: 로컬 NPKI 디렉토리에서 인증서 파일 탐지
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

interface CertInfo {
  path: string;
  cn: string;
  certFile: string;
  keyFile: string;
}

// NPKI 인증서 기본 경로 (macOS)
const NPKI_PATHS = [
  path.join(os.homedir(), "Library", "Preferences", "NPKI"),
  path.join(os.homedir(), "NPKI"),
];

function findCerts(): CertInfo[] {
  const certs: CertInfo[] = [];

  for (const basePath of NPKI_PATHS) {
    if (!fs.existsSync(basePath)) continue;

    // CA 디렉토리 탐색 (yessign, CrossCert 등)
    const caFolders = fs.readdirSync(basePath).filter((f) => {
      const p = path.join(basePath, f);
      return fs.statSync(p).isDirectory();
    });

    for (const ca of caFolders) {
      const userDir = path.join(basePath, ca, "USER");
      if (!fs.existsSync(userDir)) continue;

      const certFolders = fs.readdirSync(userDir).filter((f) => {
        const p = path.join(userDir, f);
        return fs.statSync(p).isDirectory();
      });

      for (const folder of certFolders) {
        const certPath = path.join(userDir, folder);
        const certFile = path.join(certPath, "signCert.der");
        const keyFile = path.join(certPath, "signPri.key");

        if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
          // CN 추출: 폴더명에서 cn= 부분
          const cnMatch = folder.match(/cn=([^(]+)/i);
          const cn = cnMatch ? cnMatch[1].trim() : folder;

          certs.push({
            path: certPath,
            cn,
            certFile,
            keyFile,
          });
        }
      }
    }
  }

  return certs;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const certPath = searchParams.get("path");

  // 인증서 파일 Base64 읽기
  if (action === "read" && certPath) {
    try {
      const certFile = path.join(certPath, "signCert.der");
      const keyFile = path.join(certPath, "signPri.key");

      if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
        return NextResponse.json({ error: "인증서 파일을 찾을 수 없습니다" }, { status: 404 });
      }

      return NextResponse.json({
        certFile: fs.readFileSync(certFile).toString("base64"),
        keyFile: fs.readFileSync(keyFile).toString("base64"),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "인증서 읽기 실패";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // 인증서 목록 탐지
  try {
    const certs = findCerts();
    return NextResponse.json({ certs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "인증서 탐지 실패";
    return NextResponse.json({ certs: [], error: message });
  }
}
