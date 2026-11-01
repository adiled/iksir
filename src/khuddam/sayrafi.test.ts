import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { Munaffidh } from "./munaffidh.ts";
import { MudirJalasat } from "./katib.ts";
import { Sayrafi } from "./sayrafi.ts";
import { anshaaSijillWasfat } from "../wasfa/sijill.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";

function mashhad() {
  const wasfat = anshaaSijillWasfat("W");
  const alat = new AlatAlIksir(wasfat);
  const amil = mockWasila();
  const rasul = mockMessenger();
  const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul });
  const sayrafi = new Sayrafi(amil as never);
  const munaffidh = new Munaffidh({
    tasmim: makeConfig(),
    wasfat,
    rasul,
    ntfy: undefined as never,
    mudirJalasat: katib,
    amil: amil as never,
    sayrafi,
  });
  return { wasfat, alat, amil, rasul, munaffidh };
}

const natijat = (...kharaja: number[]) =>
  ["npm test", "./build"].map((mayar, i) => ({ mayar, kharaja: kharaja[i] ?? 0, qawl: kharaja[i] ? "FAIL 1 test" : "ok" }));

test("the fire is lit by the sayrafi in a session of its own, carrying the declared maʿāyīr", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, amil, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-9", unwan: "t", hala: "backlog", mayayir: ["npm test", "./build"] });

    await alat.sijill.naffidh("mun_safa", { huwiyyatMurshid: "GH-9", huwiyyatWasfa: "GH-9" });
    await munaffidh.aalajAhdath();

    assertEquals(amil._calls.khalaqaJalsa.at(-1)?.huwiyyatWasfa, "iksir-sayrafi");
    const bath = amil._calls.sendPromptAsync.at(-1)!;
    assertStringIncludes(bath.prompt, "- `npm test`");
    assertStringIncludes(bath.prompt, "- `./build`");
    assertEquals((await wasfat.iqra("GH-9"))?.hala, "backlog");
  });
});

test("testimony that every maʿyār withstood makes the wasfa ṣāfī", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, rasul, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-9", unwan: "t", hala: "backlog", mayayir: ["npm test", "./build"] });

    await alat.sijill.naffidh("mun_shahada", { huwiyyatWasfa: "GH-9", naw: "safa", natijat: natijat(0, 0) });
    await munaffidh.aalajAhdath();

    assertEquals((await wasfat.iqra("GH-9"))?.hala, "safi");
    assertEquals(rasul._calls.arsalaMunassaq.some((m) => m.text.includes("ṣāfī")), true);
  });
});

test("one burned maʿyār and the matter did not stand", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, rasul, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-9", unwan: "t", hala: "backlog", mayayir: ["npm test", "./build"] });

    await alat.sijill.naffidh("mun_shahada", { huwiyyatWasfa: "GH-9", naw: "safa", natijat: natijat(1, 0) });
    await munaffidh.aalajAhdath();

    assertEquals((await wasfat.iqra("GH-9"))?.hala, "backlog");
    const qawl = rasul._calls.arsalaMunassaq.at(-1)!.text;
    assertStringIncludes(qawl, "did not stand");
    assertStringIncludes(qawl, "`npm test` → exit 1");
  });
});

test("faṣl is refused before the fire, and after it the sayrafi sets the jawhar down", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, amil, rasul, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-9", unwan: "a nurse", hala: "backlog", mayayir: ["npm test"] });

    await alat.sijill.naffidh("mun_fasl", { huwiyyatMurshid: "GH-9", huwiyyatWasfa: "GH-9", title: "x", body: "y" });
    await munaffidh.aalajAhdath();
    assertEquals(amil._calls.khalaqaJalsa.length, 0);

    await wasfat.jaddid("GH-9", { hala: "safi" });
    await alat.sijill.naffidh("mun_fasl", { huwiyyatMurshid: "GH-9", huwiyyatWasfa: "GH-9", title: "hive/apple-fm", body: "the jawhar" });
    await munaffidh.aalajAhdath();
    assertEquals(amil._calls.khalaqaJalsa.at(-1)?.huwiyyatWasfa, "iksir-sayrafi");
    assertStringIncludes(amil._calls.sendPromptAsync.at(-1)!.prompt, "Title: hive/apple-fm");

    await alat.sijill.naffidh("mun_shahada", { huwiyyatWasfa: "GH-9", naw: "fasl", rabit: "https://github.com/adiled/hum/pull/71", huwiyya: "71" });
    await munaffidh.aalajAhdath();
    assertEquals((await wasfat.iqra("GH-9"))?.hala, "mafsul");
    assertEquals(rasul._calls.arsalaMunassaq.some((m) => m.channel === "kimyawi" && m.text.includes("pull/71")), true);
  });
});

test("a testimony of khata leaves the register as it was", async () => {
  await withTestDb(async () => {
    const { wasfat, alat, rasul, munaffidh } = mashhad();
    await wasfat.khalaq({ huwiyya: "GH-9", unwan: "t", hala: "mafsul" });

    await alat.sijill.naffidh("mun_shahada", { huwiyyatWasfa: "GH-9", naw: "naqsh", khata: "checks still running" });
    await munaffidh.aalajAhdath();

    assertEquals((await wasfat.iqra("GH-9"))?.hala, "mafsul");
    assertStringIncludes(rasul._calls.arsalaMunassaq.at(-1)!.text, "would not take");
  });
});
