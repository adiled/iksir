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

test("generateBranchName: a lone wasfa's vessel is wasfa/<id>", () => {
  assertEquals(wallidIsmFar("TEAM-300", "chore"), "wasfa/team-300");
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
