import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "jsr:@std/path";
import { masarThrum, Thrum } from "./thrum.ts";

/** A stand-in humd: binds a unix socket and records every tone it hears. */
function humdMuzayyaf(masar: string) {
  const mustami = Deno.listen({ path: masar, transport: "unix" });
  const anghaam: Record<string, unknown>[] = [];
  const maftuha: Deno.UnixConn[] = [];
  let ittisalat = 0;

  (async () => {
    for await (const conn of mustami) {
      ittisalat++;
      maftuha.push(conn);
      (async () => {
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for await (const chunk of conn.readable) {
            buf += decoder.decode(chunk, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (line.trim()) anghaam.push(JSON.parse(line));
            }
          }
        } catch {
          // Client went away.
        }
      })();
    }
  })();

  return {
    anghaam,
    ittisalat: () => ittisalat,
    // Closing the listener alone leaves accepted connections alive, and the
    // bee would never notice humd had gone. A real death closes both.
    aghlaq: () => {
      for (const conn of maftuha.splice(0)) {
        try {
          conn.close();
        } catch {
          // Already closed.
        }
      }
      mustami.close();
    },
  };
}

async function hatta(shart: () => boolean, muhla = 2000): Promise<void> {
  const hadd = Date.now() + muhla;
  while (Date.now() < hadd) {
    if (shart()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("condition never held");
}

function dalilMuaqqat(): string {
  return Deno.makeTempDirSync({ prefix: "iksir-thrum-" });
}

Deno.test("thrum: hello is a forager-only manifest carrying the adawat", async () => {
  const masar = join(dalilMuaqqat(), "thrum.sock");
  const humd = humdMuzayyaf(masar);

  const thrum = new Thrum({
    masarMiqbas: masar,
    adawat: [{ name: "mun_istihal", description: "transmute", inputSchema: {} }],
  });
  await thrum.ittasil();
  await hatta(() => humd.anghaam.length >= 1);

  const hello = humd.anghaam[0];
  assertEquals(hello.chi, "hello");
  assertEquals(hello.hive, "iksir");

  // Law II — declaring "worker" would make humd re-broadcast Iksir's own
  // output onto the sigil Iksir itself claimed.
  assertEquals(hello.bee, ["forager"]);

  const adawat = hello.tools as Array<{ name: string }>;
  assertEquals(adawat.length, 1);
  assertEquals(adawat[0].name, "mun_istihal");

  // humd dedupes across reconnects by hid alone; a stub would leak manifests.
  assertStringIncludes(String(hello.hid), "fbee_");
  assertEquals(String(hello.hid).length, "fbee_".length + 64);

  thrum.aghlaq();
  humd.aghlaq();
});

Deno.test("thrum: every reconnection re-announces, because manifests are volatile", async () => {
  const dalil = dalilMuaqqat();
  const masar = join(dalil, "thrum.sock");
  let humd = humdMuzayyaf(masar);

  const thrum = new Thrum({ masarMiqbas: masar });
  await thrum.ittasil();
  await hatta(() => humd.anghaam.length >= 1);

  // humd dies and returns — its manifest registry cleared with it.
  humd.aghlaq();
  await Deno.remove(masar).catch(() => {});
  await hatta(() => !thrum.mawsul);

  humd = humdMuzayyaf(masar);
  await hatta(() => humd.anghaam.length >= 1, 5000);

  assertEquals(humd.anghaam[0].chi, "hello");

  thrum.aghlaq();
  humd.aghlaq();
});

Deno.test("thrum: queued tones survive a parted strand", async () => {
  const dalil = dalilMuaqqat();
  const masar = join(dalil, "thrum.sock");

  // Nothing is listening yet, so the first send has nowhere to go.
  const thrum = new Thrum({ masarMiqbas: masar });
  thrum.ursil({ chi: "prompt", sid: "s-1", content: "awaited" });

  const humd = humdMuzayyaf(masar);
  await thrum.ittasil();
  await hatta(() => humd.anghaam.length >= 2);

  assertEquals(humd.anghaam[0].chi, "hello");
  assertEquals(humd.anghaam[1].chi, "prompt");
  assertEquals(humd.anghaam[1].content, "awaited");
  // A rid is stamped on any tone that arrives without one.
  assert(typeof humd.anghaam[1].rid === "string");

  thrum.aghlaq();
  humd.aghlaq();
});

Deno.test("thrum: socket discovery honours the explicit path over all else", () => {
  assertEquals(masarThrum("/tmp/explicit.sock"), "/tmp/explicit.sock");
});

Deno.test("thrum: socket discovery falls back to the hum state dir", () => {
  const qadim = Deno.env.get("XDG_STATE_HOME");
  const sock = Deno.env.get("HUM_THRUM_SOCK");
  const legacy = Deno.env.get("HUM_SOCKET");
  Deno.env.delete("HUM_THRUM_SOCK");
  Deno.env.delete("HUM_SOCKET");
  Deno.env.set("XDG_STATE_HOME", "/nonexistent-state");

  try {
    // No runtime.json under that root, so the default basename wins.
    assertEquals(masarThrum(), "/nonexistent-state/hum/thrum.sock");
  } finally {
    if (qadim === undefined) Deno.env.delete("XDG_STATE_HOME");
    else Deno.env.set("XDG_STATE_HOME", qadim);
    if (sock !== undefined) Deno.env.set("HUM_THRUM_SOCK", sock);
    if (legacy !== undefined) Deno.env.set("HUM_SOCKET", legacy);
  }
});
