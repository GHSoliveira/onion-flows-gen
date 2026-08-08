import json
import os
import sys
import time


DEFAULT_MODEL_NAME = os.environ.get("ONION_TRANSCRIPTION_MODEL", "small").strip() or "small"
PARTIAL_MODEL_NAME = os.environ.get("ONION_TRANSCRIPTION_PARTIAL_MODEL", "base").strip() or "base"
DEVICE = os.environ.get("ONION_TRANSCRIPTION_DEVICE", "cpu").strip() or "cpu"
COMPUTE_TYPE = os.environ.get("ONION_TRANSCRIPTION_COMPUTE_TYPE", "int8").strip() or "int8"
MODEL_CACHE = os.environ.get("HF_HOME", "").strip() or None
ALLOWED_MODELS = {DEFAULT_MODEL_NAME, PARTIAL_MODEL_NAME}
models = {}

try:
    import onnxruntime  # noqa: F401
    VAD_AVAILABLE = True
except Exception:
    VAD_AVAILABLE = False


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_model(model_name):
    safe_model_name = model_name if model_name in ALLOWED_MODELS else DEFAULT_MODEL_NAME
    if safe_model_name not in models:
        from faster_whisper import WhisperModel

        models[safe_model_name] = WhisperModel(
            safe_model_name,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=MODEL_CACHE,
        )
    return models[safe_model_name], safe_model_name


def warmup(job):
    _, model_name = get_model(str(job.get("model") or DEFAULT_MODEL_NAME))
    return {
        "ok": True,
        "id": job.get("id"),
        "warmed": True,
        "model": model_name,
    }


def transcribe(job):
    file_path = str(job.get("filePath") or "")
    if not file_path or not os.path.isfile(file_path):
        raise FileNotFoundError("Arquivo de áudio local não encontrado")

    started_at = time.monotonic()
    model, model_name = get_model(str(job.get("model") or DEFAULT_MODEL_NAME))
    try:
        beam_size = max(1, min(5, int(job.get("beamSize") or 5)))
    except (TypeError, ValueError):
        beam_size = 5
    use_vad = VAD_AVAILABLE and job.get("vadFilter") is not False
    options = {
        "language": "pt",
        "beam_size": beam_size,
        "vad_filter": use_vad,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.6,
        "hallucination_silence_threshold": 2.0,
    }
    if use_vad:
        options["vad_parameters"] = {"min_silence_duration_ms": 500}
    segments, info = model.transcribe(file_path, **options)
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return {
        "ok": True,
        "id": job.get("id"),
        "text": text,
        "language": getattr(info, "language", "pt") or "pt",
        "duration": getattr(info, "duration", None),
        "model": model_name,
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
        if request.get("action") == "warmup":
            respond(warmup(request))
        else:
            respond(transcribe(request))
    except Exception as exc:
        respond({"ok": False, "id": request_id, "error": str(exc)[:500]})
