# 부록 C. 참고 자료

이 책을 쓰면서 확인한 자료를 정리한다. 접속일은 2026-10-28~29이다. 표준 원문(SAE J1979, ISO 15765-2, ISO 14229 등)은 유료이므로, 이 책은 공개된 2차 자료와 필자의 실차 기록을 함께 사용했다. 2차 자료의 해석이 표준 원문과 다를 수 있으므로, 실제 구현에서는 해당 표준을 확인한다.

## C.1 OBD-II와 차량 진단

- Wikipedia, "OBD-II PIDs" — Mode 01 PID 공식, PID 지원 비트마스크, CAN 주소 7DF/7E0/7E8, DTC 인코딩. <https://en.wikipedia.org/wiki/OBD-II_PIDs>
- Wikipedia, "On-board diagnostics" — OBD-II 역사, J1962 16핀 커넥터, 5가지 신호 프로토콜, 서비스 01~0A. <https://en.wikipedia.org/wiki/On-board_diagnostics>
- CSS Electronics, "OBD2 PID table (SAE J1979)" — PID 요청/응답 예, 비트 시작·길이·스케일 표. <https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979>
- CSS Electronics, "CAN bus explained" — CAN 물리 계층, 프레임, 상위 프로토콜, 다중 버스. <https://www.csselectronics.com/pages/can-bus-simple-intro-tutorial>
- Elm Electronics, "ELM327 OBD to RS232 Interpreter" 데이터시트 — AT 명령, 프로토콜 번호, ISO-TP 처리, 오류 메시지. <https://www.elmelectronics.com/wp-content/uploads/2016/07/ELM327DS.pdf>
- Wikipedia, "ELM327" — 클론과 버전(v1.5는 실제 버전이 아님), 지원 프로토콜. <https://en.wikipedia.org/wiki/ELM327>
- Wikipedia, "Kia Sorento" — 3세대 UM(2014~), 2.2 CRDi 디젤 사양. <https://en.wikipedia.org/wiki/Kia_Sorento>

## C.2 CAN과 차량 네트워크

- Wikipedia, "CAN bus" — 차동 신호, 중재, 프레임, 오류 카운터, 종단. <https://en.wikipedia.org/wiki/CAN_bus>
- Wikipedia, "CAN FD" — 64바이트 페이로드, 데이터 구간 비트레이트, CRC. <https://en.wikipedia.org/wiki/CAN_FD>
- Wikipedia, "ISO 15765-2" — ISO-TP SF/FF/CF/FC, STmin, block size. <https://en.wikipedia.org/wiki/ISO_15765-2>
- Wikipedia, "Local Interconnect Network" — LIN의 단일 선, master/slave, 속도. <https://en.wikipedia.org/wiki/Local_Interconnect_Network>
- Linux kernel, "SocketCAN" — SocketCAN 개요와 CAN 네트워크 인터페이스. <https://www.kernel.org/doc/html/latest/networking/can.html>
- linux-can, "can-utils" — `candump`, `cansend`, `cangen`, `canbusload`. <https://github.com/linux-can/can-utils>
- CSS Electronics, "CAN DBC File Explained" — DBC 메시지·신호·바이트 순서·배율·오프셋 개념. <https://www.csselectronics.com/pages/can-dbc-file-database-intro>
- commaai, "opendbc" — 공개 DBC와 차량 신호 디코딩 예. <https://github.com/commaai/opendbc>

## C.3 UDS와 제조사 데이터

- Wikipedia, "Unified Diagnostic Services" — UDS 서비스 표, 부정 응답 형식, NRC 표. <https://en.wikipedia.org/wiki/Unified_Diagnostic_Services>
- ISO, "ISO 14229-1:2020 Unified diagnostic services" — UDS 표준 원문(유료). <https://www.iso.org/standard/72439.html>
- ISO, "ISO 15765-2:2016 Diagnostic communication over CAN" — ISO-TP 표준 원문(유료). <https://www.iso.org/standard/66574.html>
- OBDb, "Kia-Sorento" — 쏘렌토 제조사 PID/DID 정의(JSON). <https://github.com/OBDb/Kia-Sorento>
- OBDb, "Hyundai-Santa-Fe" — 같은 플랫폼의 DPF 매연량(`ED94`) 정의. <https://github.com/OBDb/Hyundai-Santa-Fe>
- OBDb, `Kia-Sorento` signalsets v3 default.json — `bix`, `mul`, `div`, `add`, `sign` 해석. <https://raw.githubusercontent.com/OBDb/Kia-Sorento/main/signalsets/v3/default.json>
- OBDb, `Hyundai-Santa-Fe` signalsets v3 default.json — `ED94` DPF soot mass 정의. <https://raw.githubusercontent.com/OBDb/Hyundai-Santa-Fe/main/signalsets/v3/default.json>

## C.4 도구와 코드

- python-can, "SocketCAN" — `can.Bus`, `can.Message`, SocketCAN 설정. <https://python-can.readthedocs.io/en/stable/interfaces/socketcan.html>
- python-can, "CAN over Serial / SLCAN" — Windows에서 `slcan` 인터페이스. <https://python-can.readthedocs.io/en/stable/interfaces/slcan.html>
- pySerial, "Short introduction" — `Serial`, `read`, `readline`, 포트 목록. <https://pyserial.readthedocs.io/en/latest/shortintro.html>
- uv, "uv documentation" — `uv init`, `uv add`, `uv run`. <https://docs.astral.sh/uv/>
- Flask, "Flask documentation" — 라우팅, JSON 응답, 개발 서버. <https://flask.palletsprojects.com/>
- paho-mqtt, "Python MQTT client" — `Client`, `publish`, `tls_set`. <https://pypi.org/project/paho-mqtt/>
- Raspberry Pi, "Configuration" — `dtoverlay=mcp2515-can0` 등 오버레이 설정. <https://www.raspberrypi.com/documentation/computers/configuration.html>
- Espressif, "ESP-IDF TWAI" — TWAI 드라이버, 비트 타이밍, 송수신, 오류 상태. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/twai.html>
- Espressif, "Arduino-ESP32 TWAI receive/transmit examples" — SN65HVD230, RX/TX 핀, listen-only 예. <https://github.com/espressif/arduino-esp32/tree/master/libraries/ESP32/examples/TWAI>
- Espressif, "ESP-IDF TWAI network example" — TWAI 네트워크, 120Ω 종단, 필터 예. <https://github.com/espressif/esp-idf/tree/master/examples/peripherals/twai/twai_network>
- Espressif, "Arduino-ESP32 WebServer example" — `WebServer`, `server.on`, `handleClient`. <https://github.com/espressif/arduino-esp32/tree/master/libraries/WebServer/examples/HelloServer>
- coryjfowler, "MCP_CAN_lib" — MCP2515 SPI-CAN 라이브러리, CS/INT·크리스탈 설정. <https://github.com/coryjfowler/MCP_CAN_lib>
- Texas Instruments, "SN65HVD230 3.3V CAN transceiver" 데이터시트 — 3.3V 전원·핀 기능. <https://www.ti.com/lit/ds/symlink/sn65hvd230.pdf>
- Arduino, "UNO R3" — 우노 R3 핀아웃과 SPI 핀(11/12/13). <https://docs.arduino.cc/hardware/uno-rev3/>
- cantools, "cantools documentation" — `database.load_file`, `decode_message`. <https://cantools.readthedocs.io/>

## C.5 안전·법·윤리

- Wikipedia, "Distracted driving" — 운전 중 휴대전화·기기 조작의 위험. <https://en.wikipedia.org/wiki/Distracted_driving>
- U.S. EPA, "Air Enforcement" — Clean Air Act의 tampering·defeat device 금지. <https://www.epa.gov/enforcement/air-enforcement>
- Wikipedia, "Diesel particulate filter" — DPF 재생, 강제 재생, 고온 위험. <https://en.wikipedia.org/wiki/Diesel_particulate_filter>
- Wikipedia, "Magnuson–Moss Warranty Act" — 미국 보증법의 tie-in 제한. <https://en.wikipedia.org/wiki/Magnuson%E2%80%93Moss_Warranty_Act>
- Wikipedia, "Vehicle emissions control" — 배출가스 제어 장치와 규제. <https://en.wikipedia.org/wiki/Vehicle_emissions_control>
- Wikipedia, "Load dump" — 발전기-배터리 분리 시 과도 전압과 12V 차량의 클램프 수준. <https://en.wikipedia.org/wiki/Load_dump>

## C.6 실차 기록

- 필자 실차 기록, 기아 쏘렌토 UM 2019년식 2.2 디젤, ELM327 v1.5 클론(CH340), 2026-10-25. 제어기 주소, 표준 PID 지원 수, `22` DID 응답, DPF·변속기·ESC 데이터, USB 끊김 사례를 포함한다. VIN은 기록하지 않았다.

## C.7 표준 원문

이 책의 설명은 다음 표준을 바탕으로 한다. 원문은 유료이므로 직접 인용하지 않았다.

- SAE J1979 / J1979-DA — E/E Diagnostic Test Modes, PID 정의.
- SAE J1979-2 — OBDonUDS, UDS 기반 OBD-II 서비스.
- SAE J1939-11/-14/-21/-71/-73/-81 — 상용차 CAN 물리·데이터링크·응용·진단·네트워크 관리.
- CiA 301 — CANopen application layer and communication profile.
- IEC 61162-3 — 선박 항해·무선 통신 장비의 디지털 인터페이스(NMEA 2000).
- ISO 11783 — 농림업 기계의 CAN 기반 네트워크.
- SAE J1962 — Diagnostic Connector.
- ISO 15765-2 — Diagnostic communication over CAN, transport protocol.
- ISO 15765-4 — Requirements for emissions-related systems.
- ISO 14229-1 — Unified diagnostic services, application layer.
- ISO 11898-1/-2 — CAN data link layer / high-speed physical layer.

표준의 조항 번호·최신 개정판은 구입 시점에 확인한다. 이 책의 `확인 필요` 표시는 표준 원문이나 제조사 문서로 확정하지 못한 값에 남아 있다.

## C.8 가상 CAN·브라우저·테스트·로그

- Linux kernel, "SocketCAN" — vcan 생성·제거, CAN 네트워크 인터페이스, 비트 타이밍. <https://www.kernel.org/doc/html/latest/networking/can.html> (C.2에 같은 출처)
- linux-can, "can-utils" — `candump`, `cansend`, `cangen`, `canplayer`, `can-calc-bit-timing`, `asc2log`/`log2asc`. <https://github.com/linux-can/can-utils> (C.2에 같은 출처)
- python-can, "Virtual" — virtual 인터페이스가 같은 파이썬 프로세스 안에서만 동작한다는 설명과 예제. <https://python-can.readthedocs.io/en/stable/interfaces/virtual.html>
- python-can, "UDP Multicast" — 여러 프로세스 사이의 가상 버스, 전달 보장 없음. <https://python-can.readthedocs.io/en/stable/interfaces/udp_multicast.html>
- python-can, "File IO" — `LogReader`/`Logger`, ASC/BLF/CSV/candump log/MF4/SQLite 지원. <https://python-can.readthedocs.io/en/stable/file_io.html>
- Ircama, "ELM327-emulator" — ELM327 4.0.0, TCP/시리얼/SLCAN, `scenario car`, 다중 ECU·UDS·ISO-TP. <https://github.com/Ircama/ELM327-emulator>, <https://pypi.org/project/ELM327-emulator/>
- Microsoft, WSL2-Linux-Kernel `arch/x86/configs/config-wsl` (linux-msft-wsl-6.18.y) — `CONFIG_CAN=m`, `CONFIG_CAN_VCAN=m` 확인. <https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.18.y/arch/x86/configs/config-wsl>
- Microsoft WSL, issue #11994 "CAN Bus/USBCAN(canable) support" — 구버전 WSL2 커널의 CAN/vcan 지원 요청. <https://github.com/microsoft/WSL/issues/11994>
- Microsoft WSL, issue #5533 "Add SocketCAN support" — 커스텀 WSL 커널에서 `CONFIG_CAN_VCAN=y`로 vcan을 쓰는 사례. <https://github.com/microsoft/WSL/issues/5533>
- MDN, "Web Serial API" — 보안 컨텍스트, 사용자 제스처, `requestPort()`, readable/writable. <https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API>
- MDN, "Serial: requestPort()" — USB/Bluetooth 서비스 클래스 필터, `allowedBluetoothServiceClassIds`. <https://developer.mozilla.org/en-US/docs/Web/API/Serial/requestPort>
- MDN, "SerialPort: open()" — `baudRate` 필수, 8N1 기본값. <https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/open>
- MDN, "Web Bluetooth API" — BLE GATT, 보안 컨텍스트, 사용자 제스처. <https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API>
- MDN browser-compat-data, `api/Serial.json`, `api/Bluetooth.json` — 2026-10 기준 브라우저 지원 버전. <https://github.com/mdn/browser-compat-data>
- Microchip, "AN754: Understanding Microchip's CAN Module Bit Timing" — TQ, SyncSeg/PropSeg/PS1/PS2, 샘플 포인트, SJW. <https://ww1.microchip.com/downloads/en/Appnotes/00754.pdf>
- Kvaser, "CAN Protocol Tutorial" — 오류 프레임, TEC +8, ACK 오류와 Error Passive, 파형. <https://www.kvaser.com/can-protocol-tutorial/>
- Bosch, "CAN Specification Version 2.0" (1991) — 오류 카운터·오류 프레임·스터핑의 원전. 공개 PDF 사본이 여러 곳에 있으나, 인용은 원문 기준.
- CiA, "CAN XL" — 1~2048바이트, 11비트 priority ID + 32비트 AF, PCRC/FCRC, ISO 11898-1:2024, SIC XL/PWM 20Mbps+. <https://www.can-cia.org/can-knowledge/can-xl>
- ISO, "ISO 11898-1:2024 Road vehicles — Controller area network (CAN)" — CAN CC/FD/XL 데이터링크 계층 표준(유료).
- IEEE, "802.3bw-2015 100BASE-T1", "802.3bp-2016 1000BASE-T1", "802.3cg-2019 10BASE-T1S" — 차량용 이더넷 PHY 표준(유료).
- AUTOSAR, "SOME/IP Protocol Specification" — RPC·이벤트·직렬화, UDP/TCP 바인딩. <https://www.autosar.org/fileadmin/standards/R22-11/FO/AUTOSAR_PRS_SOMEIPProtocol.pdf>
- ISO, "ISO 13400-2:2019 Diagnostic communication over Internet Protocol (DoIP)" — IP 기반 진단, TCP/UDP 13400(유료).
- asammdf, "asammdf documentation" — MDF4 읽기/쓰기, 채널·단위·메타데이터. <https://asammdf.readthedocs.io/en/master/>
- InfluxData, "Line protocol" — measurement/tag/field/timestamp, 카디널리티. <https://docs.influxdata.com/influxdb/v2/reference/syntax/line-protocol/>
- SQLite, "SQLite Documentation" — 파일 DB, WAL, SQL. <https://www.sqlite.org/docs.html>
- pytest, "pytest documentation" — fixture, parametrize, approx. <https://docs.pytest.org/en/stable/>
- Wikipedia, "Hardware-in-the-loop simulation" — plant simulation, 실시간성, ECU·I/O. <https://en.wikipedia.org/wiki/Hardware-in-the-loop_simulation>

## C.9 TypeScript·Node.js

- Node.js, "Modules: TypeScript" — Node 24.12부터 타입 제거 안정, `tsconfig.json` 무시, `enum`·매개변수 프로퍼티 제한. <https://nodejs.org/docs/latest-v24.x/api/typescript.html>
- TypeScript, "TSConfig Reference: erasableSyntaxOnly" — 런타임 의미가 있는 TypeScript 문법을 오류로 처리. <https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly>
- Node.js, "SQLite" — `DatabaseSync`, `exec`/`prepare`/`run`/`all`, Node 24.15 기준 Stability 1.2(Release candidate). <https://nodejs.org/docs/latest-v24.x/api/sqlite.html>
- Node.js, "HTTP" — `response.write()`의 반환값과 `'drain'` 이벤트(백프레셔). <https://nodejs.org/docs/latest-v24.x/api/http.html>
- SerialPort, "Node SerialPort" — `SerialPort`, `data` 이벤트, `SerialPortMock`, 패키지 저장소. <https://github.com/serialport/node-serialport>
- SerialPort, "serialport 13.0.0 release" — Node 16/18 지원 중단, Node 20 이상 요구. <https://github.com/serialport/node-serialport/releases/tag/v13.0.0>
- SerialPort, "serialport API docs" — `SerialPort`, `SerialPort.list()`, 파서. <https://serialport.io/docs/api-serialport/>
- sebi2k1, "node-can (socketcan)" — Linux SocketCAN, `createRawChannel`, `onMessage`, `send`, `start/stop`. <https://github.com/sebi2k1/node-can>
- node-can, "CHANGELOG" — 4.3.2(2026-10-03), 4.1.0의 N-API 전환, 4.3.1의 `ENETDOWN`/`ENOBUFS` 복구. <https://github.com/sebi2k1/node-can/blob/master/CHANGELOG.md>
- MDN, "EventSource" — `text/event-stream`, 단방향 스트림, HTTP/1.1 연결 수 제한. <https://developer.mozilla.org/en-US/docs/Web/API/EventSource>
- MDN, "Using server-sent events" — `data`/`id`/`retry` 필드, 주석(`:`) keep-alive. <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>
- Ircama, "ELM327-emulator" — TCP `-n 35000`, `scenario car`, 다중 PID, Windows에서 com0com 없이 TCP 사용. <https://github.com/Ircama/ELM327-emulator> (C.8에 같은 출처)

## C.10 펌웨어·FreeRTOS·Rust

접속일은 2026-10-29이다. ESP-IDF 문서는 stable(작성 시점 v6.1 계열)과 v5.4를 함께 확인했다. 이 책의 16·18장 코드는 v5.x의 legacy TWAI API를 기준으로 한다.

- Espressif, "ESP-IDF v5.4 TWAI" — legacy `driver/twai.h` API, 드라이버 상태, RX 큐, 경보 플래그, `twai_initiate_recovery()`, 상태 정보. <https://docs.espressif.com/projects/esp-idf/en/v5.4/esp32/api-reference/peripherals/twai.html>
- Espressif, "ESP-IDF TWAI (stable)" — v6.x의 `twai_node_*` API, 콜백 기반 수신, `twai_node_recover()`, 버스오프 복구. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/twai.html>
- Espressif, "FreeRTOS (IDF)" — `xTaskCreatePinnedToCore`, 스택 바이트 단위, `uxTaskGetStackHighWaterMark`, `xTaskDelayUntil`, SMP 스케줄링. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos_idf.html>
- Espressif, "FreeRTOS Overview" — ESP-IDF FreeRTOS 구성, 시작 태스크 우선순위, 힙 통합. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos.html>
- Espressif, "Watchdogs" — Task Watchdog Timer(TWDT) `esp_task_wdt_init/add/reset/delete`, Interrupt Watchdog. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/wdts.html>
- Espressif, "Sleep Modes" — deep/light sleep, timer/touch/ext0/ext1/ULP 깨우기, RTC GPIO 신호 폭. <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/sleep_modes.html>
- Espressif, "ESP32 Series Datasheet v5.3" — 전력 모드 표(light sleep 0.8mA, deep sleep 10µA, ULP 150µA, hibernation 5µA). <https://documentation.espressif.com/esp32_datasheet_en.pdf>
- Texas Instruments, "SN65HVD230/231/232 3.3-V CAN Bus Transceivers" (SLOS346O, 2018) — standby 370µA 일반/600µA 최대, 정상 10mA 일반/17mA 최대, Rs 핀, wake 0.55µs. <https://www.ti.com/lit/ds/symlink/sn65hvd230.pdf>
- Wikipedia, "On-board diagnostics" — OBD-II 16핀 커넥터, 16번 배터리 전원, 6/14번 CAN. <https://en.wikipedia.org/wiki/On-board_diagnostics> (C.1에 같은 출처)
- FreeRTOS, "FreeRTOS-Kernel-Book ch07" — 큐 생성·복사, `xQueueSendFromISR`, `pxHigherPriorityTaskWoken`, `portYIELD_FROM_ISR`. <https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch07.md>
- FreeRTOS, "FreeRTOS-Kernel-Book ch08" — 뮤텍스, 우선순위 역전·상속, 중첩 뮤텍스, 게이트키퍼 태스크. <https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch08.md>
- FreeRTOS, "queue.h" — 큐 API 선언과 문서 주석. <https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/queue.h>
- cppreference, "volatile" — `volatile`의 보장과 한계(원자성·동기화·메모리 순서 없음). <https://en.cppreference.com/w/c/language/volatile>
- cppreference, "memory_order" — relaxed/acquire/release/acq_rel/seq_cst, SPSC 링 버퍼의 release/acquire 쌍. <https://en.cppreference.com/w/c/atomic/memory_order>
- Rust, "The Rust Programming Language, ch04-01 Ownership" — 소유권 규칙, 이동, double free. <https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html>
- Rust Embedded, "Concurrency" — `static mut`, 임계 구역, 원자 연산, `Send`/`Sync`, 뮤텍스. <https://docs.rust-embedded.org/book/concurrency/>
- Rust Embedded, "Panicking" — `#[panic_handler]`, panic-halt/abort/semihosting. <https://docs.rust-embedded.org/book/start/panicking.html>
- embedded-hal, "embedded-hal 1.0.0" — HAL trait, `digital`/`i2c`/`spi`/`pwm`/`delay`, serial은 `embedded-io`. <https://docs.rs/embedded-hal/latest/embedded_hal/>
- Embassy, "Embassy Book" — async/await, Future, executor, waker, no heap/static tasks. <https://embassy.dev/book/>
- Embassy, "embassy-executor 0.10.0" — 정적 태스크, no alloc, CPU sleep, 공정 스케줄링. <https://docs.embassy.dev/embassy-executor/>
- esp-rs, "esp-hal README" — 지원 칩·타깃, MSRV 1.95.0, 주변장치 성숙도, ESP32 rev 3.0 이상. <https://github.com/esp-rs/esp-hal>
- esp-rs, "esp-hal 1.2.2 docs" — no_std HAL, embedded-hal/embedded-hal-async trait 구현. <https://docs.rs/esp-hal/latest/esp_hal/>
- Espressif, "Rust on ESP Book: Toolchain Installation" — Xtensa는 espup, RISC-V는 rustup. <https://docs.espressif.com/projects/rust/book/getting-started/toolchain.html>
- esp-rs, "espup" — Xtensa Rust 포크·LLVM·GCC 링커 설치. <https://github.com/esp-rs/espup>
- esp-rs, "esp-idf-hal" — ESP-IDF 드라이버를 감싼 std HAL, embedded-hal 0.2/1.0 trait. <https://github.com/esp-rs/esp-idf-hal>
- esp-rs, "esp-idf-svc" — Wi-Fi·HTTP·MQTT·NVS·OTA 서비스 래퍼. <https://docs.rs/esp-idf-svc/>

## C.11 차량 보안

접속일은 2026-10-29이다. UN 규정·표준 원문은 무료 공개본과 유료 표준을 구분해 표기했다. 규정의 적용 일정은 국가·형식 승인별로 다르므로, 실제 판단에서는 해당 인증기관 문서를 확인한다.

- UN Treaty Collection, "UN Regulation No. 155" — 2020-06-24 채택, 2021-01-22 발효, 등록번호 4789. <https://treaties.un.org/doc/Publication/MTDSG/Volume%20I/Chapter%20XI/XI-B-16-155.en.pdf>
- UN Treaty Collection, "UN Regulation No. 156" — 2020-06-24 채택, 2021-01-22 발효. <https://treaties.un.org/doc/Publication/MTDSG/Volume%20I/Chapter%20XI/XI-B-16-156.en.pdf>
- UNECE, "Three landmark UN vehicle regulations enter into force" — R155·R156·R157의 2021-01-22 발효. <https://unece.org/media/transport/Intelligent-Transport-Systems/press/352397>
- UNECE, "UN Regulations on Cybersecurity and Software Updates to pave the way for mass roll out of connected vehicles" — R155·R156의 도입 배경·요구, EU 적용 일정(2020년 원문 기준 범위). R155의 범위는 2025년 Supplement 3에서 L 범주까지 확대되었다(아래 EUR-Lex). <https://unece.org/sustainable-development/press/un-regulations-cybersecurity-and-software-updates-pave-way-mass-roll>
- EUR-Lex, "UN Regulation No. 155 (2025/5)" — Supplement 3, 2025-01-10 발효, 적용 범위 L·M·N·O(ECU 1개 이상). <https://eur-lex.europa.eu/eli/reg/2025/5/oj>
- UK Vehicle Certification Agency, "Cyber Security and Software Updating" — R155·R156의 EU 적용일(2022-07-06 신규 형식, 2024-07-07 기존 형식), CSMS·SUMS 요구. <https://www.vehicle-certification-agency.gov.uk/connected-and-automated-vehicles/cyber-security-and-software-updating/>
- ISO, "ISO/SAE 21434:2021 Road vehicles — Cybersecurity engineering" — 2021-08-31 공표, 개념·개발·생산·운영·유지·폐기 전 단계의 위험 관리, 특정 기술 비강제. <https://www.iso.org/standard/70918.html>
- ISO, "ISO 14229-1:2020 Unified diagnostic services" — UDS 서비스와 0x29 Authentication(유료). <https://www.iso.org/standard/72439.html>
- AUTOSAR, "Specification of Secure Onboard Communication Protocol" (R22-11) — SecOC의 Authenticator·Freshness Value·잘라 낸 MAC, Profile 1/2/3의 MAC·FV 길이, AES-128 CMAC. <https://www.autosar.org/fileadmin/standards/R22-11/FO/AUTOSAR_PRS_SecOcProtocol.pdf>
- NHTSA, "Cybersecurity Best Practices for the Safety of Modern Vehicles" (2022 update) — 권고(비구속), 네트워크 분리·격리, 공유 버스의 메시지 인증·재전송 제한. <https://www.nhtsa.gov/sites/nhtsa.gov/files/2022-09/cybersecurity-best-practices-safety-modern-vehicles-2022-tag.pdf>
- Federal Register, "Cybersecurity Best Practices for the Safety of Modern Vehicles" (87 FR 55459, 2022-09-09) — 최종 지침의 범위·T.11 메시지 인증·[G]/[T] 항목. <https://www.federalregister.gov/documents/2022/09/09/2022-19507/cybersecurity-best-practices-for-the-safety-of-modern-vehicles>
- Charlie Miller·Chris Valasek, "Remote Exploitation of an Unaltered Passenger Vehicle" (Black Hat USA 2015) — 2014 Jeep Cherokee, Uconnect, 원격 경로, FCA 패치·140만 대 리콜·이동통신사 트래픽 차단. <http://illmatics.com/Remote%20Car%20Hacking.pdf>
- BBC News, "Fiat Chrysler recalls 1.4 million cars after Jeep hack" (2015-07-24) — 리콜 규모, USB·딜러 방문 패치. <https://www.bbc.com/news/technology-33650491>
- Kyong-Tak Cho·Kang G. Shin, "Fingerprinting Electronic Control Units for Vehicle Intrusion Detection" (USENIX Security '16) — CIDS, 주기 메시지 간격·클록 오차, RLS/CUSUM, 오탐률 0.055%, root-cause. <https://www.usenix.org/conference/usenixsecurity16/technical-sessions/presentation/cho>
- Diadrom, "Securing the diagnostic channel: ISO 21434, UN R155 and UDS 0x29" — 0x27 시드-키의 한계, 0x29의 인증서·상호 인증·역할·폐기. <https://diadrom.com/insights/securing-the-diagnostic-channel/>
- IETF RFC 2104, "HMAC: Keyed-Hashing for Message Authentication" — HMAC 구성. <https://www.rfc-editor.org/rfc/rfc2104>
- IETF RFC 8446, "The Transport Layer Security (TLS) Protocol Version 1.3" — TLS 1.3의 인증·기밀성·무결성. <https://www.rfc-editor.org/rfc/rfc8446>

## C.12 J1939·CANopen·NMEA 2000

접속일은 2026-10-29이다. SAE J1939·CiA 301·IEC 61162-3 원문은 유료이므로, 이 책은 공개 요약·공개 구현·제조사 공개 문서를 2차 근거로 사용했다. 실제 구현에서는 해당 표준의 개정판을 확인한다.

- SAE, "J1939: Serial Control and Communications Heavy Duty Vehicle Network" — J1939-11/-14(물리), -21(데이터링크·TP), -71(응용), -73(진단), -81(네트워크 관리) 표준 개요(유료). <https://www.sae.org/standards/content/j1939/>
- Linux kernel, "J1939" — `CAN_J1939` 소켓, PGN/SA/DA, PDU1/PDU2, 주소 클레임 250ms, TP/ETP 최대 크기. <https://docs.kernel.org/networking/j1939.html>
- CSS Electronics, "SAE J1939 Explained" — 29비트 ID, PGN/SPN, PDU1/PDU2, 트럭·건설기계 응용 개요. <https://www.csselectronics.com/pages/j1939-explained-simple-intro-tutorial>
- Copperhill Technologies, "Guide to SAE J1939 Transport Protocol (TP)" — TP.CM/TP.DT, BAM/RTS/CTS, 1785바이트, 7바이트 패킷, 0xFF 패딩. <https://copperhilltech.com/blog/guide-to-sae-j1939-transport-protocol-tp-message-packaging-and-reassembly-/>
- Simma Software, "J1939 Transport Protocol" — BAM/RTS/CTS, 패킷 간 50~200ms, 750ms 타임아웃. <https://simmasoftware.com/j1939-transport-protocol/>
- Simma Software, "J1939 DM1 vs DM2 Diagnostic Messages" — DM1 PGN 65226, DM2 PGN 65227, 램프 상태, SPN/FMI/OC/CM, 1초 주기. <https://simmasoftware.com/j1939-dm1-vs-dm2-diagnostic-messages/>
- Simma Software, "J1939 Source Address" — Engine #1 0x00, Transmission #1 0x03, null 0xFE, global 0xFF. <https://simmasoftware.com/products/j1939/source-address/>
- python-can-j1939, "SAE J1939 support for Python" — python-can 4.x에서 분리된 J1939 패키지. <https://github.com/juergenH87/python-can-j1939>
- CiA, "CANopen" — CiA 301 4.2.0, 11비트 CAN ID, 10k~1Mbit/s, 객체 사전 index 16비트·subindex 8비트, 1000h~1FFFh/2000h~5FFFh/6000h~9FFFh. <https://www.can-cia.org/can-knowledge/canopen/>
- canopen, "canopen documentation" — Network/Node, Object Dictionary, NMT, SDO, PDO, heartbeat, EDS. <https://canopen.readthedocs.io/en/latest/>
- canopen, "python-canopen" — LocalNode/RemoteNode, SDO client/server, PDO, NMT. <https://github.com/christiansandberg/canopen>
- NMEA, "NMEA 2000" — 선박 전자장비 네트워크, IEC 61162-3, NMEA 인증. <https://www.nmea.org/nmea-2000.html>
- Kvaser, "NMEA 2000" — 250kbit/s, 29비트 CAN, PGN, ISO 11783/J1939 기반. <https://kvaser.com/about-can/higher-layer-protocols/nmea-2000/>
- Warwick Control, "NMEA 2000 Introduction for Developers" — 250kbit/s, 50노드, 120Ω, PGN, fast packet, NMEA 인증 요구. <https://nmea2000.warwickcontrol.com/nmea2000/nmea2000-introduction-for-developers/>
- canboat, "NMEA 2000 PGN database" — PGN 60928/127250/129025/129029 필드·해상도, fast packet 223바이트. <https://canboat.github.io/canboat/canboat.html>
- IEC, "IEC 61162-3" — NMEA 2000의 국제 표준(유료). <https://webstore.iec.ch/>
- Wikipedia, "OBD-II PIDs" — PID 0x5B(하이브리드 배터리 잔량), PID 0x9A(배터리 전압·전류) 등 표준 PID 목록. <https://en.wikipedia.org/wiki/OBD-II_PIDs>
- SAE, "J1979-2 / J1979-DA" — OBDonUDS, PID/DID 디지털 부속 문서(유료). <https://www.sae.org/standards/content/j1979/2_202104/>
- UNECE, "Summary UNR154 LDV OBFCM technical exploration" — PEV 배터리 PID 0x5B/0x9A/0xB2/0xB7 정의와 규제 논의. <https://wiki.unece.org/download/attachments/265978082/Summary%20UNR154%20LDV%20OBFCM%20technical%20exploration%20-%20WLTP%20Ad-hoc.pdf>
- California Air Resources Board, "§ 1962.5 Data Standardization Requirements for 2026 and Subsequent Model Year Light-Duty Zero Emission Vehicles" — ZEV 배터리 데이터 표준화와 J1979-2/J1979-DA 참조. <https://ww2.arb.ca.gov/sites/default/files/2021-12/draft%20ZEV%20standardized%20data%201962.5.pdf>
- ISO, "ISO 11783" — 농림업 트랙터·기계의 CAN 기반 네트워크(유료). NMEA 2000·J1939 데이터링크의 참조 표준.
