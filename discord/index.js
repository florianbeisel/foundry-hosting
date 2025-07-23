require("dotenv").config();
const { Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

// Import services and utilities
const { createDiscordClient, setupConsoleOverride } = require("./services/discord-client");
const { handleReady } = require("./events/ready");
const { handleInteractionCreate } = require("./events/interactionCreate");

// Create the Discord client
const client = createDiscordClient();

// Setup console override for logging
setupConsoleOverride(client);

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

// Register event handlers
client.once("ready", () => handleReady(client));
client.on("error", (error) => {
  console.error("Discord client error:", error);
  
  // Attempt to reconnect after a delay
  setTimeout(() => {
    console.log("Attempting to reconnect...");
    client.login(process.env.DISCORD_TOKEN);
  }, 5000);
});
client.on("interactionCreate", (interaction) => handleInteractionCreate(client, interaction));

// Schedule cron jobs
// Update registration stats every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const { updateRegistrationStats } = require("./utils/stats");
    await updateRegistrationStats(client);
  } catch (error) {
    console.error("Error updating registration stats:", error);
  }
});

// Update admin status every 2 minutes
cron.schedule("*/2 * * * *", async () => {
  try {
    const { updateAdminStatus } = require("./utils/admin");
    await updateAdminStatus(client);
  } catch (error) {
    console.error("Error updating admin status:", error);
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...");
  const { stopAllMonitoring } = require("./services/monitoring");
  stopAllMonitoring();
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  const { stopAllMonitoring } = require("./services/monitoring");
  stopAllMonitoring();
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);