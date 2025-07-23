const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { EMOJIS } = require("../config/constants");

/**
 * Show registration modal
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} userId
 */
async function showRegistrationModal(interaction, userId) {
  const modal = new ModalBuilder()
    .setCustomId(`foundry_register_modal_${userId}`)
    .setTitle("Register Foundry Instance");

  const licenseKeyInput = new TextInputBuilder()
    .setCustomId("license_key")
    .setLabel("License Key (optional)")
    .setPlaceholder("Enter your Foundry license key or leave blank for pooled")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const firstRow = new ActionRowBuilder().addComponents(licenseKeyInput);
  modal.addComponents(firstRow);

  await interaction.showModal(modal);
}

/**
 * Handle modal submit interactions
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleModal(client, interaction) {
  const parts = interaction.customId.split("_");
  const [prefix, action, type] = parts;

  if (prefix !== "foundry") return;

  // TODO: Implement modal handlers
  // This would include handling registration modals, configuration modals, etc.

  await interaction.reply({
    content: "Modal functionality will be implemented here.",
    ephemeral: true,
  });
}

module.exports = {
  showRegistrationModal,
  handleModal,
};