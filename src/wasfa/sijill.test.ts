import { assert, assertEquals } from "@std/assert";
import { withTestRepo } from "../test-helpers.ts";
import { anshaaSijillWasfat } from "./sijill.ts";

Deno.test("wasfat: a formula is inscribed and read back", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat();
    const wasfa = await sijill.khalaq({
      unwan: "A world of ten fruits, in space",
      matn: "Two sounds. Make which-and-where sayable.",
    });

    assertEquals(wasfa.huwiyya, "W-1");
    assertEquals(wasfa.hala, "khaam");

    const baad = await sijill.iqra("W-1");
    assertEquals(baad?.unwan, "A world of ten fruits, in space");
    assert(baad?.matn?.includes("Two sounds"));
  });
});

Deno.test("wasfat: a workshop names its own formulae", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat("LUGHA");
    const awwal = await sijill.khalaq({ unwan: "first" });
    const thani = await sijill.khalaq({ unwan: "second" });
    assertEquals(awwal.huwiyya, "LUGHA-1");
    assertEquals(thani.huwiyya, "LUGHA-2");
  });
});

Deno.test("wasfat: a condition is words", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat();
    await sijill.khalaq({ unwan: "sounds", hala: "under the flame" });
    await sijill.khalaq({ unwan: "space", hala: "khaam" });

    const taht = await sijill.bihala("under the flame");
    assertEquals(taht.length, 1);
    assertEquals(taht[0].unwan, "sounds");
  });
});

Deno.test("wasfat: search reaches name and statement alike", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat();
    await sijill.khalaq({ unwan: "phonotactics", matn: "what may follow what" });
    await sijill.khalaq({ unwan: "orbit", matn: "the fruits move" });

    assertEquals((await sijill.bahath("fruits")).length, 1);
    assertEquals((await sijill.bahath("phono")).length, 1);
    assertEquals((await sijill.bahath("nothing here")).length, 0);
  });
});

Deno.test("wasfat: altering keeps what was not named", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat();
    await sijill.khalaq({ unwan: "sounds", matn: "two of them", qadr: 3 });

    const baad = await sijill.jaddid("W-1", { hala: "settled" });
    assertEquals(baad.hala, "settled");
    assertEquals(baad.matn, "two of them", "the statement stands");
    assertEquals(baad.qadr, 3, "the measure stands");
  });
});

Deno.test("wasfat: a binding is seen from both ends", async () => {
  await withTestRepo(async () => {
    const sijill = anshaaSijillWasfat();
    await sijill.khalaq({ unwan: "sounds" });
    await sijill.khalaq({ unwan: "words" });

    /** The sounds must be settled before anything is built on them. */
    await sijill.rabt("W-1", ["W-2"]);

    assertEquals((await sijill.alaqat("W-1")).yamnaa, ["W-2"]);
    assertEquals((await sijill.alaqat("W-2")).mamnu, ["W-1"]);
  });
});
