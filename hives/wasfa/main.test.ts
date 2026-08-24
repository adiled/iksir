import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ADAWAT_WASFA, naffidhWasfa } from "./main.ts";
import { ADAWAT_MAHJUBA } from "../../src/hum/hudud.ts";
import type { MutabiWasfa, WasfaMutaba } from "../../src/types.ts";

/** A tracker that records what was asked of it and invents plausible answers. */
function mutabiMuzayyaf(): MutabiWasfa & { _nudiya: string[] } {
  const nudiya: string[] = [];
  const wasfa: WasfaMutaba = { id: "id-1", identifier: "TEAM-1", title: "Rihla" };
  return {
    _nudiya: nudiya,
    provider: "muzayyaf",
    isAuthenticated: () => { nudiya.push("isAuthenticated"); return Promise.resolve(true); },
    getIssue: (id) => { nudiya.push(`getIssue:${id}`); return Promise.resolve(wasfa); },
    getProject: (id) => { nudiya.push(`getProject:${id}`); return Promise.resolve(null); },
    searchIssues: (q, n) => { nudiya.push(`searchIssues:${q}:${n}`); return Promise.resolve([wasfa]); },
    searchProjects: (q) => { nudiya.push(`searchProjects:${q}`); return Promise.resolve([]); },
    createIssue: (i) => { nudiya.push(`createIssue:${i.title}`); return Promise.resolve(wasfa); },
    updateIssue: (id) => { nudiya.push(`updateIssue:${id}`); return Promise.resolve(wasfa); },
    setRelations: (id) => { nudiya.push(`setRelations:${id}`); return Promise.resolve(); },
    parseUrl: () => null,
    getUrlPattern: () => /[A-Z]+-\d+/,
    getStateId: (n) => { nudiya.push(`getStateId:${n}`); return Promise.resolve("state-1"); },
  };
}

Deno.test("wasfa organ: every advertised ada is worked", async () => {
  const mutabi = mutabiMuzayyaf();

  /**
   * The manifest is a promise. An advertised name humd cannot route to a
   * body would park a caller until it times out.
   */
  for (const ada of ADAWAT_WASFA) {
    const args: Record<string, unknown> = {
      huwiyya: "TEAM-1",
      istifsar: "rihla",
      ism: "In Progress",
      mudkhal: { title: "Rihla" },
      murashihat: {},
    };
    const natija = await naffidhWasfa(mutabi, ada.name, args);
    assert(typeof natija === "string", `${ada.name} returned no natija`);
  }
});

Deno.test("wasfa organ: an unknown operation is refused, not swallowed", async () => {
  const mutabi = mutabiMuzayyaf();
  let rafada = false;
  try {
    await naffidhWasfa(mutabi, "wasfa_khurafa", {});
  } catch (e) {
    rafada = true;
    assertStringIncludes(String(e), "unknown operation");
  }
  assert(rafada, "an unknown operation must throw");
});

Deno.test("wasfa organ: reads reach the tracker with their arguments", async () => {
  const mutabi = mutabiMuzayyaf();
  await naffidhWasfa(mutabi, "wasfa_iqra", { huwiyya: "TEAM-9" });
  await naffidhWasfa(mutabi, "wasfa_bahath", { istifsar: "funduq", hadd: 5 });
  assertEquals(mutabi._nudiya, ["getIssue:TEAM-9", "searchIssues:funduq:5"]);
});

Deno.test("hudud: no organ ada is left within a murshid's reach", () => {
  /**
   * The organ's manifest and the boundary must not drift apart. An ada
   * advertised but unnamed here is one a murshid could hold — the same act
   * as its mun_* instrument, stripped of the law that governs it.
   */
  for (const ada of ADAWAT_WASFA) {
    assert(
      ADAWAT_MAHJUBA.includes(ada.name),
      `${ada.name} is advertised by the organ but not barred at the entry`,
    );
  }
});
