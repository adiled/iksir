import { test, assertEquals } from "./ikhtibar.ts";
import { iqraNuhul } from "./fahs.ts";

const QAIMA = `● bee_0486468a9443a6530d596ee7504de9e08d34cbacd80d0286e46027db0a78db56  —  hive iksir as sayrafi, forager, nestled
    version:  1.3.0
    advised:  reconnect-storm  (hum doctor says what)

○ bee_0b2a494320f97c22e563e3f23b3cdaa92be394a646287de48cf0164833e0adbf  —  hive iksir as arraf, forager, entered, not nestled

● bee_495e6e4ee852b5bfcacf813b4c9c63ed591552efd69368f31a79cfee2259b7ac  —  hive dwarfstar as ds4flash, nurse, nestled
    models:   deepseek-v4-flash, deepseek-v4
    version:  0.33.1
`;

test("fahs: reads hum bee --list — who is nestled, who is stale, what the nurses advertise", () => {
  const nuhul = iqraNuhul(QAIMA);
  assertEquals(nuhul.length, 3);
  assertEquals(nuhul[0], { id: "bee_0486468a9443a6530d596ee7504de9e08d34cbacd80d0286e46027db0a78db56", hive: "iksir", as: "sayrafi", role: "forager", nestled: true, models: [] });
  assertEquals(nuhul[1].as, "arraf");
  assertEquals(nuhul[1].nestled, false);
  assertEquals(nuhul[2].role, "nurse");
  assertEquals(nuhul[2].models, ["deepseek-v4-flash", "deepseek-v4"]);
});

test("fahs: an empty or foreign listing is no bees", () => {
  assertEquals(iqraNuhul(""), []);
  assertEquals(iqraNuhul("hum: humd not running\n"), []);
});
