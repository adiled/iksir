/**
 * The register of formulae, kept in the sijill.
 */

import { jalabSijill } from "../../db/db.ts";
import type { AlaqatWasfa, SijillWasfat, Wasfa } from "./sijill-wasfat.ts";

interface SafWasfa {
  huwiyya: string;
  unwan: string;
  matn: string | null;
  hala: string | null;
  wasm: string | null;
  ab: string | null;
  qadr: number | null;
}

function minSaf(saf: SafWasfa): Wasfa {
  return {
    huwiyya: saf.huwiyya,
    unwan: saf.unwan,
    matn: saf.matn ?? undefined,
    hala: saf.hala ?? undefined,
    wasm: saf.wasm ? JSON.parse(saf.wasm) : undefined,
    ab: saf.ab ?? undefined,
    qadr: saf.qadr ?? undefined,
  };
}

const AMUDA = "huwiyya, unwan, matn, hala, wasm, ab, qadr";

export class SijillWasfatMahalli implements SijillWasfat {
  #sabiqa: string;

  /**
   * @param sabiqa the mark a minted huwiyya carries. A workshop names its
   *   own formulae.
   */
  constructor(sabiqa = "W") {
    this.#sabiqa = sabiqa;
  }

  iqra(huwiyya: string): Promise<Wasfa | null> {
    const saf = jalabSijill()
      .prepare(`SELECT ${AMUDA} FROM wasfat WHERE huwiyya = ?`)
      .get(huwiyya) as SafWasfa | undefined;
    return Promise.resolve(saf ? minSaf(saf) : null);
  }

  bahath(nass: string, hadd = 20): Promise<Wasfa[]> {
    const namat = `%${nass}%`;
    const sufuf = jalabSijill()
      .prepare(
        `SELECT ${AMUDA} FROM wasfat
         WHERE unwan LIKE ? OR matn LIKE ? OR huwiyya LIKE ?
         ORDER BY jaddad_fi DESC LIMIT ?`,
      )
      .all(namat, namat, namat, hadd) as SafWasfa[];
    return Promise.resolve(sufuf.map(minSaf));
  }

  bihala(hala: string, hadd = 20): Promise<Wasfa[]> {
    const sufuf = jalabSijill()
      .prepare(
        `SELECT ${AMUDA} FROM wasfat WHERE hala = ? ORDER BY jaddad_fi DESC LIMIT ?`,
      )
      .all(hala, hadd) as SafWasfa[];
    return Promise.resolve(sufuf.map(minSaf));
  }

  /** Mint the next huwiyya in sequence — W-1, W-2, and so on. */
  #huwiyyaJadida(): string {
    const saf = jalabSijill()
      .prepare("SELECT COUNT(*) AS adad FROM wasfat")
      .get() as { adad: number };
    return `${this.#sabiqa}-${saf.adad + 1}`;
  }

  khalaq(wasfa: Omit<Wasfa, "huwiyya"> & { huwiyya?: string }): Promise<Wasfa> {
    const huwiyya = wasfa.huwiyya ?? this.#huwiyyaJadida();
    const alan = new Date().toISOString();
    jalabSijill()
      .prepare(
        `INSERT INTO wasfat (huwiyya, unwan, matn, hala, wasm, ab, qadr, unshia_fi, jaddad_fi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        huwiyya,
        wasfa.unwan,
        wasfa.matn ?? null,
        wasfa.hala ?? "khaam",
        wasfa.wasm ? JSON.stringify(wasfa.wasm) : null,
        wasfa.ab ?? null,
        wasfa.qadr ?? null,
        alan,
        alan,
      );
    return Promise.resolve({ ...wasfa, huwiyya, hala: wasfa.hala ?? "khaam" });
  }

  async jaddid(
    huwiyya: string,
    taghyir: Partial<Omit<Wasfa, "huwiyya">>,
  ): Promise<Wasfa> {
    const qaim = await this.iqra(huwiyya);
    if (!qaim) throw new Error(`no such wasfa: ${huwiyya}`);

    const baad: Wasfa = { ...qaim, ...taghyir, huwiyya };
    jalabSijill()
      .prepare(
        `UPDATE wasfat SET unwan = ?, matn = ?, hala = ?, wasm = ?, ab = ?, qadr = ?, jaddad_fi = ?
         WHERE huwiyya = ?`,
      )
      .run(
        baad.unwan,
        baad.matn ?? null,
        baad.hala ?? null,
        baad.wasm ? JSON.stringify(baad.wasm) : null,
        baad.ab ?? null,
        baad.qadr ?? null,
        new Date().toISOString(),
        huwiyya,
      );
    return baad;
  }

  rabt(huwiyya: string, yamnaa?: string[], mamnu?: string[]): Promise<void> {
    const d = jalabSijill();
    const rabit = d.prepare(
      "INSERT OR IGNORE INTO alaqat_wasfat (yamnaa, mamnu) VALUES (?, ?)",
    );
    for (const akhar of yamnaa ?? []) rabit.run(huwiyya, akhar);
    for (const akhar of mamnu ?? []) rabit.run(akhar, huwiyya);
    return Promise.resolve();
  }

  alaqat(huwiyya: string): Promise<AlaqatWasfa> {
    const d = jalabSijill();
    const yamnaa = d
      .prepare("SELECT mamnu FROM alaqat_wasfat WHERE yamnaa = ?")
      .all(huwiyya) as Array<{ mamnu: string }>;
    const mamnu = d
      .prepare("SELECT yamnaa FROM alaqat_wasfat WHERE mamnu = ?")
      .all(huwiyya) as Array<{ yamnaa: string }>;
    return Promise.resolve({
      yamnaa: yamnaa.map((r) => r.mamnu),
      mamnu: mamnu.map((r) => r.yamnaa),
    });
  }
}

export function anshaaSijillWasfat(sabiqa?: string): SijillWasfatMahalli {
  return new SijillWasfatMahalli(sabiqa);
}
