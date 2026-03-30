#!/bin/bash

echo "Fixing remaining issues..."

# Fix TrackedPR references
sed -i 's/ticketId:/wasfaId:/g' src/daemon/tool-executor.ts

# Fix yield reason types
sed -i 's/"blocked" | "waiting"/"masdud" | "muntazir"/g' src/mcp/mun-server.ts
sed -i 's/=== "blocked"/=== "masdud"/g' src/mcp/mun-server.ts

# Fix ntfy notifications
sed -i 's/ticketId,/wasfaId,/g' src/notifications/ntfy.ts
sed -i 's/ticketId:/wasfaId:/g' src/notifications/ntfy.ts

# Fix OpenCode status
sed -i 's/"idle"/"sakin"/g' src/opencode/client.ts
sed -i 's/ticketId:/wasfaId:/g' src/opencode/client.ts

# Fix any remaining ticketId references
find src -name "*.ts" -exec sed -i 's/\.ticketId/.wasfaId/g' {} \;
find src -name "*.ts" -exec sed -i 's/ticketId:/wasfaId:/g' {} \;

echo "Done!"