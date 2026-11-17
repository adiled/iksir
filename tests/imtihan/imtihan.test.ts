/**
 * Al-Imtiḥān — iksir examined by iksir.
 *
 * The real daemon, nestled on a private humd, spoken to through its own
 * majlis, with a nurse that does what the words say. One standing-place
 * for the whole examination; each test adds to the house the last left.
 */

import { after } from "node:test";
import { test, assertEquals, assertStringIncludes } from "../../src/ikhtibar.ts";
import { qumBilMaqam, type Maqam } from "./maqam.ts";

let maqam: Maqam;

after(() => {
  if (!maqam) return;
  for (const [ism, sutur] of [["wahm", maqam.wahm()], ["iksir", maqam.iksir()]] as const) {
    process.stderr.write(`── ${ism}, last lines ──\n${sutur.slice(-40).join("\n")}\n`);
  }
  maqam.uqtul();
});

test("imtihan: the house stands — humd, the wahm nurse, and iksir nestled on it", async () => {
  maqam = await qumBilMaqam();
  assertEquals(maqam.iksir().some((s) => s.includes("Nestled as munadi=")), true);
});

test("imtihan: a word at the majlis reaches al-Munādī through the nest, and his answer lands in Dispatch", async () => {
  maqam.qul("say Marhaba, ya Kimyawi.");
  await maqam.intazir(() => maqam.dispatch().includes("Marhaba, ya Kimyawi."), 15_000, "the answer in Dispatch");
  const hathth = maqam.wahm().find((s) => s.startsWith("prompt ") && s.includes("You Are al-Munādī"));
  assertEquals(Boolean(hathth), true);
});

test("imtihan: work is inscribed by instrument, through humd, and the Sijill holds it", async () => {
  maqam.qul('reach mun_khalaq_wasfa {"huwiyyatMurshid":"dispatch","title":"fix the gate"}');
  await maqam.intazir(() => maqam.dispatch().includes("Inscribed W-1 — fix the gate."), 15_000, "the inscription answered");
  const wasfat = maqam.sijill<{ huwiyya: string; unwan: string }>("SELECT huwiyya, unwan FROM wasfat");
  assertEquals(wasfat, [{ huwiyya: "W-1", unwan: "fix the gate" }]);
});

test("imtihan: a summons opens one vessel with one opening prompt; the murshid's word reaches its own channel", async () => {
  maqam.qul('reach mun_istadi {"huwiyya":"W-1"}');
  await maqam.intazir(() => maqam.dispatch().includes("Murshid summoned for W-1"), 20_000, "the summons answered");
  const jalasat = maqam.sijill<{ huwiyya: string; id: string }>("SELECT huwiyya, id FROM jalasat WHERE huwiyya = 'W-1'");
  assertEquals(jalasat.length, 1);
  const sid = jalasat[0].id;
  await maqam.intazir(() => maqam.wahm().includes(`wilt ${sid}`), 15_000, "the opening turn to wilt");
  const hathath = maqam.wahm().filter((s) => s.startsWith(`prompt ${sid}`));
  assertEquals(hathath.length, 1);
  assertStringIncludes(hathath[0], "You Are al-Murshid");

  maqam.qul('@W-1 reach mun_radd {"huwiyyatMurshid":"W-1","message":"I have read it, and I begin."}');
  await maqam.intazir(() => maqam.qanat("W-1").includes("I have read it, and I begin."), 20_000, "the murshid's word in its channel");
});

test("imtihan: words to a murshid go one turn at a time", async () => {
  const sid = maqam.sijill<{ id: string }>("SELECT id FROM jalasat WHERE huwiyya = 'W-1'")[0].id;
  const adad = (bidaya: string) => maqam.wahm().filter((s) => s.startsWith(bidaya)).length;
  await maqam.intazir(() => adad(`wilt ${sid}`) === adad(`prompt ${sid}`), 20_000, "the murshid's open turn to wilt");
  const qabl = maqam.wahm().length;
  maqam.qul("@W-1 sleep 1200; say slow");
  maqam.qul("@W-1 say fast");
  await maqam.intazir(() => maqam.wahm().slice(qabl).filter((s) => s === `wilt ${sid}`).length === 2, 20_000, "both turns to wilt");
  const tartib = maqam.wahm().slice(qabl).filter((s) => s.startsWith(`prompt ${sid}`) || s === `wilt ${sid}`);
  assertEquals(tartib.map((s) => s.split(" ")[0]), ["prompt", "wilt", "prompt", "wilt"]);
});

test("imtihan: a turn that breaks off is announced in the murshid's channel and in Dispatch", async () => {
  maqam.qul("@W-1 fail the forge is cold");
  await maqam.intazir(() => maqam.qanat("W-1").includes("turn broke off") && maqam.qanat("W-1").includes("the forge is cold"), 20_000, "the broken turn in the channel");
  assertStringIncludes(maqam.dispatch(), "W-1: the murshid's turn broke off");
});

test("imtihan: dismissal forgets the murshid everywhere", async () => {
  maqam.qul('reach mun_sarrih {"huwiyya":"W-1"}');
  await maqam.intazir(() => maqam.dispatch().includes("The murshid of W-1 is dismissed"), 20_000, "the dismissal answered");
  assertEquals(maqam.sijill<unknown>("SELECT id, huwiyya, hala FROM jalasat WHERE huwiyya = 'W-1'"), []);
  assertEquals(maqam.sijill<unknown>("SELECT 1 FROM qanawat WHERE huwiyat_jalsa = 'W-1'").length, 0);
  assertStringIncludes(maqam.qanat("W-1"), "sealed; its work is over");
});
