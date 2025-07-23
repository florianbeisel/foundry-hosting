const { EmbedBuilder } = require("discord.js");
const { COLORS, STATS_CHANNEL_ID } = require("../config/constants");
const { invokeFoundryLambda } = require("../services/lambda");

/**
 * Update registration statistics
 * @param {import('discord.js').Client} client
 */
async function updateRegistrationStats(client) {
  try {
    // Get stats channel
    const channel = await client.channels.fetch(STATS_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.log("Stats channel not found");
      return;
    }

    // Get statistics from Lambda
    const stats = await invokeFoundryLambda({
      action: "get-stats",
      userId: "system",
    });

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle("📊 Foundry VTT Registration Stats")
      .setDescription("Current registration statistics")
      .addFields([
        {
          name: "Total Registrations",
          value: stats.totalRegistrations?.toString() || "0",
          inline: true,
        },
        {
          name: "Active Instances",
          value: stats.activeInstances?.toString() || "0",
          inline: true,
        },
        {
          name: "Last Updated",
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      ])
      .setTimestamp();

    // Check if we have an existing message to update
    const existingMessageId = client.registrationStats.get(STATS_CHANNEL_ID);
    if (existingMessageId) {
      try {
        const message = await channel.messages.fetch(existingMessageId);
        await message.edit({ embeds: [embed] });
      } catch (error) {
        // Message doesn't exist, create a new one
        const newMessage = await channel.send({ embeds: [embed] });
        client.registrationStats.set(STATS_CHANNEL_ID, newMessage.id);
      }
    } else {
      // Create new message
      const newMessage = await channel.send({ embeds: [embed] });
      client.registrationStats.set(STATS_CHANNEL_ID, newMessage.id);
    }
  } catch (error) {
    console.error("Error updating registration stats:", error);
  }
}

module.exports = {
  updateRegistrationStats,
};