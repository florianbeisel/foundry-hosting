const { EmbedBuilder } = require("discord.js");
const { COLORS, EMOJIS } = require("../config/constants");
const { getStatusEmoji, formatTimestamp } = require("./formatting");
const { createKofiSupportButton, createInstanceControlButtons } = require("./components");
const { invokeFoundryLambda } = require("../services/lambda");
const { hasAdminRole } = require("./permissions");

/**
 * Get user costs with supporter information
 * @param {string} userId
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<Object>}
 */
async function getUserCostsWithSupporter(userId, guild) {
  try {
    const result = await invokeFoundryLambda({
      action: "get-user-costs",
      userId: userId,
    });

    // Get supporter status from Discord roles
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    const { getUserSupporterAmount } = require("./permissions");
    const supporterAmount = member ? getUserSupporterAmount(member) : 0;

    return {
      ...result,
      isSupporter: supporterAmount > 0,
      supporterAmount,
      adjustedUncoveredCost: Math.max(0, result.uncoveredCost - supporterAmount),
    };
  } catch (error) {
    console.error("Error getting user costs:", error);
    return null;
  }
}

/**
 * Send unified dashboard for instance management
 * @param {import('discord.js').TextChannel} channel
 * @param {string} userId
 * @param {Object} status
 * @param {string} context
 * @returns {Promise<import('discord.js').Message>}
 */
async function sendUnifiedDashboard(channel, userId, status, context = "status") {
  // Get monthly cost data with supporter information
  let costData = null;
  try {
    const guild = channel.guild;
    costData = await getUserCostsWithSupporter(userId, guild);
  } catch (error) {
    console.log("Could not fetch cost data for unified dashboard:", error);
  }

  // Get license owner info for gratitude display on pooled instances
  let licenseOwnerInfo = null;
  if (status.licenseType === "pooled" && status.licenseOwnerId) {
    try {
      const adminResult = await invokeFoundryLambda({
        action: "admin-overview",
        userId: userId,
      });

      if (adminResult.licenses && adminResult.licenses.pools) {
        const licensePool = adminResult.licenses.pools.find(
          (pool) => pool.licenseId === status.licenseOwnerId
        );
        if (licensePool) {
          licenseOwnerInfo = licensePool.ownerUsername;
        }
      }
    } catch (error) {
      console.log("Could not fetch license owner info for unified dashboard");
    }
  }

  // Determine title and description based on context
  let title, description;
  switch (context) {
    case "created":
      title = "🎲 Your Foundry VTT Dashboard";
      description = "Your instance is ready!";
      break;
    case "running":
      title = "🎲 Instance Running";
      description = "Instance is running.";
      break;
    case "stopped":
      title = "🔴 Instance Stopped";
      description = "Instance is stopped.";
      break;
    case "sync":
      title = "🔄 Bot Restarted - Instance Synced";
      description = "Your instance has been synchronized after bot restart.";
      break;
    case "dashboard":
      title = "🎲 Your Foundry VTT Dashboard";
      description = "Current instance status and controls.";
      break;
    default:
      title = "🎲 Instance Status";
      description = `Current status: **${status.status}**`;
  }

  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(status.status === "running" ? COLORS.SUCCESS : COLORS.WARNING)
    .setTitle(title)
    .setDescription(description)
    .addFields([
      {
        name: "Status",
        value: `${getStatusEmoji(status.status)} ${status.status}`,
        inline: true,
      },
      {
        name: "License Type",
        value: status.licenseType === "byol" ? "🔑 BYOL" : "🤝 Pooled",
        inline: true,
      },
      {
        name: "Last Updated",
        value: formatTimestamp(status.updatedAt * 1000),
        inline: true,
      },
    ]);

  // Add URL if available
  if (status.url) {
    embed.addFields([{ name: "URL", value: status.url, inline: false }]);
  }

  // Add cost information
  if (costData) {
    embed.addFields([
      {
        name: "💰 This Month's Usage",
        value: `**${costData.hoursUsed.toFixed(1)}h** = $${costData.totalCost.toFixed(2)}`,
        inline: true,
      },
      ...(costData.isSupporter
        ? [
            {
              name: "🎖️ Supporter Discount",
              value: `$${costData.supporterAmount.toFixed(2)} monthly credit`,
              inline: true,
            },
            {
              name:
                costData.adjustedUncoveredCost > 0
                  ? "💸 Remaining Cost"
                  : "✅ Fully Covered",
              value:
                costData.adjustedUncoveredCost > 0
                  ? `$${costData.adjustedUncoveredCost.toFixed(2)}`
                  : "All costs covered! 🎉",
              inline: true,
            },
          ]
        : [
            {
              name:
                costData.uncoveredCost > 0
                  ? "💸 Uncovered Cost"
                  : "✅ Fully Covered",
              value:
                costData.uncoveredCost > 0
                  ? `$${costData.uncoveredCost.toFixed(2)}`
                  : "All costs covered! 🎉",
              inline: true,
            },
          ]),
      ...(costData.donationsReceived > 0
        ? [
            {
              name: "☕ Donations Received",
              value: `$${costData.donationsReceived.toFixed(2)}${
                costData.lastDonorName
                  ? ` (Latest: ${costData.lastDonorName})`
                  : ""
              }`,
              inline: true,
            },
          ]
        : []),
    ]);
  }

  // Add gratitude for pooled license
  if (licenseOwnerInfo) {
    embed.addFields([
      {
        name: "🙏 Thanks to",
        value: `**${licenseOwnerInfo}** for sharing their license!`,
        inline: false,
      },
    ]);
  }

  // Build components
  const components = [];
  
  // Add instance control buttons
  const member = channel.guild ? await channel.guild.members.fetch(userId).catch(() => null) : null;
  const isAdmin = member ? hasAdminRole(member) : false;
  components.push(createInstanceControlButtons(status.status, isAdmin));

  // Add Ko-fi button if there's uncovered cost
  if (costData && costData.adjustedUncoveredCost > 0) {
    const kofiButton = createKofiSupportButton(userId, costData.adjustedUncoveredCost);
    if (kofiButton) {
      components.push(kofiButton);
    }
  }

  // Send the message
  const { sendMessageSafely } = require("./channels");
  return await sendMessageSafely(channel, {
    embeds: [embed],
    components,
  });
}

module.exports = {
  getUserCostsWithSupporter,
  sendUnifiedDashboard,
};