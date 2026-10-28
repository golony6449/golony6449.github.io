# 부록 C. 참고 자료

이 책을 쓰면서 확인한 자료를 정리한다. 접속일은 2026-10-28이다. 표준 원문(SAE J1979, ISO 15765-2, ISO 14229 등)은 유료이므로, 이 책은 공개된 2차 자료와 필자의 실차 기록을 함께 사용했다. 2차 자료의 해석이 표준 원문과 다를 수 있으므로, 실제 구현에서는 해당 표준을 확인한다.

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
- Microsoft WSL, issue #11994 "CAN Bus/USBCAN(canable) support" — 기본 WSL2 커널의 CAN/vcan 지원 요청(열림). <https://github.com/microsoft/WSL/issues/11994>
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
