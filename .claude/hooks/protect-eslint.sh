#!/bin/bash

JSON=$(cat)
TOOL_NAME=$(echo "$JSON" | jq -r '.tool_name // "unknown"')

ESLINT_PATTERN='(eslint\.config\.(js|mjs|cjs|ts|mts|cts|json)|\.eslintrc(\.(js|cjs|mjs|json|yaml|yml))?|\.eslintignore)'

matches_eslint() {
  echo "$1" | grep -qE "$ESLINT_PATTERN"
}

emit_ask() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}'
}

emit_default() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}'
}

case "$TOOL_NAME" in
  Edit|NotebookEdit)
    FILE_PATH=$(echo "$JSON" | jq -r '.tool_input.file_path // ""')
    if matches_eslint "$FILE_PATH"; then
      emit_ask
      exit 0
    fi
    ;;
  Write)
    FILE_PATH=$(echo "$JSON" | jq -r '.tool_input.file_path // ""')
    if matches_eslint "$FILE_PATH" && [[ -f "$FILE_PATH" ]]; then
      emit_ask
      exit 0
    fi
    ;;
  Bash)
    COMMAND=$(echo "$JSON" | jq -r '.tool_input.command // ""')
    if matches_eslint "$COMMAND"; then
      emit_ask
      exit 0
    fi
    ;;
esac

emit_default
