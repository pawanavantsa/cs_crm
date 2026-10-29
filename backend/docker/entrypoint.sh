#!/bin/sh
set -e
# First run creates the crm migration; commit backend/crm/migrations/ afterwards.
if [ "${SKIP_MIGRATE:-false}" != "true" ]; then
  python manage.py makemigrations crm --noinput
  python manage.py migrate --noinput
fi
if [ "${SEED_DEMO:-false}" = "true" ]; then
  python manage.py seed_demo --password "${DEMO_PASSWORD:-xeroura-demo}" || true
fi
exec "$@"
