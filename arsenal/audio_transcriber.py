"""
Hames OS — Audio Transcriber
.Arsenal/audio_transcriber.py

faster-whisper(large-v3) 기반 로컬 음성 전사 도구.
회의 녹음(.m4a/.mp3/.wav 등)을 텍스트로 변환한다.

Usage:
    python audio_transcriber.py <audio_path> [<audio_path> ...] [options]

Options:
    --output <path>   결과 저장 경로 (미지정 시 stdout)
    --language <code> 언어 코드 (기본 ko). en/ja/zh 등
    --model <name>    모델 크기 (기본 large-v3). tiny/base/small/medium/large-v3
    --device <name>   cpu | cuda (기본 cpu)
    --srt             SRT 자막 형식으로도 저장 (--output 옆에 .srt)

Examples:
    python audio_transcriber.py meeting.m4a
    python audio_transcriber.py rec1.m4a rec2.m4a --output transcript.txt
    python audio_transcriber.py interview.wav --language en --model medium
"""

import argparse
import sys
from pathlib import Path


def _format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def transcribe(audio_path: Path, model, language: str):
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )
    return list(segments), info


def main():
    parser = argparse.ArgumentParser(description="faster-whisper local transcriber")
    parser.add_argument("audio", nargs="+", help="오디오 파일 경로 (1개 이상)")
    parser.add_argument("--output", help="텍스트 저장 경로 (미지정 시 stdout)")
    parser.add_argument("--language", default="ko")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--srt", action="store_true", help="SRT 자막 동시 저장")
    args = parser.parse_args()

    paths = [Path(p) for p in args.audio]
    for p in paths:
        if not p.exists():
            print(f"Error: 파일 없음 — {p}", file=sys.stderr)
            sys.exit(1)

    print(f"[transcriber] 모델 로드 중 ({args.model}, {args.device})...", file=sys.stderr, flush=True)
    from faster_whisper import WhisperModel
    compute_type = "int8" if args.device == "cpu" else "float16"
    model = WhisperModel(args.model, device=args.device, compute_type=compute_type)

    text_chunks = []
    srt_chunks = []
    for p in paths:
        size_mb = p.stat().st_size / 1024 / 1024
        print(f"[transcriber] 전사: {p.name} ({size_mb:.2f} MB)", file=sys.stderr, flush=True)
        segments, info = transcribe(p, model, args.language)
        print(f"[transcriber]  └ duration={info.duration:.1f}s, lang={info.language}", file=sys.stderr, flush=True)

        text_chunks.append(f"=== {p.name} ===")
        for seg in segments:
            text_chunks.append(seg.text.strip())
        text_chunks.append("")

        if args.srt:
            for i, seg in enumerate(segments, 1):
                srt_chunks.append(
                    f"{i}\n{_format_timestamp(seg.start)} --> {_format_timestamp(seg.end)}\n{seg.text.strip()}\n"
                )

    transcript = "\n".join(text_chunks)

    if args.output:
        out = Path(args.output)
        out.write_text(transcript, encoding="utf-8")
        print(f"[transcriber] 저장: {out}", file=sys.stderr)
        if args.srt and srt_chunks:
            srt_path = out.with_suffix(".srt")
            srt_path.write_text("\n".join(srt_chunks), encoding="utf-8")
            print(f"[transcriber] SRT 저장: {srt_path}", file=sys.stderr)
    else:
        print(transcript)


if __name__ == "__main__":
    main()
