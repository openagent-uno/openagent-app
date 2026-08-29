#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Test ──
# Run linting, type checks, and tests.
#
# Usage:
#   ./test.sh               Run all checks
#   ./test.sh lint          ESLint only
#   ./test.sh types         TypeScript type check only
#   ./test.sh unit          Universal + Electron unit/contract tests
#   ./test.sh e2e           Two real Electron/host-tools E2E passes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-all}"
FAILURES=0

run_lint() {
    echo "🔍 ESLint..."
    cd "$SCRIPT_DIR/universal"
    npx eslint . --ext .ts,.tsx || FAILURES=$((FAILURES + 1))
    echo ""
}

run_types() {
    echo "📐 TypeScript..."
    cd "$SCRIPT_DIR/universal"
    npx tsc --noEmit || FAILURES=$((FAILURES + 1))

    cd "$SCRIPT_DIR/desktop"
    npx tsc --noEmit || FAILURES=$((FAILURES + 1))
    echo ""
}

run_unit() {
    echo "🧪 Universal unit tests..."
    cd "$SCRIPT_DIR/universal"
    npx jest --passWithNoTests || FAILURES=$((FAILURES + 1))

    echo "🧪 Electron main/network/capability tests..."
    cd "$SCRIPT_DIR/desktop"
    npm test || FAILURES=$((FAILURES + 1))
    echo ""
}

run_e2e() {
    echo "🧪 Electron + real local host-tools E2E (two passes)..."
    cd "$SCRIPT_DIR/desktop"
    npm run test:e2e:twice || FAILURES=$((FAILURES + 1))
    echo ""
}

case "$TARGET" in
    all)
        run_lint
        run_types
        run_unit
        ;;
    lint)   run_lint ;;
    types)  run_types ;;
    unit)   run_unit ;;
    e2e)    run_e2e ;;
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: ./test.sh [all|lint|types|unit|e2e]"
        exit 1
        ;;
esac

if [ "$FAILURES" -gt 0 ]; then
    echo "❌ $FAILURES check(s) failed"
    exit 1
else
    echo "✅ All checks passed"
fi
