#!/usr/bin/env bash
set -euo pipefail

# Generates cryptographic secrets for gymbro. Prints to stdout only — never
# writes .env directly (secrets belong in a vault or password manager).
#
# Usage:
#   bash scripts/gen-secrets.sh               # all secrets, no bcrypt hash
#   bash scripts/gen-secrets.sh --with-admin  # also prompts for super-admin password
#
# Requires: openssl, python3 (for Fernet + bcrypt).

WITH_ADMIN=0
for arg in "$@"; do
    case "$arg" in
        --with-admin) WITH_ADMIN=1 ;;
        -h|--help)
            sed -n '4,12p' "$0"
            exit 0
            ;;
    esac
done

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: missing dependency '$1'" >&2
        exit 1
    }
}

require openssl
require python3

JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
MONGO_PASSWORD="$(openssl rand -base64 32 | tr -d '\n=+/' | cut -c1-32)"
FERNET_KEY="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"

cat <<EOF
# --- gymbro secrets — copy to vault, NEVER commit ---
JWT_SECRET=${JWT_SECRET}
FERNET_KEYS=${FERNET_KEY}
MONGO_ROOT_PASSWORD=${MONGO_PASSWORD}
EOF

if [[ "$WITH_ADMIN" -eq 1 ]]; then
    echo
    echo "# Enter super-admin plaintext password (will be hashed, not echoed):" >&2
    read -r -s -p "password: " PLAIN
    echo >&2
    if [[ -z "$PLAIN" ]]; then
        echo "error: empty password" >&2
        exit 1
    fi
    if [[ ${#PLAIN} -lt 12 ]]; then
        echo "error: password must be at least 12 chars" >&2
        exit 1
    fi
    HASH="$(SUPER_ADMIN_PLAINTEXT="$PLAIN" python3 -c 'import os; from passlib.hash import bcrypt; print(bcrypt.hash(os.environ["SUPER_ADMIN_PLAINTEXT"]))')"
    echo "SUPER_ADMIN_PASSWORD=${HASH}"
    unset PLAIN
fi

cat >&2 <<'EOF'

# --- next steps ---
# 1. Store these values in your secrets manager (1Password, Bitwarden, Vault).
# 2. Set them in your deployment environment (Docker .env on the host, not git).
# 3. For FERNET key rotation: prepend a NEW key to FERNET_KEYS keeping the old
#    one as the second entry. Decrypt tries all keys; encrypt uses the first.
#    Once all data has been re-encrypted (lazy on access), drop the old key.
EOF
