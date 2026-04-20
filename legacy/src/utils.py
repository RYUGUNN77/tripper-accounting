"""유틸리티 함수 모듈"""

import os
import json
import hashlib
import shutil
from pathlib import Path
from datetime import datetime

# 프로젝트 루트 경로
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
OUTPUT_DIR = PROJECT_ROOT / "output"
CONFIG_DIR = PROJECT_ROOT / "config"
MASTER_FILE = DATA_DIR / "master.xlsx"
CATEGORIES_FILE = CONFIG_DIR / "categories.yaml"
BACKUP_DIR = DATA_DIR / "backups"
LOG_FILE = DATA_DIR / "changelog.json"


def ensure_dirs():
    """필요한 디렉토리가 없으면 생성"""
    for d in [DATA_DIR, RAW_DIR, OUTPUT_DIR, CONFIG_DIR, BACKUP_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def generate_transaction_id(date, amount, description):
    """거래 고유 ID 생성 (중복 감지용)"""
    raw = f"{date}|{amount}|{description}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def parse_amount(value):
    """금액 문자열을 숫자로 변환 (콤마, 원 기호 등 제거)"""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    s = s.replace(",", "").replace("원", "").replace("₩", "").replace(" ", "")
    s = s.replace("−", "-").replace("–", "-")  # 유니코드 마이너스 처리
    if not s or s == "-":
        return 0
    try:
        return float(s)
    except ValueError:
        return 0


def format_currency(amount):
    """금액을 한국 원화 형식으로 포맷"""
    if amount >= 0:
        return f"{amount:,.0f}원"
    return f"-{abs(amount):,.0f}원"


def format_percent(value):
    """퍼센트 포맷"""
    return f"{value:.1f}%"


# ====== 변경 이력 로그 ======

def add_log(action, detail="", count=0, undo_data=None):
    """변경 이력 추가. undo_data: 되돌리기용 이전 상태 [{id, 대분류, 중분류, 메모}, ...]"""
    ensure_dirs()
    logs = load_logs()
    entry = {
        "id": datetime.now().strftime("%Y%m%d%H%M%S%f"),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "action": action,
        "detail": detail,
        "count": count,
    }
    if undo_data:
        entry["undo"] = undo_data
    logs.insert(0, entry)
    # 최대 500건 유지
    logs = logs[:500]
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)
    return entry["id"]


def load_logs():
    """변경 이력 로드"""
    if not LOG_FILE.exists():
        return []
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, ValueError):
        return []


# ====== 백업 ======

def create_backup(label=""):
    """마스터 데이터 백업 생성"""
    ensure_dirs()
    if not MASTER_FILE.exists():
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = f"backup_{ts}"
    if label:
        safe_label = "".join(c for c in label if c.isalnum() or c in "._- ")[:30]
        name += f"_{safe_label}"
    name += ".xlsx"
    dest = BACKUP_DIR / name
    shutil.copy2(MASTER_FILE, dest)
    add_log("백업 생성", name)
    return {"name": name, "path": str(dest), "timestamp": ts}


def list_backups():
    """백업 목록 반환"""
    ensure_dirs()
    backups = []
    for f in sorted(BACKUP_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.suffix == ".xlsx":
            size = f.stat().st_size
            size_str = f"{size/1024:.0f} KB" if size < 1024*1024 else f"{size/1024/1024:.1f} MB"
            backups.append({
                "name": f.name,
                "size": size_str,
                "timestamp": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            })
    return backups


def restore_backup(backup_name):
    """백업에서 마스터 데이터 복원"""
    src = BACKUP_DIR / backup_name
    if not src.exists():
        return False
    # 복원 전 현재 상태도 백업
    create_backup("복원전_자동백업")
    shutil.copy2(src, MASTER_FILE)
    add_log("백업 복원", backup_name)
    return True


def delete_backup(backup_name):
    """백업 파일 삭제"""
    target = BACKUP_DIR / backup_name
    if target.exists():
        target.unlink()
        add_log("백업 삭제", backup_name)
        return True
    return False
