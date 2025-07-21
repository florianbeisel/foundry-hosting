const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-1",
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin-status")
    .setDescription("📊 Admin: View comprehensive system status and monitoring")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Check admin permissions - admin commands only work in guilds, not DMs
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({
        content:
          "❌ Admin commands can only be used in server channels, not DMs.",
        ephemeral: true,
      });
    }

    // Safe admin role check
    const hasAdminRole = (member) => {
      if (!member || !member.roles || !member.permissions) return false;

      // Check Discord's built-in Administrator permission first
      if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
      }

      // Then check custom admin roles
      const adminRoles = process.env.ADMIN_ROLES?.split(",") || ["Admin"];
      return adminRoles.some((role) =>
        member.roles.cache.some(
          (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
        )
      );
    };

    const isAdmin = hasAdminRole(interaction.member);

    if (!isAdmin) {
      return interaction.reply({
        content: "❌ Admin access required for this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Get admin overview from Lambda
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
        .setDescription("Comprehensive system status and monitoring overview")
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

      await interaction.editReply({
        embeds: [statusEmbed],
        components: [actionRow],
      });
    } catch (error) {
      console.error("Admin status error:", error);
      await interaction.editReply({
        content: `❌ Error getting admin status: ${error.message}`,
      });
    }
  },
};
