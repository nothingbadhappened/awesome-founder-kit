#!/usr/bin/env bash
# Builds the "python" fixture in the run's empty workspace (see evals/fixtures/build.sh).
d=$(cd "$(dirname "$0")" && pwd)
while [ "$d" != / ] && [ ! -f "$d/fixtures/build.sh" ]; do d=$(dirname "$d"); done
exec bash "$d/fixtures/build.sh" python
