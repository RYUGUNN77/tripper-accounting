import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const DEFAULTS: Record<string, Record<string, unknown>> = {
  transactions: { apply_same_desc_checked: true, rows_per_page: 0 },
  classification: { apply_both_directions: true, auto_register_keyword: true, auto_classify_on_import: true },
  backup: { auto_backup_on_start: true, max_backups: 20 },
  display: { date_format: "YYYY-MM-DD", sidebar_collapsed: false },
};

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, Record<string, unknown>> = {};
  for (const [section, defaults] of Object.entries(DEFAULTS)) {
    settings[section] = { ...defaults };
  }
  for (const row of rows) {
    try {
      settings[row.key] = { ...(settings[row.key] || {}), ...JSON.parse(row.value) };
    } catch { /* 무시 */ }
  }
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const db = getDb();
  const data = await req.json();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  for (const [section, values] of Object.entries(data)) {
    stmt.run(section, JSON.stringify(values));
  }
  return NextResponse.json({ ok: true });
}
