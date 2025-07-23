const { MessageFlags } = require("discord.js");

async function handleSetupRegistration(interaction) {
  await interaction.reply({
    content: "🚧 Setup registration not yet implemented in refactored version",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleSetupRegistration,
};