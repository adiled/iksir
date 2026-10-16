/**
 * String formatting utilities.
 *
 * Single source of truth for markdown escaping and text truncation.
 * Used across dispatcher, telegram, and anywhere user-generated content
 * needs safe formatting.
 */

/**
 * Escape special characters for Telegram's legacy Markdown mode.
 * Characters: _ * ` [ ] \
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*`\[\]\\]/g, "\\$&");
}

/**
 * Escape special characters for Telegram's MarkdownV2 mode.
 * All special characters per Telegram Bot API docs.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

/**
 * Truncate text to a maximum length, appending "..." if truncated.
 *
 * @param text - The text to truncate
 * @param maxLen - Maximum length (including the "..." suffix)
 * @returns Truncated text, or original if shorter than maxLen
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Clean model JSON for parsing. Small cells segment their utterances and
 * leave literal control characters inside string literals — valid speech,
 * invalid JSON. Fences stripped, control characters dissolved to spaces.
 */
export function nazzifJson(nass: string): string {
  let s = nass.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return s.replace(/[\u0000-\u001F]/g, " ");
}
