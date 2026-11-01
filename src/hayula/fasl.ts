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

export interface TaaliqFasl {
  huwiyya: string;
  qail: string;
  nass: string;
  qila_fi: string;
  mawdi?: string;
}

export interface MaalumatFasl {
  huwiyya: string;
  unwan: string;
  hala: HalatFasl;
  yastaqirr: boolean;
  rabit?: string;
}

export interface FarqFasl {
  amam: number;
  khalf: number;
  ahjar: number;
}

export interface Fasl {
  readonly naw: string;

  qaddama(input: {
    unwan: string;
    matn: string;
    jawhar: string;
    asas: string;
    musawwada?: boolean;
  }): Promise<MaalumatFasl | null>;

  hala(huwiyya: string): Promise<MaalumatFasl | null>;

  taaliqat(huwiyya: string, mundhu?: string): Promise<TaaliqFasl[]>;

  thabit(huwiyya: string): Promise<boolean>;

  farq(asas: string, ina: string): Promise<FarqFasl | null>;
}
