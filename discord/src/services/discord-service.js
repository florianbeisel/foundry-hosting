const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { logger } = require("../utils/logger");
const { PutCommand } = require("@aws-sdk/lib-dynamodb");

class DiscordService {
  constructor(client) {
    this.client = client;
    this.state = null; // Will be injected by Bot
    this.config = null; // Will be injected by Bot
    this.guildManager = null; // Will be injected by Bot
    this.loggingChannel = null;
    this.logQueue = [];
    this.isProcessingLogs = false;
  }

  // Dependency injection
  setDependencies(state, config, guildManager) {
    this.state = state;
    this.config = config;
    this.guildManager = guildManager;
  }

  // Permission checking (delegated to GuildManager)
  hasRequiredRole(member) {
    return this.guildManager.hasRequiredRole(member);
  }

  hasAdminRole(member) {
    return this.guildManager.hasAdminRole(member);
  }

  getUserSupporterAmount(member) {
    return this.guildManager.getUserSupporterAmount(member);
  }

  // Channel management
  async findExistingCommandChannel(guild, userId, username) {
    await guild.channels.fetch();

    const expectedChannelName = `foundry-${this.guildManager.sanitizeUsername(
      username
    )}-${userId.slice(-4)}`;
    let channel = null;

    // Search strategies
    channel = guild.channels.cache.find(
      (ch) => ch.name === expectedChannelName
    );

    if (!channel) {
      channel = guild.channels.cache.find((ch) => ch.topic?.includes(userId));
    }

    if (!channel) {
      const userIdSuffix = userId.slice(-4);
      channel = guild.channels.cache.find(
        (ch) =>
          ch.name.startsWith("foundry-") && ch.name.endsWith(`-${userIdSuffix}`)
      );
    }

    if (channel) {
      logger.info(`✅ Found existing channel: ${channel.name}`);
      this.state.setUserChannel(userId, channel.id);
    }

    return channel;
  }

  async createUserCommandChannel(guild, userId, username) {
    const channelName = `foundry-${this.guildManager.sanitizeUsername(
      username
    )}-${userId.slice(-4)}`;

    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText,
      topic: `Foundry VTT instance control for ${username} (ID: ${userId})`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...this.guildManager.getAdminRoleOverwrites(guild),
      ],
    };

    const botConfig = this.config.getBotConfig();
    if (botConfig.foundryCategory) {
      channelOptions.parent = botConfig.foundryCategory;
    }

    try {
      const channel = await guild.channels.create(channelOptions);
      this.state.setUserChannel(userId, channel.id);

      // Send welcome message
      const welcomeEmbed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("🎲 Foundry VTT Control Channel")
        .setDescription(`<@${userId}>, this is your command channel.`)
        .addFields([
          {
            name: "Controls",
            value: "Use buttons below or `/foundry dashboard`",
            inline: false,
          },
        ])
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄")
      );

      await channel.send({
        embeds: [welcomeEmbed],
        components: [actionRow],
      });

      return channel;
    } catch (error) {
      if (error.code === 50013) {
        throw new Error(
          "❌ **Missing Permissions**: The bot needs the 'Manage Channels' permission to create your command channel."
        );
      }
      throw new Error(`Failed to create command channel: ${error.message}`);
    }
  }

  async deleteUserCommandChannel(guild, userId) {
    const channelId = this.state.getUserChannels().get(userId);
    if (channelId) {
      try {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          await channel.delete();
        }
        this.state.removeUserChannel(userId);
      } catch (error) {
        logger.error("Error deleting user channel:", error);
      }
    }
  }

  async clearChannelMessages(channel) {
    try {
      logger.info(`Clearing messages in ${channel.name}...`);

      let deleted = 0;
      let lastMessageId;

      while (true) {
        const fetchOptions = { limit: 100 };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const messages = await channel.messages.fetch(fetchOptions);
        if (messages.size === 0) break;

        const now = Date.now();
        const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

        const recentMessages = [];
        const oldMessages = [];

        messages.forEach((msg) => {
          if (msg.createdTimestamp > twoWeeksAgo) {
            recentMessages.push(msg);
          } else {
            oldMessages.push(msg);
          }
        });

        // Bulk delete recent messages
        if (recentMessages.length > 0) {
          if (recentMessages.length === 1) {
            await recentMessages[0].delete();
            deleted += 1;
          } else {
            await channel.bulkDelete(recentMessages);
            deleted += recentMessages.length;
          }
        }

        // Delete old messages individually
        for (const msg of oldMessages) {
          try {
            await msg.delete();
            deleted++;
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (err) {
            logger.debug(`Could not delete old message: ${err.message}`);
          }
        }

        lastMessageId = messages.last()?.id;
        if (messages.size < 100) break;
      }

      logger.info(`✅ Cleared ${deleted} messages from ${channel.name}`);
    } catch (error) {
      logger.warn(
        `Could not clear messages in ${channel.name}: ${error.message}`
      );
    }
  }

  // Logging setup
  async setupLoggingChannel() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        logger.warn("⚠️ No guilds found, cannot create logging channel");
        return;
      }

      let existingChannel = guild.channels.cache.find(
        (c) => c.name === "foundry-bot-logs"
      );

      if (existingChannel) {
        this.loggingChannel = existingChannel;
        logger.info(
          `📝 Using existing logging channel: #${this.loggingChannel.name}`
        );
      } else {
        this.loggingChannel = await guild.channels.create({
          name: "foundry-bot-logs",
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: guild.roles.everyone,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: this.client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
              ],
            },
          ],
          topic: "Foundry VTT Bot logs and debugging information",
        });
        logger.info(
          `📝 Created new logging channel: #${this.loggingChannel.name}`
        );
      }

      // Send startup message
      const startupEmbed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("🤖 Bot Startup")
        .setDescription(`Bot started at <t:${Math.floor(Date.now() / 1000)}:F>`)
        .addFields([
          {
            name: "Bot Info",
            value: `**Tag:** ${this.client.user.tag}\n**Servers:** ${this.client.guilds.cache.size}`,
            inline: true,
          },
          {
            name: "Environment",
            value: `**Region:** ${process.env.AWS_REGION || "us-east-1"}`,
            inline: true,
          },
        ])
        .setTimestamp();

      await this.loggingChannel.send({ embeds: [startupEmbed] });
      this.setupConsoleOverride();
    } catch (error) {
      logger.error("❌ Failed to setup logging channel:", error);
    }
  }

  setupConsoleOverride() {
    if (!this.loggingChannel) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      originalLog.apply(console, args);
      this.queueLogMessage("INFO", args.join(" "));
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      this.queueLogMessage("ERROR", args.join(" "));
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      this.queueLogMessage("WARN", args.join(" "));
    };

    logger.info("📝 Console logging override enabled");
  }

  queueLogMessage(level, message) {
    if (!this.loggingChannel) return;

    // Skip spam patterns
    const skipPatterns = [
      "heartbeat",
      "Gateway",
      "WebSocket",
      "Rate limit",
      "Missing Permissions",
      "Unknown interaction",
    ];

    if (skipPatterns.some((pattern) => message.includes(pattern))) {
      return;
    }

    if (message.length > 1900) {
      message = message.substring(0, 1900) + "...";
    }

    this.logQueue.push({ level, message, timestamp: Date.now() });

    if (!this.isProcessingLogs) {
      this.processLogQueue();
    }
  }

  async processLogQueue() {
    if (
      this.isProcessingLogs ||
      !this.loggingChannel ||
      this.logQueue.length === 0
    ) {
      return;
    }

    this.isProcessingLogs = true;

    try {
      const messagesToProcess = this.logQueue.splice(0, 10);
      const groupedMessages = {};

      messagesToProcess.forEach(({ level, message, timestamp }) => {
        if (!groupedMessages[level]) groupedMessages[level] = [];
        groupedMessages[level].push({ message, timestamp });
      });

      const levelColors = {
        INFO: "#0099ff",
        WARN: "#ffaa00",
        ERROR: "#ff0000",
      };
      const levelEmojis = { INFO: "ℹ️", WARN: "⚠️", ERROR: "❌" };

      for (const [level, messages] of Object.entries(groupedMessages)) {
        if (messages.length === 0) continue;

        const embed = new EmbedBuilder()
          .setColor(levelColors[level])
          .setTitle(`${levelEmojis[level]} ${level} Logs`)
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
          await this.loggingChannel.send({ embeds: [embed] });
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          logger.error("Failed to send log message:", error);
        }
      }
    } catch (error) {
      logger.error("Error processing log queue:", error);
    } finally {
      this.isProcessingLogs = false;
      if (this.logQueue.length > 0) {
        setTimeout(() => this.processLogQueue(), 1000);
      }
    }
  }

  // Instance synchronization
  async syncAllInstances(lambdaService) {
    logger.info("🔄 Syncing all instances on startup...");

    try {
      const result = await lambdaService.getAllInstances();
      logger.info(`Found ${result.count} total instances`);

      for (const instance of result.instances) {
        try {
          const guild = this.client.guilds.cache.first();
          if (!guild) continue;

          const user = await this.client.users
            .fetch(instance.userId)
            .catch(() => null);
          if (!user) {
            logger.info(`User ${instance.userId} not found, skipping...`);
            continue;
          }

          const channel = await this.findExistingCommandChannel(
            guild,
            instance.userId,
            user.username
          );

          if (channel) {
            this.state.setUserChannel(instance.userId, channel.id);
            await this.clearChannelMessages(channel);
            this.state.getUserStatusMessages().delete(instance.userId);

            // Send sync message using status embed
            const {
              StatusEmbedBuilder,
            } = require("../components/embeds/status-embed");
            const {
              InstanceButtonBuilder,
            } = require("../components/buttons/instance-buttons");

            const embed = StatusEmbedBuilder.create(instance, "sync");
            const buttons = InstanceButtonBuilder.createInstanceControlButtons(
              instance.userId,
              instance
            );

            await channel.send({
              embeds: [embed],
              components: [buttons],
            });

            logger.info(
              `✅ Synced ${user.username}'s instance (${instance.status})`
            );
          } else {
            logger.info(
              `No command channel found for ${user.username}, will create on next interaction`
            );
          }
        } catch (error) {
          logger.error(
            `Error syncing instance for user ${instance.userId}:`,
            error.message
          );
        }
      }

      logger.info("✅ Instance synchronization complete");
    } catch (error) {
      logger.error("❌ Failed to sync instances on startup:", error.message);
    }
  }

  async refreshRegistrationStats(lambdaService) {
    const registrationStats = this.state.getRegistrationStats();
    if (registrationStats.size === 0) return;

    logger.info(
      `🔄 Refreshing registration stats for ${registrationStats.size} channels`
    );

    try {
      // Get system data for stats
      const summary = await lambdaService.getAdminOverview("system");
      const allCosts = await lambdaService.getAllCosts().catch(() => null);

      // Get license pools
      let licensePools = [];
      try {
        const adminResult = await lambdaService.getAdminOverview("system");
        if (adminResult.licenses?.pools) {
          licensePools = adminResult.licenses.pools.filter(
            (pool) => pool.isActive
          );
        }
      } catch (error) {
        logger.warn("Could not fetch license pools for stats:", error);
      }

      // Calculate supporter data
      const supporterData = this.calculateSupporterCredits();

      const {
        RegistrationEmbedBuilder,
      } = require("../components/embeds/registration-embed");
      const embed = RegistrationEmbedBuilder.createStatsEmbed(
        summary.summary,
        allCosts,
        licensePools,
        supporterData
      );

      const invalidMappings = [];

      for (const [channelId, messageId] of registrationStats.entries()) {
        try {
          const channel = await this.client.channels.fetch(channelId);
          if (!channel) {
            logger.warn(`Channel ${channelId} not found, marking for cleanup`);
            invalidMappings.push(channelId);
            continue;
          }

          const message = await channel.messages.fetch(messageId);
          if (!message) {
            logger.warn(`Message ${messageId} not found, marking for cleanup`);
            invalidMappings.push(channelId);
            continue;
          }

          await message.edit({ embeds: [embed] });
          logger.debug(`✅ Refreshed stats in channel ${channelId}`);
        } catch (err) {
          logger.error(`Failed to refresh stats in ${channelId}:`, err.message);
          if (
            err.message.includes("Unknown Message") ||
            err.message.includes("Unknown Channel")
          ) {
            invalidMappings.push(channelId);
          }
        }
      }

      // Clean up invalid mappings
      for (const channelId of invalidMappings) {
        logger.info(
          `🧹 Cleaning up invalid registration stats mapping: ${channelId}`
        );
        registrationStats.delete(channelId);
        await this.clearMappingFromDB("registrationStats");
      }

      logger.info(
        `✅ Registration stats refresh completed. Cleaned up ${invalidMappings.length} invalid mappings.`
      );
    } catch (error) {
      logger.error("❌ Failed to build stats embed:", error.message);
    }
  }

  async refreshCommandChannels(lambdaService) {
    logger.debug("🔄 Auto-refreshing command channel statuses...");

    try {
      const result = await lambdaService.getAllInstances();
      let updatedCount = 0;
      let checkedCount = 0;

      for (const instance of result.instances) {
        try {
          const channelId = this.state.getUserChannels().get(instance.userId);
          if (!channelId) continue;

          const channel = this.client.channels.cache.get(channelId);
          if (!channel) continue;

          checkedCount++;

          // Check if status changed
          const lastStatus = this.state
            .getLastKnownStatus()
            .get(instance.userId);
          const statusChanged =
            !lastStatus ||
            lastStatus.status !== instance.status ||
            lastStatus.updatedAt !== instance.updatedAt ||
            lastStatus.url !== instance.url;

          if (statusChanged) {
            this.state.setLastKnownStatus(instance.userId, {
              status: instance.status,
              updatedAt: instance.updatedAt,
              url: instance.url,
            });

            // Update status message
            const {
              StatusEmbedBuilder,
            } = require("../components/embeds/status-embed");
            const {
              InstanceButtonBuilder,
            } = require("../components/buttons/instance-buttons");

            const embed = StatusEmbedBuilder.create(instance);
            const buttons = InstanceButtonBuilder.createInstanceControlButtons(
              instance.userId,
              instance
            );

            const existingMessageId = this.state
              .getUserStatusMessages()
              .get(instance.userId);
            if (existingMessageId) {
              try {
                const existingMessage = await channel.messages.fetch(
                  existingMessageId
                );
                await existingMessage.edit({
                  embeds: [embed],
                  components: [buttons],
                });
              } catch {
                const newMessage = await channel.send({
                  embeds: [embed],
                  components: [buttons],
                });
                this.state.setUserStatusMessage(instance.userId, newMessage.id);
              }
            } else {
              const newMessage = await channel.send({
                embeds: [embed],
                components: [buttons],
              });
              this.state.setUserStatusMessage(instance.userId, newMessage.id);
            }

            updatedCount++;
          }
        } catch (error) {
          logger.warn(
            `Failed to refresh status for user ${instance.userId}:`,
            error.message
          );
        }
      }

      if (checkedCount > 0) {
        logger.debug(
          `🔄 Checked ${checkedCount} channels, updated ${updatedCount} with changes`
        );
      }
    } catch (error) {
      logger.warn("⚠️ Failed to auto-refresh command channels:", error.message);
    }
  }

  async cleanupOldCache(lambdaService) {
    logger.debug("🧹 Cleaning up old status cache entries...");

    try {
      const result = await lambdaService.getAllInstances();
      const activeUserIds = new Set(result.instances.map((i) => i.userId));
      let removedCount = 0;

      const lastKnownStatus = this.state.getLastKnownStatus();
      for (const userId of lastKnownStatus.keys()) {
        if (!activeUserIds.has(userId)) {
          lastKnownStatus.delete(userId);
          this.state.getUserStatusMessages().delete(userId);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        logger.info(`🧹 Cleaned up ${removedCount} old status cache entries`);
      }
    } catch (error) {
      logger.warn("⚠️ Failed to clean up status cache:", error.message);
    }
  }

  async checkNotifications(lambdaService) {
    try {
      const result = await lambdaService.getAllInstances();
      const now = Math.floor(Date.now() / 1000);
      const twoMinutesAgo = now - 120;

      for (const instance of result.instances) {
        if (
          instance.linkedSessionId &&
          instance.status === "running" &&
          instance.startedAt &&
          instance.startedAt >= twoMinutesAgo
        ) {
          try {
            const sessionResult = await lambdaService.listSessions(
              instance.userId
            );
            const session = sessionResult.sessions?.find(
              (s) => s.sessionId === instance.linkedSessionId
            );

            if (session && session.status === "active") {
              await this.sendScheduledSessionNotification(
                instance.userId,
                session,
                instance
              );
            }
          } catch (error) {
            logger.warn(
              `Failed to send notification for user ${instance.userId}:`,
              error.message
            );
          }
        }
      }
    } catch (error) {
      logger.warn("⚠️ Failed to check for notifications:", error.message);
    }
  }

  async cleanupInvalidMappings() {
    logger.info("🧹 Running periodic cleanup of invalid message mappings...");
    try {
      await this.refreshRegistrationStats(this.lambdaService);
      logger.info("✅ Periodic cleanup completed");
    } catch (error) {
      logger.error("❌ Periodic cleanup failed:", error.message);
    }
  }

  async sendScheduledSessionNotification(userId, session, instance) {
    try {
      const channelId = this.state.getUserChannels().get(userId);
      if (!channelId) return;

      const channel = this.client.channels.cache.get(channelId);
      if (!channel) return;

      const statusEmojis = {
        running: "🟢",
        starting: "🟡",
        stopping: "🟠",
        stopped: "🔴",
        created: "⚪",
        unknown: "❔",
      };

      const notificationEmbed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("🎮 Scheduled Session Ready!")
        .setDescription(
          `Your scheduled session **"${
            session.title || "Foundry VTT Session"
          }"** is now ready and running!`
        )
        .addFields([
          {
            name: "Session Details",
            value: [
              `**Start Time:** <t:${session.startTime}:F>`,
              `**End Time:** <t:${session.endTime}:F>`,
              `**Duration:** ${Math.round(
                (session.endTime - session.startTime) / 60
              )} minutes`,
              `**License Type:** ${session.licenseType?.toUpperCase()}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Access Information",
            value: [
              `**URL:** ${instance.url}`,
              `**Status:** ${statusEmojis[instance.status]} Running`,
              `**Auto-Shutdown:** <t:${instance.autoShutdownAt}:R>`,
            ].join("\n"),
            inline: true,
          },
        ])
        .setTimestamp();

      await channel.send({
        content: `<@${userId}> Your scheduled session is ready! 🎉`,
        embeds: [notificationEmbed],
      });

      logger.info(`✅ Sent scheduled session notification to user ${userId}`);
    } catch (error) {
      logger.error(
        `Failed to send scheduled session notification to user ${userId}:`,
        error
      );
    }
  }

  // Helper methods
  calculateSupporterCredits() {
    let totalSupporterCredits = 0;
    let supporterCount = 0;

    if (this.client.guilds.cache.size > 0) {
      const guild = this.client.guilds.cache.first();
      const members = guild.members.cache;

      for (const [, member] of members) {
        const supporterAmount = this.getUserSupporterAmount(member);
        if (supporterAmount > 0) {
          totalSupporterCredits += supporterAmount;
          supporterCount++;
        }
      }
    }

    return { supporterCount, totalSupporterCredits };
  }

  async clearMappingFromDB(configKey) {
    const dynamoClient = this.state.getDynamoClient();
    if (!dynamoClient) return;

    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: this.config.getAWSConfig().botConfigTableName,
          Item: {
            configKey,
            channelId: null,
            messageId: null,
            updatedAt: Math.floor(Date.now() / 1000),
          },
        })
      );
    } catch (error) {
      logger.error(`Failed to clear mapping ${configKey} from DB:`, error);
    }
  }

  async safeChannelSend(
    channel,
    messageOptions,
    fallbackChannelCreation = null
  ) {
    try {
      if (channel.guild) {
        const botMember = await channel.guild.members.fetch(
          this.client.user.id
        );
        const permissions = channel.permissionsFor(botMember);

        if (!permissions.has(PermissionFlagsBits.SendMessages)) {
          throw new Error(
            `Missing permission to send messages in channel ${channel.name}`
          );
        }
      }

      return await channel.send(messageOptions);
    } catch (error) {
      logger.error(`Error sending message to channel ${channel.id}:`, error);

      if (
        fallbackChannelCreation &&
        (error.code === 50001 || error.code === 50013)
      ) {
        logger.info("Attempting to create new channel as fallback");
        const newChannel = await fallbackChannelCreation();
        return await newChannel.send(messageOptions);
      }

      throw error;
    }
  }

  async cleanup() {
    logger.info("🧹 Cleaning up Discord service...");

    try {
      // Stop any ongoing log processing
      this.isProcessingLogs = false;
      this.logQueue = [];

      // Clear any pending timeouts or intervals
      if (this.logQueueTimeout) {
        clearTimeout(this.logQueueTimeout);
        this.logQueueTimeout = null;
      }

      // Cleanup state if available
      if (this.state) {
        this.state.cleanup();
      }

      logger.info("✅ Discord service cleanup completed");
    } catch (error) {
      logger.error("❌ Error during Discord service cleanup:", error.message);
    }
  }
}

module.exports = { DiscordService };
