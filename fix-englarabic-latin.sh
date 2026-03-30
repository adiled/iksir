#!/bin/bash

echo "=== Fixing Englarabic to Proper Arabic (Latin script) ==="

cd /root/herald

# Using Latin script for Arabic terms for better compatibility
# Following pattern: Arabic verb/noun in Latin script

echo "→ Transforming function names to proper Arabic (Latin script)..."

# Create → khalaqa (to create)
# Get/Find → wajada (to find) / jalaba (to fetch)
# Set → wadaa (to place)
# Handle → aalaja (to process)
# Send → arsala (to send)
# Update → jaddada (to renew)
# Start → badaa (to begin)
# Execute → naffadha (to execute)
# Summon → istadaa (to summon)

find src -name "*.ts" -exec sed -i '
  # Murshid-related functions
  s/createMurshidChannel/khalaqaQanatMurshid/g
  s/createAndActivateMurshid/khalaqaWaFailMurshid/g
  s/CreateMurshidParams/KhalqMurshidParams/g
  
  s/getActiveMurshid/jalabaMurshidFail/g
  s/getMurshidSessions/jalabaJalasatMurshid/g
  s/getMurshidByChannel/jalabaMurshidBilQanat/g
  s/getMurshidBySessionId/jalabaMurshidBilJalsa/g
  s/getOrCreateMurshid/jalabaAwKhalaqa/g
  s/findExistingMurshidSession/bahathaAnJalsatMurshid/g
  
  s/setActiveMurshid/wadaaMurshidFail/g
  s/setMunadi/wadaaMunadi/g
  
  s/executeMurshidSwitch/naffadhaTahwilMurshid/g
  
  s/handleCreateWasfa/aalajaKhalqWasfa/g
  s/handleUpdateWasfa/aalajaTajdidWasfa/g  
  s/handleReadWasfa/aalajaQiraatWasfa/g
  s/handleCreateRisala/aalajaKhalqRisala/g
  
  s/sendMurshidInitPrompt/arsalaTasisMurshid/g
  s/sendToMurshid/arsalaIlaMurshid/g
  s/sendToMurshidById/arsalaIlaMurshidBilHuwiyya/g
  s/sendToMurshidTopic/arsalaIlaMawduMurshid/g
  
  s/updateMurshidStatus/jaddadaHalatMurshid/g
  s/startMurshidForEntity/badaaMurshidLilKayan/g
' {} \;

echo "→ Transforming Call types..."

find src -name "*.ts" -exec sed -i '
  s/MunCreateWasfaCall/NidaKhalqWasfa/g
  s/MunUpdateWasfaCall/NidaTajdidWasfa/g  
  s/MunReadWasfaCall/NidaQiraatWasfa/g
  s/MunCreateRisalaCall/NidaKhalqRisala/g
' {} \;

echo "→ Transforming summon functions to Arabic..."

find src -name "*.ts" -exec sed -i '
  s/summonMunadi/istadaaMunadi/g
  s/summonKatib/istadaaKatib/g
  s/summonMunaffidh/istadaaMunaffidh/g
  s/summonRaqib/istadaaRaqib/g
  s/summonSail/istadaaSail/g
  s/summonArraf/istadaaArraf/g
  s/kindleHayat/awqadaHayat/g
' {} \;

echo "→ Fixing variable names..."

find src -name "*.ts" -exec sed -i '
  s/activeMurshid([^I])/murshidFail\1/g
  s/activeMurshidId/huwiyyatMurshidFail/g
' {} \;

echo "→ Fixing config-related types (keeping some English for clarity)..."

# Keep IksirConfig as is - it's clear enough
# Keep Session/Manager suffixes for clarity

echo ""
echo "=== Transformation Complete ==="
echo ""
echo "Arabic verbs in Latin script:"
echo "  create → khalaqa"
echo "  get/fetch → jalaba"  
echo "  find → wajada"
echo "  set/place → wadaa"
echo "  handle → aalaja"
echo "  execute → naffadha"
echo "  send → arsala"
echo "  update → jaddada"
echo "  start → badaa"
echo "  summon → istadaa"
echo "  kindle → awqada"