import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, assertEquals } from "../src/ikhtibar.ts";

export interface Taaliq {
  bidaya: number;
  nihaya: number;
  satr: number;
  nass: string;
  rasMilaff: boolean;
}

const QABLA_NAMAT = new Set("(,=:[!&|?{};+-*%<>~^");
const KALIMAT_QABLA_NAMAT = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

export function iqraTaaliqat(masdar: string): Taaliq[] {
  const taaliqat: Taaliq[] = [];
  let i = 0;
  let satr = 1;
  let kalamBaad = false;
  let akhirRamz = "";
  let akhirKalima = "";
  const n = masdar.length;

  const tasjil = (bidaya: number, nihaya: number, satrBidaya: number): void => {
    taaliqat.push({ bidaya, nihaya, satr: satrBidaya, nass: masdar.slice(bidaya, nihaya), rasMilaff: !kalamBaad });
  };

  const namatYajuz = (): boolean =>
    !kalamBaad || akhirRamz === "" || QABLA_NAMAT.has(akhirRamz) || (/[A-Za-z_$]/.test(akhirRamz) && KALIMAT_QABLA_NAMAT.has(akhirKalima));

  const qalib = (): void => {
    i++;
    while (i < n) {
      const c = masdar[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") satr++;
      if (c === "`") { i++; return; }
      if (c === "$" && masdar[i + 1] === "{") {
        i += 2;
        let umq = 1;
        while (i < n && umq > 0) {
          const d = masdar[i];
          if (d === "{") umq++;
          else if (d === "}") umq--;
          else if (d === "`") { qalib(); continue; }
          else if (d === "'" || d === '"') { nass(d); continue; }
          else if (d === "\n") satr++;
          if (umq > 0) i++;
        }
        i++;
        continue;
      }
      i++;
    }
  };

  const nass = (hadd: string): void => {
    i++;
    while (i < n && masdar[i] !== hadd && masdar[i] !== "\n") {
      if (masdar[i] === "\\") i++;
      i++;
    }
    i++;
  };

  const namat = (): void => {
    i++;
    let fiQaws = false;
    while (i < n && masdar[i] !== "\n") {
      const c = masdar[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "[") fiQaws = true;
      else if (c === "]") fiQaws = false;
      else if (c === "/" && !fiQaws) { i++; break; }
      i++;
    }
    while (i < n && /[a-z]/.test(masdar[i])) i++;
  };

  while (i < n) {
    const c = masdar[i];
    if (c === "\n") { satr++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && masdar[i + 1] === "/") {
      const bidaya = i;
      while (i < n && masdar[i] !== "\n") i++;
      tasjil(bidaya, i, satr);
      continue;
    }
    if (c === "/" && masdar[i + 1] === "*") {
      const bidaya = i;
      const satrBidaya = satr;
      i += 2;
      while (i < n && !(masdar[i] === "*" && masdar[i + 1] === "/")) {
        if (masdar[i] === "\n") satr++;
        i++;
      }
      i += 2;
      tasjil(bidaya, i, satrBidaya);
      continue;
    }
    kalamBaad = true;
    if (c === "`") { qalib(); akhirRamz = "`"; continue; }
    if (c === "'" || c === '"') { nass(c); akhirRamz = c; continue; }
    if (c === "/" && namatYajuz()) { namat(); akhirRamz = "/"; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      const bidaya = i;
      while (i < n && /[A-Za-z0-9_$]/.test(masdar[i])) i++;
      akhirKalima = masdar.slice(bidaya, i);
      akhirRamz = akhirKalima[akhirKalima.length - 1];
      continue;
    }
    akhirRamz = c;
    i++;
  }
  return taaliqat;
}

export function khabathFi(masdar: string): Taaliq[] {
  return iqraTaaliqat(masdar).filter((t) => !t.rasMilaff);
}

export function milaffatAlKalam(judhur: string[]): string[] {
  const natija: string[] = [];
  const imshi = (dir: string): void => {
    for (const ism of readdirSync(dir)) {
      const masar = join(dir, ism);
      if (statSync(masar).isDirectory()) imshi(masar);
      else if (ism.endsWith(".ts")) natija.push(masar);
    }
  };
  for (const j of judhur) imshi(j);
  return natija.sort();
}

test("kalam: a comment is read where it is, and not inside a string, template or regex", () => {
  const masdar = [
    "/** the header, which may speak */",
    "// and a second header line",
    'const url = "https://x/y"; const t = `a // b ${"c /* d */"} e`;',
    "const r = /\\/\\/[a-z]*/g; const q = a / b / c;",
    "let k = 1; // trailing",
    "/* block */ let m = 2;",
  ].join("\n");
  const kull = iqraTaaliqat(masdar);
  assertEquals(kull.filter((t) => t.rasMilaff).length, 2);
  assertEquals(khabathFi(masdar).map((t) => [t.satr, t.nass]), [[5, "// trailing"], [6, "/* block */"]]);
});

test("kalam: code is speech — nothing but the module header speaks in prose", () => {
  const judhur = ["src", "db", "hives", "tests"].map((d) => join(import.meta.dirname, "..", d));
  const khabath: string[] = [];
  for (const milaff of milaffatAlKalam(judhur)) {
    for (const t of khabathFi(readFileSync(milaff, "utf-8"))) {
      khabath.push(`${milaff.slice(milaff.indexOf("/iksir/") + 7)}:${t.satr}: ${t.nass.split("\n")[0].trim()}`);
    }
  }
  assertEquals(khabath, []);
});
