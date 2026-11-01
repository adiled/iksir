import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { Munaffidh } from "./munaffidh.ts";
import { MudirJalasat } from "./katib.ts";
import { anshaaSijillWasfat } from "../wasfa/sijill.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";

function mashhad() {
  const wasfat = anshaaSijillWasfat("W");
  const alat = new AlatAlIksir(wasfat);
  const katib = new MudirJalasat({
    tasmim: makeConfig(),
    amil: mockWasila() as never,
    rasul: mockMessenger(),
  });
  const munaffidh = new Munaffidh({
    tasmim: makeConfig(),
    wasfat,
    rasul: mockMessenger(),
    ntfy: undefined as never,
    mudirJalasat: katib,
    amil: mockWasila() as never,
    sayrafi: undefined as never,
  });
  return { wasfat, alat, munaffidh };
}

test("a wasfa is inscribed with its fire", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, munaffidh } = mashhad();

    await alat.sijill.naffidh("mun_khalaq_wasfa", {
      huwiyyatMurshid: "dispatch",
      huwiyya: "GH-9",
      title: "a nurse for the on-device model",
      description: "from the ticket",
      labels: ["github"],
      status: "backlog",
      mayayir: ["cargo test -p apple-fm", "./build"],
    });
    await munaffidh.aalajAhdath();

    const wasfa = await wasfat.iqra("GH-9");
    assertEquals(wasfa?.mayayir, ["cargo test -p apple-fm", "./build"]);
    assertEquals(wasfa?.wasm, ["github"]);
    assertEquals(wasfa?.hala, "backlog");
  });
});

test("an alteration speaks the instrument's own words and lands", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-71", unwan: "before", matn: "unmerged", hala: "backlog" });

    const radd = await alat.sijill.naffidh("mun_jaddid_wasfa", {
      huwiyyatMurshid: "GH-71",
      huwiyyatWasfa: "GH-71",
      updates: {
        description: "merged as e4d5f4a",
        status: "done",
        mayayir: ["npm test"],
      },
    });
    await munaffidh.aalajAhdath();

    assertStringIncludes(radd, "merged as e4d5f4a");
    const wasfa = await wasfat.iqra("GH-71");
    assertEquals(wasfa?.unwan, "before");
    assertEquals(wasfa?.matn, "merged as e4d5f4a");
    assertEquals(wasfa?.hala, "done");
    assertEquals(wasfa?.mayayir, ["npm test"]);
  });
});
