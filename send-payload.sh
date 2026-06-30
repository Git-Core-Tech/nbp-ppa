#!/usr/bin/env bash
# Strips newlines from payload.txt (added for readability) and sends as one TCP message.
# Usage: ./send-payload.sh [host] [port]

HOST="${1:-localhost}"
PORT="${2:-3004}"
FILE="${3:-payload.txt}"

PAYLOAD=$(tr -d '\n' < "$FILE")
echo "Sending ${#PAYLOAD} bytes to $HOST:$PORT ..."
echo -n "$PAYLOAD" | nc -q1 "$HOST" "$PORT"
