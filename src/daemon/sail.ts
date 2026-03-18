/**
 * Sail (سائل) - The Oracle
 * 
 * One of the sacred Khuddām (خدّام - Servants) of Iksīr.
 * Sail divines the nature of questions, separating dhahab (gold) from
 * khabath (dross). Only questions of true worth are brought before the
 * Kimyawi (the Human Alchemist).
 */

/**
 * Question Handler
 *
 * Handles question.asked events from OpenCode SSE.
 * Mayyiz questions as dhahab (forward to al-Kimyawi) or khabath (auto-answer).
 *
 * Similar to pm_notify filtering in tool-executor, but for the
 * question tool which presents MCQ-style decisions.
 */

import { logger } from "../logging/logger.ts";
import { OpenCodeClient } from "../opencode/client.ts";
import {
  adkhalaSual as dbInsertQuestion,
  jalabaAseilaGhairMujaba,
  allamaJawabSual as dbMarkJawabSualed,
} from "../../db/db.ts";
import { mayyazaSual } from "./mumayyiz.ts";
import type { MudirJalasat } from "./katib.ts";
import type {
  HadathSualMatlub,
  MaalumatSual,
  JawabSual,
  TasnifSual,
  SualMuallaq,
  RasulKharij,
} from "../types.ts";



interface SailDeps {
  opencode: OpenCodeClient;
  messenger: RasulKharij;
  sessionManager: MudirJalasat;
}

export class Sail {
  #opencode: OpenCodeClient;
  #messenger: RasulKharij;
  #sessionManager: MudirJalasat;

  aseilaMuallaqa: Map<string, SualMuallaq> = new Map();

  kharitaIstijabaId: Map<string, string> = new Map();

  yantazirIdkhalKhass: Map<string, string> = new Map();

  indaTahwilSual: ((pending: SualMuallaq, question: MaalumatSual) => Promise<void>) | null = null;

  /**
   * Set callback for transport-specific question rendering.
   * Called after a question is forwarded to al-Kimyawi via messenger.
   */
  wadaaIndaTahwilSual(
    callback: (pending: SualMuallaq, question: MaalumatSual) => Promise<void>,
  ): void {
    this.indaTahwilSual = callback;
  }

  /**
   * Generate a short callback ID (8 chars) for Telegram callback_data
   * and register the mapping to the full question ID.
   */
  ikhtisarIdIstijaba(questionId: string): string {
    const short = questionId.replace(/-/g, "").slice(0, 8);
    this.kharitaIstijabaId.set(short, questionId);
    return short;
  }

  /**
   * Resolve a short callback ID back to the full question ID.
   */
  hallaIdIstijaba(shortId: string): string | null {
    return this.kharitaIstijabaId.get(shortId) ?? null;
  }

  constructor(deps: SailDeps) {
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
    this.#sessionManager = deps.sessionManager;
  }

  /**
   * Handle a question.asked event from OpenCode SSE.
   * Mayyiz the question and either auto-answers or forwards to al-Kimyawi.
   */
  async aalajSualMatlub(event: HadathSualMatlub): Promise<void> {
    const { id, sessionID, questions } = event.properties;

    await logger.akhbar("question-handler", `Received question ${id}`, {
      sessionID,
      questionCount: questions.length,
    });

    /** Find which murshid this session belongs to */
    const murshid = this.#sessionManager.wajadaJalasatMurshid().find(
      (o) => o.id === sessionID
    );

    if (!murshid) {
      await logger.haDHHir("question-handler", `Question from unknown session ${sessionID}`);
      await this.#opencode.rejectQuestion(sessionID, id);
      return;
    }

    /**
     * Mayyiz each question (for now, treat all questions in batch as one)
     * Take the first question as representative (most question calls have 1 question)
     */
    const primaryQuestion = questions[0];
    if (!primaryQuestion) {
      await logger.haDHHir("question-handler", `Question ${id} has no questions array`);
      await this.#opencode.rejectQuestion(sessionID, id);
      return;
    }

    const tamyiz = await mayyazaSual(this.#opencode, primaryQuestion);

    await logger.akhbar("question-handler", `Tamyiz: ${tamyiz.tamyiz}`, {
      reason: tamyiz.reason,
      questionHeader: primaryQuestion.header,
    });

    if (tamyiz.tamyiz === "KHABATH") {
      await this.aalajKhabath(sessionID, id, questions, tamyiz);
    } else {
      await this.hawwalIlaKhadim(sessionID, id, questions, murshid.huwiyya);
    }
  }

  /**
   * Handle khabath: auto-answer and inject guidance.
   */
  async aalajKhabath(
    sessionID: string,
    questionId: string,
    questions: MaalumatSual[],
    tamyiz: TasnifSual
  ): Promise<void> {
    /** Build auto-answers */
    const answers: JawabSual[] = questions.map((q, index) => {
      /** Find the recommended option or use autoAnswer from tamyiz */
      let selectedLabel: string;

      if (tamyiz.autoAnswer) {
        selectedLabel = tamyiz.autoAnswer;
      } else {
        /** Find option marked as "(Recommended)" or pick first */
        const recommended = q.options.find((o) => o.label.includes("(Recommended)"));
        selectedLabel = recommended?.label ?? q.options[0]?.label ?? "";
      }

      return {
        questionIndex: index,
        selected: selectedLabel ? [selectedLabel] : [],
      };
    });

    /** Reply with auto-answer */
    const replied = await this.#opencode.replyToQuestion(sessionID, questionId, answers);

    if (replied) {
      await logger.akhbar("question-handler", `Auto-answered question ${questionId}`, {
        autoAnswer: tamyiz.autoAnswer,
      });
    } else {
      await this.#opencode.rejectQuestion(sessionID, questionId);
      await logger.haDHHir("question-handler", `Failed to auto-answer, rejected ${questionId}`);
    }

    /** Inject guidance as follow-up message */
    const guidance = `Your question was auto-answered. Reason: ${tamyiz.reason}

${tamyiz.rejection ?? "Proceed autonomously using your judgment."}

Auto-selected: ${answers.map((a) => a.selected.join(", ")).join("; ")}`;

    await this.#opencode.sendPromptAsync(sessionID, guidance);
  }

  /**
   * Forward dhahab to al-Kimyawi via messenger.
   * Sends formatted text. Transport-specific rendering (inline keyboards)
   * is handled by the onQuestionForwarded callback if set.
   */
  async hawwalIlaKhadim(
    sessionID: string,
    questionId: string,
    questions: MaalumatSual[],
    huwiyyatMurshid: string,
  ): Promise<void> {
    /** Store as pending */
    const pending: SualMuallaq = {
      id: questionId,
      sessionID,
      huwiyyatMurshid,
      questions,
      createdAt: new Date().toISOString(),
    };
    this.aseilaMuallaqa.set(questionId, pending);

    /** Persist to SQLite immediately so we don't lose pending questions on crash */
    const primaryQuestion = questions[0];
    dbInsertQuestion({
      id: questionId,
      sessionId: sessionID,
      question: primaryQuestion?.question ?? "",
      options: primaryQuestion?.options.map(o => o.label) ?? [],
    });

    /** Build question text */
    const messageText = this.nassaqRisalatSual(primaryQuestion!, huwiyyatMurshid);

    await this.#messenger.arsalaMunassaq({ murshid: huwiyyatMurshid }, messageText);

    if (this.indaTahwilSual) {
      await this.indaTahwilSual(pending, primaryQuestion!);
    }

    await logger.akhbar("question-handler", `Forwarded question ${questionId}`, {
      huwiyyatMurshid,
    });
  }

  /**
   * Format a question for Telegram display.
   */
  nassaqRisalatSual(question: MaalumatSual, huwiyyatMurshid: string): string {
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
  banaMafatihSatriyya(
    questionId: string,
    question: MaalumatSual
  ): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    /**
     * Use short 8-char ID to stay within Telegram's 64-byte callback_data limit.
     * Format: "q:{8}:{label}" — 11 chars overhead, leaving 53 for label.
     */
    const shortId = this.ikhtisarIdIstijaba(questionId);
    const maxLabelLen = 64 - 2 - shortId.length - 1;

    for (const opt of question.options) {
      const shortLabel = opt.label.slice(0, maxLabelLen);
      rows.push([
        {
          text: opt.label,
          callback_data: `q:${shortId}:${shortLabel}`,
        },
      ]);
    }

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
  async aalajIstijabaZirrSual(
    questionId: string,
    selectedLabel: string,
    customText?: string
  ): Promise<boolean> {
    const pending = this.aseilaMuallaqa.get(questionId);
    if (!pending) {
      await logger.haDHHir("question-handler", `No pending question for callback ${questionId}`);
      return false;
    }

    /** Build answer */
    const answers: JawabSual[] = pending.questions.map((_, index) => ({
      questionIndex: index,
      selected: selectedLabel === "__custom__" && customText ? [] : [selectedLabel],
      custom: selectedLabel === "__custom__" ? customText : undefined,
    }));

    /** Reply to OpenCode */
    const replied = await this.#opencode.replyToQuestion(
      pending.sessionID,
      questionId,
      answers
    );

    if (replied) {
      this.aseilaMuallaqa.delete(questionId);
      /** Mark answered in SQLite */
      const answerText = selectedLabel === "__custom__" && customText ? customText : selectedLabel;
      dbMarkJawabSualed(questionId, answerText);
      await logger.akhbar("question-handler", `Answered question ${questionId}`, {
        selected: selectedLabel,
        custom: customText?.slice(0, 50),
      });
      return true;
    }

    await logger.sajjalKhata("question-handler", `Failed to reply to question ${questionId}`);
    return false;
  }

  /**
   * Check if a callback_data is for a question.
   */
  huwaIstijabaZirrSual(callbackData: string): boolean {
    return callbackData.startsWith("q:");
  }

  /**
   * Parse question callback data.
   * Resolves short callback IDs back to full question IDs.
   */
  hallalIstijabaZirrSual(callbackData: string): { questionId: string; selectedLabel: string } | null {
    const parts = callbackData.split(":");
    if (parts.length < 3 || parts[0] !== "q") {
      return null;
    }
    const shortId = parts[1];
    const fullId = this.hallaIdIstijaba(shortId);
    if (!fullId) {
      return null;
    }
    return {
      questionId: fullId,
      selectedLabel: parts.slice(2).join(":"),
    };
  }

  /**
   * Get pending question by ID.
   */
  wajadaSualMuallaq(questionId: string): SualMuallaq | undefined {
    return this.aseilaMuallaqa.get(questionId);
  }

  /**
   * Mark a question as awaiting custom text input.
   * The next text message in the murshid's channel will be used as the answer.
   */
  async allamIntizarIdkhal(huwiyyatMurshid: string, questionId: string): Promise<void> {
    this.yantazirIdkhalKhass.set(huwiyyatMurshid, questionId);
    await this.hafizaHala();
  }

  /**
   * Check if an murshid is awaiting custom input.
   */
  huwaYantazirIdkhal(huwiyyatMurshid: string): boolean {
    return this.yantazirIdkhalKhass.has(huwiyyatMurshid);
  }

  /**
   * Handle a text message that might be a custom answer.
   * Returns true if the message was consumed as a custom answer.
   */
  async aalajJawabKhass(huwiyyatMurshid: string, text: string): Promise<boolean> {
    const questionId = this.yantazirIdkhalKhass.get(huwiyyatMurshid);
    if (!questionId) {
      return false;
    }

    this.yantazirIdkhalKhass.delete(huwiyyatMurshid);

    /** Submit the custom answer */
    const success = await this.aalajIstijabaZirrSual(questionId, "__custom__", text);

    if (success) {
      await logger.akhbar("question-handler", `Received custom answer for ${questionId}`, {
        text: text.slice(0, 50),
      });
    }

    await this.hafizaHala();

    return success;
  }


  /**
   * Save question handler state.
   * Questions are persisted to SQLite on insert (dbInsertQuestion) and on
   * answer (dbMarkJawabSualed), so this is a no-op kept for interface
   * compatibility with the daemon lifecycle.
   */
  async hafizaHala(): Promise<void> {
  }

  /**
   * Load question handler state from SQLite.
   * Called at daemon startup to istarjaa pending questions.
   */
  async hammalaHala(): Promise<void> {
    try {
      const dbQuestions = jalabaAseilaGhairMujaba();
      
      if (dbQuestions.length === 0) {
        await logger.akhbar("question-handler", "No pending questions found");
        return;
      }

      this.aseilaMuallaqa.clear();
      for (const dbQ of dbQuestions) {
        /**
         * Reconstruct SualMuallaq from SQLite
         * Note: SQLite stores simplified version, in-memory has full structure
         */
        const options = dbQ.khiyarat ? JSON.parse(dbQ.khiyarat) as string[] : [];

        /** Resolve murshid identifier from session ID */
        const murshid = this.#sessionManager.wajadaJalasatMurshid().find(
          (o) => o.id === dbQ.huwiyyatJalsa
        );
        
        const pendingQuestion: SualMuallaq = {
          id: dbQ.id,
          sessionID: dbQ.huwiyyatJalsa,
          huwiyyatMurshid: murshid?.huwiyya ?? dbQ.huwiyyatJalsa,
          questions: [{
            question: dbQ.sual,
            header: dbQ.sual.slice(0, 30),
            options: options.map(label => ({ label, description: "" })),
          }],
          telegramMessageId: dbQ.huwiyyatRisala ?? undefined,
          createdAt: dbQ.unshiaFi,
        };
        
        this.aseilaMuallaqa.set(dbQ.id, pendingQuestion);
        this.ikhtisarIdIstijaba(dbQ.id);
      }

      this.yantazirIdkhalKhass.clear();

      await logger.akhbar("question-handler", "Loaded question state", {
        pending: this.aseilaMuallaqa.size,
        awaitingInput: this.yantazirIdkhalKhass.size,
      });

      if (this.aseilaMuallaqa.size > 0) {
        for (const [id, q] of this.aseilaMuallaqa) {
          await logger.akhbar("question-handler", `Restored pending question: ${id}`, {
            murshid: q.huwiyyatMurshid,
            header: q.questions[0]?.header,
            createdAt: q.createdAt,
          });
        }
      }
    } catch (error) {
      await logger.sajjalKhata("question-handler", "Failed to load question state", {
        error: String(error),
      });
    }
  }

}

/**
 * Create a question handler instance.
 */
export function istadaaSail(deps: SailDeps): Sail {
  return new Sail(deps);
}
