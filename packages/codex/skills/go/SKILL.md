---
name: go
description: Execute an approved Hames task contract when the user invokes /go.
---

# Go

Activate only the contract the user selected, execute within its bounds, and collect the required evidence.

Require a `task_id`. Without one, propose the single `READY` contract created by this session and wait for confirmation; with zero or multiple candidates, show choices and never select the newest automatically.

Before activation, verify project root, `READY` state, current-user approval, revision, specification hash, and session availability. Never clear or replace a mismatched pointer automatically.

Immediately before every critical action, show its target, action, and expected impact and obtain a separate explicit confirmation. `/ready` approval and `/go` do not replace this confirmation.

Stop if scope must change, a required result cannot be observed, or the contract changes. Record only safe evidence metadata; never store tokens, credentials, raw messages, personal data, or full tool output.

Move to `REVIEW` only when every required evidence item passes. Present requirement-to-artifact results and limitations, wait for current-user acceptance, then transition through `ACCEPTED` and archive the same package internally.

Use the bundled `runtime/contract.js` `candidate`, `activate`, `confirm-critical`, `review`, and `accept` commands. Evidence is accepted only from the bundled post-tool hook's observed response; never manufacture or manually mark evidence as passed. Never pass the approval, confirmation, or acceptance flags before the corresponding current-user message.

After creating a remote resource, compare its returned identifier, parent, name, and type with the contract. Stop on mismatch or duplicate creation; attach the generated identifier to evidence and results without changing the specification.
