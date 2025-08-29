const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

class InstanceButtonBuilder {
  static createRegistrationButtons() {
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

  static createUserControlButtons(userId, status, costData) {
    const buttons = [
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule Session")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅"),
    ];

    // Add license sharing button for BYOL users
    if (status.licenseType === "byol") {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`foundry_license_sharing_${userId}`)
          .setLabel(
            status.allowLicenseSharing
              ? "Manage License Sharing"
              : "Start License Sharing"
          )
          .setStyle(
            status.allowLicenseSharing
              ? ButtonStyle.Primary
              : ButtonStyle.Success
          )
          .setEmoji(status.allowLicenseSharing ? "🔑" : "🤝")
      );
    }

    // Add Ko-fi button if there are remaining costs
    const remainingCost =
      costData?.adjustedUncoveredCost || costData?.uncoveredCost || 0;
    if (costData && remainingCost > 0 && process.env.KOFI_URL) {
      const suggestedAmount = Math.min(remainingCost, 5).toFixed(2);
      buttons.push(
        new ButtonBuilder()
          .setURL(process.env.KOFI_URL)
          .setLabel(`☕ Cover $${suggestedAmount}`)
          .setStyle(ButtonStyle.Link)
          .setEmoji("💖")
      );
    }

    return new ActionRowBuilder().addComponents(...buttons);
  }

  static createInstanceControlButtons(userId, status) {
    const buttons = [];

    if (status.licenseType === "pooled") {
      // Pooled instances
      if (status.status === "running") {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`foundry_stop_${userId}`)
            .setLabel("Stop Instance")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⏹️"),
          new ButtonBuilder()
            .setCustomId(`foundry_sessions_${userId}`)
            .setLabel("My Sessions")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("📋"),
          new ButtonBuilder()
            .setCustomId(`foundry_status_${userId}`)
            .setLabel("Check Status")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄"),
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
      } else {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`foundry_sessions_${userId}`)
            .setLabel("My Sessions")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("📋"),
          new ButtonBuilder()
            .setCustomId(`foundry_status_${userId}`)
            .setLabel("Check Status")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄"),
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
      }
    } else {
      // BYOL instances
      if (status.status === "stopped" || status.status === "created") {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`foundry_start_${userId}`)
            .setLabel("Start Instance")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🚀"),
          new ButtonBuilder()
            .setCustomId(`foundry_status_${userId}`)
            .setLabel("Check Status")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄"),
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
      } else if (status.status === "running") {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`foundry_stop_${userId}`)
            .setLabel("Stop Instance")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("⏹️"),
          new ButtonBuilder()
            .setCustomId(`foundry_status_${userId}`)
            .setLabel("Check Status")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄"),
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
      } else {
        // Other statuses (starting, stopping, etc.)
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`foundry_status_${userId}`)
            .setLabel("Check Status")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄")
        );
      }
    }

    return new ActionRowBuilder().addComponents(...buttons);
  }

  // createInstanceControlButtons is already implemented above as the main method

  static createAdminButtons() {
    return new ActionRowBuilder().addComponents(
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
  }

  static createLicenseSharingButtons(userId, isCurrentlySharing) {
    return new ActionRowBuilder().addComponents(
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
  }
}

module.exports = { InstanceButtonBuilder };
