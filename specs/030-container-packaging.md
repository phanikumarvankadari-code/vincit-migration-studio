# SPEC-030 Container Packaging

## Objective
Package the finished local app as a container image so it runs anywhere Docker runs, without changing local-first behavior.

## Inputs
Built static app (`apps/mapping-studio/dist`), a host folder mounted as `/data`.

## Outputs
Image `migration-mapping-studio:local`, serving the app on port 8080 (published on 127.0.0.1 only by default).

## Functional Requirements
1. Multi-stage build: Node 22 builds; runtime is nginx-unprivileged serving static files only. Base images pinned to versions.
2. Non-root runtime user. Read-only root filesystem works. `no-new-privileges`.
3. Healthcheck at `/healthz`.
4. User data (sources, projects, output) is on a mounted volume at `/data` (read-only listing at `/data/`), never inside the image. No cloud dependency, no network calls at runtime.
5. SPA fallback to `index.html`; hashed assets cached long, `index.html` never.
6. Project work-in-progress still autosaves in the browser (localStorage); the volume holds files.

## Acceptance Criteria
- AC-1 `docker build` produces the image.
- AC-2 `docker run` serves the app; `/healthz` returns 200; container reports healthy.
- AC-3 Process runs as non-root.
- AC-4 A file placed in the mounted folder is listed and downloadable at `/data/`.
- AC-5 Playwright smoke test passes against the running container: app loads, a CSV from the volume is imported through the Sources stage.
- AC-6 Image holds no test data and no user data.

## Out of Scope
Server-side persistence, authentication, TLS, cloud deployment, multi-user.

## Test Command
`npm run e2e:container` (builds, runs, tests, stops the container).
