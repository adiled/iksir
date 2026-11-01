/**
 * One version, read from package.json, spoken everywhere: the CLI, the log,
 * and the bee's hello. `./release` bumps it and nothing else carries a copy.
 */

import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
