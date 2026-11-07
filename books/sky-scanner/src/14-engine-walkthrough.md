# 14장 모델을 올리고 돌리는 코드, 한 줄씩

## 14.1 "라인별로 설명해줄 수 있어?"

13장에서 GPU 사용률이 100%로 오르는 것을 본 사용자가 물었다.

> **"모델을 메모리에 올리고, 파라메터 전달해서 돌리는 코드를 만든거지? 코드 오르카에 띄워주고, 라인별로 세션에서 설명해줄수 있어?"**

Claude는 편집기(Orca)에 `whisper_engine.py`를 띄우고 흐름 순서대로 설명했다. 설명을 들은 사용자의 말이 이 장의 출발점이다.

> **"오 신기하다. 이 내용은 집필노트에 별로 장으로 써줘. 코드랑 설명 둘다 있으면 좋을것 같아."**

이 파일은 3차에서 DeepSeek이 짰다. 실기 날 Claude가 세 군데를 고쳤다(모델 받을 폴더, PATH, CPU 전환 경고). 아래 코드는 줄을 조금 덜어 냈다.

```text
워커가 교신 하나를 넘김
  → transcribe()      녹음 읽기, 실패하면 CPU로 한 번 더
    → _run()          모델에 소리를 넣고 결과 정리
      → _get_model()  모델이 없으면 그때 메모리에 올림(처음 한 번)
```

## 14.2 엔진을 만들 때는 모델을 올리지 않는다

```python
def __init__(self, name, model, device="cuda", compute_type=None,
             model_factory=None, download_root=None):
    self.name = name                  # 화면과 DB에 쓰는 이름
    self.model = model                # "medium.en" 같은 이름이나 폴더 경로
    self.device = device              # "cuda" 또는 "cpu"
    self.compute_type = compute_type  # 숫자 정밀도(14.5)
    self.download_root = download_root
    self._model_factory = model_factory  # 시험에서 가짜 모델을 끼우는 자리
    self._model = None                # ← 핵심
    self._active_device = device
```

핵심은 `self._model = None`이다. 엔진을 만들 때는 모델을 메모리에 올리지 않는다(**지연 로드**). 수신기가 켜질 때 몇 GB를 바로 올리면 시작이 느려지고, 쓰지 않는 엔진까지 메모리를 차지한다.

## 14.3 받아 적기: 실패해도 멈추지 않는다

```python
def transcribe(self, wav_path, hints):
    started = time.perf_counter()
    audio = read_wav_float32(wav_path)   # 16비트 정수 → -1~1 소수 배열
    try:
        text, confidence = self._run(audio, hints, self._active_device)
    except Exception as exc:
        if self._active_device != "cuda":
            return self._error_transcript(started, exc)
        logger.warning("%s: GPU에서 실패해 CPU로 바꿉니다: %s", self.name, exc)
        self._active_device = "cpu"
        self._model = None
        text, confidence = self._run(audio, hints, "cpu", force_cpu_int8=True)
    return Transcript(engine=self.name, text=text, confidence=confidence,
                      duration_s=time.perf_counter() - started, error=None)
```

- `read_wav_float32`는 WAV의 16비트 정수(-32768~32767)를 32768로 나눠 -1~1 사이 소수로 바꾼다. 3초 녹음이면 숫자 48,000개다(초당 16,000개).
- GPU에서 오류가 나면 모델을 버리고 CPU로 다시 올려 한 번 더 해 본다.
- `logger.warning` 줄이 실기 날 Claude가 넣은 경고다. 13장에서 `cublas64_12.dll`을 못 찾았을 때, 이 자리에서 **아무 말 없이** CPU로 내려가는 바람에 문제가 숨었다.
- 오류도 예외로 던지지 않고 결과 상자의 `error` 칸에 담는다. 엔진 하나가 고장 나도 다른 엔진과 워커는 계속 돈다.

## 14.4 파라미터를 넘겨 돌리기

사용자가 말한 "파라미터 전달해서 돌리는" 부분이다.

```python
model = self._get_model(device, force_cpu_int8=force_cpu_int8)
segments, _info = model.transcribe(
    audio,
    language="en",
    beam_size=5,
    vad_filter=False,                  # 스켈치가 이미 교신 구간만 잘랐다
    condition_on_previous_text=False,
    initial_prompt=hints.prompt_text() or None,
)
```

| 인자 | 뜻 | 왜 이렇게 |
|---|---|---|
| `language="en"` | 영어로 고정 | 추측하게 두면 틀린다(12장에서 Qwen이 중국어로 적었다) |
| `beam_size=5` | 다음 단어 후보 5개를 동시에 따라감 | 13장 비교에서 10과 거의 같고 더 빠름 |
| `vad_filter=False` | 말소리 없는 구간 자르기 끔 | 스켈치가 이미 했다 |
| `condition_on_previous_text=False` | 앞 조각 문장을 다음 조각의 힌트로 쓰지 않음 | 앞에서 잘못 들은 말이 뒤로 번진다 |
| `initial_prompt` | 근처 편명을 귀띔 | 비슷한 소리를 그 편명 쪽으로 듣게 돕는다 |

```python
for segment in segments:               # ← 실제 계산은 여기서 일어난다
    if segment.no_speech_prob > NO_SPEECH_THRESHOLD:   # 0.6
        continue
    texts.append(segment.text.strip())
    avg_logprobs.append(segment.avg_logprob)
    no_speech_probs.append(segment.no_speech_prob)
text = clean_text(" ".join(texts))     # 흔한 환각 문장은 빈칸으로
confidence = math.exp(mean(avg_logprobs)) * (1.0 - max(no_speech_probs))
```

- faster-whisper는 결과 조각(segment)을 **꺼낼 때** 실제로 계산한다. 그래서 GPU가 100%가 되는 순간은 `transcribe(...)`를 부를 때가 아니라 `for` 반복문이다. 13장에서 첫 GPU 실행이 멈췄을 때 호출 기록이 조각을 만드는 함수를 가리킨 이유다.
- `no_speech_prob`은 "이 조각은 말소리가 아니다"일 확률이다. 0.6을 넘으면 잡음에서 지어낸 문장으로 보고 버린다. 잡음 3초를 넣었더니 " You"가 나온 일이 있다. 이런 것을 거르는 장치다.
- `confidence`는 엔진 스스로의 자신감이다. 평균 로그 확률을 `exp`로 되돌리고, 말소리일 확률을 곱한다. 화면의 "추정"은 이 값이 아니라 엔진끼리의 일치도로 정한다(10장).

## 14.5 메모리에 올리는 한 줄

```python
def _get_model(self, device, force_cpu_int8=False):
    if self._model is not None:
        return self._model             # 두 번째부터는 바로
    add_cuda_dll_dirs()                # cuBLAS·cuDNN 폴더 등록(PATH 포함)
    from faster_whisper import WhisperModel   # 무거운 라이브러리라 지금 부른다
    if force_cpu_int8:
        compute_type = "int8"
    elif self.compute_type is not None:
        compute_type = self.compute_type
    else:
        compute_type = "float16" if device == "cuda" else "int8"
    kwargs = {"device": device, "compute_type": compute_type}
    if self.download_root:
        kwargs["download_root"] = self.download_root
    self._model = WhisperModel(self.model, **kwargs)   # ← 이 한 줄
    return self._model
```

숫자 정밀도(`compute_type`)는 셋이다.

- `float16`: 숫자 하나를 2바이트로 쓴다. GPU가 아주 빠르게 계산하는 형식이다.
- `int8`: 1바이트 정수로 줄인다(양자화). 메모리는 반이고 CPU에서 빨라진다. 대신 정확도가 아주 조금 떨어질 수 있다.
- `int8_float16`: 저장은 int8, 계산은 float16. ATC large-v3를 6 GB에 넣으려고 썼다.

`WhisperModel(...)` 한 줄이 하는 일은 세 가지다.

1. 폴더에 모델 파일이 없으면 Hugging Face에서 받는다(실기 날 처음 받은 1.5 GB와 2.9 GB).
2. 가중치 약 7억 6천만 개를 읽는다.
3. float16으로 바꿔 GPU 메모리에 올린다. 작업 관리자의 전용 GPU 메모리가 약 2 GB 늘어나는 순간이다.

올린 모델은 `self._model`이 붙잡고 있다. 이 참조가 살아 있는 동안 모델은 GPU 메모리에 계속 있다. 계산을 쉬어도 메모리가 줄지 않는 이유다. 반대로 `unload()`는 `self._model = None` 한 줄로 참조를 놓아 메모리를 돌려준다.

## 14.6 정리

| 하는 일 | 언제 |
|---|---|
| 모델을 메모리에 올리기(`WhisperModel(...)`) | 처음 한 번 |
| 파라미터를 넘겨 돌리기(`model.transcribe(...)`) | 교신마다 |
| 실제 GPU 계산(`for segment in segments`) | 교신마다 |
| 지어낸 문장 거르기, 자신감 계산 | 교신마다 |
| GPU 실패 시 CPU로 | 실패할 때만 |

> **알게 된 점** — "모델 돌리기"를 줄 단위로 보니 핵심은 둘이었다. 한 번 올리고, 계속 넣는다. 첫 교신만 8~10초 걸리고 그다음부터 1~2초인 이유가 이 구조에 있다.
