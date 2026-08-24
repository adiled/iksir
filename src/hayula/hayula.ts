/**
 * Hayūlā (هيولى) — Prime Matter
 *
 * The formless substrate that receives form. The philosophers took the word
 * from the Greek hylē and meant by it the stuff beneath every particular
 * thing — that which is shaped, never the shape.
 *
 * Iksīr works upon a hayūlā and does not know what it is made of. A corpus
 * of runūz, a constitution, a lexicon under construction, a body of law —
 * each has vessels, each accumulates molten work, each has a codex that
 * drifts, and each can be inscribed.
 *
 * Nothing here names a branch, a commit, a remote, or a repository. Every
 * operation is stated as what it does to matter:
 *
 *   dakhala   enter a vessel
 *   waqif     which vessel holds us now
 *   asas      the foundation a vessel stands on
 *   mudtarib  is there molten work here, unsettled
 *   jammada   freeze what is molten, so a vessel may be left safely
 *   thabbata  fix what is molten into the vessel's substance
 *   sahaba    draw in what the codex has changed beneath us
 *   masafa    how far this vessel has drifted from the codex
 *   azhara    make the vessel visible beyond this workshop
 *   talaam    would these stones hold apart, and what else must come
 *   istahala  draw chosen matter out of a vessel onto a clean one
 *   naqasha   set a vessel into the codex, where it becomes canon
 *
 * An implementation that cannot do one of these says so by refusing. A
 * hayūlā with no outside has no azhara, and Iksīr must not assume it does.
 */

/** What became of an attempt to draw the codex in beneath a vessel. */
export interface NatijaSahb {
  najah: boolean;
  /** Matter that could not be reconciled and needs al-Kimyawi's hand. */
  taarudat?: string[];
  khata?: string;
}

/** Whether an extraction would hold, and what it still wants. */
export interface NatijaTalaum {
  /** Would these stones stand on their own? */
  yaqif: boolean;
  /** What else must be drawn across for them to hold. */
  yahtaj: string[];
  /** Why, where the matter can say. */
  bayan?: string;
}

/** What became of a transmutation. */
export interface NatijaIstihala {
  najah: boolean;
  khata?: string;
  nawKhata?: "taarud" | "dukhul" | "istirjaa" | "izhar" | "damj";
  taarudat?: string[];
  /** The vessel drawn from. */
  buwtaqa?: string;
  /** The vessel raised. */
  jawhar?: string;
  /** What it stands on — the codex, or a parent jawhar. */
  asas?: string;
  /** How much matter was drawn across. */
  adadAhjar?: number;
  makhrujat?: string;
}

export interface Hayula {
  /** Which kind of matter this is. */
  readonly naw: string;

  /** Enter a vessel, creating it upon the given foundation if absent. */
  dakhala(ina: string, asas?: string): Promise<boolean>;

  /** The vessel we stand in, or null if the matter has no such notion. */
  waqif(): Promise<string | null>;

  /** The foundation vessels are raised upon — the codex itself. */
  asas(): Promise<string>;

  /** Is there molten work here that has not been fixed? */
  mudtarib(): Promise<boolean>;

  /**
   * Freeze what is molten so the vessel may be left and returned to.
   * Not an inscription — a holding, undone or amended later without shame.
   */
  jammada(sabab: string): Promise<boolean>;

  /** Fix molten matter into the vessel's substance, with a reason. */
  thabbata(sabab: string, mawad?: string[]): Promise<boolean>;

  /** Draw in what the codex has changed beneath this vessel. */
  sahaba(ina?: string): Promise<NatijaSahb>;

  /** How far this vessel has drifted from the codex. */
  masafa(ina: string): Promise<number>;

  /**
   * Make the vessel visible beyond this workshop.
   *
   * Optional by nature: a hayūlā entirely local has no beyond, and Iksīr
   * must ask whether it can before assuming it does.
   */
  azhara?(ina: string, awwalMarra?: boolean): Promise<boolean>;

  /**
   * Talāʾum (تلاؤم) — would these stones hold apart from the crucible?
   *
   * The root is لأم: to fit together, what a wound does when it closes. An
   * extraction is rarely self-sufficient. A rule about vowel length leans on
   * an inventory of sounds still sitting in the crucible; a clause cites a
   * definition that did not travel with it. The jawhar looks whole and is
   * not.
   *
   * Asked before istiḥāla, and of the matter itself — only it knows what
   * its own pieces need. A hayūlā that cannot tell says so by answering
   * that it does not know, which is honest, and different from answering
   * that everything is fine.
   */
  talaam?(ahjar: string[], ina?: string): Promise<NatijaTalaum>;

  /**
   * Istiḥāla (استحالة) — draw chosen matter out of the crucible and set it
   * down on a vessel of its own, raised on clean foundation.
   *
   * Selecting matter out of an accumulation and re-founding it is real on
   * any hayūlā. How it is done is not, and never travels up here.
   *
   * @param jawhar the vessel to raise
   * @param ahjar  which matter to draw across
   * @param asas   what to raise it on; the codex when absent
   */
  istahala(jawhar: string, ahjar: string[], asas?: string): Promise<NatijaIstihala>;

  /**
   * Naqsh (نقش) — inscribe a vessel into the codex.
   *
   * The last act, and not the murshid's. What is inscribed becomes what the
   * matter says; everything before this was proposal.
   */
  naqasha(ina: string): Promise<boolean>;
}
