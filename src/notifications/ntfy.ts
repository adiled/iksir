/**
 * ntfy.sh Notification Client
 *
 * Send push notifications via ntfy.sh (self-hosted or cloud).
 * Supports action buttons, priorities, and tags.
 */

import { logger } from "../logging/logger.ts";
import type { TasmimIksir, Notification, NotificationAction, NotificationPriority } from "../types.ts";

const PRIORITY_MAP: Record<NotificationPriority, number> = {
  min: 1,
  low: 2,
  default: 3,
  high: 4,
  urgent: 5,
};

const CATEGORY_TAGS: Record<string, string[]> = {
  blocker: ["warning", "octagonal_sign"],
  decision: ["question", "thinking"],
  progress: ["chart_with_upwards_trend"],
  pr_ready: ["white_check_mark", "rocket"],
  review_comments: ["speech_balloon"],
  milestone: ["tada", "trophy"],
  external_change: ["warning", "eyes"],
  quiet_hours_exit: ["sun_with_face", "coffee"],
};

export class NtfyClient {
  private server: string;
  private topic: string;
  private enabled: boolean;

  constructor(config: TasmimIksir) {
    this.server = config.notifications.ntfy.server;
    this.topic = config.notifications.ntfy.topic;
    this.enabled = config.notifications.ntfy.enabled;
  }

  /**
   * Check if ntfy notifications are enabled
   */
  mumakkan(): boolean {
    return this.enabled;
  }

  /**
   * Build action string for ntfy
   * Format: "action, label, url[, clear=true]"
   */
  private buildActions(actions: NotificationAction[]): string {
    return actions
      .map((action) => {
        const parts = ["http", action.label, action.url ?? `${this.server}/action/${action.action}`];
        return parts.join(", ") + ", clear=true";
      })
      .join("; ");
  }

  /**
   * Send a notification
   */
  async send(notification: Notification): Promise<boolean> {
    if (!this.enabled) {
      await logger.warn("ntfy", "ntfy notifications are disabled, skipping");
      return false;
    }

    const url = `${this.server}/${this.topic}`;
    const tags = CATEGORY_TAGS[notification.category] ?? [];

    const headers: Record<string, string> = {
      Title: notification.title,
      Priority: String(PRIORITY_MAP[notification.priority]),
      Tags: tags.join(","),
    };

    if (notification.actions && notification.actions.length > 0) {
      headers["Actions"] = this.buildActions(notification.actions);
    }

    if (notification.url) {
      headers["Click"] = notification.url;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: notification.body,
      });

      const success = response.ok;
      await logger.notification("ntfy", notification.category, this.topic, notification.title, success);

      if (!success) {
        const errorText = await response.text();
        await logger.error("ntfy", "Failed to send notification", {
          status: response.status,
          error: errorText,
        });
      }

      return success;
    } catch (error) {
      await logger.error("ntfy", "Network error sending notification", { error: String(error) });
      await logger.notification("ntfy", notification.category, this.topic, notification.title, false);
      return false;
    }
  }

  /**
   * Send a blocker notification with action buttons
   */
  async sendBlocker(
    title: string,
    body: string,
    options: string[],
    huwiyyatWasfa?: string,
    projectId?: string
  ): Promise<boolean> {
    const actions: NotificationAction[] = options.map((opt, i) => ({
      label: opt,
      action: `blocker_${huwiyyatWasfa ?? "unknown"}_option_${i}`,
    }));

    return this.send({
      category: "blocker",
      title,
      body,
      priority: "urgent",
      actions,
      huwiyyatWasfa,
      projectId,
    });
  }

  /**
   * Send a decision request with options
   */
  async sendDecision(
    title: string,
    body: string,
    options: string[],
    huwiyyatWasfa?: string,
    projectId?: string
  ): Promise<boolean> {
    const actions: NotificationAction[] = options.map((opt, i) => ({
      label: opt,
      action: `decision_${huwiyyatWasfa ?? "unknown"}_option_${i}`,
    }));

    return this.send({
      category: "decision",
      title,
      body,
      priority: "high",
      actions,
      huwiyyatWasfa,
      projectId,
    });
  }

  /**
   * Send a PR ready notification
   */
  async sendPRReady(
    raqamRisala: number,
    huwiyyatWasfa: string,
    prUrl: string,
    summary: string
  ): Promise<boolean> {
    return this.send({
      category: "pr_ready",
      title: `Draft PR Ready: #${raqamRisala}`,
      body: `${huwiyyatWasfa}\n\n${summary}`,
      priority: "default",
      url: prUrl,
      huwiyyatWasfa,
      actions: [
        {
          label: "View PR",
          action: `view_pr_${raqamRisala}`,
          url: prUrl,
        },
      ],
    });
  }

  /**
   * Send a milestone completion notification
   */
  async sendMilestone(projectId: string, title: string, summary: string): Promise<boolean> {
    return this.send({
      category: "milestone",
      title: `Milestone Complete: ${projectId}`,
      body: `${title}\n\n${summary}`,
      priority: "high",
      projectId,
    });
  }

  /**
   * Send a quiet hours exit notification with blocked status
   */
  async sendQuietHoursExit(blockedItems: string[], options: string[]): Promise<boolean> {
    const body =
      blockedItems.length > 0
        ? `Current blockers:\n${blockedItems.map((b) => `• ${b}`).join("\n")}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
        : "No blockers. Ready to continue work.";

    const actions: NotificationAction[] =
      blockedItems.length > 0
        ? options.map((_opt, i) => ({
            label: `Option ${i + 1}`,
            action: `quiet_exit_option_${i}`,
          }))
        : [];

    return this.send({
      category: "quiet_hours_exit",
      title: "Good morning!",
      body,
      priority: blockedItems.length > 0 ? "high" : "default",
      actions,
    });
  }
}

/**
 * Create an ntfy client instance
 */
export function createNtfyClient(config: TasmimIksir): NtfyClient {
  return new NtfyClient(config);
}
