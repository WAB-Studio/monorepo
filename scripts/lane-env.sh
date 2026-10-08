#!/usr/bin/env bash
# Point a lane's env file at its own port.
#
#   scripts/lane-env.sh <env file> <port>
#
# Rewrites only a NEXT_PUBLIC_SITE_URL that names localhost; a real host, every
# other line and a file with no such line stay byte-equal.
set -euo pipefail

FILE=${1:?env file}
PORT=${2:?port}

[[ -f $FILE ]] || { echo "lane-env.sh: no file $FILE." >&2; exit 1; }
[[ $PORT =~ ^[0-9]+$ ]] || { echo "lane-env.sh: port must be a number, got $PORT." >&2; exit 1; }

sed -i -E "s#^(NEXT_PUBLIC_SITE_URL=)http://localhost:[0-9]+#\1http://localhost:$PORT#" "$FILE"
