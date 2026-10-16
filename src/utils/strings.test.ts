import { test, assertEquals } from "../ikhtibar.ts";
import { escapeMarkdown, escapeMarkdownV2, truncate } from "./strings.ts";


test("escapeMarkdown: escapes underscore", () => {
  assertEquals(escapeMarkdown("hello_world"), "hello\\_world");
});

test("escapeMarkdown: escapes asterisk", () => {
  assertEquals(escapeMarkdown("**bold**"), "\\*\\*bold\\*\\*");
});

test("escapeMarkdown: escapes backtick", () => {
  assertEquals(escapeMarkdown("`code`"), "\\`code\\`");
});

test("escapeMarkdown: escapes square brackets", () => {
  assertEquals(escapeMarkdown("[link](url)"), "\\[link\\](url)");
});

test("escapeMarkdown: escapes backslash", () => {
  assertEquals(escapeMarkdown("a\\b"), "a\\\\b");
});

test("escapeMarkdown: no-op on clean text", () => {
  assertEquals(escapeMarkdown("hello world 123"), "hello world 123");
});

test("escapeMarkdown: handles empty string", () => {
  assertEquals(escapeMarkdown(""), "");
});

test("escapeMarkdown: combined special chars", () => {
  assertEquals(
    escapeMarkdown("_*`[\\"),
    "\\_\\*\\`\\[\\\\",
  );
});


test("escapeMarkdownV2: escapes full Telegram charset", () => {
  assertEquals(escapeMarkdownV2("_"), "\\_");
  assertEquals(escapeMarkdownV2("*"), "\\*");
  assertEquals(escapeMarkdownV2("["), "\\[");
  assertEquals(escapeMarkdownV2("]"), "\\]");
  assertEquals(escapeMarkdownV2("("), "\\(");
  assertEquals(escapeMarkdownV2(")"), "\\)");
  assertEquals(escapeMarkdownV2("~"), "\\~");
  assertEquals(escapeMarkdownV2("`"), "\\`");
  assertEquals(escapeMarkdownV2(">"), "\\>");
  assertEquals(escapeMarkdownV2("#"), "\\#");
  assertEquals(escapeMarkdownV2("+"), "\\+");
  assertEquals(escapeMarkdownV2("="), "\\=");
  assertEquals(escapeMarkdownV2("|"), "\\|");
  assertEquals(escapeMarkdownV2("{"), "\\{");
  assertEquals(escapeMarkdownV2("}"), "\\}");
  assertEquals(escapeMarkdownV2("."), "\\.");
  assertEquals(escapeMarkdownV2("!"), "\\!");
  assertEquals(escapeMarkdownV2("\\"), "\\\\");
  assertEquals(escapeMarkdownV2("-"), "\\-");
});

test("escapeMarkdownV2: no-op on clean text", () => {
  assertEquals(escapeMarkdownV2("hello world 123"), "hello world 123");
});

test("escapeMarkdownV2: combined realistic message", () => {
  const input = "PR #123 (fix): done!";
  const expected = "PR \\#123 \\(fix\\): done\\!";
  assertEquals(escapeMarkdownV2(input), expected);
});


test("truncate: returns original if under limit", () => {
  assertEquals(truncate("hello", 10), "hello");
});

test("truncate: returns original if exactly at limit", () => {
  assertEquals(truncate("hello", 5), "hello");
});

test("truncate: truncates with ellipsis when over limit", () => {
  assertEquals(truncate("hello world", 8), "hello...");
});

test("truncate: ellipsis counts toward maxLen", () => {
  const result = truncate("abcdefghij", 6);
  assertEquals(result, "abc...");
  assertEquals(result.length, 6);
});

test("truncate: handles empty string", () => {
  assertEquals(truncate("", 10), "");
});

test("truncate: very short maxLen", () => {
  assertEquals(truncate("hello", 3), "...");
});
