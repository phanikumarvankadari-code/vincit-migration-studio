#!/usr/bin/env bash
# Build the image, run it, check health/non-root/no user data in image, run the Playwright smoke test, stop it.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=mms-smoke
PORT=${MMS_PORT:-18080}
docker build -q -f container/Dockerfile -t migration-mapping-studio:local .
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true -v "$PWD/test-data:/data:ro" migration-mapping-studio:local >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] || { echo "container not healthy"; docker logs "$NAME"; exit 1; }
UID_IN=$(docker exec "$NAME" id -u)
[ "$UID_IN" != 0 ] || { echo "container runs as root"; exit 1; }
echo "non-root uid $UID_IN, healthy"
# AC-6: the image itself holds no test data
docker run --rm --entrypoint sh migration-mapping-studio:local -c 'test -z "$(ls -A /data 2>/dev/null)"' || { echo "image contains data"; exit 1; }
(cd apps/mapping-studio && MMS_URL="http://127.0.0.1:$PORT" npx playwright test -c playwright.container.config.ts)
