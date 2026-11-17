import { test, assertEquals } from "../ikhtibar.ts";
import { mockWasila } from "../test-helpers.ts";
import { mayyazaTanbih, saffaRadd } from "./mumayyiz.ts";

const TALIM = "Speak to me in three lines.";
const amilBi = (response: string | null) => mockWasila({ mayyaza: async () => (response === null ? { success: false, error: "cold" } : { success: true, response }) });

test("mumayyiz: a notice ruled dhahab goes on, refined; the Taʿlīm is before the cupel", async () => {
  const amil = amilBi('{"tamyiz":"DHAHAB","reason":"architecture question","rejection":null,"nass":"Is the API boundary here?"}');
  const hukm = await mayyazaTanbih(amil as never, "Well, so, I was wondering, is this a good API boundary?", TALIM);
  assertEquals(hukm, { dhahab: true, sabab: "architecture question", radd: null, nass: "Is the API boundary here?" });
  assertEquals(amil._calls.mayyaza[0].includes(TALIM), true);
  assertEquals(amil._calls.mayyaza[0].includes("is this a good API boundary?"), true);
});

test("mumayyiz: a notice ruled khabath goes back with a word; a missing word gets the house's", async () => {
  const hukm = await mayyazaTanbih(amilBi('{"tamyiz":"KHABATH","reason":"debugging","rejection":"Read the failing assertion."}') as never, "This test is failing", TALIM);
  assertEquals(hukm.dhahab, false);
  assertEquals(hukm.radd, "Read the failing assertion.");
  assertEquals((await mayyazaTanbih(amilBi('{"tamyiz":"KHABATH","reason":"trivial"}') as never, "x", TALIM)).radd, "Handle this autonomously.");
});

test("mumayyiz: a cold cupel, or a verdict that is not JSON, lets the word pass as it was", async () => {
  for (const amil of [amilBi(null), amilBi("this is not json"), amilBi('{"tamyiz":"DHAHAB"}')]) {
    const hukm = await mayyazaTanbih(amil as never, "the word", TALIM);
    assertEquals(hukm.dhahab, true);
    assertEquals(hukm.nass, "the word");
  }
});

test("mumayyiz: a reply is refined to its gleam, and passes whole when the cupel is cold", async () => {
  assertEquals(await saffaRadd(amilBi('{"nass":"Done; PR #71 is up."}') as never, "So after a long investigation ... PR #71 is up, as you can see", TALIM), "Done; PR #71 is up.");
  assertEquals(await saffaRadd(amilBi(null) as never, "as it was", TALIM), "as it was");
  assertEquals(await saffaRadd(amilBi('{"nass":"   "}') as never, "as it was", TALIM), "as it was");
});
