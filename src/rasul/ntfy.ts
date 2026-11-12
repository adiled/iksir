/**
 * ntfy.sh Ishara Client
 *
 * Send push notifications via ntfy.sh (self-hosted or cloud).
 * Supports action buttons, priorities, and tags.
 */

import { logger } from "../logging/logger.ts";
import type { Ishara, FiilIshara, AwwaliyyatIshara } from "../types.ts";
import type { Tasmim } from "../config.ts";

const PRIORITY_MAP: Record<AwwaliyyatIshara, number> = {
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
  #tasmim: Tasmim;

  constructor(tasmim: Tasmim) {
    this.#tasmim = tasmim;
  }

  private get server(): string {
    return this.#tasmim.ntfy()?.server ?? "";
  }

  private get topic(): string {
    return this.#tasmim.ntfy()?.topic ?? "";
  }

  private get enabled(): boolean {
    return this.#tasmim.ntfy() !== null;
  }

  mumakkan(): boolean {
    return this.enabled;
  }

  private buildActions(actions: FiilIshara[]): string {
    return actions
      .map((action) => {
        const parts = ["http", action.label, action.url ?? `${this.server}/action/${action.action}`];
        return parts.join(", ") + ", clear=true";
      })
      .join("; ");
  }

  async send(notification: Ishara): Promise<boolean> {
    if (!this.enabled) {
      await logger.haDHHir("ntfy", "ntfy notifications are disabled, skipping");
      return false;
    }

    const url = `${this.server}/${this.topic}`;
    const tags = CATEGORY_TAGS[notification.sinf] ?? [];

    const headers: Record<string, string> = {
      Title: notification.unwan,
      Awwaliyya: String(PRIORITY_MAP[notification.awwaliyya]),
      Tags: tags.join(","),
    };

    if (notification.afaal && notification.afaal.length > 0) {
      headers["Actions"] = this.buildActions(notification.afaal);
    }

    if (notification.url) {
      headers["Click"] = notification.url;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: notification.matn,
      });

      const success = response.ok;
      await logger.sajjalIshara("ntfy", notification.sinf, this.topic, notification.unwan, success);

      if (!success) {
        const errorText = await response.text();
        await logger.sajjalKhata("ntfy", "Failed to send notification", {
          status: response.status,
          error: errorText,
        });
      }

      return success;
    } catch (error) {
      await logger.sajjalKhata("ntfy", "Network error sending notification", { error: String(error) });
      await logger.sajjalIshara("ntfy", notification.sinf, this.topic, notification.unwan, false);
      return false;
    }
  }

  async sendBlocker(
    title: string,
    body: string,
    options: string[],
    huwiyyatWasfa?: string,
    projectId?: string
  ): Promise<boolean> {
    const actions: FiilIshara[] = options.map((opt, i) => ({
      label: opt,
      action: `blocker_${huwiyyatWasfa ?? "unknown"}_option_${i}`,
    }));

    return this.send({
      sinf: "blocker",
      unwan: title,
      matn: body,
      awwaliyya: "urgent",
      afaal: actions,
      huwiyyatWasfa,
      huwiyyatMashru: projectId,
    });
  }

  async sendDecision(
    title: string,
    body: string,
    options: string[],
    huwiyyatWasfa?: string,
    projectId?: string
  ): Promise<boolean> {
    const actions: FiilIshara[] = options.map((opt, i) => ({
      label: opt,
      action: `decision_${huwiyyatWasfa ?? "unknown"}_option_${i}`,
    }));

    return this.send({
      sinf: "decision",
      unwan: title,
      matn: body,
      awwaliyya: "high",
      afaal: actions,
      huwiyyatWasfa,
      huwiyyatMashru: projectId,
    });
  }

  async sendJawharMafsul(
    huwiyyatWasfa: string,
    rabit: string,
    mulakhkhas: string,
  ): Promise<boolean> {
    return this.send({
      sinf: "jawhar_mafsul",
      unwan: `Jawhar decanted: ${huwiyyatWasfa}`,
      matn: mulakhkhas,
      awwaliyya: "default",
      url: rabit,
      huwiyyatWasfa,
      afaal: [
        {
          label: "Look upon it",
          action: `nazar_${huwiyyatWasfa}`,
          url: rabit,
        },
      ],
    });
  }

  async sendQuietHoursExit(blockedItems: string[], options: string[]): Promise<boolean> {
    const body =
      blockedItems.length > 0
        ? `Current blockers:\n${blockedItems.map((b) => `• ${b}`).join("\n")}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
        : "No blockers. Ready to continue work.";

    const actions: FiilIshara[] =
      blockedItems.length > 0
        ? options.map((_opt, i) => ({
            label: `Option ${i + 1}`,
            action: `quiet_exit_option_${i}`,
          }))
        : [];

    return this.send({
      sinf: "quiet_hours_exit",
      unwan: "Good morning!",
      matn: body,
      awwaliyya: blockedItems.length > 0 ? "high" : "default",
      afaal: actions,
    });
  }
}

export function anshaaNtfyAmil(tasmim: Tasmim): NtfyClient {
  return new NtfyClient(tasmim);
}
