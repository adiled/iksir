#!/bin/bash

echo "=== Transforming function names with alchemical soul ==="

# For animate beings (roles), we summon or escort them
# For inanimate things, we use Arabic verbs in Latin script

# 1. Munadi (The Caller) - animate, we summon
echo "→ Transforming createMunadi → summonMunadi..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createMunadi/summonMunadi/g
  s/createDispatcher/summonMunadi/g
'

# 2. SessionManager (The Scribe/Keeper) - animate role
echo "→ Transforming createSessionManager → summonKatib..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createSessionManager/summonKatib/g
'

# 3. ToolExecutor (The Executor/Implementor) - animate role  
echo "→ Transforming createToolExecutor → summonMunaffidh..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createToolExecutor/summonMunaffidh/g
'

# 4. IntentResolver (The Diviner) - animate role
echo "→ Transforming createIntentResolver → summonArraf..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createIntentResolver/summonArraf/g
'

# 5. QuestionHandler (The Oracle) - animate role
echo "→ Transforming createQuestionHandler → summonSail..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createQuestionHandler/summonSail/g
'

# 6. HealthMonitor (The Watcher) - animate role
echo "→ Transforming createHealthMonitor → summonRaqib..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createHealthMonitor/summonRaqib/g
'

# 7. KeepAliveLoop (The Heartbeat) - inanimate, we kindle it
echo "→ Transforming createKeepAliveLoop → kindleHayat..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createKeepAliveLoop/kindleHayat/g
'

# 8. For clients (tools/instruments), we forge them - inanimate
echo "→ Transforming client creators..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/createLinearClient/saghaLinear/g
  s/createGitHubClient/saghaGitHub/g
  s/createOpenCodeClient/saghaOpenCode/g
'

# 9. upsertImplStatus → naqshStatus (engrave status)
echo "→ Transforming upsertImplStatus → naqshStatus..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/upsertImplStatus/naqshStatus/g
'

# 10. getImplStatus → qiraStatus (read status)
echo "→ Transforming getImplStatus → qiraStatus..."
find /root/herald -type f -name "*.ts" | xargs sed -i '
  s/getImplStatus/qiraStatus/g
'

echo ""
echo "=== Transformation complete ==="
echo ""
echo "Animate beings (summoned/escorted):"
echo "  Munadi - The Caller"
echo "  Katib - The Scribe (SessionManager)"
echo "  Munaffidh - The Executor (ToolExecutor)"
echo "  Arraf - The Diviner (IntentResolver)"
echo "  Sail - The Oracle (QuestionHandler)"
echo "  Raqib - The Watcher (HealthMonitor)"
echo ""
echo "Inanimate things (forged/kindled/prepared):"
echo "  sagha - forge (clients)"
echo "  kindle - awaken (loops)"
echo "  naqsh - engrave (records)"
echo "  qira - read (data)"