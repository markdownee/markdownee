#!/usr/bin/env bash
# Build native Python artifacts and run the examples from the installed wheel.
# Requirements: uv and Python 3.12. Build/runtime dependencies are downloaded.
# Pass a local Trafilatura Core wheel as the optional first argument.
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "${EXAMPLE_DIR}/../.." && pwd)"
WORKTREE_ROOT="$(git -C "${ENGINE_ROOT}" rev-parse --show-toplevel)"
PY_PKG="${ENGINE_ROOT}/packages/standalone-python"
mkdir -p "${WORKTREE_ROOT}/temp"
RUN_DIR="$(mktemp -d "${WORKTREE_ROOT}/temp/markdownee-python-example.XXXXXX")"
uv build --python 3.12 --out-dir "${RUN_DIR}/dist" "${PY_PKG}"
uv venv --python 3.12 "${RUN_DIR}/venv"
PYTHON="${RUN_DIR}/venv/bin/python"
if [ "$#" -gt 0 ]; then
  uv pip install --python "${PYTHON}" "${RUN_DIR}"/dist/markdownee-*.whl "$1"
else
  uv pip install --python "${PYTHON}" "${RUN_DIR}"/dist/markdownee-*.whl
fi
cd "${RUN_DIR}"

echo ">>> run main.py (sync extract)"
"${PYTHON}" "${EXAMPLE_DIR}/main.py"

echo ">>> run async_example.py (async acrawl)"
"${PYTHON}" "${EXAMPLE_DIR}/async_example.py"

echo ">>> artifacts, virtual environment, and exports: ${RUN_DIR}"
