import { assert, assertEquals } from "@std/assert";
import { fusul, HayulaNass } from "./mod.ts";

async function biWarsha(fn: (h: HayulaNass, warsha: string) => Promise<void>): Promise<void> {
  const warsha = await Deno.makeTempDir({ prefix: "iksir-nass-" });
  const codex = `${warsha}/codex.md`;
  await Deno.writeTextFile(
    codex,
    "# Sounds\n\ntwo, undecided\n\n# Fruits\n\nten, unnamed\n\n# Space\n\nrelations unstated\n",
  );
  try {
    await fn(new HayulaNass(codex), warsha);
  } finally {
    await Deno.remove(warsha, { recursive: true }).catch(() => {});
  }
}

Deno.test("nass: matter is a fasl, not a line", () => {
  const f = fusul("# One\n\nalpha\n\n## Under\n\nbeta\n\n# Two\n\ngamma\n");
  assertEquals([...f.keys()], ["One", "Under", "Two"]);
  assert(f.get("One")!.includes("alpha"));
  assert(!f.get("One")!.includes("beta"), "a fasl ends where the next begins");
});

Deno.test("nass: a vessel is raised from the codex and stands apart", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("sada");
    assertEquals(await h.waqif(), "sada");
    assertEquals(await h.mudtarib(), false);

    await Deno.writeTextFile(
      `${h.masarCodex.replace("codex.md", ".awani/sada.md")}`,
      "# Sounds\n\n[a] and [m]\n\n# Fruits\n\nten, unnamed\n\n# Space\n\nrelations unstated\n",
    );

    assertEquals(await h.mudtarib(), true, "the vessel now differs from its last freezing");

    /** The codex is untouched by anything done in a vessel. */
    const codex = await Deno.readTextFile(h.masarCodex);
    assert(codex.includes("two, undecided"));
  });
});

Deno.test("nass: freezing settles the vessel", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("sada");
    const masar = h.masarCodex.replace("codex.md", ".awani/sada.md");
    await Deno.writeTextFile(masar, "# Sounds\n\n[a] and [m]\n");

    assertEquals(await h.mudtarib(), true);
    assertEquals(await h.jammada("mid-thought"), true);
    assertEquals(await h.mudtarib(), false);
  });
});

Deno.test("nass: istihala carries only what is named", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("buwtaqa");
    const masar = h.masarCodex.replace("codex.md", ".awani/buwtaqa.md");
    await Deno.writeTextFile(
      masar,
      "# Sounds\n\n[a] and [m]\n\n# Fruits\n\nhalf-named, still messy\n\n# Space\n\nrelations unstated\n",
    );

    const natija = await h.istahala("jawhar", ["Sounds"]);
    assertEquals(natija.najah, true);
    assertEquals(natija.adadAhjar, 1);

    const jawhar = await Deno.readTextFile(h.masarCodex.replace("codex.md", ".awani/jawhar.md"));
    assert(jawhar.includes("[a] and [m]"), "the named fasl travelled");
    assert(jawhar.includes("ten, unnamed"), "the rest stands as the codex has it");
    assert(!jawhar.includes("half-named"), "unnamed matter stayed in the crucible");
  });
});

Deno.test("nass: istihala refuses matter that is not there", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("buwtaqa");
    const natija = await h.istahala("jawhar", ["Prosody"]);
    assertEquals(natija.najah, false);
    assertEquals(natija.nawKhata, "istirjaa");
  });
});

Deno.test("nass: the codex is drawn in where the vessel did not reach", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("sada");
    const masar = h.masarCodex.replace("codex.md", ".awani/sada.md");
    await Deno.writeTextFile(
      masar,
      "# Sounds\n\n[a] and [m]\n\n# Fruits\n\nten, unnamed\n\n# Space\n\nrelations unstated\n",
    );
    await h.jammada("held");

    /** al-Kimyawī writes into the codex, elsewhere. */
    await Deno.writeTextFile(
      h.masarCodex,
      "# Sounds\n\ntwo, undecided\n\n# Fruits\n\nten, and they orbit\n\n# Space\n\nrelations unstated\n",
    );

    assertEquals(await h.masafa("sada"), 1);
    const natija = await h.sahaba("sada");
    assertEquals(natija.najah, true);

    const baad = await Deno.readTextFile(masar);
    assert(baad.includes("[a] and [m]"), "the vessel keeps what it decided");
    assert(baad.includes("they orbit"), "and takes what the codex now says");
  });
});

Deno.test("nass: a fasl both have altered is left to al-Kimyawi", async () => {
  await biWarsha(async (h) => {
    await h.dakhala("sada");
    const masar = h.masarCodex.replace("codex.md", ".awani/sada.md");
    await Deno.writeTextFile(masar, "# Sounds\n\n[a] and [m]\n\n# Fruits\n\nten, glowing\n");
    await h.jammada("held");

    await Deno.writeTextFile(h.masarCodex, "# Sounds\n\ntwo, undecided\n\n# Fruits\n\nten, singing\n");

    const natija = await h.sahaba("sada");
    assertEquals(natija.najah, false);
    assertEquals(natija.taarudat, ["Fruits"]);
  });
});
