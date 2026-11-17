import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { Munaffidh } from "./munaffidh.ts";
import { MudirJalasat } from "./katib.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";

function mashhad(yasil: boolean, saffa?: string) {
  const wusul: string[] = [];
  const rasul = { ...mockMessenger(), arsalaMunassaq: async (_q: unknown, nass: string) => { wusul.push(nass); return yasil; } };
  const amil = mockWasila({ mayyaza: async () => (saffa ? { success: true, response: JSON.stringify({ nass: saffa }) } : { success: false, error: "cold" }) });
  const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul });
  const munaffidh = new Munaffidh({
    tasmim: makeConfig(),
    wasfat: undefined as never,
    rasul,
    ntfy: undefined as never,
    mudirJalasat: katib,
    amil: amil as never,
    sayrafi: undefined as never,
  });
  return { munaffidh, wusul };
}

const radd = { tool: "mun_radd" as const, huwiyyatMurshid: "GH-9", risala: "**unbalanced" };

test("a reply the messenger refused is not reported as sent", async () => {
  await withTestDb(async () => {
    const natija = await mashhad(false).munaffidh.aalajRadd(radd);
    assertStringIncludes(natija, "did not reach");
  });
});

test("a reply the messenger carried is reported as sent", async () => {
  await withTestDb(async () => {
    const { munaffidh, wusul } = mashhad(true);
    assertEquals((await munaffidh.aalajRadd(radd)).startsWith("Reply sent"), true);
    assertEquals(wusul, ["**unbalanced"]);
  });
});

test("a reply reaches al-Kimyawī through the cupel, refined", async () => {
  await withTestDb(async () => {
    const { munaffidh, wusul } = mashhad(true, "Balanced.");
    await munaffidh.aalajRadd({ ...radd, risala: "So, after much thought and a long night, **unbalanced, I believe, mostly" });
    assertEquals(wusul, ["Balanced."]);
  });
});
