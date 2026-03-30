/**
 * OpenCode Client
 *
 * Wrapper around the OpenCode SDK for Munadi's needs.
 * Provides session management, event listening, and prompt execution.
 */

import { createOpencodeClient, type OpencodeClient as Client } from "@opencode/sdk/v2";
import { logger } from "../logging/logger.ts";
import type { MunadiConfig, OpenCodeEvent, OpenCodeSession } from "../types.ts";

export class OpenCodeClient {
  private client: Client;
  private serverUrl: string;
  private eventAbortController: AbortController | null = null;

  constructor(config: MunadiConfig) {
    this.serverUrl = config.opencode.server;
    this.client = createOpencodeClient({
      baseUrl: this.serverUrl,
    });
  }

  /**
   * Check if the OpenCode server is healthy by listing sessions
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.client.session.list();
      return response.data !== undefined;
    } catch (error) {
      await logger.error("opencode", "Health check failed", { error: String(error) });
      return false;
    }
  }

  /**
   * Get server version (not available via SDK, returns null)
   */
  async getVersion(): Promise<string | null> {
    // Version info not exposed via SDK API
    return null;
  }

  /**
   * Create a new session for a ticket
   */
  async createSession(ticketId: string, title: string): Promise<OpenCodeSession | null> {
    try {
      const response = await this.client.session.create({
        title: `${ticketId}: ${title}`,
      });

      if (!response.data) {
        await logger.error("opencode", "Failed to create session - no data returned");
        return null;
      }

      const session: OpenCodeSession = {
        id: response.data.id,
        projectId: response.data.projectID,
        ticketId,
        title,
        status: "idle",
        createdAt: new Date(response.data.time.created),
        lastMessageAt: new Date(response.data.time.updated),
      };

      await logger.info("opencode", `Created session ${session.id} for ${ticketId}`);
      return session;
    } catch (error) {
      await logger.error("opencode", "Failed to create session", {
        ticketId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<OpenCodeSession | null> {
    try {
      const response = await this.client.session.get({
        sessionID: sessionId,
      });

      if (!response.data) return null;

      return {
        id: response.data.id,
        projectId: response.data.projectID,
        ticketId: "",
        title: response.data.title ?? "",
        status: "idle", // Would need to check session status endpoint
        createdAt: new Date(response.data.time.created),
        lastMessageAt: new Date(response.data.time.updated),
      };
    } catch (error) {
      await logger.error("opencode", "Failed to get session", {
        sessionId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<OpenCodeSession[]> {
    try {
      const response = await this.client.session.list();
      if (!response.data) return [];

      return response.data.map((s) => ({
        id: s.id,
        projectId: s.projectID,
        ticketId: "",
        title: s.title ?? "",
        status: "idle" as const,
        createdAt: new Date(s.time.created),
        lastMessageAt: new Date(s.time.updated),
      }));
    } catch (error) {
      await logger.error("opencode", "Failed to list sessions", { error: String(error) });
      return [];
    }
  }

  /**
   * Send a prompt to a session (blocking - waits for response)
   */
  async sendPrompt(
    sessionId: string,
    prompt: string,
    options?: {
      model?: { providerID: string; modelID: string };
      agent?: string;
      system?: string;
      timeoutMs?: number;
    }
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    const timeoutMs = options?.timeoutMs ?? 30_000;

    try {
      const promptPromise = this.client.session.prompt({
        sessionID: sessionId,
        parts: [{ type: "text", text: prompt }],
        model: options?.model,
        agent: options?.agent,
        system: options?.system,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Prompt timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const response = await Promise.race([promptPromise, timeoutPromise]);

      if (!response.data) {
        return { success: false, error: "No response data" };
      }

      // Extract text from response parts (with safety for undefined/empty parts)
      const parts = response.data.parts ?? [];
      const textParts = parts
        .filter((p: { type: string }) => p.type === "text")
        .map((p: { type: string; text?: string }) => p.text ?? "");

      const text = textParts.join("\n");
      if (!text) {
        return { success: false, error: "Empty response from LLM" };
      }

      return {
        success: true,
        response: text,
      };
    } catch (error) {
      await logger.error("opencode", "Failed to send prompt", {
        sessionId,
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a prompt asynchronously (non-blocking)
   * 
   * Uses promptAsync which queues the message without waiting for a response.
   */
  async sendPromptAsync(
    sessionId: string,
    prompt: string,
    options?: { agent?: string }
  ): Promise<boolean> {
    try {
      const response = await this.client.session.promptAsync({
        sessionID: sessionId,
        parts: [{ type: "text", text: prompt }],
        agent: options?.agent,
      });

      if (response.data !== undefined) {
        await logger.info("opencode", `Sent async prompt to session ${sessionId}`);
        return true;
      }

      await logger.error("opencode", "Async prompt failed", {
        sessionId,
        error: response.error,
      });
      return false;
    } catch (error) {
      await logger.error("opencode", "Failed to send async prompt", {
        sessionId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string): Promise<boolean> {
    try {
      const response = await this.client.session.abort({
        sessionID: sessionId,
      });
      return response.data ?? false;
    } catch (error) {
      await logger.error("opencode", "Failed to abort session", {
        sessionId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const response = await this.client.session.delete({
        sessionID: sessionId,
      });
      return response.data ?? false;
    } catch (error) {
      await logger.error("opencode", "Failed to delete session", {
        sessionId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Get session status for all sessions
   */
  async getSessionStatuses(): Promise<Record<string, string>> {
    try {
      const response = await this.client.session.status();
      if (!response.data) return {};
      // Response is Record<sessionId, { type: string }>
      const result: Record<string, string> = {};
      for (const [id, status] of Object.entries(response.data)) {
        result[id] = (status as { type: string }).type;
      }
      return result;
    } catch (error) {
      await logger.error("opencode", "Failed to get session statuses", { error: String(error) });
      return {};
    }
  }

  // Classifier session ID (lazy-initialized)
  private classifierSessionId: string | null = null;

  /**
   * Get or create a lightweight session for classification tasks.
   * Reuses a single session to avoid spawning many.
   */
  private async getClassifierSession(): Promise<string | null> {
    if (this.classifierSessionId) {
      // Verify it still exists
      const session = await this.getSession(this.classifierSessionId);
      if (session) return this.classifierSessionId;
    }

    // Create new classifier session
    const session = await this.createSession("munadi-classifier", "Dispatcher Classification");
    if (session) {
      this.classifierSessionId = session.id;
      return session.id;
    }
    return null;
  }

  /**
   * Run a one-shot classification prompt.
   * Uses a shared classifier session for efficiency.
   */
  async classify(prompt: string): Promise<{ success: boolean; response?: string; error?: string }> {
    const sessionId = await this.getClassifierSession();
    if (!sessionId) {
      return { success: false, error: "Failed to get classifier session" };
    }

    return this.sendPrompt(sessionId, prompt);
  }

  /**
   * Subscribe to server events (SSE)
   * Returns an async iterator of events
   *
   * Note: Using raw fetch instead of SDK's event.subscribe() for better control
   * over abort signals and reconnection logic.
   */
  async *subscribeToEvents(signal?: AbortSignal): AsyncGenerator<OpenCodeEvent> {
    const controller = new AbortController();
    this.eventAbortController = controller;

    // Combine signals if provided
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(`${this.serverUrl}/event`, {
        headers: { Accept: "text/event-stream" },
        signal: combinedSignal,
      });

      if (!response.ok || !response.body) {
        await logger.error("opencode", "Failed to subscribe to events", {
          status: response.status,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              yield {
                type: data.type,
                properties: data.properties ?? data,
                timestamp: new Date(),
              };
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        await logger.info("opencode", "Event subscription cancelled");
      } else {
        await logger.error("opencode", "Event subscription error", { error: String(error) });
      }
    } finally {
      this.eventAbortController = null;
    }
  }

  /**
   * Stop listening to events
   */
  stopEventSubscription(): void {
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }
  }

  // ===========================================================================
  // Question Tool Support
  // ===========================================================================

  /**
   * Reply to a question from the question tool.
   * This unblocks the session that asked the question.
   *
   * @param _sessionId - Session ID (unused, kept for API compatibility)
   * @param questionId - The question request ID
   * @param answers - Array of answers, each containing selected labels
   */
  async replyToQuestion(
    _sessionId: string,
    questionId: string,
    answers: Array<{ questionIndex: number; selected: string[]; custom?: string }>
  ): Promise<boolean> {
    try {
      // Convert from our internal format to SDK format
      // SDK expects: answers: Array<Array<string>> (QuestionAnswer[])
      // Each inner array contains the selected labels for that question
      const sdkAnswers = answers.map((a) => {
        if (a.custom) {
          return [a.custom];
        }
        return a.selected;
      });

      const response = await this.client.question.reply({
        requestID: questionId,
        answers: sdkAnswers,
      });

      if (response.data) {
        await logger.info("opencode", `Replied to question ${questionId}`);
        return true;
      }

      await logger.error("opencode", "Failed to reply to question", {
        questionId,
        error: response.error,
      });
      return false;
    } catch (error) {
      await logger.error("opencode", "Error replying to question", {
        questionId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Reject a question (dismiss without answering).
   * Used when we can't process the question.
   *
   * @param _sessionId - Session ID (unused, kept for API compatibility)
   * @param questionId - The question request ID
   */
  async rejectQuestion(_sessionId: string, questionId: string): Promise<boolean> {
    try {
      const response = await this.client.question.reject({
        requestID: questionId,
      });

      if (response.data) {
        await logger.info("opencode", `Rejected question ${questionId}`);
        return true;
      }

      await logger.error("opencode", "Failed to reject question", {
        questionId,
        error: response.error,
      });
      return false;
    } catch (error) {
      await logger.error("opencode", "Error rejecting question", {
        questionId,
        error: String(error),
      });
      return false;
    }
  }

  // ===========================================================================
  // Session Health & Compaction
  // ===========================================================================

  /**
   * Get message count for a session.
   * Returns total messages and assistant message count.
   */
  async getMessageCount(sessionId: string): Promise<{
    total: number;
    assistant: number;
    user: number;
  } | null> {
    try {
      const response = await this.client.session.messages({
        sessionID: sessionId,
      });

      if (!response.data) return null;

      let assistant = 0;
      let user = 0;
      for (const msg of response.data) {
        if (msg.info.role === "assistant") assistant++;
        else if (msg.info.role === "user") user++;
      }

      return { total: response.data.length, assistant, user };
    } catch (error) {
      await logger.error("opencode", "Failed to get message count", {
        sessionId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Get the last assistant message for a session.
   * Used by health monitor to check if a session is stuck (tokens_out=0).
   */
  async getLastAssistantMessage(sessionId: string): Promise<{
    id: string;
    createdAt: number;
    completedAt?: number;
    tokensOutput: number;
    cost: number;
    error?: string;
  } | null> {
    try {
      const response = await this.client.session.messages({
        sessionID: sessionId,
      });

      if (!response.data) return null;

      // Find the last assistant message (messages are returned in order)
      for (let i = response.data.length - 1; i >= 0; i--) {
        const msg = response.data[i];
        if (msg.info.role === "assistant") {
          const info = msg.info as {
            id: string;
            time: { created: number; completed?: number };
            tokens: { output: number };
            cost: number;
            error?: { name: string; data: { message: string } };
          };
          return {
            id: info.id,
            // OpenCode SDK returns Unix epoch in seconds (Go convention) — convert to ms
            createdAt: info.time.created * 1000,
            completedAt: info.time.completed ? info.time.completed * 1000 : undefined,
            tokensOutput: info.tokens.output,
            cost: info.cost,
            error: info.error?.data?.message,
          };
        }
      }

      return null;
    } catch (error) {
      await logger.error("opencode", "Failed to get last assistant message", {
        sessionId,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Summarize (compact) a session to reduce context usage.
   * Preserves key information while reducing token count.
   */
  async summarizeSession(
    sessionId: string,
    options?: { providerID?: string; modelID?: string; auto?: boolean }
  ): Promise<boolean> {
    try {
      const response = await this.client.session.summarize({
        sessionID: sessionId,
        providerID: options?.providerID ?? "anthropic",
        modelID: options?.modelID ?? "claude-sonnet-4-20250514",
        auto: options?.auto,
      });

      if (response.data) {
        await logger.info("opencode", `Summarized session ${sessionId}`);
        return true;
      }

      await logger.error("opencode", "Failed to summarize session", {
        sessionId,
        error: response.error,
      });
      return false;
    } catch (error) {
      await logger.error("opencode", "Error summarizing session", {
        sessionId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Get the raw SDK client for advanced operations
   */
  getRawClient(): Client {
    return this.client;
  }
}

/**
 * Create an OpenCode client instance
 */
export function createOpenCodeClient(config: MunadiConfig): OpenCodeClient {
  return new OpenCodeClient(config);
}
