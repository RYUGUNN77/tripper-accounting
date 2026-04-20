"""외화 계좌 관리 모듈 — 외화 거래 임포트, 분석, 자체이체 매칭"""

import pandas as pd
import hashlib
import shutil
from pathlib import Path
from datetime import datetime

from .utils import DATA_DIR, ensure_dirs, add_log

FOREX_MASTER = DATA_DIR / "forex_master.xlsx"
FOREX_RAW_DIR = DATA_DIR / "forex_raw"


def ensure_forex_dirs():
    ensure_dirs()
    FOREX_RAW_DIR.mkdir(parents=True, exist_ok=True)


def _generate_forex_id(date, amount_in, amount_out, memo):
    raw = f"FX|{date}|{amount_in}|{amount_out}|{memo}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def parse_forex_excel(filepath):
    """
    외화 계좌 엑셀 파싱.
    IBK 외화통장 형식: 헤더 3행 → 데이터행 → 마지막 합계행
    반환: DataFrame
    """
    filepath = Path(filepath)
    try:
        df = pd.read_excel(filepath, engine="calamine", header=None)
    except Exception:
        df = pd.read_excel(filepath, engine="openpyxl", header=None)

    # 헤더행 찾기 (거래일시 컬럼)
    header_idx = None
    for i in range(min(10, len(df))):
        row_vals = [str(v).strip() for v in df.iloc[i].values if pd.notna(v)]
        if "거래일시" in row_vals:
            header_idx = i
            break

    if header_idx is None:
        raise ValueError("외화 계좌 형식을 인식할 수 없습니다.")

    # 계좌 정보 추출 (1행)
    account_info = str(df.iloc[1, 0]) if len(df) > 1 else ""
    currency = "USD"  # 기본값

    # 헤더 설정
    headers = df.iloc[header_idx].values
    col_map = {}
    for ci, h in enumerate(headers):
        hs = str(h).strip() if pd.notna(h) else ""
        if hs == "거래일시":
            col_map["거래일시"] = ci
        elif hs == "통화":
            col_map["통화"] = ci
        elif hs == "입금":
            col_map["입금"] = ci
        elif hs == "출금":
            col_map["출금"] = ci
        elif hs == "거래후잔액":
            col_map["잔액"] = ci
        elif hs == "적요":
            col_map["적요"] = ci
        elif hs == "해외수입업자":
            col_map["해외수입업자"] = ci

    data_start = header_idx + 1
    rows = []

    for i in range(data_start, len(df)):
        row = df.iloc[i]

        # 합계행 건너뛰기
        date_val = row.iloc[col_map.get("거래일시", 1)] if "거래일시" in col_map else None
        if pd.isna(date_val) or str(date_val).strip() in ("합계", ""):
            # 번호 컬럼(0)이 NaN이면 합계행
            if pd.isna(row.iloc[0]):
                continue

        date_str = str(date_val).strip() if pd.notna(date_val) else ""
        if not date_str or date_str == "합계":
            continue

        cur = str(row.iloc[col_map["통화"]]).strip() if "통화" in col_map and pd.notna(row.iloc[col_map["통화"]]) else currency
        amount_in = row.iloc[col_map["입금"]] if "입금" in col_map else 0
        amount_out = row.iloc[col_map["출금"]] if "출금" in col_map else 0
        balance = row.iloc[col_map["잔액"]] if "잔액" in col_map else 0
        memo = str(row.iloc[col_map["적요"]]).strip() if "적요" in col_map and pd.notna(row.iloc[col_map["적요"]]) else ""
        counterpart = str(row.iloc[col_map["해외수입업자"]]).strip() if "해외수입업자" in col_map and pd.notna(row.iloc[col_map["해외수입업자"]]) else ""

        amount_in = float(amount_in) if pd.notna(amount_in) else 0
        amount_out = float(amount_out) if pd.notna(amount_out) else 0
        balance = float(balance) if pd.notna(balance) else 0

        # 날짜 파싱
        try:
            dt = pd.to_datetime(date_str)
        except Exception:
            continue

        # 거래 유형 판별
        if "해외송금" in memo:
            tx_type = "OTA입금"
        elif "원화입금" in memo or "TRIPPER" in memo.upper() or "트립퍼" in memo:
            tx_type = "환전출금"
        elif "결산" in memo:
            tx_type = "이자"
        else:
            tx_type = "기타"

        # 플랫폼 판별 + 분류
        platform = ""
        classification = ""
        cp_upper = counterpart.upper()
        if "VIATOR" in cp_upper:
            platform = "Viator"
            classification = "OTA"
        elif "GETYOURGUIDE" in cp_upper:
            platform = "GetYourGuide"
            classification = "OTA"
        elif "KLOOK" in cp_upper:
            platform = "Klook"
            classification = "OTA"
        elif "BEYONDER" in cp_upper:
            platform = "Beyonder"
            classification = "OTA"
        elif "AIRBNB" in cp_upper:
            platform = "Airbnb"
            classification = "OTA"
        elif "CIVITATIS" in cp_upper:
            platform = "Civitatis"
            classification = "OTA"
        elif "VIO TRAVEL" in cp_upper:
            platform = "Vio Travel"
            classification = "B2B"
        elif "EASTERN TRAVEL" in cp_upper:
            platform = "Eastern Travel"
            classification = "B2B"
        elif "OPERA" in cp_upper:
            platform = "Opera SRL"
            classification = "B2B"
        elif "ROCKWOOL" in cp_upper:
            platform = "Rockwool"
            classification = "B2B"
        elif "T I TOURS" in cp_upper or "TI TOURS" in cp_upper:
            platform = "TI Tours"
            classification = "B2B"
        elif counterpart:
            platform = counterpart
            classification = ""

        # 환전/이자는 분류 불필요
        if tx_type in ("환전출금", "이자", "기타"):
            classification = ""

        fx_id = _generate_forex_id(str(dt), amount_in, amount_out, memo)

        rows.append({
            "거래ID": fx_id,
            "거래일시": dt,
            "통화": cur,
            "입금": amount_in,
            "출금": amount_out,
            "잔액": balance,
            "적요": memo,
            "해외수입업자": counterpart,
            "거래유형": tx_type,
            "플랫폼": platform,
            "분류": classification,
            "원본파일": filepath.name,
        })

    return pd.DataFrame(rows)


def import_forex_file(filepath):
    """외화 파일 임포트 → forex_master.xlsx에 병합"""
    ensure_forex_dirs()
    filepath = Path(filepath)

    new_df = parse_forex_excel(filepath)
    if new_df.empty:
        return 0, 0

    # 기존 데이터 로드
    if FOREX_MASTER.exists():
        existing = pd.read_excel(FOREX_MASTER, engine="openpyxl")
        existing_ids = set(existing["거래ID"].astype(str))
        before_count = len(existing)

        # 중복 제거
        new_only = new_df[~new_df["거래ID"].astype(str).isin(existing_ids)]
        if new_only.empty:
            return 0, len(new_df)

        merged = pd.concat([existing, new_only], ignore_index=True)
    else:
        merged = new_df
        new_only = new_df
        before_count = 0

    # 날짜순 정렬
    merged["거래일시"] = pd.to_datetime(merged["거래일시"], errors="coerce")
    merged.sort_values("거래일시", inplace=True)

    # 저장
    tmp = FOREX_MASTER.with_suffix(".tmp.xlsx")
    merged.to_excel(tmp, index=False, engine="openpyxl")
    tmp.replace(FOREX_MASTER)

    # 원본 백업
    backup = FOREX_RAW_DIR / filepath.name
    if not backup.exists():
        shutil.copy2(filepath, backup)

    added = len(new_only)
    dupes = len(new_df) - added
    add_log("외화 파일 업로드", f"{filepath.name} ({added}건 추가, {dupes}건 중복)", added)
    return added, dupes


def load_forex():
    """외화 마스터 로드"""
    if not FOREX_MASTER.exists():
        return pd.DataFrame()
    df = pd.read_excel(FOREX_MASTER, engine="openpyxl")
    df["거래일시"] = pd.to_datetime(df["거래일시"], errors="coerce")
    return df


def forex_summary(df=None):
    """외화 계좌 전체 요약"""
    if df is None:
        df = load_forex()
    if df.empty:
        return {"데이터없음": True}

    df["연월"] = df["거래일시"].dt.to_period("M").astype(str)

    total_in = float(df["입금"].sum())
    total_out = float(df["출금"].sum())

    # OTA 입금만 (실매출)
    ota = df[df["거래유형"] == "OTA입금"]
    ota_total = float(ota["입금"].sum())

    # 플랫폼별
    platform_summary = {}
    for plat, grp in ota.groupby("플랫폼"):
        platform_summary[plat] = {
            "입금USD": float(grp["입금"].sum()),
            "건수": int(len(grp)),
        }

    # 현재 잔액 (가장 최근 거래의 잔액)
    latest = df.sort_values("거래일시").iloc[-1]
    balance = float(latest["잔액"]) if pd.notna(latest["잔액"]) else 0

    # 환전 출금
    conversions = df[df["거래유형"] == "환전출금"]
    total_converted = float(conversions["출금"].sum())

    return {
        "총입금USD": total_in,
        "총출금USD": total_out,
        "OTA매출USD": ota_total,
        "환전출금USD": total_converted,
        "현재잔액USD": balance,
        "총거래건수": int(len(df)),
        "OTA건수": int(len(ota)),
        "플랫폼별": platform_summary,
        "통화": str(latest["통화"]) if pd.notna(latest["통화"]) else "USD",
        "분류별": {
            cls: {"입금USD": float(grp["입금"].sum()), "건수": int(len(grp))}
            for cls, grp in ota.groupby(ota["분류"].fillna("미분류")) if cls
        },
    }


def forex_monthly_trend(df=None):
    """월별 외화 수입 추이"""
    if df is None:
        df = load_forex()
    if df.empty:
        return []

    df["연월"] = df["거래일시"].dt.to_period("M").astype(str)
    ota = df[df["거래유형"] == "OTA입금"]

    monthly = []
    for ym in sorted(df["연월"].unique()):
        ota_m = ota[ota["연월"] == ym]
        conv_m = df[(df["연월"] == ym) & (df["거래유형"] == "환전출금")]

        # 플랫폼별 분리
        platforms = {}
        for plat, grp in ota_m.groupby("플랫폼"):
            platforms[plat] = float(grp["입금"].sum())

        monthly.append({
            "연월": ym,
            "OTA입금": float(ota_m["입금"].sum()),
            "환전출금": float(conv_m["출금"].sum()),
            "플랫폼별": platforms,
        })

    return monthly


def forex_platform_detail(df=None, platform=None):
    """특정 플랫폼 상세 내역"""
    if df is None:
        df = load_forex()
    if df.empty:
        return []

    ota = df[df["거래유형"] == "OTA입금"]
    if platform:
        ota = ota[ota["플랫폼"] == platform]

    records = []
    for _, row in ota.iterrows():
        records.append({
            "거래일시": row["거래일시"].strftime("%Y-%m-%d %H:%M") if pd.notna(row["거래일시"]) else "",
            "입금": float(row["입금"]),
            "플랫폼": str(row["플랫폼"]),
            "해외수입업자": str(row["해외수입업자"]) if pd.notna(row["해외수입업자"]) else "",
        })
    return records


def match_transfers(forex_df=None, krw_df=None):
    """
    외화 환전출금 ↔ 원화 자체이체 매칭.
    외화 출금일 전후 3일 내 원화 자체이체 입금 중 매칭 시도.
    반환: list of {외화거래, 원화거래, 환율}
    """
    if forex_df is None:
        forex_df = load_forex()
    if forex_df.empty:
        return []

    conversions = forex_df[forex_df["거래유형"] == "환전출금"].copy()
    if conversions.empty:
        return []

    # 원화 마스터에서 자체이체 입금 가져오기
    if krw_df is None:
        from .importer import load_master
        krw_df = load_master()

    if krw_df.empty:
        return []

    krw_df["거래일자"] = pd.to_datetime(krw_df["거래일자"], errors="coerce")
    # 자체이체 또는 이미 OTA환전으로 재분류된 입금 모두 매칭 대상
    transfers = krw_df[
        (
            (krw_df["대분류"].fillna("") == "자체이체") |
            ((krw_df["대분류"].fillna("") == "수입") & (krw_df["중분류"].fillna("") == "OTA환전"))
        ) &
        (krw_df["입금액"] > 0)
    ].copy()

    if transfers.empty:
        return []

    matches = []
    used_krw_ids = set()

    for _, fx_row in conversions.iterrows():
        fx_date = fx_row["거래일시"]
        fx_usd = float(fx_row["출금"])
        if pd.isna(fx_date) or fx_usd <= 0:
            continue

        # 전후 3일 범위
        date_min = fx_date - pd.Timedelta(days=3)
        date_max = fx_date + pd.Timedelta(days=3)

        candidates = transfers[
            (transfers["거래일자"] >= date_min) &
            (transfers["거래일자"] <= date_max) &
            (~transfers["거래ID"].isin(used_krw_ids))
        ]

        if candidates.empty:
            matches.append({
                "외화일자": fx_date.strftime("%Y-%m-%d"),
                "USD금액": fx_usd,
                "원화일자": None,
                "KRW금액": None,
                "환율": None,
                "매칭상태": "미매칭",
            })
            continue

        # 환율 범위로 매칭 시도
        best = None
        best_rate = None
        for _, krw_row in candidates.iterrows():
            krw_amount = float(krw_row["입금액"])
            rate = krw_amount / fx_usd if fx_usd > 0 else 0
            if 1100 <= rate <= 1700:
                if best is None or abs(rate - 1350) < abs(best_rate - 1350):
                    best = krw_row
                    best_rate = rate

        if best is not None:
            used_krw_ids.add(best["거래ID"])
            matches.append({
                "외화일자": fx_date.strftime("%Y-%m-%d"),
                "USD금액": fx_usd,
                "원화일자": best["거래일자"].strftime("%Y-%m-%d"),
                "KRW금액": float(best["입금액"]),
                "환율": round(best_rate, 2),
                "매칭상태": "매칭됨",
                "원화적요": str(best["적요"])[:30] if pd.notna(best["적요"]) else "",
                "원화거래ID": str(best["거래ID"]),
            })
        else:
            matches.append({
                "외화일자": fx_date.strftime("%Y-%m-%d"),
                "USD금액": fx_usd,
                "원화일자": None,
                "KRW금액": None,
                "환율": None,
                "매칭상태": "미매칭",
            })

    return matches


def reclassify_forex_transfers():
    """
    외화 환전과 매칭된 원화 자체이체를 수입/OTA환전으로 재분류.
    반환: 변경된 건수
    """
    from .importer import load_master, save_master

    matches = match_transfers()
    matched_ids = [m["원화거래ID"] for m in matches if m["매칭상태"] == "매칭됨" and m.get("원화거래ID")]

    if not matched_ids:
        return 0

    df = load_master()
    changed = 0

    for tx_id in matched_ids:
        mask = df["거래ID"] == tx_id
        if mask.sum() == 0:
            continue
        current_major = str(df.loc[mask, "대분류"].iloc[0]) if pd.notna(df.loc[mask, "대분류"].iloc[0]) else ""
        # 이미 수입으로 분류되어 있으면 건너뛰기
        if current_major == "수입":
            continue
        df.loc[mask, "대분류"] = "수입"
        df.loc[mask, "중분류"] = "OTA환전"
        changed += int(mask.sum())

    if changed > 0:
        save_master(df)
        add_log("OTA환전 재분류", f"외화 매칭 기반 자체이체→수입/OTA환전 ({changed}건)", changed)

    return changed


def _save_forex(df):
    """외화 마스터 저장"""
    ensure_forex_dirs()
    tmp = FOREX_MASTER.with_suffix(".tmp.xlsx")
    df.to_excel(tmp, index=False, engine="openpyxl")
    tmp.replace(FOREX_MASTER)


def migrate_forex_classification():
    """기존 데이터에 분류 컬럼 추가 + 자동 분류"""
    df = load_forex()
    if df.empty:
        return 0

    if "분류" not in df.columns:
        df["분류"] = ""

    _OTA_PLATFORMS = {"VIATOR", "GETYOURGUIDE", "KLOOK", "BEYONDER", "AIRBNB", "CIVITATIS"}
    _B2B_PLATFORMS = {"VIO TRAVEL", "EASTERN TRAVEL", "OPERA", "ROCKWOOL", "T I TOURS", "TI TOURS"}

    changed = 0
    for idx in df.index:
        if df.at[idx, "거래유형"] != "OTA입금":
            continue
        current = str(df.at[idx, "분류"]) if pd.notna(df.at[idx, "분류"]) else ""
        if current:
            continue

        cp = str(df.at[idx, "해외수입업자"]).upper() if pd.notna(df.at[idx, "해외수입업자"]) else ""
        classified = ""
        for kw in _OTA_PLATFORMS:
            if kw in cp:
                classified = "OTA"
                break
        if not classified:
            for kw in _B2B_PLATFORMS:
                if kw in cp:
                    classified = "B2B"
                    break
        if not classified:
            classified = "미분류"

        df.at[idx, "분류"] = classified
        changed += 1

    if changed > 0:
        _save_forex(df)

    return changed


def classify_forex(tx_id, classification):
    """외화 거래 분류 변경"""
    df = load_forex()
    if df.empty:
        return False

    mask = df["거래ID"] == tx_id
    if mask.sum() == 0:
        return False

    df.loc[mask, "분류"] = classification
    _save_forex(df)
    return True


def batch_classify_forex(items):
    """외화 거래 일괄 분류. items: [{platform, 분류}, ...]"""
    df = load_forex()
    if df.empty:
        return 0

    changed = 0
    for item in items:
        platform = item.get("platform", "")
        classification = item.get("분류", "")
        if not platform or not classification:
            continue
        mask = (df["플랫폼"] == platform) & (df["거래유형"] == "OTA입금")
        df.loc[mask, "분류"] = classification
        changed += int(mask.sum())

    if changed > 0:
        _save_forex(df)
        add_log("외화 분류", f"{len(items)}개 플랫폼 분류 ({changed}건)", changed)

    return changed
