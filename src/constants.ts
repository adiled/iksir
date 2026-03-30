/**
 * Sacred Constants of the Alchemical Workshop
 * 
 * Immutable values used throughout the Iksīr system.
 */

/* Network Protocol Constants */
export const PROTOCOL_HTTP = "http://";
export const PROTOCOL_HTTPS = "https://";
export const PROTOCOL_SOCKS5 = "socks5://";

/* Default Server URLs */
export const DEFAULT_OPENCODE_SERVER = "http://localhost:5173";
export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

/* Test URLs */
export const TEST_OPENCODE_URL = "http://localhost:5000";
export const TEST_OPENCODE_URL_ALT = "http://localhost:6000";
export const TEST_PROXY_URL = "socks5://localhost:1080";

/* API Endpoints */
export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const LINEAR_API_BASE = "https://api.linear.app";
export const GITHUB_API_BASE = "https://api.github.com";

/* File Extensions */
export const TYPESCRIPT_EXT = ".ts";
export const JAVASCRIPT_EXT = ".js";
export const MARKDOWN_EXT = ".md";
export const JSON_EXT = ".json";

/* Time Constants (in milliseconds) */
export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
export const FIVE_MINUTES = 5 * ONE_MINUTE;
export const ONE_HOUR = 60 * ONE_MINUTE;
export const ONE_DAY = 24 * ONE_HOUR;

/* Retry and Backoff */
export const INITIAL_BACKOFF_MS = 5 * ONE_SECOND;
export const MAX_BACKOFF_MS = FIVE_MINUTES;
export const DEFAULT_TIMEOUT_MS = 30 * ONE_SECOND;

/* Database */
export const DATABASE_NAME = "iksir.sqlite";

/* Git */
export const DEFAULT_GIT_USER = "dev";
export const MAIN_BRANCH = "main";

/* Channel Names */
export const CHANNEL_DISPATCH = "dispatch";
export const CHANNEL_KIMYAWI = "kimyawi";

/* Sacred Numbers */
export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_TOPIC_NAME_LENGTH = 128;
export const DEFAULT_POLL_INTERVAL_MS = FIVE_MINUTES;
export const DEFAULT_PR_POLL_INTERVAL_MS = ONE_MINUTE;