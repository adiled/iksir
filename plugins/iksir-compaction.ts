/**
 * Iksīr Compaction Plugin for OpenCode
 *
 * Hooks into OpenCode's session compaction to inject Iksīr-specific context:
 * - Mudawwana qarārāt
 * - Murshid hawiyya
 * - Qawā'id al-hifẓ
 *
 * Without this plugin, compaction uses a generic summarizer that gradually
 * loses Iksīr-critical context over 5-6 compaction cycles. With it, diary
 * entries and murshid identity are baked into every compaction summary.
 *
 * Runs inside OpenCode's Bun process. Reads Iksīr's SQLite DB directly
 * via bun:sqlite.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

interface DiaryRow {
  type: string
  decision: string
  reasoning: string
  created_at: string
}

interface SessionRow {
  identifier: string
  title: string | null
  branch: string | null
  status: string | null
}

const IKSIR_DB_PATH =
  process.env.IKSIR_DB_PATH ??
  `${process.env.HOME ?? "/root"}/.config/iksir/state/iksir.sqlite`

/**
 * Resolve murshid identifier from an OpenCode session ID.
 *
 * Iksīr's sessions table uses the OpenCode session ID as its primary key (`id`).
 * Returns session metadata including the murshid identifier.
 */
function hallaHuwiyyatMurshid(
  db: Database,
  sessionId: string,
): SessionRow | null {
  try {
    const row = db
      .prepare(
        `SELECT identifier, title, branch, status
         FROM sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(sessionId) as SessionRow | null
    if (row) return row
  } catch {
  }
  return null
}

/**
 * Fetch diary decisions for a murshid, most recent first.
 */
function qaraaQararat(db: Database, huwiyyatMurshid: string): DiaryRow[] {
  try {
    return db
      .prepare(
        `SELECT type, decision, reasoning, created_at
         FROM diary_decisions
         WHERE huwiyyat_murshid = ?
         ORDER BY created_at DESC
         LIMIT 30`,
      )
      .all(huwiyyatMurshid) as DiaryRow[]
  } catch {
    return []
  }
}

/**
 * Format diary entries into a readable block for the compaction prompt.
 */
function rattabaMudawwana(entries: DiaryRow[]): string {
  return entries
    .map(
      (e) =>
        `[${e.type.toUpperCase()}] ${e.created_at}\n  Qarar: ${e.decision}\n  Sabab: ${e.reasoning}`,
    )
    .join("\n\n")
}

export const iksirCompaction: Plugin = async (_ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      let db: Database | null = null
      try {
        db = new Database(IKSIR_DB_PATH, { readonly: true })
      } catch {
        output.context.push(STATIC_RULES)
        return
      }

      try {
        /** Resolve which murshid owns this session */
        const session = hallaHuwiyyatMurshid(db, input.sessionID)
        if (!session) {
          db.close()
          return
        }

        const murshidId = session.identifier
        const entries = qaraaQararat(db, murshidId)
        db.close()

        /** Build the context injection */
        const parts: string[] = []

        parts.push(`## Iksīr Murshid Context

This is an Iksīr murshid session managing a kitāb.

- **Murshid ID**: ${murshidId}${session.title ? `\n- **Kitāb Title**: ${session.title}` : ""}${session.branch ? `\n- **Branch**: ${session.branch}` : ""}${session.status ? `\n- **Hāla**: ${session.status}` : ""}`)

        if (entries.length > 0) {
          parts.push(`### Mudawwana Qarārāt

These qarārāt represent key architectural, strategic, and risāla choices made during
this kitāb. They CANNOT be reconstructed from runūz alone. The compaction summary
MUST include these or they will be permanently lost:

${rattabaMudawwana(entries)}`)
        }

        parts.push(qawaidHifz(murshidId))

        output.context.push(parts.join("\n\n"))
      } catch {
        db?.close()
        output.context.push(STATIC_RULES)
      }
    },
  }
}

function qawaidHifz(murshidId: string): string {
  return `### Qawā'id al-Hifẓ

When constructing the compaction summary, you MUST:

1. Include the murshid ID (**${murshidId}**)
2. Include which waṣfāt are done, in-progress, or masdūda
3. Include istihal state - which ahjar have been transmuted into jawahir vs still in the buwtaqa
4. Include the current buwtaqa branch and its relationship to the kitāb
5. Include all blocking qarārāt and their sabab
6. Include the instruction: "Use mun_radd to respond to Iksīr"
7. Include the instruction: "Call mun_qaraa_mudawwana after compaction to reload full qarar history"
8. Preserve any constraints or architectural qarārāt from the mudawwana entries above`
}

const STATIC_RULES = `## Iksīr Murshid — Compaction Rules

This is an Iksīr murshid session. When summarizing, ALWAYS preserve:

1. The murshid ID 
2. Which waṣfāt are done, in-progress, or masdūda
3. Istihal state - ahjar transmuted into jawahir vs still in buwtaqa
4. Buwtaqa branch and kitāb relationship
5. Key architectural qarārāt and WHY they were made (sabab)
6. The instruction: "Use mun_radd to respond — text output is invisible to Iksīr"
7. The instruction: "Call mun_qaraa_mudawwana to reload qarar history after compaction"`