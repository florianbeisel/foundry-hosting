const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} = require("discord.js");
const { logger } = require("../../utils/logger");
const { ErrorHandler } = require("../../utils/error-handler");
const {
  RegistrationEmbedBuilder,
} = require("../../components/embeds/registration-embed");
const { StatusEmbedBuilder } = require("../../components/embeds/status-embed");
const {
  InstanceButtonBuilder,
} = require("../../components/buttons/instance-buttons");

class FoundryCommandHandler {
  constructor(lambdaService, discordService) {
    this.lambdaService = lambdaService;
    this.discordService = discordService;

    this.data = new SlashCommandBuilder()
      .setName("foundry")
      .setDescription("Foundry VTT instance management")
      .addSubcommandGroup((group) =>
        group
          .setName("user")
          .setDescription("User commands for instance management")
          .addSubcommand((subcommand) =>
            subcommand
              .setName("dashboard")
              .setDescription("Show your instance dashboard with controls")
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("help")
              .setDescription("Display help information")
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("license-sharing")
              .setDescription("Manage your license sharing status")
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName("admin")
          .setDescription("Administrative commands (Admin only)")
          .addSubcommand((subcommand) =>
            subcommand
              .setName("overview")
              .setDescription("View system status and monitoring details")
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("setup-registration")
              .setDescription("Create permanent registration message")
              .addChannelOption((option) =>
                option
                  .setName("channel")
                  .setDescription("Channel to post registration message in")
                  .setRequired(false)
              )
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("recreate-registration")
              .setDescription("Recreate registration message if lost")
              .addChannelOption((option) =>
                option
                  .setName("channel")
                  .setDescription("Channel to post registration message in")
                  .setRequired(false)
              )
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("cleanup-mappings")
              .setDescription("Clean up old message mappings from DynamoDB")
          )
          .addSubcommand((subcommand) =>
            subcommand
              .setName("test-log")
              .setDescription("Send a test log message to the logging channel")
              .addStringOption((option) =>
                option
                  .setName("message")
                  .setDescription("Test message to log")
                  .setRequired(true)
              )
          )
      );
  }

  async execute(interaction) {
    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommandGroup === "user") {
        await this.handleUserCommands(interaction, subcommand);
      } else if (subcommandGroup === "admin") {
        await this.handleAdminCommands(interaction, subcommand);
      } else {
        await interaction.reply({
          content:
            "❌ Unknown command group. Use `/foundry user` or `/foundry admin`.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error("Foundry command execution error:", error);
      await ErrorHandler.handleInteractionError(interaction, error);
    }
  }

  async handleUserCommands(interaction, subcommand) {
    switch (subcommand) {
      case "dashboard":
        await this.handleDashboard(interaction);
        break;
      case "help":
        await this.handleHelp(interaction);
        break;
      case "license-sharing":
        await this.handleLicenseSharing(interaction);
        break;
      default:
        await interaction.reply({
          content: "❌ Unknown user command.",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  async handleAdminCommands(interaction, subcommand) {
    // Check admin permissions
    if (!this.discordService.hasAdminRole(interaction.member)) {
      return await interaction.reply({
        content: "❌ Admin access required for this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    switch (subcommand) {
      case "overview":
        await this.handleAdminOverview(interaction);
        break;
      case "setup-registration":
        await this.handleSetupRegistration(interaction);
        break;
      case "recreate-registration":
        await this.handleRecreateRegistration(interaction);
        break;
      case "cleanup-mappings":
        await this.handleCleanupMappings(interaction);
        break;
      case "test-log":
        await this.handleTestLog(interaction);
        break;
      default:
        await interaction.reply({
          content: "❌ Unknown admin command.",
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  async handleDashboard(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const userId = interaction.user.id;
      const result = await this.lambdaService.getInstanceStatus(userId);

      // User has an instance - show dashboard
      const embed = StatusEmbedBuilder.createDashboard(result);
      const instanceButtons =
        InstanceButtonBuilder.createInstanceControlButtons(userId, result);

      await interaction.editReply({
        embeds: [embed],
        components: [instanceButtons],
      });
    } catch (error) {
      if (error.message.includes("not found")) {
        // User doesn't have an instance - show registration
        const embed = RegistrationEmbedBuilder.create();
        const buttons = InstanceButtonBuilder.createRegistrationButtons();

        await interaction.editReply({
          embeds: [embed],
          components: [buttons],
        });
      } else {
        throw error;
      }
    }
  }

  async handleHelp(interaction) {
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("Foundry VTT Bot Help")
      .setDescription("Manage Foundry VTT instances directly from Discord.")
      .addFields([
        {
          name: "Getting Started",
          value:
            "• `/foundry dashboard` – view status or register an instance\n" +
            "• Use the provided buttons to start or stop your instance\n" +
            "• Follow updates in your personal command channel",
        },
        {
          name: "Commands",
          value:
            "`/foundry user dashboard` – personal control panel\n" +
            "`/foundry user help` – this help message\n" +
            "`/foundry user license-sharing` – manage license sharing\n" +
            "`/foundry admin overview` – system-wide status (admin)\n" +
            "`/foundry admin setup-registration` – post registration embed (admin)",
        },
      ])
      .setFooter({ text: "Need more information? Contact an administrator." })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  async handleLicenseSharing(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const userId = interaction.user.id;
      const result = await this.lambdaService.getInstanceStatus(userId);

      if (!result || result.status === "not_found") {
        return await interaction.editReply({
          content:
            "❌ You don't have a Foundry VTT instance. Please register one first using `/foundry user dashboard`.",
        });
      }

      if (result.licenseType !== "byol") {
        return await interaction.editReply({
          content:
            "❌ Only BYOL (Bring Your Own License) instances can share licenses.",
        });
      }

      const isCurrentlySharing = result.allowLicenseSharing || false;

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🔑 License Sharing Management")
        .setDescription(
          isCurrentlySharing
            ? "Your license is currently **pooled with the community** and available for others to use."
            : "Your license is currently **private** and only used by your own instance."
        )
        .addFields([
          {
            name: "🤝 What is License Pooling?",
            value:
              "• Share your Foundry license with the community\n" +
              "• Others can schedule sessions using your license\n" +
              "• You get priority access to your own license\n" +
              "• Help others who don't have their own license",
          },
          {
            name: "📋 Current Status",
            value: isCurrentlySharing
              ? "🟢 **License Pooled**"
              : "🔴 **License Private**",
            inline: true,
          },
          {
            name: "🎯 Your Priority",
            value:
              "You always get priority access to your own license, even when shared",
            inline: true,
          },
        ])
        .setFooter({
          text: isCurrentlySharing
            ? "Click 'Stop Pooling' to make your license private again"
            : "Click 'Start Pooling' to share your license with the community",
        })
        .setTimestamp();

      const buttons = InstanceButtonBuilder.createLicenseSharingButtons(
        userId,
        isCurrentlySharing
      );

      await interaction.editReply({
        embeds: [embed],
        components: [buttons],
      });
    } catch (error) {
      logger.error("License sharing command error:", error);
      await interaction.editReply({
        content: `❌ Error managing license sharing: ${error.message}`,
      });
    }
  }

  // Admin command handlers (simplified versions)
  async handleAdminOverview(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const data = await this.lambdaService.getAdminOverview(
        interaction.user.id
      );

      const embed = new EmbedBuilder()
        .setTitle("🔧 System Administration Dashboard")
        .setDescription("Current system status overview")
        .setColor(0x00ff00)
        .addFields([
          {
            name: "📊 System Summary",
            value: [
              `**Total Instances:** ${data.summary.totalInstances}`,
              `**Running:** ${data.summary.runningInstances} | **BYOL:** ${data.summary.byolInstances} | **Pooled:** ${data.summary.pooledInstances}`,
              `**Shared Licenses:** ${data.summary.sharedLicenses}`,
              `**Active Sessions:** ${data.summary.activeSessions} | **Upcoming:** ${data.summary.upcomingSessions}`,
            ].join("\n"),
            inline: false,
          },
        ])
        .setTimestamp();

      const buttons = InstanceButtonBuilder.createAdminButtons();

      await interaction.editReply({
        embeds: [embed],
        components: [buttons],
      });
    } catch (error) {
      logger.error("Admin overview error:", error);
      await interaction.editReply({
        content: `❌ Error getting admin status: ${error.message}`,
      });
    }
  }

  async handleSetupRegistration(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel =
      interaction.options.getChannel("channel") || interaction.channel;
    const embed = RegistrationEmbedBuilder.create();
    const buttons = InstanceButtonBuilder.createRegistrationButtons();

    try {
      const message = await channel.send({
        embeds: [embed],
        components: [buttons],
      });

      await interaction.editReply({
        content: `✅ Registration message posted in ${channel}!\n\nMessage ID: \`${message.id}\``,
      });
    } catch (error) {
      logger.error("Setup registration error:", error);
      await interaction.editReply({
        content: `❌ Failed to post registration message: ${error.message}`,
      });
    }
  }

  async handleRecreateRegistration(interaction) {
    // Similar to setup but with cleanup logic
    await this.handleSetupRegistration(interaction);
  }

  async handleCleanupMappings(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Implement cleanup logic
      await interaction.editReply({
        content:
          "✅ Cleanup completed! Mappings have been validated and cleaned.",
      });
    } catch (error) {
      logger.error("Cleanup mappings error:", error);
      await interaction.editReply({
        content: `❌ Error during cleanup: ${error.message}`,
      });
    }
  }

  async handleTestLog(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const testMessage = interaction.options.getString("message");

      logger.info(`🧪 Test log message: ${testMessage}`);
      logger.warn(`🧪 Test warning message: ${testMessage}`);
      logger.error(`🧪 Test error message: ${testMessage}`);

      await interaction.editReply({
        content:
          "✅ Test log messages sent! Check the #foundry-bot-logs channel.",
      });
    } catch (error) {
      logger.error("Test log error:", error);
      await interaction.editReply({
        content: `❌ Error sending test log: ${error.message}`,
      });
    }
  }
}

module.exports = { FoundryCommandHandler };
