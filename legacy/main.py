#!/usr/bin/env python3
"""
회계 자금 흐름 분석 프로그램
============================
서비스업 회사의 카드/통장/현금 거래 데이터를 통합 관리하고
고정비/변동비를 자동 분류하여 자금 흐름을 분석합니다.

사용법:
    python main.py import <파일경로> [파일경로2 ...]   — 거래 데이터 가져오기
    python main.py analyze [--month YYYY-MM]           — 분석 실행 (터미널 출력)
    python main.py report [--month YYYY-MM]            — 엑셀 리포트 생성
    python main.py status                              — 데이터 현황 조회
    python main.py unclassified                        — 미분류 항목 확인
    python main.py update <파일경로> [파일경로2 ...]   — 가져오기 + 분류 + 리포트 원스톱
"""

import sys
import argparse
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).parent))

from src.importer import import_file, load_master, save_master
from src.classifier import classify_all, get_unclassified
from src.analyzer import (
    monthly_summary, trend_analysis, detect_anomalies,
    cash_flow_forecast, generate_advice,
)
from src.reporter import generate_report
from src.utils import format_currency, MASTER_FILE


def cmd_import(args):
    """데이터 가져오기"""
    total_new = 0
    total_dup = 0

    for filepath in args.files:
        filepath = Path(filepath).resolve()
        print(f"\n📂 파일 처리 중: {filepath.name}")

        try:
            new, dup, total = import_file(filepath)
            total_new += new
            total_dup += dup
            print(f"   ✅ 신규 {new}건 추가 / 중복 {dup}건 제외")
        except FileNotFoundError as e:
            print(f"   ❌ {e}")
        except ValueError as e:
            print(f"   ❌ 파싱 오류: {e}")

    if total_new > 0:
        # 자동 분류 실행
        print(f"\n🏷️  자동 분류 실행 중...")
        df = load_master()
        df, stats = classify_all(df)
        save_master(df)
        print(f"   분류 완료: 자동분류 {stats['자동분류']}건, 미분류 {stats['미분류']}건 ({stats['분류율']})")

    print(f"\n📊 총 결과: 신규 {total_new}건 추가, 중복 {total_dup}건 제외")


def cmd_analyze(args):
    """분석 실행 (터미널 출력)"""
    if not MASTER_FILE.exists():
        print("❌ 마스터 데이터가 없습니다. 먼저 'import' 명령으로 데이터를 가져오세요.")
        return

    month = args.month
    summary = monthly_summary(month=month)

    if summary.get("데이터없음"):
        print(f"❌ {summary['월']} 데이터가 없습니다.")
        return

    print(f"\n{'='*60}")
    print(f"📊 월간 재무 분석 — {summary['월']}")
    print(f"{'='*60}")
    print(f"  총수입:      {format_currency(summary['총수입'])}")
    print(f"  총지출:      {format_currency(summary['총지출'])}")
    net = summary['순이익']
    sign = "+" if net >= 0 else ""
    print(f"  순이익:      {sign}{format_currency(net)}")
    print(f"{'─'*60}")
    print(f"  고정비:      {format_currency(summary['고정비'])} ({summary['고정비비율']:.1f}%)")
    print(f"  변동비:      {format_currency(summary['변동비'])} ({summary['변동비비율']:.1f}%)")
    if summary.get("미분류지출", 0) > 0:
        print(f"  미분류:      {format_currency(summary['미분류지출'])}")
    print(f"  거래 건수:   {summary['거래건수']}건")

    # 지출 TOP 10
    top = summary.get("지출TOP10", [])
    if top:
        print(f"\n📈 지출 항목 TOP 10:")
        for i, item in enumerate(top, 1):
            print(f"  {i:2d}. [{item['대분류']}] {item['중분류']}: {format_currency(item['금액'])}")

    # 이상 탐지
    anomalies = detect_anomalies(month=month)
    if anomalies:
        print(f"\n🔔 이상 항목:")
        for a in anomalies[:5]:
            print(f"  ⚠️  {a['중분류']}: {format_currency(a['이번달'])} "
                  f"(평소 대비 {a['배율']:.1f}배, +{format_currency(a['초과액'])})")

    # 현금 흐름 예측
    forecast = cash_flow_forecast()
    print(f"\n💰 현금 흐름 예측 ({forecast['기준기간']} 기준):")
    print(f"  월평균 총지출:   {format_currency(forecast['월평균총지출'])}")
    print(f"  월평균 수입:     {format_currency(forecast['월평균수입'])}")
    print(f"  최소 필요 자금:  {format_currency(forecast['최소필요자금'])}")
    print(f"  권장 보유 자금:  {format_currency(forecast['권장보유자금'])}")

    # 조언
    advice = generate_advice(summary, anomalies, forecast)
    print(f"\n📋 재무 조언:")
    for adv in advice:
        print(f"  {adv}")

    print(f"\n{'='*60}")


def cmd_report(args):
    """엑셀 리포트 생성"""
    if not MASTER_FILE.exists():
        print("❌ 마스터 데이터가 없습니다. 먼저 'import' 명령으로 데이터를 가져오세요.")
        return

    print("📝 리포트 생성 중...")
    try:
        output_path = generate_report(month=args.month)
        print(f"✅ 리포트 생성 완료: {output_path}")
    except Exception as e:
        print(f"❌ 리포트 생성 실패: {e}")


def cmd_status(args):
    """데이터 현황 조회"""
    if not MASTER_FILE.exists():
        print("📭 아직 가져온 데이터가 없습니다.")
        print("   'python main.py import <파일>' 명령으로 데이터를 가져오세요.")
        return

    df = load_master()
    df["거래일자"] = pd.to_datetime(df["거래일자"], errors="coerce")

    print(f"\n📊 데이터 현황")
    print(f"{'─'*40}")
    print(f"  총 거래 건수:  {len(df):,}건")
    print(f"  기간:          {df['거래일자'].min().strftime('%Y-%m-%d')} ~ "
          f"{df['거래일자'].max().strftime('%Y-%m-%d')}")

    # 유형별
    print(f"\n  거래 유형별:")
    for tx_type, count in df["거래유형"].value_counts().items():
        print(f"    {tx_type}: {count:,}건")

    # 분류 현황
    print(f"\n  분류 현황:")
    for cat, count in df["대분류"].value_counts().items():
        label = cat if cat else "미분류"
        print(f"    {label}: {count:,}건")

    # 월별 건수
    df["연월"] = df["거래일자"].dt.to_period("M").astype(str)
    print(f"\n  월별 데이터:")
    for ym, count in df.groupby("연월").size().items():
        print(f"    {ym}: {count:,}건")

    # 원본 파일 목록
    files = df["원본파일"].unique()
    print(f"\n  가져온 파일 ({len(files)}개):")
    for f in files:
        print(f"    - {f}")


def cmd_unclassified(args):
    """미분류 항목 확인"""
    if not MASTER_FILE.exists():
        print("❌ 마스터 데이터가 없습니다.")
        return

    unclass = get_unclassified()
    if unclass.empty:
        print("✅ 미분류 항목이 없습니다!")
        return

    print(f"\n🏷️  미분류 항목: {len(unclass)}건")
    print(f"{'─'*70}")
    print(f"{'날짜':<12} {'적요':<30} {'출금':>12} {'입금':>12}")
    print(f"{'─'*70}")

    for _, row in unclass.head(30).iterrows():
        date = pd.to_datetime(row["거래일자"]).strftime("%Y-%m-%d") if pd.notna(row["거래일자"]) else ""
        desc = str(row["적요"])[:28] if pd.notna(row["적요"]) else ""
        out_amt = f"{row['출금액']:,.0f}" if row.get("출금액", 0) > 0 else ""
        in_amt = f"{row['입금액']:,.0f}" if row.get("입금액", 0) > 0 else ""
        print(f"  {date:<12} {desc:<30} {out_amt:>12} {in_amt:>12}")

    if len(unclass) > 30:
        print(f"\n  ... 외 {len(unclass) - 30}건")

    print(f"\n💡 config/categories.yaml 파일에 키워드를 추가하면 자동 분류됩니다.")


def cmd_update(args):
    """가져오기 + 분류 + 리포트 원스톱"""
    print("🔄 데이터 업데이트 시작...")

    # 1. 가져오기
    cmd_import(args)

    # 2. 리포트 생성
    if MASTER_FILE.exists():
        print("\n📝 리포트 생성 중...")
        try:
            output_path = generate_report(month=args.month if hasattr(args, "month") else None)
            print(f"✅ 리포트 생성 완료: {output_path}")
        except Exception as e:
            print(f"❌ 리포트 생성 실패: {e}")

        # 3. 간단 분석 출력
        print()
        args_analyze = argparse.Namespace(month=args.month if hasattr(args, "month") else None)
        cmd_analyze(args_analyze)


def main():
    parser = argparse.ArgumentParser(
        description="회계 자금 흐름 분석 프로그램",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python main.py import 카드내역_2026-03.xlsx 통장내역_2026-03.csv
  python main.py analyze --month 2026-03
  python main.py report --month 2026-03
  python main.py update 카드내역_2026-03.xlsx --month 2026-03
  python main.py status
  python main.py unclassified
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="실행할 명령")

    # import
    p_import = subparsers.add_parser("import", help="거래 데이터 가져오기")
    p_import.add_argument("files", nargs="+", help="가져올 파일 경로 (엑셀/CSV)")
    p_import.set_defaults(func=cmd_import)

    # analyze
    p_analyze = subparsers.add_parser("analyze", help="분석 실행 (터미널 출력)")
    p_analyze.add_argument("--month", "-m", help="분석 대상 월 (YYYY-MM)")
    p_analyze.set_defaults(func=cmd_analyze)

    # report
    p_report = subparsers.add_parser("report", help="엑셀 리포트 생성")
    p_report.add_argument("--month", "-m", help="리포트 대상 월 (YYYY-MM)")
    p_report.set_defaults(func=cmd_report)

    # status
    p_status = subparsers.add_parser("status", help="데이터 현황 조회")
    p_status.set_defaults(func=cmd_status)

    # unclassified
    p_unclass = subparsers.add_parser("unclassified", help="미분류 항목 확인")
    p_unclass.set_defaults(func=cmd_unclassified)

    # update (원스톱)
    p_update = subparsers.add_parser("update", help="가져오기 + 분류 + 리포트 원스톱")
    p_update.add_argument("files", nargs="+", help="가져올 파일 경로")
    p_update.add_argument("--month", "-m", help="리포트 대상 월 (YYYY-MM)")
    p_update.set_defaults(func=cmd_update)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    args.func(args)


if __name__ == "__main__":
    import pandas as pd
    main()
