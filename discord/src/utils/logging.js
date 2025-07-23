const { ChannelType, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

let loggingChannel = null;
let logQueue = [];
let isProcessingLogs = false;

async function setupLogging(client) {
  try {
    console.log("📝 Setting up logging system...");
    
    // Find the first guild (server) the bot is in
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.log("⚠️ No guilds found, cannot create logging channel");
      return;
    }

    // Check if logging channel already exists
    let existingChannel = guild.channels.cache.find(
      (c) => c.name === "foundry-bot-logs"
    );

    if (existingChannel) {
      loggingChannel = existingChannel;
      console.log(`📝 Using existing logging channel: #${loggingChannel.name}`);
    } else {
      // Create new logging channel
      loggingChannel = await guild.channels.create({
        name: "foundry-bot-logs",
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          },
        ],
        topic: "Foundry VTT Bot logs and debugging information",
      });
      console.log(`📝 Created new logging channel: #${loggingChannel.name}`);
    }

    // Send startup message
    const startupEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🤖 Bot Startup")
      .setDescription(
        `Foundry VTT Bot started successfully at <t:${Math.floor(
          Date.now() / 1000
        )}:F>`
      )
      .addFields([
        {
          name: "Bot Info",
          value: `**Tag:** ${client.user.tag}\n**ID:** ${client.user.id}\n**Servers:** ${client.guilds.cache.size}`,
          inline: true,
        },
        {
          name: "Environment",
          value: `**Region:** ${
            process.env.AWS_REGION || "us-east-1"
          }\n**Table:** ${process.env.BOT_CONFIG_TABLE_NAME || "Not set"}`,
          inline: true,
        },
      ])
      .setTimestamp();

    await loggingChannel.send({ embeds: [startupEmbed] });

    // Setup console override
    setupConsoleOverride();
    
    console.log("✅ Logging system initialized");
  } catch (error) {
    console.error("❌ Failed to setup logging channel:", error.message);
  }
}

function setupConsoleOverride() {
  if (!loggingChannel) return;

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Override console.log
  console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    queueLogMessage("INFO", args.join(" "));
  };

  // Override console.error
  console.error = function (...args) {
    originalConsoleError.apply(console, args);
    queueLogMessage("ERROR", args.join(" "));
  };

  // Override console.warn
  console.warn = function (...args) {
    originalConsoleWarn.apply(console, args);
    queueLogMessage("WARN", args.join(" "));
  };

  console.log(
    "📝 Console logging override enabled - all logs will be sent to Discord"
  );
}

async function queueLogMessage(level, message) {
  if (!loggingChannel) return;

  // Skip certain messages to avoid spam
  const skipPatterns = [
    "heartbeat",
    "Gateway",
    "WebSocket",
    "Rate limit",
    "Request to use",
    "Missing Permissions",
    "Unknown interaction",
    "Unknown Message",
    "Unknown Channel",
  ];

  if (skipPatterns.some((pattern) => message.includes(pattern))) {
    return;
  }

  // Truncate very long messages
  if (message.length > 1900) {
    message = message.substring(0, 1900) + "...";
  }

  logQueue.push({ level, message, timestamp: Date.now() });

  if (!isProcessingLogs) {
    processLogQueue();
  }
}

async function processLogQueue() {
  if (isProcessingLogs || !loggingChannel || logQueue.length === 0) return;

  isProcessingLogs = true;

  try {
    // Process up to 10 messages at a time
    const messagesToProcess = logQueue.splice(0, 10);

    // Group messages by level
    const groupedMessages = {};
    messagesToProcess.forEach(({ level, message, timestamp }) => {
      if (!groupedMessages[level]) {
        groupedMessages[level] = [];
      }
      groupedMessages[level].push({ message, timestamp });
    });

    // Send grouped messages
    for (const [level, messages] of Object.entries(groupedMessages)) {
      if (messages.length === 0) continue;

      const levelEmoji = {
        INFO: "ℹ️",
        WARN: "⚠️",
        ERROR: "❌",
      };

      const levelColor = {
        INFO: "#0099ff",
        WARN: "#ffaa00",
        ERROR: "#ff0000",
      };

      const embed = new EmbedBuilder()
        .setColor(levelColor[level])
        .setTitle(`${levelEmoji[level]} ${level} Logs`)
        .setDescription(
          messages
            .map(
              ({ message, timestamp }) =>
                `**<t:${Math.floor(timestamp / 1000)}:T>** ${message}`
            )
            .join("\n")
        )
        .setTimestamp();

      try {
        await loggingChannel.send({ embeds: [embed] });
        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error("Failed to send log message to Discord:", error.message);
      }
    }
  } catch (error) {
    console.error("Error processing log queue:", error.message);
  } finally {
    isProcessingLogs = false;

    // Process remaining messages if any
    if (logQueue.length > 0) {
      setTimeout(processLogQueue, 1000);
    }
  }
}

module.exports = {
  setupLogging,
};