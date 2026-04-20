/**
 * 개별 거래 수정 API
 * PUT /api/transactions/[id] — 분류/메모 변경
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const data = await req.json();

  const major = data.major_category ?? undefined;
  const minor = data.minor_category ?? undefined;
  const memo = data.memo ?? undefined;
  const applyAll = data.apply_all ?? false;

  if (major === undefined && minor === undefined && memo === undefined) {
    return NextResponse.json({ ok: false, error: "변경할 데이터가 없습니다." });
  }

  // 대상 거래 확인
  const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!tx) {
    return NextResponse.json({ ok: false, error: "거래를 찾을 수 없습니다." });
  }

  let changed = 0;

  if (applyAll && major !== undefined) {
    // 같은 적요의 모든 거래에 분류 적용
    const desc = String(tx.description || "").trim();
    if (desc) {
      const result = db.prepare(
        "UPDATE transactions SET major_category = ?, minor_category = ? WHERE TRIM(description) = ?"
      ).run(major, minor || "", desc);
      changed = result.changes;
    } else {
      const result = db.prepare(
        "UPDATE transactions SET major_category = ?, minor_category = ? WHERE id = ?"
      ).run(major, minor || "", id);
      changed = result.changes;
    }
  } else {
    // 개별 수정
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (major !== undefined) { sets.push("major_category = ?"); vals.push(major); }
    if (minor !== undefined) { sets.push("minor_category = ?"); vals.push(minor); }
    if (memo !== undefined) { sets.push("memo = ?"); vals.push(memo); }
    vals.push(id);

    const result = db.prepare(
      `UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`
    ).run(...vals);
    changed = result.changes;
  }

  // 분류 규칙 자동 등록 (적요 → 키워드)
  if (major && minor && data.auto_register) {
    const desc = String(tx.description || "").trim();
    if (desc) {
      db.prepare(
        "INSERT OR IGNORE INTO classification_rules (major_category, minor_category, keyword, priority) VALUES (?, ?, ?, ?)"
      ).run(major, minor, desc, desc.length);
    }
  }

  return NextResponse.json({ ok: true, changed });
}
