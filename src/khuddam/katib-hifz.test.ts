import { test, assertEquals, assertNotEquals } from "../ikhtibar.ts";
import { MudirJalasat } from "./katib.ts";
import { jalabaKullJalasat } from "../../db/db.ts";
import {
  makeConfig,
  mockWasila,
  mockMessenger,
  withTestDb,
} from "../test-helpers.ts";
import type { JalsatMurshid } from "../types.ts";

function katib() {
  return new MudirJalasat({
    tasmim: makeConfig(),
    amil: mockWasila() as never,
    rasul: mockMessenger(),
  });
}

function jalsa(overrides?: Partial<JalsatMurshid>): JalsatMurshid {
  return {
    id: "iksir-LUGHA-1-aaa-1",
    huwiyya: "LUGHA-1",
    unwan: "A tongue of two sounds",
    naw: "chore",
    far: "wasfa/lugha-1",
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

test("a sent message reaches the sijill without waiting for another event", async () => {
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

test("recording one vessel does not restamp the others", async () => {
  await withTestDb(async () => {
    const k = katib();
    k.istawradaHala({
      murshidun: [
        jalsa(),
        jalsa({ id: "iksir-LUGHA-2-bbb-1", huwiyya: "LUGHA-2", far: "wasfa/lugha-2" }),
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
