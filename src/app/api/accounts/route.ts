import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const db = getDb();
  const data = await req.json();
  const { action, name, number, keyword } = data;

  if (action === "add_account") {
    if (!name || !number) return NextResponse.json({ ok: false, error: "계좌명과 번호 필요" });
    try {
      db.prepare("INSERT INTO accounts (name, number) VALUES (?, ?)").run(name, number);
      return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ ok: false, error: "이미 등록된 계좌" }); }
  }

  if (action === "delete_account") {
    if (!number) return NextResponse.json({ ok: false, error: "계좌번호 필요" });
    db.prepare("DELETE FROM accounts WHERE number = ?").run(number);
    return NextResponse.json({ ok: true });
  }

  if (action === "add_keyword") {
    if (!keyword) return NextResponse.json({ ok: false, error: "키워드 필요" });
    try {
      db.prepare("INSERT INTO transfer_keywords (keyword) VALUES (?)").run(keyword);
      return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ ok: false, error: "이미 등록된 키워드" }); }
  }

  if (action === "delete_keyword") {
    if (!keyword) return NextResponse.json({ ok: false, error: "키워드 필요" });
    db.prepare("DELETE FROM transfer_keywords WHERE keyword = ?").run(keyword);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "잘못된 action" });
}
