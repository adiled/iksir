/**
 * Al-Wahm (الوهم) — the illusory nurse, for the examination.
 *
 * A nurse bee that grows no thought: it does exactly what the words tell
 * it. Lines in a prompt that begin with a verb are its programme —
 *
 *   say <text>            a text petal
 *   reach <tool> <json>   a tendril to the forager's instrument, then its grasp, said back as "← ..."
 *   sleep <ms>            wait
 *   fail <message>        the bloom breaks off (error)
 *   die <code>            the cell dies without wilting (wilt, reason error)
 *
 * — and a prompt with no verb is answered "ok". It prints one line per
 * tone it handles, so the examiner can count prompts and wilts per sid.
 * Its hello names the model "wahm"; point hum.namudhaj at it.
 */

import { Bee, Chi, PetalKind, Refused, Role } from "thrum";

const qul = (satr: string) => process.stdout.write(satr + "\n");
const AWAMIR = /^(say|reach|sleep|fail|die)\b/;
const SIA = { freeSlots: 8, totalSlots: 8 };
let adadNida = 0;

const bee = new Bee({
  hive: "wahm",
  as: "main",
  role: Role.nurse,
  hello: { version: "1.0.0", models: ["wahm"], headroom: SIA },
});

function barnamaj(nass: string): string[] {
  return nass.split(/\n|;/).map((s) => s.trim()).filter((s) => AWAMIR.test(s));
}

async function ijra(tone: { sid?: string; text?: string; systemPrompt?: string }): Promise<void> {
  const sid = tone.sid ?? "";
  const nass = tone.text ?? "";
  qul(`prompt ${sid} ${(tone.systemPrompt ?? "").split("\n")[0].slice(0, 48)}`);
  bee.send({ chi: Chi.pulse, sid, kind: "cell-ready", cell: `cell-${sid}`, headroom: SIA });
  let petal = 0;
  const awamir = barnamaj(nass);
  if (awamir.length === 0) awamir.push("say ok");
  for (const amr of awamir) {
    const [fil, ...baqi] = amr.split(/\s+/);
    const rest = baqi.join(" ");
    if (fil === "say") {
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.text, text: rest });
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.text, closed: true });
      petal++;
    } else if (fil === "sleep") {
      await new Promise((r) => setTimeout(r, Number(rest) || 0));
    } else if (fil === "fail") {
      bee.send({ chi: Chi.error, sid, message: rest || "failed" });
      qul(`error ${sid}`);
      return;
    } else if (fil === "die") {
      bee.send({ chi: Chi.wilt, sid, reason: "error", exitCode: Number(rest) || 137 });
      qul(`wilt ${sid} error`);
      return;
    } else if (fil === "reach") {
      const [ism, ...juz] = rest.split(/\s+/);
      const args = juz.length ? JSON.parse(juz.join(" ")) : {};
      const callId = `c${++adadNida}`;
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.tendril, callId, name: ism, sap: JSON.stringify(args), closed: true });
      petal++;
      const natija = await new Promise<{ output?: string; result?: unknown; isError?: boolean }>((hal) => {
        bee.onSid(sid, (t) => {
          if (t.chi === Chi.tendrilResult && t.callId === callId) {
            bee.offSid(sid);
            hal(t as unknown as { output?: string; result?: unknown; isError?: boolean });
          }
        });
        bee.send({ chi: Chi.tendrilReach, sid, callId, name: ism, args });
      });
      const kharaj = natija.output ?? JSON.stringify(natija.result ?? "");
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.grasp, callId, result: kharaj, isError: natija.isError, closed: true } as never);
      petal++;
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.text, text: `← ${kharaj}` });
      bee.send({ chi: Chi.unfurl, sid, petal, kind: PetalKind.text, closed: true });
      petal++;
      qul(`reach ${sid} ${ism}`);
    }
  }
  bee.send({ chi: Chi.wilt, sid, reason: "stop" });
  qul(`wilt ${sid}`);
}

bee.on(Chi.prompt, (tone) => void ijra(tone as never).catch((kh) => qul(`failed ${String(kh)}`)));
bee.on(Chi.cancel, (tone) => { bee.send({ chi: Chi.wilt, sid: tone.sid, reason: "cancel" }); qul(`wilt ${tone.sid} cancel`); });
bee.onNestled(() => qul("nestled"));
bee.onAstray(() => qul("astray"));
process.stdin.on("end", () => void bee.close());
process.stdin.resume();

try {
  await bee.start();
  await bee.closed();
  process.exit(0);
} catch (e) {
  qul(e instanceof Refused ? `refused ${e.reason}` : `failed ${(e as Error).message}`);
  process.exit(1);
}
