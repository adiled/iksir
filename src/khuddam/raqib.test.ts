import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { Raqib } from "./raqib.ts";
import { MudirJalasat } from "./katib.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

const JALSA: JalsatMurshid = {
  id: "iksir-w7", huwiyya: "W-7", unwan: "fix the login redirect", naw: "chore", far: "wasfa/w-7",
  hala: "fail", unshiaFi: "2026-11-12T00:00:00.000Z", akhirRisalaFi: "2026-11-12T00:00:00.000Z", channels: {},
};

function mashhad(hukm: string | null, athar: string[]) {
  const amil = mockWasila({ sendPrompt: async () => (hukm === null ? { success: false, error: "mute" } : { success: true, response: hukm }) });
  amil._athar[JALSA.id] = athar;
  const rasul = mockMessenger();
  const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul });
  katib.istawradaHala({ murshidun: [JALSA], murshidFaail: JALSA.huwiyya });
  const raqib = new Raqib({ amil: amil as never, rasul, mudirJalasat: katib });
  return { amil, rasul, raqib };
}

const DAIRA = ["10:00:01 → bash {\"command\":\"npm test\"}", "10:00:40 → bash {\"command\":\"npm test\"}", "10:01:20 → bash {\"command\":\"npm test\"}", "10:02:00 still failing, trying again"];

test("raqib: a trail going in circles earns a word in the vessel, and twice running a word to al-Kimyawī", async () => {
  await withTestDb(async () => {
    const { amil, rasul, raqib } = mashhad('{"hukm":"yadur","sabab":"npm test thrice, unchanged","kalima":"Read the failing assertion before running it again."}', DAIRA);

    const hukm = await raqib.hakama(JALSA);
    assertEquals(hukm?.hukm, "yadur");
    assertEquals(amil._calls.khalaqaJalsa[0].huwiyyatWasfa, "iksir-raqib");
    assertEquals((amil._calls.sendPrompt[0].options as { agent: string; adawat: string[] }).agent, "iksir-raqib");
    assertEquals((amil._calls.sendPrompt[0].options as { adawat: string[] }).adawat, []);
    assertStringIncludes((amil._calls.sendPrompt[0].options as { kalimat: { athar: string } }).kalimat.athar, "npm test");
    assertEquals(amil._calls.sendPromptAsync.length, 1);
    assertStringIncludes(amil._calls.sendPromptAsync[0].prompt, "Al-Raqīb watches: Read the failing assertion");
    assertEquals(rasul._calls.arsalaMunassaq.length, 0);
    assertEquals(amil._sessions.size, 0);

    amil._athar[JALSA.id] = [...DAIRA, "10:03:00 → bash {\"command\":\"npm test\"}"];
    assertEquals(await raqib.hakama(JALSA), null);
    raqib.wajadaAwKhalaqaHala(JALSA.id).akhirHukmFi = 0;
    assertEquals((await raqib.hakama(JALSA))?.hukm, "yadur");
    assertEquals(rasul._calls.arsalaMunassaq.length, 1);
    assertStringIncludes(rasul._calls.arsalaMunassaq[0].text, "going in circles");
  });
});

test("raqib: a trail that progresses is left alone, and a trail that has not grown is not judged again", async () => {
  await withTestDb(async () => {
    const { amil, raqib } = mashhad('{"hukm":"yataqaddam","sabab":"each step differs","kalima":null}', ["a", "b", "c"]);
    assertEquals((await raqib.hakama(JALSA))?.hukm, "yataqaddam");
    assertEquals(amil._calls.sendPromptAsync.length, 0);
    raqib.wajadaAwKhalaqaHala(JALSA.id).akhirHukmFi = 0;
    assertEquals(await raqib.hakama(JALSA), null);
    assertEquals(amil._calls.sendPrompt.length, 1);
  });
});

test("raqib: too short a trail, a mute bee, or a verdict that is not JSON — nothing is said", async () => {
  await withTestDb(async () => {
    const qasir = mashhad('{"hukm":"yadur"}', ["one", "two"]);
    assertEquals(await qasir.raqib.hakama(JALSA), null);
    assertEquals(qasir.amil._calls.sendPrompt.length, 0);

    const akhras = mashhad(null, ["a", "b", "c"]);
    assertEquals(await akhras.raqib.hakama(JALSA), null);
    assertEquals(akhras.amil._calls.sendPromptAsync.length, 0);

    const halwas = mashhad("I think it is fine", ["a", "b", "c"]);
    assertEquals(await halwas.raqib.hakama(JALSA), null);
    assertEquals(halwas.amil._calls.sendPromptAsync.length, 0);
  });
});

test("raqib: a murshid truly blocked is carried to al-Kimyawī in its topic and in Dispatch", async () => {
  await withTestDb(async () => {
    const { rasul, raqib } = mashhad('{"hukm":"yastaghith","sabab":"needs the Stripe test key","kalima":null}', ["a", "b", "c"]);
    assertEquals((await raqib.hakama(JALSA))?.hukm, "yastaghith");
    assertEquals(rasul._calls.arsalaMunassaq.length, 2);
    assertStringIncludes(rasul._calls.arsalaMunassaq[1].text, "needs al-Kimyawī — needs the Stripe test key");
  });
});
