import json
import os
import sys
import time


MODEL_NAME = os.environ.get("ONION_TRANSCRIPTION_MODEL", "small").strip() or "small"
DEVICE = os.environ.get("ONION_TRANSCRIPTION_DEVICE", "cpu").strip() or "cpu"
COMPUTE_TYPE = os.environ.get("ONION_TRANSCRIPTION_COMPUTE_TYPE", "int8").strip() or "int8"
MODEL_CACHE = os.environ.get("HF_HOME", "").strip() or None
model = None

try:
    import onnxruntime  # noqa: F401
    VAD_AVAILABLE = True
except Exception:
    VAD_AVAILABLE = False


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel

        model = WhisperModel(
            MODEL_NAME,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_CACHE,
        )
    return model


def transcribe(job):
    file_path = str(job.get("filePath") or "")
    if not file_path or not os.path.isfile(file_path):
        raise FileNotFoundError("Arquivo de áudio local não encontrado")

    started_at = time.monotonic()
    options = {
        "language": "pt",
        "beam_size": 5,
        "vad_filter": VAD_AVAILABLE,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.6,
        "hallucination_silence_threshold": 2.0,
    }
    if VAD_AVAILABLE:
        options["vad_parameters"] = {"min_silence_duration_ms": 500}
    segments, info = get_model().transcribe(file_path, **options)
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return {
        "ok": True,
        "id": job.get("id"),
        "text": text,
        "language": getattr(info, "language", "pt") or "pt",
        "duration": getattr(info, "duration", None),
        "elapsedSeconds": round(time.monotonic() - started_at, 3),
    }


for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue
    request_id = None
    try:
        request = json.loads(raw_line)
        request_id = request.get("id")
        respond(transcribe(request))
    except Exception as exc:
        respond({"ok": False, "id": request_id, "error": str(exc)[:500]})
