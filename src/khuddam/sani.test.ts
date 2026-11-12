import { test, assertEquals, assertStringIncludes } from "../ikhtibar.ts";
import { AlatAlIksir } from "../alat/alat-al-iksir.ts";
import { MudirJalasat } from "./katib.ts";
import { sajjilIstisnaa } from "./sani.ts";
import { makeConfig, mockWasila, mockMessenger, withTestDb } from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

const JALSA: JalsatMurshid = {
  id: "iksir-w3", huwiyya: "W-3", unwan: "the login redirect", naw: "chore", far: "wasfa/w-3",
  hala: "fail", unshiaFi: "2026-11-12T00:00:00.000Z", akhirRisalaFi: "2026-11-12T00:00:00.000Z", channels: {},
};

async function intazir(f: () => boolean): Promise<void> {
  const azal = Date.now() + 3000;
  while (!f() && Date.now() < azal) await new Promise((r) => setTimeout(r, 10));
  assertEquals(f(), true);
}

test("sani: a murshid summons a craftsman; the report comes back into its vessel; the bloom is closed", async () => {
  await withTestDb(async () => {
    const amil = mockWasila({ sendPrompt: async () => ({ success: true, response: "## Najāḥ\n\nredirect fixed; tests pass" }) });
    const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul: mockMessenger() });
    katib.istawradaHala({ murshidun: [JALSA], murshidFaail: "W-3" });
    amil._sessions.set(JALSA.id, { id: JALSA.id, title: "t", createdAt: new Date(), lastMessageAt: new Date() });
    const alat = new AlatAlIksir();
    sajjilIstisnaa(alat, amil as never, katib);

    const radd = await alat.sijill.naffidh("mun_istasnaa", { huwiyyatMurshid: "W-3", task: "## Waṣfa: W-3\n\nfix the redirect" });
    assertStringIncludes(radd, "Ṣāniʿ 1 is sent for: ## Waṣfa: W-3");
    assertEquals(alat.sijill.adawat().find((a) => a.name === "mun_istasnaa")?.khass, "murshid");

    await intazir(() => amil._calls.sendPromptAsync.length === 1);
    assertEquals(amil._calls.khalaqaJalsa[0].huwiyyatWasfa, "W-3");
    assertEquals(amil._calls.sendPrompt[0].prompt, "## Waṣfa: W-3\n\nfix the redirect");
    assertEquals((amil._calls.sendPrompt[0].options as { agent: string; adawat: string[] }).agent, "iksir-sani");
    assertEquals((amil._calls.sendPrompt[0].options as { adawat: string[] }).adawat, []);
    assertEquals(amil._calls.sendPromptAsync[0].sessionId, JALSA.id);
    assertStringIncludes(amil._calls.sendPromptAsync[0].prompt, "## Ṣāniʿ returned — ## Waṣfa: W-3");
    assertStringIncludes(amil._calls.sendPromptAsync[0].prompt, "redirect fixed; tests pass");
    await intazir(() => amil._sessions.size === 1);

    assertStringIncludes(await alat.sijill.naffidh("mun_istasnaa", { huwiyyatMurshid: "W-9", task: "x" }), "No murshid labours on W-9");
  });
});

test("sani: a craftsman that never returns is reported as lost, not swallowed", async () => {
  await withTestDb(async () => {
    const amil = mockWasila({ sendPrompt: async () => ({ success: false, error: "prompt timed out after 3600000ms" }) });
    const katib = new MudirJalasat({ tasmim: makeConfig(), amil: amil as never, rasul: mockMessenger() });
    katib.istawradaHala({ murshidun: [JALSA], murshidFaail: "W-3" });
    const alat = new AlatAlIksir();
    sajjilIstisnaa(alat, amil as never, katib);

    await alat.sijill.naffidh("mun_istasnaa", { huwiyyatMurshid: "W-3", task: "dig" });
    await intazir(() => amil._calls.sendPromptAsync.length === 1);
    assertStringIncludes(amil._calls.sendPromptAsync[0].prompt, "The ṣāniʿ did not return: prompt timed out");
  });
});
