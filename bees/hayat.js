import { fileURLToPath } from "node:url";
import { Bee } from "../hum/bee.js";
import { Chi, rid } from "../hum/wire.js";

export function debriefTopic() {
  return "iksir/debrief";
}

export function debriefPayload(kind, body) {
  return { kind, at: Date.now(), body: body ?? {} };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wait = Number(process.env.HAYAT_MS ?? 21600000);
  const bee = new Bee({
    hive: "iksir-hayat",
    prefix: "fbee",
    version: "1.0.0",
    chis: ["hello", "gossip-publish", "curate", "breath"],
    provides: ["vigil"],
    propensity: { statefulness: "stateless", richness: "lean", wire: "iksir/hayat" },
    source: "https://github.com/adiled/iksir",
    log: console.error,
  });
  bee.on(Chi.breath, () => {
    bee.emit(Chi.gossipPublish, { topic: debriefTopic(), payload: debriefPayload("alive", {}), msg_id: rid() });
  });
  bee.on(Chi.curate, () => {});
  setInterval(() => {
    bee.emit(Chi.gossipPublish, { topic: debriefTopic(), payload: debriefPayload("rite", {}), msg_id: rid() });
  }, wait);
  bee.connect();
}
