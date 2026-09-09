# Architecture

Hames connects four responsibilities that are often left as prompt conventions:

1. `/setup` configures a project without owning the project itself.
2. `/ready` separates user intent from implementation, presents a readable contract, and records its work order, review policy, and durable-knowledge destinations.
3. `/go` approves the exact contract just presented in the same session, binds execution to it, records dependency-aware progress, and collects required evidence.
4. Hooks check what they can observe before and after tool use; `/doctor` diagnoses drift without changing it.

## Source and distribution

`src/` owns all human-edited product behavior:

```text
src/
├── skills/{setup,ready,go,doctor}/
├── hooks/
├── runtime/
├── legacy/manifests/
├── schemas/
└── templates/
```

`platform/codex/plugin.json` and `platform/claude/plugin.json` contain host manifest differences. `scripts/build.mjs` copies the shared source into `packages/codex` and `packages/claude`, then installs the appropriate manifest. Package replacement is staged and recoverable if the build is interrupted. The build uses no network service and has no runtime package dependencies.

Legacy manifests are immutable, history-derived evidence used only by `/setup`. They let a current plugin recognize previously distributed public Hames system files without treating a folder name, user file, or live network response as authority.

## Project state

Long-lived project choices live in `.hames/config.yaml`, `.hames/workspaces/`, and `.hames/context/`. Task contracts live in `.hames/contracts/`. Session pointers and setup recovery state live in `.hames/state/`, which is always ignored by Git.

The contract machine uses:

```text
DRAFT → READY → ACTIVE → REVIEW → ACCEPTED → ARCHIVED
```

`contract.json` is authoritative. `contract.md` is generated for human approval. `events.jsonl` records transitions, `evidence.json` stores safe metadata, and `result.md` maps requirements to artifacts and limitations.

`progress.json` records work-step state and repeated failure points without changing the approved specification. `review.json` binds one safe independent-review checklist to the completed progress, evidence, and reviewed artifact digests. `knowledge.json` records whether approved durable destinations were applied or deferred. A presentation is tied to its session, revision, specification hash, and rendered digest; `/go` may approve it directly only from that same session.

## Concurrency and recovery

A session can bind to only one active contract, and a contract cannot be active in two sessions. The same session can resume its valid active contract from recorded progress. A different session requires a confirmed handoff after the prior session ended or yielded safely. Revision, specification hash, project root, and contract path remain repeated in the session pointer.
