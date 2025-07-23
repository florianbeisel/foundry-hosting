const { EmbedBuilder } = require("discord.js");
const { hasRequiredRole, hasAdminRole } = require("../utils/permissions");
const { saveRegistrationStatsMappingToDB, saveAdminStatusMappingToDB } = require("../services/dynamodb");
const { invokeFoundryLambda } = require("../services/lambda");
const { COLORS, EMOJIS } = require("../config/constants");

/**
 * Handle interaction create events
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Interaction} interaction
 */
async function handleInteractionCreate(client, interaction) {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(client, interaction);
  } else if (interaction.isButton()) {
    // Check if it's an admin button
    if (interaction.customId.startsWith("admin_")) {
      await handleAdminButtonInteraction(client, interaction);
    } else {
      await handleButtonInteraction(client, interaction);
    }
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(client, interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(client, interaction);
  }
}

/**
 * Handle slash commands
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSlashCommand(client, interaction) {
  // Skip role check for DMs (no guild member context)
  if (interaction.guild && !hasRequiredRole(interaction.member)) {
    return await interaction.reply({
      content: `${EMOJIS.ERROR} You do not have permission to use Foundry commands.`,
      ephemeral: true,
    });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    // Inject dependencies into the interaction object
    interaction.invokeLambda = invokeFoundryLambda;
    interaction.sendUnifiedDashboard = (channel, userId, status, mode) => {
      // This would be imported from a dashboard module
      const { sendUnifiedDashboard } = require("../utils/dashboard");
      return sendUnifiedDashboard(channel, userId, status, mode);
    };
    interaction.hasAdminRole = () =>
      interaction.guild ? hasAdminRole(interaction.member) : false;
    interaction.createUserCommandChannel = (userId, username) => {
      const { createUserCommandChannel } = require("../utils/channels");
      return createUserCommandChannel(interaction.guild, userId, username);
    };
    interaction.deleteUserCommandChannel = (userId) => {
      const { deleteUserCommandChannel } = require("../utils/channels");
      return deleteUserCommandChannel(client, interaction.guild, userId);
    };
    interaction.startStatusMonitoring = (userId, channelId) => {
      const { startStatusMonitoring } = require("../services/monitoring");
      const { sendUnifiedDashboard } = require("../utils/dashboard");
      return startStatusMonitoring(client, userId, channelId, sendUnifiedDashboard);
    };
    interaction.addRegistrationStatsMapping = async (channelId, messageId) => {
      client.registrationStats.set(channelId, messageId);
      const saved = await saveRegistrationStatsMappingToDB(channelId, messageId);
      if (!saved) {
        console.error(
          "⚠️ Failed to save registration stats mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };
    interaction.addAdminStatusMapping = async (channelId, messageId) => {
      client.adminStatusMapping.set(channelId, messageId);
      const saved = await saveAdminStatusMappingToDB(channelId, messageId);
      if (!saved) {
        console.error(
          "⚠️ Failed to save admin status mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };

    await command.execute(interaction);
  } catch (error) {
    console.error("Command execution error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`${EMOJIS.ERROR} Error`)
      .setDescription(`An error occurred: ${error.message}`)
      .setTimestamp();

    const errorMessage = { embeds: [errorEmbed], ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}

/**
 * Handle button interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleButtonInteraction(client, interaction) {
  // Implementation would be in a separate handler module
  const { handleFoundryButton } = require("../handlers/buttonHandlers");
  await handleFoundryButton(client, interaction);
}

/**
 * Handle admin button interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleAdminButtonInteraction(client, interaction) {
  // Implementation would be in a separate handler module
  const { handleAdminButton } = require("../handlers/adminHandlers");
  await handleAdminButton(client, interaction);
}

/**
 * Handle select menu interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
async function handleSelectMenuInteraction(client, interaction) {
  // Implementation would be in a separate handler module
  const { handleSelectMenu } = require("../handlers/selectMenuHandlers");
  await handleSelectMenu(client, interaction);
}

/**
 * Handle modal submit interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleModalSubmit(client, interaction) {
  // Implementation would be in a separate handler module
  const { handleModal } = require("../handlers/modalHandlers");
  await handleModal(client, interaction);
}

module.exports = {
  handleInteractionCreate,
  handleSlashCommand,
  handleButtonInteraction,
  handleAdminButtonInteraction,
  handleSelectMenuInteraction,
  handleModalSubmit,
};