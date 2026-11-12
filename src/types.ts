/**
 * Iksir Core Types
 *
 * Type definitions for the Iksir autonomous agent tansiq system.
 */

export interface TasmimIksir {
  khabath: TasmimKhabath;
  wasfat: TasmimWasfat;
  hum: TasmimHum;
  ahdaq: TasmimAhdaq;
}

export interface TasmimKhabath {
  majlis: string[];
  kur: string[];
  sijillat: string[];
  telegram?: TasmimTelegram;
  ntfy?: TasmimNtfy;
  [khabath: string]: unknown;
}

export interface ThulathiKhabath {
  majlis: string[];
  kur: string[];
  sijillat: string[];
}

export interface TasmimNtfy {
  topic?: string;
  server?: string;
}

export interface TasmimTelegram {
  muhadatha?: string;
  majmuua?: string;
  mawduuIrsal?: number;
  proxy?: string;
}

export interface TasmimWasfat {
  sabiqa?: string;
  namatWasfa?: string;
}

export interface TasmimAhdaq {
  mustawa?: MustawaSijill;
}

export type NawKiyan = "wasfa" | "malhamat" | "majhul";

export interface TasmimHum {
  namudhaj?: string;
}

export type AwwaliyyatIshara = "min" | "low" | "default" | "high" | "urgent";

export type SinfIshara =
  | "blocker"
  | "decision"
  | "progress"
  | "jawhar_mafsul"
  | "taaliqat"
  | "external_change"
  | "quiet_hours_exit";

export interface Ishara {
  sinf: SinfIshara;
  unwan: string;
  matn: string;
  awwaliyya: AwwaliyyatIshara;
  afaal?: FiilIshara[];
  url?: string;
  huwiyyatMashru?: string;
  huwiyyatWasfa?: string;
}

export interface FiilIshara {
  label: string;
  action: string;
  url?: string;
}

export interface TaqyimTaaliq {
  isCommand: boolean;
  intent: "command" | "suggestion" | "question" | "praise" | "concern" | "neutral";
  confidence: number;
  reasoning: string;
}

export type MustawaSijill = "debug" | "info" | "warn" | "error";

export interface MudkhalSijill {
  timestamp: Date;
  level: MustawaSijill;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface DecisionMudkhalSijill extends MudkhalSijill {
  event: string;
  interpretation: string;
  action: string;
  reasoning: string;
}

export interface MudkhalTaghyirKhariji extends MudkhalSijill {
  source: string;
  entityType: string;
  entityId: string;
  author: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  impact: string;
}

export interface JalsatHum {
  id: string;
  projectId: string;
  huwiyyatWasfa: string;
  title: string;
  status: "fail" | "sakin" | "error";
  createdAt: Date;
  lastMessageAt: Date;
  nestId?: string;
}

export interface HadathHum {
  type: string;
  properties: Record<string, unknown>;
  timestamp: Date;
}

export interface NidaKhalqWasfa {
  tool: "mun_khalaq_wasfa";
  huwiyyatMurshid: string;
  huwiyya?: string;
  unwan: string;
  wasf?: string;
  taqdir?: number;
  hala?: "triage" | "backlog";
  wasamat?: string[];
  huwiyyatAb?: string;
  mayayir?: string[];
  majlis?: string[];
  kur?: string[];
  sijillat?: string[];
}

export interface NidaTajdidWasfa {
  tool: "mun_jaddid_wasfa";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  updates: {
    unwan?: string;
    wasf?: string;
    taqdir?: number;
    hala?: string;
    mayayir?: string[];
    majlis?: string[];
    kur?: string[];
    sijillat?: string[];
  };
}

export interface NidaWadaaAlaqat {
  tool: "mun_wadaa_alaqat";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  yahjub?: string[];
  mahjoubBi?: string[];
}

export interface NidaQiraatWasfa {
  tool: "mun_iqra_wasfa";
  huwiyyatMurshid: string;
  huwiyya: string;
}

export interface NidaKhalqRisala {
  tool: "mun_khalaq_risala";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  unwan: string;
  matn: string;
  asas: string;
  ras: string;
}

export interface NidaTabligh {
  tool: "mun_balligh";
  huwiyyatMurshid: string;
  risala: string;
  awwaliyya: "min" | "low" | "default" | "high" | "urgent";
  afaal?: Array<{ label: string; action: string }>;
}

export interface NidaRadd {
  tool: "mun_radd";
  huwiyyatMurshid: string;
  risala: string;
}

export interface NidaSajjalQarar {
  tool: "mun_sajjal_qarar";
  huwiyyatMurshid: string;
  naw: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  qarar: string;
  mantiq: string;
  bayyanat?: Record<string, unknown>;
}

export interface NidaIqraMudawwana {
  tool: "mun_iqra_mudawwana";
  huwiyyatMurshid: string;
  murshidMuhaddad?: string;
  naw?: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  bahth?: string;
  hadd?: number;
  mundhu?: string;
}

export interface NidaTanazal {
  tool: "mun_tanazal";
  huwiyyatMurshid: string;
  sabab: "masdud" | "muntazir";
  tafasil: string;
  iqtarahTali?: string;
}

export interface NidaTalabTahakkum {
  tool: "mun_talab_tahakkum";
  huwiyyatMurshid: string;
  sabab: string;
  awwaliyya: "normal" | "urgent";
}

export interface NidaFasl {
  tool: "mun_fasl";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
  unwan: string;
  matn: string;
  musawwada?: boolean;
}

export interface NidaSafa {
  tool: "mun_safa";
  huwiyyatMurshid: string;
  huwiyyatWasfa: string;
}

export interface NidaShahada {
  tool: "mun_shahada";
  huwiyyatWasfa: string;
  naw: "safa" | "fasl" | "naqsh";
  natijat?: Array<{ mayar: string; kharaja: number; qawl: string }>;
  rabit?: string;
  huwiyya?: string;
  khata?: string;
}

export type MunToolCall =
  | NidaKhalqWasfa
  | NidaTajdidWasfa
  | NidaWadaaAlaqat
  | NidaQiraatWasfa
  | NidaKhalqRisala
  | NidaTabligh
  | NidaRadd
  | NidaSajjalQarar
  | NidaIqraMudawwana
  | NidaTanazal
  | NidaTalabTahakkum
  | NidaFasl
  | NidaSafa
  | NidaShahada;

export interface TaarifAla {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type MuaallijAla = (args: Record<string, unknown>) => Promise<string> | string;

export interface SijillAlat {
  sajjil(tool: TaarifAla, handler: MuaallijAla): void;

  adawat(): TaarifAla[];

  muaallijLi(name: string): MuaallijAla | undefined;

  naffidh(ism: string, hujaj: Record<string, unknown>): Promise<string>;

  yujad(name: string): boolean;

  muwassil(): (call: MunToolCall) => void;
}

export interface QararSijill {
  waqt: string;
  naw: "tadbir" | "tanfidh" | "tanfidh" | "hall" | "risala";
  qarar: string;
  mantiq: string;
  bayyanat?: Record<string, unknown>;
}

export interface MakhtutatSijill {
  ism: string;
  gharad: string;
  unshiaFi: string;
  matn?: string;
}

export interface HalatTanfidhSijill {
  hala: "pending" | "in_progress" | "complete" | "masdud";
  huwiyyatJalsa?: string;
  risala?: number;
  illa?: string;
}

export interface SijillMurshid {
  huwiyyatMalhamat: string;
  badaFi: string;
  qararat: QararSijill[];
  nusakhMunshaa: MakhtutatSijill[];
  halatTanfidh: Record<string, HalatTanfidhSijill>;
}

export type QanatRisala =
  | "dispatch"
  | "kimyawi"
  | { murshid: string };

export interface RasulKharij {
  mumakkan(): boolean;

  send(channel: QanatRisala, text: string): Promise<boolean>;

  arsalaMunassaq(channel: QanatRisala, text: string): Promise<boolean>;

  khalaqaQanatMurshid(identifier: string, title: string): Promise<string | null>;

  yamlikQanatMurshid(identifier: string): boolean;

  hammalQanawatLilJalsa(identifier: string): Record<string, string>;

  hallJalsaBilQanat(provider: string, channelId: string): string | null;
}

export type RisalaDakhila =
  | { naw: "murshid"; huwiyya: string; nass: string }
  | { naw: "irsal"; nass: string; huwiyyatRisala?: number }
  | { naw: "amr"; amr: string; wusut: string[] }
  | { naw: "ikhtiyar_munadi"; miftah: string }
  | { naw: "khass" };

export interface KhiyarTafauli {
  nass: string;
  miftah: string;
}

export interface Rasul extends RasulKharij {
  baddaa(): Promise<void>;

  awqaf(): void;

  indaRisala(handler: (risala: RisalaDakhila) => Promise<void>): void;

  arsalaSualBiKhiyarat(
    channel: QanatRisala,
    nass: string,
    khiyarat: KhiyarTafauli[],
  ): Promise<number | null>;

  tahaqqaq(): Promise<boolean>;
}

export type HalatMurshid = "sakin" | "fail" | "masdud" | "muntazir";

export type NawMurshid = "epic" | "chore" | "sandbox";

export interface JalsatMurshid {
  id: string;
  huwiyya: string;
  unwan: string;
  naw: NawMurshid;
  far: string;
  hala: HalatMurshid;
  illa?: string;
  unshiaFi: string;
  akhirRisalaFi: string;
  channels: Record<string, string>;
}

