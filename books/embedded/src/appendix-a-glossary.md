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

**스택(stack)**
함수 호출 정보와 지역 변수가 놓이는 영역. MCU에서는 힙과 같은 SRAM을 반대 방향에서 밀어 쓰며, 넘치면 조용히 다른 데이터를 덮는다.

**힙(heap)**
`malloc`/`new`로 동적 할당하는 영역. 조각화·할당 실패·실행 시간 예측 불가 문제가 있다.

**정적 메모리(static storage)**
전역·정적 변수와 `static` 버퍼가 놓이는 영역(`.data`/`.bss`). 프로그램 수명 동안 자리를 차지한다.

**단편화(fragmentation)**
할당·해제가 반복되면서 총 여유 공간은 충분하지만 연속된 큰 블록이 없어지는 현상.

**메모리 순서(memory ordering)**
여러 문맥이 공유하는 메모리 접근의 가시성 순서. C11 `memory_order_acquire`/`release`로 데이터 발행과 소비를 동기화한다.

**SPSC (Single Producer Single Consumer)**
생산자 하나, 소비자 하나인 큐 구조. 인덱스 두 개와 release/acquire로 락 없이 구현할 수 있다.

**태스크(task)**
RTOS가 스케줄하는 독립 실행 흐름. 각자 스택과 우선순위를 가진다.

**큐(queue)**
태스크/ISR 사이에서 고정 크기 항목을 복사해 넘기는 FIFO. 블로킹 타임아웃과 가득 참 정책을 정한다.

**우선순위(priority)**
태스크의 긴급도. FreeRTOS는 준비된 태스크 중 우선순위가 가장 높은 것을 실행한다.

**틱(tick)**
RTOS 스케줄러의 시간 단위. `pdMS_TO_TICKS()`로 밀리초를 틱으로 바꾼다.

**우선순위 역전(priority inversion)**
낮은 우선순위 태스크가 뮤텍스를 잡고 있을 때 높은 우선순위 태스크가 그 뮤텍스를 기다리며 지연되는 현상.

**우선순위 상속(priority inheritance)**
높은 우선순위 태스크가 기다리는 동안 뮤텍스 소유자의 우선순위를 일시적으로 올리는 FreeRTOS 뮤텍스의 기능. 역전을 없애지 않고 시간을 한정한다.

**경보(alert)**
TWAI 드라이버가 Bus-Off·Error Passive·RX 큐 가득 참 같은 상태 변화를 알리는 플래그. `twai_read_alerts()`로 읽는다.

**deep sleep / light sleep**
ESP32의 저전력 모드. Deep sleep은 RTC 메모리·주변장치만 남기고(데이터시트 10µA), light sleep은 RAM 상태를 유지한 채 CPU를 멈춘다(0.8mA).

**standby (CAN 트랜시버)**
SN65HVD230의 저전력 listen-only 모드. `RS` 핀을 HIGH로 올리면 드라이버는 꺼지고 수신기는 동작한다(370µA 일반).

**RTC GPIO / ext0 / ext1**
Deep sleep에서 깨우기에 쓸 수 있는 RTC 영역 GPIO와 ESP-IDF의 깨우기 설정. `ext0`는 핀 하나, `ext1`은 여러 핀을 쓴다.

**Task Watchdog (TWDT)**
ESP-IDF가 태스크별로 리셋을 받아 정지·굶주림을 감시하는 워치독. `esp_task_wdt_add/reset`을 쓴다.

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
프로토콜 변환, 로컬 필터링, 버퍼링, 오프라인 대응을 담당하는 중간 장치. 차량에서는 여러 CAN 버스 사이의 진단 요청을 라우팅한다.

## A.5 차량 진단(OBD-II·UDS)

**OBD-II (On-Board Diagnostics II)**
차량의 배출가스 관련 진단을 표준화한 규격. SAE J1962 16핀 커넥터, SAE J1979 서비스/PID, ISO 15765-4 CAN 등을 포함한다.

**OBD-II 커넥터**
16핀 J1962 커넥터. 4번 차체 접지, 5번 신호 접지, 6번 CAN_H, 14번 CAN_L, 16번 +12V, 7/15번 K-line/L-line, 나머지는 제조사 재량이다.

**PID (Parameter ID)**
OBD-II Mode 01에서 읽는 표준 파라미터 번호. 예: 0C 엔진 회전수, 0D 차속, 05 냉각수 온도. PID마다 데이터 길이와 공식이 다르다.

**Mode / Service**
OBD-II 요청의 종류. 01 현재 데이터, 03 저장 DTC, 04 DTC 삭제, 09 차량 정보, 0A permanent DTC 등이 있다. 최신 표준은 "서비스"라고 부른다.

**DTC (Diagnostic Trouble Code)**
고장 코드. P(파워트레인), B(바디), C(샤시), U(네트워크) 계열이 있고, 2바이트로 인코딩된다.

**Freeze frame**
DTC가 발생한 순간의 PID 스냅샷. Mode 02로 읽는다.

**Readiness monitor**
배출가스 관련 자기 진단의 준비 상태. DTC를 지우면 초기화될 수 있고, 배출가스 검사에서 불합격할 수 있다.

**DID (Data Identifier)**
UDS `0x22`에서 읽는 2바이트 데이터 식별자. 제조사마다 의미가 다르고, 같은 DID도 ECU마다 다를 수 있다.

**UDS (Unified Diagnostic Services)**
ISO 14229 진단 프로토콜. `0x22` DID 읽기, `0x19` DTC 읽기, `0x10` 세션, `0x2E` 쓰기, `0x31` 루틴 등을 정의한다. CAN 위에서는 ISO-TP를 쓴다.

**NRC (Negative Response Code)**
UDS 부정 응답 `7F <SID> <NRC>`의 이유 코드. 0x31은 범위 밖(DID 없음), 0x78은 응답 대기, 0x7F는 현재 세션 미지원이다.

**ISO-TP (ISO 15765-2)**
CAN 한 프레임(8바이트)보다 긴 메시지를 SF/FF/CF/FC로 나눠 보내는 전송 계층.

**SF / FF / CF / FC**
ISO-TP의 Single Frame, First Frame, Consecutive Frame, Flow Control. FC는 수신 측이 보내는 흐름 제어다.

**기능 주소(functional address)**
OBD-II의 `7DF`. 여러 ECU에 브로드캐스트하는 진단 요청 주소.

**물리 주소(physical address)**
OBD-II의 `7E0`~`7E7`. 특정 ECU에 보내는 요청 주소. 응답은 `7E8`~`7EF`(요청 +8)다.

**ELM327**
OBD-II 포트와 PC의 UART/RS-232 사이를 해석하는 칩/어댑터. AT 명령과 프롬프트 `>`를 쓴다. 클론이 많고, 존재하지 않는 `v1.5`를 보고하는 제품도 있다.

**DPF (Diesel Particulate Filter)**
디젤 배기가스의 그을음을 거르는 필터. 그을음이 쌓이면 재생(regeneration)으로 태운다. 강제 재생은 정비 절차이며 고온·화재 위험이 있다.

**재생(regeneration)**
DPF에 쌓인 그을음을 높은 온도에서 태워 없애는 과정. 자연(passive)·능동(active)·강제(forced) 재생이 있다.

**MCP2515**
SPI로 MCU에 붙는 CAN 컨트롤러. Raspberry Pi 같은 SBC에 CAN을 추가할 때 쓴다.

**SoC (State of Charge)**
배터리에 남아 있는 충전량의 비율. 전기차·하이브리드의 BMS가 관리하며, 표준 OBD-II PID만으로 항상 읽을 수 있는 값은 아니다.

**SOH (State of Health)**
배터리의 현재 용량·성능이 초기 상태에 비해 어느 정도인지 나타내는 지표. 제조사·규제마다 정의가 다르다.

**BMS (Battery Management System)**
구동 배터리의 셀 전압·온도·전류·절연·충전 상태를 관리하는 시스템. 상세 데이터는 제조사 진단(Mode 22/UDS 0x22)으로 읽는 경우가 많다.

**J1979-2 / OBDonUDS**
OBD-II를 UDS 서비스 위에 올린 SAE 표준. Mode 01 PID를 `0x22` DID로 접근하는 방식이 쓰인다. J1979-DA는 PID/DID 정의를 담은 디지털 부속 문서다.

## A.6 가상 실습·테스트·데이터

**SocketCAN**
Linux 커널의 CAN 소켓 인터페이스. `can0`, `vcan0` 같은 네트워크 인터페이스로 CAN 프레임을 주고받는다.

**vcan (Virtual CAN)**
실제 CAN 컨트롤러 없이 프레임을 주고받는 Linux 가상 인터페이스. ACK·중재·오류 카운터·비트 타이밍은 재현하지 않는다.

**can-utils**
SocketCAN용 사용자 도구 모음. `candump`, `cansend`, `cangen`, `cansniffer`, `canplayer`, `canbusload`, `can-calc-bit-timing` 등이 있다.

**candump 로그**
`(타임스탬프) 인터페이스 ID#데이터` 형식의 텍스트 CAN 로그. `canplayer`와 python-can `CanutilsLogReader`가 읽는다.

**python-can virtual**
같은 파이썬 프로세스 안에서 여러 `Bus` 객체를 가상 채널로 묶는 인터페이스. 프로세스 밖으로 나가지 않는다.

**udp_multicast**
python-can의 UDP 멀티캐스트 기반 가상 버스. 여러 프로세스가 같은 그룹에 붙을 수 있지만 전달 보장은 없다.

**ELM327-emulator**
ELM327 어댑터와 ECU 응답을 흉내 내는 파이썬 패키지. TCP·시리얼·SLCAN 모드를 지원한다.

**Web Serial**
브라우저에서 사용자가 고른 직렬 포트를 여는 API. HTTPS/localhost, 사용자 제스처, 브라우저 권한이 필요하다.

**Web Bluetooth / BLE GATT**
브라우저에서 BLE 기기의 GATT 서비스·특성에 접근하는 API. 블루투스 클래식 SPP는 직접 다루지 못한다.

**HIL (Hardware-in-the-Loop)**
실제 ECU를 실시간 시뮬레이션된 plant·I/O에 연결해 시험하는 방식. 재현성은 높지만 실제 도로·EMC를 대신하지 못한다.

**ASC / BLF / MF4**
CAN·측정 로그 형식. ASC는 Vector ASCII, BLF는 Vector 바이너리, MF4는 ASAM MDF 측정 데이터 컨테이너(확장자 `.mf4`)다.

**SQLite / InfluxDB / TSDB**
SQLite는 파일 기반 SQL DB, InfluxDB는 시계열 DB(TSDB)다. CAN 로그 저장·질의에 쓴다.

**SOME/IP**
AUTOSAR의 서비스 지향 미들웨어. RPC·이벤트·직렬화를 제공하고 UDP/TCP 위에서 동작한다.

**DoIP (Diagnostics over IP)**
ISO 13400-2의 IP 기반 진단. 차량 이더넷에서 TCP/UDP 13400 포트를 쓴다.

**CAN XL**
ISO 11898-1:2024의 CAN 세대. 1~2048바이트 데이터, 11비트 우선순위 ID + 32비트 수용 필드, 두 개의 CRC를 갖는다.

**SIC (Signal Improvement Capability)**
CAN FD/XL의 고속 데이터 구간에서 신호 품질을 개선하는 트랜시버 기능. CAN XL은 SIC XL 트랜시버로 20Mbps 이상을 겨냥한다.

**샘플 포인트(sample point)**
CAN 비트 시간에서 수신기가 레벨을 읽는 지점. 보통 PS1이 끝나는 지점이며, 버스 길이·지연·클록 오차로 계산한다.

**Error Active / Error Passive**
CAN 노드의 오류 상태. TEC/REC ≤127이면 Active(6 dominant 오류 플래그), 127 초과면 Passive(6 recessive)다.

## A.7 TypeScript·Node.js

**타입 제거(type stripping)**
Node.js가 TypeScript 파일에서 타입 문법만 지우고 JavaScript로 실행하는 기능. Node 24.12부터 안정. 타입 검사는 하지 않으며 `tsconfig.json`을 읽지 않는다.

**`erasableSyntaxOnly`**
TypeScript 컴파일러 옵션. `enum`, 생성자 매개변수 프로퍼티처럼 런타임 코드를 만들어 내는 문법을 오류로 만든다. Node의 타입 제거 모드에서 실행 가능한 코드만 남기기 위해 쓴다.

**판별 유니온(discriminated union)**
공통 필드(예: `kind`)의 값으로 여러 타입 중 하나를 구분하는 TypeScript 타입. `ElmResponse`의 `ok`/`no-data`/`error`처럼 응답 종류를 안전하게 나눌 때 쓴다.

**`serialport`**
Node.js에서 시리얼 포트를 여는 npm 패키지. `SerialPort`, `data` 이벤트, `write`/`drain`, `SerialPortMock`을 제공한다. v13은 Node 20 이상을 요구한다.

**`socketcan`**
Linux SocketCAN을 Node.js에서 쓰는 npm 패키지. `createRawChannel`, `onMessage`, `send`, `start/stop`을 제공한다. Linux 전용이며 Windows에서는 쓸 수 없다.

**SSE(Server-Sent Events)**
HTTP 응답을 `text/event-stream`으로 유지하며 서버에서 클라이언트로 이벤트를 보내는 방식. 단방향이며, 브라우저의 `EventSource`가 재연결을 담당한다.

**`EventSource`**
SSE를 구독하는 브라우저 API. `retry:`로 재연결 간격을 정하고, `id:`/`Last-Event-ID`로 마지막 이벤트를 추적할 수 있다. HTTP/1.1에서는 브라우저+도메인당 연결 수 제한(6개)을 고려한다.

**백프레셔(backpressure)**
생산자가 소비자보다 빠를 때 데이터를 밀어 넣지 않고 기다리거나 버리는 정책. Node HTTP에서는 `response.write()`가 `false`를 돌려주면 `drain`까지 기다린다. 이 책의 대시보드는 느린 SSE 클라이언트에 중간 표본을 버리고 최신값만 보낸다.

**`node:sqlite`**
Node.js에 내장된 SQLite 모듈. `DatabaseSync`로 동기 연결을 열고 `exec`, `prepare`, `run`, `all`을 쓴다. Node 24.15 기준 Stability 1.2(Release candidate)다.

## A.8 Rust와 펌웨어 심화

**`no_std`**
표준 라이브러리(`std`) 없이 `core`만 쓰는 Rust 환경. OS·파일 시스템·힙 할당자를 전제하지 않는다.

**소유권(ownership)**
Rust에서 값마다 소유자가 하나이고, 소유자가 스코프를 벗어나면 값이 drop되는 규칙. 이동 후 원래 변수를 쓸 수 없다.

**빌림(borrow)**
소유권을 넘기지 않고 `&T`/`&mut T`로 값을 참조하는 것. 공유 참조 여러 개 또는 가변 참조 하나만 허용된다.

**`embedded-hal`**
MCU에 독립적인 HAL trait 모음. 1.0.0은 2024-01-09에 릴리스되었다. `SpiBus`, `OutputPin`, `I2c` 등이 있다.

**Embassy**
임베디드용 async 실행기. 힙 없이 정적 Future를 poll하고, 인터럽트/타이머 waker로 깨운다. 협조적 스케줄링이라 긴 블로킹은 다른 태스크를 막는다.

**`esp-hal`**
Espressif이 공식 지원하는 no_std HAL. 2026-10-29 기준 1.2.2(2026-09-18)이며, ESP32는 rev 3.0 이상만 지원한다. Xtensa 타깃은 `espup`이 필요하다.

**`esp-idf-hal` / `esp-idf-svc`**
ESP-IDF를 Rust로 감싼 std 계열 crate. Wi-Fi·HTTP·MQTT·NVS·OTA 같은 서비스를 제공하며, ESP-IDF 버전을 따라간다.

**Future / waker**
`async fn`이 만드는 미완료 작업과, 그 작업을 다시 poll하라고 executor에 알리는 핸들. JavaScript의 Promise/이벤트 루프에 대응한다.

## A.9 차량 보안

**위협 모델(threat model)**
자산·진입점·신뢰 경계·공격자 능력·영향·완화책을 정리하는 작업. "무엇을 지키고, 어디서 들어오며, 무엇을 겹쳐 막을 것인가"를 문서화한다.

**신뢰 경계(trust boundary)**
한쪽에서 온 데이터를 다른 쪽에서 신뢰하기 시작하는 경계. 차량에서는 텔레매틱스/IVI와 안전-critical 도메인 사이, OBD 포트와 내부 버스 사이가 대표적이다.

**MAC (Message Authentication Code)**
키를 가진 주체만 만들 수 있는 인증 태그. 무결성과 데이터 출처를 보장하지만, 기밀성(암호화)은 제공하지 않는다.

**HMAC (Hash-based MAC)**
암호학적 해시(SHA-256 등)와 비밀 키로 만드는 MAC. 이 책의 가상 실습은 HMAC-SHA256을 잘라 쓴다. 실제 SecOC는 AES-128 CMAC을 쓴다.

**CMAC (Cipher-based MAC)**
블록 암호(AES 등)를 기반으로 만드는 MAC. AUTOSAR SecOC는 AES-128 CMAC을 쓴다.

**신선도 값(freshness value)**
메시지가 "지금 처음 온 것"인지 확인하는 값. 카운터·타임스탬프·트립 카운터 등으로 만들며, SecOC는 전체 값을 MAC 계산에 넣고 일부만 프레임에 실을 수 있다.

**재전송 공격(replay attack)**
정상 메시지를 녹음했다가 나중에 그대로 다시 보내는 공격. MAC만으로는 막을 수 없고, 신선도 값이 필요하다.

**SecOC (Secure Onboard Communication)**
AUTOSAR의 PDU 단위 인증 규격. Authentic I-PDU에 Authenticator(MAC)와 선택적 신선도 값을 붙여 진위·신선도를 검증한다. 기밀성은 범위가 아니다.

**잘라 낸 MAC(truncated MAC)**
프레임 공간을 아끼기 위해 MAC의 일부 비트만 싣는 것. SecOC Profile 1은 24비트, Profile 3은 28비트를 쓴다. 짧을수록 위조 확률이 커진다.

**게이트웨이(gateway)**
버스·도메인 사이의 프레임을 라우팅·필터링하는 ECU. 차량 보안에서는 allowlist, rate limit, 진단 방화벽, 로깅의 집행점이 된다.

**도메인 분리(domain separation)**
파워트레인·섀시·바디·인포테인먼트·텔레매틱스를 별도 버스/영역으로 나누는 설계. 한 영역의 침해가 다른 영역으로 번지는 것을 줄인다.

**IDS (Intrusion Detection System)**
차량 내부 네트워크의 이상을 탐지하는 시스템. 허용 ID, 주기, 클록 오차, payload 패턴, 전압 파형 등을 본다. 탐지는 차단이 아니다.

**CIDS (Clock-based IDS)**
주기 메시지의 도착 간격으로 ECU별 클록 오차를 지문처럼 학습해 위조·변조·마스커레이드를 탐지하는 연구. USENIX Security 2016에서 발표되었다.

**CSMS (Cyber Security Management System)**
UN R155가 요구하는 사이버보안 관리 체계. 위험 기반 프로세스, 거버넌스, 공급망 관리, 사고 탐지·대응, Fleet 모니터링을 포함한다.

**SUMS (Software Update Management System)**
UN R156가 요구하는 소프트웨어 업데이트 관리 체계. OTA의 안전·보안, 무결성·진위, RXSWIN, 롤백·안전 상태를 포함한다.

**ISO/SAE 21434**
도로 차량 E/E 시스템의 사이버보안 엔지니어링 표준. 개념·개발·생산·운영·유지·폐기 전 단계의 위험 관리 프로세스를 정의하며, 특정 기술을 강제하지 않는다.

**SecurityAccess (0x27) / Authentication (0x29)**
UDS의 진단 접근 통제 서비스. 0x27은 시드-키(공유 비밀) 기반 잠금 해제, 0x29는 인증서·도전-응답 기반 인증이다. 이 책은 실차에서 둘 다 보내지 않는다.

**APCE / ACR**
UDS 0x29 Authentication의 두 가지 개념. APCE는 PKI 인증서 교환, ACR은 사전 설치 키 기반 도전-응답이다.

**RXSWIN**
UN R156에서 요구하는 소프트웨어 식별자. 어떤 규정 승인에 어떤 소프트웨어가 관련되는지 추적한다.

**V-SOC (Vehicle Security Operations Center)**
차량 Fleet의 보안 경고·사고를 모니터링하고 대응하는 조직·체계. IDS 경고와 로그가 입력이 된다.

**SBOM (Software Bill of Materials)**
소프트웨어 구성 요소·버전·의존성 목록. 공급망 투명성과 취약점 추적에 쓴다.

**진단 방화벽(diagnostic firewall)**
OBD 포트·정비 도구가 접근할 수 있는 ECU·서비스·세션을 제한하는 정책. 누가·어디에·무엇을·언제·기록의 다섯 축으로 설계한다.

**심층 방어(defense in depth)**
구조(게이트웨이·분리), 인증(SecOC), 감시(IDS), 접근 통제(0x29), 업데이트(R156), 키 관리 등 여러 층을 겹치는 설계 원칙.

## A.10 CAN 상위 프로토콜(J1939·CANopen·NMEA 2000)

**J1939**
트럭·버스·건설기계·농기계의 CAN 기반 응용 프로토콜. 29비트 ID, PGN/SPN, 소스 주소, TP, DM1을 정의한다.

**PGN (Parameter Group Number)**
J1939에서 메시지 묶음을 나타내는 번호. EDP/DP/PF/PS로 구성되며, PDU1에서는 PS가 목적지 주소다.

**SPN (Suspect Parameter Number)**
J1939 PGN 안의 개별 신호 번호. 해상도·오프셋이 SPN마다 다르다. OBD-II PID와 비슷하지만 접근 방식이 다르다.

**PDU1 / PDU2**
J1939의 PGN 형식. PF < 240이면 PDU1(PS는 목적지 주소), PF ≥ 240이면 PDU2(PS는 그룹 확장)다.

**BAM (Broadcast Announce Message)**
J1939 TP의 broadcast 방식. TP.CM 제어 바이트 `0x20`, 목적지 `0xFF`, 패킷 간 50~200ms다.

**DM1 / DM2 / DM3**
J1939 진단 메시지. DM1은 활성 고장(주기 broadcast), DM2는 과거 고장(요청), DM3는 과거 고장 삭제(실차에서 보내지 않음)다.

**FMI (Failure Mode Identifier)**
J1939 DTC에서 고장의 종류를 나타내는 5비트 값. 정상 범위 위/아래, 전압 높음/낮음, 회로 열림 등이다.

**OC (Occurrence Count)**
J1939 DTC에서 같은 고장이 발생한 횟수를 나타내는 7비트 값. 127은 사용할 수 없음이다.

**CANopen**
CiA 301 기반의 산업용 CAN 응용 프로토콜. 11비트 ID, 객체 사전, NMT, SDO, PDO를 쓴다.

**객체 사전(Object Dictionary, OD)**
CANopen 장치가 제공하는 값·설정의 표. 16비트 index와 8비트 subindex로 접근한다.

**EDS (Electronic Data Sheet)**
CANopen 객체 사전을 텍스트로 표현한 파일. 웹의 OpenAPI 문서에 해당한다.

**NMT (Network Management)**
CANopen 노드의 상태 기계. Initialisation, Pre-operational, Operational, Stopped가 있다.

**SDO (Service Data Object)**
CANopen의 요청/응답 객체 접근. `0x600+NodeID` 요청, `0x580+NodeID` 응답을 쓴다.

**PDO (Process Data Object)**
CANopen의 주기·이벤트 데이터. 객체를 매핑해 최대 8바이트(클래식 CAN)로 보낸다.

**COB-ID (Communication Object Identifier)**
CANopen 통신 객체의 CAN ID. 기능(NMT/SDO/PDO/EMCY)과 노드 ID가 함께 들어간다.

**하트비트(heartbeat)**
CANopen 노드가 `0x700+NodeID`로 보내는 생존 신호. 상태 바이트와 토글 비트가 들어 있다.

**EMCY (Emergency)**
CANopen 노드가 오류를 알리는 메시지. COB-ID는 `0x080+NodeID`다.

**NMEA 2000**
선박 전자장비의 CAN 기반 네트워크. IEC 61162-3이며 ISO 11783/J1939 데이터링크를 쓴다. 250kbps, 50노드, 120Ω 종단.

**fast packet**
NMEA 2000의 큰 메시지 전송. 첫 프레임 6바이트, 연속 프레임 7바이트, 최대 223바이트다.

**NMEA PGN**
NMEA 2000의 PGN 사전. J1939와 번호 체계를 공유하지만 같은 번호가 같은 의미라는 보장은 없다.
