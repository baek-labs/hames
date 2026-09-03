# Safety model

Hames treats approval, execution, evidence, and acceptance as separate decisions.

`/setup` previews carry a digest of the exact project root and proposed operations. Apply requires that same digest, so a project change between preview and approval produces a new preview instead of silently applying a different plan.

Interrupted setup recovery is also preview-first. Hames validates the journal schema, canonical managed paths, project root, plan digest, and current file contents; rollback requires the exact recovery digest and a new explicit approval.

## Specification integrity

The specification hash covers the task ID, project identifier, goal, targets, actions, allowed and denied scope, outputs, invariants, acceptance criteria, evidence requirements, exceptions, and risk. Object keys are sorted, array order is preserved, and relative paths are normalized. Lifecycle state, timestamps, approval, events, evidence, and results do not affect the hash.

Changing the specification increments the revision and invalidates approval, evidence, and session pointers. Execution cannot continue until the revised contract is approved and activated again.

## File boundary

The file guard compares write targets with the project root, denied patterns, approved patterns, and declared file targets. It rejects absolute or `..` escape and resolves existing ancestors so a symlink cannot carry a new file outside the project.

Shell inspection is best-effort. A command string is not a complete sandbox, and some tools or UI interactions do not expose a structure that a hook can confidently classify. Hames only claims mechanical enforcement when the hook input identifies the target and action or exposes a concrete file path.

## Critical actions

Deletion, destructive overwrite, sending, publication, deployment, payment, permission or security changes, and impactful external mutations remain critical. A project may add more critical actions but cannot weaken these defaults.

Contract approval and `/go` do not authorize a critical action. Immediately before execution, Hames must show the target, action, and expected impact and receive a short-lived, single-use confirmation tied to the active session, target, action, revision, and specification hash.

## Evidence

External changes normally require three observations: before, action, and after. A reduced set is allowed only when the contract states why a pre-state is unavailable and records explicit user approval for the exception. If the result cannot be read back, the action is not reported as successful.

Each evidence requirement includes a machine predicate. The post-tool hook derives pass/fail, exit or service status, matched fields, and output digest from the observed tool response; caller-supplied pass flags, assertions, and digests are ignored. External phases are ordered and their resource identifiers must remain consistent. Stored evidence contains only time, target and action IDs, method, derived status, digest, and minimal safe summaries. API keys, passwords, authentication tokens, raw messages, unnecessary personal data, and full tool output are excluded.

External tools do not need Hames-specific fields in their schemas. Before execution, Hames uniquely matches the tool provider, observed action kind, and real resource ID—or a create operation's parent, name, and resource type—to the active contract. The same pending match links the observed post-tool response to the next unmet before, action, or after evidence requirement. Zero or multiple matches stop the operation.

`REVIEW` requires every declared evidence item to pass and a complete requirement-to-output mapping. Evidence and execution are frozen in `REVIEW`; acceptance rechecks the evidence linkage and the result document digest. Technical evidence never grants user acceptance.
