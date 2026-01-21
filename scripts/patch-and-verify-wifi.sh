#!/bin/bash
#
# WiFi Transport를 사용한 설정 패치 및 검증 스크립트
#
# ESP32 AP에 연결된 상태에서:
#   1. LAN9662에 설정을 전송 (iPATCH)
#   2. 전송한 설정을 다시 읽어와서 확인 (iFETCH)
#
# Usage:
#   ./patch-and-verify-wifi.sh <config.yaml>
#   ./patch-and-verify-wifi.sh <config.yaml> [host] [port]
#
# Examples:
#   ./patch-and-verify-wifi.sh tas-gate-enable.patch.yaml
#   ./patch-and-verify-wifi.sh tas-gate-enable.patch.yaml 192.168.4.1
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../keti-tsn"

# ESP32 AP 기본값
DEFAULT_HOST="192.168.4.1"
DEFAULT_PORT="5683"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <config.yaml> [host] [port]"
    echo ""
    echo "WiFi Transport를 사용하여 설정을 전송하고 검증합니다."
    echo ""
    echo "Arguments:"
    echo "  config.yaml  전송할 설정 파일 (instance-identifier 형식)"
    echo "  host         ESP32 AP IP 주소 (기본값: $DEFAULT_HOST)"
    echo "  port         UDP 포트 (기본값: $DEFAULT_PORT)"
    echo ""
    echo "Examples:"
    echo "  $0 ../test/configs/tas-gate-enable.patch.yaml"
    echo "  $0 config.yaml 192.168.4.1"
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

CONFIG="$1"
HOST="${2:-$DEFAULT_HOST}"
PORT="${3:-$DEFAULT_PORT}"
OUTPUT="${CONFIG%.yaml}.fetched.yaml"

# 설정 파일 존재 확인
if [ ! -f "$CONFIG" ]; then
    echo -e "${RED}Error: Config file not found: $CONFIG${NC}"
    exit 1
fi

echo "========================================"
echo -e "${CYAN}WiFi 설정 패치 및 검증${NC}"
echo "========================================"
echo ""
echo "ESP32 Host: $HOST:$PORT"
echo "Config:     $CONFIG"
echo "Output:     $OUTPUT"
echo ""

# 설정 파일 내용 출력
echo -e "${YELLOW}[1/3] 전송할 설정:${NC}"
echo "----------------------------------------"
cat "$CONFIG"
echo "----------------------------------------"
echo ""

# 1단계: 설정 전송 (iPATCH via WiFi)
echo -e "${YELLOW}[2/3] WiFi로 설정 전송 중... (iPATCH)${NC}"
if $CLI patch "$CONFIG" --transport wifi --host "$HOST" --port "$PORT"; then
    echo -e "${GREEN}✓ 설정 전송 완료${NC}"
else
    echo -e "${RED}✗ 설정 전송 실패${NC}"
    exit 1
fi
echo ""

# 잠시 대기 (디바이스가 설정을 적용할 시간)
echo -e "${BLUE}설정 적용 대기 중... (1초)${NC}"
sleep 1
echo ""

# 2단계: 설정 조회 (iFETCH via WiFi)
echo -e "${YELLOW}[3/3] WiFi로 설정 확인 중... (iFETCH)${NC}"
if $CLI fetch "$CONFIG" -o "$OUTPUT" --transport wifi --host "$HOST" --port "$PORT"; then
    echo -e "${GREEN}✓ 설정 확인 완료${NC}"
else
    echo -e "${RED}✗ 설정 확인 실패${NC}"
    exit 1
fi
echo ""

# 결과 출력
if [ -f "$OUTPUT" ]; then
    echo "========================================"
    echo -e "${GREEN}현재 디바이스 설정:${NC}"
    echo "----------------------------------------"
    cat "$OUTPUT"
    echo "----------------------------------------"
fi

echo ""
echo -e "${GREEN}완료!${NC}"
echo "========================================"
