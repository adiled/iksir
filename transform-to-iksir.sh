#!/bin/bash

echo "=== Transforming Munadi → Iksīr with proper component names ==="

# 1. Overall system: Munadi → Iksīr
echo "→ Transforming system name to Iksīr..."

# Config and environment variables
find /root/herald -type f -name "*.ts" -o -name "*.md" | xargs sed -i '
  s/MUNADI_CONFIG_DIR/IKSIR_CONFIG_DIR/g
  s/MUNADI_OPENCODE_SERVER/IKSIR_OPENCODE_SERVER/g
  s/MUNADI_REPO_PATH/IKSIR_REPO_PATH/g
  s/MUNADI_GIT_USER/IKSIR_GIT_USER/g
  s/MUNADI_LOG_DIR/IKSIR_LOG_DIR/g
  s/MUNADI_AGENTS_MD_PATH/IKSIR_AGENTS_MD_PATH/g
  s/MUNADI_CLASSIFY_NOTIFICATION_PROMPT/IKSIR_CLASSIFY_NOTIFICATION_PROMPT/g
  s/MUNADI_CLASSIFY_QUESTION_PROMPT/IKSIR_CLASSIFY_QUESTION_PROMPT/g
'

# Config file names
find /root/herald -type f -name "*.ts" -o -name "*.md" | xargs sed -i '
  s/munadi\.json/iksir.json/g
  s/munadi\.schema\.json/iksir.schema.json/g
  s/munadi\.yaml/iksir.yaml/g
  s|\.config/munadi|.config/iksir|g
'

# Type names and interfaces
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/MunadiConfig/IksirConfig/g
  s/MunadiToolRegistry/IksirToolRegistry/g
  s/MunadiMunMcpServer/IksirMunMcpServer/g
'

# Comments and descriptions - be selective
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/Munadi Core Types/Iksīr Core Types/g
  s/Munadi autonomous agent/Iksīr alchemical/g
  s/for Munadi operations/for Iksīr operations/g
  s/Munadi MCP Server/Iksīr MCP Server/g
  s/Munadi daemon/Iksīr daemon/g
  s/Munadi context/Iksīr context/g
  s/Munadi Logger/Iksīr Logger/g
  s/munadi init/iksir init/g
  s/munadi start/iksir start/g
  s/munadi-config-test/iksir-config-test/g
'

# 2. Dispatcher → Munadi (The Caller)
echo "→ Renaming dispatcher to munadi (the caller)..."

# First rename the file
if [ -f "/root/herald/src/daemon/dispatcher.ts" ]; then
  mv /root/herald/src/daemon/dispatcher.ts /root/herald/src/daemon/munadi.ts
  echo "  Renamed dispatcher.ts → munadi.ts"
fi

# Update imports
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s|from "\./dispatcher"|from "./munadi"|g
  s|from "\.\./daemon/dispatcher"|from "../daemon/munadi"|g
'

# Update type exports and references
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/export class Dispatcher/export class Munadi/g
  s/new Dispatcher(/new Munadi(/g
  s/#dispatcher/#munadi/g
  s/dispatcher: Dispatcher/munadi: Munadi/g
  s/this\.dispatcher/this.munadi/g
'

# 3. Keep specific component names
echo "→ Preserving alchemical component names..."

# Agent names should reference specific roles
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/munadi-orchestrator/iksir-orchestrator/g
  s/munadi-implementor/iksir-implementor/g
  s/munadi-classifier/iksir-classifier/g
  s/munadi-intent/iksir-intent/g
'

# Dispatch channel stays as dispatch but in context
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/#munadi/#iksir-dispatch/g
'

# 4. File renames
echo "→ Renaming config files..."
if [ -f "/root/herald/munadi.json.example" ]; then
  mv /root/herald/munadi.json.example /root/herald/iksir.json.example
fi

if [ -f "/root/herald/munadi.schema.json" ]; then
  mv /root/herald/munadi.schema.json /root/herald/iksir.schema.json
fi

# 5. Update prompts
echo "→ Updating prompt filenames..."
if [ -f "/root/herald/prompts/munadi-orchestrator.md" ]; then
  mv /root/herald/prompts/munadi-orchestrator.md /root/herald/prompts/iksir-orchestrator.md
fi

if [ -f "/root/herald/prompts/munadi-implementor.md" ]; then
  mv /root/herald/prompts/munadi-implementor.md /root/herald/prompts/iksir-implementor.md
fi

# 6. Update CLI commands in code
find /root/herald -type f -name "*.ts" -o -name "*.md" | xargs sed -i '
  s/"munadi /"iksir /g
  s/munadi\$\$RESET/iksir$$RESET/g
'

# 7. Update test references
find /root/herald -type f -name "*.test.ts" | xargs sed -i '
  s/munadi-config-test/iksir-config-test/g
'

echo "=== Transformation complete ==="
echo ""
echo "Component naming:"
echo "  System: Iksīr (The Elixir)"
echo "  Dispatcher: Munadi (The Caller)"
echo "  Config: iksir.json"
echo "  Env vars: IKSIR_*"
echo ""
echo "Next steps:"
echo "  1. Update any systemd service files"
echo "  2. Rename repository if needed"
echo "  3. Update ~/.config/munadi → ~/.config/iksir"