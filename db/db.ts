/**
 * Sijill Iksīr (سجلّ الإكسير) — The Eternal Register
 *
 * Centralized state persistence using SQLite with WAL mode.
 * All state inscribed in a single iksir.sqlite file.
 *
 * Tables (lawhat — الألواح):
 *   jalasat          — الجلسات: murshid vessels
 *   qanawat          — القنوات: messaging conduits
 *   ahdath           — الأحداث: IPC event log
 *   asila            — الأسئلة: questions posed to al-Kimyawi
 *   qararat          — القرارات: decisions inscribed in the mudawwana
 *   ahwal_tanfidh    — أحوال التنفيذ: implementation states per wasfa
 *   matalib_muallaq  — المطالب المعلّقة: pending demands
 */

import { Database } from "@db/sqlite";
import { join } from "jsr:@std/path";
import { logger } from "../src/logging/logger.ts";


function masarHalatSijill(): string {
  return Deno.env.get("IKSIR_STATE_DIR") ??
    join(Deno.env.get("XDG_DATA_HOME") ?? join(Deno.env.get("HOME") ?? "/root", ".local", "share"), "iksir");
}

let db: Database | null = null;

function jalabSijill(): Database {
  if (!db) {
    throw new Error("Sijill not tahyiad. Call baddaaQaidatBayanat() first.");
  }
  return db;
}


/**
 * Initialize the SQLite sijill, create tables if needed, enable WAL mode.
 * Must be called once at startup before any other sijill function.
 * Fully idempotent — safe to call on every restart.
 */
export async function baddaaQaidatBayanat(): Promise<void> {
  const masarHala = masarHalatSijill();
  const masarSijill = join(masarHala, "iksir.sqlite");

  await Deno.mkdir(masarHala, { recursive: true });

  db = new Database(masarSijill);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");

  tatbiqSchema(db);

  await logger.akhbar("sijill", `SQLite tahyiad at ${masarSijill}`);
}

/**
 * Create all tables and indexes. Every statement is idempotent
 * (IF NOT EXISTS), so this is safe on first run and every restart.
 */
function tatbiqSchema(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  /** جلسات — murshid vessels */
  d.exec(`
    CREATE TABLE IF NOT EXISTS jalasat (
      id TEXT PRIMARY KEY,
      huwiyya TEXT NOT NULL,
      unwan TEXT,
      naw TEXT NOT NULL,
      hala TEXT NOT NULL,
      far TEXT,
      illa TEXT,
      unshia_fi TEXT NOT NULL,
      jaddad_fi TEXT NOT NULL,
      akhir_risala_fi TEXT,
      hala_mufassala TEXT
    )
  `);

  /** قنوات — messaging conduits */
  d.exec(`
    CREATE TABLE IF NOT EXISTS qanawat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      huwiyat_jalsa TEXT NOT NULL,
      muqaddim TEXT NOT NULL,
      huwiyat_qanat TEXT NOT NULL,
      unshia_fi TEXT NOT NULL,
      UNIQUE(huwiyat_jalsa, muqaddim)
    )
  `);

  /** أحداث — IPC event log */
  d.exec(`
    CREATE TABLE IF NOT EXISTS ahdath (
      id TEXT PRIMARY KEY,
      naw TEXT NOT NULL,
      ada TEXT NOT NULL,
      humulat TEXT NOT NULL,
      huwiyat_murshid TEXT,
      muaalaj INTEGER DEFAULT 0,
      unshia_fi TEXT NOT NULL
    )
  `);

  /** أسئلة — questions posed to al-Kimyawi */
  d.exec(`
    CREATE TABLE IF NOT EXISTS asila (
      id TEXT PRIMARY KEY,
      huwiyat_jalsa TEXT NOT NULL REFERENCES jalasat(id),
      sual TEXT NOT NULL,
      khiyarat TEXT,
      jawab TEXT,
      huwiyat_risala INTEGER,
      unshia_fi TEXT NOT NULL,
      ujiba_fi TEXT
    )
  `);

  /** قرارات — decisions inscribed in the mudawwana */
  d.exec(`
    CREATE TABLE IF NOT EXISTS qararat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      huwiyat_murshid TEXT NOT NULL,
      naw TEXT NOT NULL,
      qarar TEXT NOT NULL,
      mantiq TEXT NOT NULL,
      bayyanat TEXT,
      unshia_fi TEXT NOT NULL
    )
  `);

  /** أحوال التنفيذ — implementation states per wasfa */
  d.exec(`
    CREATE TABLE IF NOT EXISTS ahwal_tanfidh (
      huwiyat_wasfa TEXT PRIMARY KEY,
      huwiyat_murshid TEXT NOT NULL,
      hala TEXT NOT NULL,
      mulakhkhas TEXT,
      unshia_fi TEXT NOT NULL,
      jaddad_fi TEXT NOT NULL
    )
  `);

  /** المطالب المعلّقة — pending demands (one per murshid) */
  d.exec(`
    CREATE TABLE IF NOT EXISTS matalib_muallaq (
      huwiyat_murshid TEXT PRIMARY KEY,
      sabab TEXT NOT NULL,
      awwaliyya TEXT NOT NULL,
      tulib_fi TEXT NOT NULL
    )
  `);

  d.exec("CREATE INDEX IF NOT EXISTS idx_ahdath_kham ON ahdath(muaalaj, naw) WHERE muaalaj = 0");
  d.exec("CREATE INDEX IF NOT EXISTS idx_ahdath_unshia ON ahdath(unshia_fi)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_asila_jalsa ON asila(huwiyat_jalsa)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_asila_ghair_mujaba ON asila(huwiyat_jalsa) WHERE ujiba_fi IS NULL");
  d.exec("CREATE INDEX IF NOT EXISTS idx_qararat_murshid ON qararat(huwiyat_murshid)");
  d.exec("CREATE INDEX IF NOT EXISTS idx_qanawat_bahth ON qanawat(muqaddim, huwiyat_qanat)");

  d.prepare("INSERT OR IGNORE INTO schema_version VALUES (?, ?)").run(
    3,
    new Date().toISOString(),
  );
}

/**
 * Close the sijill connection. Call during ighlaaq.
 */
export function aghlaaqQaidatBayanat(): void {
  if (db) {
    db.close();
    db = null;
  }
}


/**
 * Insert an IPC hadath into the ahdath table.
 * Used by MCP servers to forward tool calls to the daemon.
 */
export function adkhalaHadath(
  naw: "pm",
  adaIsm: string,
  humulat: Record<string, unknown>,
  huwiyyatMurshid?: string,
): void {
  const d = jalabSijill();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  d.prepare(
    "INSERT INTO ahdath (id, naw, ada, humulat, huwiyat_murshid, muaalaj, unshia_fi) VALUES (?, ?, ?, ?, ?, 0, ?)",
  ).run(id, naw, adaIsm, JSON.stringify(humulat), huwiyyatMurshid ?? null, now);
}

/**
 * Get all unprocessed ahdath for a given naw, ordered by creation time.
 */
export function jalabaAhdathGhairMuaalaja(
  naw: "pm",
): Array<{ id: number; payload: string }> {
  const d = jalabSijill();

  const rows = d
    .prepare(
      "SELECT id, humulat AS payload FROM ahdath WHERE muaalaj = 0 AND naw = ? ORDER BY unshia_fi ASC",
    )
    .all(naw) as Array<{ id: string; payload: string }>;

  return rows as unknown as Array<{ id: number; payload: string }>;
}

/**
 * Mark a hadath as muaalaj by its id.
 */
export function allamaHadathMuaalaj(hadathId: number | string): void {
  const d = jalabSijill();
  d.prepare("UPDATE ahdath SET muaalaj = 1 WHERE id = ?").run(String(hadathId));
}


interface HujajIdkhalJalsa {
  id: string;
  huwiyya: string;
  unwan: string;
  naw: string;
  hala: string;
  far: string;
  illa?: string;
  unshiaFi: string;
  akhirRisalaFi: string;
  halaMufassala: Record<string, unknown>;
}

/**
 * Upsert a murshid jalsa. Creates or updates by primary key (id).
 */
export function haddathaAwAdkhalaJalsa(args: HujajIdkhalJalsa): void {
  const d = jalabSijill();
  d.prepare(`
    INSERT INTO jalasat (id, huwiyya, unwan, naw, hala, far, illa, unshia_fi, jaddad_fi, akhir_risala_fi, hala_mufassala)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      huwiyya = excluded.huwiyya,
      unwan = excluded.unwan,
      naw = excluded.naw,
      hala = excluded.hala,
      far = excluded.far,
      illa = excluded.illa,
      jaddad_fi = excluded.jaddad_fi,
      akhir_risala_fi = excluded.akhir_risala_fi,
      hala_mufassala = excluded.hala_mufassala
  `).run(
    args.id,
    args.huwiyya,
    args.unwan,
    args.naw,
    args.hala,
    args.far,
    args.illa ?? null,
    args.unshiaFi,
    new Date().toISOString(),
    args.akhirRisalaFi,
    JSON.stringify(args.halaMufassala),
  );
}

interface JalsaSijill {
  id: string;
  huwiyya: string;
  unwan: string | null;
  naw: string;
  hala: string;
  far: string | null;
  illa: string | null;
  unshia_fi: string;
  akhir_risala_fi: string | null;
  hala_mufassala: string | null;
}

/**
 * Get all murshid jalasat from the sijill.
 */
export function jalabaKullJalasat(): JalsaSijill[] {
  const d = jalabSijill();
  return d.prepare(
    "SELECT id, huwiyya, unwan, naw, hala, far, illa, unshia_fi, akhir_risala_fi, hala_mufassala FROM jalasat"
  ).all() as JalsaSijill[];
}


/**
 * Upsert a qanat for a murshid. One qanat per muqaddim per jalsa.
 */
export function haddathaAwAdkhalaQanat(
  huwiyatJalsa: string,
  muqaddim: string,
  huwiyatQanat: string,
): void {
  const d = jalabSijill();
  d.prepare(`
    INSERT INTO qanawat (huwiyat_jalsa, muqaddim, huwiyat_qanat, unshia_fi)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(huwiyat_jalsa, muqaddim) DO UPDATE SET
      huwiyat_qanat = excluded.huwiyat_qanat
  `).run(
    huwiyatJalsa,
    muqaddim,
    huwiyatQanat,
    new Date().toISOString(),
  );
}

/**
 * Get qanat ID for a murshid + muqaddim, or null if none.
 */
export function jalabaQanat(
  huwiyatJalsa: string,
  muqaddim: string,
): string | null {
  const d = jalabSijill();
  const row = d
    .prepare("SELECT huwiyat_qanat FROM qanawat WHERE huwiyat_jalsa = ? AND muqaddim = ?")
    .get(huwiyatJalsa, muqaddim) as { huwiyat_qanat: string } | undefined;
  return row?.huwiyat_qanat ?? null;
}

/**
 * Get all qanawat for a murshid as a Record<muqaddim, huwiyatQanat>.
 */
export function jalabaQanatsForSession(
  huwiyatJalsa: string,
): Record<string, string> {
  const d = jalabSijill();
  const rows = d
    .prepare("SELECT muqaddim, huwiyat_qanat FROM qanawat WHERE huwiyat_jalsa = ?")
    .all(huwiyatJalsa) as Array<{ muqaddim: string; huwiyat_qanat: string }>;

  const natija: Record<string, string> = {};
  for (const row of rows) {
    natija[row.muqaddim] = row.huwiyat_qanat;
  }
  return natija;
}

/**
 * Reverse lookup: find jalsa huwiyya by muqaddim + qanat ID.
 * Used for inbound message routing (Telegram topic → murshid).
 */
export function jalabJalsaByChannel(
  muqaddim: string,
  huwiyatQanat: string,
): string | null {
  const d = jalabSijill();
  const row = d
    .prepare("SELECT huwiyat_jalsa FROM qanawat WHERE muqaddim = ? AND huwiyat_qanat = ?")
    .get(muqaddim, huwiyatQanat) as { huwiyat_jalsa: string } | undefined;
  return row?.huwiyat_jalsa ?? null;
}

/**
 * Delete a qanat for a murshid.
 */
export function mahaqaQanat(
  huwiyatJalsa: string,
  muqaddim: string,
): void {
  const d = jalabSijill();
  d.prepare("DELETE FROM qanawat WHERE huwiyat_jalsa = ? AND muqaddim = ?")
    .run(huwiyatJalsa, muqaddim);
}


interface HujajIdkhalSual {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  telegramMessageId?: number;
}

/**
 * Insert a pending sual into the sijill.
 */
export function adkhalaSual(args: HujajIdkhalSual): void {
  const d = jalabSijill();
  d.prepare(`
    INSERT OR IGNORE INTO asila (id, huwiyat_jalsa, sual, khiyarat, huwiyat_risala, unshia_fi)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    args.id,
    args.sessionId,
    args.question,
    JSON.stringify(args.options),
    args.telegramMessageId ?? null,
    new Date().toISOString(),
  );
}

interface SualGhairMujabSijill {
  id: string;
  huwiyyatJalsa: string;
  sual: string;
  khiyarat: string | null;
  huwiyyatRisala: number | null;
  unshiaFi: string;
}

/**
 * Get all unanswered asila.
 */
export function jalabaAseilaGhairMujaba(): SualGhairMujabSijill[] {
  const d = jalabSijill();
  return d
    .prepare(
      "SELECT id, huwiyat_jalsa AS huwiyyatJalsa, sual, khiyarat, huwiyat_risala AS huwiyyatRisala, unshia_fi AS unshiaFi FROM asila WHERE ujiba_fi IS NULL",
    )
    .all() as SualGhairMujabSijill[];
}

/**
 * Mark a sual as answered in the sijill.
 */
export function allamaJawabSual(sualId: string, jawab: string): void {
  const d = jalabSijill();
  d.prepare(
    "UPDATE asila SET jawab = ?, ujiba_fi = ? WHERE id = ?",
  ).run(jawab, new Date().toISOString(), sualId);
}

/**
 * Update the huwiyat_risala for a sual (set after sending to Telegram).
 */
export function haddathaHuwiyyatRisalaSual(sualId: string, huwiyatRisala: number): void {
  const d = jalabSijill();
  d.prepare(
    "UPDATE asila SET huwiyat_risala = ? WHERE id = ?",
  ).run(huwiyatRisala, sualId);
}


interface HujajIdkhalQarar {
  huwiyyatMurshid: string;
  type: string;
  decision: string;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inscribe a qarar into the mudawwana.
 */
export function adhafaQararSijill(args: HujajIdkhalQarar): void {
  const d = jalabSijill();
  d.prepare(`
    INSERT INTO qararat (huwiyat_murshid, naw, qarar, mantiq, bayyanat, unshia_fi)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    args.huwiyyatMurshid,
    args.type,
    args.decision,
    args.reasoning,
    args.metadata ? JSON.stringify(args.metadata) : null,
    new Date().toISOString(),
  );
}


interface KhiyaratJalabQararatSijill {
  huwiyyatMurshid?: string;
  type?: string;
  search?: string;
  limit?: number;
  since?: string;
}

interface QararSijillMukhraja {
  id: number;
  huwiyat_murshid: string;
  type: string;
  decision: string;
  reasoning: string;
  metadata: string | null;
  created_at: string;
}

/**
 * Query qararat. Returns most recent first.
 * Supports filtering by murshid, naw, and free-text search.
 */
export function jalabaQararatSijill(opts: KhiyaratJalabQararatSijill = {}): QararSijillMukhraja[] {
  const d = jalabSijill();
  const shuroot: string[] = [];
  const mutathabirat: (string | number | null)[] = [];

  if (opts.huwiyyatMurshid) {
    shuroot.push("huwiyat_murshid = ?");
    mutathabirat.push(opts.huwiyyatMurshid);
  }
  if (opts.type) {
    shuroot.push("naw = ?");
    mutathabirat.push(opts.type);
  }
  if (opts.since) {
    shuroot.push("unshia_fi >= ?");
    mutathabirat.push(opts.since);
  }
  if (opts.search) {
    shuroot.push("(qarar LIKE ? OR mantiq LIKE ?)");
    const namat = `%${opts.search}%`;
    mutathabirat.push(namat, namat);
  }

  const haythu = shuroot.length > 0 ? `WHERE ${shuroot.join(" AND ")}` : "";
  const hadd = opts.limit ?? 20;
  mutathabirat.push(hadd);

  return d.prepare(
    `SELECT id, huwiyat_murshid, naw AS type, qarar AS decision, mantiq AS reasoning, bayyanat AS metadata, unshia_fi AS created_at
     FROM qararat ${haythu}
     ORDER BY unshia_fi DESC
     LIMIT ?`
  ).all(...mutathabirat) as QararSijillMukhraja[];
}


interface HujajIdkhalHalaTanfidh {
  huwiyyatWasfa: string;
  huwiyyatMurshid: string;
  status: string;
  summary?: string;
}

/**
 * Upsert tanfidh hala for a wasfa.
 */
export function naqshStatus(args: HujajIdkhalHalaTanfidh): void {
  const d = jalabSijill();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT INTO ahwal_tanfidh (huwiyat_wasfa, huwiyat_murshid, hala, mulakhkhas, unshia_fi, jaddad_fi)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(huwiyat_wasfa) DO UPDATE SET
      huwiyat_murshid = excluded.huwiyat_murshid,
      hala = excluded.hala,
      mulakhkhas = excluded.mulakhkhas,
      jaddad_fi = excluded.jaddad_fi
  `).run(
    args.huwiyyatWasfa,
    args.huwiyyatMurshid,
    args.status,
    args.summary ?? null,
    now,
    now,
  );
}

interface HalatTanfidhSijill {
  status: string;
  huwiyat_murshid: string;
  summary: string | null;
}

/**
 * Get tanfidh hala for a wasfa, or null if not found.
 */
export function qiraStatus(huwiyyatWasfa: string): HalatTanfidhSijill | null {
  const d = jalabSijill();
  const row = d
    .prepare(
      "SELECT hala AS status, huwiyat_murshid, mulakhkhas AS summary FROM ahwal_tanfidh WHERE huwiyat_wasfa = ?",
    )
    .get(huwiyyatWasfa) as HalatTanfidhSijill | undefined;

  return row ?? null;
}


interface MatlabMuallaq {
  huwiyat_murshid: string;
  reason: string;
  awwaliyya: string;
  demanded_at: string;
}

/**
 * Upsert a matlab muallaq (one per murshid).
 */
export function haddathaAwAdkhalaMatlabMuallaq(
  huwiyyatMurshid: string,
  sabab: string,
  awwaliyya: "normal" | "urgent",
): void {
  const d = jalabSijill();
  d.prepare(`
    INSERT INTO matalib_muallaq (huwiyat_murshid, sabab, awwaliyya, tulib_fi)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(huwiyat_murshid) DO UPDATE SET
      sabab = excluded.sabab,
      awwaliyya = excluded.awwaliyya,
      tulib_fi = excluded.tulib_fi
  `).run(huwiyyatMurshid, sabab, awwaliyya, new Date().toISOString());
}

/**
 * Remove a matlab muallaq (after fulfilled).
 */
export function mahaqaMatlabMuallaq(huwiyyatMurshid: string): void {
  const d = jalabSijill();
  d.prepare("DELETE FROM matalib_muallaq WHERE huwiyat_murshid = ?").run(huwiyyatMurshid);
}

/**
 * Get all matalib muallaqa, sorted by awwaliyya (urgent first) then time.
 */
export function jalabaMatalebMuallaq(): MatlabMuallaq[] {
  const d = jalabSijill();
  return d.prepare(
    `SELECT huwiyat_murshid, sabab AS reason, awwaliyya, tulib_fi AS demanded_at
     FROM matalib_muallaq
     ORDER BY
       CASE awwaliyya WHEN 'urgent' THEN 0 ELSE 1 END,
       tulib_fi ASC`
  ).all() as MatlabMuallaq[];
}
