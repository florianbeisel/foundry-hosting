const { EmbedBuilder } = require("discord.js");
const { invokeFoundryLambda } = require("./lambda");
const { STATUS_CHECK_INTERVAL, COLORS, EMOJIS } = require("../config/constants");

// Store active monitors
const statusMonitors = new Map();

/**
 * Start monitoring the status of a Foundry instance
 * @param {import('discord.js').Client} client - The Discord client
 * @param {string} userId - The user ID to monitor
 * @param {string} channelId - The channel ID to send updates to
 * @param {Function} sendUnifiedDashboard - Function to send dashboard updates
 */
function startStatusMonitoring(client, userId, channelId, sendUnifiedDashboard) {
  // Clear any existing monitor
  stopStatusMonitoring(userId);

  const monitorInterval = setInterval(async () => {
    try {
      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        stopStatusMonitoring(userId);
        return;
      }

      // Only monitor status in user command channels, not in DMs or other channels
      if (
        !channel.guild ||
        !channel.name ||
        !channel.name.startsWith("foundry-")
      ) {
        console.log(
          `Skipping status monitoring for non-command channel: ${
            channel.name || "DM"
          }`
        );
        stopStatusMonitoring(userId);
        return;
      }

      const result = await invokeFoundryLambda({
        action: "status",
        userId: userId,
      });

      if (result.status === "running") {
        // Instance is running, we can stop monitoring startup
        stopStatusMonitoring(userId);

        // Send final status and control panel
        await sendUnifiedDashboard(channel, userId, result, "running");
        return;
      }

      // Send status update
      await sendUnifiedDashboard(channel, userId, result, "status");
    } catch (error) {
      console.error("Status monitoring error:", error);

      const channel = client.channels.cache.get(channelId);
      if (channel) {
        const errorEmbed = new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setTitle(`${EMOJIS.ERROR} Status Check Failed`)
          .setDescription(`Error checking status: ${error.message}`)
          .setTimestamp();

        await channel.send({ embeds: [errorEmbed] });
      }

      stopStatusMonitoring(userId);
    }
  }, STATUS_CHECK_INTERVAL);

  statusMonitors.set(userId, monitorInterval);
}

/**
 * Stop monitoring the status of a Foundry instance
 * @param {string} userId - The user ID to stop monitoring
 */
function stopStatusMonitoring(userId) {
  const interval = statusMonitors.get(userId);
  if (interval) {
    clearInterval(interval);
    statusMonitors.delete(userId);
  }
}

/**
 * Stop all active monitors
 */
function stopAllMonitoring() {
  for (const [userId, interval] of statusMonitors) {
    clearInterval(interval);
  }
  statusMonitors.clear();
}

/**
 * Get active monitors count
 * @returns {number}
 */
function getActiveMonitorsCount() {
  return statusMonitors.size;
}

/**
 * Check if a user is being monitored
 * @param {string} userId
 * @returns {boolean}
 */
function isMonitoring(userId) {
  return statusMonitors.has(userId);
}

module.exports = {
  startStatusMonitoring,
  stopStatusMonitoring,
  stopAllMonitoring,
  getActiveMonitorsCount,
  isMonitoring,
};