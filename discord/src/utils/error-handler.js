const { EmbedBuilder, MessageFlags } = require("discord.js");
const { logger } = require("./logger");

class ErrorHandler {
  static handle(error, context = null) {
    logger.error(`Error${context ? ` in ${context}` : ""}:`, error);

    // Add any error reporting/monitoring logic here
    // e.g., send to external monitoring service
  }

  static async handleInteractionError(interaction, error) {
    logger.error("Interaction error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(`An error occurred: ${error.message}`)
      .setTimestamp();

    const errorMessage = {
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      logger.error("Failed to send error message to user:", replyError);
    }
  }

  static async handleButtonError(interaction, error, userId) {
    logger.error(`Button error for user ${userId}:`, error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Button Action Failed")
      .setDescription(`Error: ${error.message}`)
      .setTimestamp();

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      logger.error("Failed to send button error message:", replyError);
    }
  }
}

module.exports = { ErrorHandler };
