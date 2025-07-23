const {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
} = require("discord.js");

/**
 * Create and configure the Discord client
 * @returns {import('discord.js').Client}
 */
function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Initialize collections
  client.commands = new Collection();
  client.userChannels = new Map();
  client.userStatusMessages = new Map();
  client.statusMonitors = new Map();
  client.registrationStats = new Map();
  client.adminStatusMapping = new Map();
  client.loggingChannel = null;

  return client;
}

/**
 * Setup console override for logging
 */
function setupConsoleOverride(client) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const sendToLoggingChannel = async (message, type = "info") => {
    if (!client.loggingChannel) return;

    try {
      const timestamp = new Date().toISOString();
      const emoji = type === "error" ? "❌" : type === "warn" ? "⚠️" : "ℹ️";
      const formattedMessage = `\`${timestamp}\` ${emoji} ${message}`;

      // Truncate message if too long
      const truncated =
        formattedMessage.length > 2000
          ? formattedMessage.substring(0, 1997) + "..."
          : formattedMessage;

      await client.loggingChannel.send(truncated);
    } catch (err) {
      // Silently fail to avoid infinite loops
      originalError("Failed to send to logging channel:", err);
    }
  };

  console.log = (...args) => {
    originalLog(...args);
    const message = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg
      )
      .join(" ");
    sendToLoggingChannel(message, "info").catch(() => {});
  };

  console.error = (...args) => {
    originalError(...args);
    const message = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg
      )
      .join(" ");
    sendToLoggingChannel(message, "error").catch(() => {});
  };

  console.warn = (...args) => {
    originalWarn(...args);
    const message = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg
      )
      .join(" ");
    sendToLoggingChannel(message, "warn").catch(() => {});
  };
}

module.exports = {
  createDiscordClient,
  setupConsoleOverride,
};