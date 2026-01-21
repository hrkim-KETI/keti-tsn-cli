#!/bin/bash
#
# Microchip 설정 전송 및 확인 스크립트
#
# 1. 설정 파일을 디바이스에 전송 (iPATCH)
# 2. 전송한 설정을 다시 읽어와서 확인 (iFETCH)
#
# Usage:
#   ./patch-and-verify.sh <device> <config.yaml>
#   ./patch-and-verify.sh <device> <config.yaml> [output.yaml]
#
# Example:
#   ./patch-and-verify.sh /dev/ttyACM0 my-config.yaml
#   ./patch-and-verify.sh /dev/ttyACM0 my-config.yaml result.yaml
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="node $SCRIPT_DIR/../bin/keti-tsn.js"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <device> <config.yaml> [output.yaml]"
    echo ""
    echo "Arguments:"
    echo "  device       Serial device path (e.g., /dev/ttyACM0)"
    echo "  config.yaml  Configuration file to send (instance-identifier format)"
    echo "  output.yaml  Output file for fetched config (optional, default: <config>.fetched.yaml)"
    echo ""
    echo "Examples:"
    echo "  $0 /dev/ttyACM0 gate-enable.yaml"
    echo "  $0 /dev/ttyACM0 gate-enable.yaml result.yaml"
    exit 1
}

# 인자 확인
if [ -z "$1" ] || [ -z "$2" ]; then
    usage
fi

DEVICE="$1"
CONFIG="$2"
OUTPUT="${3:-${CONFIG%.yaml}.fetched.yaml}"

# 설정 파일 존재 확인
if [ ! -f "$CONFIG" ]; then
    echo -e "${RED}Error: Config file not found: $CONFIG${NC}"
    exit 1
fi

# 디바이스 확인
if [ ! -e "$DEVICE" ]; then
    echo -e "${RED}Error: Device not found: $DEVICE${NC}"
    exit 1
fi

echo "========================================"
echo "Microchip 설정 전송 및 확인"
echo "========================================"
echo ""
echo "Device:  $DEVICE"
echo "Config:  $CONFIG"
echo "Output:  $OUTPUT"
echo ""

# 설정 파일 내용 출력
echo -e "${YELLOW}[1/3] 전송할 설정:${NC}"
echo "----------------------------------------"
cat "$CONFIG"
echo "----------------------------------------"
echo ""

# 1단계: 설정 전송 (iPATCH)
echo -e "${YELLOW}[2/3] 설정 전송 중... (iPATCH)${NC}"
if $CLI "$DEVICE" patch "$CONFIG"; then
    echo -e "${GREEN}✓ 설정 전송 완료${NC}"
else
    echo -e "${RED}✗ 설정 전송 실패${NC}"
    exit 1
fi
echo ""

# 2단계: 설정 읽어오기 (iFETCH)
echo -e "${YELLOW}[3/3] 설정 확인 중... (iFETCH)${NC}"
if $CLI "$DEVICE" fetch "$CONFIG" -o "$OUTPUT"; then
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
