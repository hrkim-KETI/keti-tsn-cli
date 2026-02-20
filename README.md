# keti-tsn-cli

Microchip TSN 스위치 설정을 위한 CLI 도구

## 개요

`keti-tsn-cli`는 Microchip TSN 스위치와 통신하기 위한 독립적인 CLI 도구입니다.
`mvdct`(Microchip VelocityDRIVE CT CLI)의 핵심 기능을 JavaScript로 재구현하여, 오픈소스 기반의 유연한 TSN 설정 환경을 제공합니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| `list` | 캐시된 YANG 카탈로그 목록 |
| `checksum` | 장비 YANG 카탈로그 체크섬 조회 |
| `download` | YANG 카탈로그 다운로드 |
| `encode` | YAML → CBOR 변환 (오프라인) |
| `decode` | CBOR → YAML 변환 (오프라인) |
| `fetch` | 특정 설정값 조회 (iFETCH) |
| `patch` | 설정값 변경 (iPATCH) |
| `post` | RPC 실행 — save-config 등 (POST) |
| `get` | 전체 설정 조회 (Block-wise GET) |

## 지원 Transport

| Transport | 연결 방식 | 프로토콜 | 용도 |
|-----------|-----------|----------|------|
| Serial (기본) | USB/UART 직접 연결 | MUP1 | 개발/디버깅 |
| WiFi | ESP32 AP를 통한 무선 연결 | UDP/MUP1 | 원격 디버깅/현장 배포 |
| Ethernet | LAN9692 data plane 직접 연결 | UDP/CoAP | 운영 환경/대규모 배포 |

### 아키텍처

**Serial 모드 (기본):**
```
Host (PC) --[USB/UART/MUP1]--> Target (LAN9662)
```

**WiFi 모드 (ESP32 AP + Transparent Bridge):**
```
┌─────────────┐      WiFi (UDP)      ┌─────────────┐      Serial      ┌─────────────┐
│  Host (PC)  │ ◀─────────────────▶  │   ESP32     │ ◀─────────────▶  │  LAN9662    │
│  (Station)  │     MUP1 frames      │   (AP)      │     MUP1         │  (Target)   │
└─────────────┘      Port 5683       └─────────────┘                  └─────────────┘
       │                                    │
       └──── WiFi Direct 연결 ──────────────┘
            (독립 디버깅 네트워크)
```

**WiFi 모드 장점:**
- **독립 네트워크**: 기존 인프라 의존성 없음 (ESP32가 AP 역할)
- **UDP 기반**: CoAP 기본 프로토콜 (RFC 7252), 낮은 오버헤드
- **투명 브리지**: MUP1 프레임을 그대로 전달, 최소 지연시간
- **격리된 환경**: 디버깅 트래픽이 외부 망에 노출 안됨

**Ethernet 모드 (Data Plane 직접 접속):**
```
┌─────────────┐    Ethernet (UDP/CoAP)    ┌─────────────┐
│  Host (PC)  │ ◀──────────────────────▶  │  LAN9692    │
│             │      Port 5683            │  (Target)   │
└─────────────┘                           └─────────────┘
       │                                         │
       └──── L3 VLAN 네트워크 (DHCP/Static) ─────┘
```

**Ethernet 모드 장점:**
- **MUP1 불필요**: CoAP 메시지를 직접 UDP로 전송 (프록시 없음)
- **운영 환경 적합**: 기존 네트워크 인프라 활용
- **낮은 지연**: 중간 프록시 없이 직접 통신

## 설치

```bash
npm install
```

## 시작하기

장비와 통신하기 전에 YANG 카탈로그를 다운로드해야 합니다. 최초 1회만 수행하면 됩니다.

```bash
# 1. 장비의 YANG 카탈로그 체크섬 확인
./keti-tsn checksum

# 2. YANG 카탈로그 다운로드 (체크섬 기반으로 자동 다운로드)
./keti-tsn download

# 3. 다운로드된 카탈로그 확인
./keti-tsn list
```

이후 `fetch`, `patch`, `get` 등의 명령을 사용할 수 있습니다.

## 사용법

```bash
# 도움말
./keti-tsn --help
./keti-tsn -h

# 버전 확인
./keti-tsn --version
./keti-tsn -V
```

### 오프라인 명령 (장비 불필요)

```bash
# 캐시된 YANG 카탈로그 목록
./keti-tsn list

# YAML → CBOR 변환
./keti-tsn encode config.yaml -o config.cbor

# CBOR → YAML 변환
./keti-tsn decode response.cbor -o response.yaml
```

### 입력/출력 형식

**인코딩 입력 (Instance-Identifier 형식):**

```yaml
- /ietf-interfaces:interfaces/interface[name='1']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/gate-enabled: true
- /ietf-interfaces:interfaces/interface[name='1']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/admin-gate-states: 255
```

**디코딩 출력 (Tree 형식, RFC 7951):**

```yaml
ietf-interfaces:interfaces:
  interface:
    - name: '1'
      ieee802-dot1q-bridge:bridge-port:
        ieee802-dot1q-sched-bridge:gate-parameter-table:
          gate-enabled: true
          admin-gate-states: 255
```

### 장비 명령 (디바이스 필요)

**Serial 모드 (기본):**

```bash
# YANG 체크섬 조회 (기본 장치: /dev/ttyACM0)
./keti-tsn checksum

# YANG 체크섬 조회 (장치 지정)
./keti-tsn checksum -d /dev/ttyUSB0

# YANG 카탈로그 다운로드
./keti-tsn download

# 전체 설정 조회
./keti-tsn get -o backup.yaml

# 설정값 조회 (iFETCH)
./keti-tsn fetch query.yaml -o result.yaml

# 설정값 변경 (iPATCH)
./keti-tsn patch config.patch.yaml

# RPC 실행 (POST) - 설정 저장
./keti-tsn post setup/save-config.yaml
```

**WiFi 모드 (ESP32 AP 연결):**

```bash
# 1. PC를 ESP32 AP에 연결 (SSID: "TSN-Debug" 등)
# 2. ESP32 기본 AP IP: 192.168.4.1

# YANG 체크섬 조회
./keti-tsn checksum --transport wifi --host 192.168.4.1

# 전체 설정 조회
./keti-tsn get -o backup.yaml --transport wifi --host 192.168.4.1

# 설정값 조회
./keti-tsn fetch query.yaml -o result.yaml --transport wifi --host 192.168.4.1

# 설정값 변경
./keti-tsn patch config.patch.yaml --transport wifi --host 192.168.4.1

# 커스텀 포트 사용 시
./keti-tsn checksum --transport wifi --host 192.168.4.1 --port 5684
```

**Ethernet 모드 (LAN9692 Data Plane 직접 접속):**

LAN9692에는 기본 IP가 없으므로, 먼저 Serial로 IP를 설정해야 합니다:
```bash
# 최초 1회: Serial로 L3 VLAN + IP 설정
./keti-tsn patch setup/setup-ip-static.yaml     # IP 192.168.1.10 할당
./keti-tsn post setup/save-config.yaml           # flash에 저장
```

이후 Ethernet transport 사용:
```bash
# YANG 체크섬 조회
./keti-tsn checksum --transport eth --host 192.168.1.10

# 전체 설정 조회
./keti-tsn get -o backup.yaml --transport eth --host 192.168.1.10

# 설정값 조회
./keti-tsn fetch query.yaml -o result.yaml --transport eth --host 192.168.1.10

# 설정값 변경
./keti-tsn patch config.patch.yaml --transport eth --host 192.168.1.10

# 커스텀 포트 사용 시
./keti-tsn checksum --transport eth --host 192.168.1.10 --port 5684
```

### 옵션

**Transport 옵션:**

| 옵션 | 설명 |
|------|------|
| `--transport <type>` | Transport 타입: `serial` \| `wifi` \| `eth` (기본값: `serial`) |
| `-d, --device <path>` | Serial 장치 경로 (기본값: `/dev/ttyACM0`) |
| `--host <address>` | 대상 IP 주소 (WiFi/Ethernet 모드 필수) |
| `--port <number>` | 대상 UDP 포트 (기본값: `5683`) |

**일반 옵션:**

| 옵션 | 설명 |
|------|------|
| `-o, --output <file>` | 출력 파일 |
| `-c, --cache <dir>` | YANG 캐시 디렉토리 |
| `--sort-mode <mode>` | CBOR 키 정렬: `velocity` \| `rfc8949` (기본값: `velocity`) |
| `-v, --verbose` | 상세 출력 |
| `-V, --version` | 버전 표시 |
| `-h, --help` | 도움말 표시 |

## 프로젝트 구조

```
keti-tsn-cli/
├── keti-tsn                # CLI wrapper 스크립트
├── bin/
│   └── keti-tsn.js         # CLI 진입점
├── lib/
│   └── commands/           # CLI 명령어 구현
│       ├── checksum.js     # YANG 체크섬 조회
│       ├── download.js     # YANG 카탈로그 다운로드
│       ├── list.js         # 캐시 목록 조회
│       ├── encode.js       # YAML → CBOR 변환
│       ├── decode.js       # CBOR → YAML 변환
│       ├── fetch.js        # 설정값 조회
│       ├── patch.js        # 설정값 변경
│       ├── post.js         # RPC 실행
│       └── get.js          # 전체 설정 조회
├── setup/                  # 초기 설정 YAML 파일
│   ├── save-config.yaml        # 설정 저장 RPC
│   ├── setup-ip-static.yaml    # L3 VLAN + Static IP 설정
│   └── setup-ip-dhcp.yaml      # L3 VLAN + DHCP 설정
├── tsc2cbor/               # CBOR 변환 라이브러리
│   ├── lib/
│   │   ├── common/         # 공통 모듈
│   │   │   ├── input-loader.js    # YANG/SID 로딩 (공통)
│   │   │   ├── sid-resolver.js    # SID 리졸버
│   │   │   ├── yang-type-extractor.js  # YANG 타입 추출
│   │   │   └── cbor-encoder.js    # CBOR 인코더
│   │   ├── encoder/        # YAML → CBOR 변환
│   │   ├── decoder/        # CBOR → YAML 변환
│   │   ├── transport/      # 🆕 Transport 추상화 레이어
│   │   │   ├── index.js           # Transport Factory
│   │   │   ├── base.js            # Transport 기본 인터페이스
│   │   │   ├── serial-transport.js   # Serial 구현
│   │   │   ├── wifi-transport.js    # WiFi 구현
│   │   │   └── ethernet-transport.js # Ethernet 구현
│   │   ├── wifi/           # 🆕 WiFi 프로토콜
│   │   │   └── packet.js          # WiFi 패킷 프로토콜
│   │   ├── serial/         # 시리얼 통신 (MUP1 프로토콜)
│   │   ├── coap/           # CoAP 프로토콜
│   │   └── yang-catalog/   # YANG 카탈로그 관리
│   ├── tsc2cbor.js         # YAML → CBOR 변환기
│   └── cbor2tsc.js         # CBOR → YAML 변환기
├── scripts/
│   └── download-yang-cache.sh  # YANG 캐시 다운로드 스크립트
├── test/                   # 테스트 스크립트
│   └── configs/            # 테스트용 설정 파일
├── package.json
└── README.md
```

## YANG 캐시 다운로드

장비 없이 YANG 카탈로그를 다운로드하려면:

```bash
# 기본 체크섬으로 다운로드 (VelocityDRIVE-SP)
./scripts/download-yang-cache.sh

# 특정 체크섬 지정
./scripts/download-yang-cache.sh <checksum>
```

## 변경 이력

### 2026-02-12
- Ethernet Transport 기능 추가
  - LAN9692 data plane에 CoAP/UDP로 직접 통신 (MUP1 프레이밍 없음)
  - L3 VLAN 네트워크를 통한 운영 환경 지원
  - `ethernet-transport.js` 신규 구현
  - 새 CLI 옵션: `--transport eth`
- `post` 명령 추가 (CoAP POST for RPC)
  - `save-config` 등 YANG RPC 호출 지원
- 초기 설정 YAML 파일 제공 (`setup/`)
  - `setup-ip-static.yaml` — L3 VLAN + Static IP 설정
  - `setup-ip-dhcp.yaml` — L3 VLAN + DHCP 설정
  - `save-config.yaml` — 설정 저장 RPC
- 모든 장비 명령에서 Ethernet 모드 사용 가능
  - `checksum`, `download`, `get`, `fetch`, `patch`, `post`

### 2026-01-20
- WiFi Transport 기능 추가
  - ESP32 AP 모드 + UDP 투명 브리지 방식
  - CoAP 기본 프로토콜 (UDP, RFC 7252) 사용
  - Transport 추상화 레이어 구현 (`transport/base.js`, `serial-transport.js`, `wifi-transport.js`)
  - 새 CLI 옵션: `--transport`, `--host`, `--port`
- WiFi 아키텍처
  - Host(PC)가 Station, ESP32가 AP 역할
  - 독립적인 무선 디버깅 망 구축 가능
  - MUP1 프레임을 UDP로 투명하게 전달
- 모든 장비 명령에서 WiFi/Serial 선택 가능
  - `checksum`, `download`, `get`, `fetch`, `patch`

### 2024-12-29
- `fetch` 명령 구현 (iFETCH with instance-identifier format)
- `patch` 명령 구현 (iPATCH with Delta-SID CBOR)
- iPATCH 이중 인코딩 버그 수정
- iFETCH: 전체 경로에서 키 수집하도록 수정
- 모든 명령어 구현 완료 및 테스트

### 2024-12-23
- tsc2cbor 리팩토링: `loadInputs` 중복 코드 제거, `input-loader.js` 공통 모듈화
- CLI 명령어 구조 변경: `yang id` → `checksum`, `yang download` → `download`, `yang list` → `list`
- `-d` 옵션으로 디바이스 지정 (기본값: `/dev/ttyACM0`)
- `keti-tsn` wrapper 스크립트 생성 (mvdct 스타일)
- YANG 캐시 다운로드 스크립트 추가
- `encode`/`decode` 명령 구현
- `get` 명령 구현 (Block-wise GET)

### 2024-12-19
- 프로젝트 구조 생성
- tsc2cbor 라이브러리 통합
- 테스트 스크립트 구성

## 라이선스

TBD
