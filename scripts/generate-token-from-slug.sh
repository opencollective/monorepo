#!/bin/sh

SLUG=$1

if [ -z "$SLUG" ]; then
  echo "Usage: $0 <collective-slug>"
  exit 1
fi

USER_QUERY="select u.email \"email_res\" from \"Users\" u where \"CollectiveId\" = (SELECT c.id from \"Collectives\" c where c.slug = '$SLUG')"
USER_EMAIL=$(heroku pg:psql --app opencollective-prod-api -c "$USER_QUERY" | grep -A 2 email_res | tail -1 | xargs)

if [ -z "$USER_EMAIL" ]; then
  echo "No admin user found for collective with slug '$SLUG'"
  exit 1
fi

echo "Generating token for user with email: $USER_EMAIL"
heroku run --app opencollective-prod-api -s performance -- npm rum script scripts/generate-jwt.ts email $USER_EMAIL
