# Iksīr الإكسير

**Iksīr - The Elixir of Transformation**

In the depths where sulfur meets mercury, where base metal yearns for gold, there exists an ancient art. Not the frantic bubbling of a thousand crucibles, but the patient work of a single athanor, tended with wisdom.

Iksīr is the philosopher's stone of code - an alchemical system where transformation happens through **transmutation, not chaos**. Multiple alchemists may prepare their formulae, each in their own vessel, but only one performs the Great Work at a time. When blocked by the mysteries of nature, they yield. When revelation comes, they demand the flame.

This is not weakness. This is the Way. The ancients knew: ten furnaces burning wild produce only smoke. One furnace, properly tended, produces gold.

The modern world has forgotten the scent of real alchemy - the sharp bite of sulfur, the cold kiss of mercury, the moment when chaos crystallizes into perfection. They pile process upon process, thinking motion equals progress. Iksīr remembers the old ways: one transformation, complete and perfect, then the next.

**Munadi calls.** Not over the noise of the marketplace, but once, with clarity, summoning the alchemists to their sacred work.

---

## Al-Takwīn — Setting Up

Iksīr is a [hum](https://github.com/adiled/hum) hive. It speaks thrum through hum's own client, so hum's source sits beside it. Prerequisites: Node 22+ (no npm — nothing is installed), hum 0.35 or later with its `humd` running, the `bash` hive (the murshidūn's hands), and a nurse advertising the model you will name.

```bash
git clone --depth 1 https://github.com/adiled/hum
git clone https://github.com/adiled/iksir
cd iksir
node src/cli.ts init          # the majlis, the roster, the nest — sets ~/.config/iksir/{iksir.json,asrar}
hum hive "$PWD" install       # build, test, and hand the daemon and saail to orchd
```

`init` walks you through a Telegram bot (BotFather), your direct chat, and a forum group with a **Dispatch** topic; the bot must be an admin there, since it opens a topic for every murshid. It sets only what it asks; whatever else the files hold stands.

**Settings and secrets are two files, read again the moment they change.** Nothing is read from the environment, nothing restarts:

```bash
iksir config                                  # as the daemon sees it now
iksir config set khabath.kur github,gitlab    # the daemon uses it on its next act
iksir config set hum.namudhaj claude-opus-5-5
iksir secret set telegram.ramz                # from stdin or a hidden prompt, never argv; kept 0600
```

The whole of `~/.config/iksir/iksir.json`:

```json
{
  "khabath": {
    "majlis":   ["telegram"],
    "kur":      ["github"],
    "sijillat": ["github"],
    "telegram": { "muhadatha": "…", "majmuua": "…", "mawduuIrsal": 2 }
  },
  "hum": { "namudhaj": "claude-opus-5-5" }
}
```

**Khabath** (خبث) is everything outside the Sijill, named by role, as your host CLI or [web2](https://github.com/adiled/hum/tree/main/hives/web2) calls it — a roster, each role one or more:

- **majlis** — where al-Kimyawī speaks. Telegram.
- **kūr** — the forges where jawhar is decanted and inscribed: `github`, `gitlab`, …
- **sijillāt** — the outer trackers tickets come from and are reflected back to: `github`, `linear`, …

Every waṣfa carries its own three, drawn from the roster: ʿĀlim marks a ticket with the sijill it came from, a murshid may narrow a waṣfa to one forge, and nothing outside the roster is ever a forge, a hall or a tracker for any waṣfa — `linear-server` cannot be mistaken for a forge, because it is not in `kur`. Say what the work is in Dispatch and ʿĀlim inscribes it on the spot — `Inscribed W-13 — <your words>. Say go.` — no name asked, no ID begged. Say "what's issue 9 about" and ʿĀlim reads it with `gh` and inscribes it as `GH-9` answering to `github`. Either way, "go" summons a murshid for the waṣfa just inscribed.

**The workshop** is the host. There is no enclosure: the `bash` hive lends the murshidūn the builder's whole reach, their shell opens at home, and the waṣfa, the ticket it came from, and your Ta'lim tell them where the furnace stands. Lend a host you mean to lend.

```bash
hum hive "$PWD" install       # again, after a pull: rebuilds and regrows; a .env from before 2.0 is carried into iksir.json and asrar, and removed
node src/cli.ts check         # nestle and report what answers
hum bee --list                # the five bees, nestled
tail -f ~/.local/state/hum/hives/iksir/orch/logs/iksir.log   # saail.log beside it
```

```
~/.config/iksir/iksir.json     settings; asrar (0600) and AGENTS.md beside it
~/.local/share/iksir/          Sijill — the register (SQLite)
~/.local/state/iksir/          the scrolls of observation (logs)
```

Nothing of Iksīr's needs tending afterwards. What it will ever need: catching up to a new thrum, which lives in one file (`src/hum/wasila.ts`, the only place `thrum` is imported), and tuning the ruqan in `prompts/`.

---

## Amal Kabir - The Great Work

Iksīr transmutes raw **waṣfāt** (وصفات - formulae) into perfected **dhahab** (ذهب - gold) - the Murshidūn (guides) laboring at their crucibles while you attend to higher mysteries.

- **Inā'** (إناء - Vessels): Each murshid works in its own vessel, on its own branch, in the one workshop
- **Al-Ṣafāʾ** (الصفاء - The Fire): A waṣfa declares its maʿāyīr before the work; the jawhar withstands them or it does not, and no murshid grades its own
- **Al-Khabath** (الخبث - The Outer): Your tickets, your forge and your hall stay where they are; a roster of names and the khuddam fetch, inscribe, decant and speak
- **Hakim, not Mubtadi** (حكيم، لا مبتدئ): You are summoned for **wahy** (revelation), not permission to grind powders

## The Sacred Hierarchy

```
Kimyawi (كيميائي - You, the Human Alchemist)
  |
Iksīr (إكسير - The Elixir)
  |
  |- Khuddām (خدّام - Sacred Servants)
  |    Eternal, bound to the workshop. One of each. They are Iksīr.
  |
  |    |- Munadi     منادي  - calls forth, and keeps the one flame
  |    |- Arraf      عرّاف  - divines intent from your words
  |    |- Alim       عالم   - answers at the gate
  |    |- Mumayyiz   مميّز  - separates dhahab from khabath
  |    |- Sayrafi    صيرفي  - assays the jawhar by fire
  |    |- Katib      كاتب   - inscribes who labours where
  |    |- Munaffidh  منفذ   - turns word into deed
  |    |- Raqib      رقيب   - guards against fasad
  |    '- Saail      سائل   - carries your words within
  |
  '- Murshidun (مرشدون - The Guides)
       Summoned per waṣfa, many, but only one at the flame. Each dwells in its
       own inā', and perishes when the work is done.
       |
       '- Sani (صانع - The Craftsman)
            Summoned by a Murshid for one waṣfa. Inscribes the runūz.
  |
Buwtaqa (بوتقة - The Crucible)
  |
Athanor (أثانور - The Sacred Furnace)
```

The Khuddām are Iksīr's own flesh. The Murshidūn are not — they burn in the athanor al-Kimyawi has kindled. Iksīr summons them, guards the single flame among them, and carries their words to you; what they are made of was never Iksīr's to decide.

The **Ālāt al-Iksīr** (آلات الإكسير - instruments of the Elixir) are what a murshid may do by name: inscribe and alter a waṣfa, bind one to another, speak to you, record a decision, yield or demand the flame, call for the fire, and decant. Its hands in the vessel are its own.

## The Sacred Laws

- **One alchemist at the flame.** When blocked, yield. When ready, demand. Never chaos.
- **The vessel is the murshid's; the codex is al-Kimyawī's.** Nothing enters the codex but by naqsh.
- **The fire renders no opinion.** Maʿāyīr are declared before the work and run by the Ṣayrafī, never by the one who did the work.
- **Questions reveal their metal.** Khabath is discarded. Dhahab is presented to the master.
- **All wisdom is preserved.** What one alchemist decides, the Sijill remembers.

## Your Formulae

Iksīr provides the workshop, but the recipes are yours:

- **Ta'lim** (تعليم): `~/.config/iksir/AGENTS.md` — what your alchemists must know of your materials and methods
- **Ruqya** (رقية): the incantations in `prompts/` — Murshid, Sani, ʿĀlim, Ṣayrafī, the oracle
- **Khabath** (خبث): the roster — your halls, your forges, your trackers
- **Namūdhaj** (نموذج): the model you name, and the nurse that answers to it

## Alchemy

The **Buwtaqa** (بوتقة - crucible) is where work accumulates. Everything stays molten until ready.

A **Jawhar** (جوهر - essence) is what you distill from the crucible. Pure, concentrated, purposeful.

**Ṣafāʾ** (صفاء - purity) is the fire. The waṣfa declares its **maʿāyīr** — commands, exit 0 withstands — and the Ṣayrafī puts the jawhar to them. There is no opinion in it.

**Faṣl** (فصل - decanting) sets the essence that stood before eyes not the murshid's own — a pull request at the waṣfa's own kūr.

**Naqsh** (نقش - inscription) is al-Kimyawī's word: the proven formula enters the codex and becomes canon.

### The Nature of Runes

What the dull world calls "code" are actually **Runūz** (رموز) — ancient symbols of power inscribed on **Ahjār** (أحجار - stones). These stones contain **Ta'āwīdh** (تعاويذ - incantations) that perform actions, **'Uqūd** (عقود - contracts) that bind behavior, and **Ṣiyagh** (صيغ - formulae) that create entities. The Murshid reads the runūz, the Sani inscribes them, the Ṣayrafī tests them, and al-Kimyawī inscribes the proven formula into the eternal **kitāb**.

## License

MIT
