import { fileURLToPath } from "node:url";
import { Bee } from "../hum/bee.js";
import { Chi, tone } from "../hum/wire.js";

const TG = "https://api.telegram.org";

export function classifyNiyya(text) {
  const t = (text ?? "").trim();
  if (t.startsWith("/ask ")) return { naw: "query", body: t.slice(5).trim() };
  if (t.startsWith("/do ") || t.startsWith("/transmute ")) {
    return { naw: "operation", body: t.replace(/^\/(do|transmute) /, "").trim() };
  }
  if (t.startsWith("/sandbox ")) {
    const rest = t.slice(9).trim().split(/\s+/);
    return { naw: "sandbox", ism: rest[0], body: rest.slice(1).join(" ") };
  }
  if (t.startsWith("/")) {
    const [amr, ...hujaj] = t.slice(1).split(/\s+/);
    return { naw: "command", amr, hujaj };
  }
  if (t.endsWith("?")) return { naw: "query", body: t };
  return { naw: "operation", body: t };
}

export function gateAnswer(finishReason, text) {
  const body = (text ?? "").trim();
  if (!body) return { deliver: false, text: "" };
  if (finishReason === "error") return { deliver: true, text: `fasad: ${body}` };
  return { deliver: true, text: body };
}

export class Flame {
  active = null;
  queue = [];
  take(job) {
    if (this.active) {
      this.queue.push(job);
      return false;
    }
    this.active = { ...job, chunks: [] };
    return true;
  }
  feed(sid, delta) {
    if (this.active && this.active.sid === sid) this.active.chunks.push(delta);
  }
  release() {
    this.active = null;
    return this.queue.shift() ?? null;
  }
}

const MURSHID_SYSTEM = [
  "murshid of iksir. one transmutation at a time, complete then next.",
  "tools: code_lookup code_reverse_deps code_forward_deps code_exports code_impact code_search mur_far_list mur_far_create mur_far_status.",
  "work on isolated branches. distill jawhar, discard khabath.",
].join(" ");

export function commissionText(niyya, repo) {
  if (niyya.naw === "query") return `sual: ${niyya.body}`;
  if (niyya.naw === "sandbox") return `warsha ${niyya.ism}: ${niyya.body}`;
  return `amal: ${niyya.body ?? niyya.amr ?? ""}`;
}

function cfg() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    repo: process.env.IKSIR_REPO ?? process.cwd(),
    model: process.env.IKSIR_MODEL ?? "",
  };
}

async function tg(token, method, params) {
  const r = await fetch(`${TG}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  return r.json();
}

export async function sendChat(c, chatId, text) {
  if (!c.token || !text) return;
  await tg(c.token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = cfg();
  const flame = new Flame();
  const pendingPermit = new Map();
  let offset = 0;

  const bee = new Bee({
    hive: "iksir-mind",
    prefix: "wbee",
    bee: ["worker", "forager"],
    version: "1.0.0",
    chis: ["hello", "prompt", "chunk", "finish", "error", "session-ready", "permission-ask", "release-permit", "tool-result"],
    provides: ["session"],
    propensity: { statefulness: "stateful", richness: "rich", wire: "iksir/mind" },
    source: "https://github.com/adiled/iksir",
    log: console.error,
  });

  function fire(job) {
    bee.emit(Chi.prompt, {
      ...(c.model ? { modelId: c.model } : {}),
      cwd: c.repo,
      systemPrompt: MURSHID_SYSTEM,
      text: commissionText(job.niyya, c.repo),
    });
  }

  function admit(job) {
    if (flame.take(job)) fire(job);
  }

  bee.on(Chi.sessionReady, (t) => {
    if (flame.active && !flame.active.sid) flame.active.sid = t.sid ?? t.nestId ?? null;
  });

  bee.on(Chi.chunk, (t) => {
    const d = t.delta ?? t.partialJson ?? "";
    if (d) flame.feed(t.sid, typeof d === "string" ? d : JSON.stringify(d));
  });

  async function settle(sid, reason, text) {
    if (!flame.active || (flame.active.sid && flame.active.sid !== sid)) return;
    const full = text ?? flame.active.chunks.join("");
    const chatId = flame.active.chatId;
    const g = gateAnswer(reason, full);
    if (g.deliver) await sendChat(c, chatId, g.text);
    const next = flame.release();
    if (next) fire(next);
  }

  bee.on(Chi.finish, (t) => settle(t.sid, t.finishReason ?? "stop", null));
  bee.on(Chi.error, (t) => settle(t.sid, "error", t.message));

  bee.on(Chi.permissionAsk, async (t) => {
    const chatId = flame.active?.chatId ?? c.chatId;
    if (!chatId) {
      bee.emit(Chi.releasePermit, { callId: t.callId, ok: false, error: "no chat" });
      return;
    }
    pendingPermit.set(t.callId, true);
    await tg(c.token, "sendMessage", {
      chat_id: chatId,
      text: `${t.toolName ?? "tool"} :: ${t.message ?? ""}`.slice(0, 1000),
      reply_markup: {
        inline_keyboard: [[
          { text: "naqsh", callback_data: `ok:${t.callId}` },
          { text: "radd", callback_data: `no:${t.callId}` },
        ]],
      },
    });
  });

  async function onUpdate(u) {
    if (u.callback_query) {
      const [verdict, callId] = (u.callback_query.data ?? "").split(":");
      if (pendingPermit.has(callId)) {
        pendingPermit.delete(callId);
        bee.emit(Chi.releasePermit, { callId, ok: verdict === "ok" });
        await tg(c.token, "answerCallbackQuery", { callback_query_id: u.callback_query.id });
      }
      return;
    }
    const msg = u.message;
    if (!msg || !msg.text) return;
    if (c.chatId && String(msg.chat.id) !== String(c.chatId)) return;
    const niyya = classifyNiyya(msg.text);
    if (niyya.naw === "command") {
      await sendChat(c, msg.chat.id, `${niyya.amr}`);
      return;
    }
    admit({ niyya, chatId: msg.chat.id, sid: null });
  }

  async function poll() {
    for (;;) {
      try {
        const data = await tg(c.token, "getUpdates", { offset, timeout: 25 });
        for (const u of data.result ?? []) {
          offset = u.update_id + 1;
          await onUpdate(u);
        }
      } catch (err) {
        console.error(`poll: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  bee.connect();
  if (c.token) poll();
}
