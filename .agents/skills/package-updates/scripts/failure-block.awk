# Extract Mocha/Cypress failure summaries, not expected errors emitted by passing tests.
# Summaries contain indented titles/stacks. Stop at the next unindented output or CI marker,
# including cleanup/service logs. Unsupported formats deliberately produce no diagnostic block.
/^[[:space:]]*[1-9][0-9]* failing[[:space:]]*$/ { active = 1; print; next }
active && (/^[[:space:]]*##\[/ || /^[^[:space:]]/ || /^[[:space:]]*[0-9]+ (passing|pending)/) { active = 0 }
active { print }
