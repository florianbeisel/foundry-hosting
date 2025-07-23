// =================
// SUPPORTER ROLES
// =================

const SUPPORTER_ROLES = {
  "699727231794020353": 15, // $15 supporter
  "699727011979067484": 10, // $10 supporter
  "699727432424620033": 5, // $5 supporter
};

// =================
// DISCORD CONSTANTS
// =================

const GUILD_ID = "625029673463209984";
const REQUIRED_ROLE_ID = "1313924319516164127";
const ADMIN_ROLE_ID = "1313924445852692550";
const ADMIN_CATEGORY_ID = "1313941447975641088";
const STATS_CHANNEL_ID = "1313926296769921137";
const REGISTRATION_CHANNEL_ID = "1313926296769921137";

// =================
// MONITORING CONSTANTS
// =================

const STATUS_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// =================
// EMBED COLORS
// =================

const COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  WARNING: 0xfee75c,
  ERROR: 0xed4245,
  INFO: 0x5865f2,
};

// =================
// EMOJIS
// =================

const EMOJIS = {
  SUCCESS: "✅",
  ERROR: "❌",
  WARNING: "⚠️",
  LOADING: "⏳",
  ONLINE: "🟢",
  OFFLINE: "🔴",
  PENDING: "🟡",
};

module.exports = {
  SUPPORTER_ROLES,
  GUILD_ID,
  REQUIRED_ROLE_ID,
  ADMIN_ROLE_ID,
  ADMIN_CATEGORY_ID,
  STATS_CHANNEL_ID,
  REGISTRATION_CHANNEL_ID,
  STATUS_CHECK_INTERVAL,
  MAX_RETRIES,
  RETRY_DELAY,
  COLORS,
  EMOJIS,
};