const { EmbedBuilder } = require("discord.js");
const { hasRequiredRole } = require("../utils/permissions");
const { handleSlashCommand } = require("../handlers/slashCommandHandler");
const { handleButtonInteraction } = require("../handlers/buttonHandler");
const { handleSelectMenuInteraction } = require("../handlers/selectMenuHandler");
const { handleModalSubmit } = require("../handlers/modalHandler");
const { handleAdminButtonInteraction } = require("../handlers/adminButtonHandler");

async function handleInteraction(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, client);
    } else if (interaction.isButton()) {
      // Check if it's an admin button
      if (interaction.customId.startsWith("admin_")) {
        await handleAdminButtonInteraction(interaction, client);
      } else {
        await handleButtonInteraction(interaction, client);
      }
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction, client);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction, client);
    }
  } catch (error) {
    console.error("Interaction handling error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(`An error occurred: ${error.message}`)
      .setTimestamp();

    const errorMessage = { embeds: [errorEmbed], ephemeral: true };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
    }
  }
}

module.exports = {
  handleInteraction,
};