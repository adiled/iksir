import { test, assertEquals, assertThrows } from "../ikhtibar.ts";
import { ikhtar, thulathiMin, kalimatKhabath, KhabathGharib } from "./khabath.ts";

const roster = { majlis: ["telegram"], kur: ["github", "gitlab"], sijillat: ["github", "linear"] };

test("khabath: what a wasfa does not name, it takes from the roster whole", () => {
  assertEquals(ikhtar(roster, undefined), roster);
  assertEquals(ikhtar(roster, { sijillat: ["linear"] }), { ...roster, sijillat: ["linear"] });
});

test("khabath: a wasfa may narrow, never widen", () => {
  assertEquals(ikhtar(roster, { kur: ["gitlab"] }).kur, ["gitlab"]);
  const khata = assertThrows(() => ikhtar(roster, { kur: ["linear-server"] }), KhabathGharib);
  assertEquals(khata.message, '"linear-server" is not a kur in your config — the roster holds github, gitlab');
});

test("khabath: an alteration keeps what the wasfa already chose", () => {
  const qaim = { majlis: ["telegram"], kur: ["gitlab"], sijillat: ["linear"] };
  assertEquals(ikhtar(roster, { sijillat: ["github", "linear"] }, qaim), { majlis: ["telegram"], kur: ["gitlab"], sijillat: ["github", "linear"] });
});

test("khabath: an empty roster refuses every name", () => {
  const faragh = { majlis: [], kur: [], sijillat: [] };
  assertEquals(ikhtar(faragh, undefined), faragh);
  const khata = assertThrows(() => ikhtar(faragh, { kur: ["github"] }), KhabathGharib);
  assertEquals(khata.message.endsWith("the roster is empty"), true);
});

test("khabath: the words a ruqya is rendered with come from the wasfa, else the roster", () => {
  assertEquals(kalimatKhabath(thulathiMin({ kur: ["gitlab"] }, roster)), { majlis: "telegram", kur: "gitlab", sijillat: "github, linear" });
  assertEquals(kalimatKhabath(thulathiMin({}, roster)).kur, "github, gitlab");
});
