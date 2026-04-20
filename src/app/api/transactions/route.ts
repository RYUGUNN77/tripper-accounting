/**
 * 거래내역 API
 * GET /api/transactions — 필터/정렬/페이지네이션
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const p = req.nextUrl.searchParams;

  const monthFrom = p.get("from") || "";
  const monthTo = p.get("to") || "";
  const category = p.get("category") || "";
  const subcategory = p.get("subcategory") || "";
  const txType = p.get("type") || "";
  const keyword = p.get("q") || "";
  const direction = p.get("direction") || "";
  const sortCol = p.get("sort") || "date";
  const sortDir = p.get("dir") || "desc";
  const page = parseInt(p.get("page") || "1", 10);
  const perPage = parseInt(p.get("perPage") || "50", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (monthFrom) {
    conditions.push("substr(date, 1, 7) >= ?");
    params.push(monthFrom);
  }
  if (monthTo) {
    conditions.push("substr(date, 1, 7) <= ?");
    params.push(monthTo);
  }
  if (category) {
    conditions.push("major_category = ?");
    params.push(category);
  }
  if (subcategory) {
    conditions.push("minor_category = ?");
    params.push(subcategory);
  }
  if (txType) {
    conditions.push("type = ?");
    params.push(txType);
  }
  if (direction === "입금") {
    conditions.push("amount_in > 0");
  } else if (direction === "출금") {
    conditions.push("amount_out > 0");
  }
  if (keyword) {
    conditions.push("(description LIKE ? OR merchant LIKE ? OR minor_category LIKE ?)");
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  // 정렬
  const validSorts: Record<string, string> = {
    date: "date", amount_in: "amount_in", amount_out: "amount_out",
    description: "description", major_category: "major_category",
  };
  const orderCol = validSorts[sortCol] || "date";
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";

  // 총 건수
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM transactions ${where}`).get(...params) as { cnt: number };
  const total = countRow.cnt;

  // 데이터 조회
  const offset = (page - 1) * perPage;
  const rows = db.prepare(
    `SELECT id, date, type, amount_in, amount_out, balance, description, merchant,
            major_category, minor_category, memo, source_file, card_number
     FROM transactions ${where}
     ORDER BY ${orderCol} ${orderDir}
     LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset) as Record<string, unknown>[];

  // 사용 가능한 월 목록
  const months = (db.prepare("SELECT DISTINCT substr(date, 1, 7) as ym FROM transactions ORDER BY ym DESC").all() as { ym: string }[]).map(m => m.ym);

  // 카테고리 트리
  const catTree: Record<string, string[]> = {};
  const catRows = db.prepare(
    "SELECT DISTINCT major_category, minor_category FROM classification_rules ORDER BY major_category, minor_category"
  ).all() as { major_category: string; minor_category: string }[];
  for (const r of catRows) {
    if (!catTree[r.major_category]) catTree[r.major_category] = [];
    if (!catTree[r.major_category].includes(r.minor_category)) {
      catTree[r.major_category].push(r.minor_category);
    }
  }

  // 집계
  const summaryRow = db.prepare(
    `SELECT COALESCE(SUM(amount_in), 0) as total_in, COALESCE(SUM(amount_out), 0) as total_out
     FROM transactions ${where}`
  ).get(...params) as { total_in: number; total_out: number };

  return NextResponse.json({
    rows,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
    months,
    categories: catTree,
    summary: { total_in: summaryRow.total_in, total_out: summaryRow.total_out },
  });
}
