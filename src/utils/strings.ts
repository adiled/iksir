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

export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

export function nazzifJson(nass: string): string {
  let s = nass.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return s.replace(/[\u0000-\u001F]/g, " ");
}
