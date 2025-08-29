const { EmbedBuilder } = require("discord.js");

class StatusEmbedBuilder {
  static create(status, context = "status") {
    const statusEmojis = {
      running: "🟢",
      starting: "🟡",
      stopping: "🟠",
      stopped: "🔴",
      created: "⚪",
      unknown: "❔",
    };

    let title, description;
    switch (context) {
      case "created":
        title = "🎲 Your Foundry VTT Dashboard";
        description = "Your instance is ready!";
        break;
      case "running":
        title = "🎲 Instance Running";
        description = "Instance is running.";
        break;
      case "stopped":
        title = "🔴 Instance Stopped";
        description = "Instance is stopped.";
        break;
      case "sync":
        title = "🔄 Bot Restarted - Instance Synced";
        description = "Your instance has been synchronized after bot restart.";
        break;
      case "dashboard":
        title = "🎲 Your Foundry VTT Dashboard";
        description = "Current instance status and controls.";
        break;
      default:
        title = "🎲 Instance Status";
        description = `Current status: **${status.status}**`;
    }

    const embed = new EmbedBuilder()
      .setColor(status.status === "running" ? "#00ff00" : "#888888")
      .setTitle(title)
      .setDescription(description)
      .addFields([
        {
          name: "Status",
          value: `${statusEmojis[status.status]} ${status.status}`,
          inline: true,
        },
        {
          name: "License Type",
          value: status.licenseType === "byol" ? "🔑 BYOL" : "🤝 Pooled",
          inline: true,
        },
        {
          name: "Last Updated",
          value: `<t:${status.updatedAt}:R>`,
          inline: true,
        },
      ]);

    // Add URL if available
    if (status.url) {
      embed.addFields([
        {
          name: "URL",
          value: status.url,
          inline: false,
        },
      ]);
    }

    // Add auto-shutdown info if available
    if (status.autoShutdownAt && status.status === "running") {
      const shutdownTime = new Date(status.autoShutdownAt * 1000);
      const now = new Date();
      const timeLeft = Math.max(
        0,
        Math.floor((shutdownTime - now) / (1000 * 60))
      );

      let shutdownText;
      if (timeLeft > 60) {
        shutdownText = `<t:${status.autoShutdownAt}:R> (${Math.floor(
          timeLeft / 60
        )}h ${timeLeft % 60}m left)`;
      } else if (timeLeft > 0) {
        shutdownText = `<t:${status.autoShutdownAt}:R> (${timeLeft}m left)`;
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

    // Add Foundry version
    if (status.foundryVersion) {
      embed.addFields([
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:${status.foundryVersion}\``,
          inline: true,
        },
      ]);
    }

    // Add session info if linked
    if (status.linkedSessionId && status.status === "running") {
      embed.addFields([
        {
          name: "🎮 Active Session",
          value: `Running scheduled session\nAuto-ends <t:${status.autoShutdownAt}:R>`,
          inline: true,
        },
      ]);
    }

    // Add next scheduled session if available
    if (status.nextScheduledSession) {
      const session = status.nextScheduledSession;
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

    embed.setTimestamp();
    return embed;
  }

  static createDashboard(status, costData, licenseOwnerInfo) {
    const embed = this.create(status, "dashboard");

    // Add cost information
    if (costData) {
      embed.addFields([
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
                value: `$${costData.supporterAmount.toFixed(2)} monthly credit`,
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
      ]);
    }

    // Add license owner gratitude
    if (licenseOwnerInfo) {
      embed.addFields([
        {
          name: "🤝 Thanks to",
          value: `**${licenseOwnerInfo}** for sharing their license with the community!`,
          inline: false,
        },
      ]);
    }

    return embed;
  }
}

module.exports = { StatusEmbedBuilder };
