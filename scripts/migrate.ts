/**
 * 데이터 마이그레이션 스크립트
 * master.xlsx + categories.yaml + accounts.yaml + people.yaml → SQLite
 *
 * 실행: npx tsx scripts/migrate.ts
 */

import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "accounting.db");
const MASTER_FILE = path.join(PROJECT_ROOT, "data", "master.xlsx");
const FOREX_FILE = path.join(PROJECT_ROOT, "data", "forex_master.xlsx");
const CATEGORIES_FILE = path.join(PROJECT_ROOT, "config", "categories.yaml");
const ACCOUNTS_FILE = path.join(PROJECT_ROOT, "config", "accounts.yaml");
const PEOPLE_FILE = path.join(PROJECT_ROOT, "config", "people.yaml");
const COLORS_FILE = path.join(PROJECT_ROOT, "config", "category_colors.yaml");
const SETTINGS_FILE = path.join(PROJECT_ROOT, "config", "settings.yaml");
const CHANGELOG_FILE = path.join(PROJECT_ROOT, "data", "changelog.json");

function loadYaml(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  return (yaml.load(content) as Record<string, unknown>) || {};
}

function main() {
  console.log("=".repeat(50));
  console.log("  회계 데이터 마이그레이션 시작");
  console.log("=".repeat(50));

  // 기존 DB가 있으면 백업
  if (fs.existsSync(DB_PATH)) {
    const backupPath = DB_PATH + ".backup_" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`  기존 DB 백업: ${path.basename(backupPath)}`);
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 스키마 생성
  createSchema(db);
  console.log("  ✅ DB 스키마 생성 완료");

  // 1. categories.yaml → classification_rules
  const catCount = migrateCategories(db);
  console.log(`  ✅ 분류 규칙: ${catCount}건 이관`);

  // 2. accounts.yaml → accounts, transfer_keywords, file_mappings
  const accResult = migrateAccounts(db);
  console.log(`  ✅ 계좌: ${accResult.accounts}건, 키워드: ${accResult.keywords}건, 파일매핑: ${accResult.mappings}건`);

  // 3. people.yaml → people
  const peopleCount = migratePeople(db);
  console.log(`  ✅ 인력: ${peopleCount}건 이관`);

  // 4. master.xlsx → transactions
  const txCount = migrateTransactions(db);
  console.log(`  ✅ 거래: ${txCount}건 이관`);

  // 5. forex_master.xlsx → forex_transactions
  const fxCount = migrateForex(db);
  console.log(`  ✅ 외화 거래: ${fxCount}건 이관`);

  // 6. category_colors.yaml → category_colors
  const colorCount = migrateColors(db);
  console.log(`  ✅ 카테고리 색상: ${colorCount}건 이관`);

  // 7. settings.yaml → settings
  const settingsCount = migrateSettings(db);
  console.log(`  ✅ 설정: ${settingsCount}건 이관`);

  // 8. changelog.json → changelog
  const logCount = migrateChangelog(db);
  console.log(`  ✅ 변경 이력: ${logCount}건 이관`);

  // 검증
  console.log("\n" + "=".repeat(50));
  console.log("  검증 결과");
  console.log("=".repeat(50));
  verify(db);

  db.close();
  console.log("\n  ✅ 마이그레이션 완료!");
  console.log(`  DB 파일: ${DB_PATH}`);
}

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT,
      amount_in REAL DEFAULT 0,
      amount_out REAL DEFAULT 0,
      balance REAL,
      description TEXT,
      merchant TEXT,
      major_category TEXT DEFAULT '미분류',
      minor_category TEXT DEFAULT '',
      memo TEXT,
      source_file TEXT,
      imported_at TEXT,
      card_number TEXT
    );

    CREATE TABLE IF NOT EXISTS forex_transactions (
      id TEXT PRIMARY KEY,
      date TEXT,
      currency TEXT DEFAULT 'USD',
      amount_in REAL DEFAULT 0,
      amount_out REAL DEFAULT 0,
      balance REAL,
      description TEXT,
      transaction_type TEXT,
      platform TEXT,
      counterpart TEXT,
      classification TEXT
    );

    CREATE TABLE IF NOT EXISTS classification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      major_category TEXT NOT NULL,
      minor_category TEXT NOT NULL,
      keyword TEXT NOT NULL,
      priority INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT DEFAULT '활동 중',
      phone TEXT,
      bank TEXT,
      bank_number TEXT,
      tier TEXT,
      aliases TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      number TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'KRW'
    );

    CREATE TABLE IF NOT EXISTS transfer_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS file_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      account_name TEXT,
      account_number TEXT
    );

    CREATE TABLE IF NOT EXISTS import_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pattern TEXT,
      column_mapping TEXT NOT NULL,
      header_row INTEGER DEFAULT 0,
      transaction_type TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS changelog (
      id TEXT PRIMARY KEY,
      timestamp TEXT DEFAULT (datetime('now', 'localtime')),
      action TEXT,
      detail TEXT,
      count INTEGER DEFAULT 0,
      undo_data TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS category_colors (
      key TEXT PRIMARY KEY,
      bg TEXT,
      fg TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_major ON transactions(major_category);
    CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_file);
    CREATE INDEX IF NOT EXISTS idx_classification_keyword ON classification_rules(keyword);
    CREATE INDEX IF NOT EXISTS idx_forex_date ON forex_transactions(date);
  `);
}

function migrateCategories(db: Database.Database): number {
  const data = loadYaml(CATEGORIES_FILE);
  const stmt = db.prepare(
    "INSERT INTO classification_rules (major_category, minor_category, keyword, priority) VALUES (?, ?, ?, ?)"
  );

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const majorCat of ["고정비", "변동비", "수입", "가지급금"]) {
      const minors = data[majorCat] as Record<string, string[]> | undefined;
      if (!minors) continue;
      for (const [minorCat, keywords] of Object.entries(minors)) {
        if (!keywords) continue;
        for (const kw of keywords) {
          stmt.run(majorCat, minorCat, kw, kw.length); // 긴 키워드 = 높은 우선순위
          count++;
        }
      }
    }

    // 사용자정의
    const custom = data["사용자정의"] as Record<string, string[]> | null;
    if (custom) {
      for (const [catName, keywords] of Object.entries(custom)) {
        if (!keywords) continue;
        const [major, minor] = catName.includes("_")
          ? catName.split("_", 2)
          : ["기타", catName];
        for (const kw of keywords) {
          stmt.run(major, minor, kw, kw.length);
          count++;
        }
      }
    }
  });
  insertMany();
  return count;
}

function migrateAccounts(db: Database.Database): { accounts: number; keywords: number; mappings: number } {
  const data = loadYaml(ACCOUNTS_FILE);
  let accounts = 0, keywords = 0, mappings = 0;

  const accts = (data.accounts as Array<{ name: string; number: string }>) || [];
  const accStmt = db.prepare("INSERT OR IGNORE INTO accounts (name, number) VALUES (?, ?)");
  for (const a of accts) {
    accStmt.run(a.name, a.number);
    accounts++;
  }

  const kws = (data.keywords as string[]) || [];
  const kwStmt = db.prepare("INSERT OR IGNORE INTO transfer_keywords (keyword) VALUES (?)");
  for (const kw of kws) {
    kwStmt.run(kw);
    keywords++;
  }

  const fms = (data.file_mapping as Array<{ pattern: string; account: string; number: string }>) || [];
  const fmStmt = db.prepare("INSERT INTO file_mappings (pattern, account_name, account_number) VALUES (?, ?, ?)");
  for (const fm of fms) {
    fmStmt.run(fm.pattern, fm.account, fm.number);
    mappings++;
  }

  return { accounts, keywords, mappings };
}

function migratePeople(db: Database.Database): number {
  const data = loadYaml(PEOPLE_FILE);
  const people = (data.people as Array<Record<string, unknown>>) || [];
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO people (name, role, status, phone, bank, bank_number, tier, aliases) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const p of people) {
      const aliases = p.aliases ? JSON.stringify(p.aliases) : null;
      stmt.run(
        p.name || "",
        p.role || "",
        p.status || "활동 중",
        p.phone || "",
        p.bank || "",
        p.bank_number || "",
        p.tier || "",
        aliases
      );
      count++;
    }
  });
  insertMany();
  return count;
}

function migrateTransactions(db: Database.Database): number {
  if (!fs.existsSync(MASTER_FILE)) {
    console.log("  ⚠️ master.xlsx 없음, 건너뜀");
    return 0;
  }

  const wb = XLSX.readFile(MASTER_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
    (id, date, type, amount_in, amount_out, balance, description, merchant,
     major_category, minor_category, memo, source_file, imported_at, card_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const row of rows) {
      const dateVal = row["거래일자"];
      let dateStr = "";
      if (dateVal) {
        if (typeof dateVal === "number") {
          // 엑셀 시리얼 넘버
          const d = XLSX.SSF.parse_date_code(dateVal);
          dateStr = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")} ${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}:${String(d.S).padStart(2, "0")}`;
        } else {
          dateStr = String(dateVal);
        }
      }
      if (!dateStr) continue;

      stmt.run(
        String(row["거래ID"] || ""),
        dateStr,
        String(row["거래유형"] || ""),
        Number(row["입금액"] || 0),
        Number(row["출금액"] || 0),
        row["잔액"] != null ? Number(row["잔액"]) : null,
        String(row["적요"] || ""),
        String(row["거래처"] || ""),
        String(row["대분류"] || "미분류"),
        String(row["중분류"] || ""),
        String(row["메모"] || ""),
        String(row["원본파일"] || ""),
        String(row["가져온날짜"] || ""),
        String(row["카드번호"] || "")
      );
      count++;
    }
  });
  insertMany();
  return count;
}

function migrateForex(db: Database.Database): number {
  if (!fs.existsSync(FOREX_FILE)) {
    console.log("  ⚠️ forex_master.xlsx 없음, 건너뜀");
    return 0;
  }

  const wb = XLSX.readFile(FOREX_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO forex_transactions
    (id, date, currency, amount_in, amount_out, balance, description,
     transaction_type, platform, counterpart, classification)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const row of rows) {
      const dateVal = row["거래일시"];
      let dateStr = "";
      if (dateVal) {
        if (typeof dateVal === "number") {
          const d = XLSX.SSF.parse_date_code(dateVal);
          dateStr = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")} ${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}`;
        } else {
          dateStr = String(dateVal);
        }
      }

      stmt.run(
        String(row["거래ID"] || ""),
        dateStr,
        String(row["통화"] || "USD"),
        Number(row["입금"] || 0),
        Number(row["출금"] || 0),
        row["잔액"] != null ? Number(row["잔액"]) : null,
        String(row["적요"] || ""),
        String(row["거래유형"] || ""),
        String(row["플랫폼"] || ""),
        String(row["해외수입업자"] || ""),
        String(row["분류"] || "")
      );
      count++;
    }
  });
  insertMany();
  return count;
}

function migrateColors(db: Database.Database): number {
  const data = loadYaml(COLORS_FILE);
  const stmt = db.prepare("INSERT OR REPLACE INTO category_colors (key, bg, fg) VALUES (?, ?, ?)");
  let count = 0;

  for (const [key, val] of Object.entries(data)) {
    const color = val as { bg?: string; fg?: string };
    if (color && color.bg) {
      stmt.run(key, color.bg || "", color.fg || "");
      count++;
    }
  }
  return count;
}

function migrateSettings(db: Database.Database): number {
  const data = loadYaml(SETTINGS_FILE);
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  let count = 0;

  for (const [section, values] of Object.entries(data)) {
    stmt.run(section, JSON.stringify(values));
    count++;
  }
  return count;
}

function migrateChangelog(db: Database.Database): number {
  if (!fs.existsSync(CHANGELOG_FILE)) return 0;

  const raw = fs.readFileSync(CHANGELOG_FILE, "utf-8");
  let logs: Array<Record<string, unknown>>;
  try {
    logs = JSON.parse(raw);
  } catch {
    return 0;
  }

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO changelog (id, timestamp, action, detail, count, undo_data) VALUES (?, ?, ?, ?, ?, ?)"
  );

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const log of logs) {
      stmt.run(
        String(log.id || `log_${count}`),
        String(log.timestamp || ""),
        String(log.action || ""),
        String(log.detail || ""),
        Number(log.count || 0),
        log.undo ? JSON.stringify(log.undo) : null
      );
      count++;
    }
  });
  insertMany();
  return count;
}

function verify(db: Database.Database) {
  const txCount = (db.prepare("SELECT COUNT(*) as cnt FROM transactions").get() as { cnt: number }).cnt;
  const txSumIn = (db.prepare("SELECT COALESCE(SUM(amount_in), 0) as s FROM transactions").get() as { s: number }).s;
  const txSumOut = (db.prepare("SELECT COALESCE(SUM(amount_out), 0) as s FROM transactions").get() as { s: number }).s;
  const fxCount = (db.prepare("SELECT COUNT(*) as cnt FROM forex_transactions").get() as { cnt: number }).cnt;
  const ruleCount = (db.prepare("SELECT COUNT(*) as cnt FROM classification_rules").get() as { cnt: number }).cnt;
  const peopleCount = (db.prepare("SELECT COUNT(*) as cnt FROM people").get() as { cnt: number }).cnt;
  const accCount = (db.prepare("SELECT COUNT(*) as cnt FROM accounts").get() as { cnt: number }).cnt;

  console.log(`  거래 건수: ${txCount.toLocaleString()}건`);
  console.log(`  총 입금액: ₩${txSumIn.toLocaleString()}`);
  console.log(`  총 출금액: ₩${txSumOut.toLocaleString()}`);
  console.log(`  외화 거래: ${fxCount}건`);
  console.log(`  분류 규칙: ${ruleCount}건`);
  console.log(`  인력: ${peopleCount}명`);
  console.log(`  계좌: ${accCount}개`);
}

main();
