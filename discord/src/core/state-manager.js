const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { logger } = require("../utils/logger");

class StateManager {
  constructor(config) {
    this.config = config;
    this.dynamoClient = null;
    this.state = {
      userChannels: new Map(), // userId -> channelId
      statusMonitors: new Map(), // userId -> interval
      registrationStats: new Map(), // channelId -> statsMessageId
      adminStatusMapping: new Map(), // channelId -> adminStatusMessageId
      userStatusMessages: new Map(), // userId -> messageId
      userDashboardMessages: new Map(), // userId -> dashboard messageId
      lastKnownStatus: new Map(), // userId -> { status, updatedAt, url }
    };
  }

  async initialize() {
    logger.info("🗄️ Initializing state management...");

    const awsConfig = this.config.getAWSConfig();
    if (awsConfig.botConfigTableName) {
      this.dynamoClient = DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: awsConfig.region })
      );
      logger.info("✅ DynamoDB client initialized");
    } else {
      logger.warn("⚠️ BOT_CONFIG_TABLE_NAME not set - mappings won't persist");
    }
  }

  // State getters
  getUserChannels() {
    return this.state.userChannels;
  }

  getStatusMonitors() {
    return this.state.statusMonitors;
  }

  getRegistrationStats() {
    return this.state.registrationStats;
  }

  getAdminStatusMapping() {
    return this.state.adminStatusMapping;
  }

  getUserStatusMessages() {
    return this.state.userStatusMessages;
  }

  getUserDashboardMessages() {
    return this.state.userDashboardMessages;
  }

  getLastKnownStatus() {
    return this.state.lastKnownStatus;
  }

  getDynamoClient() {
    return this.dynamoClient;
  }

  // State management methods
  setUserChannel(userId, channelId) {
    this.state.userChannels.set(userId, channelId);
  }

  removeUserChannel(userId) {
    this.state.userChannels.delete(userId);
    this.state.userStatusMessages.delete(userId);
    this.state.userDashboardMessages.delete(userId);
  }

  setStatusMonitor(userId, interval) {
    this.clearStatusMonitor(userId);
    this.state.statusMonitors.set(userId, interval);
  }

  clearStatusMonitor(userId) {
    const interval = this.state.statusMonitors.get(userId);
    if (interval) {
      clearInterval(interval);
      this.state.statusMonitors.delete(userId);
    }
  }

  clearAllStatusMonitors() {
    for (const [userId] of this.state.statusMonitors) {
      this.clearStatusMonitor(userId);
    }
  }

  setRegistrationStatsMapping(channelId, messageId) {
    this.state.registrationStats.set(channelId, messageId);
  }

  setAdminStatusMapping(channelId, messageId) {
    this.state.adminStatusMapping.set(channelId, messageId);
  }

  setUserStatusMessage(userId, messageId) {
    this.state.userStatusMessages.set(userId, messageId);
  }

  setUserDashboardMessage(userId, messageId) {
    this.state.userDashboardMessages.set(userId, messageId);
  }

  setLastKnownStatus(userId, status) {
    this.state.lastKnownStatus.set(userId, status);
  }

  // Cleanup methods
  cleanup() {
    logger.info("🧹 Cleaning up state...");
    
    try {
      // Clear all status monitors
      this.clearAllStatusMonitors();
      
      // Clear all state maps
      this.state.userChannels.clear();
      this.state.statusMonitors.clear();
      this.state.registrationStats.clear();
      this.state.adminStatusMapping.clear();
      this.state.userStatusMessages.clear();
      this.state.userDashboardMessages.clear();
      this.state.lastKnownStatus.clear();
      
      logger.info("✅ State cleanup completed");
    } catch (error) {
      logger.error("❌ Error during state cleanup:", error.message);
    }
  }
}

module.exports = { StateManager };
