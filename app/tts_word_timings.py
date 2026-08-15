#!/usr/bin/env python3
"""edge-tts streaming helper: produces audio + precise word-level timings.

This helper streams text-to-speech from Microsoft Edge (via the edge-tts
package) and records WordBoundary events to produce a JSON timing file
consumed by the Node server to build animated ASS subtitles.

Usage:
  python3 tts_word_timings.py --voice <voice> [--text <text>|--text-file <path>]
      --audio <out.mp3> --timings <out.json> [--rate +0%]

Output JSON: a list of objects:
  [{"word": "...", "start": 0.23, "end": 0.51}, ...]

Time units are seconds with millisecond precision. WordBoundary offsets are
reported by edge-tts in 100-nanosecond ticks, converted to seconds here.
"""

import argparse
import asyncio
import json
import sys

import edge_tts

TICK = 1e7  # edge-tts reports offsets/durations in 100ns units


def load_text(args):
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as fh:
            return fh.read()
    if args.text:
        return args.text
    return sys.stdin.read()


async def synthesize(text, voice, rate, audio_path, timings_path):
    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    except TypeError:
        communicate = edge_tts.Communicate(text, voice, rate=rate)
    boundaries = []
    audio_chunks = []

    async for chunk in communicate.stream():
        ctype = chunk["type"]
        if ctype == "audio":
            audio_chunks.append(chunk["data"])
        elif ctype == "WordBoundary":
            start = chunk["offset"] / TICK
            end = start + chunk["duration"] / TICK
            word = chunk["text"]
            boundaries.append(
                {
                    "word": word,
                    "start": round(start, 3),
                    "end": round(end, 3),
                }
            )

    with open(audio_path, "wb") as fh:
        for data in audio_chunks:
            fh.write(data)

    with open(timings_path, "w", encoding="utf-8") as fh:
        json.dump(boundaries, fh, ensure_ascii=False, indent=2)

    return boundaries


def main():
    parser = argparse.ArgumentParser(
        description="edge-tts helper producing audio + word timings"
    )
    parser.add_argument("--voice", required=True, help="edge-tts voice name")
    parser.add_argument("--text", default=None, help="text to synthesize (inline)")
    parser.add_argument(
        "--text-file", default=None, help="path to a text file (preferred for long/RTL text)"
    )
    parser.add_argument("--audio", required=True, help="output audio file path")
    parser.add_argument("--timings", required=True, help="output timings JSON path")
    parser.add_argument("--rate", default="+0%", help="speaking rate, e.g. +0%, -10%")
    args = parser.parse_args()

    text = load_text(args).strip()
    if not text:
        print(json.dumps({"ok": False, "error": "empty text"}))
        sys.exit(1)

    boundaries = asyncio.run(
        synthesize(text, args.voice, args.rate, args.audio, args.timings)
    )
    print(json.dumps({"ok": True, "word_count": len(boundaries)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        try:
            print(json.dumps({"ok": False, "error": str(exc)}))
        except Exception:
            pass
        sys.exit(1)
