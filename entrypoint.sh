#!/bin/sh
set -e

echo "Running collectstatic..."
uv run python manage.py collectstatic --noinput

echo "Running migrations..."
uv run python manage.py migrate --noinput

exec "$@"
