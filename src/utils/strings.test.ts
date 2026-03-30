import { assertEquals } from "@std/assert";
import { escapeMarkdown, escapeMarkdownV2, truncate } from "./strings.ts";

// =============================================================================
// escapeMarkdown
// =============================================================================

Deno.test("escapeMarkdown: escapes underscore", () => {
  assertEquals(escapeMarkdown("hello_world"), "hello\\_world");
});

Deno.test("escapeMarkdown: escapes asterisk", () => {
  assertEquals(escapeMarkdown("**bold**"), "\\*\\*bold\\*\\*");
});

Deno.test("escapeMarkdown: escapes backtick", () => {
  assertEquals(escapeMarkdown("`code`"), "\\`code\\`");
});

Deno.test("escapeMarkdown: escapes square brackets", () => {
  assertEquals(escapeMarkdown("[link](url)"), "\\[link\\](url)");
});

Deno.test("escapeMarkdown: escapes backslash", () => {
  assertEquals(escapeMarkdown("a\\b"), "a\\\\b");
});

Deno.test("escapeMarkdown: no-op on clean text", () => {
  assertEquals(escapeMarkdown("hello world 123"), "hello world 123");
});

Deno.test("escapeMarkdown: handles empty string", () => {
  assertEquals(escapeMarkdown(""), "");
});

Deno.test("escapeMarkdown: combined special chars", () => {
  assertEquals(
    escapeMarkdown("_*`[\\"),
    "\\_\\*\\`\\[\\\\",
  );
});

// =============================================================================
// escapeMarkdownV2
// =============================================================================

Deno.test("escapeMarkdownV2: escapes full Telegram charset", () => {
  // All special chars: _ * [ ] ( ) ~ ` > # + = | { } . ! \ -
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

Deno.test("escapeMarkdownV2: no-op on clean text", () => {
  assertEquals(escapeMarkdownV2("hello world 123"), "hello world 123");
});

Deno.test("escapeMarkdownV2: combined realistic message", () => {
  const input = "PR #123 (fix): done!";
  const expected = "PR \\#123 \\(fix\\): done\\!";
  assertEquals(escapeMarkdownV2(input), expected);
});

// =============================================================================
// truncate
// =============================================================================

Deno.test("truncate: returns original if under limit", () => {
  assertEquals(truncate("hello", 10), "hello");
});

Deno.test("truncate: returns original if exactly at limit", () => {
  assertEquals(truncate("hello", 5), "hello");
});

Deno.test("truncate: truncates with ellipsis when over limit", () => {
  assertEquals(truncate("hello world", 8), "hello...");
});

Deno.test("truncate: ellipsis counts toward maxLen", () => {
  const result = truncate("abcdefghij", 6);
  assertEquals(result, "abc...");
  assertEquals(result.length, 6);
});

Deno.test("truncate: handles empty string", () => {
  assertEquals(truncate("", 10), "");
});

Deno.test("truncate: very short maxLen", () => {
  assertEquals(truncate("hello", 3), "...");
});
