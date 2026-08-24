/**
 * Udw al-Wasfa (عضو الوصفة) — The Formula Organ
 *
 * An organ of Iksīr, not Iksīr. It nestles at the same humd under its own
 * hive and its own hid, holds the tracker's key, and answers nida.
 *
 * It exists for one reason: the key. The entry bee no longer carries the
 * tracker credential, so a fault anywhere in the daemon cannot reach it.
 * That is the whole of the argument — process boundary as identity
 * boundary. Everything else about this organ is plumbing.
 *
 * It enforces no law. The sacred boundaries live at the entry, where the
 * prompts are originated and the ahdath inscribed; this organ only fetches
 * and writes what it is asked to. Which is why its adawat are named
 * wasfa_* rather than mun_*: they are operations, not instruments. The
 * entry declares them disallowed on every murshid prompt, so no cell ever
 * sees them.
 */

import { Thrum, type Nagham, type TaarifAda } from "../../src/hum/thrum.ts";
import { hammalaAlTasmim } from "../../src/config.ts";
import { createLinearClient } from "../../src/linear/client.ts";
import { logger } from "../../src/logging/logger.ts";
import type { MutabiWasfa } from "../../src/types.ts";

export const ISM_UDW = "iksir-wasfa";

/** No inputSchema is optional to humd — an absent one fails the model's zod. */
function ada(name: string, description: string, props: Record<string, unknown>, required: string[] = []): TaarifAda {
  return { name, description, inputSchema: { type: "object", properties: props, required } };
}

const NASS = { type: "string" };

export const ADAWAT_WASFA: TaarifAda[] = [
  ada("wasfa_hala", "Is the tracker reachable and authenticated?", {}),
  ada("wasfa_iqra", "Read one wasfa by its identifier.", { huwiyya: NASS }, ["huwiyya"]),
  ada("wasfa_mashru", "Read one project by id.", { huwiyya: NASS }, ["huwiyya"]),
  ada("wasfa_bahath", "Search wasfat by free text.", {
    istifsar: NASS,
    hadd: { type: "number" },
  }, ["istifsar"]),
  ada("wasfa_bahath_mashru", "Search projects by free text.", { istifsar: NASS }, ["istifsar"]),
  ada("wasfa_bahath_maalim", "Search milestones by free text.", { istifsar: NASS }, ["istifsar"]),
  ada("wasfa_maalim_faail", "The currently active milestone, if any.", {}),
  ada("wasfa_murashaha", "Wasfat matching assignee, status or cycle.", {
    murashihat: { type: "object" },
    hadd: { type: "number" },
  }, ["murashihat"]),
  ada("wasfa_hala_huwiyya", "Resolve a workflow state name to its id.", { ism: NASS }, ["ism"]),
  ada("wasfa_khalaq", "Create a wasfa.", { mudkhal: { type: "object" } }, ["mudkhal"]),
  ada("wasfa_jaddid", "Update a wasfa.", { huwiyya: NASS, mudkhal: { type: "object" } }, ["huwiyya", "mudkhal"]),
  ada("wasfa_alaqat", "Set blocks / blocked-by relations.", {
    huwiyya: NASS,
    yamnaa: { type: "array", items: NASS },
    mamnu: { type: "array", items: NASS },
  }, ["huwiyya"]),
];

type Hujaj = Record<string, unknown>;

/** Work one operation. Returns JSON text — the shape a tool-result carries. */
export async function naffidhWasfa(
  mutabi: MutabiWasfa,
  name: string,
  args: Hujaj,
): Promise<string> {
  const nass = (k: string) => String(args[k] ?? "");
  const raqm = (k: string) => (typeof args[k] === "number" ? args[k] as number : undefined);

  switch (name) {
    case "wasfa_hala":
      return JSON.stringify({ muqaddim: mutabi.provider, muwaththaq: await mutabi.isAuthenticated() });
    case "wasfa_iqra":
      return JSON.stringify(await mutabi.getIssue(nass("huwiyya")));
    case "wasfa_mashru":
      return JSON.stringify(await mutabi.getProject(nass("huwiyya")));
    case "wasfa_bahath":
      return JSON.stringify(await mutabi.searchIssues(nass("istifsar"), raqm("hadd")));
    case "wasfa_bahath_mashru":
      return JSON.stringify(await mutabi.searchProjects(nass("istifsar")));
    case "wasfa_bahath_maalim":
      return JSON.stringify(await mutabi.searchMilestones?.(nass("istifsar")) ?? []);
    case "wasfa_maalim_faail":
      return JSON.stringify(await mutabi.getActiveMilestone?.() ?? null);
    case "wasfa_murashaha":
      return JSON.stringify(
        await mutabi.getFilteredIssues?.(args.murashihat as never, raqm("hadd")) ?? [],
      );
    case "wasfa_hala_huwiyya":
      return JSON.stringify(await mutabi.getStateId(nass("ism")));
    case "wasfa_khalaq":
      return JSON.stringify(await mutabi.createIssue(args.mudkhal as never));
    case "wasfa_jaddid":
      return JSON.stringify(await mutabi.updateIssue(nass("huwiyya"), args.mudkhal as never));
    case "wasfa_alaqat":
      await mutabi.setRelations(
        nass("huwiyya"),
        args.yamnaa as string[] | undefined,
        args.mamnu as string[] | undefined,
      );
      return JSON.stringify({ tamma: true });
    default:
      throw new Error(`unknown operation: ${name}`);
  }
}

async function awqid(): Promise<void> {
  await logger.baddaa();
  const tasmim = await hammalaAlTasmim();
  const mutabi = createLinearClient(tasmim);

  const thrum = new Thrum({
    masarMiqbas: tasmim.hum?.miqbas,
    khaliyya: ISM_UDW,
    adawat: ADAWAT_WASFA,
    madkhal: false,
  });

  thrum.alaKull(async (nagham: Nagham) => {
    if (nagham.chi !== "tool-call") return;

    const sid = String(nagham.sid ?? "");
    const callId = String(nagham.callId ?? "");
    const name = String(nagham.toolName ?? nagham.name ?? "");
    const args = (nagham.args as Hujaj) ?? {};

    try {
      const natija = await naffidhWasfa(mutabi, name, args);
      thrum.ursil({ chi: "tool-result", sid, callId, result: natija });
    } catch (error) {
      await logger.sajjalKhata(ISM_UDW, `nida ${name} failed`, { error: String(error) });
      // The caller is parked until something comes back. An error is an
      // answer; silence is not.
      thrum.ursil({ chi: "tool-result", sid, callId, result: `Error: ${String(error)}` });
    }
  });

  await thrum.ittasil();
  await logger.akhbar(ISM_UDW, `Nestled as ${thrum.huwiyya}`, { adawat: ADAWAT_WASFA.length });

  const tawaqquf = () => {
    thrum.aghlaq();
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", tawaqquf);
  Deno.addSignalListener("SIGTERM", tawaqquf);

  await new Promise(() => {});
}

if (import.meta.main) {
  await awqid();
}
