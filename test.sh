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
    # Questo repo non ha eslint fra le dipendenze e non ha un
    # eslint.config.*: `npx eslint` scaricava la 10 al volo e usciva in errore
    # ("couldn't find an eslint.config file"), quindi ./test.sh era ROSSO per
    # tutti, sempre, per un motivo che non c'entra col codice — e un gate che
    # fallisce sempre e' un gate che nessuno guarda. Finche' non si sceglie una
    # configurazione, lo diciamo e andiamo avanti: type-check e test restano.
    if ls eslint.config.* >/dev/null 2>&1 || [ -f .eslintrc ] || [ -f .eslintrc.json ] || [ -f .eslintrc.js ]; then
        npx eslint . --ext .ts,.tsx || FAILURES=$((FAILURES + 1))
    else
        echo "   saltato: nessuna configurazione eslint nel repo (ne' eslint fra le dipendenze)."
        echo "   Per attivarlo: aggiungere eslint + typescript-eslint e un eslint.config.mjs."
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
