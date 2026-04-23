#!/bin/bash
# import-contacts.sh — export Mac Contacts to Amplify's Google Sheet.
#
# Usage:
#   ./scripts/import-contacts.sh                  # tag all as "iphone"
#   ./scripts/import-contacts.sh friends          # tag all as "friends"
#   ./scripts/import-contacts.sh nyc "NYC Locals" # only export Contacts group "NYC Locals", tag as "nyc"
#
# Requirements:
#   - amplify server must be running on http://localhost:3000 (npm start in another terminal)
#   - macOS Contacts app populated (auto-syncs from iPhone via iCloud)
#   - First run: macOS will prompt to allow Terminal access to Contacts. Say yes.

set -e

TAG="${1:-iphone}"
GROUP="${2:-}"
API="${AMPLIFY_API:-http://localhost:3000}"
VCF="/tmp/amplify-contacts-$(date +%s).vcf"

echo "→ Checking amplify server..."
if ! curl -s -f "$API/api/health" > /dev/null 2>&1; then
  echo "✗ amplify server not reachable at $API"
  echo "  Start it in another terminal: cd $(dirname "$0")/.. && npm start"
  exit 1
fi
echo "  ✓ server reachable"

echo "→ Exporting Mac Contacts${GROUP:+ (group: $GROUP)}..."
if [ -n "$GROUP" ]; then
  osascript <<EOS > "$VCF" 2>/dev/null
tell application "Contacts"
  set targetGroup to first group whose name is "$GROUP"
  set vcfText to ""
  repeat with aPerson in people of targetGroup
    set vcfText to vcfText & (vcard of aPerson as text)
  end repeat
  return vcfText
end tell
EOS
else
  osascript <<EOS > "$VCF" 2>/dev/null
tell application "Contacts"
  set vcfText to ""
  repeat with aPerson in every person
    set vcfText to vcfText & (vcard of aPerson as text)
  end repeat
  return vcfText
end tell
EOS
fi

COUNT=$(grep -c "^BEGIN:VCARD" "$VCF" 2>/dev/null || echo 0)
echo "  ✓ exported $COUNT contacts to $VCF"

if [ "$COUNT" -eq 0 ]; then
  echo "✗ no contacts found. Check:"
  echo "  - Contacts app on your Mac is populated (open it and verify)"
  echo "  - If you used a group name, the group exists exactly as typed: \"$GROUP\""
  echo "  - macOS granted Terminal access to Contacts (System Settings → Privacy & Security → Contacts)"
  rm -f "$VCF"
  exit 1
fi

echo "→ Uploading to $API with tag \"$TAG\"..."
RESPONSE=$(curl -s -X POST "$API/api/contacts/import-vcf" \
  -F "file=@$VCF;type=text/vcard" \
  -F "tag=$TAG")

ADDED=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('added', '?'))" 2>/dev/null || echo "?")
echo "  ✓ $ADDED contacts added to Google Sheet (duplicates skipped by phone)"
echo ""
echo "Done. Open your Amplify Data Sheet → contacts tab to verify."
echo "The raw vCard is saved at $VCF (delete if you want: rm $VCF)"
