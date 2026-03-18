/**
 * Iksir Logger
 *
 * Structured logging with file output and console display.
 * Cross-platform compatible (Linux, macOS).
 */

import { ensureDir } from "jsr:@std/fs";
import { join } from "jsr:@std/path";
import type { DecisionMudkhalSijill, MudkhalTaghyirKhariji, MudkhalSijill, MustawaSijill } from "../types.ts";

function masarSijillAhdaq(): string {
  return Deno.env.get("IKSIR_LOG_DIR") ??
    join(Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME") ?? "/root", ".local", "state"), "iksir");
}

const LOG_FILES = {
  main: "iksir.log",
  decisions: "decisions.log",
  externalChanges: "external_changes.log",
  notifications: "notifications.log",
} as const;

type MilafSijill = keyof typeof LOG_FILES;

class Musjil {
  private tahyiad = false;
  private logLevel: MustawaSijill = "info";

  private readonly levelPriority: Record<MustawaSijill, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  async baddaa(): Promise<void> {
    if (this.tahyiad) return;
    await ensureDir(masarSijillAhdaq());
    this.tahyiad = true;

    const level = Deno.env.get("IKSIR_LOG_LEVEL") as MustawaSijill | undefined;
    if (level && this.levelPriority[level] !== undefined) {
      this.logLevel = level;
    }
  }

  private yajibuTasjil(level: MustawaSijill): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }

  private nassiqWaqt(date: Date): string {
    return date.toISOString();
  }

  private nassiqLiWajiha(entry: MudkhalSijill): string {
    const levelColors: Record<MustawaSijill, string> = {
      debug: "\x1b[90m",
      info: "\x1b[36m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
    };
    const reset = "\x1b[0m";
    const color = levelColors[entry.level];
    const level = entry.level.toUpperCase().padEnd(5);

    let line = `${color}[${this.nassiqWaqt(entry.timestamp)}] [${level}] [${entry.category}]${reset} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      line += `\n  ${JSON.stringify(entry.context)}`;
    }

    return line;
  }

  private nassiqLiMilaf(entry: MudkhalSijill): string {
    return JSON.stringify({
      ...entry,
      timestamp: this.nassiqWaqt(entry.timestamp),
    });
  }

  private async adhifIlaMilaf(file: MilafSijill, content: string): Promise<void> {
    if (!this.tahyiad) await this.baddaa();
    const path = join(masarSijillAhdaq(), LOG_FILES[file]);
    await Deno.writeTextFile(path, content + "\n", { append: true });
  }

  private async uktubQayd(file: MilafSijill, entry: MudkhalSijill): Promise<void> {
    if (!this.yajibuTasjil(entry.level)) return;

    console.log(this.nassiqLiWajiha(entry));

    await this.adhifIlaMilaf(file, this.nassiqLiMilaf(entry));
  }

  /** Main logger methods */
  async tatbeeq(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.uktubQayd("main", {
      timestamp: new Date(),
      level: "debug",
      category,
      message,
      context,
    });
  }

  async akhbar(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.uktubQayd("main", {
      timestamp: new Date(),
      level: "info",
      category,
      message,
      context,
    });
  }

  async haDHHir(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.uktubQayd("main", {
      timestamp: new Date(),
      level: "warn",
      category,
      message,
      context,
    });
  }

  async error(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.uktubQayd("main", {
      timestamp: new Date(),
      level: "error",
      category,
      message,
      context,
    });
  }

  /** Decision audit log */
  async sajjalQarar(entry: Omit<DecisionMudkhalSijill, "timestamp" | "level" | "category">): Promise<void> {
    const fullEntry: DecisionMudkhalSijill = {
      ...entry,
      timestamp: new Date(),
      level: "info",
      category: "decisions",
    };

    await this.akhbar("decisions", entry.message, {
      event: entry.event,
      interpretation: entry.interpretation,
      action: entry.action,
      reasoning: entry.reasoning,
    });

    await this.adhifIlaMilaf("decisions", this.nassiqLiMilaf(fullEntry));
  }

  /** External changes log */
  async sajjalTaghyirKhariji(
    entry: Omit<MudkhalTaghyirKhariji, "timestamp" | "level" | "category" | "message">
  ): Promise<void> {
    const message = `External change from ${entry.source}: ${entry.entityType} ${entry.entityId} by ${entry.author}`;
    const fullEntry: MudkhalTaghyirKhariji = {
      ...entry,
      timestamp: new Date(),
      level: "info",
      category: "external_changes",
      message,
    };

    await this.akhbar("external_changes", message, {
      source: entry.source,
      entityType: entry.entityType,
      entityId: entry.entityId,
      author: entry.author,
      changes: entry.changes,
      impact: entry.impact,
    });

    await this.adhifIlaMilaf("externalChanges", this.nassiqLiMilaf(fullEntry));
  }

  async sajjalIshara(
    channel: "ntfy" | "telegram",
    category: string,
    recipient: string,
    message: string,
    success: boolean
  ): Promise<void> {
    const entry: MudkhalSijill = {
      timestamp: new Date(),
      level: success ? "info" : "error",
      category: "notifications",
      message: `[${channel}] ${category} -> ${recipient}: ${success ? "sent" : "FAILED"}`,
      context: { channel, category, recipient, message, success },
    };

    await this.adhifIlaMilaf("notifications", this.nassiqLiMilaf(entry));

    if (!success) {
      await this.error("notifications", `Failed to send ${channel} notification`, { category, message });
    }
  }

  /** Read recent logs (for /log command) */
  async iqraAkhiran(file: MilafSijill = "main", lines = 50): Promise<MudkhalSijill[]> {
    if (!this.tahyiad) await this.baddaa();
    const path = join(masarSijillAhdaq(), LOG_FILES[file]);

    try {
      const content = await Deno.readTextFile(path);
      const allLines = content.trim().split("\n").filter(Boolean);
      const recentLines = allLines.slice(-lines);

      return recentLines.map((line) => {
        try {
          return JSON.parse(line) as MudkhalSijill;
        } catch {
          return {
            timestamp: new Date(),
            level: "error" as MustawaSijill,
            category: "parser",
            message: `Failed to parse log line: ${line}`,
          };
        }
      });
    } catch (sajjalKhata) {
      if (sajjalKhata instanceof Deno.errors.NotFound) {
        return [];
      }
      throw sajjalKhata;
    }
  }
}

/** Singleton instance */
export const logger = new Musjil();
