# Finance fork CI

The `feature/devops-environments` branch adds `.github/workflows/finance-image.yml`.
It builds the existing Dockerfile for linux/amd64, including backend/frontend
lint and unit tests. Feature branches and PRs build without publishing. Main
publishes `ghcr.io/bioshock20129-del/ezbookkeeping:sha-<commit>` using the workflow's
`GITHUB_TOKEN` with `packages:write`.

The immutable repository@sha256 reference is recorded in the bookkeeping-image
artifact and job summary. Set this reference as `DEV_BOOKKEEPING_IMAGE` in
finance-system, then run its main CI to assemble and test a system release.
There is no deployment from this repository and no cross-repository PAT.
For private GHCR packages, grant finance-system Actions read access to the package.

Upstream snapshot/release/non-main packaging matrices remain available in the
original mayswind repository. Their setup jobs are gated to that repository;
our fork uses the single finance image workflow to avoid duplicate multi-platform
builds. No application code or Docker build flags are changed.

Full environment/bootstrap/deployment instructions are maintained in
`finance-system/docs/devops.ru.md` on the same feature branch. Existing prod
containers are not switched by merging these workflow changes; image promotion
is configured and performed separately in finance-system.
