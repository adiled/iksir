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
  hala?: string;
  wasm?: string[];
  ab?: string;
  qadr?: number;
  mayayir?: string[];
}

export interface AlaqatWasfa {
  yamnaa: string[];
  mamnu: string[];
}

export interface SijillWasfat {
  iqra(huwiyya: string): Promise<Wasfa | null>;

  bahath(nass: string, hadd?: number): Promise<Wasfa[]>;

  bihala(hala: string, hadd?: number): Promise<Wasfa[]>;

  khalaq(wasfa: Omit<Wasfa, "huwiyya"> & { huwiyya?: string }): Promise<Wasfa>;

  jaddid(huwiyya: string, taghyir: Partial<Omit<Wasfa, "huwiyya">>): Promise<Wasfa>;

  rabt(huwiyya: string, yamnaa?: string[], mamnu?: string[]): Promise<void>;

  alaqat(huwiyya: string): Promise<AlaqatWasfa>;
}
