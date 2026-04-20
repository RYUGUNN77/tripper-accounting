"""자동 분류 엔진 — 거래 내역을 고정비/변동비/수입으로 자동 분류"""

import yaml
import pandas as pd
from pathlib import Path

from .utils import CATEGORIES_FILE, MASTER_FILE, CONFIG_DIR


def load_categories():
    """categories.yaml에서 분류 규칙 로드"""
    with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # 플랫 매핑 테이블 구축: keyword → (대분류, 중분류)
    keyword_map = []

    for major_cat in ["고정비", "변동비", "수입"]:
        if major_cat not in config or not config[major_cat]:
            continue
        for minor_cat, keywords in config[major_cat].items():
            if not keywords:
                continue
            for kw in keywords:
                keyword_map.append((kw.lower(), major_cat, minor_cat))

    # 사용자 정의 분류
    if "사용자정의" in config and config["사용자정의"]:
        for cat_name, keywords in config["사용자정의"].items():
            if not keywords:
                continue
            # 카테고리명에서 대분류 추출 (예: "고정비_기타" → 대분류="고정비", 중분류="기타")
            if "_" in cat_name:
                major, minor = cat_name.split("_", 1)
            else:
                major, minor = "기타", cat_name
            for kw in keywords:
                keyword_map.append((kw.lower(), major, minor))

    # 긴 키워드부터 매칭 (더 구체적인 것 우선)
    keyword_map.sort(key=lambda x: len(x[0]), reverse=True)
    return keyword_map


PEOPLE_FILE = CONFIG_DIR / "people.yaml"

_ROLE_MAP = {
    "가이드": ("변동비", "가이드비"),
    "기사":  ("변동비", "차량비"),
    "보조":  ("변동비", "보조비"),
}


def load_people():
    """인력 데이터 로드 → 이름/별칭→(대분류, 중분류) 매핑 리스트"""
    if not PEOPLE_FILE.exists():
        return []
    with open(PEOPLE_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    people = data.get("people", [])
    # 이름+별칭 → 분류 매핑 (긴 이름 우선)
    name_map = []
    for p in people:
        name = p.get("name", "").strip()
        role = p.get("role", "")
        if not name or role not in _ROLE_MAP:
            continue
        major, minor = _ROLE_MAP[role]
        # 본명 추가
        name_map.append((name, major, minor))
        # 별칭(aliases)도 추가
        aliases = p.get("aliases", [])
        if aliases:
            for alias in aliases:
                alias = alias.strip()
                if alias:
                    name_map.append((alias, major, minor))
    # 긴 이름부터 매칭 (예: "SHOAZIZOVA KHILOLA" > "SHOAZIZOVA")
    name_map.sort(key=lambda x: len(x[0]), reverse=True)
    return name_map


def classify_transaction(description, merchant, keyword_map, people_map=None):
    """단일 거래를 분류. 반환: (대분류, 중분류)"""
    text = f"{description} {merchant}".lower()

    # 키워드 매칭 우선
    for kw, major, minor in keyword_map:
        if kw in text:
            return major, minor

    # 인력 이름 매칭 (대소문자 무시)
    if people_map:
        combined = f"{description} {merchant}"
        combined_lower = combined.lower()
        for name, major, minor in people_map:
            if name.lower() in combined_lower:
                return major, minor

    return "미분류", ""


def classify_all(df=None):
    """
    마스터 데이터의 전체 거래를 분류.
    사용자가 직접 분류한 항목(메모에 [자동] 없음)은 유지.
    반환: (분류된 DataFrame, 분류 통계 dict)
    """
    if df is None:
        if not Path(MASTER_FILE).exists():
            raise FileNotFoundError("마스터 데이터가 없습니다. 먼저 데이터를 가져오세요.")
        df = pd.read_excel(MASTER_FILE)

    # 문자열 컬럼 dtype 보정
    for col in ["대분류", "중분류", "메모"]:
        if col in df.columns:
            df[col] = df[col].fillna("").astype(str)

    _SPECIAL_CATS = {"자체이체", "카드대금", "가수금", "가지급금"}
    keyword_map = load_categories()
    people_map = load_people()

    classified = 0
    unclassified = 0
    manual_kept = 0

    for idx, row in df.iterrows():
        memo = str(row.get("메모", ""))
        major = str(row.get("대분류", ""))

        # 특수 분류(자체이체/카드대금/가수금/가지급금)는 항상 유지
        if major in _SPECIAL_CATS:
            manual_kept += 1
            continue

        # 사용자가 직접 분류한 항목 유지 (메모에 [자동]이 없고 대분류가 있으면 수동 분류)
        if major and major != "미분류" and "[자동]" not in memo:
            manual_kept += 1
            continue

        description = str(row.get("적요", ""))
        merchant = str(row.get("거래처", ""))

        major, minor = classify_transaction(description, merchant, keyword_map, people_map)
        df.at[idx, "대분류"] = major
        df.at[idx, "중분류"] = minor

        # 자동 분류 표시
        if major != "미분류":
            classified += 1
            if "[자동]" not in memo:
                clean_memo = memo.replace("[수동]", "").strip()
                df.at[idx, "메모"] = f"{clean_memo} [자동]".strip()
        else:
            unclassified += 1

    stats = {
        "총거래": len(df),
        "자동분류": classified,
        "미분류": unclassified,
        "수동유지": manual_kept,
        "분류율": f"{classified / max(len(df), 1) * 100:.1f}%",
    }

    return df, stats


def get_unclassified(df=None):
    """미분류 항목 목록 반환"""
    if df is None:
        if not Path(MASTER_FILE).exists():
            return pd.DataFrame()
        df = pd.read_excel(MASTER_FILE)

    mask = (df["대분류"] == "미분류") | (df["대분류"] == "") | (df["대분류"].isna())
    return df[mask][["거래일자", "적요", "거래처", "출금액", "입금액"]].copy()


def manual_classify(df, indices, major, minor):
    """특정 거래들을 수동 분류"""
    for idx in indices:
        if idx < len(df):
            df.at[idx, "대분류"] = major
            df.at[idx, "중분류"] = minor
            current_memo = str(df.at[idx, "메모"]) if pd.notna(df.at[idx, "메모"]) else ""
            if "수동" not in current_memo:
                df.at[idx, "메모"] = f"{current_memo} [수동]".strip()
    return df
