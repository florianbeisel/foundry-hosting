const { SUPPORTER_ROLES, REQUIRED_ROLE_ID, ADMIN_ROLE_ID } = require("../config/constants");

/**
 * Get the supporter amount for a member based on their roles
 * @param {import('discord.js').GuildMember} member
 * @returns {number} The supporter amount (0, 5, 10, or 15)
 */
function getUserSupporterAmount(member) {
  if (!member) return 0;

  for (const [roleId, amount] of Object.entries(SUPPORTER_ROLES)) {
    if (member.roles.cache.has(roleId)) {
      return amount;
    }
  }

  return 0;
}

/**
 * Check if a member has the required role
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function hasRequiredRole(member) {
  if (!member) return false;
  return member.roles.cache.has(REQUIRED_ROLE_ID);
}

/**
 * Check if a member has the admin role
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function hasAdminRole(member) {
  if (!member) return false;
  return member.roles.cache.has(ADMIN_ROLE_ID);
}

module.exports = {
  getUserSupporterAmount,
  hasRequiredRole,
  hasAdminRole,
};