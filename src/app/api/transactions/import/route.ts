/**
 * 파일 임포트 API
 * POST /api/transactions/import?action=preview  — 파일 미리보기 + 자동 매핑
 * POST /api/transactions/import?action=import   — 매핑 확정 후 임포트 실행
 */

import { NextRequest, NextResponse } from "next/server";
import { parseFilePreview, importFile, savePreset, type ColumnMapping } from "@/lib/importer";

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "preview";

  if (action === "preview") {
    // 파일 미리보기
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const preview = parseFilePreview(buffer, file.name);
      return NextResponse.json({ ok: true, preview, filename: file.name });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `파일 파싱 오류: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 400 });
    }
  }

  if (action === "import") {
    // 임포트 실행
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mappingStr = formData.get("mapping") as string | null;
    const headerRow = parseInt(formData.get("headerRow") as string || "0", 10);
    const presetName = formData.get("presetName") as string | null;

    if (!file || !mappingStr) {
      return NextResponse.json({ error: "파일과 매핑 정보가 필요합니다." }, { status: 400 });
    }

    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingStr);
    } catch {
      return NextResponse.json({ error: "매핑 정보가 올바르지 않습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const result = importFile(buffer, file.name, mapping, headerRow);

      // 프리셋 저장 (이름이 지정된 경우)
      if (presetName && result.newCount > 0) {
        // 파일명에서 패턴 추출 (숫자/날짜 부분 제거)
        const pattern = file.name.replace(/\d{4}[-_]?\d{2}[-_]?\d{2}/g, "")
          .replace(/\d+/g, "")
          .replace(/[_\-\.]+/g, " ")
          .trim()
          .split(" ")[0] || file.name.substring(0, 10);

        try {
          savePreset(presetName, pattern, mapping, headerRow, "");
        } catch {
          // 프리셋 저장 실패는 무시 (임포트 자체는 성공)
        }
      }

      return NextResponse.json({ ok: true, result });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `임포트 오류: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "잘못된 action" }, { status: 400 });
}
