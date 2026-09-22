# Intent before execution

Adapted from the bundled DryForge source identified in `integrations/dryforge/provenance.json`.

Treat an input as material: distinguish observed facts, user preferences, proposed solutions, and contradictions. Inspect the selected workspace and relevant files for answers before asking the user. Do not promote an assumption to a requirement simply because implementation would be convenient.

For each affected object, consider identity and scope, behavior over time, data/interface consistency, and required outputs. Decisions directly grounded in the user's request can be recorded. Adjustable implementation details can use documented defaults. Ask about remaining decisions that change the result, one at a time with a recommendation. Resolve dependent choices in order. A broad plan must not silently impose fixed workspace categories, a Git workflow, or another plugin.

Once the decisions are resolved, produce one self-contained Hames contract: what is required (spec), the work order (plan), and the invariant rules and approved knowledge destinations an executor must preserve (handoff). Required verification must be observable, not an agent's confidence. Explain inaccessible verification before execution.

For decisions involving multiple interacting entities or substantial judgment, use one independent read-only check for unsupported assumptions. Before presenting a complex contract, have a reviewer inspect the contract without the conversation for execution blockers. Resolve real user choices with the user; do not invent answers to satisfy a reviewer. Small reversible work does not need this ceremony.

Preserve the exact presented revision for approval. Only the user's explicit invocation activates the selected contract. Facts discovered during execution do not silently expand the approved scope.
