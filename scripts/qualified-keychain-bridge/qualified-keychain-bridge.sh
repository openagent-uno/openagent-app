#!/bin/bash
# UNEXECUTED hosted-only candidate. No local keychain/signing fallback.
set -euo pipefail
set +x
exec /usr/bin/env python3 "$(dirname "$0")/qualified-keychain-bridge.py" "$@"
