#!/bin/sh
# App test command — make test runs this. App-owned: survives make upgrade.
set -e
echo "==> smoke test"
node test/smoke.js
