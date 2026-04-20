"""데이터 가져오기 모듈 — 엑셀/CSV 파일을 읽어 통합 마스터 데이터에 병합"""

import os
import shutil
from datetime import datetime
from pathlib import Path

import chardet
import pandas as pd

import re as _re
import yaml

from .utils import (
    RAW_DIR, MASTER_FILE, CONFIG_DIR, ensure_dirs,
    generate_transaction_id, parse_amount,
)

ACCOUNTS_FILE = CONFIG_DIR / "accounts.yaml"


def load_accounts():
    """자체 계좌 목록 + 키워드 로드"""
    if not ACCOUNTS_FILE.exists():
        return {"accounts": [], "keywords": []}
    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return {
        "accounts": data.get("accounts", []),
        "keywords": data.get("keywords", []),
        "file_mapping": data.get("file_mapping", []),
    }


def save_accounts(data):
    """자체 계좌 목록 + 키워드 저장"""
    ensure_dirs()
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        yaml.dump(
            data,
            f, allow_unicode=True, default_flow_style=False, sort_keys=False,
        )


def _strip_number(s):
    """계좌번호에서 숫자만 추출"""
    return _re.sub(r"[^0-9]", "", str(s))


def is_internal_transfer(row_text, acc_data):
    """
    거래 적요/계좌번호 등에 자체 계좌번호 또는 자사 키워드가 포함되어 있으면 True.
    row_text: 적요, 거래처, 계좌번호 등을 합친 문자열
    acc_data: {"accounts": [...], "keywords": [...]}
    """
    if not acc_data:
        return False

    accounts = acc_data.get("accounts", []) if isinstance(acc_data, dict) else acc_data
    keywords = acc_data.get("keywords", []) if isinstance(acc_data, dict) else []

    text_digits = _strip_number(row_text)
    text_str = str(row_text).lower()

    # 계좌번호 매칭
    for acc in accounts:
        num = acc.get("number", "")
        num_stripped = _strip_number(num)
        if num_stripped and (num_stripped in text_digits or num in str(row_text)):
            return True

    # 키워드 매칭 (회사명 등)
    for kw in keywords:
        if isinstance(kw, str) and kw.strip() and kw.strip().lower() in text_str:
            return True

    return False


# 통합 마스터 데이터 컬럼 정의
MASTER_COLUMNS = [
    "거래ID",        # 중복 감지용 해시
    "거래일자",      # datetime
    "거래유형",      # 카드/통장/현금
    "입금액",        # 수입
    "출금액",        # 지출
    "잔액",          # 거래 후 잔액 (있는 경우)
    "적요",          # 거래 내용/적요
    "거래처",        # 상호명
    "대분류",        # 고정비/변동비/수입/미분류
    "중분류",        # 세부 카테고리
    "메모",          # 사용자 메모
    "카드번호",      # 카드 사용 시 카드번호
    "원본파일",      # 원본 파일명
    "가져온날짜",    # import 일시
]


def detect_encoding(filepath):
    """파일 인코딩 자동 감지"""
    with open(filepath, "rb") as f:
        raw = f.read(min(100000, os.path.getsize(filepath)))
    result = chardet.detect(raw)
    encoding = result["encoding"]
    # 한국어 파일에서 흔한 인코딩 보정
    if encoding and encoding.lower() in ("euc-kr", "iso-8859-1", "windows-1252"):
        encoding = "cp949"
    return encoding or "utf-8"


def _patch_openpyxl_for_korean_banks():
    """
    한국 은행/카드사 엑셀 파일 호환성 패치.
    비표준 XML 속성(styleId, xfid 등)을 openpyxl이 무시하도록 한다.
    """
    from openpyxl.descriptors.serialisable import Serialisable

    _original_from_tree = Serialisable.from_tree.__func__

    @classmethod
    def _safe_from_tree(cls, node):
        try:
            return _original_from_tree(cls, node)
        except TypeError as e:
            if "unexpected keyword argument" not in str(e):
                raise
            # 비표준 속성을 제거하고 재시도
            import re
            bad_kwarg = re.search(r"'(\w+)'", str(e))
            if bad_kwarg:
                bad_key = bad_kwarg.group(1)
                if bad_key in node.attrib:
                    del node.attrib[bad_key]
                return _safe_from_tree.__func__(cls, node)
            raise

    Serialisable.from_tree = _safe_from_tree


# 모듈 로드 시 패치 적용
_patch_openpyxl_for_korean_banks()


_HEADER_KEYWORDS = {"거래일", "일자", "날짜", "이용일", "승인일", "사용일", "결제일",
                     "입금", "출금", "금액", "잔액", "적요", "내용", "거래내용",
                     "가맹점", "상호", "거래처", "거래일시", "이용금액", "사용금액"}


def _find_header_row(filepath, max_scan=20):
    """
    엑셀 파일에서 실제 헤더 행을 자동 탐지.
    상위 max_scan 행을 스캔하여 금융 키워드가 가장 많은 행을 헤더로 판단.
    """
    xls = pd.ExcelFile(filepath)
    # 가장 큰 시트 찾기
    best_sheet = xls.sheet_names[0]
    best_len = 0
    for s in xls.sheet_names:
        n = len(pd.read_excel(xls, sheet_name=s, header=None, nrows=1).columns)
        df_tmp = pd.read_excel(xls, sheet_name=s, header=None)
        if len(df_tmp) > best_len:
            best_len = len(df_tmp)
            best_sheet = s

    df_raw = pd.read_excel(xls, sheet_name=best_sheet, header=None,
                           nrows=max_scan)

    best_row = 0
    best_score = 0
    for i, row in df_raw.iterrows():
        vals = [str(v).strip().replace(" ", "") for v in row if pd.notna(v)]
        score = sum(1 for v in vals
                    for kw in _HEADER_KEYWORDS
                    if kw in v)
        if score > best_score:
            best_score = score
            best_row = i

    return best_sheet, int(best_row) if best_score >= 2 else None


def read_file(filepath):
    """엑셀 또는 CSV 파일을 DataFrame으로 읽기 (헤더 행 자동 탐지)"""
    filepath = Path(filepath)
    ext = filepath.suffix.lower()

    if ext in (".xlsx", ".xls"):
        sheet, header_row = _find_header_row(filepath)

        if header_row is not None and header_row > 0:
            # 헤더가 첫 행이 아닌 경우: 해당 행을 헤더로 사용
            df = pd.read_excel(filepath, sheet_name=sheet, header=header_row)
            # 'Unnamed' 컬럼 제거 (빈 열)
            df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
            # 번호 컬럼 제거 (1, 2, 3... 순번만 있는 컬럼)
            for col in df.columns:
                if df[col].dtype in ("int64", "float64"):
                    vals = df[col].dropna()
                    if len(vals) > 2 and list(vals[:5]) == list(range(1, min(6, len(vals) + 1))):
                        df = df.drop(columns=[col])
                        break
            return df
        else:
            # 일반 엑셀: 모든 시트 중 가장 큰 것
            xls = pd.ExcelFile(filepath)
            best_df = None
            best_rows = 0
            for s in xls.sheet_names:
                df = pd.read_excel(xls, sheet_name=s)
                if len(df) > best_rows:
                    best_df = df
                    best_rows = len(df)
            if best_df is None:
                return pd.DataFrame()
            if _is_headerless_bank_file(best_df):
                best_df = _fix_headerless_bank(best_df)
            return best_df

    elif ext in (".csv", ".tsv"):
        encoding = detect_encoding(filepath)
        sep = "\t" if ext == ".tsv" else ","
        try:
            return pd.read_csv(filepath, encoding=encoding, sep=sep)
        except UnicodeDecodeError:
            return pd.read_csv(filepath, encoding="cp949", sep=sep)

    else:
        raise ValueError(f"지원하지 않는 파일 형식: {ext}")


def _is_headerless_bank_file(df):
    """헤더 없이 데이터가 바로 시작하는 은행 파일인지 감지"""
    cols = df.columns.tolist()
    # 컬럼명이 숫자이거나, 첫 번째 컬럼이 날짜 형식인 경우
    if all(isinstance(c, (int, float)) for c in cols):
        return True
    # 첫 번째 컬럼값이 날짜 패턴인 경우 (예: "2025-12-31 16:36:10")
    first_col = str(cols[0])
    if len(first_col) >= 10:
        import re
        if re.match(r"\d{4}-\d{2}-\d{2}", first_col):
            return True
    return False


def _fix_headerless_bank(df):
    """
    헤더 없는 은행 파일을 처리.
    기업은행 등 한국 은행 내역 형식:
      col0: 거래일시, col1: 입금, col2: 출금, col3: 잔액, col4: 적요,
      col5: 계좌번호, col6: 은행명, col7: ?, col8: 거래수단, col9: ?, col10: ?, col11: 상대방명
    """
    # 현재 컬럼명(첫 데이터 행)을 데이터로 복원
    first_row = pd.DataFrame([df.columns.tolist()], columns=range(len(df.columns)))
    df.columns = range(len(df.columns))
    df = pd.concat([first_row, df], ignore_index=True)

    # 컬럼 수에 따라 매핑
    num_cols = len(df.columns)
    col_names = {}

    if num_cols >= 5:
        col_names[0] = "거래일시"
        col_names[1] = "입금액"
        col_names[2] = "출금액"
        col_names[3] = "잔액"
        col_names[4] = "적요"
    if num_cols >= 6:
        col_names[5] = "계좌번호"
    if num_cols >= 7:
        col_names[6] = "은행명"
    if num_cols >= 9:
        col_names[8] = "거래수단"
    if num_cols >= 12:
        col_names[11] = "상대방명"

    # 나머지는 기타1, 기타2...
    for i in range(num_cols):
        if i not in col_names:
            col_names[i] = f"기타{i}"

    df.rename(columns=col_names, inplace=True)
    return df


def detect_column_mapping(df):
    """DataFrame의 컬럼명을 분석하여 표준 필드에 매핑"""
    col_lower = {c: str(c).strip().replace(" ", "") for c in df.columns}
    mapping = {}

    # 날짜 컬럼 탐지
    date_keywords = ["거래일", "일자", "날짜", "거래일자", "이용일", "이용일자",
                     "승인일", "사용일", "결제일", "date", "거래일시"]
    for col, clean in col_lower.items():
        for kw in date_keywords:
            if kw in clean.lower():
                mapping["거래일자"] = col
                break

    # 금액 컬럼 탐지
    debit_keywords = ["출금", "지출", "사용금액", "이용금액", "결제금액", "출금액",
                      "매출", "청구금액", "debit", "지급액"]
    credit_keywords = ["입금", "수입", "입금액", "받은금액", "credit", "수금액"]
    amount_keywords = ["금액", "amount", "거래금액"]
    balance_keywords = ["잔액", "잔고", "balance", "거래후잔액"]

    for col, clean in col_lower.items():
        cl = clean.lower()
        for kw in debit_keywords:
            if kw in cl and "입금" not in mapping:
                mapping["출금액"] = col
                break
        for kw in credit_keywords:
            if kw in cl:
                mapping["입금액"] = col
                break
        for kw in balance_keywords:
            if kw in cl:
                mapping["잔액"] = col
                break

    # 입출금이 하나의 금액 컬럼인 경우
    if "출금액" not in mapping and "입금액" not in mapping:
        for col, clean in col_lower.items():
            for kw in amount_keywords:
                if kw in clean.lower():
                    mapping["금액"] = col
                    break

    # 적요/내용 컬럼 탐지 (내용/내역 우선, 가맹점명은 후순위)
    desc_keywords_primary = ["적요", "내용", "거래내용", "이용내역", "사용처", "비고",
                             "description", "memo", "상세내용"]
    desc_keywords_fallback = ["가맹점명"]
    for col, clean in col_lower.items():
        for kw in desc_keywords_primary:
            if kw in clean.lower():
                mapping["적요"] = col
                break
    if "적요" not in mapping:
        for col, clean in col_lower.items():
            for kw in desc_keywords_fallback:
                if kw in clean.lower():
                    mapping["적요"] = col
                    break

    # 거래처/상호명 컬럼 탐지 (적요와 다른 컬럼 우선)
    merchant_keywords = ["거래처", "상호", "가맹점", "merchant", "상호명", "업소명",
                         "상대방", "예금주명", "상대계좌예금주"]
    for col, clean in col_lower.items():
        for kw in merchant_keywords:
            if kw in clean.lower():
                # 이미 적요로 매핑된 컬럼이면 건너뛰기 (다른 컬럼이 있을 수 있음)
                if "적요" in mapping and col == mapping["적요"]:
                    continue
                mapping["거래처"] = col
                break
    # 적요와 거래처가 모두 매핑 안 된 경우에만 동일 컬럼 허용
    if "거래처" not in mapping:
        for col, clean in col_lower.items():
            for kw in merchant_keywords:
                if kw in clean.lower():
                    mapping["거래처"] = col
                    break

    # 카드번호 컬럼 탐지
    card_keywords = ["카드번호", "카드", "card", "카드종류", "카드명"]
    for col, clean in col_lower.items():
        cl = clean.lower()
        # "카드" 단독 매칭 시 다른 컬럼과 충돌 방지 (금액/일자 등 제외)
        for kw in card_keywords:
            if kw in cl and "금액" not in cl and "일자" not in cl:
                mapping["카드번호"] = col
                break

    return mapping


def detect_transaction_type(filepath, df):
    """파일 내용을 분석하여 거래 유형(카드/통장/현금) 추정"""
    fname = Path(filepath).stem.lower()

    if any(kw in fname for kw in ["카드", "card", "신용", "체크"]):
        return "카드"
    if any(kw in fname for kw in ["통장", "계좌", "bank", "입출금", "예금"]):
        return "통장"
    if any(kw in fname for kw in ["현금", "cash", "영수증"]):
        return "현금"

    # 컬럼명으로 추정
    cols = " ".join(str(c) for c in df.columns).lower()
    if "카드" in cols or "승인" in cols or "가맹점" in cols:
        return "카드"
    if "잔액" in cols or "잔고" in cols or "입금" in cols:
        return "통장"

    return "기타"


def normalize_data(df, col_mapping, tx_type, source_file):
    """원본 데이터를 마스터 형식으로 정규화 (자체 계좌 이체 자동 제외)"""
    rows = []
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    own_accounts = load_accounts()
    internal_count = 0

    for _, row in df.iterrows():
        # 날짜 파싱
        date_val = None
        if "거래일자" in col_mapping:
            raw_date = row.get(col_mapping["거래일자"])
            if pd.notna(raw_date):
                try:
                    date_val = pd.to_datetime(raw_date)
                except (ValueError, TypeError):
                    date_val = None
        if date_val is None:
            continue  # 날짜 없는 행은 건너뜀

        # 금액 파싱
        credit = 0  # 입금
        debit = 0   # 출금

        if "입금액" in col_mapping:
            credit = parse_amount(row.get(col_mapping["입금액"]))
        if "출금액" in col_mapping:
            debit = parse_amount(row.get(col_mapping["출금액"]))

        # 단일 금액 컬럼인 경우: 양수=입금, 음수=출금
        if "금액" in col_mapping and "입금액" not in col_mapping and "출금액" not in col_mapping:
            amt = parse_amount(row.get(col_mapping["금액"]))
            if amt >= 0:
                credit = amt
            else:
                debit = abs(amt)

        # 입출금 모두 0이어도 거래 기록으로 포함 (결산, 이자 등)

        # 적요 / 거래처
        description = ""
        if "적요" in col_mapping:
            val = row.get(col_mapping["적요"])
            if pd.notna(val):
                description = str(val).strip()

        merchant = ""
        if "거래처" in col_mapping:
            val = row.get(col_mapping["거래처"])
            if pd.notna(val):
                merchant = str(val).strip()

        # 잔액
        balance = None
        if "잔액" in col_mapping:
            balance = parse_amount(row.get(col_mapping["잔액"]))

        # 카드번호
        card_number = ""
        if "카드번호" in col_mapping:
            val = row.get(col_mapping["카드번호"])
            if pd.notna(val):
                card_number = str(val).strip()

        # 적요가 없으면 거래처를, 거래처가 없으면 적요를 상호 보완
        if not description and merchant:
            description = merchant
        if not merchant and description:
            merchant = description

        # 자체 계좌 간 이체 감지 — 적요, 거래처, 계좌번호 컬럼을 모두 검사
        check_parts = [description, merchant]
        # 원본 행에 계좌번호 컬럼이 있으면 추가
        for extra_col in ("계좌번호", "상대계좌", "상대방계좌"):
            if extra_col in row.index:
                val = row.get(extra_col)
                if pd.notna(val):
                    check_parts.append(str(val))
        combined_text = " ".join(check_parts)
        is_internal = is_internal_transfer(combined_text, own_accounts)
        if is_internal:
            internal_count += 1

        tx_id = generate_transaction_id(
            date_val.strftime("%Y-%m-%d"), credit or debit, description
        )

        rows.append({
            "거래ID": tx_id,
            "거래일자": date_val,
            "거래유형": tx_type,
            "입금액": credit,
            "출금액": debit,
            "잔액": balance,
            "적요": description,
            "거래처": merchant,
            "대분류": "자체이체" if is_internal else "",
            "중분류": "자체이체" if is_internal else "",
            "메모": "[자체이체]" if is_internal else "",
            "카드번호": card_number,
            "원본파일": Path(source_file).name,
            "가져온날짜": now,
        })

    result = pd.DataFrame(rows, columns=MASTER_COLUMNS)
    result.attrs["internal_excluded"] = internal_count
    return result


def load_master():
    """마스터 데이터 로드 (없으면 빈 DataFrame 반환)"""
    if MASTER_FILE.exists():
        df = pd.read_excel(MASTER_FILE)
        # 거래일자 컬럼 datetime 변환
        if "거래일자" in df.columns:
            df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
        return df
    # 빈 DataFrame에 올바른 dtype 지정
    df = pd.DataFrame(columns=MASTER_COLUMNS)
    df["대분류"] = df["대분류"].astype(str)
    df["중분류"] = df["중분류"].astype(str)
    df["메모"] = df["메모"].astype(str)
    return df


def save_master(df):
    """마스터 데이터 저장 (안전 쓰기: 임시 파일 → 교체)"""
    ensure_dirs()
    if df.empty:
        # 빈 DataFrame으로 마스터를 덮어쓰는 것 방지
        raise ValueError("빈 데이터로 마스터를 저장할 수 없습니다.")
    tmp_path = MASTER_FILE.with_suffix(".tmp.xlsx")
    df.to_excel(tmp_path, index=False, engine="openpyxl")
    tmp_path.replace(MASTER_FILE)


def import_file(filepath):
    """
    파일을 읽어 마스터 데이터에 병합.
    반환: (신규 건수, 중복 건수, 전체 건수)
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {filepath}")

    ensure_dirs()

    # 1. 파일 읽기
    df_raw = read_file(filepath)
    if df_raw.empty:
        return 0, 0, 0, 0

    # 2. 컬럼 매핑 감지
    col_mapping = detect_column_mapping(df_raw)
    if "거래일자" not in col_mapping:
        raise ValueError(
            f"날짜 컬럼을 찾을 수 없습니다. 감지된 컬럼: {list(df_raw.columns)}\n"
            "날짜 컬럼명에 '거래일', '일자', '날짜' 등의 키워드가 포함되어야 합니다."
        )

    # 3. 거래 유형 추정
    tx_type = detect_transaction_type(filepath, df_raw)

    # 4. 데이터 정규화 (자체 이체 자동 제외)
    df_new = normalize_data(df_raw, col_mapping, tx_type, filepath)
    internal_excluded = df_new.attrs.get("internal_excluded", 0)

    # 5. 마스터 데이터 로드 및 중복 제거 병합
    df_master = load_master()
    existing_ids = set(df_master["거래ID"].tolist()) if not df_master.empty else set()

    new_mask = ~df_new["거래ID"].isin(existing_ids)
    df_unique = df_new[new_mask]
    dup_count = len(df_new) - len(df_unique)

    if not df_unique.empty:
        df_master = pd.concat([df_master, df_unique], ignore_index=True)
        df_master.sort_values("거래일자", inplace=True)
        df_master.reset_index(drop=True, inplace=True)

    # 6. 저장
    save_master(df_master)

    # 7. 원본 파일을 raw 폴더에 백업
    backup_path = RAW_DIR / filepath.name
    if not backup_path.exists():
        shutil.copy2(filepath, backup_path)

    return len(df_unique), dup_count, len(df_master), internal_excluded
