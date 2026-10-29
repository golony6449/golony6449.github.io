# 20장 부트로더와 OTA 업데이트

## 이 장에서

지금까지 만든 ESP35 장치는 USB 케이블을 꽂고 `idf.py flash`나 Arduino IDE의 업로드 버튼을 누르는 방식으로 고쳤다. 책상 위에서는 그걸로 충분하다. 하지만 차에 꽂아 둔 장치, 옥상에 붙인 센서, 공장 바닥의 게이트웨이는 USB 케이블을 꽂으러 갈 수 없다. 웹 서버를 배포할 때 SSH로 들어가 파일을 고치지 않고 CI/CD와 블루·그린 배포를 쓰는 것처럼, 현장의 장치도 **네트워크로 안전하게 교체하고, 실패하면 되돌리는** 경로가 필요하다.

이 장의 주제는 **OTA(Over-The-Air) 업데이트**다. OTA는 "Wi-Fi로 파일을 받아 플래시에 쓴다"로 끝나지 않는다. 새 이미지가 정말 이 장치에 맞는지, 쓰는 도중 전원이 꺼지면 어떻게 되는지, 새 이미지가 부팅은 했지만 센서가 고장 났으면 어떻게 이전 버전으로 돌아가는지를 함께 설계해야 한다. 그 바닥에는 **부트로더와 파티션 테이블**이 있다.

웹 개발자에게 익숙한 대응은 다음과 같다.

| 웹 | 임베디드 |
|---|---|
| 블루·그린 배포 | A/B 파티션과 부팅 포인터 전환 |
| 롤백 | 이전 파티션으로 부팅, `otadata` 갱신 |
| 카나리 배포 | 장치 그룹별 단계적 OTA |
| 불변 이미지(immutable image) | 서명된 펌웨어 이미지, 버전·빌드 ID |
| 시크릿·키 관리 | Secure Boot 공개키, Flash 암호화 키, eFuse |
| 배포 후 헬스 체크 | 부팅 자체 시험, `esp_ota_mark_app_valid_cancel_rollback()` |

이 장에서 다루는 것:

- ESP32의 부팅 순서: ROM 부트로더 → 2단계 부트로더 → 앱
- 파티션 테이블과 `factory`·`ota_0`·`ota_1`·`otadata`
- A/B 업데이트의 쓰기·검증·부팅 전환 순서
- ESP-IDF OTA API와 HTTPS OTA
- 앱 롤백 상태 기계와 `esp_ota_mark_app_valid_cancel_rollback()`
- 이미지 서명·Secure Boot·Flash 암호화의 역할과 되돌릴 수 없는 위험
- 블루·그린·카나리 배포와의 대응, 현장 배포 체크리스트

**이 장의 경계:** Secure Boot와 Flash 암호화는 **개념과 위험만** 설명한다. eFuse를 굽는 명령, 키를 생성해 장치에 주입하는 절차, `idf.py`의 보안 설정 명령은 이 책에서 실행 예시로 제공하지 않는다. eFuse는 한 번 쓰면 되돌릴 수 없고, 잘못 설정하면 장치가 다시 부팅되지 않을 수 있다. 실제 적용은 전용 보드와 공식 문서, 키 보관·생산 절차를 갖춘 뒤에 한다.

## 20.1 부팅은 누가 시작하는가

ESP32는 전원이 들어오면 다음 순서로 부팅한다.

```text
전원 인가 / 리셋
  │
  ├─▶ 1단계: ROM 부트로더 (칩 내부 ROM, 고칠 수 없음)
  │      - 플래시 0x1000의 2단계 부트로더 헤더를 읽고 실행
  │      - 부트 모드(플래시 부팅/다운로드 부팅) 결정
  │
  ├─▶ 2단계 부트로더 (플래시 0x1000, ESP-IDF가 빌드)
  │      - 파티션 테이블(기본 0x8000) 읽기
  │      - Secure Boot/Flash Encryption 설정 확인
  │      - otadata를 보고 부팅할 앱 파티션 선택
  │      - 앱을 RAM으로 로드하고 제어를 넘김
  │
  └─▶ 앱 (factory 또는 ota_0/ota_1)
         - app_main() 실행
```

- **ROM 부트로더**는 칩 안에 있어 사용자가 바꿀 수 없다. 플래시의 2단계 부트로더를 읽어 실행하는 최소한의 일만 한다.
- **2단계 부트로더**는 ESP-IDF가 빌드해 플래시 `0x1000`에 쓴다. 파티션 테이블을 읽고, 앱을 고르고, 필요하면 서명·암호화를 확인한 뒤 앱으로 넘어간다.
- 앱은 파티션 테이블이 가리키는 주소에서 시작한다. 기본 파티션 테이블 오프셋은 `0x8000`이고, 첫 앱 파티션은 보통 `0x10000`에서 시작한다.

부팅 로그를 보면 파티션 표와 선택된 앱이 나온다. "부팅했는데 예전 펌웨어가 뜬다"는 문제는 대개 이 단계에서 **어느 파티션을 선택했는가**를 보면 풀린다.

### 부트로더가 하는 일을 코드로 착각하지 않기

앱 안의 `app_main()`은 부트로더가 아니다. 앱이 아무리 일찍 실행돼도, 파티션 선택과 이미지 검증은 이미 끝난 뒤다. 그래서 다음은 앱 코드로 할 수 없다.

- 파티션 테이블 자체를 바꾸기: 파티션 테이블은 플래시의 별도 영역이고, OTA는 앱 파티션에 쓴다. 파티션 배치를 바꾸려면 보통 시리얼 플래싱이나 별도의 부트로더·파티션 업데이트 절차가 필요하다.
- 부트로더 교체: OTA API는 앱 이미지를 대상으로 한다. 부트로더를 바꾸는 것은 더 위험한 별도 작업이다.
- 서명 검증을 앱에서 끄기: Secure Boot가 켜져 있으면 검증은 ROM과 부트로더가 한다. 앱이 아무리 `true`를 반환해도 검증을 건너뛰지 않는다.

이 경계를 알아야 "OTA로 다 고칠 수 있다"는 착각을 피할 수 있다. **파티션 배치와 부트로더는 앱 OTA의 범위 밖**이다.

## 20.2 파티션 테이블: 앱이 사는 방과 otadata

플래시를 방 몇 개로 나눈 것이 **파티션 테이블**이다. ESP-IDF의 기본 형식은 CSV다.

```text
# Name,   Type, SubType, Offset,   Size, Flags
nvs,      data, nvs,     0x9000,   0x4000,
otadata,  data, ota,     0xd000,   0x2000,
phy_init, data, phy,     0xf000,   0x1000,
factory,  app,  factory, 0x10000,  1M,
ota_0,    app,  ota_0,   0x110000, 1M,
ota_1,    app,  ota_1,   0x210000, 1M,
```

이 배치는 ESP-IDF 문서의 "two OTA slots" 예와 같은 모양이다. 4MB 플래시를 가정한 예이며, 실제 보드의 플래시 크기와 이미지 크기에 맞춰 조정한다.

| 파티션 | 타입 | 역할 |
|---|---|---|
| `nvs` | data/nvs | Wi-Fi 설정, 부팅 카운터, 장치 설정처럼 전원이 꺼져도 남길 값 |
| `otadata` | data/ota | 다음에 부팅할 OTA 슬롯을 기록하는 0x2000바이트(두 섹터) 영역 |
| `phy_init` | data/phy | RF 보정 데이터. 보통 0x1000 |
| `factory` | app/factory | 공장 기본 앱. OTA 데이터가 비어 있을 때의 폴백 |
| `ota_0` | app/ota_0 | OTA 슬롯 0 |
| `ota_1` | app/ota_1 | OTA 슬롯 1 |

- **앱 파티션 오프셋은 0x10000 경계에 맞춘다.** ESP-IDF 문서는 앱 오프셋이 0x10000의 배수가 아니면 오류라고 설명한다.
- **앱 파티션 크기는 0x1000 경계에 맞춘다.**
- `otadata`는 앱이 아니라 데이터 파티션이다. 부트로더가 읽고, OTA API가 갱신한다.
- `factory`가 없어도 된다. 그 경우 OTA 데이터가 비어 있으면 첫 OTA 슬롯을 부팅한다.
- `nvs`는 최소 0x3000 이상을 권장한다. 기본 two-OTA 레이아웃에서는 0x4000을 쓴다.
- 파티션 이름은 16바이트(널 포함) 제한이 있다. 길면 잘린다.

### 파티션 크기와 이미지 크기

앱 이미지는 파티션 크기보다 작아야 한다. 빌드 결과의 `.bin` 크기를 확인하고, OTA 슬롯 크기에 여유를 둔다. 이미지가 커지면 쓰는 도중 `esp_ota_write()`가 `ESP_ERR_INVALID_SIZE`(파티션 경계 초과)로 실패할 수 있다. `ESP_ERR_OTA_VALIDATE_FAILED`는 magic byte가 틀리거나 `esp_ota_end()`에서 이미지·서명 검증이 실패했을 때다.

```bash
# 빌드 결과의 앱 이미지 크기 확인(예)
idf.py size
ls -l build/*.bin
```

- `factory`와 `ota_0`/`ota_1`의 크기가 다르면, OTA 이미지가 더 작은 슬롯에 들어가는지 확인한다.
- 파티션 테이블을 바꾸면 기존 `otadata`와 `nvs`의 위치가 달라질 수 있다. 현장 장치의 파티션 배치를 바꾸는 업데이트는 앱 OTA만으로 해결되지 않는다.
- `coredump`나 파일 시스템 파티션을 추가하면 앱 슬롯이 줄어든다. 21장의 크래시 덤프를 쓰려면 그 공간을 미리 계산한다.

## 20.3 A/B 업데이트의 순서

A/B 업데이트는 **현재 실행 중인 슬롯을 건드리지 않고**, 반대쪽 슬롯에 새 이미지를 쓴 뒤 부팅 선택만 바꾸는 방식이다.

```text
1. 현재 ota_0에서 v1 실행 중
2. 새 이미지 v2를 ota_1에 쓴다 (ota_0은 그대로)
3. v2 이미지의 헤더·체크섬·서명을 검증한다
4. otadata가 다음 부팅으로 ota_1을 가리키게 한다
5. 재부팅 → 부트로더가 ota_1의 v2를 실행
6. 앱이 자체 시험(센서·통신·설정)을 통과하면 v2를 VALID로 표시
7. 실패하면 이전 ota_0의 v1으로 롤백
```

핵심은 **쓰기와 부팅 선택을 분리**하는 것이다.

- 쓰는 동안에는 현재 앱이 계속 실행된다. 전원이 끊겨도 현재 앱은 멀쩡하다.
- 이미지 검증이 끝난 뒤에만 `otadata`를 바꾼다. 그 전에 전원이 끊기면 새 이미지는 선택되지 않는다.
- 새 이미지가 부팅에 실패하거나 자체 시험에서 실패하면 이전 슬롯으로 돌아간다.

이 구조는 웹의 블루·그린 배포와 닮았다. 블루 환경이 살아 있는 동안 그린 환경에 새 버전을 배포하고, 준비가 끝나면 트래픽을 그린으로 돌린다. 문제가 생기면 블루로 되돌린다. 다른 점은 **로드밸런서 대신 부트로더가 트래픽을 돌린다**는 것과, 장치에는 사람이 지켜보는 운영자가 없다는 것이다. 그래서 자체 시험과 자동 롤백이 더 중요하다.

## 20.4 ESP-IDF OTA API

ESP-IDF의 OTA API는 `esp_ota_ops.h`에 있다. 핵심 함수는 다음과 같다.

| 함수 | 역할 |
|---|---|
| `esp_ota_get_next_update_partition(NULL)` | 다음에 쓸 OTA 슬롯을 고른다. 보통 현재 실행 중이 아닌 슬롯 |
| `esp_ota_begin(partition, size, &handle)` | 대상 파티션을 지우고 OTA 세션을 시작한다 |
| `esp_ota_write(handle, data, size)` | 이미지 데이터를 순서대로 쓴다 |
| `esp_ota_end(handle)` | 이미지 검증을 마치고 핸들을 해제한다 |
| `esp_ota_set_boot_partition(partition)` | 다음 부팅 파티션을 지정하고 `otadata`를 갱신한다 |
| `esp_ota_get_running_partition()` | 현재 실행 중인 파티션을 돌려준다 |
| `esp_ota_get_boot_partition()` | 다음 부팅에 선택될 파티션을 돌려준다 |
| `esp_ota_get_state_partition(partition, &state)` | 파티션의 OTA 상태를 읽는다 |
| `esp_ota_mark_app_valid_cancel_rollback()` | 현재 앱을 정상으로 표시하고 롤백을 취소한다 |
| `esp_ota_mark_app_invalid_rollback_and_reboot()` | 현재 앱을 실패로 표시하고 이전 앱으로 재부팅한다 |
| `esp_ota_abort(handle)` | 진행 중인 OTA를 중단한다 |

다음은 네트워크에서 이미지를 스트리밍해 쓰는 뼈대다. `read_chunk()`는 실제 HTTP 클라이언트나 파일 읽기로 바꿔야 한다. **ESP32 실물에서 확인해야 하는 코드**다.

```c
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "esp_log.h"

static const char *TAG = "ota";

/* 애플리케이션이 제공하는 읽기 함수라고 가정한다. */
static int read_chunk(uint8_t *buf, size_t cap);

esp_err_t apply_ota(void) {
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);
    if (update == NULL) {
        ESP_LOGE(TAG, "no OTA partition");
        return ESP_ERR_NOT_FOUND;
    }

    esp_ota_handle_t handle = 0;
    esp_err_t err = esp_ota_begin(update, OTA_SIZE_UNKNOWN, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "begin: %s", esp_err_to_name(err));
        return err;
    }

    uint8_t buf[1024];
    int n;
    while ((n = read_chunk(buf, sizeof(buf))) > 0) {
        err = esp_ota_write(handle, buf, (size_t)n);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "write: %s", esp_err_to_name(err));
            esp_ota_abort(handle);
            return err;
        }
    }
    if (n < 0) {
        esp_ota_abort(handle);
        return ESP_FAIL;
    }

    err = esp_ota_end(handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "end: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_ota_set_boot_partition(update);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "set boot: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "OTA written, restarting");
    esp_restart();
    return ESP_OK;
}
```

- `esp_ota_begin()`은 대상 파티션을 지운다. **현재 실행 중인 파티션을 대상으로 잡으면 안 된다.** `esp_ota_get_next_update_partition(NULL)`이 보통 안전한 슬롯을 골라 준다.
- `esp_ota_write()`는 순서대로 쓴다. 중간에 점프하거나 덮어쓰는 방식은 별도 API(`esp_ota_write_with_offset`)가 필요하다.
- `esp_ota_end()`는 이미지의 유효성을 검사한다. 이 단계에서 실패하면 부팅 파티션을 바꾸지 않는다.
- `esp_ota_set_boot_partition()`은 이미지 검증과 `otadata` 갱신을 한다. 성공한 뒤 `esp_restart()`로 새 앱을 부팅한다.
- OTA 중에는 워치독 타임아웃을 주의한다. 큰 플래시 지우기·쓰기는 기본 5초를 넘길 수 있다. 21장에서 이어서 다룬다.

### HTTPS OTA

ESP-IDF에는 OTA의 HTTPS 다운로드를 감싼 `esp_https_ota` API가 있다. 한 번에 끝내는 `esp_https_ota()`와, 진행 상황을 보며 처리하는 `esp_https_ota_begin()`/`perform()`/`finish()`가 있다. 아래 코드는 ESP-IDF 문서의 API와 대조했지만 실물에서 확인하지 않았다. **실물 확인 필요.**

```c
#include "esp_https_ota.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_system.h"

void https_ota_once(void) {
    esp_http_client_config_t http = {
        .url = "https://firmware.example.com/device/app.bin",
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 20000,
    };
    esp_https_ota_config_t ota = {
        .http_config = &http,
    };

    esp_err_t err = esp_https_ota(&ota);
    if (err == ESP_OK) {
        esp_restart();
    }
    /* 실패하면 현재 앱은 그대로다. 로그를 남기고 재시도한다. */
}
```

- **인증서 검증을 끄지 않는다.** `crt_bundle_attach`로 ESP x509 Certificate Bundle을 붙이거나, 서버의 루트 인증서를 PEM으로 넣는다.
- 서버가 리다이렉트를 하면 대상 서버의 인증서도 필요할 수 있다.
- 인증서 유효기간을 검사하려면 장치 시각이 맞아야 한다. 부팅 직후에는 시각이 1970년일 수 있으므로, OTA 전에 SNTP 등으로 시각을 맞추거나 번들 검증의 동작을 확인한다.
- `esp_https_ota()`는 블로킹 호출이다. Wi-Fi·HTTP 클라이언트가 초기화된 뒤에 호출하고, OTA 전용 태스크에서 실행하는 편이 안전하다.
- 부분 다운로드·이어받기는 HTTP Range 요청을 쓴다. 서버가 `Content-Length`를 주지 않는 chunked 전송이면 이어받기가 어렵다.
- `esp_https_ota()`가 성공해도 **롤백을 켰다면 앱이 직접 `esp_ota_mark_app_valid_cancel_rollback()`을 호출해야 한다.** 호출하지 않으면 다음 리셋에서 롤백될 수 있다.

HTTPS는 전송 구간을 보호하지만, **이미지 자체의 진위**는 Secure Boot가 담당한다. TLS만 믿으면 서버가 침해됐을 때 악성 이미지를 받을 수 있다. TLS와 서명 검증은 서로 다른 층이다.

## 20.5 롤백: 새 앱이 스스로를 증명하게 하라

OTA에서 가장 위험한 순간은 **새 앱이 부팅은 됐지만 정상 동작하지 않는** 경우다. 화면이 안 뜨거나, Wi-Fi가 안 붙거나, CAN 트랜시버가 초기화되지 않거나, 센서 값이 이상할 수 있다. 이때 자동으로 이전 앱으로 돌아가는 장치가 **앱 롤백(app rollback)**이다.

ESP-IDF의 롤백은 `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`을 켜면 동작한다. 상태는 다음과 같다.

| 상태 | 의미 |
|---|---|
| `ESP_OTA_IMG_NEW` | 새 이미지가 선택됨. 아직 한 번도 부팅되지 않음 |
| `ESP_OTA_IMG_PENDING_VERIFY` | 부트로더가 새 이미지를 부팅했다. 앱의 확인을 기다림 |
| `ESP_OTA_IMG_VALID` | 앱이 자체 시험을 통과해 정상으로 표시됨 |
| `ESP_OTA_IMG_INVALID` | 앱이 실패를 선언함. 부팅 대상에서 제외 |
| `ESP_OTA_IMG_ABORTED` | 확인 없이 리셋됨. 부팅 대상에서 제외 |
| `ESP_OTA_IMG_UNDEFINED` | 롤백이 꺼져 있거나 상태가 정의되지 않음 |

흐름은 다음과 같다.

```text
OTA 쓰기 → set_boot_partition → NEW
   │
   ▼
재부팅 → 부트로더가 PENDING_VERIFY로 바꿈
   │
   ├─ 앱이 자체 시험 통과 → mark_app_valid_cancel_rollback() → VALID
   │
   ├─ 앱이 실패 선언 → mark_app_invalid_rollback_and_reboot() → INVALID
   │        └─ 다음 부팅에서 이전 VALID 앱 선택
   │
   └─ 확인 전에 리셋/전원 차단 → 다음 부팅에서 ABORTED
            └─ 다음 부팅에서 이전 VALID 앱 선택
```

앱 쪽 코드는 대략 다음과 같다. **ESP32 실물에서 확인해야 하는 코드**다.

```c
#include "esp_ota_ops.h"
#include "esp_log.h"

static const char *TAG = "boot";
static bool self_test(void);   /* 센서·CAN·Wi-Fi·설정을 확인한다 */

void app_main(void) {
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;

    if (esp_ota_get_state_partition(running, &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY) {
        if (self_test()) {
            esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
            ESP_LOGI(TAG, "app valid: %s", esp_err_to_name(err));
        } else {
            ESP_LOGE(TAG, "self-test failed, rollback");
            esp_ota_mark_app_invalid_rollback_and_reboot();
        }
    }

    /* 정상 앱 초기화 계속 */
}
```

- **자체 시험은 "부팅했다"보다 넓게 잡는다.** 예: NVS에서 설정을 읽을 수 있는가, Wi-Fi에 붙는가, CAN 트랜시버가 초기화되는가, 필수 센서가 응답하는가, 서버에 하트비트를 보낼 수 있는가.
- **확인 시점을 너무 늦추지 않는다.** 네트워크가 느리면 확인 전에 리셋될 수 있다. 반대로 너무 이르면 일시적인 네트워크 문제로 롤백된다. "이 장치가 현장에서 해야 하는 최소 기능"을 기준으로 정한다.
- **확인 전에 리셋되면 ABORTED로 롤백된다.** 그래서 부팅 경로에서 오래 걸리는 작업을 확인 전에 두지 않는다.
- **롤백이 꺼져 있으면 상태가 `UNDEFINED`일 수 있고, 확인 함수는 선택이 된다.** 그래도 자체 시험과 버전 로그는 남기는 편이 좋다.
- **부트로더 자체나 파티션 테이블은 이 롤백으로 되돌아가지 않는다.** 앱만 롤백된다.

### 상태 기계를 PC에서 돌려 보기

아래 파이썬 시뮬레이션은 ESP-IDF 문서의 상태 전이를 그대로 옮긴 것이다. 실제 부트로더가 아니라 **상태 전이를 확인하는 모델**이다.

```python
from dataclasses import dataclass, field


@dataclass
class Slot:
    name: str
    version: str = "-"
    state: str = "EMPTY"


@dataclass
class Device:
    slots: dict = field(default_factory=lambda: {
        "factory": Slot("factory", "v1", "VALID"),
        "ota_0": Slot("ota_0"),
        "ota_1": Slot("ota_1"),
    })
    boot: str = "factory"
    log: list = field(default_factory=list)

    def running(self):
        return self.slots[self.boot]

    def other_slot(self):
        return "ota_1" if self.boot == "ota_0" else "ota_0"

    def ota_write(self, version):
        target = self.other_slot()
        slot = self.slots[target]
        slot.version = version
        slot.state = "NEW"
        self.log.append(f"OTA write {version} -> {target} (NEW)")
        return target

    def set_boot(self, target):
        self.boot = target
        self.log.append(f"set boot -> {target}")

    def bootloader(self):
        slot = self.running()
        if slot.state == "NEW":
            slot.state = "PENDING_VERIFY"
            self.log.append(f"boot {slot.name}: NEW -> PENDING_VERIFY")
        elif slot.state == "PENDING_VERIFY":
            slot.state = "ABORTED"
            self.log.append(f"boot {slot.name}: PENDING_VERIFY -> ABORTED")
            self._rollback()
        elif slot.state in ("INVALID", "ABORTED", "EMPTY"):
            self.log.append(f"boot {slot.name}: {slot.state}, rollback")
            self._rollback()
        else:
            self.log.append(f"boot {slot.name}: {slot.state}")

    def _rollback(self):
        for name in ("ota_0", "ota_1", "factory"):
            if name != self.boot and self.slots[name].state == "VALID":
                self.boot = name
                self.log.append(f"rollback -> {name} ({self.slots[name].version})")
                return
        self.log.append("no valid slot!")

    def confirm(self):
        self.running().state = "VALID"
        self.log.append(f"mark valid: {self.boot} ({self.running().version})")

    def fail_selftest(self):
        self.running().state = "INVALID"
        self.log.append(f"mark invalid: {self.boot}")

    def reset_without_confirm(self):
        self.log.append("reset before confirm")
```

정상 반영, 자체 시험 실패, 확인 전 리셋을 차례로 실행하면 다음과 같다.

```text
[1. 정상 OTA]
  boot=ota_0, running=v2, state=VALID
    OTA write v2 -> ota_0 (NEW)
    set boot -> ota_0
    boot ota_0: NEW -> PENDING_VERIFY
    mark valid: ota_0 (v2)

[2. 자체 시험 실패]
  boot=ota_0, running=v2, state=VALID
    OTA write v3 -> ota_1 (NEW)
    set boot -> ota_1
    boot ota_1: NEW -> PENDING_VERIFY
    mark invalid: ota_1
    boot ota_1: INVALID, rollback
    rollback -> ota_0 (v2)

[3. 확인 전 리셋]
  boot=ota_0, running=v2, state=VALID
    OTA write v4 -> ota_1 (NEW)
    set boot -> ota_1
    boot ota_1: NEW -> PENDING_VERIFY
    reset before confirm
    boot ota_1: PENDING_VERIFY -> ABORTED
    rollback -> ota_0 (v2)
```

위 출력은 이 코드를 실제로 실행한 결과다. 이 모델에서 확인할 것은 세 가지다.

1. 새 이미지를 쓰는 동안 **현재 슬롯은 바뀌지 않는다.**
2. 자체 시험이 실패하면 **새 슬롯이 INVALID가 되고 이전 슬롯이 선택된다.**
3. 확인 전에 리셋되면 **ABORTED가 되고 이전 슬롯이 선택된다.**

실제 ESP-IDF에서는 `esp_ota_mark_app_invalid_rollback_and_reboot()`가 즉시 리셋하고, 다음 부팅의 부트로더가 이전 슬롯을 고른다. 시뮬레이션은 이 순서를 단순화한 것이다.

## 20.6 서명·Secure Boot·Flash 암호화

OTA의 신뢰는 세 층으로 나뉜다.

| 층 | 질문 | 기술 |
|---|---|---|
| 전송 | 서버와 안전하게 통신했는가 | TLS, 인증서 검증 |
| 이미지 진위 | 이 이미지가 우리가 서명한 것인가 | Secure Boot, 서명 블록 |
| 저장 기밀성 | 플래시를 읽어도 내용을 알 수 없는가 | Flash 암호화 |

### Secure Boot

Secure Boot는 **부팅할 때마다 이미지의 서명을 검증**한다.

- ESP32의 Secure Boot V2는 RSA-PSS 3072비트와 SHA-256을 쓴다. 칩 리비전 3.0(ECO3) 이상에서 지원한다.
- 더 오래된 ESP32는 Secure Boot V1(legacy)을 쓴다. 새 설계라면 V2 지원 여부와 칩 리비전을 먼저 확인한다.
- ROM이 2단계 부트로더의 서명을 확인하고, 2단계 부트로더가 앱 이미지의 서명을 확인한다.
- 공개키의 SHA-256 다이제스트가 eFuse에 저장된다. 장치에는 **공개키만** 들어가고, 서명용 개인키는 장치 밖에서 보관한다.
- ESP32에서는 **키를 하나만** 넣을 수 있다. 키를 잃거나 바꾸면 기존 장치를 새 키로 업데이트할 수 없다.
- Secure Boot를 켜면 JTAG가 비활성화된다. 개발 중 디버깅이 필요하면 이 점을 먼저 고려한다.

서명 검증에 실패하면 부트로더는 다른 유효한 앱 이미지를 찾는다. 그래서 Secure Boot와 A/B 롤백은 함께 쓸 때 강해진다. 서명이 맞지 않는 새 이미지는 아예 선택되지 않고, 이전 서명된 이미지로 돌아간다.

### Flash 암호화

Flash 암호화는 플래시에 저장된 데이터를 **암호화해 두는** 기능이다.

- ESP32는 AES-256으로 플래시 내용을 암호화한다. 32바이트 단위로 처리하고, 플래시 오프셋에 따라 키를 변형(tweak)한다.
- 부트로더, 파티션 테이블, `otadata`, 앱 파티션, `nvs_keys` 등이 기본으로 암호화된다. 추가 파티션은 `encrypted` 플래그로 지정한다.
- 첫 부팅 때 플래시의 평문을 그 자리에서 암호화한다. **이 과정에서 전원을 끊으면 플래시가 손상될 수 있다.**
- 키는 eFuse에 있고, 기본적으로 소프트웨어에서 읽을 수 없게 보호된다.
- 개발 모드(development)는 시리얼로 평문을 다시 플래시할 수 있어 편하지만, 릴리스 모드(release)는 UART 다운로드로 평문을 쓸 수 없고 OTA나 암호문 플래싱을 써야 한다.
- Flash 암호화는 **펌웨어 변조를 막지 않는다.** 변조를 막으려면 Secure Boot와 함께 써야 한다. 문서도 "Flash 암호화는 펌웨어 수정을 막지 않는다"고 명시한다.

### eFuse는 되돌릴 수 없다

Secure Boot와 Flash 암호화는 eFuse 설정과 결합된다. eFuse는 한 번 구우면 되돌릴 수 없고, 잘못 구우면 장치가 부팅되지 않거나 복구 불가능해질 수 있다.

- **개발 보드에서 호기심에 켜지 않는다.** Secure Boot를 켠 보드는 이후 서명된 이미지만 부팅한다. 키를 잃으면 그 보드는 사실상 벽돌이 된다.
- **키를 백업하고, 키 보관·서명·배포 절차를 먼저 정한다.** 개인키가 유출되면 그 키로 서명된 악성 이미지가 모든 장치에 들어갈 수 있다.
- **eFuse의 읽기 보호와 쓰기 보호를 혼동하지 않는다.** Secure Boot 공개키 다이제스트 블록은 쓰기 보호하지만 읽기 보호하면 안 된다. 읽기 보호하면 검증이 실패해 부팅이 중단된다.
- **생산 라인과 개발 라인을 분리한다.** 개발용 장치는 Secure Boot를 끄고, 양산 장치만 전용 키로 설정한다.
- **한 장치에서 설정을 시험한 뒤 전체에 적용하지 않는다.** 먼저 소수의 전용 보드에서 전체 플로우를 검증한다.

### 안티 롤백(anti-rollback)

앱 롤백과 **안티 롤백**은 이름이 비슷하지만 반대 방향이다.

- 앱 롤백: 새 앱이 실패하면 **이전 앱으로** 돌아간다.
- 안티 롤백: 보안 버전(secure version)이 낮은 **오래된 앱으로의 다운그레이드**를 막는다.

ESP-IDF의 `CONFIG_BOOTLOADER_APP_ANTI_ROLLBACK`은 eFuse의 보안 버전과 앱의 보안 버전을 비교한다. 보안 버전은 단조 증가하며, eFuse에 기록된 값보다 낮은 버전은 부팅되지 않는다. 그래서 안티 롤백을 켜면 "취약점이 패치된 새 버전"에서 "취약한 예전 버전"으로 되돌리는 공격을 막을 수 있지만, **정상적인 롤백도 제한**된다. 롤백 정책과 안티 롤백 정책을 함께 설계해야 한다.

## 20.7 HTTPS OTA 운영

OTA를 현장에서 돌리면 코드보다 **운영**에서 문제가 난다.

### 서버와 이미지

- 이미지는 버전·빌드 시각·커밋 해시를 파일 이름과 헤더에 남긴다. 장치가 "지금 무엇을 실행 중인가"를 로그로 말할 수 있어야 한다.
- 서버는 `Content-Length`를 제공하고, 가능하면 Range 요청을 지원한다. 불안정한 네트워크에서 이어받기가 된다.
- 리다이렉트를 쓰면 대상 서버의 인증서도 장치에 있어야 한다.
- 같은 URL이 항상 같은 이미지를 주도록 캐시 정책을 정한다. CDN 캐시가 오래된 이미지를 주면 롤아웃이 꼬인다.
- 이미지 파일과 함께 서명·해시·버전 메타데이터를 배포하고, 장치가 받은 이미지의 버전을 서버에 보고하게 한다.

### 단계적 롤아웃

한 번에 모든 장치를 업데이트하지 않는다. 웹의 카나리 배포처럼 **장치 그룹을 나눠** 진행한다.

```text
1. 내부 벤치 장치 1~2대
2. 개발자/테스터 장치 5~10대
3. 전체의 1~5%
4. 전체의 25%
5. 전체
```

각 단계에서 확인할 지표:

- OTA 성공률, 다운로드 실패율, 재시도 횟수
- 새 버전의 부팅 성공률, 리셋 원인 분포
- 자체 시험 실패율, 롤백 발생률
- 하트비트 지연, CAN 오류 카운터, 센서 응답 실패
- 배터리 전압·대기 전류(차량 장치)

한 단계에서 실패율이 임계값을 넘으면 **롤아웃을 멈추고**, 서버에서 이전 버전을 다시 배포하거나 장치의 자동 롤백을 기다린다. "일단 전체에 보내고 보자"는 OTA는 웹보다 위험하다. 장치가 차량에 붙어 있으면 운전자와 주변 사람의 안전 문제가 된다.

### 전원과 네트워크

- OTA 중 전원이 끊기지 않도록 한다. 차량 장치는 시동이 꺼진 상태에서 OTA를 시작하지 않는 편이 좋다. 배터리 전압이 낮으면 OTA를 거부한다.
- Wi-Fi가 약한 곳에서는 다운로드를 재시도한다. 매번 처음부터 받지 않도록 Range/이어받기를 지원한다.
- OTA가 끝나면 재부팅한다. 새 앱이 자체 시험을 통과해야 VALID가 된다.
- OTA 중에는 절전에 들어가지 않는다. 22장의 sleep 설계와 충돌하지 않게 "OTA 중에는 sleep 금지" 상태를 둔다.

## 20.8 블루·그린·카나리와 A/B의 대응

| 웹 배포 | 임베디드 OTA | 같은 점 | 다른 점 |
|---|---|---|---|
| 블루·그린 | A/B 파티션 | 새 버전을 따로 준비하고 전환점에서 바꾼다 | 트래픽 대신 부팅 파티션을 바꾼다 |
| 롤백 | `otadata`를 이전 슬롯으로 | 실패하면 이전 버전으로 | 장치가 스스로 판단해야 한다 |
| 카나리 | 장치 그룹별 단계적 롤아웃 | 일부에 먼저 보내고 관찰한다 | 장치가 오프라인일 수 있다 |
| 불변 이미지 | 서명된 이미지, 버전 고정 | 빌드 산출물을 그대로 배포한다 | 플래시에 쓰는 순간이 배포다 |
| 헬스 체크 | 자체 시험, 하트비트 | 배포 후 정상인지 확인한다 | 사람이 보지 않아도 통과해야 한다 |
| 배포 승인 | 서명 키, 릴리스 프로세스 | 권한 있는 사람만 배포한다 | 키가 장치 밖에 있다 |

A/B 업데이트의 핵심은 **"실행 중인 것을 건드리지 않는다"**와 **"전환은 마지막에 한 번"**이다. 이 두 가지를 지키면 OTA 도중 전원이 꺼져도 장치는 살아 있다. 웹의 무중단 배포와 같은 원리다.

## 20.9 흔한 실수

| 실수 | 결과 | 예방 |
|---|---|---|
| 현재 실행 중인 파티션에 OTA 쓰기 | 실행 중인 앱이 지워져 즉시 크래시 | `esp_ota_get_next_update_partition(NULL)` 사용 |
| 롤백을 켜지 않음 | 새 앱이 실패하면 복구 불가 | `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, 자체 시험 |
| 자체 시험 전에 `mark_app_valid` 호출 | 실패한 앱이 VALID가 되어 롤백 불가 | 시험 통과 후에만 호출 |
| 확인을 영원히 미룸 | 다음 리셋에서 ABORTED 롤백 | 확인 시점을 명확히 정한다 |
| OTA 슬롯보다 큰 이미지 | 쓰기 실패, OTA 중단 | 파티션 크기와 이미지 크기 확인 |
| 파티션 테이블을 OTA로 바꾸려 함 | 앱 OTA 범위 밖이라 실패 | 파티션 변경은 별도 절차, 현장에서는 피한다 |
| HTTPS 인증서 검증 끄기 | 중간자 공격으로 악성 이미지 | cert bundle 또는 루트 인증서, 시각 확인 |
| OTA 중 워치독 타임아웃 | 재부팅, OTA 실패 | 21장의 타임아웃·태스크 설계 |
| Secure Boot를 개발 보드에 켬 | 키를 잃으면 복구 불가 | 전용 보드, 키 백업, 생산 절차 |
| eFuse 읽기 보호를 잘못 설정 | 부팅 검증 실패 | 공식 문서의 eFuse 표를 확인 |
| OTA 중 절전 진입 | 다운로드 중단 | OTA 중 sleep 금지 상태 |
| 버전·빌드 ID를 남기지 않음 | "어떤 펌웨어인가"를 알 수 없음 | 부팅 로그·하트비트에 버전 포함 |

## 20.10 체크리스트

- [ ] 파티션 테이블에 `factory` 또는 `ota_0`/`ota_1`과 `otadata`가 있는가
- [ ] 앱 이미지가 OTA 슬롯 크기 안에 들어가는가
- [ ] 현재 실행 중이 아닌 슬롯에 쓰는가
- [ ] `esp_ota_end()`의 검증 실패를 처리하는가
- [ ] `esp_ota_set_boot_partition()` 성공 후에만 재부팅하는가
- [ ] 롤백을 켰는가 (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`)
- [ ] 자체 시험 통과 후 `esp_ota_mark_app_valid_cancel_rollback()`을 호출하는가
- [ ] 자체 시험 실패 시 `esp_ota_mark_app_invalid_rollback_and_reboot()`를 호출하는가
- [ ] HTTPS 인증서를 검증하는가
- [ ] OTA 전에 장치 시각이 맞는가
- [ ] OTA 중 워치독·절전과 충돌하지 않는가
- [ ] 버전·빌드 ID·리셋 원인을 로그로 남기는가
- [ ] 단계적 롤아웃과 중단 기준이 있는가
- [ ] Secure Boot·Flash 암호화는 전용 보드와 공식 절차로만 시험하는가
- [ ] eFuse 설정을 되돌릴 수 없다는 점을 팀이 알고 있는가

## 장 요약

- ESP32는 ROM 부트로더 → 2단계 부트로더 → 앱 순서로 부팅한다. 파티션 선택과 이미지 검증은 앱이 시작되기 전에 끝난다.
- 파티션 테이블은 `factory`·`ota_0`·`ota_1`·`otadata`·`nvs`로 플래시를 나눈다. 앱 오프셋은 0x10000, 크기는 0x1000 경계에 맞춘다.
- A/B OTA는 실행 중이 아닌 슬롯에 쓰고, 검증이 끝난 뒤 `otadata`로 부팅 파티션을 바꾼다. 그래서 쓰기 도중 전원이 끊겨도 현재 앱은 살아 있다.
- `esp_ota_begin/write/end/set_boot_partition`이 기본 흐름이고, `esp_https_ota`는 HTTPS 다운로드를 감싼다.
- 롤백을 켜면 새 앱은 `NEW → PENDING_VERIFY → VALID/INVALID/ABORTED`를 거친다. 자체 시험 통과 후 `esp_ota_mark_app_valid_cancel_rollback()`을 호출해야 한다.
- Secure Boot는 이미지 진위를, Flash 암호화는 저장 기밀성을 담당한다. 둘 다 eFuse와 결합되며 되돌릴 수 없다. 개념과 위험만 이해하고, 실행은 공식 절차와 전용 보드로 미룬다.
- OTA는 코드가 아니라 운영이다. 단계적 롤아웃, 롤백 기준, 전원·네트워크·시각·워치독을 함께 설계한다.

다음 장에서는 장치가 **멈췄을 때 스스로 다시 살아나는** 방법을 다룬다. 워치독, 리셋 원인, 브라운아웃, 리셋 루프 방지, 크래시 덤프가 주제다.

## 연습 문제

### 1. (기초) 파티션의 역할

다음 파티션의 역할을 한 줄씩 쓰라.

```text
factory, ota_0, ota_1, otadata, nvs
```

### 2. (중급) 롤백 상태 전이

`ota_0`에서 v1이 실행 중이다. v2를 `ota_1`에 쓰고 부팅했지만, 자체 시험이 실패했다. 이어서 v3를 `ota_0`에 쓰고 부팅했는데, 확인 전에 전원이 꺼졌다. 다시 전원이 들어왔을 때 어느 버전이 부팅되는가? 상태 이름을 포함해 설명하라.

### 3. (중급) 파티션 크기 계산

4MB 플래시에 `nvs` 0x4000, `otadata` 0x2000, `phy_init` 0x1000, `factory` 1MB, `ota_0` 1MB, `ota_1` 1MB를 배치했다. 앱 이미지가 1.2MB라면 OTA가 가능한가? 가능하게 하려면 무엇을 바꿔야 하는가?

### 4. (심화) 단계적 롤아웃 설계

차량에 꽂아 둔 장치 1,000대에 OTA를 배포하려 한다. 네트워크는 간헐적이고, 일부 차량은 몇 주간 시동이 걸리지 않는다. 단계적 롤아웃 단계와 각 단계의 중단 기준, 서버가 해야 할 일을 설계하라.

### 5. (심화) 보안 설정의 위험

Secure Boot와 Flash 암호화를 개발 보드에서 먼저 켜 보려 한다. 어떤 위험이 있고, 어떤 순서로 준비해야 하는가? eFuse를 굽는 명령은 쓰지 말고 개념으로 설명하라.

## 정답과 해설

### 1.

- `factory`: 공장 기본 앱. OTA 데이터가 비어 있거나 OTA 슬롯이 유효하지 않을 때의 폴백.
- `ota_0`, `ota_1`: A/B 업데이트 슬롯. 실행 중이 아닌 슬롯에 새 이미지를 쓴다.
- `otadata`: 다음 부팅에 선택할 OTA 슬롯을 기록하는 데이터 파티션. 두 섹터(0x2000)다.
- `nvs`: Wi-Fi 설정·부팅 카운터·장치 설정처럼 전원이 꺼져도 남길 키-값 저장소.

### 2.

v2는 자체 시험 실패로 `INVALID`가 되고, 부트로더는 이전 `ota_0`의 v1을 선택한다. 이어서 v3를 `ota_0`에 쓰고 부팅하면 v3는 `PENDING_VERIFY`가 된다. 확인 전에 전원이 꺼지면 다음 부팅에서 v3는 `ABORTED`가 되고, 부트로더는 다른 유효 슬롯을 찾는다. 이 시점에서 `ota_1`의 v2는 `INVALID`이므로, v1이 `VALID`로 남아 있다면 v1이 부팅된다. v1도 없다면 부팅 가능한 슬롯이 없어 실패한다. 그래서 **한 번에 한 슬롯만 실험하고, 이전 VALID 앱을 유지**하는 것이 중요하다.

### 3.

불가능하다. 앱 이미지 1.2MB는 1MB 슬롯에 들어가지 않는다. 선택지는 다음과 같다.

- 앱 슬롯을 1.5MB 이상으로 키우고 `factory`를 줄이거나 없앤다.
- 이미지 크기를 1MB 아래로 줄인다(디버그 심볼·로그·라이브러리 축소).
- 더 큰 플래시를 쓰는 보드로 바꾼다.
- 파티션 배치를 바꾸는 것은 앱 OTA로 할 수 없으므로, 현장 장치라면 초기 생산 단계에서 결정해야 한다.

예를 들어 `factory`를 없애고 `ota_0`/`ota_1`을 각각 1.5MB로 잡으면 4MB 안에 들어갈 수 있다. 다만 `factory` 폴백을 잃으므로, 두 슬롯이 모두 실패했을 때의 복구 전략을 별도로 마련해야 한다.

### 4.

예:

1. **벤치 1~2대**: OTA 성공, 부팅, 자체 시험, 롤백을 확인한다. 실패하면 배포 중단.
2. **내부 5~10대**: 24~72시간 관찰. 리셋 원인·롤백·하트비트·CAN 오류를 본다. 롤백률 1% 초과 또는 부팅 실패 1건이면 중단.
3. **1~5%**: 1주 관찰. OTA 성공률 95% 미만, 하트비트 지연 증가, 배터리 전압 저하가 보이면 중단.
4. **25%**: 같은 지표를 1~2주 관찰한다.
5. **전체**: 그래도 바로 전체를 덮지 않고, 서버에서 버전별 비율을 조절한다.

서버는 장치별 현재 버전·마지막 접속·OTA 결과·리셋 원인을 수집하고, 오프라인 장치를 별도로 표시한다. 몇 주간 시동이 걸리지 않는 차량은 "다음 시동 시 업데이트" 정책으로 두고, OTA를 강제로 깨우지 않는다. 배터리 전압이 낮으면 OTA를 거부하고, 시동이 걸린 뒤로 미룬다. 롤백이 발생한 장치는 자동으로 이전 버전 그룹에 남기고, 원인을 조사하기 전까지 재배포하지 않는다.

### 5.

위험:

- Secure Boot를 켜면 서명된 이미지만 부팅한다. 서명 키를 잃거나 서명 절차가 틀리면 장치가 다시 부팅되지 않는다.
- ESP32는 공개키를 하나만 저장할 수 있어 키 교체가 어렵다.
- Flash 암호화는 첫 부팅 때 플래시를 그 자리에서 암호화한다. 이때 전원이 끊기면 플래시가 손상될 수 있다.
- eFuse는 되돌릴 수 없다. 잘못된 eFuse 설정은 복구 불가능한 벽돌을 만든다.
- Secure Boot를 켜면 JTAG가 비활성화되어 디버깅이 어려워진다.

준비 순서:

1. 전용 보드와 전용 키를 준비한다. 개발 보드와 양산 보드를 분리한다.
2. 키 생성·보관·서명·배포 절차를 문서화하고, 개인키를 장치 밖 안전한 곳에 둔다.
3. 서명된 이미지가 정상 부팅·OTA·롤백하는지 소수 보드에서 확인한다.
4. Flash 암호화와 Secure Boot의 순서, eFuse 읽기/쓰기 보호 표를 공식 문서로 확인한다.
5. 생산 라인에서 eFuse 설정과 검증 절차를 자동화하고, 한 장치씩 결과를 기록한다.
6. 현장 장치의 키 교체·폐기·회수 절차를 정한다.

이 책은 eFuse를 굽는 명령을 제공하지 않는다. 실제 적용은 Espressif의 Secure Boot·Flash Encryption 문서와 생산 담당자의 검토로 진행한다.
