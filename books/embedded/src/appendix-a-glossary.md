# 부록 A. 용어집

이 책에서 반복해서 쓰는 용어를 정리한다. 정의는 이 책의 범위 안에서 필요한 만큼만 적었다. 더 정확한 정의는 각 부품의 데이터시트와 프로토콜 규격을 따른다.

## A.1 통신과 프레이밍

**ACK / NACK**
수신 확인 응답. I2C에서는 수신측이 바이트를 받으면 ACK(0), 받지 못하면 NACK(1)로 응답한다. CAN에서는 수신 노드가 ACK 슬롯을 dominant로 채워 "받았다"를 알린다.

**보율(baud rate)**
초당 심볼 수. UART는 1심볼이 1비트라 bps와 같다고 본다. 8N1에서 115200 baud는 이론상 초당 약 11,520바이트다.

**CRC (Cyclic Redundancy Check)**
연속된 비트 오류 검출에 강한 체크섬. poly·init·refin/refout·xorout 파라미터와 계산 범위, 바이트 순서를 맞춰야 한다. 오류 검출이지 인증은 아니다.

**DLC (Data Length Code)**
클래식 CAN 프레임에서 데이터 길이를 0~8로 인코딩하는 4비트 필드. 9 이상은 클래식 CAN에서 8로 취급된다.

**엔디언(endianness)**
정수를 바이트로 표현할 때의 순서. 빅엔디언은 상위 바이트부터, 리틀엔디언은 하위 바이트부터 쓴다. 프로토콜에서는 항상 명시한다.

**프레이밍(framing)**
바이트 스트림에서 "어디서부터 어디까지가 한 메시지인가"를 정하는 규칙. 구분자, 길이 접두, 고정 크기, COBS, SLIP 등이 있다.

**구분자(delimiter)**
프레임의 끝을 나타내는 특정 바이트나 문자열. `\n`, `\r\n`이 흔하다. 페이로드에 들어갈 수 있으면 이스케이프가 필요하다.

**길이 접두(length prefix)**
`[LEN][PAYLOAD]`처럼 프레임 앞에 길이를 두는 방식. 최대 길이 검증과 부분 프레임 타임아웃이 필수다.

**COBS (Consistent Overhead Byte Stuffing)**
페이로드에서 `0x00`을 없애고 프레임 끝에 `0x00`을 붙여 경계로 쓰는 방식. 254바이트마다 최대 1바이트 오버헤드가 든다.

**SLIP**
`END=0xC0`, `ESC=0xDB`로 프레임을 구분하는 방식. `0xC0`은 `0xDB 0xDC`, `0xDB`는 `0xDB 0xDD`로 이스케이프한다.

**TLV (Type-Length-Value)**
타입·길이·값을 순서대로 붙여 가변 길이 필드를 명시하는 형식.

**패리티(parity)**
UART에서 1비트 오류를 검출하는 선택 비트. Even/Odd가 있으며 정정은 못 한다. 8N1은 패리티 없음이다.

**PCI (Protocol Control Information)**
ISO-TP 프레임 앞부분의 제어 정보. SF/CF는 1바이트, FF는 2바이트, FC는 3바이트를 쓴다.

**PDU (Protocol Data Unit)**
프로토콜이 주고받는 데이터 단위. Modbus TCP에서는 MBAP 헤더 뒤에 PDU가 온다.

**SOF / EOF**
프레임의 시작(Start of Frame)과 끝(End of Frame). CAN에서는 SOF가 dominant 1비트, EOF가 recessive 7비트다.

**비트 스터핑(bit stuffing)**
CAN에서 같은 레벨이 5번 연속되면 반대 비트를 하나 끼워 넣는 규칙. 수신측은 이를 제거하며, 규칙 위반은 오류다.

**STmin**
ISO-TP 흐름 제어에서 수신측이 알려 주는 연속 프레임 간 최소 시간.

**MBAP**
Modbus TCP의 헤더. 트랜잭션 ID, 프로토콜 ID, 길이, 유닛 ID를 담는다.

**LRC (Longitudinal Redundancy Check)**
Modbus ASCII에서 쓰는 체크섬.

## A.2 버스와 전기

**UART / USART**
UART는 클록 선 없이 약속된 보율로 비트를 주고받는 비동기 시리얼이다. USART는 동기 모드도 지원하는 변형이다.

**TTL / CMOS 레벨**
MCU가 쓰는 단일 종단 전압 레벨. 3.3V 또는 5V가 흔하다. 5V CMOS의 VIH는 약 0.7×VDD라 3.3V 신호가 모자랄 수 있다.

**RS-232**
옛 PC COM 포트의 단일 종단·반전 레벨. TTL과 직결하면 장치가 상한다. MAX3232 같은 트랜시버로 변환한다.

**RS-485**
차동 신호를 쓰는 반이중 다중 드롭 버스. 산업용에서 널리 쓰이며 양 끝 120Ω 종단이 필요하다.

**공통 접지(common ground)**
TTL UART 등 단일 종단 신호의 기준. 접지가 없으면 기준이 떠서 쓰레기 값이 나오거나 핀이 상한다.

**종단(termination)**
버스 끝에서 신호 반사를 줄이는 저항. CAN과 RS-485는 보통 120Ω을 양 끝에 둔다.

**스텁(stub)**
버스 본선에서 노드까지 뻗은 짧은 분기. 길면 반사와 신호 무결성 문제가 생긴다.

**오픈 드레인(open-drain)**
장치가 선을 low로 당기기만 하고 high로 밀지 않는 출력 방식. 풀업 저항이 필요하며, I2C와 여러 장치가 선을 공유하는 구성에 쓴다.

**풀업 / 풀다운(pull-up / pull-down)**
선을 전원이나 접지로 끌어 올리는 저항. 입력의 기본 상태를 정하고 플로팅을 막는다.

**푸시풀(push-pull)**
high와 low를 모두 능동적으로 구동하는 출력 방식. SPI가 쓴다.

**I2C**
SDA/SCL 두 선의 동기·오픈 드레인 버스. 7비트 주소로 장치를 구분하고 ACK/NACK로 응답한다.

**SPI**
SCLK/MOSI/MISO/CS 네 선의 동기·전이중 버스. CS로 슬레이브를 선택하고, ACK와 기본 오류 검출이 없다.

**CS (Chip Select)**
SPI에서 슬레이브를 선택하는 신호. 보통 active low이며 트랜잭션 동안 low를 유지한다.

**CPOL / CPHA**
SPI 클록의 idle 상태(CPOL)와 데이터 샘플 에지(CPHA). 네 가지 모드(0~3)를 만든다.

**CAN**
차동 신호를 쓰는 다중 마스터 버스. ID 우선순위 중재, CRC·ACK·비트 스터핑·오류 카운터를 갖는다.

**dominant / recessive**
CAN의 두 논리 레벨. dominant(0)가 recessive(1)를 이기며, 버스는 wired-AND처럼 동작한다.

**중재(arbitration)**
여러 노드가 동시에 말할 때 하나를 고르는 절차. CAN은 ID가 작은 쪽이 이기고, 진 노드는 다음 기회에 다시 시도한다.

**수용 필터(acceptance filter)**
CAN 수신 컨트롤러가 필요한 ID만 받도록 거르는 기능.

**TEC / REC**
CAN의 송신/수신 오류 카운터. Error Active ≤127, Error Passive >127, Bus-Off는 TEC >255다.

**Bus-Off**
CAN 노드가 오류 누적으로 버스에서 스스로 빠지는 상태. 128번의 11비트 recessive를 본 뒤 복구를 시도한다.

**CAN FD**
페이로드를 최대 64바이트까지 늘리고 데이터 구간을 빠르게 전환하는 CAN 확장. FDF 비트, CRC 17/21, RTR 없음이 특징이다.

**BRS (Bit Rate Switch)**
CAN FD에서 데이터 구간만 더 빠른 비트레이트로 전환하는 기능.

**ISO-TP (ISO 15765-2)**
8바이트를 넘는 CAN 메시지를 SF/FF/CF/FC로 나눠 주고받는 전송 계층.

**J1939**
29비트 CAN을 쓰는 트럭·버스·건설기계용 상위 프로토콜. PGN, 소스 주소, 전송 프로토콜을 쓴다.

**CANopen**
11비트 CAN을 쓰는 산업 자동화 프로토콜. NMT, SDO, PDO, CiA 301이 핵심이다.

**NMEA 2000**
29비트 CAN, 250k를 쓰는 선박 전자장비 프로토콜.

## A.3 MCU와 펌웨어

**MCU (Microcontroller Unit)**
CPU·플래시·RAM·주변장치를 한 칩에 넣은 컴퓨터. 보통 베어메탈 또는 RTOS에서 동작한다.

**SBC (Single Board Computer)**
라즈베리파이처럼 Linux를 돌리는 단일 보드 컴퓨터. MCU보다 메모리·저장장치가 크지만 실시간성과 전력에서 불리할 수 있다.

**베어메탈(bare metal)**
OS 없이 `main()`과 인터럽트로 동작하는 환경. 프로세스·가상 메모리·스케줄러가 없다.

**RTOS (Real-Time Operating System)**
태스크·큐·뮤텍스·우선순위를 제공하는 실시간 OS. 우선순위 역전과 태스크 스택을 설계해야 한다.

**ISR (Interrupt Service Routine)**
하드웨어 이벤트가 발생하면 실행되는 함수. 짧게 유지하고, 블로킹·동적 할당·`printf`를 피한다.

**`volatile`**
컴파일러가 변수를 매번 메모리에서 읽도록 하는 한정자. 원자성은 보장하지 않는다.

**원자성(atomicity)**
읽기-수정-쓰기가 중간에 끼어들지 않아 완전히 수행되는 성질. 8비트 CPU에서 16비트 변수 접근은 원자적이지 않을 수 있다.

**링 버퍼(ring buffer)**
고정 크기 버퍼를 원형으로 사용하는 큐. 생산자와 소비자가 head/tail을 움직이며, SPSC면 락 없이 동작한다.

**워치독(watchdog)**
일정 시간 안에 리셋되지 않으면 MCU를 재시작하는 장치. 메인 루프에서만 리셋해야 의미가 있다.

**브라운아웃(brownout)**
전압이 순간적으로 떨어져 리셋이나 오동작이 나는 현상. 검출기와 디커플링으로 보호한다.

**플래시 / SRAM / EEPROM / NVS**
플래시는 프로그램과 상수, SRAM은 실행 중 변수, EEPROM/NVS는 전원이 꺼져도 남는 설정, 외부 플래시/SD는 로그와 펌웨어에 쓴다.

**스택 하이워터마크(stack high-water mark)**
스택이 최대로 얼마나 사용되었는지 측정한 값. 오버플로를 예방하는 데 쓴다.

**GPIO (General-Purpose Input/Output)**
범용 입출력 핀. 입력 풀업/풀다운, 출력 전류 한도, 5V tolerant 여부를 확인한다.

**ADC (Analog-to-Digital Converter)**
아날로그 전압을 디지털 값으로 바꾸는 주변장치. 해상도·기준 전압·입력 범위·샘플링 시간을 본다.

**PWM (Pulse Width Modulation)**
주기를 두고 high 비율을 바꿔 평균 전압을 제어하는 방식. 주파수와 분해능은 트레이드오프다.

**DMA (Direct Memory Access)**
CPU를 거치지 않고 주변장치와 메모리 사이를 전송하는 기능. 버퍼를 조기 재사용하지 않는다.

**LDO (Low-Dropout regulator)**
USB 5V에서 3.3V를 만드는 데 쓰는 선형 레귤레이터. 누설 전류와 발열을 고려한다.

**부트로더(bootloader)**
펌웨어를 업로드하거나 복구하는 작은 프로그램. 지우면 복구 수단을 잃을 수 있다.

**SWD / JTAG**
MCU 디버깅 인터페이스. 브레이크포인트, 변수 관찰, 레지스터 확인에 쓴다.

**strapping pin**
부팅 모드를 결정하는 핀. ESP32의 일부 핀은 부팅 시 상태가 중요하다.

**OTA (Over-The-Air)**
네트워크로 펌웨어를 업데이트하는 것. A/B 파티션, 서명 검증, 롤백을 전제로 설계한다.

**프로비저닝(provisioning)**
장치에 Wi-Fi 자격 증명, 키, 초기 설정을 넣는 과정. 하드코딩은 배포에서 문제가 된다.

**PIO (Programmable I/O)**
RP2040이 제공하는 Programmable I/O.

## A.4 IoT와 네트워크

**MQTT**
브로커 기반 발행/구독 메시징. 토픽, QoS, retain, will, keepalive, 세션을 갖는다.

**토픽(topic)**
MQTT에서 메시지를 분류하는 `/` 계층 문자열. `+`와 `#` 와일드카드를 쓴다.

**QoS (Quality of Service)**
MQTT의 전달 보장 수준. 0=최대 한 번, 1=최소 한 번, 2=정확히 한 번. 브로커-클라이언트 구간의 보장이다.

**retain**
MQTT 브로커가 토픽의 마지막 메시지를 저장해 새 구독자에게 주는 기능.

**will**
MQTT 클라이언트가 비정상 종료할 때 브로커가 대신 발행하는 메시지.

**BLE (Bluetooth Low Energy)**
저전력 근거리 무선. GAP으로 광고/연결하고 GATT 서비스/특성으로 데이터를 주고받는다.

**GAP / GATT**
BLE의 연결 관리(GAP)와 데이터 구조(GATT). GATT는 서비스와 특성의 트리다.

**CCCD**
BLE 특성의 notify/indicate를 켜는 디스크립터. 이걸 켜지 않아 값이 안 오는 실수가 흔하다.

**RSSI**
수신 신호 강도 지표. Wi-Fi/BLE 안테나 위치와 링크 품질을 볼 때 쓴다.

**Modbus**
산업용 사실상 표준 프로토콜. RTU(바이너리, CRC), ASCII(hex, LRC), TCP(포트 502, MBAP) 변형이 있다.

**OPC UA**
산업 자동화의 상위 통신 규격. 10장의 계층 표에 등장한다.

**CoAP**
UDP 기반의 REST형 프로토콜. 포트 5683, DTLS 5684, observe와 block-wise 전송을 지원한다.

**DTLS**
UDP용 TLS. CoAP 같은 UDP 기반 프로토콜의 보안에 쓴다.

**LPWAN**
저전력 광역 네트워크. LoRaWAN, NB-IoT, LTE-M 등이 있다.

**LoRaWAN**
ISM 대역의 장거리·저전력 프로토콜. 게이트웨이와 duty cycle 제한이 있다.

**NB-IoT / LTE-M**
라이선스 셀룰러 기반 LPWAN. NB-IoT는 저전력·저처리량, LTE-M은 처리량·이동성이 더 낫다.

**Thread / Zigbee / Matter / Z-Wave**
스마트홈 프로토콜. Thread/Zigbee는 802.15.4 메시, Matter는 응용 계층 표준, Z-Wave는 sub-GHz 독자 규격이다.

**게이트웨이(gateway)**
프로토콜 변환, 로컬 필터링, 버퍼링, 오프라인 대응을 담당하는 중간 장치.
