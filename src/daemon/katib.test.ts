import { test, assertEquals } from "../ikhtibar.ts";
import { wallidIsmFar } from "./katib.ts";



test("generateBranchName: epic with explicit slug", () => {
  assertEquals(
    wallidIsmFar("TEAM-100", "epic", "abra-cadabra"),
    "epic/team-100-abra-cadabra",
  );
});

test("generateBranchName: epic derives slug from title", () => {
  assertEquals(
    wallidIsmFar("TEAM-100", "epic", undefined, "Bab Al Shams"),
    "epic/team-100-bab-al-shams",
  );
});

test("generateBranchName: epic title slug strips special chars", () => {
  assertEquals(
    wallidIsmFar("TEAM-200", "epic", undefined, "Fix: Auth & Login (v2)!"),
    "epic/team-200-fix-auth-login-v2",
  );
});

test("generateBranchName: epic title slug truncates at 30 chars", () => {
  const longTitle = "This is an extremely long title that should be truncated";
  const branch = wallidIsmFar("TEAM-1", "epic", undefined, longTitle);
  /** Slug portion should be at most 30 chars */
  const slug = branch.replace("epic/team-1-", "");
  assertEquals(slug.length <= 30, true);
});

test("generateBranchName: epic with no slug or title falls back to 'work'", () => {
  assertEquals(
    wallidIsmFar("TEAM-100", "epic"),
    "epic/team-100-work",
  );
});

test("generateBranchName: epic identifier is lowercased", () => {
  assertEquals(
    wallidIsmFar("TEAM-100", "epic", "test"),
    "epic/team-100-test",
  );
});


test("generateBranchName: chore uses IKSIR_GIT_USER prefix", () => {
  const prev = process.env.IKSIR_GIT_USER;
  process.env.IKSIR_GIT_USER = "testuser";
  try {
    assertEquals(
      wallidIsmFar("TEAM-300", "chore"),
      "testuser/TEAM-300",
    );
  } finally {
    if (prev) process.env.IKSIR_GIT_USER = prev;
    else delete process.env.IKSIR_GIT_USER;
  }
});

test("generateBranchName: chore defaults to dev/ prefix", () => {
  const prev = process.env.IKSIR_GIT_USER;
  delete process.env.IKSIR_GIT_USER;
  try {
    assertEquals(
      wallidIsmFar("TEAM-300", "chore"),
      "dev/TEAM-300",
    );
  } finally {
    if (prev) process.env.IKSIR_GIT_USER = prev;
  }
});

test("generateBranchName: chore preserves identifier case", () => {
  const prev = process.env.IKSIR_GIT_USER;
  process.env.IKSIR_GIT_USER = "testuser";
  try {
    assertEquals(
      wallidIsmFar("team-400", "chore"),
      "testuser/team-400",
    );
  } finally {
    if (prev) process.env.IKSIR_GIT_USER = prev;
    else delete process.env.IKSIR_GIT_USER;
  }
});


test("generateBranchName: sandbox with explicit slug", () => {
  assertEquals(
    wallidIsmFar("SANDBOX-test", "sandbox", "alf-layla"),
    "sandbox/alf-layla",
  );
});

test("generateBranchName: sandbox derives name from identifier", () => {
  assertEquals(
    wallidIsmFar("SANDBOX-majlis", "sandbox"),
    "sandbox/majlis",
  );
});

test("generateBranchName: sandbox strips SANDBOX- prefix case-insensitive", () => {
  assertEquals(
    wallidIsmFar("sandbox-Qasr", "sandbox"),
    "sandbox/qasr",
  );
});
