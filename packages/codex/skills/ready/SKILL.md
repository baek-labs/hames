---
name: ready
description: Prepare and present a bounded task contract for same-session approval by /go when the user invokes /ready.
---

# Ready

Turn the user's intent into a complete, readable Hames contract. Do not start execution.

Read `.hames/config.yaml`, the selected workspace, and applicable project rules before drafting the contract.

Use project evidence and choices already stated by the user before asking questions. Ask only about unresolved choices that would change the result.

Record the goal, targets, actions, allowed and denied scope, outputs, invariants, acceptance criteria, evidence, and risk. Also record deliverable locations, work steps and dependencies, review policy, and durable-knowledge destinations. Require independent review for behavior, API, permission, data-processing, external-state, or complex judgment-heavy work; use direct verification for simple reversible work.

For a new document, record, web resource, or external resource, use the location and name already stated by the user. Ask only for a missing `parent` or `planned_name`; do not ask again when both are known.

Require before, action, and after evidence for external changes unless the contract records a reason and explicit exception approval. Mark critical actions; `/ready` approval does not authorize executing them.

Show goal, scope, outputs, work order, review policy, and acceptance criteria before the complete machine specification. Use `present` to tie the display to the project, session, task, revision, specification hash, and display digest, then move it to `READY` without recording approval.

Tell the user that `/go` in the same conversation approves and activates exactly this presented contract. Do not request a separate approval reply. A changed contract must be presented again.

Use the bundled `runtime/contract.js` `draft`, `amend`, and `present` commands. Retain `approve` only for compatible explicit-approval flows. Stage machine input only under ignored `.hames/state/` and include no secret values.
