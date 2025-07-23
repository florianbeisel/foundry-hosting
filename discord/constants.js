// ================================================================================
// DISCORD BOT CONSTANTS AND CONFIGURATION
// ================================================================================

// =================
// SUPPORTER ROLES
// =================
const SUPPORTER_ROLES = {
  "699727231794020353": 15, // $15 supporter
  "699727011979067484": 10, // $10 supporter
  "699727432624620033": 5, // $5 supporter
};

// =================
// CHANNEL NAMES
// =================
const CHANNEL_NAMES = {
  LOGGING: "foundry-bot-logs",
  USER_CHANNEL_PREFIX: "foundry-",
};

// =================
// EMBED COLORS
// =================
const COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x00ff00,
  ERROR: 0xff0000,
  WARNING: 0xffa500,
  INFO: 0x0099ff,
  ADMIN: 0x9b59b6,
  STOPPED: 0x888888,
};

// =================
// STATUS EMOJIS
// =================
const STATUS_EMOJIS = {
  running: "🟢",
  starting: "🟡",
  stopping: "🟠",
  stopped: "🔴",
  created: "⚪",
  unknown: "❔",
};

// =================
// MONITORING INTERVALS
// =================
const INTERVALS = {
  STATUS_CHECK: 10000, // 10 seconds
  LOG_BATCH_DELAY: 1000, // 1 second
  RECONNECT_DELAY: 5000, // 5 seconds
};

// =================
// LIMITS AND CONSTRAINTS
// =================
const LIMITS = {
  USERNAME_MAX_LENGTH: 32, // ALB target group name constraint
  LOG_BATCH_SIZE: 10, // Messages to process at once
  MESSAGE_MAX_LENGTH: 2000, // Discord message limit
  EMBED_FIELD_MAX_LENGTH: 1024, // Discord embed field limit
  SELECT_MENU_MAX_OPTIONS: 25, // Discord select menu limit
};

// =================
// MESSAGE TEMPLATES
// =================
const MESSAGES = {
  NO_PERMISSION: "❌ You do not have permission to use Foundry commands.",
  ADMIN_REQUIRED: "❌ Admin access required.",
  CONTROL_OWN_INSTANCE: "❌ You can only control your own instance.",
  BOT_READY: "✅ Foundry VTT Bot is ready!",
};

// =================
// BUTTON STYLES
// =================
const BUTTON_STYLES = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
};

// =================
// ACTIVITY TYPES
// =================
const ACTIVITY_TYPES = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  CUSTOM: 4,
  COMPETING: 5,
};

// =================
// EXPORT ALL CONSTANTS
// =================
module.exports = {
  SUPPORTER_ROLES,
  CHANNEL_NAMES,
  COLORS,
  STATUS_EMOJIS,
  INTERVALS,
  LIMITS,
  MESSAGES,
  BUTTON_STYLES,
  ACTIVITY_TYPES,
};