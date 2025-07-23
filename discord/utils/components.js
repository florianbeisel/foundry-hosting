const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

/**
 * Create Ko-fi donation button row for supporting the server
 * @param {string} userId - Discord user ID
 * @param {number} suggestedAmount - Optional suggested donation amount
 * @param {string} message - Custom message for Ko-fi
 * @returns {ActionRowBuilder|null}
 */
function createKofiSupportButton(userId, suggestedAmount = null, message = null) {
  if (!process.env.KOFI_URL) return null;

  const defaultMessage = `Discord: ${userId} - Thanks for the awesome Foundry hosting service!`;
  const kofiMessage = message || defaultMessage;
  const buttonLabel = suggestedAmount
    ? `☕ Cover $${suggestedAmount.toFixed(2)} on Ko-fi`
    : "☕ Support the Server on Ko-fi";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setURL(process.env.KOFI_URL)
      .setLabel(buttonLabel)
      .setStyle(ButtonStyle.Link)
      .setEmoji("💖")
  );
}

/**
 * Create instance control buttons
 * @param {string} status - Current instance status
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {ActionRowBuilder}
 */
function createInstanceControlButtons(status, isAdmin = false) {
  const buttons = [];

  if (status === "running") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("stop_instance")
        .setLabel("Stop Instance")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🛑"),
      new ButtonBuilder()
        .setCustomId("restart_instance")
        .setLabel("Restart Instance")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄")
    );
  } else if (status === "stopped" || status === "inactive") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("start_instance")
        .setLabel("Start Instance")
        .setStyle(ButtonStyle.Success)
        .setEmoji("▶️")
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId("refresh_status")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔄")
  );

  if (isAdmin) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("admin_panel")
        .setLabel("Admin Panel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔧")
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Create backup management buttons
 * @returns {ActionRowBuilder}
 */
function createBackupButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_backup")
      .setLabel("Create Backup")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("💾"),
    new ButtonBuilder()
      .setCustomId("list_backups")
      .setLabel("List Backups")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📋"),
    new ButtonBuilder()
      .setCustomId("restore_backup")
      .setLabel("Restore Backup")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("♻️")
  );
}

/**
 * Create a select menu for backup selection
 * @param {Array} backups - Array of backup objects
 * @returns {ActionRowBuilder}
 */
function createBackupSelectMenu(backups) {
  const options = backups.slice(0, 25).map(backup => 
    new StringSelectMenuOptionBuilder()
      .setLabel(backup.name || backup.timestamp)
      .setDescription(`Created: ${new Date(backup.timestamp).toLocaleString()}`)
      .setValue(backup.id || backup.timestamp)
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_backup")
      .setPlaceholder("Choose a backup to restore")
      .addOptions(options)
  );
}

/**
 * Create registration form buttons
 * @returns {ActionRowBuilder}
 */
function createRegistrationButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("register_foundry")
      .setLabel("Register Foundry Instance")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📝"),
    new ButtonBuilder()
      .setCustomId("refresh_registration_stats")
      .setLabel("Refresh Stats")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄")
  );
}

module.exports = {
  createKofiSupportButton,
  createInstanceControlButtons,
  createBackupButtons,
  createBackupSelectMenu,
  createRegistrationButtons,
};