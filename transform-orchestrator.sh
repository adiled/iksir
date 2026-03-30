#!/bin/bash

echo "=== Transforming Orchestrator → Murshid ==="

# Transform in all TypeScript and Markdown files
find /root/herald -type f \( -name "*.ts" -o -name "*.md" \) | xargs sed -i '
  # Type and variable names
  s/OrchestratorSession/MurshidSession/g
  s/OrchestratorStatus/MurshidStatus/g
  s/OrchestratorDiary/MurshidDiary/g
  s/orchestratorId/murshidId/g
  s/orchestrator_id/murshid_id/g
  
  # Keep the prompt file names for now but update contents
  s/orchestrator session/murshid session/g
  s/Orchestrator session/Murshid session/g
  s/orchestrator agent/murshid agent/g
  s/Orchestrator agent/Murshid agent/g
  
  # Generic references
  s/[Tt]he orchestrator/the murshid/g
  s/[Tt]he Orchestrator/the Murshid/g
  s/orchestrators/murshidun/g  # Arabic plural
  s/Orchestrators/Murshidun/g
  s/orchestrator/murshid/g
  s/Orchestrator/Murshid/g
  
  # Comments and descriptions
  s/orchestrating/guiding/g
  s/Orchestrating/Guiding/g
'

# Rename prompt files
cd /root/herald/prompts
if [ -f "iksir-orchestrator.md" ]; then
  mv iksir-orchestrator.md iksir-murshid.md
  echo "Renamed iksir-orchestrator.md → iksir-murshid.md"
fi

# For implementor, let's use Sani (craftsman)
find /root/herald -type f \( -name "*.ts" -o -name "*.md" \) | xargs sed -i '
  s/implementor/sani/g
  s/Implementor/Sani/g
  s/implementors/sunna/g  # Arabic plural for craftsmen
  s/Implementors/Sunna/g
'

# Rename implementor prompt
if [ -f "iksir-implementor.md" ]; then
  mv iksir-implementor.md iksir-sani.md
  echo "Renamed iksir-implementor.md → iksir-sani.md"
fi

echo "=== Transformation complete ==="
echo ""
echo "Alchemical roles:"
echo "  Orchestrator → Murshid (مرشد) - The Guide"
echo "  Implementor → Sani (صانع) - The Craftsman"