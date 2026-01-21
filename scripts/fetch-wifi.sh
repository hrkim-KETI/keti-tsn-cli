#!/bin/bash
#
# WiFi Transport를 사용한 설정 조회 스크립트 (DEBUG 모드)
#
# ESP32 AP에 연결된 상태에서 LAN9662의 설정을 조회합니다.
#
# Usage:
#   ./fetch-wifi.sh <query.yaml>
#   ./fetch-wifi.sh <query.yaml> [output.yaml]
#   ./fetch-wifi.sh <query.yaml> [output.yaml] [host] [port]
#
# Examples:
#   ./fetch-wifi.sh query-gate-enabled.yaml
#   ./fetch-wifi.sh query-gate-enabled.yaml result.yaml
#   ./fetch-wifi.sh query-gate-enabled.yaml result.yaml 192.168.4.1 5683
#
# Debug mode:
#   DEBUG=true ./fetch-wifi.sh query.yaml
#   또는 스크립트 내 DEBUG_MODE=true 설정
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../keti-tsn"

# ========================================
# DEBUG 모드 설정 (true/false)
# ========================================
DEBUG_MODE="${DEBUG:-true}"

if [ "$DEBUG_MODE" = "true" ]; then
    export DEBUG=true
fi

# ESP32 AP 기본값
DEFAULT_HOST="192.168.4.1"
DEFAULT_PORT="5683"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <query.yaml> [output.yaml] [host] [port]"
    echo ""
    echo "WiFi Transport를 사용하여 LAN9662에서 설정을 조회합니다."
    echo ""
    echo "Arguments:"
    echo "  query.yaml   조회할 경로 목록 (instance-identifier 형식)"
    echo "  output.yaml  결과 저장 파일 (기본값: <query>.result.yaml)"
    echo "  host         ESP32 AP IP 주소 (기본값: $DEFAULT_HOST)"
    echo "  port         UDP 포트 (기본값: $DEFAULT_PORT)"
    echo ""
    echo "Examples:"
    echo "  $0 ../test/configs/query-gate-enabled.yaml"
    echo "  $0 query.yaml result.yaml"
    echo "  $0 query.yaml result.yaml 192.168.4.1 5683"
    echo ""
    echo "사전 준비:"
    echo "  1. PC를 ESP32 AP에 연결 (SSID: TSN_ZONAL_MGMT_01)"
    echo "  2. ESP32 AP IP: $DEFAULT_HOST"
    exit 1
}

# 인자 확인
if [ -z "$1" ]; then
    usage
fi

QUERY="$1"
OUTPUT="${2:-${QUERY%.yaml}.result.yaml}"
HOST="${3:-$DEFAULT_HOST}"
PORT="${4:-$DEFAULT_PORT}"

# 쿼리 파일 존재 확인
if [ ! -f "$QUERY" ]; then
    echo -e "${RED}Error: Query file not found: $QUERY${NC}"
    exit 1
fi

echo "========================================"
echo -e "${CYAN}WiFi 설정 조회 (iFETCH)${NC}"
if [ "$DEBUG_MODE" = "true" ]; then
    echo -e "${YELLOW}🔧 DEBUG 모드 활성화${NC}"
fi
echo "========================================"
echo ""
echo "ESP32 Host: $HOST:$PORT"
echo "Query:      $QUERY"
echo "Output:     $OUTPUT"
echo ""

# 쿼리 파일 내용 출력
echo -e "${YELLOW}[1/2] 조회할 경로:${NC}"
echo "----------------------------------------"
cat "$QUERY"
echo "----------------------------------------"
echo ""

# 설정 조회 (iFETCH via WiFi)
echo -e "${YELLOW}[2/2] WiFi로 설정 조회 중... (iFETCH)${NC}"
if $CLI fetch "$QUERY" -o "$OUTPUT" --transport wifi --host "$HOST" --port "$PORT"; then
    echo -e "${GREEN}✓ 설정 조회 완료${NC}"
else
    echo -e "${RED}✗ 설정 조회 실패${NC}"
    exit 1
fi
echo ""

# 결과 출력
if [ -f "$OUTPUT" ]; then
    echo "========================================"
    echo -e "${GREEN}조회 결과:${NC}"
    echo "----------------------------------------"
    cat "$OUTPUT"
    echo "----------------------------------------"
fi

echo ""
echo -e "${GREEN}완료!${NC}"
echo "========================================"
