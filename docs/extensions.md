# Extensions

Hames Core intentionally exposes only `/setup`, `/ready`, `/go`, and `/doctor`. Optional behavior should be shipped as a separate plugin or pack instead of adding fixed assumptions to Core.

Potential packs include:

- Git workflows such as save, pull, or submodule publication
- Role or team routing
- Knowledge and research workflows
- Document, content, image, or video production

## Extension contract

An extension may add skills, hook handlers, runtime helpers, schemas, or templates through its own manifest. It must treat the Core `contract.json` as read-only authority, use declared target and evidence types, and never grant approval, acceptance, or a wider scope.

Project-specific extension settings belong under the extension's unique key in `.hames/config.yaml` `extensions`. Core ignores unknown extension keys; the owning extension validates its own object.

Extensions may add critical-action categories in project configuration. They may not remove Core categories. New target or evidence types require an explicit schema version and a Core compatibility declaration; silent reinterpretation is not allowed.

No optional pack is implemented or bundled in the current Core packages.
