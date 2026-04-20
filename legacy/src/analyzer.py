"""자금 흐름 분석 엔진 — 월별 요약, 추세, 이상 탐지, 예측"""

import pandas as pd
import numpy as np
from pathlib import Path

from .utils import MASTER_FILE


def load_data(df=None):
    """분석용 데이터 로드"""
    if df is None:
        if not Path(MASTER_FILE).exists():
            raise FileNotFoundError("마스터 데이터가 없습니다.")
        df = pd.read_excel(MASTER_FILE)
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")
    df["연월"] = df["거래일자"].dt.to_period("M").astype(str)
    return df


def monthly_summary(df=None, month=None):
    """
    월별 요약 분석.
    month: 'YYYY-MM' 형식. None이면 가장 최근 월.
    반환: dict
    """
    df = load_data(df)

    if month:
        df_month = df[df["연월"] == month]
    else:
        month = df["연월"].max()
        df_month = df[df["연월"] == month]

    if df_month.empty:
        return {"월": month, "데이터없음": True}

    # 자체이체/카드대금/가수금/가지급금/미분류 제외
    _EXCLUDE = {"자체이체", "카드대금", "가수금", "가지급금", "미분류", ""}
    df_analysis = df_month[~df_month["대분류"].fillna("미분류").isin(_EXCLUDE)]

    total_income = df_analysis["입금액"].sum()
    total_expense = df_analysis["출금액"].sum()
    net = total_income - total_expense

    # 고정비 / 변동비 분리
    fixed = df_analysis[df_analysis["대분류"] == "고정비"]["출금액"].sum()
    variable = df_analysis[df_analysis["대분류"] == "변동비"]["출금액"].sum()
    unclassified_exp = total_expense - fixed - variable

    fixed_ratio = fixed / max(total_expense, 1) * 100
    variable_ratio = variable / max(total_expense, 1) * 100

    # 거래 유형별 집계
    by_type = df_month.groupby("거래유형").agg(
        입금=("입금액", "sum"),
        출금=("출금액", "sum"),
        건수=("거래ID", "count")
    ).to_dict("index")

    # 중분류별 지출 TOP 10
    expense_by_cat = (
        df_analysis[df_analysis["출금액"] > 0]
        .groupby(["대분류", "중분류"])["출금액"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
    )
    top_expenses = [
        {"대분류": idx[0], "중분류": idx[1], "금액": val}
        for idx, val in expense_by_cat.items()
    ]

    return {
        "월": month,
        "총수입": total_income,
        "총지출": total_expense,
        "순이익": net,
        "고정비": fixed,
        "변동비": variable,
        "미분류지출": unclassified_exp,
        "고정비비율": fixed_ratio,
        "변동비비율": variable_ratio,
        "거래건수": len(df_month),
        "거래유형별": by_type,
        "지출TOP10": top_expenses,
    }


def trend_analysis(df=None, months=6):
    """
    최근 N개월 추세 분석.
    반환: DataFrame (월별 고정비/변동비/수입/순이익 추이)
    """
    df = load_data(df)

    # 자체이체/카드대금/가수금/가지급금/미분류 제외
    _EXCLUDE = {"자체이체", "카드대금", "가수금", "가지급금", "미분류", ""}
    df_a = df[~df["대분류"].fillna("미분류").isin(_EXCLUDE)]

    monthly = df_a.groupby("연월").agg(
        총수입=("입금액", "sum"),
        총지출=("출금액", "sum"),
    ).reset_index()

    # 고정비/변동비 월별 집계
    fixed_monthly = (
        df_a[df_a["대분류"] == "고정비"]
        .groupby("연월")["출금액"].sum()
        .rename("고정비")
    )
    variable_monthly = (
        df_a[df_a["대분류"] == "변동비"]
        .groupby("연월")["출금액"].sum()
        .rename("변동비")
    )

    monthly = monthly.merge(fixed_monthly, on="연월", how="left")
    monthly = monthly.merge(variable_monthly, on="연월", how="left")
    monthly.fillna(0, inplace=True)
    monthly["순이익"] = monthly["총수입"] - monthly["총지출"]

    # 전월 대비 증감률
    for col in ["총수입", "총지출", "고정비", "변동비"]:
        monthly[f"{col}_증감률"] = monthly[col].pct_change() * 100

    monthly.sort_values("연월", inplace=True)
    return monthly.tail(months)


def category_analysis(df=None, month=None):
    """
    카테고리별 상세 분석.
    반환: dict {대분류: DataFrame(중분류별 금액, 비율, 전월대비)}
    """
    df = load_data(df)

    if month is None:
        month = df["연월"].max()

    months_sorted = sorted(df["연월"].unique())
    month_idx = months_sorted.index(month) if month in months_sorted else -1
    prev_month = months_sorted[month_idx - 1] if month_idx > 0 else None

    result = {}
    for major in ["고정비", "변동비"]:
        current = (
            df[(df["연월"] == month) & (df["대분류"] == major)]
            .groupby("중분류")["출금액"].sum()
            .sort_values(ascending=False)
        )

        if prev_month:
            prev = (
                df[(df["연월"] == prev_month) & (df["대분류"] == major)]
                .groupby("중분류")["출금액"].sum()
            )
        else:
            prev = pd.Series(dtype=float)

        analysis = pd.DataFrame({
            "금액": current,
            "비율": current / max(current.sum(), 1) * 100,
            "전월금액": prev.reindex(current.index, fill_value=0),
        })
        analysis["증감액"] = analysis["금액"] - analysis["전월금액"]
        analysis["증감률"] = (analysis["증감액"] / analysis["전월금액"].replace(0, np.nan) * 100).fillna(0)

        result[major] = analysis

    return result


def detect_anomalies(df=None, month=None, threshold=1.5):
    """
    이상 탐지: 최근 3개월 평균 대비 threshold배 이상 급증한 항목.
    반환: list of dict
    """
    df = load_data(df)

    if month is None:
        month = df["연월"].max()

    months_sorted = sorted(df["연월"].unique())
    month_idx = months_sorted.index(month) if month in months_sorted else -1

    # 비교 기간: 해당 월 이전 3개월
    if month_idx < 1:
        return []

    start_idx = max(0, month_idx - 3)
    compare_months = months_sorted[start_idx:month_idx]

    if not compare_months:
        return []

    # 현재 월 중분류별 지출
    current = (
        df[(df["연월"] == month) & (df["출금액"] > 0)]
        .groupby(["대분류", "중분류"])["출금액"].sum()
    )

    # 비교 기간 월평균
    compare = (
        df[(df["연월"].isin(compare_months)) & (df["출금액"] > 0)]
        .groupby(["대분류", "중분류"])["출금액"].sum()
    ) / len(compare_months)

    anomalies = []
    for idx in current.index:
        cur_val = current[idx]
        avg_val = compare.get(idx, 0)

        if avg_val > 0 and cur_val > avg_val * threshold:
            anomalies.append({
                "대분류": idx[0],
                "중분류": idx[1],
                "이번달": cur_val,
                "평균": avg_val,
                "배율": cur_val / avg_val,
                "초과액": cur_val - avg_val,
            })

    anomalies.sort(key=lambda x: x["초과액"], reverse=True)
    return anomalies


def cash_flow_forecast(df=None):
    """
    현금 흐름 예측: 고정비 기반 다음 달 최소 필요 자금 산출.
    반환: dict
    """
    df = load_data(df)
    latest_month = df["연월"].max()

    # 최근 3개월 고정비 평균
    months_sorted = sorted(df["연월"].unique())
    recent_months = months_sorted[-3:] if len(months_sorted) >= 3 else months_sorted

    fixed_avg = (
        df[(df["연월"].isin(recent_months)) & (df["대분류"] == "고정비")]
        ["출금액"].sum()
    ) / len(recent_months)

    # 최근 3개월 변동비 평균
    variable_avg = (
        df[(df["연월"].isin(recent_months)) & (df["대분류"] == "변동비")]
        ["출금액"].sum()
    ) / len(recent_months)

    # 최근 3개월 수입 평균
    income_avg = (
        df[df["연월"].isin(recent_months)]["입금액"].sum()
    ) / len(recent_months)

    total_avg_expense = fixed_avg + variable_avg

    return {
        "기준기간": f"{recent_months[0]} ~ {recent_months[-1]}",
        "월평균고정비": fixed_avg,
        "월평균변동비": variable_avg,
        "월평균총지출": total_avg_expense,
        "월평균수입": income_avg,
        "예상순이익": income_avg - total_avg_expense,
        "최소필요자금": fixed_avg,  # 고정비는 반드시 지출
        "권장보유자금": total_avg_expense * 1.2,  # 20% 여유자금
    }


def generate_advice(summary, anomalies, forecast):
    """분석 결과를 바탕으로 재무 조언 생성"""
    advice = []

    # 1. 고정비 비율 분석
    if summary.get("고정비비율", 0) > 70:
        advice.append(
            "⚠️ 고정비 비율이 {:.1f}%로 매우 높습니다. "
            "고정비가 전체 지출의 70%를 초과하면 매출 변동에 취약합니다. "
            "구독료, 리스 등 절감 가능한 고정비를 검토하세요.".format(summary["고정비비율"])
        )
    elif summary.get("고정비비율", 0) > 50:
        advice.append(
            "📊 고정비 비율 {:.1f}%는 서비스업 평균 수준입니다. "
            "변동비 효율화로 수익성을 더 개선할 수 있습니다.".format(summary["고정비비율"])
        )

    # 2. 순이익 분석
    if summary.get("순이익", 0) < 0:
        advice.append(
            "🚨 이번 달 적자 {}원입니다. "
            "즉각적인 비용 절감 또는 매출 확대 방안이 필요합니다.".format(
                f"{abs(summary['순이익']):,.0f}"
            )
        )
    elif summary.get("순이익", 0) > 0:
        margin = summary["순이익"] / max(summary.get("총수입", 1), 1) * 100
        if margin < 10:
            advice.append(
                "📉 순이익률이 {:.1f}%로 낮습니다. "
                "서비스업 목표 순이익률은 15~20%입니다.".format(margin)
            )

    # 3. 이상 항목
    for a in anomalies[:3]:
        advice.append(
            "🔍 '{중분류}' 항목이 평소 대비 {배율:.1f}배 증가했습니다 "
            "(평균 {평균:,.0f}원 → 이번달 {이번달:,.0f}원). 원인을 확인하세요.".format(**a)
        )

    # 4. 자금 예측
    if forecast.get("예상순이익", 0) < 0:
        advice.append(
            "💰 향후 월평균 지출이 수입을 초과합니다. "
            "최소 {}원의 운영자금 확보가 필요합니다.".format(
                f"{forecast['최소필요자금']:,.0f}"
            )
        )

    if not advice:
        advice.append("✅ 전반적으로 양호한 재무 상태입니다. 현재 추세를 유지하세요.")

    return advice
