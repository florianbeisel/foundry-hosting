// ================================================================================
// INSTANCE MANAGEMENT COMMANDS
// ================================================================================
// This module handles all instance lifecycle commands (start, stop, restart, etc.)

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// Import constants
const { COLORS, STATUS_EMOJIS, CHANNEL_NAMES } = require("./constants");

/**
 * Handle the Start Instance button/command
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function handleStartInstance(interaction, userId, dependencies) {
  const {
    invokeLambda,
    client,
    findExistingCommandChannel,
    createUserCommandChannel,
    safeChannelSend,
    startStatusMonitoring,
  } = dependencies;

  const result = await invokeLambda({
    action: "start",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle("🚀 Starting Instance")
    .setDescription("Starting up, takes 2-3 minutes.")
    .addFields([
      { name: "Status", value: `${STATUS_EMOJIS.starting} Starting`, inline: true },
      { name: "Estimated Time", value: "2-3 minutes", inline: true },
      {
        name: "Your URL",
        value: result.url || "Will be available shortly",
        inline: false,
      },
    ])
    .setTimestamp();

  // Get or create user command channel
  let channelId = client.userChannels.get(userId);
  let channel;

  if (!channelId) {
    // First try to find existing channel
    const user = await client.users.fetch(userId);
    channel = await findExistingCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    if (!channel) {
      // No existing channel found, create new one
      channel = await createUserCommandChannel(
        interaction.guild,
        userId,
        user.username
      );
    }
    channelId = channel.id;
  } else {
    channel = client.channels.cache.get(channelId);
  }

  if (channel) {
    // Send starting message to command channel
    await interaction.editReply({
      content: `🚀 Starting... Check ${channel}`,
    });

    try {
      await safeChannelSend(
        channel,
        { embeds: [embed] },
        // Fallback: create new channel if current one is inaccessible
        async () => {
          const user = await client.users.fetch(userId);
          return await createUserCommandChannel(
            interaction.guild,
            userId,
            user.username
          );
        }
      );

      // Start status monitoring immediately
      startStatusMonitoring(userId, channelId);
    } catch (error) {
      console.error("Failed to send message to any channel:", error);
      await interaction.editReply({
        content:
          "❌ Unable to access or create your command channel. Please contact an admin.",
      });
    }
  } else {
    console.error(
      `Channel not found for user ${userId}, channelId: ${channelId}`
    );
    await interaction.editReply({
      content:
        "❌ Command channel not found. Please try creating a new instance.",
    });
  }
}

/**
 * Handle the Stop Instance button/command
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function handleStopInstance(interaction, userId, dependencies) {
  const { invokeLambda } = dependencies;

  // First check if this instance is running a scheduled session
  const statusResult = await invokeLambda({
    action: "status",
    userId: userId,
  });

  // If this is a scheduled session, show confirmation dialog
  if (statusResult.linkedSessionId && statusResult.status === "running") {
    // Get session details
    const sessionResult = await invokeLambda({
      action: "list-sessions",
      userId: userId,
    });

    const session = sessionResult.sessions?.find(
      (s) => s.sessionId === statusResult.linkedSessionId
    );

    if (session && session.status === "active") {
      // Show confirmation dialog for scheduled session
      const confirmEmbed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle("⚠️ Scheduled Session Active")
        .setDescription(
          `You're trying to stop an instance that's running a **scheduled session**.`
        )
        .addFields([
          {
            name: "Session Details",
            value: [
              `**Title:** ${session.title || "Foundry VTT Session"}`,
              `**Start:** <t:${session.startTime}:F>`,
              `**End:** <t:${session.endTime}:F>`,
              `**License Type:** ${session.licenseType?.toUpperCase()}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "What happens if you stop?",
            value: [
              "• Your session will be cancelled",
              "• The license will be freed up",
              "• Other users can use the license",
              "• You'll need to schedule a new session",
            ].join("\n"),
            inline: true,
          },
        ])
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_cancel_session_${userId}`)
          .setLabel("Stop & Cancel Session")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_restart_${userId}`)
          .setLabel("Stop & Restart Instance")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_cancel_${userId}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🚫")
      );

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [actionRow],
      });
      return;
    }
  }

  // Regular stop (no scheduled session or session not active)
  await performStopInstance(interaction, userId, dependencies);
}

/**
 * Perform the actual instance stop operation
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function performStopInstance(interaction, userId, dependencies) {
  const { invokeLambda, stopStatusMonitoring } = dependencies;

  stopStatusMonitoring(userId);

  const result = await invokeLambda({
    action: "stop",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle("⏹️ Instance Stopped")
    .setDescription("Instance stopped.")
    .addFields([
      { name: "Status", value: `${STATUS_EMOJIS.stopped} Stopped`, inline: true },
      {
        name: "Data",
        value: "💾 Worlds saved",
        inline: true,
      },
    ])
    .setTimestamp();

  // Create user-focused control panel (top row)
  const userControlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_schedule_${userId}`)
      .setLabel("Schedule Session")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📅")
  );

  // Add license sharing management button for BYOL users
  try {
    const statusResult = await invokeLambda({
      action: "status",
      userId: userId,
    });

    if (statusResult.licenseType === "byol") {
      userControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_license_sharing_${userId}`)
          .setLabel(
            statusResult.allowLicenseSharing
              ? "Manage License Sharing"
              : "Start License Sharing"
          )
          .setStyle(
            statusResult.allowLicenseSharing
              ? ButtonStyle.Primary
              : ButtonStyle.Success
          )
          .setEmoji(statusResult.allowLicenseSharing ? "🔑" : "🤝")
      );
    }
  } catch (error) {
    console.log("Could not fetch status for license sharing button:", error);
  }

  // Create instance-focused control panel (bottom row)
  const instanceControlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_start_${userId}`)
      .setLabel("Start Instance")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🚀"),
    new ButtonBuilder()
      .setCustomId(`foundry_status_${userId}`)
      .setLabel("Check Status")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄"),
    new ButtonBuilder()
      .setCustomId(`foundry_destroy_${userId}`)
      .setLabel("Destroy")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("💀")
  );

  const components = [userControlRow, instanceControlRow];

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle the Stop & Cancel Session option
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function handleStopCancelSession(interaction, userId, dependencies) {
  const { invokeLambda, stopStatusMonitoring } = dependencies;

  stopStatusMonitoring(userId);

  // Cancel the session first
  const statusResult = await invokeLambda({
    action: "status",
    userId: userId,
  });

  if (statusResult.linkedSessionId) {
    await invokeLambda({
      action: "cancel-session",
      userId: userId,
      sessionId: statusResult.linkedSessionId,
    });
  }

  // Then stop the instance
  const result = await invokeLambda({
    action: "stop",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle("❌ Session Cancelled & Instance Stopped")
    .setDescription("Your scheduled session has been cancelled and the instance has been stopped.")
    .addFields([
      { name: "Status", value: `${STATUS_EMOJIS.stopped} Stopped`, inline: true },
      { name: "Session", value: "❌ Cancelled", inline: true },
      { name: "Data", value: "💾 Worlds saved", inline: true },
    ])
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}

/**
 * Handle the Stop & Restart option
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function handleStopRestart(interaction, userId, dependencies) {
  const { invokeLambda, stopStatusMonitoring, startStatusMonitoring, client } = dependencies;

  stopStatusMonitoring(userId);

  // Stop the instance
  await invokeLambda({
    action: "stop",
    userId: userId,
  });

  // Wait a bit before restarting
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start the instance again
  const result = await invokeLambda({
    action: "start",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle("🔄 Instance Restarting")
    .setDescription("Your instance is restarting. Your scheduled session will continue.")
    .addFields([
      { name: "Status", value: `${STATUS_EMOJIS.starting} Restarting`, inline: true },
      { name: "Session", value: "✅ Preserved", inline: true },
      { name: "Estimated Time", value: "2-3 minutes", inline: true },
    ])
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });

  // Start monitoring if we have a channel
  const channelId = client.userChannels.get(userId);
  if (channelId) {
    startStatusMonitoring(userId, channelId);
  }
}

/**
 * Handle the Cancel stop operation
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID who owns the instance
 * @param {Object} dependencies - Injected dependencies
 */
async function handleStopCancel(interaction, userId, dependencies) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle("🚫 Stop Cancelled")
    .setDescription("Your instance continues running.")
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}

// Export all instance management functions
module.exports = {
  handleStartInstance,
  handleStopInstance,
  performStopInstance,
  handleStopCancelSession,
  handleStopRestart,
  handleStopCancel,
};