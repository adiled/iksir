import { test, assertEquals, assertExists } from "../ikhtibar.ts";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { Wasila } from "./wasila.ts";
import { MunadiMunMcpServer } from "../mcp/iksir-mcp.ts";

interface Qabd {
  hello: Record<string, unknown>;
  nataij: Array<Record<string, unknown>>;
}

async function qimNash(mu: (khat: (t: Record<string, unknown>) => void) => void): Promise<{ masar: string; qabd: Qabd; ighlaq: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "thrum-nash-"));
  const masar = join(dir, "thrum.sock");
  const qabd: Qabd = { hello: {}, nataij: [] };
  let khat: ((t: Record<string, unknown>) => void) | null = null;
  const khadm = createServer((wasl) => {
    let buf = "";
    wasl.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const t = JSON.parse(line) as Record<string, unknown>;
        if (t.chi === "hello") qabd.hello = t;
        else if (t.chi === "tool-result") qabd.nataij.push(t);
      }
    });
    khat = (t: Record<string, unknown>) => wasl.write(JSON.stringify(t) + "\n");
    mu(khat);
  });
  await new Promise<void>((hal) => khadm.listen(masar, () => hal()));
  return { masar, qabd, ighlaq: () => khadm.close() };
}

async function intazirNataij(qabd: Qabd, n: number): Promise<void> {
  const azal = Date.now() + 5000;
  while (qabd.nataij.length < n && Date.now() < azal) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assertEquals(qabd.nataij.length, n);
}

test("forager: hello advertises mun_* tools as forager", async () => {
  const { masar, qabd, ighlaq } = await qimNash((khat) =>
    khat({ chi: "breath", protoVersion: "0.7.0", sessions: [] }),
  );
  const pm = new MunadiMunMcpServer();
  const wasila = new Wasila({ socket: masar, sijill: pm.sijill });
  await wasila.ishgal();
  const adawat = qabd.hello.tools as Array<{ name: string; inputSchema: unknown }>;
  assertExists(adawat);
  assertEquals(adawat.length >= 20, true);
  assertEquals(adawat.some((t) => t.name === "mun_naqsh"), true);
  assertEquals((qabd.hello.bee as string[]).includes("forager"), true);
  wasila.qaf();
  ighlaq();
});

test("forager: unknown tool answers isError tool-result", async () => {
  const { masar, qabd, ighlaq } = await qimNash((khat) => {
    khat({ chi: "breath", protoVersion: "0.7.0", sessions: [] });
    setTimeout(() => khat({ chi: "tool-call", rid: "r1", sid: "s1", callId: "c1", toolName: "mun_ghayr_mawjod", args: {} }), 100);
  });
  const pm = new MunadiMunMcpServer();
  const wasila = new Wasila({ socket: masar, sijill: pm.sijill });
  await wasila.ishgal();
  await intazirNataij(qabd, 1);
  assertEquals(qabd.nataij[0].callId, "c1");
  assertEquals(qabd.nataij[0].isError, true);
  wasila.qaf();
  ighlaq();
});

test("forager: missing required args answers isError", async () => {
  const { masar, qabd, ighlaq } = await qimNash((khat) => {
    khat({ chi: "breath", protoVersion: "0.7.0", sessions: [] });
    setTimeout(() => khat({ chi: "tool-call", rid: "r1", sid: "s1", callId: "c2", toolName: "mun_istifsar", args: {} }), 100);
  });
  const pm = new MunadiMunMcpServer();
  const wasila = new Wasila({ socket: masar, sijill: pm.sijill });
  await wasila.ishgal();
  await intazirNataij(qabd, 1);
  assertEquals(qabd.nataij[0].callId, "c2");
  assertEquals(qabd.nataij[0].isError, true);
  wasila.qaf();
  ighlaq();
});

test("forager: valid call dispatches body and answers output", async () => {
  const { masar, qabd, ighlaq } = await qimNash((khat) => {
    khat({ chi: "breath", protoVersion: "0.7.0", sessions: [] });
    setTimeout(() => khat({ chi: "tool-call", rid: "r1", sid: "s1", callId: "c3", toolName: "mun_istifsar", args: { query: "where is the furnace" } }), 100);
  });
  const pm = new MunadiMunMcpServer();
  const wasila = new Wasila({ socket: masar, sijill: pm.sijill });
  await wasila.ishgal();
  await intazirNataij(qabd, 1);
  assertEquals(qabd.nataij[0].callId, "c3");
  assertEquals(qabd.nataij[0].isError, undefined);
  assertExists(qabd.nataij[0].output);
  wasila.qaf();
  ighlaq();
});
