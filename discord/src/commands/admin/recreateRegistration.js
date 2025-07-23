const { MessageFlags } = require("discord.js");

async function handleRecreateRegistration(interaction) {
  await interaction.reply({
    content: "🚧 Recreate registration not yet implemented in refactored version",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleRecreateRegistration,
};