#!/bin/bash

# Transform to Arabic alchemical terminology

echo "Transforming to Arabic alchemical terminology..."

# Core entity transformations
sed -i 's/CreateTicket/CreateWasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/UpdateTicket/UpdateWasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/ReadTicket/ReadWasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/create_ticket/create_wasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/update_ticket/update_wasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/read_ticket/read_wasfa/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/ticketId/wasfaId/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts

# Transform CreatePr to CreateRisala (treatise)
sed -i 's/CreatePr/CreateRisala/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/create_pr/create_risala/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts

# Transform the new alchemical tools
sed -i 's/mun_extract/mun_istikhas/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/mun_attune/mun_talaum/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/mun_transmute_stacked/mun_istihal_mutabaqq/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/mun_transmute/mun_istihal/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/mun_decant/mun_fasl/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/MunExtract/MunIstikhas/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/MunAttune/MunTalaum/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/MunTransmuteStacked/MunIstihalMutabaqq/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/MunTransmute/MunIstihal/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts
sed -i 's/MunDecant/MunFasl/g' src/types.ts src/mcp/mun-server.ts src/daemon/tool-executor.ts

# Session states
sed -i 's/"active"/"fail"/g' src/types.ts src/daemon/*.ts
sed -i 's/"idle"/"sakin"/g' src/types.ts src/daemon/*.ts
sed -i 's/"blocked"/"masdud"/g' src/types.ts src/daemon/*.ts
sed -i 's/"waiting"/"muntazir"/g' src/types.ts src/daemon/*.ts
sed -i 's/ACTIVE/FAIL/g' prompts/munadi-orchestrator.md
sed -i 's/IDLE/SAKIN/g' prompts/munadi-orchestrator.md
sed -i 's/BLOCKED/MASDUD/g' prompts/munadi-orchestrator.md
sed -i 's/WAITING/MUNTAZIR/g' prompts/munadi-orchestrator.md

# Decision types
sed -i 's/"planning"/"tadbir"/g' src/types.ts src/daemon/*.ts
sed -i 's/"grooming"/"tanfidh"/g' src/types.ts src/daemon/*.ts  
sed -i 's/"execution"/"tanfidh"/g' src/types.ts src/daemon/*.ts
sed -i 's/"blocker_resolution"/"hall"/g' src/types.ts src/daemon/*.ts
sed -i 's/"pr_decision"/"risala"/g' src/types.ts src/daemon/*.ts

echo "Transformation complete!"