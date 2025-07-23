/*
 * discord/src/domain/supporter.js
 * Logic related to Patreon/Ko-fi supporter roles and discounts.
 */

/**
 * Mapping of Discord role IDs to monthly supporter amount (USD).
 * @type {Record<string, number>}
 */
const SUPPORTER_ROLES = {
  "699727231794020353": 15, // $15 supporter
  "699727011979067484": 10, // $10 supporter
  "699727432424620033": 5,  // $5 supporter
};

/**
 * Determine the pledged amount for a guild member based on their roles.
 *
 * @param {import('discord.js').GuildMember|undefined|null} member
 * @returns {number} USD amount of supporter pledge (0 if none)
 */
function amountFor(member) {
  if (!member) return 0;
  for (const [roleId, dollars] of Object.entries(SUPPORTER_ROLES)) {
    if (member.roles.cache.has(roleId)) return dollars;
  }
  return 0;
}

module.exports = { SUPPORTER_ROLES, amountFor };