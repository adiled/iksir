import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { anshaaSijillWasfat } from "../wasfa/sijill.ts";
import type { Wasfa } from "../wasfa/sijill-wasfat.ts";
import { makeConfig, withTestDb } from "../test-helpers.ts";

function mashhad() {
  const wasfat = anshaaSijillWasfat("W");
  const alat = new AlatAlIksir(wasfat, makeConfig());
  return { wasfat, alat };
}

test("a wasfa is inscribed with its fire, the moment the instrument is used", async () => {
  await withTestDb(async () => {
    const { wasfat, alat } = mashhad();

    const radd = await alat.sijill.naffidh("mun_khalaq_wasfa", {
      huwiyyatMurshid: "dispatch",
      huwiyya: "GH-9",
      title: "a nurse for the on-device model",
      description: "from the issue",
      labels: ["github"],
      status: "backlog",
      mayayir: ["cargo test -p apple-fm", "./build"],
    });

    assertStringIncludes(radd, "Inscribed GH-9 — a nurse for the on-device model.");
    const wasfa = await wasfat.iqra("GH-9");
    assertEquals(wasfa?.mayayir, ["cargo test -p apple-fm", "./build"]);
    assertEquals(wasfa?.wasm, ["github"]);
    assertEquals(wasfa?.hala, "backlog");
  });
});

test("ʿĀlim needs no ID: a title alone is inscribed, the Sijill mints the name, and Dispatch is told", async () => {
  await withTestDb(async () => {
    const { wasfat, alat } = mashhad();
    const shuhud: Array<[Wasfa, string | undefined]> = [];
    alat.indaNaqsh((w, min) => shuhud.push([w, min]));

    const radd = await alat.sijill.naffidh("mun_khalaq_wasfa", { title: "study the dispatch friction" });

    assertStringIncludes(radd, "Inscribed W-1 — study the dispatch friction.");
    assertEquals((await wasfat.iqra("W-1"))?.unwan, "study the dispatch friction");
    assertEquals(shuhud.length, 1);
    assertEquals(shuhud[0][0].huwiyya, "W-1");
    assertEquals(shuhud[0][1], undefined);
  });
});

test("an alteration lands at once and says what changed", async () => {
  await withTestDb(async () => {
    const { wasfat, alat } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-71", unwan: "before", matn: "unmerged", hala: "backlog" });

    const radd = await alat.sijill.naffidh("mun_jaddid_wasfa", {
      huwiyyatMurshid: "GH-71",
      huwiyyatWasfa: "GH-71",
      updates: { description: "merged as e4d5f4a", status: "done", mayayir: ["npm test"] },
    });

    assertStringIncludes(radd, "Altered GH-71: wasf, hala, mayayir.");
    const wasfa = await wasfat.iqra("GH-71");
    assertEquals(wasfa?.unwan, "before");
    assertEquals(wasfa?.matn, "merged as e4d5f4a");
    assertEquals(wasfa?.hala, "done");
    assertEquals(wasfa?.mayayir, ["npm test"]);

    assertStringIncludes(await alat.sijill.naffidh("mun_jaddid_wasfa", { huwiyyatWasfa: "GH-0", updates: {} }), "No waṣfa named GH-0");
  });
});

test("a wasfa takes the roster whole, or narrows it; it never widens it", async () => {
  await withTestDb(async () => {
    const { wasfat, alat } = mashhad();

    await alat.sijill.naffidh("mun_khalaq_wasfa", { huwiyyatMurshid: "dispatch", huwiyya: "GH-1", title: "whole" });
    await alat.sijill.naffidh("mun_khalaq_wasfa", { huwiyyatMurshid: "dispatch", huwiyya: "ENG-2", title: "narrowed", sijillat: ["github"] });
    const radd = await alat.sijill.naffidh("mun_khalaq_wasfa", { huwiyyatMurshid: "dispatch", huwiyya: "X-3", title: "widened", kur: ["linear-server"] });

    assertEquals((await wasfat.iqra("GH-1"))?.kur, ["github"]);
    assertEquals((await wasfat.iqra("GH-1"))?.sijillat, ["github"]);
    assertEquals((await wasfat.iqra("ENG-2"))?.sijillat, ["github"]);
    assertEquals(await wasfat.iqra("X-3"), null);
    assertStringIncludes(radd, 'Not inscribed: "linear-server" is not a kur in your config');
  });
});

test("an alteration of the three is held to the roster too", async () => {
  await withTestDb(async () => {
    const { wasfat, alat } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-5", unwan: "x", kur: ["github"], majlis: [], sijillat: ["github"] });

    await alat.sijill.naffidh("mun_jaddid_wasfa", { huwiyyatMurshid: "GH-5", huwiyyatWasfa: "GH-5", updates: { kur: ["gitlab"] } });
    assertEquals((await wasfat.iqra("GH-5"))?.kur, ["github"]);

    await alat.sijill.naffidh("mun_jaddid_wasfa", { huwiyyatMurshid: "GH-5", huwiyyatWasfa: "GH-5", updates: { sijillat: [] } });
    assertEquals((await wasfat.iqra("GH-5"))?.sijillat, []);
  });
});
