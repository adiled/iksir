/**
 * iksir — the summoning rod.
 *
 *   iksir init                        walk al-Kimyawī through the majlis, the roster, the nest
 *   iksir check                       nestle, and say what answers
 *   iksir config                      print the configuration as the daemon sees it now
 *   iksir config get <path>           one value, as JSON
 *   iksir config set <path> <value>   write it; the daemon reads it on its next act
 *   iksir config unset <path>
 *   iksir secret set <name>           value from stdin, or a hidden prompt — never argv
 *   iksir secret list                 names only
 *   iksir secret rm <name>
 *
 * Values are JSON when they parse (["github","gitlab"], 5, true), else a
 * string; a,b,c is a list. Paths are dotted: khabath.kur, hum.namudhaj.
 *
 * Starting, stopping and updating belong to hum: `hum hive <path> install`.
 */

import { VERSION } from "./version.ts";
import { Tasmim, masarMilafAlAsrar, qimaMinKalima, tahaqqaq } from "./config.ts";
import { runInit, isal, aghliqMajlis } from "./init.ts";
import { abda } from "./main.ts";

const HELP = `
iksir v${VERSION}

Usage:
  iksir init                        Interactive onboarding: the majlis, the roster, the nest
  iksir check                       Nestle at the humd, report what answers
  iksir config                      Print the configuration, resolved
  iksir config get <path>           One value, as JSON   (khabath.kur, hum.namudhaj, …)
  iksir config set <path> <value>   Write it; the daemon reads it on its next act
  iksir config unset <path>
  iksir config --path               Where it lives
  iksir secret set <name>           Value from stdin or a hidden prompt   (telegram.ramz)
  iksir secret list
  iksir secret rm <name>
  iksir version

The daemon is a hum hive. Install, restart and update it with:
  hum hive /path/to/iksir install
`;

const [amr, ...wusut] = process.argv.slice(2);

function khuruj(nass: string): never {
  console.error(nass);
  process.exit(1);
}

async function cmdConfig(): Promise<void> {
  const tasmim = new Tasmim();
  const [fiil, masar, ...baqi] = wusut;
  if (fiil === "--path") return console.log(tasmim.masar);
  if (!fiil) {
    console.log(JSON.stringify(tasmim.now(), null, 2));
    for (const shakwa of tahaqqaq(tasmim.now())) console.error(`! ${shakwa}`);
    return;
  }
  if (!masar) khuruj(`iksir config ${fiil} <path>`);
  switch (fiil) {
    case "get":
      return console.log(JSON.stringify(tasmim.iqraMasar(masar) ?? null, null, 2));
    case "set": {
      if (!baqi.length) khuruj(`iksir config set ${masar} <value>`);
      tasmim.dhabbit(masar, qimaMinKalima(baqi.join(" ")));
      console.log(`${masar} = ${JSON.stringify(tasmim.iqraMasar(masar))}`);
      for (const shakwa of tahaqqaq(tasmim.now())) console.error(`! ${shakwa}`);
      return;
    }
    case "unset":
      tasmim.dhabbit(masar, undefined);
      return console.log(`${masar} unset`);
    default:
      khuruj(`Unknown: iksir config ${fiil}`);
  }
}

async function cmdSecret(): Promise<void> {
  const tasmim = new Tasmim();
  const [fiil, ism] = wusut;
  switch (fiil) {
    case "list":
      for (const s of tasmim.asmaAsrar()) console.log(s);
      return;
    case "set": {
      if (!ism) khuruj("iksir secret set <name>");
      const qima = (await isal(`${ism}: `, { maktum: true })).trim();
      aghliqMajlis();
      if (!qima) khuruj("nothing given; the secret stands as it was");
      tasmim.dhabbitSirr(ism, qima);
      console.log(`${ism} kept in ${masarMilafAlAsrar()} (0600)`);
      return;
    }
    case "rm":
      if (!ism) khuruj("iksir secret rm <name>");
      tasmim.dhabbitSirr(ism, undefined);
      return console.log(`${ism} forgotten`);
    default:
      khuruj("iksir secret set <name> | list | rm <name>");
  }
}

switch (amr ?? "help") {
  case "init":
    await runInit();
    break;
  case "check":
    await abda({ check: true });
    break;
  case "config":
    await cmdConfig();
    break;
  case "secret":
    await cmdSecret();
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
    console.error(`Unknown command: ${amr}`);
    console.log(HELP);
    process.exit(1);
}
