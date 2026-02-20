#!/bin/bash
#
# LAN9692 Ethernet Transport 초기 설정 스크립트
#
# Serial로 L3 VLAN IP 할당 + CoAP no-sec 모드 설정 + 저장 후,
# 호스트 네트워크 설정 안내를 출력합니다.
#
# 사용법:
#   ./setup/init-eth.sh [SERIAL_DEVICE]
#
# 예시:
#   ./setup/init-eth.sh
#   ./setup/init-eth.sh /dev/ttyUSB0

set -euo pipefail

SERIAL_DEVICE="${1:-/dev/ttyACM0}"
CLI="./keti-tsn"

echo "============================================"
echo " LAN9692 Ethernet Transport 초기 설정"
echo "============================================"
echo ""
echo "  Serial Device : $SERIAL_DEVICE"
echo ""

# Serial 연결 확인
echo -n "[Check] Serial device... "
if [ ! -e "$SERIAL_DEVICE" ]; then
    echo "NOT FOUND ($SERIAL_DEVICE)"
    echo "Error: Serial 장치를 찾을 수 없습니다."
    exit 1
fi
echo "OK"
echo ""

# Step 1: L3 VLAN + Static IP 설정
echo "[Step 1/3] L3 VLAN + Static IP 설정"
$CLI patch setup/setup-ip-static.yaml -d "$SERIAL_DEVICE" -v
echo ""

# Step 2: CoAP 보안 모드 → no-sec
echo "[Step 2/3] CoAP 보안 모드 → no-sec"
$CLI patch setup/no-sec.yaml -d "$SERIAL_DEVICE" -v
echo ""

# Step 3: 설정 저장 (flash)
echo "[Step 3/3] 설정 저장 (flash)"
$CLI post setup/save-config.yaml -d "$SERIAL_DEVICE" -v
echo ""

echo "============================================"
echo " 초기 설정 완료"
echo "============================================"
echo ""
echo "아래 단계를 수행하세요:"
echo ""
echo "1. 스위치를 재부팅하세요 (전원 재투입)"
echo ""
echo "2. 호스트 PC의 네트워크 인터페이스를 스위치와 동일한 서브넷으로 설정하세요:"
echo ""
echo "   sudo ip addr add 192.168.1.20/24 dev enxc84d442199ac"
echo "   sudo ip link set enxc84d442199ac up"
echo ""
echo "   ※ 인터페이스 이름(enxc84d442199ac)은 환경에 맞게 변경하세요."
echo "   ※ 현재 연결된 인터페이스 확인: ip link show"
echo ""
echo "3. 스위치 재부팅 후 연결을 확인하세요:"
echo ""
echo "   ping 192.168.1.10"
echo ""
echo "4. Ethernet transport 사용:"
echo ""
echo "   keti-tsn checksum --transport eth --host 192.168.1.10"
echo ""
