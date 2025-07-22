const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("foundry")
    .setDescription("Manage your Foundry VTT instance from Discord.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("dashboard")
        .setDescription("Show your Foundry dashboard")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("help").setDescription("Show help information")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup-registration")
        .setDescription("Post permanent registration message (Admin only)")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post registration message in")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    switch (subcommand) {
      case "dashboard":
        await handleDashboard(interaction, userId);
        break;
      case "help":
        await handleHelp(interaction);
        break;
      case "setup-registration":
        await handleSetupRegistration(interaction);
        break;
      default:
        await interaction.reply({
          content: "❌ Unknown command.",
          ephemeral: true,
        });
    }
  },
};

async function handleDashboard(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

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
        // Has a license owner that's not themselves = pooled instance
        licenseDisplay = "🌐 Pooled (Shared License)";
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
              licenseDisplay = `🌐 Pooled (${licenseOwnerInfo}'s License)`;
            }
          }
        } catch (error) {
          console.log("Could not fetch license owner info for dashboard");
        }
      } else {
        // Default to BYOL for missing data
        licenseDisplay = `🔑 BYOL (Own License)${
          result.allowLicenseSharing ? " - Shared" : ""
        }`;
      }
    } else if (licenseType === "byol") {
      licenseDisplay = `🔑 BYOL (Own License)${
        result.allowLicenseSharing ? " - Shared" : ""
      }`;
    } else if (licenseType === "pooled") {
      // Get license owner info for pooled instances
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
              licenseDisplay = `🌐 Pooled (${licenseOwnerInfo}'s License)`;
            } else {
              licenseDisplay = "🌐 Pooled (Shared License)";
            }
          } else {
            licenseDisplay = "🌐 Pooled (Shared License)";
          }
        } catch (error) {
          console.log("Could not fetch license owner info for dashboard");
          licenseDisplay = "🌐 Pooled (Shared License)";
        }
      } else {
        licenseDisplay = "🌐 Pooled (Automatic Assignment)";
      }
    } else {
      // Unknown license type
      licenseDisplay = `❔ Unknown License Type: ${licenseType}`;
    }

    // Get monthly cost data for dashboard display
    let costData = null;
    try {
      const costResult = await interaction.invokeLambda({
        action: "get-user-costs",
        userId: userId,
      });
      costData = costResult;
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

    const actionRow = new ActionRowBuilder();

    // Different buttons based on license type and status
    if (
      licenseType === "byol" &&
      (result.status === "stopped" || result.status === "created")
    ) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_start_${userId}`)
          .setLabel("Start Instance")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🚀")
      );
    }

    if (result.status === "running") {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_${userId}`)
          .setLabel("Stop Instance")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⏹️")
      );
    }

    // Add scheduling button for all users
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule Session")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅")
    );

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_sessions_${userId}`)
        .setLabel("My Sessions")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📋"),
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄")
    );

    // Second row for less common actions
    const secondRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_adminkey_${userId}`)
        .setLabel("Get Admin Key")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔑"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    // Third row for Ko-fi donation if uncovered costs exist
    let thirdRow = null;
    if (costData && costData.uncoveredCost > 0 && process.env.KOFI_URL) {
      const suggestedAmount = Math.min(costData.uncoveredCost, 5).toFixed(2);
      thirdRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setURL(process.env.KOFI_URL)
          .setLabel(`☕ Cover $${suggestedAmount} on Ko-fi`)
          .setStyle(ButtonStyle.Link)
          .setEmoji("💖")
      );
    }

    // Create version selection dropdown
    const currentVersion = result.foundryVersion || "13";
    const versionLabels = {
      13: "v13 - Latest Stable",
      release: "Release - Current Stable",
      12: "v12 - Previous Major",
      11: "v11 - Legacy Major",
      "13.346.0": "v13.346.0 - Specific Build",
      latest: "Latest - Bleeding Edge",
    };

    const versionSelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`foundry_version_${userId}`)
        .setPlaceholder(
          `🔧 Current: ${versionLabels[currentVersion] || currentVersion}`
        )
        .addOptions([
          new StringSelectMenuOptionBuilder()
            .setLabel("v13 - Latest Stable (Recommended)")
            .setDescription("Auto-updates to newest v13 stable release")
            .setValue("13")
            .setEmoji("🏆"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Release - Current Stable")
            .setDescription("Latest tested and verified release")
            .setValue("release")
            .setEmoji("✅"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v12 - Previous Major")
            .setDescription("Latest v12 release (downgrade option)")
            .setValue("12")
            .setEmoji("🔄"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v11 - Legacy Major")
            .setDescription("Latest v11 release (legacy option)")
            .setValue("11")
            .setEmoji("📼"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v13.346.0 - Specific Build")
            .setDescription("Fixed to exact v13.346.0 build")
            .setValue("13.346.0")
            .setEmoji("📌"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Latest - Bleeding Edge")
            .setDescription("Most recent build (may be unstable)")
            .setValue("latest")
            .setEmoji("⚡"),
        ])
    );

    const components = [actionRow, secondRow];
    if (thirdRow) components.push(thirdRow);
    components.push(versionSelectRow);

    await interaction.editReply({
      embeds: [embed],
      components: components,
    });
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
          "`/foundry dashboard` – personal control panel\n" +
          "`/foundry help` – this help message\n" +
          "`/foundry setup-registration` – post registration embed (admin)\n" +
          "`/admin-status` – system-wide status (admin)",
      },
    ])
    .setFooter({ text: "Need more information? Contact an administrator." })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function createRegistrationEmbed() {
  return new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Register Your Foundry VTT Instance")
    .setDescription("Create and manage a personal Foundry VTT instance.")
    .addFields([
      {
        name: "Instance Details",
        value:
          "• Dedicated Foundry VTT server\n• Custom URL based on your username\n• Full admin access",
      },
      {
        name: "Costs",
        value:
          "• Transparent usage tracking\n• Voluntary cost coverage via Ko-fi\n• No upfront fees or forced payments",
      },
      {
        name: "Management",
        value:
          "• Control via Discord buttons\n• Real-time status updates\n• Retrieve admin key as needed",
      },
    ])
    .setFooter({ text: "Click Register to continue." })
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
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

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
        interaction.addRegistrationStatsMapping(channel.id, statsMessage.id);
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
