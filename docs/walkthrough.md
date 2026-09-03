# Hames 개편 작업 기록

## 변경 내용

- 저장소 복제형 개인 운영체제 구조를 설치형 Hames 플러그인 구조로 교체했다.
- `src/`를 유일한 편집 정본으로 두고 Codex·Claude Code 패키지를 빌드로 생성하도록 했다.
- Core 명령을 `/setup`, `/ready`, `/go`, `/doctor` 네 개로 제한했다.
- 프로젝트 설정 미리보기와 승인 해시, 재실행 안전성, 실패 복구 기록을 구현했다.
- 파일·문서·레코드·웹·외부 서비스 계약, 상태 전환, 명세 해시, 세션 분리, 안전한 증거 메타데이터를 구현했다.
- 경로 이탈·심볼릭 링크·계약 변조·증거 누락·별도 확인 없는 중요 작업을 검사하는 훅을 추가했다.
- 고정 사용자, 고정 작업 공간, 고정 역할, 개인 도구, 호스트별 수동 사본, Cockpit 연결을 제거했다.
- 최초 공개 커밋부터 재설계 직전 커밋까지의 정적 manifest로 구형 공개 Hames를 판별하고, 원본 시스템 파일만 정리하는 같은 폴더 전환을 추가했다.

## 테스트 결과

- `node --test`: 자동화된 setup, contract, guard, distribution, documentation 검증을 실행한다.
- `node scripts/build.mjs`: 두 생성 패키지를 정본에서 다시 만든다.
- `node scripts/verify.mjs`: manifest·schema·hook·정본 일치·Core 명령 수·하드코딩 경계를 검사한다.
- Codex 패키지는 공식 plugin validator를 통과했다.
- Claude Code 패키지와 marketplace는 Claude CLI validator를 통과했다.

## 확인 근거와 제한

- Claude Code의 일회성 `--plugin-dir` 로드에서 네 스킬과 세 훅이 발견됐고, 새 print 세션에서 네 Core 명령을 인식했다.
- Codex CLI에는 전역 설정을 바꾸지 않는 일회성 로컬 플러그인 주입 경로가 확인되지 않았다. 패키지 검증은 통과했지만, 실제 Codex 새 세션 시험은 사용자 승인 후 로컬 marketplace 설치로 별도 확인해야 한다.
- Linux·macOS·Windows CI 매트릭스를 추가했지만, 이 로컬 실행에서는 원격 CI 세 운영체제 결과가 아직 생성되지 않았다.
- 훅의 구조화된 파일·도구 입력은 기계 검사하지만, 셸 문자열과 구조화되지 않은 브라우저·UI 작업은 완전한 격리 환경이 아니라 best-effort 경계다.
