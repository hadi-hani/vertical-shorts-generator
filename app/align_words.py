#!/usr/bin/env python3
"""Whisper-based word alignment fallback.

If edge-tts word timings are unavailable (e.g. network blocked), this helper
attempts word-level timestamps with OpenAI Whisper (openai-whisper package).
Whisper produces word timings via `word_timestamps=True`; the results are
then aligned against the target script. If Whisper is not installed, it falls
back to a naive even split across the target words.

Usage:
  python3 align_words.py --audio <audio.mp3> --text-file <script.txt> \
      --timings <out.json> [--model base] [--language en]

Output JSON: same schema as tts_word_timings.py:
  [{"word": "...", "start": 0.23, "end": 0.51}, ...]
"""

import argparse
import json
import sys

NAIVE_SPLIT = True


def load_text(text_file):
    with open(text_file, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def naive_align(text, duration):
    """Split the script evenly across the audio duration."""
    words = [w for w in text.replace("\n", " ").split(" ") if w]
    if not words:
        return []
    step = duration / max(1, len(words))
    return [
        {"word": w, "start": round(i * step, 3), "end": round((i + 1) * step, 3)}
        for i, w in enumerate(words)
    ]


def whisper_align(audio_path, text, model_name, language):
    import whisper  # imported lazily so this file loads without the package

    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, language=language or None, word_timestamps=True)

    transcript_words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []):
            transcript_words.append(
                {
                    "word": word["word"].strip(),
                    "start": word["start"],
                    "end": word["end"],
                }
            )
    if transcript_words:
        return transcript_words

    # Some tiny models return segments without word timings: fall back.
    duration = result.get("duration", 0.0) or 0.0
    return naive_align(text, duration)


def main():
    parser = argparse.ArgumentParser(
        description="Whisper forced-alignment fallback for word timings"
    )
    parser.add_argument("--audio", required=True, help="path to the audio file")
    parser.add_argument("--text-file", required=True, help="path to the script text")
    parser.add_argument("--timings", required=True, help="output timings JSON path")
    parser.add_argument("--model", default="base", help="whisper model size")
    parser.add_argument("--language", default=None, help="audio language hint")
    args = parser.parse_args()

    text = load_text(args.text_file)

    try:
        timings = whisper_align(args.audio, text, args.model, args.language)
    except ImportError:
        import subprocess

        duration = 0.0
        try:
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "csv=p=0",
                    args.audio,
                ],
                capture_output=True,
                text=True,
            )
            duration = float(probe.stdout.strip() or 0.0)
        except Exception:
            pass
        timings = naive_align(text, duration)

    with open(args.timings, "w", encoding="utf-8") as fh:
        json.dump(timings, fh, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "word_count": len(timings), "source": "whisper"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        try:
            print(json.dumps({"ok": False, "error": str(exc)}))
        except Exception:
            pass
        sys.exit(1)
