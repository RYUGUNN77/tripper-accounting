#!/bin/bash
# =============================================
#  회계 자금 흐름 분석 대시보드 실행
#  더블클릭으로 실행하세요
# =============================================

# 스크립트가 위치한 디렉토리로 이동
cd "$(dirname "$0")"

echo "============================================="
echo "  회계 자금 흐름 분석 대시보드"
echo "============================================="
echo ""

# Python3 확인
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3이 설치되어 있지 않습니다."
    echo "   https://www.python.org/downloads/ 에서 설치해주세요."
    echo ""
    read -p "아무 키나 누르면 종료합니다..."
    exit 1
fi

# 필요한 패키지 자동 설치
echo "📦 필요한 패키지 확인 중..."
python3 -c "import flask, pandas, openpyxl, yaml, chardet" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📥 패키지 설치 중 (최초 1회만)..."
    pip3 install flask pandas openpyxl pyyaml chardet --quiet
    echo "✅ 패키지 설치 완료"
fi

echo ""
echo "🚀 대시보드를 시작합니다..."
echo "   브라우저가 자동으로 열립니다."
echo ""
echo "   종료하려면 이 창을 닫거나 Ctrl+C를 누르세요."
echo "============================================="
echo ""

# Flask 앱 실행
python3 app.py
