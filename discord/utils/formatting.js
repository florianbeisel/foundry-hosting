const { EMOJIS } = require("../config/constants");

/**
 * Sanitize a username for use in URLs and filenames
 * @param {string} username
 * @returns {string}
 */
function sanitizeUsername(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 32); // Limit length
}

/**
 * Get the appropriate emoji for a status
 * @param {string} status
 * @returns {string}
 */
function getStatusEmoji(status) {
  switch (status?.toLowerCase()) {
    case "online":
    case "active":
    case "running":
      return EMOJIS.ONLINE;
    case "offline":
    case "stopped":
    case "inactive":
      return EMOJIS.OFFLINE;
    case "pending":
    case "starting":
    case "stopping":
      return EMOJIS.PENDING;
    default:
      return EMOJIS.WARNING;
  }
}

/**
 * Format a timestamp for display
 * @param {Date|number} timestamp
 * @returns {string}
 */
function formatTimestamp(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/**
 * Truncate text to a maximum length
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength = 1024) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

module.exports = {
  sanitizeUsername,
  getStatusEmoji,
  formatTimestamp,
  truncateText,
};