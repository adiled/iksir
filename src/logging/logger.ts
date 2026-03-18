/**
 * Iksir Logger
 *
 * Structured logging with file output and console display.
 * Cross-platform compatible (Linux, macOS).
 */

import { ensureDir } from "jsr:@std/fs";
import { join } from "jsr:@std/path";
import type { DecisionMudkhalSijill, MudkhalTaghyirKhariji, MudkhalSijill, MustawaSijill } from "../types.ts";

function getLogDir(): string {
  return Deno.env.get("IKSIR_LOG_DIR") ??
    join(Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME") ?? "/root", ".local", "state"), "iksir");
}

const LOG_FILES = {
  main: "iksir.log",
  decisions: "decisions.log",
  externalChanges: "external_changes.log",
  notifications: "notifications.log",
} as const;

type LogFile = keyof typeof LOG_FILES;

class Logger {
  private tahyiad = false;
  private logLevel: MustawaSijill = "info";

  private readonly levelPriority: Record<MustawaSijill, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  async init(): Promise<void> {
    if (this.tahyiad) return;
    await ensureDir(getLogDir());
    this.tahyiad = true;

    const level = Deno.env.get("IKSIR_LOG_LEVEL") as MustawaSijill | undefined;
    if (level && this.levelPriority[level] !== undefined) {
      this.logLevel = level;
    }
  }

  private shouldLog(level: MustawaSijill): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString();
  }

  private formatForConsole(entry: MudkhalSijill): string {
    const levelColors: Record<MustawaSijill, string> = {
      debug: "\x1b[90m",
      info: "\x1b[36m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
    };
    const reset = "\x1b[0m";
    const color = levelColors[entry.level];
    const level = entry.level.toUpperCase().padEnd(5);

    let line = `${color}[${this.formatTimestamp(entry.timestamp)}] [${level}] [${entry.category}]${reset} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      line += `\n  ${JSON.stringify(entry.context)}`;
    }

    return line;
  }

  private formatForFile(entry: MudkhalSijill): string {
    return JSON.stringify({
      ...entry,
      timestamp: this.formatTimestamp(entry.timestamp),
    });
  }

  private async appendToFile(file: LogFile, content: string): Promise<void> {
    if (!this.tahyiad) await this.init();
    const path = join(getLogDir(), LOG_FILES[file]);
    await Deno.writeTextFile(path, content + "\n", { append: true });
  }

  private async writeEntry(file: LogFile, entry: MudkhalSijill): Promise<void> {
    if (!this.shouldLog(entry.level)) return;

    console.log(this.formatForConsole(entry));

    await this.appendToFile(file, this.formatForFile(entry));
  }

  /** Main logger methods */
  async debug(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.writeEntry("main", {
      timestamp: new Date(),
      level: "debug",
      category,
      message,
      context,
    });
  }

  async info(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.writeEntry("main", {
      timestamp: new Date(),
      level: "info",
      category,
      message,
      context,
    });
  }

  async warn(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.writeEntry("main", {
      timestamp: new Date(),
      level: "warn",
      category,
      message,
      context,
    });
  }

  async error(category: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.writeEntry("main", {
      timestamp: new Date(),
      level: "error",
      category,
      message,
      context,
    });
  }

  /** Decision audit log */
  async decision(entry: Omit<DecisionMudkhalSijill, "timestamp" | "level" | "category">): Promise<void> {
    const fullEntry: DecisionMudkhalSijill = {
      ...entry,
      timestamp: new Date(),
      level: "info",
      category: "decisions",
    };

    await this.info("decisions", entry.message, {
      event: entry.event,
      interpretation: entry.interpretation,
      action: entry.action,
      reasoning: entry.reasoning,
    });

    await this.appendToFile("decisions", this.formatForFile(fullEntry));
  }

  /** External changes log */
  async externalChange(
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

    await this.info("external_changes", message, {
      source: entry.source,
      entityType: entry.entityType,
      entityId: entry.entityId,
      author: entry.author,
      changes: entry.changes,
      impact: entry.impact,
    });

    await this.appendToFile("externalChanges", this.formatForFile(fullEntry));
  }

  async notification(
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

    await this.appendToFile("notifications", this.formatForFile(entry));

    if (!success) {
      await this.error("notifications", `Failed to send ${channel} notification`, { category, message });
    }
  }

  /** Read recent logs (for /log command) */
  async readRecent(file: LogFile = "main", lines = 50): Promise<MudkhalSijill[]> {
    if (!this.tahyiad) await this.init();
    const path = join(getLogDir(), LOG_FILES[file]);

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
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }
}

/** Singleton instance */
export const logger = new Logger();
