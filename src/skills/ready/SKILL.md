---
name: ready
description: Prepare and approve a bounded task contract when the user invokes /ready.
---

# Ready

Turn the user's intent into a reviewable Hames contract. Do not start execution.

Read `.hames/config.yaml`, the selected workspace, and applicable project rules before drafting the contract.

Record the goal, targets, actions, allowed and denied scope, outputs, invariants, acceptance criteria, evidence, and risk without choosing implementation details for the user.

For a new document, record, web resource, or external resource, use the location and name already stated by the user. Ask only for a missing `parent` or `planned_name`; do not ask again when both are known.

Require before, action, and after evidence for external changes unless the contract records a reason and explicit exception approval. Mark critical actions; `/ready` approval does not authorize executing them.

Show the human-readable contract and wait for current-user approval. Only then record approval tied to the exact revision and specification hash and move the contract to `READY`.

Use the bundled `runtime/contract.js` `draft`, `amend`, and `approve` commands. Stage machine input only under ignored `.hames/state/`, include no secret values, and pass `--approved` only after the user approves the displayed `contract.md`.
