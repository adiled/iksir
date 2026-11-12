import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { Munaffidh } from "./munaffidh.ts";
import { MudirJalasat } from "./katib.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";

function mashhad(yasil: boolean) {
  const rasul = { ...mockMessenger(), arsalaMunassaq: async () => yasil };
  const katib = new MudirJalasat({ tasmim: makeConfig(), amil: mockWasila() as never, rasul });
  return new Munaffidh({
    tasmim: makeConfig(),
    wasfat: undefined as never,
    rasul,
    ntfy: undefined as never,
    mudirJalasat: katib,
    amil: mockWasila() as never,
    sayrafi: undefined as never,
  });
}

const radd = { tool: "mun_radd" as const, huwiyyatMurshid: "GH-9", risala: "**unbalanced" };

test("a reply the messenger refused is not reported as sent", async () => {
  await withTestDb(async () => {
    const natija = await mashhad(false).aalajRadd(radd);
    assertStringIncludes(natija, "did not reach");
  });
});

test("a reply the messenger carried is reported as sent", async () => {
  await withTestDb(async () => {
    assertEquals((await mashhad(true).aalajRadd(radd)).startsWith("Reply sent"), true);
  });
});
