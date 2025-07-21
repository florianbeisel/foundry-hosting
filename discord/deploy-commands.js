require("dotenv").config();
const { REST, Routes } = require("discord.js");
const foundryCommand = require("./commands/foundry");
const adminCommand = require("./commands/admin");

const commands = [foundryCommand.data.toJSON(), adminCommand.data.toJSON()];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("🔄 Started refreshing application (/) commands.");

    if (process.env.DISCORD_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_CLIENT_ID,
          process.env.DISCORD_GUILD_ID
        ),
        { body: commands }
      );
      console.log("✅ Successfully reloaded guild application (/) commands.");
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log("✅ Successfully reloaded global application (/) commands.");
    }
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
  }
})();
