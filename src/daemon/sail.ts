/**
 * Question Handler
 *
 * Handles question.asked events from OpenCode SSE.
 * Classifies questions as worthy (forward to operator) or cry-baby (auto-answer).
 *
 * Similar to pm_notify filtering in tool-executor, but for the
 * question tool which presents MCQ-style decisions.
 */

import { logger } from "../logging/logger.ts";
import { OpenCodeClient } from "../opencode/client.ts";
import {
  insertQuestion as dbInsertQuestion,
  getUnansweredQuestions,
  markQuestionAnswered as dbMarkQuestionAnswered,
} from "../../db/db.ts";
import { classifyQuestion } from "./classifier.ts";
import type { MudīrJalasāt } from "./session-manager.ts";
import type {
  QuestionAskedEvent,
  QuestionInfo,
  QuestionAnswer,
  QuestionClassification,
  PendingQuestion,
  MessengerOutbound,
} from "../types.ts";



interface QuestionHandlerDeps {
  opencode: OpenCodeClient;
  messenger: MessengerOutbound;
  sessionManager: MudīrJalasāt;
}

export class QuestionHandler {
  #opencode: OpenCodeClient;
  #messenger: MessengerOutbound;
  #sessionManager: MudīrJalasāt;

  // Pending questions awaiting operator response (keyed by question ID)
  #pendingQuestions: Map<string, PendingQuestion> = new Map();

  // Short callback ID → full question ID mapping.
  // Telegram callback_data is limited to 64 bytes; full UUIDs (36 chars)
  // plus prefix and label would exceed this. We use 8-char short IDs instead.
  #callbackIdMap: Map<string, string> = new Map();

  // Questions awaiting custom text input (keyed by murshid identifier)
  // When the operator clicks "Type answer...", we store the question ID here
  // and the next text message in that murshid's channel becomes the custom answer
  #awaitingCustomInput: Map<string, string> = new Map();

  // Transport-layer callback for rich question rendering (inline keyboards, etc.)
  // Set by main.ts to handle Telegram-specific UI.
  #onQuestionForwarded: ((pending: PendingQuestion, question: QuestionInfo) => Promise<void>) | null = null;

  /**
   * Set callback for transport-specific question rendering.
   * Called after a question is forwarded to operator via messenger.
   */
  setOnQuestionForwarded(
    callback: (pending: PendingQuestion, question: QuestionInfo) => Promise<void>,
  ): void {
    this.#onQuestionForwarded = callback;
  }

  /**
   * Generate a short callback ID (8 chars) for Telegram callback_data
   * and register the mapping to the full question ID.
   */
  #shortCallbackId(questionId: string): string {
    const short = questionId.replace(/-/g, "").slice(0, 8);
    this.#callbackIdMap.set(short, questionId);
    return short;
  }

  /**
   * Resolve a short callback ID back to the full question ID.
   */
  #resolveCallbackId(shortId: string): string | null {
    return this.#callbackIdMap.get(shortId) ?? null;
  }

  constructor(deps: QuestionHandlerDeps) {
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
    this.#sessionManager = deps.sessionManager;
  }

  /**
   * Handle a question.asked event from OpenCode SSE.
   * Classifies the question and either auto-answers or forwards to operator.
   */
  async handleQuestionAsked(event: QuestionAskedEvent): Promise<void> {
    const { id, sessionID, questions } = event.properties;

    await logger.info("question-handler", `Received question ${id}`, {
      sessionID,
      questionCount: questions.length,
    });

    // Find which murshid this session belongs to
    const murshid = this.#sessionManager.wajadaJalasātMurshid().find(
      (o) => o.id === sessionID
    );

    if (!murshid) {
      await logger.warn("question-handler", `Question from unknown session ${sessionID}`);
      // Reject - we don't know which murshid this is
      await this.#opencode.rejectQuestion(sessionID, id);
      return;
    }

    // Classify each question (for now, treat all questions in batch as one)
    // Take the first question as representative (most question calls have 1 question)
    const primaryQuestion = questions[0];
    if (!primaryQuestion) {
      await logger.warn("question-handler", `Question ${id} has no questions array`);
      await this.#opencode.rejectQuestion(sessionID, id);
      return;
    }

    const classification = await classifyQuestion(this.#opencode, primaryQuestion);

    await logger.info("question-handler", `Classification: ${classification.classification}`, {
      reason: classification.reason,
      questionHeader: primaryQuestion.header,
    });

    if (classification.classification === "CRY_BABY") {
      // Auto-answer and inject guidance
      await this.#handleCryBaby(sessionID, id, questions, classification);
    } else {
      // Forward to operator via messenger
      await this.#forwardToDaemon(sessionID, id, questions, murshid.identifier);
    }
  }

  /**
   * Handle a cry-baby question: auto-answer and inject guidance.
   */
  async #handleCryBaby(
    sessionID: string,
    questionId: string,
    questions: QuestionInfo[],
    classification: QuestionClassification
  ): Promise<void> {
    // Build auto-answers
    const answers: QuestionAnswer[] = questions.map((q, index) => {
      // Find the recommended option or use autoAnswer from classification
      let selectedLabel: string;

      if (classification.autoAnswer) {
        // Use classifier's suggested answer
        selectedLabel = classification.autoAnswer;
      } else {
        // Find option marked as "(Recommended)" or pick first
        const recommended = q.options.find((o) => o.label.includes("(Recommended)"));
        selectedLabel = recommended?.label ?? q.options[0]?.label ?? "";
      }

      return {
        questionIndex: index,
        selected: selectedLabel ? [selectedLabel] : [],
      };
    });

    // Reply with auto-answer
    const replied = await this.#opencode.replyToQuestion(sessionID, questionId, answers);

    if (replied) {
      await logger.info("question-handler", `Auto-answered question ${questionId}`, {
        autoAnswer: classification.autoAnswer,
      });
    } else {
      // Fallback: reject
      await this.#opencode.rejectQuestion(sessionID, questionId);
      await logger.warn("question-handler", `Failed to auto-answer, rejected ${questionId}`);
    }

    // Inject guidance as follow-up message
    const guidance = `Your question was auto-answered. Reason: ${classification.reason}

${classification.rejection ?? "Proceed autonomously using your judgment."}

Auto-selected: ${answers.map((a) => a.selected.join(", ")).join("; ")}`;

    await this.#opencode.sendPromptAsync(sessionID, guidance);
  }

  /**
   * Forward a worthy question to operator via messenger.
   * Sends formatted text. Transport-specific rendering (inline keyboards)
   * is handled by the onQuestionForwarded callback if set.
   */
  async #forwardToDaemon(
    sessionID: string,
    questionId: string,
    questions: QuestionInfo[],
    huwiyyatMurshid: string,
  ): Promise<void> {
    // Store as pending
    const pending: PendingQuestion = {
      id: questionId,
      sessionID,
      huwiyyatMurshid,
      questions,
      createdAt: new Date().toISOString(),
    };
    this.#pendingQuestions.set(questionId, pending);

    // Persist to SQLite immediately so we don't lose pending questions on crash
    const primaryQuestion = questions[0];
    dbInsertQuestion({
      id: questionId,
      sessionId: sessionID,
      question: primaryQuestion?.question ?? "",
      options: primaryQuestion?.options.map(o => o.label) ?? [],
    });

    // Build question text
    const messageText = this.#formatQuestionMessage(primaryQuestion!, huwiyyatMurshid);

    // Send via messenger
    await this.#messenger.sendFormatted({ murshid: huwiyyatMurshid }, messageText);

    // Notify transport layer for rich rendering (inline keyboards, etc.)
    if (this.#onQuestionForwarded) {
      await this.#onQuestionForwarded(pending, primaryQuestion!);
    }

    await logger.info("question-handler", `Forwarded question ${questionId}`, {
      huwiyyatMurshid,
    });
  }

  /**
   * Format a question for Telegram display.
   */
  #formatQuestionMessage(question: QuestionInfo, huwiyyatMurshid: string): string {
    let msg = `**${question.header}** (${huwiyyatMurshid})\n\n`;
    msg += `${question.question}\n\n`;
    msg += `_Options:_\n`;
    
    for (const opt of question.options) {
      const isRecommended = opt.label.includes("(Recommended)");
      const marker = isRecommended ? "→ " : "  ";
      msg += `${marker}**${opt.label}**\n`;
      if (opt.description) {
        msg += `    ${opt.description}\n`;
      }
    }

    if (question.custom !== false) {
      msg += `\n_Or type your own answer_`;
    }

    return msg;
  }

  /**
   * Build inline keyboard data for transport-specific rendering.
   * Public so main.ts can build Telegram keyboards.
   */
  buildInlineKeyboard(
    questionId: string,
    question: QuestionInfo
  ): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    // Use short 8-char ID to stay within Telegram's 64-byte callback_data limit.
    // Format: "q:{8}:{label}" — 11 chars overhead, leaving 53 for label.
    const shortId = this.#shortCallbackId(questionId);
    const maxLabelLen = 64 - 2 - shortId.length - 1; // q: + shortId + :

    // One button per option
    for (const opt of question.options) {
      const shortLabel = opt.label.slice(0, maxLabelLen);
      rows.push([
        {
          text: opt.label,
          callback_data: `q:${shortId}:${shortLabel}`,
        },
      ]);
    }

    // Add custom answer button if allowed
    if (question.custom !== false) {
      rows.push([
        {
          text: "Type answer...",
          callback_data: `q:${shortId}:__custom__`,
        },
      ]);
    }

    return { inline_keyboard: rows };
  }

  /**
   * Handle a callback query (button press) for a question.
   * Called from main.ts when Telegram callback matches question pattern.
   */
  async handleQuestionCallback(
    questionId: string,
    selectedLabel: string,
    customText?: string
  ): Promise<boolean> {
    const pending = this.#pendingQuestions.get(questionId);
    if (!pending) {
      await logger.warn("question-handler", `No pending question for callback ${questionId}`);
      return false;
    }

    // Build answer
    const answers: QuestionAnswer[] = pending.questions.map((_, index) => ({
      questionIndex: index,
      selected: selectedLabel === "__custom__" && customText ? [] : [selectedLabel],
      custom: selectedLabel === "__custom__" ? customText : undefined,
    }));

    // Reply to OpenCode
    const replied = await this.#opencode.replyToQuestion(
      pending.sessionID,
      questionId,
      answers
    );

    if (replied) {
      this.#pendingQuestions.delete(questionId);
      // Mark answered in SQLite
      const answerText = selectedLabel === "__custom__" && customText ? customText : selectedLabel;
      dbMarkQuestionAnswered(questionId, answerText);
      await logger.info("question-handler", `Answered question ${questionId}`, {
        selected: selectedLabel,
        custom: customText?.slice(0, 50),
      });
      return true;
    }

    await logger.error("question-handler", `Failed to reply to question ${questionId}`);
    return false;
  }

  /**
   * Check if a callback_data is for a question.
   */
  isQuestionCallback(callbackData: string): boolean {
    return callbackData.startsWith("q:");
  }

  /**
   * Parse question callback data.
   * Resolves short callback IDs back to full question IDs.
   */
  parseQuestionCallback(callbackData: string): { questionId: string; selectedLabel: string } | null {
    const parts = callbackData.split(":");
    if (parts.length < 3 || parts[0] !== "q") {
      return null;
    }
    const shortId = parts[1];
    const fullId = this.#resolveCallbackId(shortId);
    if (!fullId) {
      return null; // Unknown short ID (daemon restarted and mapping lost — question still in SQLite)
    }
    return {
      questionId: fullId,
      selectedLabel: parts.slice(2).join(":"), // Handle labels with colons
    };
  }

  /**
   * Get pending question by ID.
   */
  getPendingQuestion(questionId: string): PendingQuestion | undefined {
    return this.#pendingQuestions.get(questionId);
  }

  /**
   * Mark a question as awaiting custom text input.
   * The next text message in the murshid's channel will be used as the answer.
   */
  async markAwaitingCustomInput(huwiyyatMurshid: string, questionId: string): Promise<void> {
    this.#awaitingCustomInput.set(huwiyyatMurshid, questionId);
    // Persist state so we remember awaiting input after restart
    await this.saveState();
  }

  /**
   * Check if an murshid is awaiting custom input.
   */
  isAwaitingCustomInput(huwiyyatMurshid: string): boolean {
    return this.#awaitingCustomInput.has(huwiyyatMurshid);
  }

  /**
   * Handle a text message that might be a custom answer.
   * Returns true if the message was consumed as a custom answer.
   */
  async handlePotentialCustomAnswer(huwiyyatMurshid: string, text: string): Promise<boolean> {
    const questionId = this.#awaitingCustomInput.get(huwiyyatMurshid);
    if (!questionId) {
      return false;
    }

    // Clear the awaiting state
    this.#awaitingCustomInput.delete(huwiyyatMurshid);

    // Submit the custom answer
    const success = await this.handleQuestionCallback(questionId, "__custom__", text);

    if (success) {
      await logger.info("question-handler", `Received custom answer for ${questionId}`, {
        text: text.slice(0, 50),
      });
    }

    // Persist state after clearing awaiting input
    await this.saveState();

    return success;
  }

  // ===========================================================================
  // State Persistence (Resumability)
  // ===========================================================================

  /**
   * Save question handler state.
   * Questions are persisted to SQLite on insert (dbInsertQuestion) and on
   * answer (dbMarkQuestionAnswered), so this is a no-op kept for interface
   * compatibility with the daemon lifecycle.
   */
  async saveState(): Promise<void> {
    // No-op: SQLite writes happen inline in #forwardToDaemon and handleQuestionCallback
  }

  /**
   * Load question handler state from SQLite.
   * Called at daemon startup to restore pending questions.
   */
  async loadState(): Promise<void> {
    try {
      const dbQuestions = getUnansweredQuestions();
      
      if (dbQuestions.length === 0) {
        await logger.info("question-handler", "No pending questions found");
        return;
      }

      // Restore pending questions from SQLite
      this.#pendingQuestions.clear();
      for (const dbQ of dbQuestions) {
        // Reconstruct PendingQuestion from SQLite
        // Note: SQLite stores simplified version, in-memory has full structure
        const options = dbQ.options ? JSON.parse(dbQ.options) as string[] : [];

        // Resolve murshid identifier from session ID
        const murshid = this.#sessionManager.wajadaJalasātMurshid().find(
          (o) => o.id === dbQ.session_id
        );
        
        const pendingQuestion: PendingQuestion = {
          id: dbQ.id,
          sessionID: dbQ.session_id,
          huwiyyatMurshid: murshid?.identifier ?? dbQ.session_id,
          questions: [{
            question: dbQ.question,
            header: dbQ.question.slice(0, 30),
            options: options.map(label => ({ label, description: "" })),
          }],
          telegramMessageId: dbQ.telegram_message_id ?? undefined,
          createdAt: dbQ.created_at,
        };
        
        this.#pendingQuestions.set(dbQ.id, pendingQuestion);
        // Rebuild short callback ID mapping for Telegram buttons
        this.#shortCallbackId(dbQ.id);
      }

      // awaitingCustomInput is not persisted (short-lived state)
      this.#awaitingCustomInput.clear();

      await logger.info("question-handler", "Loaded question state", {
        pending: this.#pendingQuestions.size,
        awaitingInput: this.#awaitingCustomInput.size,
      });

      // Log details of pending questions for visibility
      if (this.#pendingQuestions.size > 0) {
        for (const [id, q] of this.#pendingQuestions) {
          await logger.info("question-handler", `Restored pending question: ${id}`, {
            murshid: q.huwiyyatMurshid,
            header: q.questions[0]?.header,
            createdAt: q.createdAt,
          });
        }
      }
    } catch (error) {
      await logger.error("question-handler", "Failed to load question state", {
        error: String(error),
      });
    }
  }

}

/**
 * Create a question handler instance.
 */
export function istadaaSail(deps: QuestionHandlerDeps): QuestionHandler {
  return new QuestionHandler(deps);
}
