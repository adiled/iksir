/**
 * Iksīr Plugin for OpenCode
 *
 * The single integration point between Iksīr and OpenCode.
 *
 * Hooks:
 * - experimental.session.compacting — Preserves murshid identity, diary
 *   decisions, and architectural context across compaction cycles
 * - event — Forwards session events to the Iksīr daemon via the ahdath
 *   (events) table in SQLite
 *
 * Runs inside OpenCode's Bun process. Reads Iksīr's SQLite DB directly
 * via bun:sqlite.
 */

import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

// ─── DB path resolution ─────────────────────────────────────────────────────

function resolvDbPath(): string {
  const explicit = process.env.IKSIR_STATE_DIR
  if (explicit) return `${explicit}/iksir.sqlite`
  const xdg = process.env.XDG_DATA_HOME ?? `${process.env.HOME ?? "/root"}/.local/share`
  return `${xdg}/iksir/iksir.sqlite`
}

function openDb(): Database | null {
  try {
    return new Database(resolvDbPath(), { readonly: true })
  } catch {
    return null
  }
}

function openDbRw(): Database | null {
  try {
    return new Database(resolvDbPath())
  } catch {
    return null
  }
}

// ─── DB queries ─────────────────────────────────────────────────────────────

interface SaffJalsa {
  huwiyya: string
  unwan: string | null
  far: string | null
  hala: string | null
}

interface SaffQarar {
  naw: string
  qarar: string
  mantiq: string
  unshia_fi: string
}

function hallaJalsa(db: Database, sessionId: string): SaffJalsa | null {
  try {
    return db
      .prepare(
        `SELECT huwiyya, unwan, far, hala
         FROM jalasat
         WHERE id = ?
         LIMIT 1`,
      )
      .get(sessionId) as SaffJalsa | null
  } catch {
    return null
  }
}

function qaraaQararat(db: Database, huwiyyatMurshid: string): SaffQarar[] {
  try {
    return db
      .prepare(
        `SELECT naw, qarar, mantiq, unshia_fi
         FROM qararat
         WHERE huwiyat_murshid = ?
         ORDER BY unshia_fi DESC
         LIMIT 30`,
      )
      .all(huwiyyatMurshid) as SaffQarar[]
  } catch {
    return []
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function rattabaQararat(entries: SaffQarar[]): string {
  return entries
    .map(
      (e) =>
        `[${e.naw.toUpperCase()}] ${e.unshia_fi}\n  Qarar: ${e.qarar}\n  Sabab: ${e.mantiq}`,
    )
    .join("\n\n")
}

function qawaidTahattub(huwiyyatMurshid: string): string {
  return `### Qawā'id al-Hifẓ

When constructing the compaction summary, you MUST:

1. Include the murshid ID (**${huwiyyatMurshid}**)
2. Include which waṣfāt are done, in-progress, or masdūda
3. Include istihal state — which ahjār have been transmuted into jawāhir vs still in the būṭaqa
4. Include the current būṭaqa branch and its relationship to the kitāb
5. Include all blocking qarārāt and their sabab
6. Include the instruction: "Use mun_radd to respond to Iksīr"
7. Include the instruction: "Call mun_qaraa_mudawwana after compaction to reload full qarar history"
8. Preserve any constraints or architectural qarārāt from the entries above`
}

const STATIC_RULES = `## Iksīr Murshid — Compaction Rules

This is an Iksīr murshid session. When summarizing, ALWAYS preserve:

1. The murshid ID
2. Which waṣfāt are done, in-progress, or masdūda
3. Istihāl state — ahjār transmuted into jawāhir vs still in būṭaqa
4. Būṭaqa branch and kitāb relationship
5. Key architectural qarārāt and WHY they were made (sabab)
6. The instruction: "Use mun_radd to respond — text output is invisible to Iksīr"
7. The instruction: "Call mun_qaraa_mudawwana to reload qarar history after compaction"`

// ─── Event forwarding ───────────────────────────────────────────────────────

function writeHadath(naw: string, ada: string, humulat: Record<string, unknown>): void {
  const db = openDbRw()
  if (!db) return
  try {
    const id = crypto.randomUUID()
    db.prepare(
      `INSERT INTO ahdath (id, naw, ada, humulat, unshia_fi)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, naw, ada, JSON.stringify(humulat), new Date().toISOString())
  } catch {
    // DB may not have the table yet if daemon hasn't initialized
  } finally {
    db.close()
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const iksirPlugin: Plugin = async (_ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      const db = openDb()
      if (!db) {
        output.context.push(STATIC_RULES)
        return
      }

      try {
        const jalsa = hallaJalsa(db, input.sessionID)
        if (!jalsa) {
          db.close()
          output.context.push(STATIC_RULES)
          return
        }

        const huwiyyatMurshid = jalsa.huwiyya
        const entries = qaraaQararat(db, huwiyyatMurshid)
        db.close()

        const parts: string[] = []

        parts.push(`## Iksīr Murshid Context

This is an Iksīr murshid session managing a kitāb.

- **Murshid ID**: ${huwiyyatMurshid}${jalsa.unwan ? `\n- **Kitāb Title**: ${jalsa.unwan}` : ""}${jalsa.far ? `\n- **Branch**: ${jalsa.far}` : ""}${jalsa.hala ? `\n- **Hāla**: ${jalsa.hala}` : ""}`)

        if (entries.length > 0) {
          parts.push(`### Mudawwana Qarārāt

These qarārāt represent key architectural, strategic, and risāla choices made during
this kitāb. They CANNOT be reconstructed from runūz alone. The compaction summary
MUST include these or they will be permanently lost:

${rattabaQararat(entries)}`)
        }

        parts.push(qawaidTahattub(huwiyyatMurshid))

        output.context.push(parts.join("\n\n"))
      } catch {
        db?.close()
        output.context.push(STATIC_RULES)
      }
    },

    event: async ({ event }) => {
      const etype = (event as any).type
      const props = (event as any).properties ?? {}

      if (etype === "session.compacted") {
        const sid = props.sessionID
        if (sid) {
          writeHadath("opencode", "session.compacted", { sessionId: sid })
        }
      }
    },
  }
}

// ─── V1 module export ───────────────────────────────────────────────────────

export default {
  id: "iksir",
  server: iksirPlugin,
} satisfies PluginModule
