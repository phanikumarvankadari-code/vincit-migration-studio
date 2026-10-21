# M9 Container: test cases

Spec: `specs/030-container-packaging.md`. Files: `container/` (Dockerfile, nginx.conf, docker-compose.yml, smoke.sh).

| ID | Proves |
|---|---|
| M9-01 to M9-05 | Static checks (`npm test`): pinned bases, non-root runtime, healthcheck, volume, no data in image, compose hardening, smoke test present |
| Smoke (`npm run e2e:container`) | Builds the image, runs it read-only, waits healthy, checks non-root uid and an empty `/data` in the image, then Playwright: app loads, `/healthz`, volume file listed and downloadable, volume CSV imports through Sources, SPA fallback |

Run: `npm run e2e:container` (needs Docker; port 18080, override with `MMS_PORT`).
Run for use: `docker compose -f container/docker-compose.yml up --build`, then open http://127.0.0.1:8080. Set `MMS_DATA_DIR` to your folder.

Note: work in progress still autosaves in the browser (localStorage). The volume holds files, not project state.
