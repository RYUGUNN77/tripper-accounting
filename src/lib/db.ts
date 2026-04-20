/**
 * SQLite 데이터베이스 초기화 및 연결 관리
 * better-sqlite3 기반, 파일: data/accounting.db
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "accounting.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    // WAL 모드: 동시 읽기 성능 향상
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- 거래 마스터
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

    -- 외화 거래
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

    -- 분류 규칙 (categories.yaml → DB)
    CREATE TABLE IF NOT EXISTS classification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      major_category TEXT NOT NULL,
      minor_category TEXT NOT NULL,
      keyword TEXT NOT NULL,
      priority INTEGER DEFAULT 0
    );

    -- 인력
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

    -- 계좌
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      number TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'KRW'
    );

    -- 자체이체 키워드
    CREATE TABLE IF NOT EXISTS transfer_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE
    );

    -- 파일 매핑 (파일명 → 계좌)
    CREATE TABLE IF NOT EXISTS file_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      account_name TEXT,
      account_number TEXT
    );

    -- 임포트 프리셋 (학습된 파일 양식)
    CREATE TABLE IF NOT EXISTS import_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pattern TEXT,
      column_mapping TEXT NOT NULL,
      header_row INTEGER DEFAULT 0,
      transaction_type TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- 변경 이력
    CREATE TABLE IF NOT EXISTS changelog (
      id TEXT PRIMARY KEY,
      timestamp TEXT DEFAULT (datetime('now', 'localtime')),
      action TEXT,
      detail TEXT,
      count INTEGER DEFAULT 0,
      undo_data TEXT
    );

    -- 설정
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 카테고리 색상
    CREATE TABLE IF NOT EXISTS category_colors (
      key TEXT PRIMARY KEY,
      bg TEXT,
      fg TEXT
    );

    -- 인덱스 (성능)
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_major ON transactions(major_category);
    CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_file);
    CREATE INDEX IF NOT EXISTS idx_classification_keyword ON classification_rules(keyword);
    CREATE INDEX IF NOT EXISTS idx_forex_date ON forex_transactions(date);
  `);
}

// 기본 색상 (앱 초기화 시 사용)
export const DEFAULT_COLORS: Record<string, { bg: string; fg: string }> = {
  "고정비": { bg: "#f3e8ff", fg: "#7c3aed" },
  "변동비": { bg: "#fef3c7", fg: "#b45309" },
  "수입": { bg: "#dcfce7", fg: "#166534" },
  "미분류": { bg: "#fee2e2", fg: "#991b1b" },
  "자체이체": { bg: "#e0e7ff", fg: "#3730a3" },
  "카드대금": { bg: "#fce7f3", fg: "#9d174d" },
  "가수금": { bg: "#fff7ed", fg: "#9a3412" },
  "가지급금": { bg: "#ecfdf5", fg: "#065f46" },
};
