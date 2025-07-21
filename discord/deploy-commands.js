require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// Dynamically load all command modules in ./commands and collect their JSON definitions
const commands = [];
const commandsPath = path.join(__dirname, "commands");

fs.readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"))
  .forEach((file) => {
    const command = require(path.join(commandsPath, file));
    if (command?.data) {
      commands.push(command.data.toJSON());
    }
  });

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
