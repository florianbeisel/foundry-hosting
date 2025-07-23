const { EmbedBuilder, MessageFlags } = require("discord.js");

async function handleLicenseSharing(interaction) {
  await interaction.reply({
    content: "🚧 License sharing management not yet implemented in refactored version",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleLicenseSharing,
};