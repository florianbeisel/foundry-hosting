/*
 * discord/src/domain/costs.js
 * Combines Lambda cost data with supporter discount information.
 */

const { invoke } = require("../aws/lambda");
const { amountFor } = require("./supporter");

/**
 * Fetch cost stats from Lambda and apply supporter discount if available.
 * @param {string} userId
 * @param {import('discord.js').Guild|null} guild
 */
async function getUserCosts(userId, guild) {
  // supporter amount defaults to 0 if guild/member missing.
  let supporterAmount = 0;
  if (guild) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      supporterAmount = amountFor(member);
    } catch {}
  }

  const costData = await invoke({ action: "get-user-costs", userId });
  const adjustedUncoveredCost = Math.max(0, costData.uncoveredCost - supporterAmount);

  return {
    ...costData,
    supporterAmount,
    adjustedUncoveredCost,
    isSupporter: supporterAmount > 0,
  };
}

module.exports = { getUserCosts };