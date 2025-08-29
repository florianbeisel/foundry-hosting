const { MessageFlags, EmbedBuilder } = require("discord.js");
const { logger } = require("../../utils/logger");
const { ErrorHandler } = require("../../utils/error-handler");

class ButtonHandler {
  constructor(client, lambdaService, discordService) {
    this.client = client;
    this.lambdaService = lambdaService;
    this.discordService = discordService;
  }

  async handle(interaction) {
    const parts = interaction.customId.split("_");
    const [action, subAction] = parts;

    if (action === "foundry") {
      await this.handleFoundryButton(interaction, parts);
    } else if (action === "admin") {
      await this.handleAdminButton(interaction, parts);
    }
  }

  async handleFoundryButton(interaction, parts) {
    const [, subAction] = parts;
    let userId;

    // Parse button ID formats
    if (parts.length === 2 && subAction === "register") {
      userId = interaction.user.id;
    } else if (parts.length === 3) {
      userId = parts[2];
    } else if (parts.length >= 4) {
      // Handle complex button formats
      userId = this.parseComplexButtonId(parts);
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

    try {
      switch (subAction) {
        case "register":
          await this.handleRegister(interaction, userId);
          break;
        case "start":
          await this.handleStart(interaction, userId);
          break;
        case "stop":
          await this.handleStop(interaction, userId);
          break;
        case "status":
          await this.handleStatus(interaction, userId);
          break;
        case "adminkey":
          await this.handleAdminKey(interaction, userId);
          break;
        case "destroy":
          await this.handleDestroy(interaction, userId);
          break;
        case "schedule":
          await this.handleSchedule(interaction, userId);
          break;
        case "sessions":
          await this.handleSessions(interaction, userId);
          break;
        case "license":
          if (parts[2] === "sharing") {
            await this.handleLicenseSharing(interaction, userId);
          }
          break;
        default:
          logger.warn(`Unknown button action: ${subAction}`);
      }
    } catch (error) {
      logger.error(`Button handler error for ${subAction}:`, error);
      await ErrorHandler.handleButtonError(interaction, error, userId);
    }
  }

  parseComplexButtonId(parts) {
    // Handle various button ID formats
    if (parts.length === 4) {
      return parts[3]; // foundry_action_param_userId
    } else if (parts.length === 5) {
      return parts[4]; // foundry_action_param1_param2_userId
    }
    return null;
  }

  async handleRegister(interaction, userId) {
    if (!interaction.guild) {
      return await interaction.reply({
        content:
          "❌ **Instance creation must be done in the server**\n\nPlease use `/foundry dashboard` in the server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Implementation will delegate to registration handler
    logger.info(`Registration button clicked by user ${userId}`);
    await interaction.editReply({
      content: "🔄 Registration flow starting... (Implementation in progress)",
    });
  }

  async handleStart(interaction, userId) {
    await interaction.deferReply();

    try {
      const result = await this.lambdaService.startInstance(userId);

      // Get or create user command channel
      let channel;
      const user = await this.client.users.fetch(userId);

      channel = await this.discordService.findExistingCommandChannel(
        interaction.guild,
        userId,
        user.username
      );

      if (!channel) {
        channel = await this.discordService.createUserCommandChannel(
          interaction.guild,
          userId,
          user.username
        );
      }

      if (channel) {
        await interaction.editReply({
          content: `🚀 Starting... Check ${channel}`,
        });

        const embed = new EmbedBuilder()
          .setColor("#ffff00")
          .setTitle("🚀 Starting Instance")
          .setDescription("Starting up, takes 2-3 minutes.")
          .addFields([
            { name: "Status", value: "🟡 Starting", inline: true },
            { name: "Estimated Time", value: "2-3 minutes", inline: true },
            {
              name: "Your URL",
              value: result.url || "Will be available shortly",
              inline: false,
            },
          ])
          .setTimestamp();

        await this.discordService.safeChannelSend(channel, { embeds: [embed] });
      }

      logger.info(`Instance start requested for user ${userId}`);
    } catch (error) {
      logger.error(`Start instance error for ${userId}:`, error);
      throw error;
    }
  }

  async handleStop(interaction, userId) {
    await interaction.deferReply();

    try {
      await this.lambdaService.stopInstance(userId);

      logger.info(`Instance stop requested for user ${userId}`);
      await interaction.editReply({
        content: "⏹️ Instance stopped successfully.",
      });
    } catch (error) {
      logger.error(`Stop instance error for ${userId}:`, error);
      throw error;
    }
  }

  async handleStatus(interaction, userId) {
    await interaction.deferReply();

    try {
      const result = await this.lambdaService.getInstanceStatus(userId);
      const embed = StatusEmbedBuilder.create(result);

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      logger.error(`Status check error for ${userId}:`, error);
      throw error;
    }
  }

  async handleAdminKey(interaction, userId) {
    await interaction.deferReply();

    try {
      const result = await this.lambdaService.getInstanceStatus(userId);
      const user = await this.client.users.fetch(userId);

      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🔑 Admin Key")
        .setDescription("Your administrator password")
        .addFields([
          { name: "Key", value: `\`${result.adminKey}\``, inline: false },
          {
            name: "Usage",
            value: "Use when logging in as admin",
            inline: false,
          },
        ])
        .setTimestamp();

      await user.send({ embeds: [embed] });
      await interaction.editReply({
        content: "🔑 I've sent your admin key to your DMs for security.",
      });
    } catch (error) {
      logger.error(`Admin key error for ${userId}:`, error);
      throw error;
    }
  }

  async handleDestroy(interaction, userId) {
    logger.info(`Destroy button clicked by user ${userId}`);
    await interaction.editReply({
      content: "🔄 Destroy flow starting... (Implementation in progress)",
    });
  }

  async handleSchedule(interaction, userId) {
    logger.info(`Schedule button clicked by user ${userId}`);
    // Will show modal for scheduling
  }

  async handleSessions(interaction, userId) {
    await interaction.deferReply();

    try {
      const result = await this.lambdaService.listSessions(userId);

      if (result.count === 0) {
        const embed = new EmbedBuilder()
          .setColor("#888888")
          .setTitle("📋 Your Scheduled Sessions")
          .setDescription("You have no scheduled sessions.")
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Create sessions list embed
      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`📋 Your Scheduled Sessions (${result.count})`)
        .setTimestamp();

      const sessionsText = result.sessions
        .map((session, index) => {
          const statusMap = {
            scheduled: "🕒 Scheduled",
            active: "🟢 Active",
            completed: "✅ Completed",
            cancelled: "❌ Cancelled",
          };
          const status = statusMap[session.status] || "❔ Unknown";

          return [
            `**${index + 1}. ${session.title || "Gaming Session"}**`,
            `${status} | <t:${session.startTime}:F> - <t:${session.endTime}:t>`,
            session.description ? `*${session.description}*` : "",
            "",
          ]
            .filter((line) => line)
            .join("\n");
        })
        .join("\n");

      embed.setDescription(
        sessionsText.length > 4000
          ? sessionsText.substring(0, 3950) + "\n\n... (list truncated)"
          : sessionsText
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Sessions list error for ${userId}:`, error);
      throw error;
    }
  }

  async handleLicenseSharing(interaction, userId) {
    logger.info(`License sharing button clicked by user ${userId}`);
    await interaction.editReply({
      content: "🔄 License sharing management... (Implementation in progress)",
    });
  }

  async handleAdminButton(interaction, parts) {
    if (!this.discordService.hasAdminRole(interaction.member)) {
      return await interaction.reply({
        content: "❌ Admin access required.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const [, action] = parts;

    try {
      switch (action) {
        case "refresh":
          await this.handleAdminRefresh(interaction);
          break;
        case "detailed":
          await this.handleAdminDetailed(interaction);
          break;
        case "emergency":
          await this.handleAdminEmergency(interaction);
          break;
        default:
          logger.warn(`Unknown admin action: ${action}`);
      }
    } catch (error) {
      logger.error(`Admin button error for ${action}:`, error);
      await ErrorHandler.handleButtonError(interaction, error, "admin");
    }
  }

  async handleAdminRefresh(interaction) {
    await interaction.deferUpdate();
    logger.info("Admin refresh requested");
    // Implementation will refresh admin status
  }

  async handleAdminDetailed(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info("Admin detailed view requested");
    // Implementation will show detailed view
  }

  async handleAdminEmergency(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    logger.info("Admin emergency actions requested");
    // Implementation will show emergency options
  }
}

module.exports = { ButtonHandler };
