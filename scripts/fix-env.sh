#!/bin/bash
# .env.local의 CODEF_BASE_URL을 sandbox로 변경
sed -i '' 's|CODEF_BASE_URL=https://api.codef.io|CODEF_BASE_URL=https://sandbox.codef.io|' /Users/ryugunn/Desktop/tripper-accounting/.env.local
echo "CODEF_BASE_URL을 sandbox.codef.io로 변경 완료"
cat /Users/ryugunn/Desktop/tripper-accounting/.env.local
