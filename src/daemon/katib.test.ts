import { assertEquals } from "@std/assert";
import { generateBranchName } from "./katib.ts";



Deno.test("generateBranchName: epic with explicit slug", () => {
  assertEquals(
    generateBranchName("TEAM-100", "epic", "abra-cadabra"),
    "epic/team-100-abra-cadabra",
  );
});

Deno.test("generateBranchName: epic derives slug from title", () => {
  assertEquals(
    generateBranchName("TEAM-100", "epic", undefined, "Bab Al Shams"),
    "epic/team-100-bab-al-shams",
  );
});

Deno.test("generateBranchName: epic title slug strips special chars", () => {
  assertEquals(
    generateBranchName("TEAM-200", "epic", undefined, "Fix: Auth & Login (v2)!"),
    "epic/team-200-fix-auth-login-v2",
  );
});

Deno.test("generateBranchName: epic title slug truncates at 30 chars", () => {
  const longTitle = "This is an extremely long title that should be truncated";
  const branch = generateBranchName("TEAM-1", "epic", undefined, longTitle);
  /** Slug portion should be at most 30 chars */
  const slug = branch.replace("epic/team-1-", "");
  assertEquals(slug.length <= 30, true);
});

Deno.test("generateBranchName: epic with no slug or title falls back to 'work'", () => {
  assertEquals(
    generateBranchName("TEAM-100", "epic"),
    "epic/team-100-work",
  );
});

Deno.test("generateBranchName: epic identifier is lowercased", () => {
  assertEquals(
    generateBranchName("TEAM-100", "epic", "test"),
    "epic/team-100-test",
  );
});


Deno.test("generateBranchName: chore uses IKSIR_GIT_USER prefix", () => {
  const prev = Deno.env.get("IKSIR_GIT_USER");
  Deno.env.set("IKSIR_GIT_USER", "testuser");
  try {
    assertEquals(
      generateBranchName("TEAM-300", "chore"),
      "testuser/TEAM-300",
    );
  } finally {
    if (prev) Deno.env.set("IKSIR_GIT_USER", prev);
    else Deno.env.delete("IKSIR_GIT_USER");
  }
});

Deno.test("generateBranchName: chore defaults to dev/ prefix", () => {
  const prev = Deno.env.get("IKSIR_GIT_USER");
  Deno.env.delete("IKSIR_GIT_USER");
  try {
    assertEquals(
      generateBranchName("TEAM-300", "chore"),
      "dev/TEAM-300",
    );
  } finally {
    if (prev) Deno.env.set("IKSIR_GIT_USER", prev);
  }
});

Deno.test("generateBranchName: chore preserves identifier case", () => {
  const prev = Deno.env.get("IKSIR_GIT_USER");
  Deno.env.set("IKSIR_GIT_USER", "testuser");
  try {
    assertEquals(
      generateBranchName("team-400", "chore"),
      "testuser/team-400",
    );
  } finally {
    if (prev) Deno.env.set("IKSIR_GIT_USER", prev);
    else Deno.env.delete("IKSIR_GIT_USER");
  }
});


Deno.test("generateBranchName: sandbox with explicit slug", () => {
  assertEquals(
    generateBranchName("SANDBOX-test", "sandbox", "alf-layla"),
    "sandbox/alf-layla",
  );
});

Deno.test("generateBranchName: sandbox derives name from identifier", () => {
  assertEquals(
    generateBranchName("SANDBOX-majlis", "sandbox"),
    "sandbox/majlis",
  );
});

Deno.test("generateBranchName: sandbox strips SANDBOX- prefix case-insensitive", () => {
  assertEquals(
    generateBranchName("sandbox-Qasr", "sandbox"),
    "sandbox/qasr",
  );
});
