/**
 * Sijill al-Waṣfāt (سجل الوصفات) — The Register of Formulae
 *
 * A waṣfa is work to be done. It has a name, a statement of itself, a
 * condition, and its three khabath — where it is spoken of (majlis), where
 * its jawhar is decanted (kur), and which outer trackers it answers to
 * (sijillat) — each drawn from al-Kimyawī's roster.
 *
 * The waṣfāt live here.
 */

export interface Wasfa {
  huwiyya: string;
  unwan: string;
  matn?: string;
  hala?: string;
  wasm?: string[];
  ab?: string;
  qadr?: number;
  mayayir?: string[];
  majlis?: string[];
  kur?: string[];
  sijillat?: string[];
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
