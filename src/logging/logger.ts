/**
 * Munadi Logger
 *
 * Structured logging with file output and console display.
 * Cross-platform compatible (Linux, macOS).
 */

import { ensureDir } from "jsr:@std/fs";
import { join } from "jsr:@std/path";
import type { DecisionLogEntry, ExternalChangeEntry, LogEntry, LogLevel } from "../types.ts";

function getLogDir(): string {
  return Deno.env.get("MUNADI_LOG_DIR") ??
    join(Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME") ?? "/root", ".local", "state"), "munadi");
}

const LOG_FILES = {
  main: "munadi.log",
  decisions: "decisions.log",
  externalChanges: "external_changes.log",
  notifications: "notifications.log",
} as const;

type LogFile = keyof typeof LOG_FILES;

class Logger {
  private initialized = false;
  private logLevel: LogLevel = "info";

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  async init(): Promise<void> {
    if (this.initialized) return;
    await ensureDir(getLogDir());
    this.initialized = true;

    const level = Deno.env.get("MUNADI_LOG_LEVEL") as LogLevel | undefined;
    if (level && this.levelPriority[level] !== undefined) {
      this.logLevel = level;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString();
  }

  private formatForConsole(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      debug: "\x1b[90m", // gray
      info: "\x1b[36m", // cyan
      warn: "\x1b[33m", // yellow
      error: "\x1b[31m", // red
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

  private formatForFile(entry: LogEntry): string {
    return JSON.stringify({
      ...entry,
      timestamp: this.formatTimestamp(entry.timestamp),
    });
  }

  private async appendToFile(file: LogFile, content: string): Promise<void> {
    if (!this.initialized) await this.init();
    const path = join(getLogDir(), LOG_FILES[file]);
    await Deno.writeTextFile(path, content + "\n", { append: true });
  }

  private async writeEntry(file: LogFile, entry: LogEntry): Promise<void> {
    if (!this.shouldLog(entry.level)) return;

    // Console output
    console.log(this.formatForConsole(entry));

    // File output
    await this.appendToFile(file, this.formatForFile(entry));
  }

  // Main logger methods
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

  // Decision audit log
  async decision(entry: Omit<DecisionLogEntry, "timestamp" | "level" | "category">): Promise<void> {
    const fullEntry: DecisionLogEntry = {
      ...entry,
      timestamp: new Date(),
      level: "info",
      category: "decisions",
    };

    // Also log to main for visibility
    await this.info("decisions", entry.message, {
      event: entry.event,
      interpretation: entry.interpretation,
      action: entry.action,
      reasoning: entry.reasoning,
    });

    // Write to dedicated decisions log
    await this.appendToFile("decisions", this.formatForFile(fullEntry));
  }

  // External changes log
  async externalChange(
    entry: Omit<ExternalChangeEntry, "timestamp" | "level" | "category" | "message">
  ): Promise<void> {
    const message = `External change from ${entry.source}: ${entry.entityType} ${entry.entityId} by ${entry.author}`;
    const fullEntry: ExternalChangeEntry = {
      ...entry,
      timestamp: new Date(),
      level: "info",
      category: "external_changes",
      message,
    };

    // Also log to main for visibility
    await this.info("external_changes", message, {
      source: entry.source,
      entityType: entry.entityType,
      entityId: entry.entityId,
      author: entry.author,
      changes: entry.changes,
      impact: entry.impact,
    });

    // Write to dedicated external changes log
    await this.appendToFile("externalChanges", this.formatForFile(fullEntry));
  }

  // Notification log
  async notification(
    channel: "ntfy" | "telegram",
    category: string,
    recipient: string,
    message: string,
    success: boolean
  ): Promise<void> {
    const entry: LogEntry = {
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

  // Read recent logs (for /log command)
  async readRecent(file: LogFile = "main", lines = 50): Promise<LogEntry[]> {
    if (!this.initialized) await this.init();
    const path = join(getLogDir(), LOG_FILES[file]);

    try {
      const content = await Deno.readTextFile(path);
      const allLines = content.trim().split("\n").filter(Boolean);
      const recentLines = allLines.slice(-lines);

      return recentLines.map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return {
            timestamp: new Date(),
            level: "error" as LogLevel,
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

// Singleton instance
export const logger = new Logger();
