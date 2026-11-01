/**
 * iksir — the summoning rod. Two verbs and a mirror:
 *
 *   iksir init      walk al-Kimyawi through Telegram, the register, the nest
 *   iksir check     load the config, nestle, and say what answers
 *   iksir config    print the resolved configuration (--path for its file)
 *
 * Starting, stopping and updating belong to hum: `hum hive <path> install`.
 */

import { VERSION } from "./version.ts";
import { hammalaAlTasmim, masarMilafAlTasmim } from "./config.ts";
import { runInit } from "./init.ts";
import { abda } from "./main.ts";

const HELP = `
iksir v${VERSION}

Usage:
  iksir init            Interactive onboarding: Telegram, the register, the nest
  iksir check           Load the config, nestle at the humd, report what answers
  iksir config          Print the resolved configuration
  iksir config --path   Print the config file's path
  iksir version

The daemon is a hum hive. Install, restart and update it with:
  hum hive /path/to/iksir install
`;

async function cmdConfig(): Promise<void> {
  if (process.argv.slice(2).includes("--path")) {
    console.log(masarMilafAlTasmim());
    return;
  }
  console.log(JSON.stringify(await hammalaAlTasmim(), null, 2));
}

const command = process.argv.slice(2)[0] ?? "help";

switch (command) {
  case "init":
    await runInit();
    break;
  case "check":
    await abda({ check: true });
    break;
  case "config":
    await cmdConfig();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`iksir v${VERSION}`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
