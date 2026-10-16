/**
 * Faṣl (فصل) — Decanting
 *
 * The clear essence is poured off the sediment and set before eyes that are
 * not the murshid's own. What comes back is judgement: it holds or it does
 * not, and things are said about it.
 *
 * Iksīr does not know where the jawhar is set down. A forge that opens
 * threads, a room of people, a single reader — each can receive a decanted
 * essence and return a verdict on it.
 *
 *   qaddama   set a jawhar before examination
 *   hala      what has become of it
 *   taaliqat  what has been said of it since a moment
 *   thabit    does it hold
 *   farq      what differs between a vessel and its foundation
 */

/** What has become of a decanted jawhar. */
export type HalatFasl = "manzur" | "maqbul" | "mardud" | "majhul";

/** A word said about a decanted jawhar. */
export interface TaaliqFasl {
  huwiyya: string;
  qail: string;
  nass: string;
  qila_fi: string;
  /** Where in the matter it was said, when it was said of a place. */
  mawdi?: string;
}

export interface MaalumatFasl {
  huwiyya: string;
  unwan: string;
  hala: HalatFasl;
  /** Whether the matter can settle onto its foundation without conflict. */
  yastaqirr: boolean;
  rabit?: string;
}

/** What differs between a vessel and what it stands on. */
export interface FarqFasl {
  amam: number;
  khalf: number;
  ahjar: number;
}

export interface Fasl {
  readonly naw: string;

  /** Set a jawhar before examination. Returns its huwiyya, or null. */
  qaddama(input: {
    unwan: string;
    matn: string;
    jawhar: string;
    asas: string;
    musawwada?: boolean;
  }): Promise<MaalumatFasl | null>;

  hala(huwiyya: string): Promise<MaalumatFasl | null>;

  /** What has been said since a moment, excluding al-Kimyawi's own words. */
  taaliqat(huwiyya: string, mundhu?: string): Promise<TaaliqFasl[]>;

  /** Does the matter hold under whatever trials this faculty applies? */
  thabit(huwiyya: string): Promise<boolean>;

  farq(asas: string, ina: string): Promise<FarqFasl | null>;
}
