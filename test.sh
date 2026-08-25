#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Test ──
# Run linting, type checks, and tests.
#
# Usage:
#   ./test.sh               Run all checks
#   ./test.sh lint          ESLint only
#   ./test.sh types         TypeScript type check only
#   ./test.sh unit          Jest unit tests only

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-all}"
FAILURES=0

run_lint() {
    echo "🔍 ESLint..."
    cd "$SCRIPT_DIR/universal"
    # Il gate esiste davvero: eslint + typescript-eslint sono dipendenze del
    # repo e la configurazione e' in eslint.config.mjs. Regole scelte per
    # cogliere difetti, non gusti — niente formattazione, niente stile: se
    # fallisce, qualcosa e' rotto. (In ESLint 9 la selezione dei file sta nella
    # config, non piu' in --ext.)
    if ls eslint.config.* >/dev/null 2>&1; then
        npx eslint . || FAILURES=$((FAILURES + 1))
    else
        echo "   saltato: manca eslint.config.* — la configurazione e' stata rimossa?"
    fi
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
    echo "🧪 Jest..."
    cd "$SCRIPT_DIR/universal"
    npx jest --passWithNoTests || FAILURES=$((FAILURES + 1))
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
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: ./test.sh [all|lint|types|unit]"
        exit 1
        ;;
esac

if [ "$FAILURES" -gt 0 ]; then
    echo "❌ $FAILURES check(s) failed"
    exit 1
else
    echo "✅ All checks passed"
fi
