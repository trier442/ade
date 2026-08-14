from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import sys
import time
import traceback
from pathlib import Path
from typing import Any


def write_event(event: str, **payload: Any) -> None:
    """Write machine-readable progress events to stderr."""
    message = {"event": event, **payload}
    print(json.dumps(message, ensure_ascii=False), file=sys.stderr, flush=True)


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def self_test() -> int:
    try:
        import av  # noqa: F401
        import ctranslate2
        import faster_whisper

        result = {
            "ok": True,
            "python": platform.python_version(),
            "platform": platform.platform(),
            "faster_whisper": package_version("faster-whisper"),
            "ctranslate2": package_version("ctranslate2"),
            "av": package_version("av"),
            "cuda_devices": int(ctranslate2.get_cuda_device_count()),
            "module": str(Path(faster_whisper.__file__).resolve()),
        }
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


def choose_runtime(requested_device: str, requested_compute_type: str) -> tuple[str, str]:
    import ctranslate2

    device = requested_device
    if device == "auto":
        allow_cuda = os.getenv("ADE_ALLOW_CUDA", "0").strip().lower() in {"1", "true", "yes"}
        device = "cuda" if allow_cuda and ctranslate2.get_cuda_device_count() > 0 else "cpu"

    compute_type = requested_compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    return device, compute_type


def profile_options(profile: str) -> dict[str, Any]:
    """Return conservative presets for long classroom recordings."""
    if profile == "quiet":
        return {
            "vad_filter": False,
            "vad_parameters": None,
            "condition_on_previous_text": False,
            "no_speech_threshold": 0.75,
        }
    if profile == "fast":
        return {
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 900,
                "speech_pad_ms": 250,
            },
            "condition_on_previous_text": False,
            "no_speech_threshold": 0.65,
        }
    return {
        "vad_filter": True,
        "vad_parameters": {
            "min_silence_duration_ms": 1500,
            "speech_pad_ms": 400,
        },
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.70,
    }


def serialize_word(word: Any) -> dict[str, Any]:
    return {
        "start": round(float(word.start), 3) if word.start is not None else None,
        "end": round(float(word.end), 3) if word.end is not None else None,
        "word": str(word.word),
        "probability": round(float(word.probability), 5) if word.probability is not None else None,
    }


def serialize_segment(index: int, segment: Any) -> dict[str, Any]:
    words = [serialize_word(word) for word in (segment.words or [])]
    return {
        "id": f"fw_{index + 1}",
        "start": round(float(segment.start), 3),
        "end": round(float(segment.end), 3),
        "speaker": "미지정",
        "text": str(segment.text).strip(),
        "words": words,
        "avg_logprob": round(float(getattr(segment, "avg_logprob", 0.0)), 5),
        "no_speech_prob": round(float(getattr(segment, "no_speech_prob", 0.0)), 5),
        "compression_ratio": round(float(getattr(segment, "compression_ratio", 0.0)), 5),
    }


def transcribe(args: argparse.Namespace) -> dict[str, Any]:
    from faster_whisper import WhisperModel

    input_path = Path(args.input).resolve()
    model_path = Path(args.model).resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Audio file was not found: {input_path}")
    if not model_path.is_dir():
        raise FileNotFoundError(
            f"Faster-Whisper model directory was not found: {model_path}. "
            "Install the ADE model pack first."
        )

    device, compute_type = choose_runtime(args.device, args.compute_type)
    options = profile_options(args.profile)
    started = time.perf_counter()

    write_event(
        "loading_model",
        model=str(model_path),
        device=device,
        compute_type=compute_type,
        profile=args.profile,
    )

    try:
        model = WhisperModel(
            str(model_path),
            device=device,
            compute_type=compute_type,
            cpu_threads=args.threads,
            num_workers=1,
        )
    except Exception as exc:
        if device == "cuda" and args.device == "auto":
            write_event("warning", message=f"CUDA initialization failed; falling back to CPU: {exc}")
            device, compute_type = "cpu", "int8"
            model = WhisperModel(
                str(model_path),
                device=device,
                compute_type=compute_type,
                cpu_threads=args.threads,
                num_workers=1,
            )
        else:
            raise

    kwargs: dict[str, Any] = {
        "language": None if args.language == "auto" else args.language,
        "beam_size": args.beam_size,
        "best_of": args.best_of,
        "temperature": 0.0,
        "word_timestamps": True,
        "vad_filter": options["vad_filter"],
        "condition_on_previous_text": options["condition_on_previous_text"],
        "no_speech_threshold": options["no_speech_threshold"],
        "initial_prompt": args.initial_prompt or None,
        "log_progress": True,
    }
    if options["vad_parameters"] is not None:
        kwargs["vad_parameters"] = options["vad_parameters"]

    write_event("transcribing", input=str(input_path))
    segment_iter, info = model.transcribe(str(input_path), **kwargs)

    segments: list[dict[str, Any]] = []
    for index, segment in enumerate(segment_iter):
        item = serialize_segment(index, segment)
        if item["text"]:
            segments.append(item)
            write_event(
                "segment",
                index=len(segments),
                start=item["start"],
                end=item["end"],
                text=item["text"],
            )

    elapsed = time.perf_counter() - started
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    if duration <= 0 and segments:
        duration = float(segments[-1]["end"])

    return {
        "ok": True,
        "engine": "faster-whisper",
        "engine_version": package_version("faster-whisper"),
        "model": model_path.name,
        "model_path": str(model_path),
        "device": device,
        "compute_type": compute_type,
        "profile": args.profile,
        "language": str(getattr(info, "language", args.language)),
        "language_probability": round(float(getattr(info, "language_probability", 0.0)), 5),
        "duration": round(duration, 3),
        "elapsed_seconds": round(elapsed, 3),
        "text": " ".join(item["text"] for item in segments).strip(),
        "segments": segments,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ADE offline Faster-Whisper transcription worker")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--model")
    parser.add_argument("--language", default="ko")
    parser.add_argument("--profile", choices=["classroom", "quiet", "fast"], default="classroom")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument(
        "--compute-type",
        choices=["auto", "int8", "int8_float16", "float16", "float32"],
        default="auto",
    )
    parser.add_argument("--threads", type=int, default=max(2, min(12, os.cpu_count() or 4)))
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--best-of", type=int, default=5)
    parser.add_argument("--initial-prompt", default="")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.input or not args.output or not args.model:
        parser.error("--input, --output and --model are required unless --self-test is used")

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = transcribe(args)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        write_event("complete", output=str(output_path), segments=len(result["segments"]))
        return 0
    except Exception as exc:
        error = {
            "ok": False,
            "error": str(exc),
            "type": type(exc).__name__,
            "traceback": traceback.format_exc(),
        }
        output_path.write_text(json.dumps(error, ensure_ascii=False, indent=2), encoding="utf-8")
        write_event("error", message=str(exc), error_type=type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
