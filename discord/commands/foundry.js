const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

// =================
// SUPPORTER ROLES
// =================

const SUPPORTER_ROLES = {
  "699727231794020353": 15, // $15 supporter
  "699727011979067484": 10, // $10 supporter
  "699727432424620033": 5, // $5 supporter
};

function getUserSupporterAmount(member) {
  if (!member) return 0;

  for (const [roleId, amount] of Object.entries(SUPPORTER_ROLES)) {
    if (member.roles.cache.has(roleId)) {
      return amount;
    }
  }
  return 0;
}

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

    interaction.invokeLambda = async (payload) => {
      const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
      const lambda = new LambdaClient({
        region: process.env.AWS_REGION || "us-east-1",
      });

      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify(payload),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      return JSON.parse(response.body);
    };

    interaction.getUserCostsWithSupporter = async (userId) => {
      try {
        // Get user's supporter amount
        let supporterAmount = 0;
        if (interaction.guild && interaction.member) {
          supporterAmount = getUserSupporterAmount(interaction.member);
        }

        // Get base cost data from Lambda
        const costData = await interaction.invokeLambda({
          action: "get-user-costs",
          userId: userId,
        });

        // Apply supporter discount
        const supporterDiscount = supporterAmount;
        const adjustedUncoveredCost = Math.max(
          0,
          costData.uncoveredCost - supporterDiscount
        );

        return {
          ...costData,
          supporterAmount,
          supporterDiscount,
          adjustedUncoveredCost,
          isSupporter: supporterAmount > 0,
        };
      } catch (error) {
        console.error("Error getting user costs with supporter info:", error);
        throw error;
      }
    };

    interaction.createUserCommandChannel = (userId, username) =>
      createUserCommandChannel(interaction.guild, userId, username);
    interaction.deleteUserCommandChannel = (userId) =>
      deleteUserCommandChannel(interaction.guild, userId);
    interaction.startStatusMonitoring = startStatusMonitoring;
    interaction.saveRegistrationStatsMappingToDB =
      saveRegistrationStatsMappingToDB;
    interaction.saveAdminStatusMappingToDB = saveAdminStatusMappingToDB;
    interaction.addRegistrationStatsMapping = async (channelId, messageId) => {
      // Store in interaction client's memory
      if (interaction.client.registrationStats) {
        interaction.client.registrationStats.set(channelId, messageId);
      }
      const saved = await saveRegistrationStatsMappingToDB(
        channelId,
        messageId
      );
      if (!saved) {
        console.error(
          "⚠️ Failed to save registration stats mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };
    interaction.addAdminStatusMapping = async (channelId, messageId) => {
      // Store in interaction client's memory
      if (interaction.client.adminStatusMapping) {
        interaction.client.adminStatusMapping.set(channelId, messageId);
      }
      const saved = await saveAdminStatusMappingToDB(channelId, messageId);
      if (!saved) {
        console.error(
          "⚠️ Failed to save admin status mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };

    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    // Handle user commands
    if (subcommandGroup === "user") {
      switch (subcommand) {
        case "dashboard":
          await handleDashboard(interaction, interaction.user.id);
          break;
        case "help":
          await handleHelp(interaction);
          break;
        case "license-sharing":
          await handleLicenseSharing(interaction, interaction.user.id);
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

async function handleDashboard(interaction, userId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user has an instance
    const result = await interaction.invokeLambda({
      action: "status",
      userId: userId,
    });

    // User has an instance - show status and controls
    const statusEmoji = {
      running: "🟢",
      starting: "🟡",
      stopping: "🟠",
      stopped: "🔴",
      created: "⚪",
      unknown: "❔",
    };

    // Determine license display text and get license owner info - handle missing data carefully
    let licenseDisplay;
    let licenseOwnerInfo = null;
    const licenseType = result.licenseType;

    if (!licenseType) {
      // Handle missing license type - check other indicators
      if (
        result.licenseOwnerId &&
        result.licenseOwnerId !== `byol-${result.userId}`
      ) {
        // Has a license owner that's not themselves = shared instance
        licenseDisplay = "🌐 Shared Instance (Community License)";
        // Try to get owner info
        try {
          const adminResult = await interaction.invokeLambda({
            action: "admin-overview",
            userId: result.userId,
          });
          if (adminResult.licenses && adminResult.licenses.pools) {
            const licensePool = adminResult.licenses.pools.find(
              (pool) => pool.licenseId === result.licenseOwnerId
            );
            if (licensePool) {
              licenseOwnerInfo = licensePool.ownerUsername;
              licenseDisplay = `🌐 Shared Instance (${licenseOwnerInfo}'s License Pool)`;
            }
          }
        } catch (error) {
          console.log("Could not fetch license owner info for dashboard");
        }
      } else {
        // Default to BYOL for missing data
        licenseDisplay = `🔑 BYOL (Own License)${
          result.allowLicenseSharing ? " - Pooled" : ""
        }`;
      }
    } else if (licenseType === "byol") {
      licenseDisplay = `🔑 BYOL (Own License)${
        result.allowLicenseSharing ? " - Pooled" : ""
      }`;
    } else if (licenseType === "pooled") {
      // Get license owner info for shared instances
      if (result.licenseOwnerId) {
        try {
          const adminResult = await interaction.invokeLambda({
            action: "admin-overview",
            userId: result.userId,
          });

          if (adminResult.licenses && adminResult.licenses.pools) {
            const licensePool = adminResult.licenses.pools.find(
              (pool) => pool.licenseId === result.licenseOwnerId
            );
            if (licensePool) {
              licenseOwnerInfo = licensePool.ownerUsername;
              licenseDisplay = `🌐 Shared Instance (${licenseOwnerInfo}'s License Pool)`;
            } else {
              licenseDisplay = "🌐 Shared Instance (Community License)";
            }
          } else {
            licenseDisplay = "🌐 Shared Instance (Community License)";
          }
        } catch (error) {
          console.log("Could not fetch license owner info for dashboard");
          licenseDisplay = "🌐 Shared Instance (Community License)";
        }
      } else {
        licenseDisplay = "🌐 Shared Instance (Automatic Assignment)";
      }
    } else {
      // Unknown license type
      licenseDisplay = `❔ Unknown License Type: ${licenseType}`;
    }

    // Get monthly cost data with supporter information
    let costData = null;
    try {
      costData = await interaction.getUserCostsWithSupporter(userId);
    } catch (error) {
      console.log("Could not fetch cost data for dashboard:", error);
    }

    const embed = new EmbedBuilder()
      .setColor(result.status === "running" ? "#00ff00" : "#888888")
      .setTitle("🎲 Your Foundry VTT Dashboard")
      .setDescription(
        `Instance Status: ${statusEmoji[result.status]} **${result.status}**`
      )
      .addFields([
        { name: "Created", value: `<t:${result.createdAt}:R>`, inline: true },
        {
          name: "Last Updated",
          value: `<t:${result.updatedAt}:R>`,
          inline: true,
        },
        {
          name: "License Type",
          value: licenseDisplay,
          inline: true,
        },
        ...(costData
          ? [
              {
                name: "💰 This Month's Usage",
                value: `**${costData.hoursUsed.toFixed(
                  1
                )}h** = $${costData.totalCost.toFixed(2)}`,
                inline: true,
              },
              ...(costData.isSupporter
                ? [
                    {
                      name: "🎖️ Supporter Discount",
                      value: `$${costData.supporterAmount.toFixed(
                        2
                      )} monthly credit`,
                      inline: true,
                    },
                    {
                      name:
                        costData.adjustedUncoveredCost > 0
                          ? "💸 Remaining Cost"
                          : "✅ Fully Covered",
                      value:
                        costData.adjustedUncoveredCost > 0
                          ? `$${costData.adjustedUncoveredCost.toFixed(2)}`
                          : "All costs covered! 🎉",
                      inline: true,
                    },
                  ]
                : [
                    {
                      name:
                        costData.uncoveredCost > 0
                          ? "💸 Uncovered Cost"
                          : "✅ Fully Covered",
                      value:
                        costData.uncoveredCost > 0
                          ? `$${costData.uncoveredCost.toFixed(2)}`
                          : "All costs covered! 🎉",
                      inline: true,
                    },
                  ]),
              ...(costData.donationsReceived > 0
                ? [
                    {
                      name: "☕ Donations Received",
                      value: `$${costData.donationsReceived.toFixed(2)}${
                        costData.lastDonorName
                          ? ` (Latest: ${costData.lastDonorName})`
                          : ""
                      }`,
                      inline: true,
                    },
                  ]
                : []),
            ]
          : []),
        ...(licenseOwnerInfo
          ? [
              {
                name: "🤝 Thanks to",
                value: `**${licenseOwnerInfo}** for sharing their license with the community!`,
                inline: false,
              },
            ]
          : []),
      ])
      .setTimestamp();

    if (result.url && result.status === "running") {
      embed.addFields([{ name: "Access URL", value: result.url }]);

      // Add auto-shutdown information if available
      if (result.autoShutdownAt) {
        const shutdownTime = new Date(result.autoShutdownAt * 1000);
        const now = new Date();
        const timeLeft = Math.max(
          0,
          Math.floor((shutdownTime - now) / (1000 * 60))
        ); // minutes

        let shutdownText;
        if (timeLeft > 60) {
          shutdownText = `<t:${result.autoShutdownAt}:R> (${Math.floor(
            timeLeft / 60
          )}h ${timeLeft % 60}m left)`;
        } else if (timeLeft > 0) {
          shutdownText = `<t:${result.autoShutdownAt}:R> (${timeLeft}m left)`;
        } else {
          shutdownText = "⚠️ Overdue for shutdown";
        }

        embed.addFields([
          {
            name: "🕒 Auto-Shutdown",
            value: shutdownText,
            inline: true,
          },
        ]);
      }
    }

    if (result.foundryVersion) {
      embed.addFields([
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:${result.foundryVersion}\``,
          inline: true,
        },
      ]);
    }

    // Show next scheduled session if available
    if (result.nextScheduledSession) {
      const session = result.nextScheduledSession;
      embed.addFields([
        {
          name: "📅 Next Scheduled Session",
          value: `**${session.title || "Gaming Session"}**\nStarts <t:${
            session.startTime
          }:R> (<t:${session.startTime}:f>)`,
          inline: false,
        },
      ]);
    }

    // Show currently linked session if instance is running a scheduled session
    if (result.linkedSessionId && result.status === "running") {
      embed.addFields([
        {
          name: "🎮 Active Session",
          value: `Running scheduled session\nAuto-ends <t:${result.autoShutdownAt}:R>`,
          inline: true,
        },
      ]);
    }

    // Use the unified dashboard function instead of building components here
    await interaction.sendUnifiedDashboard(
      interaction.channel,
      userId,
      result,
      "dashboard"
    );
    return;
  } catch (error) {
    if (error.message.includes("not found")) {
      // User doesn't have an instance - show registration
      const embed = createRegistrationEmbed();
      const actionRow = createRegistrationActionRow();

      await interaction.editReply({ embeds: [embed], components: [actionRow] });
    } else {
      throw error;
    }
  }
}

async function handleHelp(interaction) {
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

async function handleLicenseSharing(interaction, userId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user has an instance
    const result = await interaction.invokeLambda({
      action: "status",
      userId: userId,
    });

    if (!result || result.status === "not_found") {
      return await interaction.editReply({
        content:
          "❌ You don't have a Foundry VTT instance. Please register one first using `/foundry user dashboard`.",
      });
    }

    // Check if user has a BYOL instance (only BYOL instances can share licenses)
    if (result.licenseType !== "byol") {
      return await interaction.editReply({
        content:
          "❌ Only BYOL (Bring Your Own License) instances can share licenses. Your instance uses a shared license from the community pool.",
      });
    }

    // Get current license sharing status
    const isCurrentlySharing = result.allowLicenseSharing || false;

    // Create embed explaining license sharing
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
          inline: false,
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

    // Create action buttons
    const actionRow = new ActionRowBuilder().addComponents(
      isCurrentlySharing
        ? new ButtonBuilder()
            .setCustomId(`foundry_stop_sharing_${userId}`)
            .setLabel("Stop Pooling License")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🔒")
        : new ButtonBuilder()
            .setCustomId(`foundry_start_sharing_${userId}`)
            .setLabel("Start Pooling License")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🤝"),
      new ButtonBuilder()
        .setCustomId(`foundry_license_sharing_cancel_${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  } catch (error) {
    console.error("Error in handleLicenseSharing:", error);
    await interaction.editReply({
      content: `❌ Error managing license sharing: ${error.message}`,
    });
  }
}

function createRegistrationEmbed() {
  return new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Register Your Foundry VTT Instance")
    .setDescription(
      "Create and manage your personal Foundry VTT instance with flexible license options."
    )
    .addFields([
      {
        name: "🚀 Instance Features",
        value:
          "• Dedicated Foundry VTT server\n• Custom URL based on your username\n• Full admin access\n• Real-time status monitoring",
      },
      {
        name: "🔑 License Options",
        value:
          "• **BYOL (Bring Your Own License):** Use your own Foundry license\n• **Shared Instances:** Use community-shared licenses (schedule-based access)\n• **License Pooling:** Share your license with the community",
      },
      {
        name: "💰 Cost Model",
        value:
          "• Transparent usage tracking\n• Voluntary cost coverage via Ko-fi\n• No upfront fees or forced payments\n• Supporter role discounts available",
      },
    ])
    .setFooter({
      text: "💡 Tip: Licenses can be pooled, instances are shared. Click Register to get started!",
    })
    .setTimestamp();
}

function createRegistrationActionRow() {
  const buttons = [
    new ButtonBuilder()
      .setCustomId("foundry_register")
      .setLabel("🎮 Register New Instance")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📝"),
  ];

  // Add Ko-fi support button if configured
  if (process.env.KOFI_URL && process.env.KOFI_URL.trim() !== "") {
    buttons.push(
      new ButtonBuilder()
        .setURL(process.env.KOFI_URL)
        .setLabel("☕ Support the Server")
        .setStyle(ButtonStyle.Link)
        .setEmoji("💖")
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

async function handleSetupRegistration(interaction) {
  // Check if user is admin
  if (!interaction.hasAdminRole()) {
    return await interaction.reply({
      content: "❌ Only administrators can set up the registration message.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel =
    interaction.options.getChannel("channel") || interaction.channel;

  const embed = createRegistrationEmbed();
  const actionRow = createRegistrationActionRow();

  try {
    const message = await channel.send({
      embeds: [embed],
      components: [actionRow],
    });

    // Create statistics message below the registration card
    try {
      const summaryResponse = await interaction.invokeLambda({
        action: "admin-overview",
        userId: interaction.user.id,
      });

      const summary = summaryResponse.summary;

      const COST_PER_HOUR = parseFloat(
        process.env.INSTANCE_COST_PER_HOUR || "0.10"
      );

      const costLine =
        summary && summary.estimatedMonthlyCost !== undefined
          ? `**Monthly Cost (so far):** $${summary.estimatedMonthlyCost.toFixed(
              2
            )}`
          : `**Monthly Cost (est.):** $${(
              summary?.runningInstances * COST_PER_HOUR * 720 || 0
            ).toFixed(2)}`;

      const statsEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("Instance Statistics")
        .setDescription(
          summary
            ? [
                `**Total Instances:** ${summary.totalInstances}`,
                `**Running:** ${summary.runningInstances}`,
                `**BYOL:** ${summary.byolInstances}`,
                `**Pooled:** ${summary.pooledInstances}`,
                costLine,
              ].join(" | ")
            : "Statistics unavailable."
        )
        .setTimestamp();

      const statsMessage = await channel.send({ embeds: [statsEmbed] });

      // Register stats message for periodic updates handled in index.js
      if (interaction.addRegistrationStatsMapping) {
        const saved = await interaction.addRegistrationStatsMapping(
          channel.id,
          statsMessage.id
        );
        if (!saved) {
          console.error(
            "⚠️ Failed to save registration stats mapping - message will not persist across restarts"
          );
        }
      }
    } catch (statsErr) {
      console.error("Failed to send statistics message:", statsErr.message);
    }

    await interaction.editReply({
      content: `✅ Registration message posted in ${channel}!\n\nMessage ID: \`${message.id}\`\n\nUsers can now click the button to register for Foundry VTT hosting.`,
    });
  } catch (error) {
    console.error("Error posting registration message:", error);
    await interaction.editReply({
      content: `❌ Failed to post registration message: ${error.message}`,
    });
  }
}

async function handleRecreateRegistration(interaction) {
  // Check if user is admin
  if (!interaction.hasAdminRole()) {
    return await interaction.reply({
      content: "❌ Only administrators can recreate the registration message.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel =
    interaction.options.getChannel("channel") || interaction.channel;

  try {
    // Clear any existing mappings first
    if (interaction.client.registrationStats.has(channel.id)) {
      console.log(
        `🧹 Clearing existing registration stats mapping for channel ${channel.id}`
      );
      interaction.client.registrationStats.delete(channel.id);

      // Also clear from DynamoDB if we have access
      if (process.env.BOT_CONFIG_TABLE_NAME) {
        try {
          const {
            DynamoDBDocumentClient,
            PutCommand,
          } = require("@aws-sdk/lib-dynamodb");
          const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

          const ddbClient = new DynamoDBClient({
            region: process.env.AWS_REGION || "us-east-1",
          });
          const botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);

          await botConfigDynamo.send(
            new PutCommand({
              TableName: process.env.BOT_CONFIG_TABLE_NAME,
              Item: {
                configKey: "registrationStats",
                channelId: null,
                messageId: null,
                updatedAt: Math.floor(Date.now() / 1000),
              },
            })
          );
          console.log(`✅ Cleared existing mapping from DynamoDB`);
        } catch (dbErr) {
          console.error(
            `❌ Failed to clear existing mapping from DynamoDB:`,
            dbErr.message
          );
        }
      }
    }

    const embed = createRegistrationEmbed();
    const actionRow = createRegistrationActionRow();

    const message = await channel.send({
      embeds: [embed],
      components: [actionRow],
    });

    // Create statistics message below the registration card
    try {
      const summaryResponse = await interaction.invokeLambda({
        action: "admin-overview",
        userId: interaction.user.id,
      });

      const summary = summaryResponse.summary;

      const COST_PER_HOUR = parseFloat(
        process.env.INSTANCE_COST_PER_HOUR || "0.10"
      );

      const costLine =
        summary && summary.estimatedMonthlyCost !== undefined
          ? `**Monthly Cost (so far):** $${summary.estimatedMonthlyCost.toFixed(
              2
            )}`
          : `**Monthly Cost (est.):** $${(
              summary?.runningInstances * COST_PER_HOUR * 720 || 0
            ).toFixed(2)}`;

      const statsEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("Instance Statistics")
        .setDescription(
          summary
            ? [
                `**Total Instances:** ${summary.totalInstances}`,
                `**Running:** ${summary.runningInstances}`,
                `**BYOL:** ${summary.byolInstances}`,
                `**Pooled:** ${summary.pooledInstances}`,
                costLine,
              ].join(" | ")
            : "Statistics unavailable."
        )
        .setTimestamp();

      const statsMessage = await channel.send({ embeds: [statsEmbed] });

      // Register stats message for periodic updates handled in index.js
      if (interaction.addRegistrationStatsMapping) {
        interaction.addRegistrationStatsMapping(channel.id, statsMessage.id);
      }
    } catch (statsErr) {
      console.error("Failed to send statistics message:", statsErr.message);
    }

    await interaction.editReply({
      content: `✅ Registration message recreated in ${channel}!\n\nMessage ID: \`${message.id}\`\n\nPrevious mappings have been cleared and new ones established.`,
    });
  } catch (error) {
    console.error("Error recreating registration message:", error);
    await interaction.editReply({
      content: `❌ Failed to recreate registration message: ${error.message}`,
    });
  }
}

// =================
// ADMIN FUNCTIONS
// =================

async function handleAdminOverview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get admin overview from Lambda
    const lambda = new LambdaClient({
      region: process.env.AWS_REGION || "us-east-1",
    });

    const command = new InvokeCommand({
      FunctionName: process.env.LAMBDA_FUNCTION_NAME,
      Payload: JSON.stringify({
        action: "admin-overview",
        userId: interaction.user.id,
      }),
    });

    const result = await lambda.send(command);
    const response = JSON.parse(new TextDecoder().decode(result.Payload));

    if (response.statusCode !== 200) {
      throw new Error(JSON.parse(response.body).error);
    }

    const data = JSON.parse(response.body);

    // Create main status embed
    const statusEmbed = new EmbedBuilder()
      .setTitle("🔧 System Administration Dashboard")
      .setDescription("Current system status overview")
      .setColor(0x00ff00)
      .setTimestamp();

    // Summary section
    const summary = data.summary;
    statusEmbed.addFields([
      {
        name: "📊 System Summary",
        value: [
          `**Total Instances:** ${summary.totalInstances}`,
          `**Running:** ${summary.runningInstances} | **BYOL:** ${summary.byolInstances} | **Pooled:** ${summary.pooledInstances}`,
          `**Shared Licenses:** ${summary.sharedLicenses}`,
          `**Active Sessions:** ${summary.activeSessions} | **Upcoming:** ${summary.upcomingSessions}`,
          `**Auto-Shutdown Timers:** ${summary.instancesWithTimers}`,
        ].join("\n"),
        inline: false,
      },
    ]);

    // Running instances section
    if (data.instances.running.length > 0) {
      const runningList = data.instances.running
        .slice(0, 5) // Limit to first 5 to avoid embed size limits
        .map((instance) => {
          const autoShutdown = instance.autoShutdownAt
            ? ` | ⏰ <t:${instance.autoShutdownAt}:R>`
            : "";
          const session = instance.linkedSessionId ? " | 🎮 Session" : "";
          return `**${
            instance.username
          }** (${instance.licenseType?.toUpperCase()})${session}${autoShutdown}`;
        })
        .join("\n");

      const moreRunning =
        data.instances.running.length > 5
          ? `\n*+${data.instances.running.length - 5} more...*`
          : "";

      statusEmbed.addFields([
        {
          name: `🚀 Running Instances (${data.instances.running.length})`,
          value: runningList + moreRunning,
          inline: false,
        },
      ]);
    }

    // Active sessions section
    if (data.sessions.active.length > 0) {
      const sessionsList = data.sessions.active
        .slice(0, 3)
        .map((session) => {
          return `**${session.title || "Session"}** - ${
            session.username
          }\nEnds <t:${
            session.endTime
          }:R> | License: ${session.licenseType?.toUpperCase()}`;
        })
        .join("\n\n");

      const moreSessions =
        data.sessions.active.length > 3
          ? `\n*+${data.sessions.active.length - 3} more...*`
          : "";

      statusEmbed.addFields([
        {
          name: `🎮 Active Sessions (${data.sessions.active.length})`,
          value: sessionsList + moreSessions,
          inline: false,
        },
      ]);
    }

    // Upcoming sessions section
    if (data.sessions.upcoming.length > 0) {
      const upcomingList = data.sessions.upcoming
        .slice(0, 3)
        .map((session) => {
          return `**${session.title || "Session"}** - ${
            session.username
          }\nStarts <t:${session.startTime}:R>`;
        })
        .join("\n\n");

      const moreUpcoming =
        data.sessions.upcoming.length > 3
          ? `\n*+${data.sessions.upcoming.length - 3} more...*`
          : "";

      statusEmbed.addFields([
        {
          name: `📅 Upcoming Sessions (${data.sessions.upcoming.length})`,
          value: upcomingList + moreUpcoming,
          inline: false,
        },
      ]);
    }

    // Auto-shutdown stats
    if (data.autoShutdown && data.autoShutdown.stats) {
      const stats = data.autoShutdown.stats;
      statusEmbed.addFields([
        {
          name: "⏰ Auto-Shutdown Statistics",
          value: [
            `**Total Running:** ${stats.totalRunning}`,
            `**With Timers:** ${stats.withTimers}`,
            `**Expiring Soon:** ${stats.expiringSoon} (next hour)`,
          ].join("\n"),
          inline: true,
        },
      ]);
    }

    // Recent activity
    if (data.activity.recentlyStarted.length > 0) {
      const recentActivity = data.activity.recentlyStarted
        .slice(0, 3)
        .map((instance) => {
          return `**${instance.username}** - <t:${instance.startedAt}:R>`;
        })
        .join("\n");

      statusEmbed.addFields([
        {
          name: "🔄 Recent Activity",
          value: recentActivity,
          inline: true,
        },
      ]);
    }

    // License pools
    if (data.licenses.pools.length > 0) {
      const poolsList = data.licenses.pools
        .filter((pool) => pool.isActive)
        .slice(0, 3)
        .map((pool) => {
          return `**${pool.ownerUsername}** | Max Users: ${pool.maxConcurrentUsers}`;
        })
        .join("\n");

      if (poolsList) {
        statusEmbed.addFields([
          {
            name: `🔗 Active License Pools (${
              data.licenses.pools.filter((p) => p.isActive).length
            })`,
            value: poolsList,
            inline: true,
          },
        ]);
      }
    }

    // Create action buttons
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_refresh_status")
        .setLabel("🔄 Refresh")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("admin_detailed_view")
        .setLabel("📋 Detailed View")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("admin_emergency_actions")
        .setLabel("🚨 Emergency Actions")
        .setStyle(ButtonStyle.Danger)
    );

    // Find or create admin status channel
    let statusChannel;
    if (interaction.guild) {
      const existing = interaction.guild.channels.cache.find(
        (c) => c.name === "foundry-admin-status"
      );
      if (existing) {
        statusChannel = existing;
      } else {
        statusChannel = await interaction.guild.channels.create({
          name: "foundry-admin-status",
          type: 0, // GUILD_TEXT
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: interaction.member.id,
              allow: [PermissionFlagsBits.ViewChannel],
            },
          ],
        });
      }
    }

    let messageId = null;
    if (statusChannel) {
      // Check if mapping exists in memory
      const existingMsgId = interaction.client.adminStatusMapping.get(
        statusChannel.id
      );
      if (existingMsgId) {
        try {
          const msg = await statusChannel.messages.fetch(existingMsgId);
          await msg.edit({
            embeds: [statusEmbed],
            components: [actionRow],
          });
          messageId = existingMsgId;
        } catch {
          // message not found, fallthrough to send new
        }
      }
      if (!messageId) {
        const sent = await statusChannel.send({
          embeds: [statusEmbed],
          components: [actionRow],
        });
        messageId = sent.id;
      }

      // Store mapping
      if (interaction.addAdminStatusMapping) {
        interaction.addAdminStatusMapping(statusChannel.id, messageId);
      }

      await interaction.editReply({
        content: `✅ Updated admin status in ${statusChannel}`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        embeds: [statusEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("Admin status error:", error);
    await interaction.editReply({
      content: `❌ Error getting admin status: ${error.message}`,
    });
  }
}

async function handleCleanupMappings(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const {
      DynamoDBDocumentClient,
      ScanCommand,
      PutCommand,
    } = require("@aws-sdk/lib-dynamodb");

    const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
    if (!botConfigTableName) {
      return await interaction.editReply({
        content: "❌ BOT_CONFIG_TABLE_NAME environment variable not set",
      });
    }

    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);

    let cleanupResults = [];

    // Clean up registration-related entries
    console.log("🧹 Cleaning up registration-related entries...");
    const regScan = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression:
          "contains(configKey, :key) AND (attribute_not_exists(cleanedUp) OR cleanedUp = :cleanedUp)",
        ExpressionAttributeValues: {
          ":key": "registration",
          ":cleanedUp": false,
        },
      })
    );

    if (regScan.Items && regScan.Items.length > 0) {
      const validEntries = regScan.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 1) {
        // Keep the most recent, mark others as cleaned up
        for (let i = 1; i < validEntries.length; i++) {
          try {
            await botConfigDynamo.send(
              new PutCommand({
                TableName: botConfigTableName,
                Item: {
                  configKey: `registrationStats_old_${Date.now()}_${i}`,
                  channelId: null,
                  messageId: null,
                  updatedAt: Math.floor(Date.now() / 1000),
                  cleanedUp: true,
                  originalKey: validEntries[i].configKey,
                },
              })
            );
            cleanupResults.push(
              `Registration entry ${validEntries[i].configKey} marked as cleaned up`
            );
          } catch (err) {
            cleanupResults.push(
              `Failed to clean up registration entry ${validEntries[i].configKey}: ${err.message}`
            );
          }
        }
      }
    }

    // Clean up admin-related entries
    console.log("🧹 Cleaning up admin-related entries...");
    const adminScan = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression:
          "contains(configKey, :key) AND (attribute_not_exists(cleanedUp) OR cleanedUp = :cleanedUp)",
        ExpressionAttributeValues: {
          ":key": "admin",
          ":cleanedUp": false,
        },
      })
    );

    if (adminScan.Items && adminScan.Items.length > 0) {
      const validEntries = adminScan.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 1) {
        // Keep the most recent, mark others as cleaned up
        for (let i = 1; i < validEntries.length; i++) {
          try {
            await botConfigDynamo.send(
              new PutCommand({
                TableName: botConfigTableName,
                Item: {
                  configKey: `adminStatus_old_${Date.now()}_${i}`,
                  channelId: null,
                  messageId: null,
                  updatedAt: Math.floor(Date.now() / 1000),
                  cleanedUp: true,
                  originalKey: validEntries[i].configKey,
                },
              })
            );
            cleanupResults.push(
              `Admin entry ${validEntries[i].configKey} marked as cleaned up`
            );
          } catch (err) {
            cleanupResults.push(
              `Failed to clean up admin entry ${validEntries[i].configKey}: ${err.message}`
            );
          }
        }
      }
    }

    if (cleanupResults.length > 0) {
      await interaction.editReply({
        content: `✅ Cleanup completed!\n\n**Results:**\n${cleanupResults.join(
          "\n"
        )}\n\n**Next Steps:**\n• Restart the bot to load the cleaned mappings\n• Use /foundry admin recreate-registration if needed\n• Use /foundry admin overview to recreate admin messages if needed`,
      });
    } else {
      await interaction.editReply({
        content:
          "ℹ️ No duplicate mappings found to clean up. All mappings are already in good condition.",
      });
    }
  } catch (error) {
    console.error("Cleanup mappings error:", error);
    await interaction.editReply({
      content: `❌ Error during cleanup: ${error.message}`,
    });
  }
}

async function handleTestLog(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const testMessage = interaction.options.getString("message");

    // Send test message to console (which will be captured by our logging system)
    console.log(`🧪 Test log message: ${testMessage}`);
    console.warn(`🧪 Test warning message: ${testMessage}`);
    console.error(`🧪 Test error message: ${testMessage}`);

    await interaction.editReply({
      content: `✅ Test log messages sent! Check the #foundry-bot-logs channel to see them.`,
    });
  } catch (error) {
    console.error("Test log error:", error);
    await interaction.editReply({
      content: `❌ Error sending test log: ${error.message}`,
    });
  }
}

// =================
// HELPER FUNCTIONS
// =================

async function createUserCommandChannel(guild, userId, username) {
  // This function should be imported from index.js or defined here
  // For now, we'll create a placeholder
  console.log(`Creating user command channel for ${username} (${userId})`);
  return null;
}

async function deleteUserCommandChannel(guild, userId) {
  // This function should be imported from index.js or defined here
  // For now, we'll create a placeholder
  console.log(`Deleting user command channel for ${userId}`);
  return null;
}

function startStatusMonitoring(userId, channelId) {
  // This function should be imported from index.js or defined here
  // For now, we'll create a placeholder
  console.log(
    `Starting status monitoring for ${userId} in channel ${channelId}`
  );
}

async function saveRegistrationStatsMappingToDB(channelId, messageId) {
  const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
  if (!botConfigTableName) {
    console.error(
      "❌ botConfigDynamo not initialized - BOT_CONFIG_TABLE_NAME may not be set"
    );
    return false;
  }

  try {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const {
      DynamoDBDocumentClient,
      PutCommand,
    } = require("@aws-sdk/lib-dynamodb");

    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);

    console.log(
      `💾 Saving registration stats mapping: ${channelId} -> ${messageId} to table ${botConfigTableName}`
    );

    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "registrationStats",
          channelId,
          messageId,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      })
    );

    console.log(`✅ Successfully saved registration stats mapping to DynamoDB`);
    return true;
  } catch (err) {
    console.error(
      "❌ Failed to save registration mapping to DynamoDB:",
      err.message
    );
    console.error("❌ Error details:", {
      tableName: botConfigTableName,
      channelId,
      messageId,
      errorCode: err.code,
      errorType: err.name,
    });
    return false;
  }
}

async function saveAdminStatusMappingToDB(channelId, messageId) {
  const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
  if (!botConfigTableName) {
    console.error(
      "❌ botConfigDynamo not initialized - BOT_CONFIG_TABLE_NAME may not be set"
    );
    return false;
  }

  try {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const {
      DynamoDBDocumentClient,
      PutCommand,
    } = require("@aws-sdk/lib-dynamodb");

    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);

    console.log(
      `💾 Saving admin status mapping: ${channelId} -> ${messageId} to table ${botConfigTableName}`
    );

    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "adminStatus",
          channelId,
          messageId,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      })
    );

    console.log(`✅ Successfully saved admin status mapping to DynamoDB`);
    return true;
  } catch (err) {
    console.error(
      "❌ Failed to save admin status mapping to DynamoDB:",
      err.message
    );
    console.error("❌ Error details:", {
      tableName: botConfigTableName,
      channelId,
      messageId,
      errorCode: err.code,
      errorType: err.name,
    });
    return false;
  }
}
