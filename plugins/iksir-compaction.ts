/**
 * Munadi Compaction Plugin for OpenCode
 *
 * Hooks into OpenCode's session compaction to inject Munadi-specific context:
 * - Diary decisions (architectural choices, PR strategy, blockers)
 * - Murshid identity (ID, branch, epic info)
 * - Preservation rules (what the compaction summary MUST retain)
 *
 * Without this plugin, compaction uses a generic summarizer that gradually
 * loses Munadi-critical context over 5-6 compaction cycles. With it, diary
 * entries and murshid identity are baked into every compaction summary.
 *
 * Runs inside OpenCode's Bun process. Reads Munadi's SQLite DB directly
 * (read-only) via bun:sqlite.
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

const MUNADI_DB_PATH =
  process.env.MUNADI_DB_PATH ??
  `${process.env.HOME ?? "/root"}/.config/iksir/state/iksir.sqlite`

/**
 * Resolve murshid identifier from an OpenCode session ID.
 *
 * Munadi's sessions table uses the OpenCode session ID as its primary key (`id`).
 * Returns session metadata including the murshid identifier (Linear ticket ID).
 */
function resolveMurshid(
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
 * Fetch diary decisions for an murshid, most recent first.
 */
function getDiaryEntries(db: Database, huwiyyatMurshid: string): DiaryRow[] {
  try {
    return db
      .prepare(
        `SELECT type, decision, reasoning, created_at
         FROM diary_decisions
         WHERE huwiyat_murshid = ?
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
function formatDiary(entries: DiaryRow[]): string {
  return entries
    .map(
      (e) =>
        `[${e.type.toUpperCase()}] ${e.created_at}\n  Decision: ${e.decision}\n  Reasoning: ${e.reasoning}`,
    )
    .join("\n\n")
}

export const iksirCompaction: Plugin = async (_ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      let db: Database | null = null
      try {
        db = new Database(MUNADI_DB_PATH, { readonly: true })
      } catch {
        output.context.push(STATIC_RULES)
        return
      }

      try {
        /** Resolve which murshid owns this session */
        const session = resolveMurshid(db, input.sessionID)
        if (!session) {
          db.close()
          return
        }

        const orchId = session.identifier
        const entries = getDiaryEntries(db, orchId)
        db.close()

        /** Build the context injection */
        const parts: string[] = []

        parts.push(`## Munadi Murshid Context

This is a Munadi murshid session managing a Linear epic.

- **Murshid ID**: ${orchId}${session.title ? `\n- **Epic Title**: ${session.title}` : ""}${session.branch ? `\n- **Branch**: ${session.branch}` : ""}${session.status ? `\n- **Status**: ${session.status}` : ""}`)

        if (entries.length > 0) {
          parts.push(`### Diary Decisions (CRITICAL — preserve in summary)

These decisions represent key architectural, strategic, and PR choices made during
this epic. They CANNOT be reconstructed from code alone. The compaction summary
MUST include these or they will be permanently lost:

${formatDiary(entries)}`)
        }

        parts.push(preservationRules(orchId))

        output.context.push(parts.join("\n\n"))
      } catch {
        db?.close()
        output.context.push(STATIC_RULES)
      }
    },
  }
}

function preservationRules(orchId: string): string {
  return `### Preservation Rules

When constructing the compaction summary, you MUST:

1. Include the murshid ID (**${orchId}**) — needed for mun_reply tool calls
2. Include which Linear tickets are done, in-progress, or blocked
3. Include SSP/SSSP state — which files have been sliced to PR branches vs still on epic branch
4. Include the current branch name and its relationship to the epic
5. Include all blocking decisions and their rationale
6. Include the instruction: "Use mun_reply to respond to Munadi — direct text output is invisible"
7. Include the instruction: "Call mun_read_diary after compaction to reload full decision history"
8. Preserve any constraints or architectural decisions from the diary entries above`
}

const STATIC_RULES = `## Munadi Murshid — Compaction Rules

This is a Munadi murshid session. When summarizing, ALWAYS preserve:

1. the murshid ID (format: TICKET-1234) — critical for mun_reply
2. Which Linear tickets are done, in-progress, or blocked
3. SSP/SSSP state — which files have been sliced to PR branches
4. Branch name and epic relationship
5. Key architectural decisions and WHY they were made
6. The instruction: "Use mun_reply to respond — text output is invisible to Munadi"
7. The instruction: "Call mun_read_diary to reload decision history after compaction"`
