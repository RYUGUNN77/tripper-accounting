import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const db = getDb();
  const { id } = await req.json();
  if (!id) return NextResponse.json({ ok: false, error: "ID 필요" });

  const log = db.prepare("SELECT * FROM changelog WHERE id = ?").get(id) as { undo_data: string | null } | undefined;
  if (!log?.undo_data) return NextResponse.json({ ok: false, error: "되돌리기 데이터 없음" });

  const undoItems = JSON.parse(log.undo_data) as { 거래ID: string; 대분류: string; 중분류: string; 메모: string }[];
  let restored = 0;

  const undoAll = db.transaction(() => {
    for (const item of undoItems) {
      const r = db.prepare(
        "UPDATE transactions SET major_category = ?, minor_category = ?, memo = ? WHERE id = ?"
      ).run(item.대분류 || "", item.중분류 || "", item.메모 || "", item.거래ID);
      restored += r.changes;
    }
    // undo 데이터 제거 (중복 방지)
    db.prepare("UPDATE changelog SET undo_data = NULL WHERE id = ?").run(id);
  });
  undoAll();

  return NextResponse.json({ ok: true, restored });
}
