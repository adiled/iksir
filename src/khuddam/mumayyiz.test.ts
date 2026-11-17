import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { MudirJalasat } from "./katib.ts";
import { Mumayyiz } from "./mumayyiz.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

const JALSA: JalsatMurshid = {
  id: "iksir-w3", huwiyya: "W-3", unwan: "the login redirect", naw: "chore", far: "wasfa/w-3",
  hala: "fail", unshiaFi: "2026-11-12T00:00:00.000Z", akhirRisalaFi: "2026-11-12T00:00:00.000Z", channels: {},
};

function mashhad(hukm: string | null) {
  const amil = mockWasila({ sendPrompt: async () => (hukm === null ? { success: false, error: "cold" } : { success: true, response: hukm }) });
  const rasul = mockMessenger();
  const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul });
  katib.istawradaHala({ murshidun: [JALSA], murshidFaail: "W-3" });
  const alat = new AlatAlIksir();
  new Mumayyiz({ amil: amil as never, tasmim: makeConfig(), rasul, mudirJalasat: katib }).sajjil(alat);
  return { amil, rasul, alat };
}

test("mumayyiz: a reply goes up as what was asked, and the murshid hears the house back as the grasp", async () => {
  await withTestDb(async () => {
    const { amil, rasul, alat } = mashhad('{"nass":"PR #71 is up.","radd":"Carried. The tests you ask about are the waṣfa\'s own maʿāyīr; run them."}');
    amil._athar; 
    const grasp = await alat.sijill.naffidh("mun_radd", { huwiyyatMurshid: "W-3", message: "So after a long night... PR #71 is up. Also which tests should I run?" });

    assertEquals(rasul._calls.arsalaMunassaq, [{ channel: { murshid: "W-3" }, text: "PR #71 is up." }]);
    assertStringIncludes(grasp, "Carried. The tests you ask about");
    assertStringIncludes(grasp, "Reached al-Kimyawī:\nPR #71 is up.");
    const hathth = amil._calls.sendPrompt[0];
    assertEquals(hathth.prompt, "So after a long night... PR #71 is up. Also which tests should I run?");
    const khiyarat = hathth.options as { agent: string; graft: unknown[]; kalimat: { huwiyya: string; talim: string } };
    assertEquals(khiyarat.agent, "iksir-mumayyiz");
    assertEquals(Array.isArray(khiyarat.graft), true);
    assertEquals(khiyarat.kalimat.huwiyya, "W-3");
    assertEquals(amil._calls.khalaqaJalsa[0].huwiyyatWasfa, "iksir-mumayyiz");
  });
});

test("mumayyiz: a notice that is the house's to answer goes nowhere up; the murshid gets the answer", async () => {
  await withTestDb(async () => {
    const { rasul, alat } = mashhad('{"nass":"","radd":"The precedent is in the diary: use the existing session store."}');
    const grasp = await alat.sijill.naffidh("mun_balligh", { huwiyyatMurshid: "W-3", message: "Should I use pattern X or Y?", awwaliyya: "default" });
    assertEquals(rasul._calls.arsalaMunassaq.length, 0);
    assertEquals(grasp, "The precedent is in the diary: use the existing session store.");
  });
});

test("mumayyiz: a cold cupel, or a ruling that is not JSON, sends the word up as it was and says so", async () => {
  await withTestDb(async () => {
    for (const hukm of [null, "I think it is fine"]) {
      const { rasul, alat } = mashhad(hukm);
      const grasp = await alat.sijill.naffidh("mun_radd", { huwiyyatMurshid: "W-3", message: "as it was" });
      assertEquals(rasul._calls.arsalaMunassaq.at(-1)?.text, "as it was");
      assertStringIncludes(grasp, "The cupel was cold");
    }
  });
});

test("mumayyiz: the instruments are the murshid's, and they take their time", async () => {
  await withTestDb(async () => {
    const { alat } = mashhad(null);
    const radd = alat.sijill.adawat().find((a) => a.name === "mun_radd")!;
    assertEquals(radd.khass, "murshid");
    assertEquals((radd.muhla ?? 0) > 150_000, true);
  });
});
