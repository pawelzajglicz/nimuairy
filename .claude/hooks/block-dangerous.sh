#!/bin/bash
# .claude/hooks/block-dangerous.sh
INPUT=$(cat)

COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

if printf '%s' "$COMMAND" | grep -qiE 'rm[[:space:]]+-rf|git[[:space:]]+push[[:space:]]+--force|DROP[[:space:]]+TABLE'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Zablokowano niebezpieczną komendę. Użyj bezpieczniejszej alternatywy."
    }
  }'
  exit 0
fi

exit 0