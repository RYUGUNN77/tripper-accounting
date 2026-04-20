/**
 * 스마트 파일 임포트 엔진
 * 3단계 자동 인식: 프리셋 매칭 → 자동 컬럼 감지 → 사용자 매핑
 */

import * as XLSX from "xlsx";
import crypto from "crypto";
import { getDb } from "./db";

// 표준 컬럼 필드
export type ColumnField =
  | "거래일자" | "입금액" | "출금액" | "금액" | "잔액"
  | "적요" | "거래처" | "카드번호" | "무시";

export interface ColumnMapping {
  [originalColumn: string]: ColumnField;
}

export interface ParsedPreview {
  headers: string[];
  rows: string[][];      // 미리보기 행 (최대 5행)
  totalRows: number;
  headerRow: number;
  sheetName: string;
  suggestedMapping: ColumnMapping | null;  // 자동 감지 결과
  presetName: string | null;              // 매칭된 프리셋
  autoDetected: boolean;                  // 완전 자동 감지 성공 여부
}

export interface ImportResult {
  newCount: number;
  dupCount: number;
  totalCount: number;
  internalCount: number;
  errors: string[];
}

// 날짜 컬럼 키워드
const DATE_KEYWORDS = [
  "거래일", "일자", "날짜", "거래일자", "이용일", "이용일자",
  "승인일", "사용일", "결제일", "거래일시", "이용일시",
];

// 출금 컬럼 키워드
const DEBIT_KEYWORDS = [
  "출금", "지출", "사용금액", "이용금액", "결제금액", "출금액",
  "매출", "청구금액", "지급액", "국내이용금액", "이용 금액",
];

// 입금 컬럼 키워드
const CREDIT_KEYWORDS = [
  "입금", "수입", "입금액", "받은금액", "수금액",
];

// 단일 금액 키워드
const AMOUNT_KEYWORDS = ["금액", "거래금액"];

// 잔액 키워드
const BALANCE_KEYWORDS = ["잔액", "잔고", "거래후잔액"];

// 적요 키워드
const DESC_KEYWORDS = [
  "적요", "내용", "거래내용", "이용내역", "사용처", "비고",
  "상세내용", "거래적요", "이용 내역",
];

// 거래처/가맹점 키워드
const MERCHANT_KEYWORDS = [
  "거래처", "상호", "가맹점", "상호명", "업소명", "가맹점명",
  "상대방", "예금주명", "상대계좌예금주", "이용가맹점", "이용점",
];

// 카드번호 키워드
const CARD_KEYWORDS = ["카드번호", "카드", "카드종류", "카드명"];

// 헤더 행 감지용 키워드
const HEADER_SCAN_KEYWORDS = new Set([
  "거래일", "일자", "날짜", "이용일", "승인일", "사용일", "결제일",
  "입금", "출금", "금액", "잔액", "적요", "내용", "거래내용",
  "가맹점", "상호", "거래처", "거래일시", "이용금액", "사용금액",
]);

/**
 * 엑셀/CSV 파일 미리보기 (3단계 인식)
 */
export function parseFilePreview(buffer: Buffer, filename: string): ParsedPreview {
  const wb = XLSX.read(buffer, { type: "buffer" });

  // 가장 데이터가 많은 시트 선택
  let bestSheet = wb.SheetNames[0];
  let bestRows = 0;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][];
    if (rows.length > bestRows) {
      bestRows = rows.length;
      bestSheet = name;
    }
  }

  const ws = wb.Sheets[bestSheet];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

  // 헤더 행 감지
  const headerRow = findHeaderRow(rawRows);

  // 헤더와 데이터 분리
  const headers = (rawRows[headerRow] || []).map((h) => String(h ?? "").trim());
  const dataRows = rawRows.slice(headerRow + 1);

  // 합계행 등 제거 (빈 첫 컬럼 또는 "합계" 포함)
  const cleanRows = dataRows.filter((row) => {
    const first = String(row[0] ?? "").trim();
    if (!first || first === "합계" || first === "소계") return false;
    return true;
  });

  // 미리보기 (최대 5행)
  const previewRows = cleanRows.slice(0, 5).map((row) =>
    headers.map((_, i) => String(row[i] ?? ""))
  );

  // 1단계: 프리셋 매칭
  const preset = matchPreset(filename);
  if (preset) {
    return {
      headers,
      rows: previewRows,
      totalRows: cleanRows.length,
      headerRow,
      sheetName: bestSheet,
      suggestedMapping: JSON.parse(preset.column_mapping),
      presetName: preset.name,
      autoDetected: true,
    };
  }

  // 2단계: 자동 컬럼 감지
  const autoMapping = detectColumnMapping(headers);
  const hasDate = Object.values(autoMapping).includes("거래일자");
  const hasAmount = Object.values(autoMapping).includes("입금액") ||
    Object.values(autoMapping).includes("출금액") ||
    Object.values(autoMapping).includes("금액");

  return {
    headers,
    rows: previewRows,
    totalRows: cleanRows.length,
    headerRow,
    sheetName: bestSheet,
    suggestedMapping: autoMapping,
    presetName: null,
    autoDetected: hasDate && hasAmount,
  };
}

/**
 * 헤더 행 찾기 (상위 20행 스캔)
 */
function findHeaderRow(rows: unknown[][]): number {
  let bestRow = 0;
  let bestScore = 0;

  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] || [];
    const vals = row.map((v) => String(v ?? "").trim().replace(/\s/g, ""));
    let score = 0;
    for (const v of vals) {
      for (const kw of HEADER_SCAN_KEYWORDS) {
        if (v.includes(kw)) {
          score++;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  return bestScore >= 2 ? bestRow : 0;
}

/**
 * 자동 컬럼 매핑 감지
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedFields = new Set<ColumnField>();

  const match = (keywords: string[], field: ColumnField) => {
    for (const h of headers) {
      if (mapping[h]) continue;
      const clean = h.replace(/\s/g, "").toLowerCase();
      for (const kw of keywords) {
        if (clean.includes(kw.toLowerCase()) && !usedFields.has(field)) {
          // 카드 키워드는 금액/일자와 충돌 방지
          if (field === "카드번호" && (clean.includes("금액") || clean.includes("일자"))) continue;
          mapping[h] = field;
          usedFields.add(field);
          return;
        }
      }
    }
  };

  match(DATE_KEYWORDS, "거래일자");
  match(DEBIT_KEYWORDS, "출금액");
  match(CREDIT_KEYWORDS, "입금액");
  match(BALANCE_KEYWORDS, "잔액");
  match(DESC_KEYWORDS, "적요");
  match(MERCHANT_KEYWORDS, "거래처");
  match(CARD_KEYWORDS, "카드번호");

  // 입출금 모두 없으면 단일 금액 컬럼 시도
  if (!usedFields.has("입금액") && !usedFields.has("출금액")) {
    match(AMOUNT_KEYWORDS, "금액");
  }

  return mapping;
}

/**
 * 프리셋 매칭 (파일명 패턴)
 */
function matchPreset(filename: string): { name: string; column_mapping: string } | null {
  const db = getDb();
  const presets = db.prepare("SELECT name, pattern, column_mapping FROM import_presets ORDER BY id DESC").all() as {
    name: string; pattern: string; column_mapping: string;
  }[];

  for (const p of presets) {
    if (p.pattern && filename.includes(p.pattern)) {
      return p;
    }
  }
  return null;
}

/**
 * 거래 유형 추정 (파일명 + 컬럼명)
 */
function detectTransactionType(filename: string, headers: string[]): string {
  const fn = filename.toLowerCase();
  if (["카드", "card", "신용", "체크"].some((k) => fn.includes(k))) return "카드";
  if (["통장", "계좌", "bank", "입출금", "예금"].some((k) => fn.includes(k))) return "통장";
  if (["현금", "cash", "영수증"].some((k) => fn.includes(k))) return "현금";

  const cols = headers.join(" ").toLowerCase();
  if (["카드", "승인", "가맹점"].some((k) => cols.includes(k))) return "카드";
  if (["잔액", "잔고"].some((k) => cols.includes(k))) return "통장";

  return "기타";
}

/**
 * 거래 ID 생성 (MD5 해시)
 */
function generateTxId(date: string, amount: number, desc: string): string {
  const raw = `${date}|${amount}|${desc}`;
  return crypto.createHash("md5").update(raw).digest("hex").substring(0, 12);
}

/**
 * 금액 파싱 (문자열 → 숫자)
 */
function parseAmount(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[,원₩\s]/g, "").trim();
  if (!s || s === "-") return 0;
  return parseFloat(s) || 0;
}

/**
 * 자체이체 감지
 */
function isInternalTransfer(text: string): boolean {
  const db = getDb();

  // 계좌번호 매칭
  const accounts = db.prepare("SELECT number FROM accounts").all() as { number: string }[];
  const textDigits = text.replace(/[^0-9]/g, "");
  for (const acc of accounts) {
    const accDigits = acc.number.replace(/[^0-9]/g, "");
    if (accDigits && (textDigits.includes(accDigits) || text.includes(acc.number))) {
      return true;
    }
  }

  // 키워드 매칭
  const keywords = db.prepare("SELECT keyword FROM transfer_keywords").all() as { keyword: string }[];
  const textLower = text.toLowerCase();
  for (const kw of keywords) {
    if (kw.keyword && textLower.includes(kw.keyword.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * 파일 임포트 실행 (매핑 확정 후)
 */
export function importFile(
  buffer: Buffer,
  filename: string,
  columnMapping: ColumnMapping,
  headerRow: number = 0,
): ImportResult {
  const db = getDb();
  const wb = XLSX.read(buffer, { type: "buffer" });

  // 가장 큰 시트
  let bestSheet = wb.SheetNames[0];
  let bestLen = 0;
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][];
    if (r.length > bestLen) { bestLen = r.length; bestSheet = name; }
  }

  const ws = wb.Sheets[bestSheet];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  const headers = (rawRows[headerRow] || []).map((h) => String(h ?? "").trim());
  const dataRows = rawRows.slice(headerRow + 1);

  const txType = detectTransactionType(filename, headers);
  const now = new Date().toISOString().substring(0, 16).replace("T", " ");

  // 역매핑: 필드 → 컬럼 인덱스
  const fieldToIndex: Record<string, number> = {};
  for (const [col, field] of Object.entries(columnMapping)) {
    if (field === "무시") continue;
    const idx = headers.indexOf(col);
    if (idx >= 0) fieldToIndex[field] = idx;
  }

  // 기존 ID 목록
  const existingIds = new Set(
    (db.prepare("SELECT id FROM transactions").all() as { id: string }[]).map((r) => r.id)
  );

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
    (id, date, type, amount_in, amount_out, balance, description, merchant,
     major_category, minor_category, memo, source_file, imported_at, card_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let newCount = 0;
  let dupCount = 0;
  let internalCount = 0;
  const errors: string[] = [];

  const insertAll = db.transaction(() => {
    for (const row of dataRows) {
      // 합계행 건너뛰기
      const firstVal = String(row[0] ?? "").trim();
      if (!firstVal || firstVal === "합계" || firstVal === "소계") continue;

      // 날짜 파싱
      const dateIdx = fieldToIndex["거래일자"];
      if (dateIdx === undefined) continue;
      const rawDate = row[dateIdx];
      if (rawDate == null || String(rawDate).trim() === "") continue;

      let dateStr = "";
      if (typeof rawDate === "number") {
        // 엑셀 시리얼 넘버
        const d = XLSX.SSF.parse_date_code(rawDate);
        dateStr = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")} ${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}:${String(d.S).padStart(2, "0")}`;
      } else {
        dateStr = String(rawDate).trim();
        // YYYYMMDD → YYYY-MM-DD
        if (/^\d{8}$/.test(dateStr)) {
          dateStr = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        }
      }

      // 금액 파싱
      let amountIn = 0, amountOut = 0;
      if (fieldToIndex["입금액"] !== undefined) {
        amountIn = parseAmount(row[fieldToIndex["입금액"]]);
      }
      if (fieldToIndex["출금액"] !== undefined) {
        amountOut = parseAmount(row[fieldToIndex["출금액"]]);
      }
      // 단일 금액 컬럼
      if (fieldToIndex["금액"] !== undefined && fieldToIndex["입금액"] === undefined && fieldToIndex["출금액"] === undefined) {
        const amt = parseAmount(row[fieldToIndex["금액"]]);
        if (amt >= 0) amountIn = amt;
        else amountOut = Math.abs(amt);
      }

      // 적요, 거래처
      const desc = fieldToIndex["적요"] !== undefined ? String(row[fieldToIndex["적요"]] ?? "").trim() : "";
      let merchant = fieldToIndex["거래처"] !== undefined ? String(row[fieldToIndex["거래처"]] ?? "").trim() : "";
      if (!merchant && desc) merchant = desc;

      // 잔액
      const balance = fieldToIndex["잔액"] !== undefined ? parseAmount(row[fieldToIndex["잔액"]]) : null;

      // 카드번호
      const cardNum = fieldToIndex["카드번호"] !== undefined ? String(row[fieldToIndex["카드번호"]] ?? "").trim() : "";

      // 자체이체 감지
      const checkText = `${desc} ${merchant}`;
      const isInternal = isInternalTransfer(checkText);
      if (isInternal) internalCount++;

      // ID 생성 + 중복 체크
      const txId = generateTxId(dateStr, amountIn || amountOut, desc);
      if (existingIds.has(txId)) {
        dupCount++;
        continue;
      }

      insertStmt.run(
        txId, dateStr, txType, amountIn, amountOut, balance,
        desc, merchant,
        isInternal ? "자체이체" : "", isInternal ? "자체이체" : "",
        isInternal ? "[자체이체]" : "",
        filename, now, cardNum
      );
      existingIds.add(txId);
      newCount++;
    }
  });

  insertAll();

  // 자동 분류 실행
  if (newCount > 0) {
    classifyNewTransactions();
  }

  return { newCount, dupCount, totalCount: newCount + dupCount, internalCount, errors };
}

/**
 * 미분류 거래에 대해 자동 분류 실행
 */
function classifyNewTransactions() {
  const db = getDb();

  // 분류 규칙 로드 (긴 키워드 우선)
  const rules = db.prepare(
    "SELECT major_category, minor_category, keyword FROM classification_rules ORDER BY priority DESC"
  ).all() as { major_category: string; minor_category: string; keyword: string }[];

  // 인력 로드
  const people = db.prepare(
    "SELECT name, role, aliases FROM people"
  ).all() as { name: string; role: string; aliases: string | null }[];

  const roleMap: Record<string, [string, string]> = {
    "가이드": ["변동비", "가이드비"],
    "기사": ["변동비", "차량비"],
    "보조": ["변동비", "보조비"],
  };

  // 미분류 거래 조회
  const unclassified = db.prepare(
    "SELECT id, description, merchant FROM transactions WHERE major_category IN ('', '미분류') OR major_category IS NULL"
  ).all() as { id: string; description: string; merchant: string }[];

  const updateStmt = db.prepare(
    "UPDATE transactions SET major_category = ?, minor_category = ?, memo = COALESCE(memo, '') || ' [자동]' WHERE id = ?"
  );

  const classifyAll = db.transaction(() => {
    for (const tx of unclassified) {
      const text = `${tx.description} ${tx.merchant}`.toLowerCase();

      // 키워드 매칭
      let matched = false;
      for (const rule of rules) {
        if (text.includes(rule.keyword.toLowerCase())) {
          updateStmt.run(rule.major_category, rule.minor_category, tx.id);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 인력 이름 매칭
      for (const p of people) {
        const names = [p.name];
        if (p.aliases) {
          try {
            const aliasArr = JSON.parse(p.aliases);
            if (Array.isArray(aliasArr)) names.push(...aliasArr);
          } catch { /* 무시 */ }
        }
        for (const name of names) {
          if (name && text.includes(name.toLowerCase())) {
            const cat = roleMap[p.role];
            if (cat) {
              updateStmt.run(cat[0], cat[1], tx.id);
              matched = true;
              break;
            }
          }
        }
        if (matched) break;
      }
    }
  });

  classifyAll();
}

/**
 * 프리셋 저장
 */
export function savePreset(name: string, pattern: string, mapping: ColumnMapping, headerRow: number, txType: string) {
  const db = getDb();
  db.prepare(
    "INSERT INTO import_presets (name, pattern, column_mapping, header_row, transaction_type) VALUES (?, ?, ?, ?, ?)"
  ).run(name, pattern, JSON.stringify(mapping), headerRow, txType);
}
