const { MessageFlags } = require("discord.js");
const { logger } = require("../../utils/logger");
const { ErrorHandler } = require("../../utils/error-handler");

class SelectMenuHandler {
  constructor(client, lambdaService, discordService) {
    this.client = client;
    this.lambdaService = lambdaService;
    this.discordService = discordService;
  }

  async handle(interaction) {
    const parts = interaction.customId.split("_");

    if (parts[0] !== "foundry") return;

    try {
      let menuType, userId;

      if (parts[1] === "version") {
        menuType = "version";
        userId = parts[2];
      } else if (parts[1] === "license" && parts[2] === "select") {
        menuType = "license";
        userId = parts[3];
      } else {
        logger.warn(`Unknown select menu: ${interaction.customId}`);
        return;
      }

      // Check permissions
      if (
        userId !== interaction.user.id &&
        interaction.guild &&
        !this.discordService.hasAdminRole(interaction.member)
      ) {
        return await interaction.reply({
          content: "❌ You can only control your own instance.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (menuType === "version") {
        await this.handleVersionSelection(interaction, userId);
      } else if (menuType === "license") {
        await this.handleLicenseSelection(interaction, userId);
      }
    } catch (error) {
      logger.error("Select menu handler error:", error);
      await ErrorHandler.handleInteractionError(interaction, error);
    }
  }

  async handleVersionSelection(interaction, userId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const selectedVersion = interaction.values[0];

      // Check current version
      const currentStatus = await this.lambdaService.getInstanceStatus(userId);

      if (currentStatus.foundryVersion === selectedVersion) {
        return await interaction.editReply({
          content: `ℹ️ Your instance is already using version **${selectedVersion}**`,
        });
      }

      // Update version
      await this.lambdaService.updateVersion(userId, selectedVersion);

      const versionLabels = {
        13: "v13 - Latest Stable",
        release: "Release - Current Stable",
        12: "v12 - Previous Major",
        11: "v11 - Legacy Major",
        "13.346.0": "v13.346.0 - Specific Build",
        latest: "Latest - Bleeding Edge",
      };

      await interaction.editReply({
        content: `✅ **Version updated to ${versionLabels[selectedVersion]}**\n\nStart/restart your instance to use the new version.`,
      });

      logger.info(`Version updated for user ${userId}: ${selectedVersion}`);
    } catch (error) {
      logger.error(`Version selection error for ${userId}:`, error);
      throw error;
    }
  }

  async handleLicenseSelection(interaction, userId) {
    const selectedValue = interaction.values[0];
    const [licenseType, sharing] = selectedValue.split("_");

    await interaction.deferUpdate();

    try {
      if (licenseType === "pooled") {
        await this.createPooledInstance(interaction, userId);
      } else {
        await this.showCredentialsModal(
          interaction,
          userId,
          licenseType,
          sharing === "share"
        );
      }
    } catch (error) {
      logger.error(`License selection error for ${userId}:`, error);
      await interaction.editReply({
        content: `❌ Failed to process license selection: ${error.message}`,
        components: [],
      });
    }
  }

  async createPooledInstance(interaction, userId) {
    logger.info(`Creating pooled instance for user ${userId}`);
    await interaction.editReply({
      content: "🔄 Creating pooled instance... (Implementation in progress)",
      components: [],
    });
  }

  async showCredentialsModal(interaction, userId, licenseType, allowSharing) {
    logger.info(
      `Showing credentials modal for user ${userId}, type: ${licenseType}, sharing: ${allowSharing}`
    );
    // Implementation will show the credentials modal
  }
}

module.exports = { SelectMenuHandler };
