/**
 * 일괄 분류 API
 * GET  — 미분류 거래 그룹 목록
 * POST — 일괄 분류 실행
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();

  // 미분류 거래를 적요별로 그룹화
  const groups = db.prepare(`
    SELECT
      TRIM(description) as desc,
      COUNT(*) as count,
      COALESCE(SUM(amount_in), 0) as total_in,
      COALESCE(SUM(amount_out), 0) as total_out,
      MIN(date) as first_date,
      MAX(date) as last_date
    FROM transactions
    WHERE major_category IN ('', '미분류') OR major_category IS NULL
    GROUP BY TRIM(description)
    ORDER BY count DESC
  `).all() as {
    desc: string; count: number; total_in: number; total_out: number;
    first_date: string; last_date: string;
  }[];

  const totalUnclassified = groups.reduce((s, g) => s + g.count, 0);

  // 카테고리 트리
  const catTree: Record<string, string[]> = {};
  const catRows = db.prepare(
    "SELECT DISTINCT major_category, minor_category FROM classification_rules WHERE major_category IN ('고정비','변동비','수입') ORDER BY major_category, minor_category"
  ).all() as { major_category: string; minor_category: string }[];
  for (const r of catRows) {
    if (!catTree[r.major_category]) catTree[r.major_category] = [];
    if (!catTree[r.major_category].includes(r.minor_category)) {
      catTree[r.major_category].push(r.minor_category);
    }
  }

  return NextResponse.json({
    groups: groups.map(g => ({
      ...g,
      desc: g.desc || "(적요없음)",
    })),
    total: totalUnclassified,
    groupCount: groups.length,
    categories: catTree,
  });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const data = await req.json();
  const items = data.items as { desc: string; major: string; minor: string }[];

  if (!items || items.length === 0) {
    return NextResponse.json({ ok: false, error: "분류할 항목이 없습니다." });
  }

  let totalChanged = 0;

  const classifyBatch = db.transaction(() => {
    for (const item of items) {
      if (!item.desc || !item.major) continue;

      const desc = item.desc === "(적요없음)" ? "" : item.desc;
      let result;
      if (desc === "") {
        result = db.prepare(
          `UPDATE transactions SET major_category = ?, minor_category = ?
           WHERE (TRIM(description) = '' OR description IS NULL)
             AND (major_category IN ('', '미분류') OR major_category IS NULL)`
        ).run(item.major, item.minor || "");
      } else {
        result = db.prepare(
          `UPDATE transactions SET major_category = ?, minor_category = ?
           WHERE TRIM(description) = ?
             AND (major_category IN ('', '미분류') OR major_category IS NULL)`
        ).run(item.major, item.minor || "", desc);
      }
      totalChanged += result.changes;

      // 분류 규칙 자동 등록
      if (desc) {
        db.prepare(
          "INSERT OR IGNORE INTO classification_rules (major_category, minor_category, keyword, priority) VALUES (?, ?, ?, ?)"
        ).run(item.major, item.minor || "", desc, desc.length);
      }
    }
  });

  classifyBatch();

  return NextResponse.json({ ok: true, changed: totalChanged, groups: items.length });
}
