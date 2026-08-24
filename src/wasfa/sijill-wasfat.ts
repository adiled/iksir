/**
 * Sijill al-Waṣfāt (سجل الوصفات) — The Register of Formulae
 *
 * A waṣfa is work to be done. It has a name, a statement of itself, and a
 * condition. That is the whole of it.
 *
 * The waṣfāt live here.
 */

/** A formula: work stated, and its condition. */
export interface Wasfa {
  huwiyya: string;
  unwan: string;
  matn?: string;
  /** Free words. */
  hala?: string;
  wasm?: string[];
  /** A waṣfa this one belongs under. */
  ab?: string;
  qadr?: number;
}

/** What one waṣfa waits on, and what waits on it. */
export interface AlaqatWasfa {
  yamnaa: string[];
  mamnu: string[];
}

export interface SijillWasfat {
  iqra(huwiyya: string): Promise<Wasfa | null>;

  /** Free-text search over names and statements. */
  bahath(nass: string, hadd?: number): Promise<Wasfa[]>;

  /** Waṣfāt in a given condition. */
  bihala(hala: string, hadd?: number): Promise<Wasfa[]>;

  /** Inscribe a new waṣfa. Mints a huwiyya when none is given. */
  khalaq(wasfa: Omit<Wasfa, "huwiyya"> & { huwiyya?: string }): Promise<Wasfa>;

  jaddid(huwiyya: string, taghyir: Partial<Omit<Wasfa, "huwiyya">>): Promise<Wasfa>;

  /** Bind what this waṣfa blocks, and what blocks it. */
  rabt(huwiyya: string, yamnaa?: string[], mamnu?: string[]): Promise<void>;

  alaqat(huwiyya: string): Promise<AlaqatWasfa>;
}
