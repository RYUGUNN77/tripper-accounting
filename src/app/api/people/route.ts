/**
 * 인력 관리 API
 * GET  — 인력 목록
 * POST — 인력 추가
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const people = db.prepare(
    "SELECT * FROM people ORDER BY role, name"
  ).all();

  // 역할별 집계
  const stats = db.prepare(
    "SELECT role, COUNT(*) as cnt FROM people WHERE status = '활동 중' GROUP BY role"
  ).all() as { role: string; cnt: number }[];

  return NextResponse.json({ people, stats });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const data = await req.json();

  const { name, role, status, phone, bank, bank_number, tier, aliases } = data;
  if (!name || !role) {
    return NextResponse.json({ ok: false, error: "이름과 역할이 필요합니다." });
  }

  try {
    db.prepare(
      "INSERT INTO people (name, role, status, phone, bank, bank_number, tier, aliases) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(name, role, status || "활동 중", phone || "", bank || "", bank_number || "", tier || "", aliases ? JSON.stringify(aliases) : null);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "이미 등록된 이름입니다." });
  }
}
