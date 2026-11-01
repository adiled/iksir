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
  taarudat?: string[];
  khata?: string;
}

export interface NatijaTalaum {
  yaqif: boolean;
  yahtaj: string[];
  bayan?: string;
}

export interface NatijaIstihala {
  najah: boolean;
  khata?: string;
  nawKhata?: "taarud" | "dukhul" | "istirjaa" | "izhar" | "damj";
  taarudat?: string[];
  buwtaqa?: string;
  jawhar?: string;
  asas?: string;
  adadAhjar?: number;
  makhrujat?: string;
}

export interface Hayula {
  readonly naw: string;

  dakhala(ina: string, asas?: string): Promise<boolean>;

  waqif(): Promise<string | null>;

  asas(): Promise<string>;

  mudtarib(): Promise<boolean>;

  jammada(sabab: string): Promise<boolean>;

  thabbata(sabab: string, mawad?: string[]): Promise<boolean>;

  sahaba(ina?: string): Promise<NatijaSahb>;

  masafa(ina: string): Promise<number>;

  azhara?(ina: string, awwalMarra?: boolean): Promise<boolean>;

  talaam?(ahjar: string[], ina?: string): Promise<NatijaTalaum>;

  istahala(jawhar: string, ahjar: string[], asas?: string): Promise<NatijaIstihala>;

  naqasha(ina: string): Promise<boolean>;
}
