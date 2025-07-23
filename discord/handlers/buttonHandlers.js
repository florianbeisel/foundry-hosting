const { EmbedBuilder } = require("discord.js");
const { COLORS, EMOJIS } = require("../config/constants");
const { invokeFoundryLambda } = require("../services/lambda");
const { sendUnifiedDashboard } = require("../utils/dashboard");
const { hasRequiredRole } = require("../utils/permissions");
const { startStatusMonitoring, stopStatusMonitoring } = require("../services/monitoring");

/**
 * Handle Foundry button interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleFoundryButton(client, interaction) {
  const parts = interaction.customId.split("_");
  const [action, subAction] = parts;

  if (action !== "foundry") return;

  // Handle different button ID formats
  let userId, confirmAction;

  if (parts.length === 2 && subAction === "register") {
    // Format: foundry_register (generic registration button)
    userId = interaction.user.id;
  } else if (parts.length === 3) {
    // Format: foundry_action_userId
    userId = parts[2];
  } else if (parts.length === 4) {
    // Format: foundry_action_confirm_userId or special actions
    confirmAction = parts[2];
    userId = parts[3];
  } else {
    console.error("Invalid button ID format:", interaction.customId);
    return;
  }

  // Check permissions
  if (interaction.guild && !hasRequiredRole(interaction.member)) {
    return await interaction.reply({
      content: `${EMOJIS.ERROR} You do not have permission to use Foundry commands.`,
      ephemeral: true,
    });
  }

  // Defer the interaction early
  await interaction.deferUpdate();

  try {
    switch (subAction) {
      case "start":
        await handleStartInstance(client, interaction, userId);
        break;
      case "stop":
        await handleStopInstance(client, interaction, userId, confirmAction);
        break;
      case "restart":
        await handleRestartInstance(client, interaction, userId, confirmAction);
        break;
      case "refresh":
        await handleRefreshStatus(client, interaction, userId);
        break;
      case "register":
        await handleRegister(client, interaction, userId);
        break;
      default:
        console.error("Unknown button action:", subAction);
    }
  } catch (error) {
    console.error("Button interaction error:", error);
    await interaction.followUp({
      content: `${EMOJIS.ERROR} An error occurred: ${error.message}`,
      ephemeral: true,
    });
  }
}

async function handleStartInstance(client, interaction, userId) {
  const result = await invokeFoundryLambda({
    action: "start",
    userId: userId,
  });

  // Start monitoring
  startStatusMonitoring(client, userId, interaction.channel.id, sendUnifiedDashboard);

  await sendUnifiedDashboard(interaction.channel, userId, result, "status");
}

async function handleStopInstance(client, interaction, userId, confirmAction) {
  if (confirmAction !== "confirm") {
    // Show confirmation embed
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`${EMOJIS.WARNING} Confirm Stop`)
      .setDescription("Are you sure you want to stop your Foundry instance?")
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 4,
              label: "Stop Instance",
              emoji: "🛑",
              custom_id: `foundry_stop_confirm_${userId}`,
            },
            {
              type: 2,
              style: 2,
              label: "Cancel",
              emoji: "❌",
              custom_id: `foundry_refresh_${userId}`,
            },
          ],
        },
      ],
    });
    return;
  }

  const result = await invokeFoundryLambda({
    action: "stop",
    userId: userId,
  });

  stopStatusMonitoring(userId);
  await sendUnifiedDashboard(interaction.channel, userId, result, "stopped");
}

async function handleRestartInstance(client, interaction, userId, confirmAction) {
  if (confirmAction !== "confirm") {
    // Show confirmation embed
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`${EMOJIS.WARNING} Confirm Restart`)
      .setDescription("Are you sure you want to restart your Foundry instance?")
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: "Restart Instance",
              emoji: "🔄",
              custom_id: `foundry_restart_confirm_${userId}`,
            },
            {
              type: 2,
              style: 2,
              label: "Cancel",
              emoji: "❌",
              custom_id: `foundry_refresh_${userId}`,
            },
          ],
        },
      ],
    });
    return;
  }

  const result = await invokeFoundryLambda({
    action: "restart",
    userId: userId,
  });

  startStatusMonitoring(client, userId, interaction.channel.id, sendUnifiedDashboard);
  await sendUnifiedDashboard(interaction.channel, userId, result, "status");
}

async function handleRefreshStatus(client, interaction, userId) {
  const result = await invokeFoundryLambda({
    action: "status",
    userId: userId,
  });

  await sendUnifiedDashboard(interaction.channel, userId, result, "dashboard");
}

async function handleRegister(client, interaction, userId) {
  // This would show a modal for registration
  // Implementation would be similar to the original
  const { showRegistrationModal } = require("./modalHandlers");
  await showRegistrationModal(interaction, userId);
}

module.exports = {
  handleFoundryButton,
};