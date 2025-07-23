const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const { hasAdminRole } = require("../utils/permissions");
const { invokeLambda } = require("../services/lambdaService");

// Import command handlers
const { handleDashboard } = require("../commands/user/dashboard");
const { handleHelp } = require("../commands/user/help");
const { handleLicenseSharing } = require("../commands/user/licenseSharing");
const { handleAdminOverview } = require("../commands/admin/overview");
const { handleSetupRegistration } = require("../commands/admin/setupRegistration");
const { handleRecreateRegistration } = require("../commands/admin/recreateRegistration");
const { handleCleanupMappings } = require("../commands/admin/cleanupMappings");
const { handleTestLog } = require("../commands/admin/testLog");

module.exports = {
  data: new SlashCommandBuilder()
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
          subcommand.setName("help").setDescription("Display help information")
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
    ),

  async execute(interaction) {
    // Add helper methods to interaction
    interaction.hasAdminRole = () => {
      if (!interaction.guild || !interaction.member) return false;

      // Check Discord's built-in Administrator permission first
      if (
        interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return true;
      }

      // Then check custom admin roles
      const adminRoles = process.env.ADMIN_ROLES?.split(",") || ["Admin"];
      return adminRoles.some((role) =>
        interaction.member.roles.cache.some(
          (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
        )
      );
    };

    interaction.invokeLambda = invokeLambda;

    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    // Handle user commands
    if (subcommandGroup === "user") {
      switch (subcommand) {
        case "dashboard":
          await handleDashboard(interaction);
          break;
        case "help":
          await handleHelp(interaction);
          break;
        case "license-sharing":
          await handleLicenseSharing(interaction);
          break;
        default:
          await interaction.reply({
            content: "❌ Unknown user command.",
            flags: MessageFlags.Ephemeral,
          });
      }
      return;
    }

    // Handle admin commands
    if (subcommandGroup === "admin") {
      // Check admin permissions
      if (!interaction.hasAdminRole()) {
        return await interaction.reply({
          content: "❌ Admin access required for this command.",
          flags: MessageFlags.Ephemeral,
        });
      }

      switch (subcommand) {
        case "overview":
          await handleAdminOverview(interaction);
          break;
        case "setup-registration":
          await handleSetupRegistration(interaction);
          break;
        case "recreate-registration":
          await handleRecreateRegistration(interaction);
          break;
        case "cleanup-mappings":
          await handleCleanupMappings(interaction);
          break;
        case "test-log":
          await handleTestLog(interaction);
          break;
        default:
          await interaction.reply({
            content: "❌ Unknown admin command.",
            flags: MessageFlags.Ephemeral,
          });
      }
      return;
    }

    // Fallback for unknown command groups
    await interaction.reply({
      content:
        "❌ Unknown command group. Use `/foundry user` or `/foundry admin`.",
      flags: MessageFlags.Ephemeral,
    });
  },
};