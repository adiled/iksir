import { assert, assertEquals } from "@std/assert";
import { SafaAmr } from "./mod.ts";

Deno.test("safa: the matter stands when every mayar holds", async () => {
  const safa = new SafaAmr();
  const natija = await safa.assa(["true", "exit 0"]);

  assertEquals(natija.thabata, true);
  assertEquals(natija.ihtamala.length, 2);
  assertEquals(natija.ihtaraq.length, 0);
});

Deno.test("safa: one mayar failing is enough", async () => {
  const safa = new SafaAmr();
  const natija = await safa.assa(["true", "false", "true"]);

  assertEquals(natija.thabata, false);
  assertEquals(natija.ihtamala.length, 2);
  assertEquals(natija.ihtaraq.length, 1);
  assertEquals(natija.ihtaraq[0].mayar, "false");
});

Deno.test("safa: the fire reports what it saw", async () => {
  const safa = new SafaAmr();
  const natija = await safa.assa(["echo 'the vowel does not carry' >&2; exit 1"]);

  assertEquals(natija.thabata, false);
  assert(
    natija.ihtaraq[0].qawl.includes("the vowel does not carry"),
    "what burned away must be sayable",
  );
});

Deno.test("safa: a waṣfa that declares no fire cannot burn", async () => {
  const safa = new SafaAmr();
  const natija = await safa.assa([]);

  /**
   * Vacuously true here, which is why Munaffidh refuses to assay a waṣfa
   * with no maʿāyīr rather than letting it pass unburned.
   */
  assertEquals(natija.thabata, true);
  assertEquals(natija.ihtamala.length, 0);
});
