# 부록 C. 참고 자료

본문에서 **문헌 기반**으로 표시한 내용의 출처다.

## 프로젝트

- 원본 레포(개발 기준 문서 `CLAUDE.md`, 집필 노트 `docs/journal/`): <https://github.com/golony6449/thermostat-esp32>

## Matter와 ESP32

- Espressif, Arduino ESP32 Matter Thermostat 예제: <https://docs.espressif.com/projects/arduino-esp32/en/latest/matter/ep_thermostat.html>
- OpenCalido, DIY ESP32 Matter 온도조절기(M5Dial): <https://lucasplacentino.github.io/OpenCalido>
- Random Nerd Tutorials, ESP32 Matter 온습도 센서(Matter over Wi-Fi 설명): <https://randomnerdtutorials.com/?p=230448>

## 보드

- Waveshare, ESP32-S3-Touch-LCD-4.3B 제품 정보: <https://www.waveshare.com/esp32-s3-touch-lcd-4.3b.htm>
- Waveshare 문서, ESP32-S3-Touch-LCD-4.3B: <https://docs.waveshare.com/ESP32-S3-Touch-LCD-4.3B>
- 같은 보드의 점검과 Arduino 환경: 이 사이트의 [『웹 개발자의 ESP32 도전기』](https://golony6449.github.io/esp32/)

## SmartThings

- SmartThings Community, tado° 온도조절기가 Matter로 온도 센서로만 인식된 사례: <https://community.smartthings.com/t/tado-wireless-smart-thermostat-x-matter-only-detected-as-a-temperature-sensor-on-smartthings/306284>
- 삼성닷컴, 싱스원 스마트 홈 허브(WWST 인증 안내): <https://www.samsung.com/sec/smartthings-accessories/IM6001-V4P03/IM6001-V4P03/>
- 삼성닷컴, Aqara 스마트 조명 스위치 1구(중성선 불필요): <https://www.samsung.com/sec/smartthings-accessories/Switch-WS-KRC01/WS-KRC01>
- 삼성 커뮤니티, 이너릴레이 Zigbee 설치 후기: <https://r1.community.samsung.com/t5/smartthings/%ED%9B%84%EA%B8%B0-%ED%8C%81-%EC%88%98%EB%8F%99-%EB%B2%BD%EC%8A%A4%EC%9C%84%EC%B9%98-%EC%8A%A4%EB%A7%88%ED%8A%B8%ED%95%98%EA%B2%8C-%EB%A7%8C%EB%93%9C%EB%8A%94-%EB%B0%A9%EB%B2%95-%EC%9D%B4%EB%84%88%EB%A6%B4%EB%A0%88%EC%9D%B4-zigbee-%ED%99%9C%EC%9A%A9%ED%95%98%EA%B8%B0/td-p/24316735>
- SmartThings PAT 24시간 만료 정리: <https://levelup.gitconnected.com/smartthings-api-taming-the-oauth-2-0-beast-5d735ecc6b24>

## 도구

- Arduino CLI 문서: <https://arduino.github.io/arduino-cli/>
- ESP32_Display_Panel(Waveshare 보드 화면·터치 드라이버): <https://github.com/esp-arduino-libs/ESP32_Display_Panel>
- LVGL 문서: <https://docs.lvgl.io/>
- ESP-IDF 이슈 #19070, RGB LCD 바운스 버퍼 EOF 카운터가 VSYNC 재시작에서 다시 맞춰지지 않는 버그: <https://github.com/espressif/esp-idf/issues/19070>
- ESP-IDF RGB LCD 드라이버 소스(`esp_lcd_panel_rgb.c`): <https://github.com/espressif/esp-idf/blob/master/components/esp_lcd/rgb/esp_lcd_panel_rgb.c>
- Arduino ESP32 3.3.13 릴리스: <https://github.com/espressif/arduino-esp32/releases/tag/3.3.13>
- WinLibs(Windows용 MinGW-w64 `g++`): <https://winlibs.com/>
- arduino-cli 1.6.0 빌더 소스(라이브러리 감지 캐시, 빌드 옵션, 오브젝트 재사용 판단): <https://github.com/arduino/arduino-cli/tree/v1.6.0/internal/arduino/builder>

- Claude 고객지원, 데이터 내보내기: <https://support.claude.com/en/articles/9450526-how-to-export-your-claude-data>
