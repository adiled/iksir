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
