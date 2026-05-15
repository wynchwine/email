#!/usr/bin/env bash
set -e

# Load API key from .env if available
if [ -f "$(dirname "$0")/../.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

API_KEY="${KLAVIYO_API_KEY:?'KLAVIYO_API_KEY not set. Add it to .env or export it.'}"

echo "Creating custom profile property 'somm_notes'..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://a.klaviyo.com/api/profile-property-definitions/" \
  -H "Authorization: Klaviyo-API-Key $API_KEY" \
  -H "revision: 2024-10-15" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "profile-property-definition",
      "attributes": {
        "name": "somm_notes",
        "label": "Somm Notes",
        "type": "string"
      }
    }
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Property 'somm_notes' created successfully."
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "✗ Error (HTTP $HTTP_CODE):"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  exit 1
fi
