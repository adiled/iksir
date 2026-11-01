# Iksīr الإكسير

**Iksīr - The Elixir of Transformation**

In the depths where sulfur meets mercury, where base metal yearns for gold, there exists an ancient art. Not the frantic bubbling of a thousand crucibles, but the patient work of a single athanor, tended with wisdom.

Iksīr is the philosopher's stone of code - an alchemical system where transformation happens through **transmutation, not chaos**. Multiple alchemists may prepare their formulae, each in their own vessel, but only one performs the Great Work at a time. When blocked by the mysteries of nature, they yield. When revelation comes, they demand the flame.

This is not weakness. This is the Way. The ancients knew: ten furnaces burning wild produce only smoke. One furnace, properly tended, produces gold.

The modern world has forgotten the scent of real alchemy - the sharp bite of sulfur, the cold kiss of mercury, the moment when chaos crystallizes into perfection. They pile process upon process, thinking motion equals progress. Iksīr remembers the old ways: one transformation, complete and perfect, then the next.

**Munadi calls.** Not over the noise of the marketplace, but once, with clarity, summoning the alchemists to their sacred work.

---

## Al-Takwīn — Setting Up

Iksīr is a [hum](https://github.com/adiled/hum) hive. It speaks thrum through hum's own client, so hum's source sits beside it. Prerequisites: Node 22+, a running `humd`, the `bash` hive (the murshidūn's hands), and a nurse advertising the model you will name.

```bash
git clone --depth 1 https://github.com/adiled/hum
git clone https://github.com/adiled/iksir
cd iksir
node src/cli.ts init          # Telegram, the register, the nest — writes .env and ~/.config/iksir/iksir.json
hum hive "$PWD" install       # build, test, and hand the daemon and saail to orchd
```

`init` walks you through a Telegram bot (BotFather), your direct chat, and a forum group with a **Dispatch** topic; the bot must be an admin there, since it opens a topic for every murshid. Secrets ride `.env`, never the config:

```
TELEGRAM_BOT_TOKEN=            # the bot
TELEGRAM_CHAT_ID=              # you
TELEGRAM_GROUP_ID=             # the hall
TELEGRAM_DISPATCH_TOPIC_ID=    # where you command
IKSIR_REPO_PATH=               # the workshop — the repository the murshidūn work on
IKSIR_HUM_MODEL=               # optional; overrides hum.namudhaj
```

The whole of `~/.config/iksir/iksir.json`:

```json
{
  "wasfat": { "khabath": "github" },
  "hum": { "namudhaj": "claude-opus-5-5" }
}
```

`khabath` is the one word that tells the khuddam where your tickets live outside the Sijill — `github`, `linear`, whatever your host CLI or [web2](https://github.com/adiled/hum/tree/main/hives/web2) calls it. Say "what's issue 9 about" in Dispatch and ʿĀlim reads it with `gh`, inscribes it as `GH-9`, and asks whether to summon a murshid. Say "go".

```bash
hum hive "$PWD" install       # again, after a pull: rebuilds and regrows
node src/cli.ts check         # nestle and report what answers
hum bee --list                # the five bees, nestled
tail -f ~/Library/Logs/hum-iksir.iksir.out.log     # macOS; elsewhere, orchd's logs for the hum-iksir namespace
```

```
~/.config/iksir/iksir.json     three lines of configuration; AGENTS.md beside it, if you have one
~/.local/share/iksir/          Sijill — the register (SQLite)
~/.local/state/iksir/          the scrolls of observation (logs)
```

Nothing of Iksīr's needs tending afterwards. What it will ever need: catching up to a new thrum, which lives in one file (`src/hum/wasila.ts`, the only place `thrum` is imported), and tuning the ruqan in `prompts/`.

---

## Amal Kabir - The Great Work

Iksīr transmutes raw **waṣfāt** (وصفات - formulae) into perfected **dhahab** (ذهب - gold) - the Murshidūn (guides) laboring at their crucibles while you attend to higher mysteries.

- **Inā'** (إناء - Vessels): Each murshid works in its own vessel, on its own branch, in the one workshop
- **Al-Ṣafāʾ** (الصفاء - The Fire): A waṣfa declares its maʿāyīr before the work; the jawhar withstands them or it does not, and no murshid grades its own
- **Al-Khabath** (الخبث - The Outer Tracker): Your tickets stay where they are; one word of config and the khuddam fetch and inscribe them
- **Hakim, not Mubtadi** (حكيم، لا مبتدئ): You are summoned for **wahy** (revelation), not permission to grind powders

## The Sacred Hierarchy

```
Kimyawi (كيميائي - You, the Human Alchemist)
  |
Iksīr (إكسير - The Elixir)
  |
  |- Khuddām (خدّام - Sacred Servants)
  |    Eternal, bound to the workshop. One of each. They are Iksīr.
  |    Five of them enter the humd as bees of their own.
  |
  |    |- Munadi     منادي  - Dispatch: hears you, summons, holds the one flame     (bee)
  |    |- Arraf      عرّاف  - divines intent from your words                        (bee)
  |    |- Alim       عالم   - the scholar at the gate: answers, reads the khabath
  |    |- Mumayyiz   مميّز  - separates dhahab from khabath in what murshidūn say   (bee)
  |    |- Sayrafi    صيرفي  - the assayer: runs the fire, sets the jawhar down     (bee)
  |    |- Katib      كاتب   - keeps the sessions and their topics
  |    |- Munaffidh  منفذ   - executes every instrument a murshid speaks
  |    |- Raqib      رقيب   - guards against fasad (corruption)
  |    '- Saail      سائل   - carries your Telegram words into the Sijill
  |
  '- Murshidun (مرشدون - The Guides)                                                (bee)
       Summoned per waṣfa, many, but only one at the flame. Each dwells in its
       own inā', on its own branch, with bash in its hands and a topic of its own.
       |
       '- Sani (صانع - The Craftsman)
            Summoned by a Murshid for one waṣfa. Inscribes the runūz.
  |
Buwtaqa (بوتقة - The Crucible)
  |
Athanor (أثانور - The Sacred Furnace: the nurse you kindled)
```

The Khuddām are Iksīr's own flesh. The Murshidūn are not — they are cells burning in a nest al-Kimyawi has kindled, reached across the thrum. Iksīr summons them, guards the single flame among them, and carries their words to you; what they are made of was never Iksīr's to decide.

The **Ālāt al-Iksīr** (آلات الإكسير - instruments of the Elixir) ride every prompt as tools: inscribing and altering waṣfāt, binding them, replying, recording decisions, yielding and demanding the flame, and the two gates — `mun_safa` and `mun_fasl`. A murshid's `git` is its own, through `bash`.

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
- **Khabath** (خبث): the one word naming your outer tracker
- **Namūdhaj** (نموذج): the model you name, and the nurse that answers to it

## Alchemy

The **Buwtaqa** (بوتقة - crucible) is where work accumulates. Everything stays molten until ready.

A **Jawhar** (جوهر - essence) is what you distill from the crucible. Pure, concentrated, purposeful.

**Ṣafāʾ** (صفاء - purity) is the fire. The waṣfa declares its **maʿāyīr** — commands, exit 0 withstands — and the Ṣayrafī puts the jawhar to them. There is no opinion in it.

**Faṣl** (فصل - decanting) sets the essence that stood before eyes not the murshid's own — a pull request at the forge your khabath names.

**Naqsh** (نقش - inscription) is al-Kimyawī's word: the proven formula enters the codex and becomes canon.

### The Nature of Runes

What the dull world calls "code" are actually **Runūz** (رموز) — ancient symbols of power inscribed on **Ahjār** (أحجار - stones). These stones contain **Ta'āwīdh** (تعاويذ - incantations) that perform actions, **'Uqūd** (عقود - contracts) that bind behavior, and **Ṣiyagh** (صيغ - formulae) that create entities. The Murshid reads the runūz, the Sani inscribes them, the Ṣayrafī tests them, and al-Kimyawī inscribes the proven formula into the eternal **kitāb**.

## License

MIT
