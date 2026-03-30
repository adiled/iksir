#!/bin/bash

echo "=== Fixing Englarabic to Proper Arabic Grammar ==="

# Transform English verbs + Arabic nouns to proper Arabic verb forms
# Using Form I (فَعَلَ) and Form II (فَعَّلَ) patterns

cd /root/herald

# Create → Khalaqa (خلق) - to create
# Update → Jaddada (جدد) - to renew/update  
# Get/Find → Wajada (وجد) - to find
# Set → Waḍa'a (وضع) - to place/set
# Handle → 'Aalaja (عالج) - to handle/process
# Execute → Naffadha (نفّذ) - to execute
# Send → Arsala (أرسل) - to send
# Start → Bada'a (بدأ) - to start
# Summon → Istadʿā (استدعى) - to summon (already good)
# Kindle → Awqada (أوقد) - to kindle

echo "→ Transforming function names to proper Arabic..."

# First pass: Murshid-related functions
find src -name "*.ts" -exec sed -i '
  # Create functions
  s/createAndActivateMurshid/khalaqaWaFa'\''alaMurshid/g
  s/createMurshidChannel/khalaqaQanatMurshid/g
  s/CreateMurshidParams/MuʿṭayātKhalqMurshid/g
  
  # Get/Find functions  
  s/getActiveMurshid/wajadaMurshidFāʿil/g
  s/getActiveMurshidId/wajadaHuwiyyatMurshidFāʿil/g
  s/getMurshidSessions/wajadaJalasātMurshid/g
  s/getMurshidByChannel/wajadaMurshidBiQanāt/g
  s/getMurshidBySessionId/wajadaMurshidBiHuwiyyatJalsa/g
  s/getOrCreateMurshid/wajadaAwKhalaqa/g
  s/findExistingMurshidSession/baḥathaʿAnJalsatMurshid/g
  s/getActivePRsForMurshid/wajadaRasāʾilFāʿilaLiMurshid/g
  
  # Set functions
  s/setActiveMurshid/waḍaʿaMurshidFāʿil/g
  s/setMunadi/waḍaʿaMunadi/g
  
  # Execute/Handle functions
  s/executeMurshidSwitch/naffadhaTaḥwīlMurshid/g
  s/handleCreateWasfa/ʿālajaKhalqWaṣfa/g
  s/handleUpdateWasfa/ʿālajaTajdīdWaṣfa/g
  s/handleReadWasfa/ʿālajaQirāʾatWaṣfa/g
  s/handleCreateRisala/ʿālajaKhalqRisāla/g
  
  # Send functions
  s/sendMurshidInitPrompt/arsalaTaʾsīsMurshid/g
  s/sendToMurshid/arsalaIlāMurshid/g
  s/sendToMurshidById/arsalaIlāMurshidBiHuwiyya/g
  s/sendToMurshidTopic/arsalaIlāMawḍūʿMurshid/g
  
  # Other functions
  s/updateMurshidStatus/jaddadaḤālatMurshid/g
  s/startMurshidForEntity/badaʾaMurshidLiKiyān/g
  s/filterMurshid/ṣaffāMurshid/g
  s/resolveMurshidTopic/ḥallaMawḍūʿMurshid/g
  s/hasMurshidChannel/yamlikuQanātMurshid/g
' {} \;

echo "→ Transforming type names..."

# Type names - use Arabic noun forms
find src -name "*.ts" -exec sed -i '
  # Call types
  s/MunCreateWasfaCall/NidāʾKhalqWaṣfa/g
  s/MunUpdateWasfaCall/NidāʾTajdīdWaṣfa/g
  s/MunReadWasfaCall/NidāʾQirāʾatWaṣfa/g
  s/MunCreateRisalaCall/NidāʾKhalqRisāla/g
  
  # Variable names  
  s/activeMurshid/murshidFāʿil/g
  s/activeMurshidId/huwiyyatMurshidFāʿil/g
  s/validMurshidun/murshidūnṢāliḥūn/g
  
  # Mixed interfaces
  s/MurshidSession/JalsatMurshid/g
  s/MurshidStatus/ḤālatMurshid/g
  s/MurshidDiary/SijillMurshid/g
  s/murshidId/huwiyyatMurshid/g
' {} \;

echo "→ Transforming remaining summon functions..."

# Keep summon for animate beings but fix the pattern
find src -name "*.ts" -exec sed -i '
  s/summonMunadi/istadʿāMunadi/g
  s/summonKatib/istadʿāKatib/g
  s/summonMunaffidh/istadʿāMunaffidh/g
  s/summonRaqib/istadʿāRaqib/g
  s/summonSail/istadʿāSail/g
  s/summonArraf/istadʿāArraf/g
  s/kindleHayat/awqadaHayat/g
' {} \;

echo ""
echo "=== Transformation Complete ==="
echo ""
echo "Verb transformations applied:"
echo "  create → khalaqa (خلق)"
echo "  get/find → wajada (وجد)"  
echo "  set → waḍaʿa (وضع)"
echo "  handle → ʿālaja (عالج)"
echo "  execute → naffadha (نفّذ)"
echo "  send → arsala (أرسل)"
echo "  update → jaddada (جدد)"
echo "  start → badaʾa (بدأ)"
echo "  filter → ṣaffā (صفّى)"
echo "  summon → istadʿā (استدعى)"
echo "  kindle → awqada (أوقد)"