"""
Hames OS — OpenAI Specialist Tool
.Arsenal/openai_specialist.py

Usage:
    python openai_specialist.py --role <role> --prompt "<query>" [options]

Roles:
    redteam   : 기획서/문서의 약점을 비판적으로 분석
    extract   : 비정형 텍스트 → 구조화된 JSON 추출
    general   : 범용 질의

Options:
    --role    : redteam | extract | general (필수)
    --prompt  : 질의 또는 지시사항 (필수)
    --file    : 입력 파일 경로 (선택 — 파일 내용을 프롬프트에 추가)
    --output  : 결과 저장 파일 경로 (선택 — 미지정 시 stdout 출력)
    --model   : 사용할 모델 (기본값: gpt-4o)
    --json    : 결과를 JSON으로 강제 출력 (extract 역할 시 자동 활성)

Example:
    python openai_specialist.py --role redteam --file plan.md --prompt "이 사업 계획서의 약점을 분석해줘" --output result.md
    python openai_specialist.py --role extract --file raw_data.txt --prompt "Extract date, amount, counterparty as JSON" --json
    python openai_specialist.py --role general --prompt "GPT-4o에게 직접 묻고 싶은 내용"
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# .env 로드 (.Arsenal 디렉토리 기준)
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("OPENAI_API_KEY")
if not API_KEY or API_KEY == "여기에_API_키_입력":
    print("Error: OPENAI_API_KEY가 .env에 설정되지 않았습니다.", file=sys.stderr)
    sys.exit(1)

# 역할별 시스템 프롬프트
SYSTEM_PROMPTS = {
    "redteam": (
        "You are a ruthless strategic auditor. Your job is to find flaws, blind spots, "
        "and logical gaps in the given plan or document. Be specific, numbered, and brutal. "
        "Do not offer encouragement. Output in Korean."
    ),
    "extract": (
        "You are a precise data extraction engine. Extract the requested information from "
        "the given text and return it as valid JSON only. No explanation, no markdown, just JSON."
    ),
    "general": (
        "You are a highly capable AI assistant. Answer concisely and accurately. "
        "Respond in the same language as the user's prompt."
    ),
}


def build_user_message(prompt: str, file_content: str | None) -> str:
    if file_content:
        return f"[입력 파일 내용]\n{file_content}\n\n[지시사항]\n{prompt}"
    return prompt


def main() -> None:
    parser = argparse.ArgumentParser(description="Hames OS — OpenAI Specialist Tool")
    parser.add_argument("--role", required=True, choices=["redteam", "extract", "general"])
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--file", default=None)
    parser.add_argument("--output", default=None)
    parser.add_argument("--model", default="gpt-5.3")
    parser.add_argument("--json", action="store_true", dest="force_json")
    args = parser.parse_args()

    # 입력 파일 읽기
    file_content = None
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: 파일을 찾을 수 없습니다 — {args.file}", file=sys.stderr)
            sys.exit(1)
        file_content = file_path.read_text(encoding="utf-8")

    # extract 역할은 JSON 모드 자동 활성
    force_json = args.force_json or args.role == "extract"

    client = OpenAI(api_key=API_KEY)

    response_format = {"type": "json_object"} if force_json else {"type": "text"}

    response = client.chat.completions.create(
        model=args.model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPTS[args.role]},
            {"role": "user", "content": build_user_message(args.prompt, file_content)},
        ],
        response_format=response_format,
    )

    result = response.choices[0].message.content

    # JSON 모드일 경우 pretty-print
    if force_json:
        try:
            result = json.dumps(json.loads(result), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass

    # 출력
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(result, encoding="utf-8")
        print(f"저장 완료: {output_path}")
    else:
        print(result)


if __name__ == "__main__":
    main()
