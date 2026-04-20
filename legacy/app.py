#!/usr/bin/env python3
"""
회계 자금 흐름 분석 — 웹 대시보드
==================================
Flask 기반 웹 앱. 파일 업로드, 자동 분류, 차트 대시보드, 리포트 다운로드.
"""

import os
import sys
import json
import webbrowser
import threading
from pathlib import Path
from datetime import datetime

from flask import (
    Flask, render_template, request, redirect, url_for,
    flash, send_file, jsonify,
)

sys.path.insert(0, str(Path(__file__).parent))

# 한국 은행/카드사 엑셀 호환성 패치 (다른 import보다 먼저 실행)
from src.importer import _patch_openpyxl_for_korean_banks  # noqa: F401

from src.importer import (
    import_file, load_master, save_master, load_accounts, save_accounts,
    is_internal_transfer, _strip_number,
)
from src.classifier import classify_all, get_unclassified
from src.analyzer import (
    monthly_summary, trend_analysis, category_analysis,
    detect_anomalies, cash_flow_forecast, generate_advice,
)
from src.reporter import generate_report
from src.forex import (
    import_forex_file, load_forex, forex_summary,
    forex_monthly_trend, forex_platform_detail, match_transfers,
    reclassify_forex_transfers, classify_forex, batch_classify_forex,
    FOREX_MASTER, FOREX_RAW_DIR, ensure_forex_dirs,
)
from src.utils import (
    MASTER_FILE, OUTPUT_DIR, LOG_FILE, ensure_dirs,
    add_log, load_logs, create_backup, list_backups, restore_backup, delete_backup,
)

app = Flask(__name__)
app.secret_key = "accounting-dashboard-2026"

# ── 설정 관리 ──
import yaml as _yaml
SETTINGS_FILE = Path(__file__).parent / "config" / "settings.yaml"

_DEFAULT_SETTINGS = {
    "transactions": {"apply_same_desc_checked": True, "rows_per_page": 0},
    "classification": {"apply_both_directions": True, "auto_register_keyword": True, "auto_classify_on_import": True},
    "backup": {"auto_backup_on_start": True, "max_backups": 20},
    "display": {"date_format": "YYYY-MM-DD", "sidebar_collapsed": False},
}

def load_settings():
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = _yaml.safe_load(f) or {}
        # 기본값 병합
        merged = {}
        for section, defaults in _DEFAULT_SETTINGS.items():
            merged[section] = {**defaults, **(data.get(section) or {})}
        return merged
    return {k: dict(v) for k, v in _DEFAULT_SETTINGS.items()}

def save_settings(data):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        _yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


@app.after_request
def add_no_cache_headers(response):
    """개발 중 브라우저 캐시 방지"""
    if "text/html" in response.content_type:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


# numpy int64/float64 JSON 직렬화 지원
import numpy as np
from flask import Response

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

def _numpy_default(obj):
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

def json_response(data):
    """numpy 타입을 안전하게 직렬화하는 JSON 응답"""
    return Response(
        json.dumps(data, default=_numpy_default, ensure_ascii=False),
        mimetype="application/json",
    )

UPLOAD_DIR = Path(__file__).parent / "data" / "raw"


def _load_file_mapping():
    """accounts.yaml에서 파일→계좌 매핑 로드 (캐시)"""
    import yaml as _yaml
    import unicodedata
    acct_file = Path(__file__).parent / "config" / "accounts.yaml"
    if not acct_file.exists():
        return []
    with open(acct_file, "r", encoding="utf-8") as f:
        raw = _yaml.safe_load(f) or {}
    mapping = []
    for fm in (raw.get("file_mapping") or []):
        mapping.append({
            "pattern": unicodedata.normalize("NFC", fm.get("pattern", "")),
            "name": fm.get("account", ""),
            "number": fm.get("number", ""),
        })
    return mapping


def _file_to_account(filename, file_mapping):
    """원본파일명으로 계좌 정보 반환. NFC 정규화 적용."""
    import unicodedata
    fn = unicodedata.normalize("NFC", str(filename))
    for fm in file_mapping:
        if fm["pattern"] and fm["pattern"] in fn:
            return {"name": fm["name"], "number": fm["number"]}
    return None


def get_available_months():
    """마스터 데이터에서 사용 가능한 월 목록"""
    if not MASTER_FILE.exists():
        return []
    df = load_master()
    if df.empty:
        return []
    import pandas as pd
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
    months = sorted(df["거래일자"].dt.to_period("M").astype(str).unique(), reverse=True)
    return months


def _filtered_forex_summary(target_months):
    """필터 기간에 맞는 외화 요약"""
    import pandas as pd
    fx_df = load_forex()
    if fx_df.empty:
        return {"데이터없음": True}

    fx_df["연월"] = fx_df["거래일시"].dt.to_period("M").astype(str)
    fx_filtered = fx_df[fx_df["연월"].isin(target_months)]

    if fx_filtered.empty:
        return {"데이터없음": True}

    ota = fx_filtered[fx_filtered["거래유형"] == "OTA입금"]
    ota_total = float(ota["입금"].sum())
    ota_count = int(len(ota))

    # 매칭에서 해당 기간 환율 추출
    matches = match_transfers()
    period_matches = [m for m in matches if m["매칭상태"] == "매칭됨" and m.get("외화일자", "")[:7].replace("-", "-") in [ym[:4] + "-" + ym[5:] for ym in target_months]]
    avg_rate = round(sum(m["환율"] or 0 for m in period_matches) / max(len(period_matches), 1), 2) if period_matches else 0

    return {
        "OTA매출USD": ota_total,
        "OTA건수": ota_count,
        "avg_rate": avg_rate,
    }


def _range_summary(df, target_months):
    """여러 달을 합산한 요약 (자체이체 제외)"""
    import numpy as np
    sub = df[df["연월"].isin(target_months)]
    if sub.empty:
        return {"데이터없음": True}

    # 자체이체/카드대금/가수금/미분류 제외한 분석용 데이터
    _EXCLUDE_CATS = {"자체이체", "카드대금", "가수금", "가지급금", "미분류", ""}
    analysis = sub[~sub["대분류"].fillna("미분류").isin(_EXCLUDE_CATS)]

    total_income = analysis["입금액"].sum()
    total_expense = analysis["출금액"].sum()
    fixed = analysis[analysis["대분류"] == "고정비"]["출금액"].sum()
    variable = analysis[analysis["대분류"] == "변동비"]["출금액"].sum()

    expense_by_cat = (
        analysis[analysis["출금액"] > 0]
        .groupby(["대분류", "중분류"])["출금액"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
    )
    top_expenses = [
        {"대분류": idx[0], "중분류": idx[1], "금액": float(val)}
        for idx, val in expense_by_cat.items()
    ]

    # 자체이체 건수
    internal_count = int((sub["대분류"] == "자체이체").sum())

    return {
        "총수입": float(total_income),
        "총지출": float(total_expense),
        "순이익": float(total_income - total_expense),
        "고정비": float(fixed),
        "변동비": float(variable),
        "미분류지출": float(total_expense - fixed - variable),
        "고정비비율": float(fixed / max(total_expense, 1) * 100),
        "변동비비율": float(variable / max(total_expense, 1) * 100),
        "거래건수": int(len(sub)),
        "자체이체": internal_count,
        "지출TOP10": top_expenses,
    }


def _range_category(df, target_months):
    """여러 달 합산 카테고리 분석"""
    sub = df[df["연월"].isin(target_months)]
    result = {}
    for major in ["고정비", "변동비"]:
        cat = (
            sub[sub["대분류"] == major]
            .groupby("중분류")["출금액"]
            .sum()
            .sort_values(ascending=False)
        )
        result[major] = cat
    return result


@app.route("/")
def index():
    """메인 대시보드 — 데이터는 API로 로드"""
    months = get_available_months()
    if not months or not MASTER_FILE.exists():
        return render_template("dashboard.html", has_data=False, months=[])

    unclass = get_unclassified()
    return render_template("dashboard.html",
        has_data=True,
        months=months,
        unclass_count=len(unclass),
    )


@app.route("/api/dashboard")
def api_dashboard():
    """필터 조건에 따른 대시보드 전체 데이터 API"""
    import pandas as pd

    if not MASTER_FILE.exists():
        return json_response({"error": "데이터 없음"})

    month_from = request.args.get("from")
    month_to = request.args.get("to")
    sort_order = request.args.get("sort", "asc")  # asc / desc
    # 표시할 시리즈 (쉼표 구분)
    series = request.args.get("series", "총수입,총지출,순이익,고정비,변동비")
    series_list = [s.strip() for s in series.split(",") if s.strip()]

    df = load_master()
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
    df["연월"] = df["거래일자"].dt.to_period("M").astype(str)

    all_months_sorted = sorted(df["연월"].unique())
    if not month_from:
        month_from = all_months_sorted[0]
    if not month_to:
        month_to = all_months_sorted[-1]

    target_months = [m for m in all_months_sorted if month_from <= m <= month_to]
    if sort_order == "desc":
        target_months = list(reversed(target_months))

    # KPI 요약
    summary = _range_summary(df, target_months)

    # 3개월 이하면 일별, 그 이상이면 월별
    use_daily = len(target_months) <= 3
    trend_data = {"labels": [], "mode": "daily" if use_daily else "monthly"}
    series_map = {"총수입": [], "총지출": [], "순이익": [], "고정비": [], "변동비": []}

    _EXCLUDE_CATS_TREND = {"자체이체", "카드대금", "가수금", "가지급금", "미분류", ""}

    if use_daily:
        # 일별 추이
        df_filtered = df[
            (df["연월"].isin(target_months)) &
            (~df["대분류"].fillna("미분류").isin(_EXCLUDE_CATS_TREND))
        ].copy()
        df_filtered["날짜"] = df_filtered["거래일자"].dt.strftime("%Y-%m-%d")
        all_dates = sorted(df_filtered["날짜"].dropna().unique())
        if sort_order == "desc":
            all_dates = list(reversed(all_dates))

        for dt in all_dates:
            sub = df_filtered[df_filtered["날짜"] == dt]
            income = float(sub["입금액"].sum())
            expense = float(sub["출금액"].sum())
            fixed = float(sub[sub["대분류"] == "고정비"]["출금액"].sum())
            variable = float(sub[sub["대분류"] == "변동비"]["출금액"].sum())
            # 라벨: MM-DD 형식
            trend_data["labels"].append(dt[5:])  # "03-15"
            series_map["총수입"].append(income)
            series_map["총지출"].append(expense)
            series_map["순이익"].append(income - expense)
            series_map["고정비"].append(fixed)
            series_map["변동비"].append(variable)
    else:
        # 월별 추이
        ordered = target_months if sort_order == "asc" else list(reversed(target_months))
        for ym in ordered:
            sub = df[(df["연월"] == ym) & (~df["대분류"].fillna("미분류").isin(_EXCLUDE_CATS_TREND))]
            income = float(sub["입금액"].sum())
            expense = float(sub["출금액"].sum())
            fixed = float(sub[sub["대분류"] == "고정비"]["출금액"].sum())
            variable = float(sub[sub["대분류"] == "변동비"]["출금액"].sum())
            trend_data["labels"].append(ym)
            series_map["총수입"].append(income)
            series_map["총지출"].append(expense)
            series_map["순이익"].append(income - expense)
            series_map["고정비"].append(fixed)
            series_map["변동비"].append(variable)

    # 요청된 시리즈만 전달
    trend_data["datasets"] = {}
    for s in series_list:
        if s in series_map:
            trend_data["datasets"][s] = series_map[s]

    # 고정비/변동비 구성
    cat_data = _range_category(df, target_months)
    fixed_cat = cat_data.get("고정비")
    var_cat = cat_data.get("변동비")

    # 지출 TOP 10
    top = summary.get("지출TOP10", [])

    # 이상 탐지 & 조언
    anomalies = detect_anomalies(df, month=target_months[-1] if target_months else None)
    forecast = cash_flow_forecast(df)
    advice = generate_advice(summary, anomalies, forecast)

    return json_response({
        "period": f"{month_from} ~ {month_to}" if month_from != month_to else month_from,
        "summary": {
            "총수입": summary.get("총수입", 0),
            "총지출": summary.get("총지출", 0),
            "순이익": summary.get("순이익", 0),
            "고정비": summary.get("고정비", 0),
            "변동비": summary.get("변동비", 0),
            "미분류지출": summary.get("미분류지출", 0),
            "고정비비율": round(summary.get("고정비비율", 0), 1),
            "변동비비율": round(summary.get("변동비비율", 0), 1),
            "거래건수": summary.get("거래건수", 0),
        },
        "trend": trend_data,
        "fixed": {
            "labels": fixed_cat.index.tolist() if fixed_cat is not None and not fixed_cat.empty else [],
            "values": [float(v) for v in fixed_cat.tolist()] if fixed_cat is not None and not fixed_cat.empty else [],
        },
        "variable": {
            "labels": var_cat.index.tolist() if var_cat is not None and not var_cat.empty else [],
            "values": [float(v) for v in var_cat.tolist()] if var_cat is not None and not var_cat.empty else [],
        },
        "top_expenses": top,
        "anomalies": [
            {k: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
             for k, v in a.items()}
            for a in anomalies[:5]
        ],
        "forecast": {
            "기준기간": forecast.get("기준기간", ""),
            "월평균수입": float(forecast.get("월평균수입", 0)),
            "월평균총지출": float(forecast.get("월평균총지출", 0)),
            "최소필요자금": float(forecast.get("최소필요자금", 0)),
            "권장보유자금": float(forecast.get("권장보유자금", 0)),
        },
        "advice": advice,
        "forex": _filtered_forex_summary(target_months) if FOREX_MASTER.exists() else None,
    })


@app.route("/upload", methods=["POST"])
def upload():
    """파일 업로드 처리 (데이터 현황 페이지에서 호출)"""
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        flash("파일을 선택해주세요.", "error")
        return redirect(url_for("data_status"))

    ensure_dirs()
    results = []

    for f in files:
        if f.filename == "":
            continue
        save_path = UPLOAD_DIR / f.filename
        f.save(str(save_path))

        try:
            new, dup, total, internal = import_file(save_path)
            results.append({"file": f.filename, "new": new, "dup": dup, "total": total, "internal": internal, "ok": True})
        except Exception as e:
            import traceback
            traceback.print_exc()
            results.append({"file": f.filename, "error": str(e), "ok": False})

    # 자동 분류
    stats = None
    if MASTER_FILE.exists():
        try:
            df = load_master()
            df, stats = classify_all(df)
            save_master(df)
        except Exception as e:
            import traceback
            traceback.print_exc()

    total_new = sum(r["new"] for r in results if r["ok"])
    total_ok = sum(1 for r in results if r["ok"])
    # 변경 로그
    for r in results:
        if r["ok"]:
            add_log("파일 업로드", f"{r['file']} (신규 {r['new']}건, 중복 {r['dup']}건)", r['new'])

    # 결과 메시지 생성
    for r in results:
        if r["ok"]:
            parts = []
            if r["new"] > 0:
                parts.append(f"신규 {r['new']}건 추가")
            if r["dup"] > 0:
                parts.append(f"중복 {r['dup']}건 제외")
            if r.get("internal", 0) > 0:
                parts.append(f"자체이체 {r['internal']}건 제외")
            msg = ", ".join(parts) if parts else "업로드 완료"
            flash(f"✅ {r['file']}: {msg}", "success")
        else:
            flash(f"❌ {r['file']}: {r['error']}", "error")

    # 종합 요약
    if total_ok > 0:
        master_df = load_master()
        summary_parts = [f"총 {len(master_df):,}건 관리 중"]
        if total_new > 0:
            summary_parts.insert(0, f"신규 {total_new}건 추가")
        if stats:
            summary_parts.append(f"자동 분류율 {stats['분류율']}")
        flash(f"📊 {' | '.join(summary_parts)}", "info")

    return redirect(url_for("data_status"))


@app.route("/classify")
def classify_page():
    """미분류 일괄 분류 페이지"""
    has_data = MASTER_FILE.exists()
    settings = load_settings()
    return render_template("classify.html", has_data=has_data, settings=settings)


@app.route("/api/unclassified_groups")
def api_unclassified_groups():
    """미분류 거래를 적요별로 그룹화하여 반환"""
    import pandas as pd
    if not MASTER_FILE.exists():
        return json_response({"groups": [], "total": 0})

    df = load_master()
    # 미분류 필터
    unc = df[
        df["대분류"].fillna("").isin(["미분류", "", "nan"])
        | df["대분류"].isna()
    ].copy()

    if unc.empty:
        cats = _load_category_tree()
        return json_response({"groups": [], "total": 0, "categories": cats["tree"], "colors": cats["colors"]})

    unc["적요clean"] = unc["적요"].fillna("").str.strip()
    groups = []
    for desc, grp in unc.groupby("적요clean", sort=False):
        if not desc:
            desc = "(적요없음)"
        merchants = grp["거래처"].fillna("").str.strip()
        merchant_top = merchants.mode().iloc[0] if len(merchants.mode()) > 0 else ""
        types = grp["거래유형"].value_counts().to_dict()
        # 개별 거래 ID 목록
        ids = grp["거래ID"].tolist()
        # 샘플 거래 (최대 5건)
        samples = []
        for _, row in grp.head(5).iterrows():
            date_str = ""
            if pd.notna(row["거래일자"]):
                date_str = row["거래일자"].strftime("%Y-%m-%d")
            samples.append({
                "id": str(row.get("거래ID", "")),
                "날짜": date_str,
                "거래처": str(row.get("거래처", "")) if pd.notna(row.get("거래처")) else "",
                "입금": float(row.get("입금액", 0)),
                "출금": float(row.get("출금액", 0)),
            })
        groups.append({
            "적요": desc,
            "건수": len(grp),
            "총입금": float(grp["입금액"].sum()),
            "총출금": float(grp["출금액"].sum()),
            "거래처": merchant_top,
            "유형": types,
            "ids": ids,
            "samples": samples,
        })

    # 건수 내림차순 정렬
    groups.sort(key=lambda x: x["건수"], reverse=True)
    cats = _load_category_tree()
    return json_response({
        "groups": groups,
        "total": len(unc),
        "group_count": len(groups),
        "categories": cats["tree"],
        "colors": cats["colors"],
    })


@app.route("/api/batch_classify", methods=["POST"])
def api_batch_classify():
    """여러 적요 그룹을 일괄 분류"""
    import pandas as pd
    data = request.get_json()
    items = data.get("items", [])
    # items: [{적요, 대분류, 중분류}, ...]
    if not items:
        return json_response({"ok": False, "error": "분류할 항목이 없습니다."})

    df = load_master()
    total_changed = 0
    all_undo_data = []

    for item in items:
        desc = item.get("적요", "").strip()
        major = item.get("대분류", "").strip()
        minor = item.get("중분류", "").strip()
        if not desc or not major:
            continue

        if desc == "(적요없음)":
            mask = df["적요"].fillna("").str.strip() == ""
        else:
            mask = df["적요"].fillna("").str.strip() == desc

        # 미분류만 대상
        mask = mask & (
            df["대분류"].fillna("").isin(["미분류", "", "nan"])
            | df["대분류"].isna()
        )

        # 되돌리기용 이전 상태 저장
        for idx in df[mask].index:
            row = df.loc[idx]
            all_undo_data.append({
                "거래ID": str(row["거래ID"]),
                "대분류": str(row["대분류"]) if pd.notna(row["대분류"]) else "",
                "중분류": str(row["중분류"]) if pd.notna(row["중분류"]) else "",
                "메모": str(row["메모"]) if pd.notna(row["메모"]) else "",
            })

        df.loc[mask, "대분류"] = major
        df.loc[mask, "중분류"] = minor
        # [자동] 태그 제거
        for idx in df[mask].index:
            memo = str(df.at[idx, "메모"]) if pd.notna(df.at[idx, "메모"]) else ""
            df.at[idx, "메모"] = memo.replace("[자동]", "").replace("[수동]", "").strip()

        changed = int(mask.sum())
        total_changed += changed

    if total_changed > 0:
        save_master(df)
        descs = ", ".join(item["적요"][:15] for item in items[:3])
        if len(items) > 3:
            descs += f" 외 {len(items)-3}건"
        log_id = add_log("일괄 분류", f"{descs} ({total_changed}건 변경)", total_changed, undo_data=all_undo_data)

    return json_response({"ok": True, "changed": total_changed, "groups": len(items), "log_id": log_id if total_changed > 0 else None})


@app.route("/transactions")
def transactions():
    """거래 내역 조회 — 데이터는 API로 로드"""
    months = get_available_months()
    has_data = MASTER_FILE.exists() and len(months) > 0
    settings = load_settings()
    return render_template("transactions.html", has_data=has_data, months=months, settings=settings)


@app.route("/api/transactions")
def api_transactions():
    """거래내역 필터링 API"""
    import pandas as pd

    if not MASTER_FILE.exists():
        return json_response({"rows": [], "total": 0})

    df = load_master()
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
    df["연월"] = df["거래일자"].dt.to_period("M").astype(str)

    # 필터 파라미터
    month_from = request.args.get("from", "")
    month_to = request.args.get("to", "")
    category = request.args.get("category", "전체")
    tx_type = request.args.get("type", "전체")
    keyword = request.args.get("q", "").strip()
    sort_col = request.args.get("sort", "거래일자")
    sort_dir = request.args.get("dir", "desc")
    amount_min = request.args.get("amount_min", "")
    amount_max = request.args.get("amount_max", "")
    date_filter = request.args.get("date", "")       # 특정일 필터 (YYYY-MM-DD)
    direction = request.args.get("direction", "전체")  # 입금/출금 방향 필터

    # 기간 필터
    all_months = sorted(df["연월"].unique())
    if date_filter:
        # 특정일 필터가 있으면 해당 날짜만
        df = df[df["거래일자"].dt.strftime("%Y-%m-%d") == date_filter]
    else:
        if month_from:
            df = df[df["연월"] >= month_from]
        if month_to:
            df = df[df["연월"] <= month_to]

    # 입출금 방향 필터
    if direction == "입금":
        df = df[df["입금액"] > 0]
    elif direction == "출금":
        df = df[df["출금액"] > 0]

    # 대분류 필터
    if category and category != "전체":
        df = df[df["대분류"] == category]

    # 중분류 필터
    subcategory = request.args.get("subcategory", "전체")
    if subcategory and subcategory != "전체":
        df = df[df["중분류"] == subcategory]

    # 거래유형 필터
    if tx_type and tx_type != "전체":
        df = df[df["거래유형"] == tx_type]

    # 키워드 검색
    if keyword:
        kw = keyword.lower()
        mask = (
            df["적요"].fillna("").str.lower().str.contains(kw, na=False) |
            df["거래처"].fillna("").str.lower().str.contains(kw, na=False) |
            df["중분류"].fillna("").str.lower().str.contains(kw, na=False)
        )
        df = df[mask]

    # 금액 필터 (입금+출금 합산 기준)
    if amount_min:
        try:
            amin = float(amount_min)
            df = df[(df["입금액"] + df["출금액"]) >= amin]
        except ValueError:
            pass
    if amount_max:
        try:
            amax = float(amount_max)
            df = df[(df["입금액"] + df["출금액"]) <= amax]
        except ValueError:
            pass

    # 정렬
    asc = sort_dir == "asc"
    if sort_col in ("입금액", "출금액", "거래일자"):
        df = df.sort_values(sort_col, ascending=asc)
    else:
        df = df.sort_values("거래일자", ascending=asc)

    total = len(df)

    # 카테고리 목록 (categories.yaml 기반)
    cats = _load_category_tree()

    rows = []
    for _, row in df.iterrows():
        date_str = ""
        time_str = ""
        if pd.notna(row["거래일자"]):
            date_str = row["거래일자"].strftime("%Y-%m-%d")
            time_str = row["거래일자"].strftime("%H:%M:%S")
        balance = row.get("잔액")
        rows.append({
            "id": str(row.get("거래ID", "")),
            "날짜": date_str,
            "시간": time_str,
            "유형": str(row.get("거래유형", "")),
            "적요": str(row.get("적요", "")) if pd.notna(row.get("적요")) else "",
            "거래처": str(row.get("거래처", "")) if pd.notna(row.get("거래처")) else "",
            "입금": float(row.get("입금액", 0)),
            "출금": float(row.get("출금액", 0)),
            "잔액": float(balance) if pd.notna(balance) else None,
            "대분류": str(row.get("대분류", "")) if pd.notna(row.get("대분류")) else "",
            "중분류": str(row.get("중분류", "")) if pd.notna(row.get("중분류")) else "",
            "메모": str(row.get("메모", "")) if pd.notna(row.get("메모")) else "",
            "카드번호": str(row.get("카드번호", "")) if pd.notna(row.get("카드번호")) else "",
            "원본파일": str(row.get("원본파일", "")) if pd.notna(row.get("원본파일")) else "",
        })
    # ── 자체이체 쌍 매칭: 같은 날짜+금액의 출금↔입금을 연결 ──
    file_mapping = _load_file_mapping()
    if file_mapping:
        # 1) 모든 행에 소속 계좌 부여 (파일 매핑 기준)
        for r in rows:
            acct = _file_to_account(r["원본파일"], file_mapping)
            if acct:
                r["_acct"] = acct

        # 2) 자체이체 건의 날짜+금액으로, 다른 계좌의 반대 거래를 검색
        from collections import defaultdict
        # 전체 행을 날짜+금액 기준으로 인덱싱 (출금/입금 따로)
        all_out = defaultdict(list)  # (날짜, 금액) → 출금 행들
        all_in  = defaultdict(list)  # (날짜, 금액) → 입금 행들
        for r in rows:
            if "_acct" not in r:
                continue
            if r["출금"] > 0:
                all_out[(r["날짜"], r["출금"])].append(r)
            if r["입금"] > 0:
                all_in[(r["날짜"], r["입금"])].append(r)

        # 3) 자체이체 건에서 반대편 매칭
        matched_ids = set()
        for r in rows:
            if r["대분류"] != "자체이체" or "_acct" not in r:
                continue
            if id(r) in matched_ids:
                continue

            acct = r["_acct"]
            if r["출금"] > 0:
                # 출금 → 같은 날짜+금액의 다른 계좌 입금 찾기
                candidates = all_in.get((r["날짜"], r["출금"]), [])
                for c in candidates:
                    if id(c) in matched_ids:
                        continue
                    if "_acct" not in c:
                        continue
                    if c["_acct"]["number"] == acct["number"]:
                        continue
                    # 매칭 성공
                    r["이체"] = {"from": acct, "to": c["_acct"]}
                    c["이체"] = {"from": acct, "to": c["_acct"]}
                    matched_ids.add(id(r))
                    matched_ids.add(id(c))
                    break
            elif r["입금"] > 0:
                # 입금 → 같은 날짜+금액의 다른 계좌 출금 찾기
                candidates = all_out.get((r["날짜"], r["입금"]), [])
                for c in candidates:
                    if id(c) in matched_ids:
                        continue
                    if "_acct" not in c:
                        continue
                    if c["_acct"]["number"] == acct["number"]:
                        continue
                    # 매칭 성공
                    r["이체"] = {"from": c["_acct"], "to": acct}
                    c["이체"] = {"from": c["_acct"], "to": acct}
                    matched_ids.add(id(r))
                    matched_ids.add(id(c))
                    break

        # 4) 매칭 안 된 자체이체는 소속 계좌만 표시
        for r in rows:
            if r["대분류"] == "자체이체" and "_acct" in r and "이체" not in r:
                r["이체"] = {"account": r["_acct"]}

        # 5) 내부용 키 제거
        for r in rows:
            r.pop("_acct", None)

    return json_response({"rows": rows, "total": total, "categories": cats["tree"], "colors": cats["colors"]})


COLORS_FILE = Path(__file__).parent / "config" / "category_colors.yaml"

# 기본 색상 팔레트
_DEFAULT_COLORS = {
    "고정비": {"bg": "#f3e8ff", "fg": "#7c3aed"},
    "변동비": {"bg": "#fef3c7", "fg": "#b45309"},
    "수입":   {"bg": "#dcfce7", "fg": "#166534"},
    "미분류": {"bg": "#fee2e2", "fg": "#991b1b"},
    "자체이체": {"bg": "#e0e7ff", "fg": "#3730a3"},
    "카드대금": {"bg": "#fce7f3", "fg": "#9d174d"},
    "가수금":   {"bg": "#fff7ed", "fg": "#9a3412"},
    "가지급금": {"bg": "#ecfdf5", "fg": "#065f46"},
}


def _load_colors():
    """카테고리 색상 설정 로드"""
    import yaml
    if COLORS_FILE.exists():
        with open(COLORS_FILE, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def _save_colors(colors):
    """카테고리 색상 설정 저장"""
    import yaml
    ensure_dirs()
    with open(COLORS_FILE, "w", encoding="utf-8") as f:
        yaml.dump(colors, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _load_category_tree():
    """categories.yaml에서 전체 카테고리 트리 로드 (색상 포함)"""
    import yaml
    cats = {}
    try:
        cat_path = Path(__file__).parent / "config" / "categories.yaml"
        with open(str(cat_path), "r", encoding="utf-8") as f:
            cat_config = yaml.safe_load(f) or {}
        for major in ("고정비", "변동비", "수입"):
            if major in cat_config and cat_config[major]:
                cats[major] = list(cat_config[major].keys())
            else:
                cats[major] = []
    except Exception:
        cats = {"고정비": [], "변동비": [], "수입": []}

    # 색상 정보 병합
    colors = _load_colors()
    color_map = dict(_DEFAULT_COLORS)
    color_map.update(colors)

    return {"tree": cats, "colors": color_map}


def _save_category_to_yaml(major, minor, keywords=None):
    """categories.yaml에 중분류 추가"""
    import yaml
    cat_path = Path(__file__).parent / "config" / "categories.yaml"
    with open(str(cat_path), "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    if major not in config:
        config[major] = {}
    if config[major] is None:
        config[major] = {}
    if minor not in config[major]:
        config[major][minor] = keywords or []
    with open(str(cat_path), "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _delete_category_from_yaml(major, minor):
    """categories.yaml에서 중분류 삭제"""
    import yaml
    cat_path = Path(__file__).parent / "config" / "categories.yaml"
    with open(str(cat_path), "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    if major in config and config[major] and minor in config[major]:
        del config[major][minor]
        with open(str(cat_path), "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        return True
    return False


@app.route("/api/categories/add_keyword", methods=["POST"])
def api_categories_add_keyword():
    """categories.yaml에 분류 키워드 추가"""
    import yaml
    data = request.get_json()
    major = data.get("major", "").strip()
    minor = data.get("minor", "").strip()
    keyword = data.get("keyword", "").strip()

    if not major or not minor or not keyword:
        return json_response({"ok": False, "error": "대분류, 중분류, 키워드 모두 필요합니다."})

    cat_path = Path(__file__).parent / "config" / "categories.yaml"
    with open(str(cat_path), "r", encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}

    if major not in config:
        config[major] = {}
    if config[major] is None:
        config[major] = {}
    if minor not in config[major]:
        config[major][minor] = []
    if config[major][minor] is None:
        config[major][minor] = []

    kw_lower = keyword.lower()
    existing = [k.lower() for k in config[major][minor]]
    if kw_lower not in existing:
        config[major][minor].append(keyword)
        with open(str(cat_path), "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        return json_response({"ok": True})
    return json_response({"ok": True, "note": "이미 등록됨"})


@app.route("/api/categories")
def api_categories():
    """전체 카테고리 트리 + 색상"""
    return json_response(_load_category_tree())


@app.route("/api/categories/add", methods=["POST"])
def api_categories_add():
    """중분류 추가"""
    data = request.get_json()
    major = data.get("major", "").strip()
    minor = data.get("minor", "").strip()
    color_bg = data.get("bg", "").strip()
    color_fg = data.get("fg", "").strip()

    if not major or not minor:
        return json_response({"ok": False, "error": "대분류와 중분류명을 입력해주세요."})
    if major not in ("고정비", "변동비", "수입"):
        return json_response({"ok": False, "error": "대분류는 고정비/변동비/수입만 가능합니다."})

    _save_category_to_yaml(major, minor)

    # 색상 저장 (지정한 경우)
    if color_bg or color_fg:
        colors = _load_colors()
        key = f"{major}_{minor}"
        colors[key] = {"bg": color_bg or "#f1f5f9", "fg": color_fg or "#475569"}
        _save_colors(colors)

    return json_response({"ok": True, "data": _load_category_tree()})


@app.route("/api/categories/delete", methods=["POST"])
def api_categories_delete():
    """중분류 삭제"""
    data = request.get_json()
    major = data.get("major", "").strip()
    minor = data.get("minor", "").strip()

    if not major or not minor:
        return json_response({"ok": False, "error": "대분류와 중분류명이 필요합니다."})

    if _delete_category_from_yaml(major, minor):
        # 색상도 삭제
        colors = _load_colors()
        key = f"{major}_{minor}"
        colors.pop(key, None)
        _save_colors(colors)
        return json_response({"ok": True, "data": _load_category_tree()})
    return json_response({"ok": False, "error": "해당 항목을 찾을 수 없습니다."})


@app.route("/api/categories/color", methods=["POST"])
def api_categories_color():
    """대분류 또는 중분류 색상 변경"""
    data = request.get_json()
    key = data.get("key", "").strip()  # "고정비" or "고정비_임대료"
    bg = data.get("bg", "").strip()
    fg = data.get("fg", "").strip()

    if not key:
        return json_response({"ok": False, "error": "키가 필요합니다."})

    colors = _load_colors()
    colors[key] = {"bg": bg or "#f1f5f9", "fg": fg or "#475569"}
    _save_colors(colors)

    return json_response({"ok": True, "data": _load_category_tree()})


@app.route("/api/transaction/classify", methods=["POST"])
def api_transaction_classify():
    """개별 거래의 대분류/중분류 수정 (같은 적요 일괄 적용 지원)"""
    import pandas as pd

    data = request.get_json()
    tx_id = data.get("id", "").strip()
    major = data.get("대분류", "").strip()
    minor = data.get("중분류", "").strip()
    apply_all = data.get("apply_all", False)  # 같은 적요에 모두 적용

    if not tx_id:
        return json_response({"ok": False, "error": "거래ID가 없습니다."})

    df = load_master()
    id_mask = df["거래ID"] == tx_id
    if id_mask.sum() == 0:
        return json_response({"ok": False, "error": "해당 거래를 찾을 수 없습니다."})

    if apply_all:
        # 해당 거래의 적요를 찾아서 같은 적요를 가진 모든 거래에 적용
        desc = str(df.loc[id_mask, "적요"].iloc[0]).strip()
        if desc:
            mask = df["적요"].fillna("").str.strip() == desc
        else:
            mask = id_mask
    else:
        mask = id_mask

    # 되돌리기용 이전 상태 저장
    undo_data = []
    for idx in df[mask].index:
        row = df.loc[idx]
        undo_data.append({
            "거래ID": str(row["거래ID"]),
            "대분류": str(row["대분류"]) if pd.notna(row["대분류"]) else "",
            "중분류": str(row["중분류"]) if pd.notna(row["중분류"]) else "",
            "메모": str(row["메모"]) if pd.notna(row["메모"]) else "",
        })

    df.loc[mask, "대분류"] = major
    df.loc[mask, "중분류"] = minor
    # 수동 분류 시 [자동] 태그 제거
    for idx in df[mask].index:
        memo = str(df.at[idx, "메모"]) if pd.notna(df.at[idx, "메모"]) else ""
        df.at[idx, "메모"] = memo.replace("[자동]", "").replace("[수동]", "").strip()
    save_master(df)

    changed = int(mask.sum())
    desc = str(df.loc[id_mask, "적요"].iloc[0]).strip()[:30]
    log_id = add_log("분류 변경", f"{desc} → {major}/{minor}", changed, undo_data=undo_data)
    return json_response({"ok": True, "changed": changed, "log_id": log_id})


@app.route("/api/transaction/memo", methods=["POST"])
def api_transaction_memo():
    """거래 메모 수정"""
    import pandas as pd

    data = request.get_json()
    tx_id = data.get("id", "").strip()
    memo = data.get("메모", "").strip()

    if not tx_id:
        return json_response({"ok": False, "error": "거래ID가 없습니다."})

    df = load_master()
    mask = df["거래ID"] == tx_id
    if mask.sum() == 0:
        return json_response({"ok": False, "error": "해당 거래를 찾을 수 없습니다."})

    desc = str(df.loc[mask, "적요"].iloc[0]).strip()[:30]
    # 되돌리기용 이전 상태 저장
    undo_data = []
    for idx in df[mask].index:
        row = df.loc[idx]
        undo_data.append({
            "거래ID": str(row["거래ID"]),
            "대분류": str(row["대분류"]) if pd.notna(row["대분류"]) else "",
            "중분류": str(row["중분류"]) if pd.notna(row["중분류"]) else "",
            "메모": str(row["메모"]) if pd.notna(row["메모"]) else "",
        })
    df.loc[mask, "메모"] = memo
    save_master(df)
    log_id = add_log("메모 수정", f"{desc}: {memo[:50]}", undo_data=undo_data)
    return json_response({"ok": True, "log_id": log_id})


@app.route("/api/transaction/same_desc")
def api_same_desc():
    """같은 적요를 가진 거래 건수 조회"""
    import pandas as pd
    tx_id = request.args.get("id", "").strip()
    if not tx_id or not MASTER_FILE.exists():
        return json_response({"count": 0})
    df = load_master()
    id_mask = df["거래ID"] == tx_id
    if id_mask.sum() == 0:
        return json_response({"count": 0})
    desc = str(df.loc[id_mask, "적요"].iloc[0]).strip()
    if not desc:
        return json_response({"count": 0, "desc": ""})
    count = int((df["적요"].fillna("").str.strip() == desc).sum())
    return json_response({"count": count, "desc": desc})


@app.route("/api/transactions_by_desc")
def api_transactions_by_desc():
    """특정 적요의 모든 거래 반환"""
    import pandas as pd
    desc = request.args.get("desc", "").strip()
    if not desc or not MASTER_FILE.exists():
        return json_response({"rows": []})

    df = load_master()
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")

    if desc == "(적요없음)":
        mask = df["적요"].fillna("").str.strip() == ""
    else:
        mask = df["적요"].fillna("").str.strip() == desc

    # 미분류만 (일괄분류 페이지 용)
    only_unclassified = request.args.get("unclassified", "")
    if only_unclassified == "1":
        mask = mask & (
            df["대분류"].fillna("").isin(["미분류", "", "nan"])
            | df["대분류"].isna()
        )

    sub = df[mask].sort_values("거래일자", ascending=False)

    rows = []
    for _, row in sub.iterrows():
        date_str = row["거래일자"].strftime("%Y-%m-%d") if pd.notna(row["거래일자"]) else ""
        rows.append({
            "id": str(row.get("거래ID", "")),
            "날짜": date_str,
            "거래처": str(row.get("거래처", "")) if pd.notna(row.get("거래처")) else "",
            "입금": float(row.get("입금액", 0)),
            "출금": float(row.get("출금액", 0)),
            "잔액": float(row.get("잔액")) if pd.notna(row.get("잔액")) else None,
            "메모": str(row.get("메모", "")) if pd.notna(row.get("메모")) else "",
        })

    return json_response({"rows": rows, "total": len(rows)})


@app.route("/api/accounts")
def api_accounts():
    """등록된 자체 계좌 + 키워드 목록"""
    return json_response(load_accounts())


@app.route("/api/accounts/add", methods=["POST"])
def api_accounts_add():
    """자체 계좌 추가"""
    data = request.get_json()
    name = data.get("name", "").strip()
    number = data.get("number", "").strip()
    if not name or not number:
        return json_response({"ok": False, "error": "계좌명과 계좌번호를 입력해주세요."})
    acc_data = load_accounts()
    accounts = acc_data.get("accounts", [])
    import re
    new_digits = re.sub(r"[^0-9]", "", number)
    for acc in accounts:
        if re.sub(r"[^0-9]", "", acc.get("number", "")) == new_digits:
            return json_response({"ok": False, "error": "이미 등록된 계좌번호입니다."})
    accounts.append({"name": name, "number": number})
    acc_data["accounts"] = accounts
    save_accounts(acc_data)
    return json_response({"ok": True, "data": acc_data})


@app.route("/api/accounts/delete", methods=["POST"])
def api_accounts_delete():
    """자체 계좌 삭제"""
    data = request.get_json()
    number = data.get("number", "").strip()
    if not number:
        return json_response({"ok": False, "error": "계좌번호가 필요합니다."})
    acc_data = load_accounts()
    accounts = acc_data.get("accounts", [])
    import re
    del_digits = re.sub(r"[^0-9]", "", number)
    new_accounts = [a for a in accounts if re.sub(r"[^0-9]", "", a.get("number", "")) != del_digits]
    if len(new_accounts) == len(accounts):
        return json_response({"ok": False, "error": "해당 계좌를 찾을 수 없습니다."})
    acc_data["accounts"] = new_accounts
    save_accounts(acc_data)
    return json_response({"ok": True, "data": acc_data})


@app.route("/api/keywords/add", methods=["POST"])
def api_keywords_add():
    """자체이체 키워드 추가"""
    data = request.get_json()
    keyword = data.get("keyword", "").strip()
    if not keyword:
        return json_response({"ok": False, "error": "키워드를 입력해주세요."})
    acc_data = load_accounts()
    keywords = acc_data.get("keywords", [])
    if keyword in keywords:
        return json_response({"ok": False, "error": "이미 등록된 키워드입니다."})
    keywords.append(keyword)
    acc_data["keywords"] = keywords
    save_accounts(acc_data)
    return json_response({"ok": True, "data": acc_data})


@app.route("/api/keywords/delete", methods=["POST"])
def api_keywords_delete():
    """자체이체 키워드 삭제"""
    data = request.get_json()
    keyword = data.get("keyword", "").strip()
    if not keyword:
        return json_response({"ok": False, "error": "키워드가 필요합니다."})
    acc_data = load_accounts()
    keywords = acc_data.get("keywords", [])
    if keyword not in keywords:
        return json_response({"ok": False, "error": "해당 키워드를 찾을 수 없습니다."})
    keywords.remove(keyword)
    acc_data["keywords"] = keywords
    save_accounts(acc_data)
    return json_response({"ok": True, "data": acc_data})


@app.route("/api/delete_file", methods=["POST"])
def api_delete_file():
    """마스터 데이터에서 특정 원본파일의 거래를 삭제하고, raw 파일도 제거"""
    data = request.get_json()
    filename = data.get("filename", "").strip()
    if not filename:
        return json_response({"ok": False, "error": "파일명이 없습니다."})

    if not MASTER_FILE.exists():
        return json_response({"ok": False, "error": "마스터 데이터가 없습니다."})

    df = load_master()
    before = len(df)
    df = df[df["원본파일"] != filename]
    after = len(df)
    removed = before - after

    if removed == 0:
        return json_response({"ok": False, "error": f"'{filename}'에 해당하는 거래가 없습니다."})

    # 삭제 전 자동 백업
    create_backup(f"삭제전_{filename[:20]}")

    save_master(df)
    add_log("파일 삭제", f"{filename} ({removed}건 제거)", removed)

    # raw 파일도 삭제
    raw_path = UPLOAD_DIR / filename
    if raw_path.exists():
        raw_path.unlink()

    return json_response({"ok": True, "removed": removed, "remaining": after})


@app.route("/api/delete_raw_file", methods=["POST"])
def api_delete_raw_file():
    """미적용 원본 파일 삭제 (raw 파일만)"""
    from src.utils import RAW_DIR
    data = request.get_json()
    filename = data.get("filename", "").strip()
    if not filename:
        return json_response({"ok": False, "error": "파일명이 없습니다."})

    raw_path = RAW_DIR / filename
    if not raw_path.exists():
        return json_response({"ok": False, "error": f"'{filename}' 파일을 찾을 수 없습니다."})

    # 마스터에 적용된 파일이면 이 API로 삭제 불가
    if MASTER_FILE.exists():
        df = load_master()
        if filename in df["원본파일"].values:
            return json_response({"ok": False, "error": "마스터에 적용된 파일입니다. 일반 삭제를 사용하세요."})

    raw_path.unlink()
    add_log("원본파일 삭제", f"{filename} (미적용 파일)")
    return json_response({"ok": True})


@app.route("/api/open_file", methods=["POST"])
def api_open_file():
    """파일을 Finder/기본 앱으로 열기"""
    import subprocess
    from src.utils import RAW_DIR
    data = request.get_json()
    filename = data.get("filename", "").strip()
    if not filename:
        return json_response({"ok": False, "error": "파일명이 없습니다."})

    raw_path = RAW_DIR / filename
    if not raw_path.exists():
        return json_response({"ok": False, "error": f"'{filename}' 파일을 찾을 수 없습니다."})

    try:
        subprocess.Popen(["open", str(raw_path)])
        return json_response({"ok": True})
    except Exception as e:
        return json_response({"ok": False, "error": str(e)})


@app.route("/api/rename_file", methods=["POST"])
def api_rename_file():
    """원본 파일명 변경 (raw 파일 + 마스터 원본파일 컬럼 업데이트)"""
    from src.utils import RAW_DIR
    data = request.get_json()
    old_name = data.get("old_name", "").strip()
    new_name = data.get("new_name", "").strip()

    if not old_name or not new_name:
        return json_response({"ok": False, "error": "파일명이 없습니다."})
    if old_name == new_name:
        return json_response({"ok": False, "error": "동일한 파일명입니다."})

    # 허용되지 않는 문자 체크
    import re
    if re.search(r'[/\\:*?"<>|]', new_name):
        return json_response({"ok": False, "error": "파일명에 사용할 수 없는 문자가 포함되어 있습니다."})

    old_path = RAW_DIR / old_name
    new_path = RAW_DIR / new_name

    if not old_path.exists():
        return json_response({"ok": False, "error": f"'{old_name}' 파일을 찾을 수 없습니다."})
    if new_path.exists():
        return json_response({"ok": False, "error": f"'{new_name}' 파일이 이미 존재합니다."})

    # raw 파일 이름 변경
    old_path.rename(new_path)

    # 마스터 데이터의 원본파일 컬럼도 업데이트
    updated = 0
    if MASTER_FILE.exists():
        df = load_master()
        mask = df["원본파일"] == old_name
        updated = mask.sum()
        if updated > 0:
            df.loc[mask, "원본파일"] = new_name
            save_master(df)

    add_log("파일명 변경", f"{old_name} → {new_name} ({updated}건 업데이트)")
    return json_response({"ok": True, "updated": updated})


@app.route("/api/retry_import", methods=["POST"])
def api_retry_import():
    """raw 폴더의 미적용 파일을 다시 가져오기"""
    from src.utils import RAW_DIR

    data = request.get_json()
    filename = data.get("filename", "").strip()
    if not filename:
        return json_response({"ok": False, "error": "파일명이 없습니다."})

    raw_path = RAW_DIR / filename
    if not raw_path.exists():
        return json_response({"ok": False, "error": f"'{filename}' 파일을 찾을 수 없습니다."})

    try:
        new, dup, total, internal = import_file(raw_path)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return json_response({"ok": False, "error": str(e)})

    # 자동 분류
    if MASTER_FILE.exists() and new > 0:
        try:
            df = load_master()
            df, stats = classify_all(df)
            save_master(df)
        except Exception:
            pass

    add_log("파일 재가져오기", f"{filename} (신규 {new}건, 중복 {dup}건)", new)
    return json_response({"ok": True, "new": new, "dup": dup, "total": total})


@app.route("/api/people")
def api_people():
    """인력 목록 조회"""
    import yaml
    people_file = Path(__file__).parent / "config" / "people.yaml"
    if not people_file.exists():
        return json_response({"people": []})
    with open(people_file, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return json_response({"people": data.get("people", [])})


@app.route("/api/people/add", methods=["POST"])
def api_people_add():
    """인력 추가"""
    import yaml
    data = request.get_json()
    name = data.get("name", "").strip()
    role = data.get("role", "").strip()
    if not name or role not in ("가이드", "기사", "보조"):
        return json_response({"ok": False, "error": "이름과 역할(가이드/기사/보조)을 입력해주세요."})

    people_file = Path(__file__).parent / "config" / "people.yaml"
    if people_file.exists():
        with open(people_file, "r", encoding="utf-8") as f:
            pdata = yaml.safe_load(f) or {}
    else:
        pdata = {}
    people = pdata.get("people", [])

    # 중복 확인
    if any(p["name"] == name for p in people):
        return json_response({"ok": False, "error": f"'{name}'은(는) 이미 등록되어 있습니다."})

    people.append({
        "name": name,
        "role": role,
        "status": data.get("status", "활동 중"),
        "phone": data.get("phone", ""),
        "bank": data.get("bank", ""),
        "bank_number": data.get("bank_number", ""),
        "tier": data.get("tier", ""),
    })
    pdata["people"] = people
    with open(people_file, "w", encoding="utf-8") as f:
        yaml.dump(pdata, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    add_log("인력 추가", f"{name} ({role})")
    return json_response({"ok": True})


@app.route("/api/people/delete", methods=["POST"])
def api_people_delete():
    """인력 삭제"""
    import yaml
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return json_response({"ok": False, "error": "이름이 없습니다."})

    people_file = Path(__file__).parent / "config" / "people.yaml"
    if not people_file.exists():
        return json_response({"ok": False, "error": "인력 데이터가 없습니다."})
    with open(people_file, "r", encoding="utf-8") as f:
        pdata = yaml.safe_load(f) or {}
    people = pdata.get("people", [])
    before = len(people)
    people = [p for p in people if p.get("name") != name]
    if len(people) == before:
        return json_response({"ok": False, "error": f"'{name}'을(를) 찾을 수 없습니다."})
    pdata["people"] = people
    with open(people_file, "w", encoding="utf-8") as f:
        yaml.dump(pdata, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    add_log("인력 삭제", name)
    return json_response({"ok": True})


@app.route("/api/people/update", methods=["POST"])
def api_people_update():
    """인력 역할 변경"""
    import yaml
    data = request.get_json()
    name = data.get("name", "").strip()
    role = data.get("role", "").strip()
    if not name or role not in ("가이드", "기사", "보조"):
        return json_response({"ok": False, "error": "이름과 역할을 확인해주세요."})

    people_file = Path(__file__).parent / "config" / "people.yaml"
    if not people_file.exists():
        return json_response({"ok": False, "error": "인력 데이터가 없습니다."})
    with open(people_file, "r", encoding="utf-8") as f:
        pdata = yaml.safe_load(f) or {}
    updated = False
    for p in pdata.get("people", []):
        if p.get("name") == name:
            p["role"] = role
            updated = True
            break
    if not updated:
        return json_response({"ok": False, "error": f"'{name}'을(를) 찾을 수 없습니다."})
    with open(people_file, "w", encoding="utf-8") as f:
        yaml.dump(pdata, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    add_log("인력 역할 변경", f"{name} → {role}")
    return json_response({"ok": True})


@app.route("/api/logs")
def api_logs():
    """변경 이력 조회"""
    limit = int(request.args.get("limit", 50))
    logs = load_logs()[:limit]
    return json_response({"logs": logs})


@app.route("/api/log/undo", methods=["POST"])
def api_log_undo():
    """변경 이력 되돌리기"""
    import pandas as pd

    data = request.get_json()
    log_id = data.get("id", "").strip()
    if not log_id:
        return json_response({"ok": False, "error": "이력 ID가 필요합니다."})

    logs = load_logs()
    target = None
    for l in logs:
        if l.get("id") == log_id:
            target = l
            break

    if not target:
        return json_response({"ok": False, "error": "해당 이력을 찾을 수 없습니다."})

    undo_data = target.get("undo")
    if not undo_data:
        return json_response({"ok": False, "error": "되돌리기 데이터가 없습니다."})

    df = load_master()
    restored = 0

    for item in undo_data:
        tx_id = item.get("거래ID", "")
        if not tx_id:
            continue
        mask = df["거래ID"] == tx_id
        if mask.sum() == 0:
            continue
        df.loc[mask, "대분류"] = item.get("대분류", "")
        df.loc[mask, "중분류"] = item.get("중분류", "")
        df.loc[mask, "메모"] = item.get("메모", "")
        restored += int(mask.sum())

    if restored > 0:
        save_master(df)
        add_log("되돌리기", f"{target['action']}: {target.get('detail', '')[:40]} ({restored}건 복원)", restored)

        # 해당 로그의 undo 데이터 제거 (중복 되돌리기 방지)
        for l in logs:
            if l.get("id") == log_id:
                l.pop("undo", None)
                break
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, ensure_ascii=False, indent=2)

    return json_response({"ok": True, "restored": restored})


@app.route("/api/backup", methods=["POST"])
def api_backup_create():
    """백업 생성"""
    data = request.get_json() or {}
    label = data.get("label", "")
    result = create_backup(label)
    if result:
        return json_response({"ok": True, "backup": result})
    return json_response({"ok": False, "error": "마스터 데이터가 없습니다."})


@app.route("/api/backups")
def api_backups():
    """백업 목록 조회"""
    return json_response({"backups": list_backups()})


@app.route("/api/backup/restore", methods=["POST"])
def api_backup_restore():
    """백업 복원"""
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return json_response({"ok": False, "error": "백업 파일명이 없습니다."})
    ok = restore_backup(name)
    if ok:
        return json_response({"ok": True})
    return json_response({"ok": False, "error": "백업 파일을 찾을 수 없습니다."})


@app.route("/api/backup/delete", methods=["POST"])
def api_backup_delete():
    """백업 삭제"""
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return json_response({"ok": False, "error": "백업 파일명이 없습니다."})
    ok = delete_backup(name)
    if ok:
        return json_response({"ok": True})
    return json_response({"ok": False, "error": "백업 파일을 찾을 수 없습니다."})


@app.route("/settings")
def settings_page():
    """설정 페이지"""
    return render_template("settings.html", settings=load_settings())


@app.route("/api/settings")
def api_settings():
    return json_response(load_settings())


@app.route("/api/settings/update", methods=["POST"])
def api_settings_update():
    data = request.get_json()
    if not data:
        return json_response({"ok": False, "error": "데이터 없음"}), 400
    current = load_settings()
    for section, values in data.items():
        if section in current and isinstance(values, dict):
            current[section].update(values)
    save_settings(current)
    return json_response({"ok": True})


@app.route("/data")
def data_status():
    """업로드된 파일 및 데이터 현황 페이지"""
    import pandas as pd

    if not MASTER_FILE.exists():
        return render_template("data_status.html", has_data=False, own_accounts=load_accounts())

    df = load_master()
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
    df["연월"] = df["거래일자"].dt.to_period("M").astype(str)

    total = len(df)
    date_min = df["거래일자"].min().strftime("%Y-%m-%d") if not df.empty else ""
    date_max = df["거래일자"].max().strftime("%Y-%m-%d") if not df.empty else ""

    # 파일별 통계
    file_stats = []
    for fname, group in df.groupby("원본파일"):
        file_stats.append({
            "파일명": fname,
            "건수": len(group),
            "기간": f"{group['거래일자'].min().strftime('%Y-%m-%d')} ~ {group['거래일자'].max().strftime('%Y-%m-%d')}",
            "유형": group["거래유형"].iloc[0] if not group.empty else "",
            "가져온날짜": group["가져온날짜"].iloc[0] if "가져온날짜" in group.columns else "",
        })

    # 월별 통계 (자체이체/카드대금/가수금/가지급금/미분류 제외)
    _EXCL = {"자체이체", "카드대금", "가수금", "가지급금", "미분류", ""}
    df_analysis = df[~df["대분류"].fillna("미분류").isin(_EXCL)]
    monthly_stats = []
    for ym, group in df_analysis.groupby("연월"):
        monthly_stats.append({
            "월": ym,
            "건수": len(group),
            "수입": group["입금액"].sum(),
            "지출": group["출금액"].sum(),
        })
    monthly_stats.sort(key=lambda x: x["월"], reverse=True)

    # 분류 통계
    classify_stats = df["대분류"].value_counts().to_dict()
    classify_total = sum(classify_stats.values())
    classified = classify_total - classify_stats.get("미분류", 0) - classify_stats.get("", 0)

    # 거래유형 통계
    type_stats = df["거래유형"].value_counts().to_dict()

    # raw 폴더 파일 목록 (적용 상태 포함)
    from src.utils import RAW_DIR
    applied_files = set(df["원본파일"].unique()) if not df.empty else set()
    raw_files = []
    if RAW_DIR.exists():
        for f in sorted(RAW_DIR.iterdir(), key=lambda x: x.name):
            if f.is_file() and not f.name.startswith("."):
                size = f.stat().st_size
                size_str = f"{size/1024:.0f} KB" if size < 1024*1024 else f"{size/1024/1024:.1f} MB"
                is_applied = f.name in applied_files
                # 적용된 파일의 건수
                count = len(df[df["원본파일"] == f.name]) if is_applied else 0
                raw_files.append({
                    "name": f.name,
                    "size": size_str,
                    "modified": pd.Timestamp(f.stat().st_mtime, unit="s").strftime("%Y-%m-%d %H:%M"),
                    "applied": is_applied,
                    "count": count,
                })

    # 자체 계좌 목록
    own_accounts = load_accounts()

    return render_template("data_status.html",
        has_data=True,
        total=total,
        date_min=date_min,
        date_max=date_max,
        file_stats=file_stats,
        monthly_stats=monthly_stats,
        classify_stats=classify_stats,
        classify_total=classify_total,
        classified=classified,
        type_stats=type_stats,
        raw_files=raw_files,
        own_accounts=own_accounts,
    )


# ═══════════════════════════════════════════════════════════
# 외화 계좌
# ═══════════════════════════════════════════════════════════

@app.route("/forex")
def forex_page():
    """외화 계좌 페이지"""
    has_data = FOREX_MASTER.exists()
    return render_template("forex.html", has_data=has_data)


@app.route("/api/forex/upload", methods=["POST"])
def api_forex_upload():
    """외화 파일 업로드"""
    import tempfile
    files = request.files.getlist("files")
    if not files:
        return json_response({"ok": False, "error": "파일을 선택해주세요."})

    results = []
    for f in files:
        if not f.filename:
            continue
        # 임시 파일로 저장
        tmp = Path(tempfile.mkdtemp()) / f.filename
        f.save(str(tmp))
        try:
            added, dupes = import_forex_file(tmp)
            results.append({"file": f.filename, "added": added, "dupes": dupes})
        except Exception as e:
            results.append({"file": f.filename, "error": str(e)})
        finally:
            if tmp.exists():
                tmp.unlink()

    # 업로드 후 자동으로 매칭된 자체이체를 OTA환전으로 재분류
    reclassified = 0
    try:
        reclassified = reclassify_forex_transfers()
    except Exception:
        pass

    return json_response({"ok": True, "results": results, "reclassified": reclassified})


@app.route("/api/forex/reclassify", methods=["POST"])
def api_forex_reclassify():
    """외화 매칭 기반 자체이체 → 수입/OTA환전 재분류"""
    try:
        changed = reclassify_forex_transfers()
        return json_response({"ok": True, "changed": changed})
    except Exception as e:
        return json_response({"ok": False, "error": str(e)})


@app.route("/api/forex/classify", methods=["POST"])
def api_forex_classify():
    """외화 거래 개별 분류"""
    data = request.get_json()
    tx_id = data.get("id", "").strip()
    classification = data.get("분류", "").strip()
    if not tx_id or not classification:
        return json_response({"ok": False, "error": "ID와 분류가 필요합니다."})
    ok = classify_forex(tx_id, classification)
    return json_response({"ok": ok})


@app.route("/api/forex/batch_classify", methods=["POST"])
def api_forex_batch_classify():
    """외화 플랫폼별 일괄 분류"""
    data = request.get_json()
    items = data.get("items", [])
    if not items:
        return json_response({"ok": False, "error": "분류할 항목이 없습니다."})
    changed = batch_classify_forex(items)
    return json_response({"ok": True, "changed": changed})


@app.route("/api/forex/summary")
def api_forex_summary():
    """외화 계좌 요약 API"""
    summary = forex_summary()
    return json_response(summary)


@app.route("/api/forex/trend")
def api_forex_trend():
    """외화 월별 추이 API"""
    trend = forex_monthly_trend()
    return json_response({"trend": trend})


@app.route("/api/forex/platforms")
def api_forex_platforms():
    """플랫폼별 상세"""
    platform = request.args.get("platform", "")
    detail = forex_platform_detail(platform=platform if platform else None)
    return json_response({"records": detail})


@app.route("/api/forex/matches")
def api_forex_matches():
    """환전 매칭 현황"""
    matches = match_transfers()
    matched = [m for m in matches if m["매칭상태"] == "매칭됨"]
    unmatched = [m for m in matches if m["매칭상태"] != "매칭됨"]
    return json_response({
        "matches": matches,
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "total_usd_converted": sum(m["USD금액"] for m in matched),
        "total_krw_received": sum(m["KRW금액"] or 0 for m in matched),
        "avg_rate": round(sum(m["환율"] or 0 for m in matched) / max(len(matched), 1), 2),
    })


@app.route("/api/forex/transactions")
def api_forex_transactions():
    """외화 전체 거래내역"""
    import pandas as pd
    df = load_forex()
    if df.empty:
        return json_response({"rows": [], "total": 0})

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "거래일시": r["거래일시"].strftime("%Y-%m-%d %H:%M") if pd.notna(r["거래일시"]) else "",
            "통화": str(r["통화"]) if pd.notna(r["통화"]) else "USD",
            "입금": float(r["입금"]) if pd.notna(r["입금"]) else 0,
            "출금": float(r["출금"]) if pd.notna(r["출금"]) else 0,
            "잔액": float(r["잔액"]) if pd.notna(r["잔액"]) else 0,
            "적요": str(r["적요"]) if pd.notna(r["적요"]) else "",
            "거래유형": str(r["거래유형"]) if pd.notna(r["거래유형"]) else "",
            "플랫폼": str(r["플랫폼"]) if pd.notna(r["플랫폼"]) else "",
            "해외수입업자": str(r["해외수입업자"]) if pd.notna(r["해외수입업자"]) else "",
            "분류": str(r["분류"]) if "분류" in r.index and pd.notna(r["분류"]) else "",
            "거래ID": str(r["거래ID"]) if pd.notna(r["거래ID"]) else "",
        })

    return json_response({"rows": rows, "total": len(rows)})


@app.route("/download_report")
def download_report():
    """리포트 다운로드"""
    month = request.args.get("month")
    try:
        output_path = generate_report(month=month)
        return send_file(output_path, as_attachment=True)
    except Exception as e:
        flash(f"리포트 생성 실패: {e}", "error")
        return redirect(url_for("index"))


@app.route("/api/summary")
def api_summary():
    """AJAX용 요약 API"""
    month = request.args.get("month")
    if not MASTER_FILE.exists():
        return json_response({"error": "데이터 없음"})
    summary = monthly_summary(month=month)
    return json_response(summary)


def open_browser(port):
    """서버 시작 후 브라우저 자동 오픈"""
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    ensure_dirs()
    # 서버 시작 시 자동 백업
    if MASTER_FILE.exists():
        create_backup("서버시작_자동백업")
        print("  [자동 백업 완료]")
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print("  회계 자금 흐름 분석 대시보드")
    print(f"  http://127.0.0.1:{port}")
    print("=" * 50)
    print("  종료하려면 터미널에서 Ctrl+C")
    print()

    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.5, open_browser, args=[port]).start()
    app.run(debug=False, host="127.0.0.1", port=port)
