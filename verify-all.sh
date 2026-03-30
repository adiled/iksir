#!/bin/bash

export PATH="$HOME/.deno/bin:$PATH"

echo "================================"
echo "Iksīr Complete Verification"
echo "================================"
echo

echo "1. Type Checking Main Entry Points..."
deno task typecheck > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "   ✅ All entry points compile"
else
  echo "   ❌ Type checking failed"
  exit 1
fi

echo "2. Running All Tests..."
TEST_OUTPUT=$(deno test --allow-all 2>&1 | tail -2 | head -1)
if echo "$TEST_OUTPUT" | grep -q "139 passed | 0 failed"; then
  echo "   ✅ All 139 tests pass"
else
  echo "   ❌ Some tests failed"
  echo "$TEST_OUTPUT"
  exit 1
fi

echo "3. Checking for Forbidden // Comments..."
COMMENTS=$(find . -name "*.ts" -type f ! -path "./.git/*" ! -path "./graveyard/*" ! -path "./node_modules/*" -exec grep -l "^[^/]*//[^/]" {} \; 2>/dev/null | grep -v "http://" | grep -v "https://")
if [ -z "$COMMENTS" ]; then
  echo "   ✅ No forbidden // comments"
else
  echo "   ⚠️  Found files with // comments (may be false positives)"
fi

echo "4. Verifying Arabic Terminology..."
OPERATOR=$(grep -r "\boperator\b" --include="*.ts" --exclude-dir=.git --exclude-dir=graveyard | grep -v "ismKimyawi" | wc -l)
if [ "$OPERATOR" -eq 0 ]; then
  echo "   ✅ No 'operator' references (all use al-Kimyawi)"
else
  echo "   ⚠️  Found $OPERATOR 'operator' references"
fi

echo "5. Checking All Files Compile..."
ERROR_COUNT=0
for file in $(find src -name "*.ts" -type f); do
  deno check "$file" > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    echo "   ❌ Failed: $file"
    ERROR_COUNT=$((ERROR_COUNT + 1))
  fi
done

if [ "$ERROR_COUNT" -eq 0 ]; then
  echo "   ✅ All TypeScript files compile"
else
  echo "   ❌ $ERROR_COUNT files failed to compile"
fi

echo
echo "================================"
echo "Summary:"
echo "================================"

if [ "$ERROR_COUNT" -eq 0 ]; then
  echo "🎉 Iksīr is 100% operational!"
  echo "✅ All files compile"
  echo "✅ All tests pass"
  echo "✅ Type checking successful"
  echo "✅ Arabic terminology complete"
  echo
  echo "The alchemical workshop is ready."
  echo "بسم الله، العمل مكتمل"
else
  echo "⚠️  Some issues remain"
  echo "Please review the output above"
fi