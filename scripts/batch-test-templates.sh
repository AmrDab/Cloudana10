#!/bin/bash
# Batch test awesome-akash templates for UI compatibility
# Tests which templates will work vs fail with "Could not read deployment summary"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWESOME_AKASH="../awesome-akash"
OUTPUT_FILE="/tmp/template-ui-test-results.txt"

echo "═══════════════════════════════════════════════════════════════"
echo "  Template UI Compatibility Test"
echo "  Testing which templates work in UI vs show errors"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Clear output file
> "$OUTPUT_FILE"

PASSED=0
FAILED=0
TOTAL=0

# Find all deploy files
for FILE in $AWESOME_AKASH/*/deploy.yaml $AWESOME_AKASH/*/deploy.yml; do
    if [ -f "$FILE" ]; then
        TOTAL=$((TOTAL + 1))
        TEMPLATE=$(basename $(dirname "$FILE"))
        
        # Run UI parsing test
        if node "$SCRIPT_DIR/test-ui-parsing.js" "$FILE" >> "$OUTPUT_FILE" 2>&1; then
            echo "✓ $TEMPLATE"
            PASSED=$((PASSED + 1))
        else
            echo "✗ $TEMPLATE"
            FAILED=$((FAILED + 1))
        fi
    fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📊 Summary:"
echo "   Total:  $TOTAL templates"
echo "   ✓ Pass: $PASSED templates (will work in UI)"
echo "   ✗ Fail: $FAILED templates (will show error)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Detailed results saved to: $OUTPUT_FILE"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo "❌ Failed templates (will show 'Could not read deployment summary'):"
    grep "❌ FAIL" "$OUTPUT_FILE" | grep "Testing:" | sed 's/.*Testing: /  - /'
fi

exit 0
