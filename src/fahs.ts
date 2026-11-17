/**
 * Al-Faḥṣ — the examination of the house, from the doorstep.
 *
 * `iksir check` asks and enters as nobody. hum's law: two processes signing
 * with one key are one bee, and the newer connection replaces the older — so
 * an examiner that nestled as the five would knock the running iksir off the
 * nest and the two would redial over each other until it left. The examiner
 * therefore reads what hum says (`hum status`, `hum bee --list`), calls
 * Telegram's getMe and the ntfy server, and reports:
 *
 *   - whether humd answers, and its version;
 *   - which of the five bees are nestled (all → iksir is running; none →
 *     it is not; some → it is broken), and any stale bee entered under
 *     iksir that is not one of the five;
 *   - whether the model al-Kimyawī named is advertised by a nestled nurse;
 *   - whether the majlis and ntfy answer.
 *
 * Exit 1 when something is wrong.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tasmim, tahaqqaq } from "./config.ts";
import { KHUDDAM } from "./hum/wasila.ts";
import { anshaaTelegramAmil } from "./rasul/telegram.ts";
import { VERSION } from "./version.ts";

const tanfidh = promisify(execFile);
const ASAS = "iksir";

export interface Nahla {
  id: string;
  hive: string;
  as: string;
  role: string;
  nestled: boolean;
  models: string[];
}

export function iqraNuhul(nass: string): Nahla[] {
  const nuhul: Nahla[] = [];
  for (const satr of nass.split("\n")) {
    const ras = satr.match(/^[●○]\s+(bee_[0-9a-f]+)\s+—\s+hive (\S+) as (\S+), (\S+), (nestled|entered, not nestled)/);
    if (ras) {
      nuhul.push({ id: ras[1], hive: ras[2], as: ras[3], role: ras[4], nestled: ras[5] === "nestled", models: [] });
      continue;
    }
    const namadhij = satr.match(/^\s+models:\s+(.+)$/);
    if (namadhij && nuhul.length) nuhul[nuhul.length - 1].models = namadhij[1].split(",").map((m) => m.trim()).filter(Boolean);
  }
  return nuhul;
}

async function hum(...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await tanfidh("hum", args, { timeout: 15_000 });
    return stdout;
  } catch {
    return null;
  }
}

export async function fahs(tasmim = new Tasmim()): Promise<boolean> {
  let salim = true;
  const sayy = (sabab: string) => { salim = false; return sabab; };

  console.log(`\nIksir v${VERSION} — al-Faḥṣ\n`);
  console.log(`Config: ${tasmim.masar}`);
  const kh = tasmim.khabath();
  console.log(`  Majlis: ${kh.majlis.join(", ") || "(none)"}`);
  console.log(`  Kūr: ${kh.kur.join(", ") || "(none)"}`);
  console.log(`  Sijillāt: ${kh.sijillat.join(", ") || "(none)"}`);
  console.log(`  Secrets: ${tasmim.asmaAsrar().join(", ") || "(none)"}`);
  for (const shakwa of tahaqqaq(tasmim.now())) console.log(`  ! ${sayy(shakwa)}`);

  console.log("\nThe nest:");
  const hala = await hum("status");
  const nuskha = hala?.match(/humd v(\S+) \(thrum (\S+)\)/);
  console.log(`  humd: ${nuskha ? `✓ v${nuskha[1]}, thrum ${nuskha[2]}` : sayy("✗ hum does not answer")}`);

  const nuhul = iqraNuhul((await hum("bee", "--list")) ?? "");
  const lana = nuhul.filter((n) => n.hive === ASAS);
  const khamsa = KHUDDAM.map((k) => ({ k, nahla: lana.find((n) => n.as === k) }));
  const nestled = khamsa.filter((x) => x.nahla?.nestled).map((x) => x.k);
  const ghaib = khamsa.filter((x) => !x.nahla).map((x) => x.k);
  if (nestled.length === KHUDDAM.length) console.log("  bees: ✓ the five are nestled — iksir is running");
  else if (nestled.length === 0 && ghaib.length === 0) console.log("  bees: the five are entered, none nestled — iksir is not running");
  else if (ghaib.length) console.log(`  bees: ${sayy(`✗ never entered: ${ghaib.join(", ")} — run \`hum hive <iksir> install\``)}`);
  else console.log(`  bees: ${sayy(`✗ nestled ${nestled.join(", ")}; astray ${khamsa.filter((x) => !x.nahla?.nestled).map((x) => x.k).join(", ")}`)}`);
  for (const n of lana) if (!(KHUDDAM as readonly string[]).includes(n.as)) console.log(`  ! stale bee \`${n.as}\` entered under iksir — \`hum bee ${n.id} exit\``);

  const namudhaj = tasmim.namudhaj();
  const murabbiyat = nuhul.filter((n) => n.role === "nurse" && n.nestled);
  const maarud = [...new Set(murabbiyat.flatMap((n) => n.models))];
  if (!namudhaj) console.log("  model: (the nest decides)");
  else if (maarud.includes(namudhaj)) console.log(`  model: ✓ ${namudhaj}, advertised by a nestled nurse`);
  else if (maarud.length === 0) console.log(`  model: ${sayy(`✗ ${namudhaj} — no nurse is nestled`)}`);
  else console.log(`  model: ${sayy(`✗ ${namudhaj} is not advertised; the nest has ${maarud.join(", ")}`)}`);

  console.log("\nThe majlis:");
  if (kh.majlis.includes("telegram")) {
    const telegram = anshaaTelegramAmil(tasmim);
    console.log(`  telegram: ${(await telegram.tahaqqaqToken()) ? "✓ getMe answers" : sayy("✗ getMe does not answer — the token, or the road to api.telegram.org")}`);
  } else console.log("  telegram: (not in the majlis)");
  const ntfy = tasmim.ntfy();
  if (ntfy) {
    try {
      const r = await fetch(ntfy.server);
      console.log(`  ntfy: ${r.ok ? "✓" : sayy(`✗ status ${r.status}`)}`);
    } catch {
      console.log(`  ntfy: ${sayy("✗ not reachable")}`);
    }
  } else console.log("  ntfy: (disabled)");

  console.log(salim ? "\nAll sound ✓\n" : "\nSomething is wrong; see above.\n");
  return salim;
}
