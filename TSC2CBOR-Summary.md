# tsc2cbor 기술 요약

YANG 스키마 기반 YAML ↔ CBOR 변환 라이브러리

---

## 1. 아키텍처 개요

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           tsc2cbor 아키텍처                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │  SHARED DATA (초기화 시 1회 로딩)                                 │    │
│   │  ┌─────────────────────────┐  ┌─────────────────────────────┐   │    │
│   │  │ sidInfo                 │  │ typeTable                   │   │    │
│   │  │  - pathToSid (인코딩)    │  │  - types: 경로 → 타입정보   │   │    │
│   │  │  - nodeInfoBySid (디코딩)│  │  - enum, identity 등        │   │    │
│   │  └─────────────────────────┘  └─────────────────────────────┘   │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                    ▲                         ▲                           │
│                    │                         │                           │
│                    │ 참조                    │ 참조                       │
│                    │                         │                           │
│   ENCODING ────────┼─────────────────────────┼───────────────────────    │
│                    │                         │                           │
│   ┌──────────┐   ┌─┴───────────┐   ┌──────────────┐   ┌──────┐          │
│   │   YAML   │ → │ transformer │ → │   JS Map     │ → │ CBOR │          │
│   │ (문자열)  │   └─────────────┘   │ (Delta-SID)  │   │(바이너리)│        │
│   └──────────┘                     └──────────────┘   └──────┘          │
│                                                                          │
│                    ▲                         ▲                           │
│                    │                         │                           │
│                    │ 참조                    │ 참조                       │
│                    │                         │                           │
│   DECODING ────────┼─────────────────────────┼───────────────────────    │
│                    │                         │                           │
│   ┌──────┐   ┌─────┴───────┐   ┌─────────────┐   ┌──────────┐           │
│   │ CBOR │ → │detransformer│ → │ Nested JSON │ → │   YAML   │           │
│   │(바이너리)│  └─────────────┘   │ (Tree 구조)  │   │ (문자열)  │           │
│   └──────┘                     └─────────────┘   └──────────┘           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Transformer 내부 구조 (인코딩)

transformer 블록 내부의 세부 블록:

**[1] XPathParser (XPath 파싱)**
- 입력: `"/ietf-interfaces:interfaces/interface[name='1']/enabled"`
- 출력:
  - 경로 세그먼트: `["ietf-interfaces:interfaces", "interface", "enabled"]`
  - 리스트 키: `{ "interface": { name: "1" } }`

**[2] PathToSidResolver (경로→SID 변환)** ← sidInfo.pathToSid 참조
- 입력: `"interfaces/interface/enabled"`
- 출력: `SID: 2035`

**[3] DeltaSidLookup (Delta-SID 조회)** ← sidInfo.nodeInfo 참조
- 입력: `SID: 2035`
- 출력: `deltaSid: 2` (nodeInfo에서 조회, 초기화 시 미리 계산됨)

**[4] ValueEncoder (값 인코딩)** ← typeTable.types 참조
- 입력: `"open"` (enum 문자열)
- 출력: `0` (숫자)

**[5] NestedMapBuilder (중첩 Map 구성)**
- 입력: 개별 `{ deltaSid, encodedValue }` 쌍들
- 출력: `Map { 5960: Map { 7: [ Map { 2: true } ] } }`

### Detransformer 내부 구조 (디코딩)

detransformer 블록 내부의 세부 블록:

**[1] AbsoluteSidResolver (Delta→Absolute SID)** ← sidInfo.nodeInfoBySid 참조
- 입력: `{ deltaKey: 7, parentSid: 5960 }`
- 출력: `absoluteSid: 5967` (7 + 5960)

**[2] SidToPathResolver (SID→경로 변환)** ← sidInfo.nodeInfoBySid 참조
- 입력: `SID: 5967`
- 출력: `"stream-gate-instance-table"` (localName)

**[3] ValueDecoder (값 디코딩)** ← typeTable.types 참조
- 입력: `0` (숫자)
- 출력: `"open"` (enum 문자열)

**[4] NestedObjectBuilder (중첩 객체 구성)**
- 입력: `Map { 5967: Map { ... } }` (SID 키)
- 출력: `{ "stream-gate-instance-table": { ... } }` (문자열 키)

---

## 2. 핵심 데이터 구조

```
┌─ 표기법 범례 ─────────────────────────────────────┐
│  Map { key: value }     : JavaScript Map 객체     │
│  { "key": value }       : JavaScript Object       │
│  [ value, value ]       : JavaScript Array        │
└───────────────────────────────────────────────────┘
```

### 2.1 sidInfo (SID 매핑)

YANG 경로와 SID(Schema Item Identifier) 간의 양방향 매핑

```javascript
sidInfo = {
  // 인코딩용: 경로 → SID
  pathToSid: Map {
    "interfaces/interface"     : 2033,
    "interfaces/interface/name": 2034,
    "stream-gates"             : 5960,
  },

  // 디코딩용: SID → 경로
  sidToPath: Map {
    2033: "interfaces/interface",
    2034: "interfaces/interface/name",
  },

  // Delta-SID 계산용: 부모-자식 관계
  nodeInfo: Map {
    "interfaces/interface/name": {
      sid: 2034,
      parent: 2033,        // 부모 SID
      deltaSid: 1,         // 2034 - 2033 = 1
    }
  },

  // 디코딩용 역방향 캐시 (SID → 노드정보)
  nodeInfoBySid: Map {
    2034: { parent: 2033, deltaSid: 1, path: "...", localName: "name" }
  },

  // Identity 매핑 (identityref 타입용)
  identityToSid: Map { "ethernetCsmacd": 1004 },
  sidToIdentity: Map { 1004: "ethernetCsmacd" },
}
```

### 2.2 typeTable (타입 정보)

각 노드의 YANG 타입 정보 → 값 인코딩/디코딩 방식 결정

```javascript
typeTable = {
  types: Map {
    // boolean
    "interfaces/interface/enabled": { type: "boolean" },

    // enumeration (BiMap)
    "stream-gate/gate-states": {
      type: "enumeration",
      enum: {
        nameToValue: Map { "open": 0, "closed": 1 },
        valueToName: Map { 0: "open", 1: "closed" }
      }
    },

    // identityref
    "interfaces/interface/type": {
      type: "identityref",
      base: "iana-if-type:interface-type"
    },

    // decimal64
    "ptp/clock-accuracy": {
      type: "decimal64",
      fractionDigits: 6
    },
  }
}
```

---

## 3. 인코딩 흐름 (YAML: CBOR)

### 3.1 입력/출력 형식

**입력 (Instance-Identifier 형식):**
```yaml
- /ietf-interfaces:interfaces/interface[name='1']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/gate-enabled: true
```

**출력 (CBOR 바이너리):**
```
BF 19 07D5 BF 18 1C 9F BF 09 61 31 19 14 0A BF 19 3E 42 BF 18 18 F5 FF FF FF FF FF FF
```

### 3.2 변환 과정

```
┌────────────────────────────────────────────────────────────────┐
│  Instance-Identifier 인코딩 흐름                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ① YAML 입력 (Instance-ID 형식)                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  - /ieee802-dot1q-stream-filters-gates:stream-gates/     │ │
│  │      stream-gate-instance-table[id=1]/gate-enable: true  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ yaml.load()                     │
│                                                                │
│  ② JS Array                                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  [ { "/...stream-gates/.../gate-enable": true } ]        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ transformInstanceIdentifier()   │
│                              │   - XPath 파싱                   │
│                              │   - 경로: SID 변환              │
│                              │   - Delta-SID 적용               │
│                                                                │
│  ③ Delta-SID Map                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Map {                                                   │ │
│  │    5960: Map {           // stream-gates (Absolute SID) │ │
│  │      7: [                // delta-SID (5967 - 5960)     │ │
│  │        Map { 2: true }   // gate-enable (delta)         │ │
│  │      ]                                                   │ │
│  │    }                                                     │ │
│  │  }                                                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ encodeToCbor()                  │
│                                                                │
│  ④ CBOR Binary                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  BF 19 1748 BF 07 9F BF 02 F5 FF FF FF FF                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 값 인코딩 (타입별)

```javascript
// enumeration: 이름: 숫자
"open": 0   (via typeInfo.enum.nameToValue)

// identityref: 이름: SID
"ethernetCsmacd": 1004   (via sidInfo.identityToSid)

// decimal64: 숫자: Tag(4, [exponent, mantissa])
3.14 (fractionDigits=2): Tag(4, [-2, 314])

// boolean: 그대로
true: true (CBOR: F5)
```

---

## 4. 디코딩 흐름 (CBOR: YAML)

### 4.1 입력/출력 형식

**입력 (CBOR 바이너리):**
```
BF 19 07D5 BF 18 1C 9F BF 09 61 31 ... FF FF FF
```

**출력 (Tree 형식, RFC 7951):**
```yaml
ietf-interfaces:interfaces:
  interface:
    - name: '1'
      ieee802-dot1q-bridge:bridge-port:
        ieee802-dot1q-sched-bridge:gate-parameter-table:
          gate-enabled: true
```

### 4.2 변환 과정

```
┌────────────────────────────────────────────────────────────────┐
│  디코딩 흐름                                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ① CBOR Binary                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  BF 19 1748 BF 07 9F BF 02 F5 FF FF FF FF                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ decodeFromCbor() (cbor-x)       │
│                                                                │
│  ② Delta-SID Map                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Map { 5960: Map { 7: [ Map { 2: true } ] } }         │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ detransform()                   │
│                              │   - Delta-SID: Absolute-SID    │
│                              │   - SID: 경로명 변환            │
│                              │   - 값 디코딩                    │
│                                                                │
│  ③ Nested JSON                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  {                                                       │ │
│  │    "ieee802-dot1q-stream-filters-gates:stream-gates": {  │ │
│  │      "stream-gate-instance-table": [                     │ │
│  │        { "gate-enable": true }                           │ │
│  │      ]                                                   │ │
│  │    }                                                     │ │
│  │  }                                                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                              │                                 │
│                              ▼ yaml.dump()                     │
│                                                                │
│  ④ YAML 출력 (Tree 형식)                                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 4.3 Delta-SID 해석

```
입력: Map { 7: [...] }  (부모 SID: 5960)

Step 1: Absolute SID 계산
  potentialAbsoluteSid = 7 + 5960 = 5967

Step 2: 부모 검증
  nodeInfoBySid.get(5967) → { parent: 5960, localName: "stream-gate-instance-table" }
  5960 === 5960? ✓: Delta-SID 맞음!

Step 3: 키 복원
  decodedKey = "stream-gate-instance-table"
```

---

## 5. Delta-SID 동작 원리

RFC 9254에서 정의한 CBOR 인코딩 최적화 기법

### 5.1 개념

부모-자식 관계가 있을 때 자식 SID를 "부모와의 차이"로 표현

```
stream-gates (SID 5960)
  └── stream-gate-instance-table (SID 5967)
        └── gate-enabled (SID 5969)

Absolute-SID: 5969: 19 17 51 (3 bytes)
Delta-SID:    2   : 02       (1 byte)  ← 5969 - 5967 = 2
```

### 5.2 바이트 절약 효과

| SID 값 | Absolute 인코딩 | Delta 인코딩 | 절약 |
|--------|----------------|--------------|------|
| 5969 | `19 17 51` (3B) | `02` (1B) | 2 bytes |
| 5967 | `19 17 4F` (3B) | `07` (1B) | 2 bytes |
| 2034 | `19 07 F2` (3B) | `01` (1B) | 2 bytes |

### 5.3 적용 조건

```javascript
// 인코딩 시
if (nodeInfo.parent !== null && nodeInfo.parent === parentSid) {
  encodedKey = nodeInfo.deltaSid;   // Delta-SID 사용
} else {
  encodedKey = currentSid;          // Absolute-SID 사용
}

// 디코딩 시
if (parentSid !== null) {
  absoluteSid = key + parentSid;    // Delta + Parent = Absolute
  if (nodeInfoBySid.get(absoluteSid).parent === parentSid) {
    // Delta-SID 확인됨
  }
}
```

---

## 6. 타입별 인코딩/디코딩 요약

| YANG 타입 | 인코딩 | 디코딩 | 예시 |
|-----------|--------|--------|------|
| `boolean` | 그대로 | 그대로 | `true` → `F5` → `true` |
| `string` | 그대로 | 그대로 | `"eth0"` → `64 65 74 68 30` |
| `uint8~64` | 숫자 | 숫자 | `255` → `18 FF` |
| `enumeration` | 이름→숫자 | 숫자→이름 | `"open"` → `0` → `"open"` |
| `identityref` | 이름→SID | SID→이름 | `"ethernetCsmacd"` → `1004` |
| `decimal64` | Tag(4) | 자동변환 | `3.14` → `C4 82 21 19 01 3A` |
| `union` | Tag(44/45) | Tag확인 | enum in union → `D8 2C 00` |

---

## 7. 파일 구조

```
tsc2cbor/
├── tsc2cbor.js              # 인코더 메인
├── cbor2tsc.js              # 디코더 메인
└── lib/
    ├── common/
    │   ├── input-loader.js       # YANG/SID 로딩
    │   ├── sid-resolver.js       # SID ↔ Path 매핑
    │   ├── yang-type-extractor.js # 타입 추출
    │   └── cbor-encoder.js       # CBOR 인코딩
    ├── encoder/
    │   ├── transformer-instance-id.js  # Instance-ID: Delta-SID
    │   └── value-encoder.js            # 값 인코딩
    └── decoder/
        ├── detransformer-delta.js      # Delta-SID: Tree
        └── value-decoder.js            # 값 디코딩
```

---

## 8. 요약

| 항목 | 인코딩 | 디코딩 |
|------|--------|--------|
| 입력 형식 | Instance-Identifier YAML | CBOR 바이너리 |
| 출력 형식 | CBOR 바이너리 | Tree YAML (RFC 7951) |
| 키 변환 | 경로: SID (Delta) | SID (Delta): 경로 |
| 값 변환 | 타입별 인코딩 | 타입별 디코딩 |
| 참조 데이터 | sidInfo, typeTable | sidInfo, typeTable |
| 압축률 | ~80% 절약 | - |
