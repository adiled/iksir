import { assertEquals, assertStringIncludes } from "@std/assert";
import { Munaffidh } from "./munaffidh.ts";
import { MudirJalasat } from "./katib.ts";
import { jalabaKullJalasat } from "../../db/db.ts";
import {
  makeConfig,
  mockAmilHum,
  mockMessenger,
  withTestDb,
} from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

/**
 * A Munadi that holds the flame wherever the test puts it, and records any
 * switchover it is asked for.
 */
function munadiStub(faila: string | null) {
  const tahwilat: string[] = [];
  return {
    _tahwilat: tahwilat,
    hawiyyaFaila: () => faila,
    wadaaJalsaFaila: (id: string | null) => {
      faila = id;
    },
    aalajIstijabaZirr: (_masdar: string, amr: string) => {
      tahwilat.push(amr);
      return Promise.resolve({ tuulija: true });
    },
  };
}

async function mashhad(faila: string | null) {
  const katib = new MudirJalasat({
    tasmim: makeConfig(),
    amil: mockAmilHum() as never,
    rasul: mockMessenger(),
  });

  const jalsa: JalsatMurshid = {
    id: "iksir-LUGHA-2-bbb-1",
    huwiyya: "LUGHA-2",
    unwan: "Contemplation",
    naw: "chore",
    far: "dev/LUGHA-2",
    hala: "fail",
    unshiaFi: "2026-08-24T21:07:58.250Z",
    akhirRisalaFi: "2026-08-24T21:07:58.250Z",
    channels: {},
  };
  katib.istawradaHala({ murshidun: [jalsa] });
  await katib.hafizaHala();

  const munaffidh = new Munaffidh({
    tasmim: makeConfig(),
    wasfat: undefined as never,
    fasl: undefined as never,
    rasul: mockMessenger(),
    ntfy: undefined as never,
    mudirJalasat: katib,
    amil: mockAmilHum() as never,
    hayula: undefined as never,
    safa: undefined as never,
  });

  const munadi = munadiStub(faila);
  munaffidh.wadaaMunadi(munadi as never);

  return { munaffidh, munadi, katib };
}

const nida = (sabab: string, tafasil: string) => ({
  tool: "mun_tanazal" as const,
  huwiyyatMurshid: "LUGHA-2",
  sabab,
  tafasil,
});

const halaSijill = (huwiyya: string) =>
  jalabaKullJalasat().find((s) => s.huwiyya === huwiyya)?.hala;

/**
 * A murshid that kept working after the flame moved on still finishes. How its
 * work ended is its own to say, and the sijill must hear it — otherwise the
 * record keeps whatever the last accepted yield said, and is wrong with no
 * event to contradict it.
 */
Deno.test("a murshid without the flame still records how its work ended", async () => {
  await withTestDb(async () => {
    const { munaffidh } = await mashhad(null);

    const radd = await munaffidh.aalajTanazul(nida("masdud", "the remote is not configured") as never);

    assertEquals(halaSijill("LUGHA-2"), "masdud");
    assertStringIncludes(radd, "Recorded");
  });
});

/**
 * Recording is not passing the flame on. Only the murshid holding it may say
 * where it goes next.
 */
Deno.test("a murshid without the flame does not move control", async () => {
  await withTestDb(async () => {
    const { munaffidh, munadi } = await mashhad("LUGHA-1");

    await munaffidh.aalajTanazul(nida("mafrugh", "done") as never);

    assertEquals(munadi._tahwilat, [], "a murshid without the flame moved control");
    assertEquals(munadi.hawiyyaFaila(), "LUGHA-1", "the flame left its holder");
  });
});

/**
 * The murshid holding the flame yields as it always did.
 */
Deno.test("the murshid holding the flame still yields it", async () => {
  await withTestDb(async () => {
    const { munaffidh, munadi } = await mashhad("LUGHA-2");

    await munaffidh.aalajTanazul(nida("mafrugh", "done") as never);

    assertEquals(halaSijill("LUGHA-2"), "muntazir");
    assertEquals(munadi.hawiyyaFaila(), null, "the flame was not set down");
  });
});

/**
 * A yield from something holding no vessel is refused, and writes nothing.
 */
Deno.test("a yield from no vessel is refused", async () => {
  await withTestDb(async () => {
    const { munaffidh } = await mashhad(null);

    const radd = await munaffidh.aalajTanazul({
      ...nida("mafrugh", "done"),
      huwiyyatMurshid: "GHAYB-9",
    } as never);

    assertStringIncludes(radd, "hold no vessel");
    assertEquals(halaSijill("GHAYB-9"), undefined);
  });
});
