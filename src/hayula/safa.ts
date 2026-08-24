/**
 * Ṣafāʾ (صفاء) — Purity
 *
 * The cupel. The ore is set in bone-ash and driven with fire; the lead and
 * the base metals sink into the ash, and what stands in the middle when the
 * flame dies is gold, or there was never gold in it.
 *
 * The fire renders no opinion. It does not approve, and it leaves no
 * remark. The maʿāyīr are declared in the waṣfa before the work begins,
 * and afterward the matter has either withstood them or it has not.
 *
 * Ṣafāʾ comes before faṣl. A jawhar is not set before al-Kimyawī to be
 * judged — it is set before al-Kimyawī having already survived its fire.
 */

/** What the fire left. */
export interface NatijaSafa {
  /** Did the matter stand? */
  thabata: boolean;
  /** Which maʿāyīr it withstood. */
  ihtamala: string[];
  /** Which it did not, and what the fire said of each. */
  ihtaraq: Array<{ mayar: string; qawl: string }>;
}

export interface Safa {
  readonly naw: string;

  /**
   * Set the matter to its declared fire.
   *
   * @param mayayir the criteria of purity, as the waṣfa states them
   * @param ina     the vessel holding the matter to be tried
   */
  assa(mayayir: string[], ina?: string): Promise<NatijaSafa>;
}
