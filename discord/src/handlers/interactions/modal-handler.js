const { MessageFlags } = require("discord.js");
const { logger } = require("../../utils/logger");
const { ErrorHandler } = require("../../utils/error-handler");

class ModalHandler {
  constructor(client, lambdaService, discordService) {
    this.client = client;
    this.lambdaService = lambdaService;
    this.discordService = discordService;
  }

  async handle(interaction) {
    try {
      if (interaction.customId.startsWith("foundry_credentials_")) {
        await this.handleCredentialsModal(interaction);
      } else if (interaction.customId.startsWith("foundry_schedule_modal_")) {
        await this.handleScheduleModal(interaction);
      } else {
        logger.warn(`Unknown modal: ${interaction.customId}`);
      }
    } catch (error) {
      logger.error("Modal handler error:", error);
      await ErrorHandler.handleInteractionError(interaction, error);
    }
  }

  async handleCredentialsModal(interaction) {
    const modalIdParts = interaction.customId.split("_");
    const userId = modalIdParts[2];
    const licenseType = modalIdParts[3];
    const allowLicenseSharing = modalIdParts[4] === "true";

    // Verify user
    if (userId !== interaction.user.id) {
      return await interaction.reply({
        content: "❌ You can only register your own instance.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.guild) {
      return await interaction.reply({
        content: "❌ **Instance creation must be done in the server**",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await interaction.editReply({
        content:
          "🔄 **Creating your instance...**\n\nThis takes a few moments. Please wait...",
      });

      const username = interaction.fields.getTextInputValue("foundry_username");
      const password = interaction.fields.getTextInputValue("foundry_password");

      const user = await this.client.users.fetch(userId);
      const sanitizedUsername =
        this.discordService.guildManager.sanitizeUsername(user.username);

      const result = await this.lambdaService.createInstance({
        userId,
        sanitizedUsername,
        foundryUsername: username,
        foundryPassword: password,
        licenseType,
        allowLicenseSharing,
        maxConcurrentUsers: 1,
      });

      // Create command channel
      const channel = await this.discordService.createUserCommandChannel(
        interaction.guild,
        userId,
        user.username
      );

      logger.info(
        `Instance created for user ${userId} in channel ${channel.id}`
      );

      await interaction.editReply({
        content: `✅ **Instance created**\n\nChannel: ${channel}\nAdmin key sent to DMs`,
      });
    } catch (error) {
      logger.error("Registration error:", error);
      await interaction.editReply({
        content: `❌ **Failed to create instance**\n\n**Error:** ${error.message}`,
      });
    }
  }

  async handleScheduleModal(interaction) {
    const userId = interaction.customId.split("_")[3];

    if (userId !== interaction.user.id) {
      return await interaction.reply({
        content: "❌ You can only schedule sessions for your own instance.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const title =
        interaction.fields.getTextInputValue("session_title") ||
        "Gaming Session";
      const startTimeStr = interaction.fields.getTextInputValue("start_time");
      const timezoneStr = interaction.fields.getTextInputValue("timezone");
      const durationStr = interaction.fields.getTextInputValue("duration");

      // Parse and validate input
      const { startTime, endTime } = this.parseScheduleInput(
        startTimeStr,
        timezoneStr,
        durationStr
      );

      const statusResult = await this.lambdaService.getInstanceStatus(userId);
      const licenseType = statusResult.licenseType || "byol";
      const preferredLicenseId =
        licenseType === "byol" ? `byol-${userId}` : undefined;

      const result = await this.lambdaService.scheduleSession({
        userId,
        startTime: Math.floor(startTime.getTime() / 1000),
        endTime: Math.floor(endTime.getTime() / 1000),
        licenseType,
        sessionTitle: title,
        sessionDescription: `Scheduled from ${timezoneStr} timezone`,
        preferredLicenseId,
      });

      if (result.success) {
        await interaction.editReply({
          content: `✅ **Session scheduled successfully!**\n\nSession ID: \`${
            result.sessionId
          }\`\nStarts: <t:${Math.floor(startTime.getTime() / 1000)}:F>`,
        });
      } else {
        throw new Error(result.message || "Failed to schedule session");
      }
    } catch (error) {
      logger.error("Schedule modal error:", error);
      await interaction.editReply({
        content: `❌ Failed to schedule session: ${error.message}`,
      });
    }
  }

  parseScheduleInput(startTimeStr, timezoneStr, durationStr) {
    // Parse start time (YYYY-MM-DD HH:MM format)
    const startTimeMatch = startTimeStr.match(
      /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/
    );
    if (!startTimeMatch) {
      throw new Error(
        "Invalid start time format. Use YYYY-MM-DD HH:MM (e.g., '2024-01-15 19:00')"
      );
    }

    const [, year, month, day, hour, minute] = startTimeMatch;

    // Parse duration
    const duration = parseFloat(durationStr);
    if (isNaN(duration) || duration <= 0 || duration > 24) {
      throw new Error("Duration must be a number between 0 and 24 hours");
    }

    // Simple timezone parsing (basic implementation)
    const timezoneMap = {
      EST: -5,
      EDT: -4,
      CST: -6,
      CDT: -5,
      MST: -7,
      MDT: -6,
      PST: -8,
      PDT: -7,
      GMT: 0,
      UTC: 0,
      BST: 1,
      CET: 1,
      CEST: 2,
    };

    let offsetHours = timezoneMap[timezoneStr.toUpperCase()] || 0;

    // Create local time and convert to UTC
    const localTime = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );

    const startTime = new Date(
      localTime.getTime() - offsetHours * 60 * 60 * 1000
    );

    if (startTime <= new Date()) {
      throw new Error("Start time must be in the future");
    }

    const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

    return { startTime, endTime };
  }

  async handleAdminButton(interaction, parts) {
    if (!this.discordService.hasAdminRole(interaction.member)) {
      return await interaction.reply({
        content: "❌ Admin access required.",
        flags: MessageFlags.Ephemeral,
      });
    }

    logger.info("Admin button interaction:", parts.join("_"));
    // Implementation for admin buttons
  }
}

module.exports = { ModalHandler };
