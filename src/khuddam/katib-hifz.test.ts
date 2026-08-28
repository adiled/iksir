import { assertEquals, assertNotEquals } from "@std/assert";
import { MudirJalasat } from "./katib.ts";
import { jalabaKullJalasat } from "../../db/db.ts";
import {
  makeConfig,
  mockAmilHum,
  mockMessenger,
  withTestDb,
} from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

function katib() {
  return new MudirJalasat({
    tasmim: makeConfig(),
    amil: mockAmilHum() as never,
    rasul: mockMessenger(),
  });
}

function jalsa(overrides?: Partial<JalsatMurshid>): JalsatMurshid {
  return {
    id: "iksir-LUGHA-1-aaa-1",
    huwiyya: "LUGHA-1",
    unwan: "A tongue of two sounds",
    naw: "chore",
    far: "dev/LUGHA-1",
    hala: "fail",
    unshiaFi: "2026-08-24T20:50:16.385Z",
    akhirRisalaFi: "2026-08-24T20:50:16.385Z",
    channels: {},
    ...overrides,
  };
}

function minSijill(huwiyya: string) {
  return jalabaKullJalasat().find((s) => s.huwiyya === huwiyya);
}

/**
 * A message the murshid was sent is a thing that happened. If it lives only in
 * memory until some unrelated event saves, a daemon killed between those events
 * wakes believing it last spoke hours before it did.
 */
Deno.test("a sent message reaches the sijill without waiting for another event", async () => {
  await withTestDb(async () => {
    const k = katib();
    k.istawradaHala({ murshidun: [jalsa()] });
    await k.hafizaHala();

    const qabl = minSijill("LUGHA-1")?.akhir_risala_fi;

    await new Promise((r) => setTimeout(r, 5));
    await k.arsalaIlaMurshidById("LUGHA-1", "press further");

    const baad = minSijill("LUGHA-1")?.akhir_risala_fi;
    assertNotEquals(baad, qabl, "akhir_risala_fi did not reach the sijill");
    assertEquals(baad, k.jalabMurshid("LUGHA-1")?.akhirRisalaFi);
  });
});

/**
 * jaddad_fi is stamped on every write. Saving every vessel to record a change
 * in one gives the others a timestamp they did not earn, and the sijill can no
 * longer say which one moved.
 */
Deno.test("recording one vessel does not restamp the others", async () => {
  await withTestDb(async () => {
    const k = katib();
    k.istawradaHala({
      murshidun: [
        jalsa(),
        jalsa({ id: "iksir-LUGHA-2-bbb-1", huwiyya: "LUGHA-2", far: "dev/LUGHA-2" }),
      ],
    });
    await k.hafizaHala();

    const thabit = minSijill("LUGHA-2")?.jaddad_fi;

    await new Promise((r) => setTimeout(r, 5));
    await k.jaddadaḤalatMurshid("LUGHA-1", "muntazir", "awaiting review");

    assertNotEquals(
      minSijill("LUGHA-1")?.jaddad_fi,
      thabit,
      "the vessel that moved was not restamped",
    );
    assertEquals(
      minSijill("LUGHA-2")?.jaddad_fi,
      thabit,
      "a vessel that did not move was restamped",
    );
  });
});
