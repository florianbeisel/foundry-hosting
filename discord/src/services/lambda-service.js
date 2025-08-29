const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { logger } = require("../utils/logger");

class LambdaService {
  constructor() {
    this.client = new LambdaClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.functionName = process.env.LAMBDA_FUNCTION_NAME;
  }

  async invoke(payload) {
    logger.debug("Lambda invocation:", JSON.stringify(payload, null, 2));

    const command = new InvokeCommand({
      FunctionName: this.functionName,
      Payload: JSON.stringify(payload),
      InvocationType: "RequestResponse",
    });

    try {
      const response = await this.client.send(command);

      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${response.FunctionError}`);
      }

      const result = JSON.parse(new TextDecoder().decode(response.Payload));

      if (result.statusCode !== 200) {
        const errorBody =
          typeof result.body === "string"
            ? JSON.parse(result.body)
            : result.body;
        throw new Error(errorBody.error || "Unknown Lambda error");
      }

      return typeof result.body === "string"
        ? JSON.parse(result.body)
        : result.body;
    } catch (error) {
      logger.error("Lambda invocation error:", error);
      throw error;
    }
  }

  // Instance management methods
  async getInstanceStatus(userId) {
    return this.invoke({ action: "status", userId });
  }

  async startInstance(userId) {
    return this.invoke({ action: "start", userId });
  }

  async stopInstance(userId) {
    return this.invoke({ action: "stop", userId });
  }

  async destroyInstance(userId, options = {}) {
    return this.invoke({
      action: "destroy",
      userId,
      ...options,
    });
  }

  async createInstance(options) {
    return this.invoke({
      action: "create",
      ...options,
    });
  }

  async updateVersion(userId, foundryVersion) {
    return this.invoke({
      action: "update-version",
      userId,
      foundryVersion,
    });
  }

  // Session management methods
  async listSessions(userId) {
    return this.invoke({ action: "list-sessions", userId });
  }

  async scheduleSession(options) {
    return this.invoke({
      action: "schedule-session",
      ...options,
    });
  }

  async cancelSession(userId, sessionId) {
    return this.invoke({
      action: "cancel-session",
      userId,
      sessionId,
    });
  }

  // License management methods
  async manageLicenseState(userId, operation) {
    return this.invoke({
      action: "manage-license-state",
      userId,
      licenseStateOperation: operation,
    });
  }

  async setLicenseSharing(userId, licenseType, allowSharing) {
    return this.invoke({
      action: "set-license-sharing",
      userId,
      licenseType,
      allowLicenseSharing: allowSharing,
    });
  }

  async getSessionsForLicense(licenseId) {
    return this.invoke({
      action: "get-sessions-for-license",
      licenseId,
    });
  }

  // Admin methods
  async getAdminOverview(userId) {
    return this.invoke({ action: "admin-overview", userId });
  }

  async getAllInstances() {
    return this.invoke({ action: "list-all", userId: "system" });
  }

  async getUserCosts(userId) {
    return this.invoke({ action: "get-user-costs", userId });
  }

  async getAllCosts() {
    return this.invoke({ action: "get-all-costs", userId: "system" });
  }

  // Emergency admin actions
  async forceShutdown(adminUserId, targetUserId, reason) {
    return this.invoke({
      action: "admin-force-shutdown",
      userId: adminUserId,
      targetUserId,
      forceReason: reason,
    });
  }

  async cancelAllSessions(adminUserId, reason) {
    return this.invoke({
      action: "admin-cancel-all-sessions",
      userId: adminUserId,
      forceReason: reason,
    });
  }

  async systemMaintenance(adminUserId, reason) {
    return this.invoke({
      action: "admin-system-maintenance",
      userId: adminUserId,
      forceReason: reason,
    });
  }

  async maintenanceReset(adminUserId, reason) {
    return this.invoke({
      action: "admin-maintenance-reset",
      userId: adminUserId,
      forceReason: reason,
    });
  }
}

module.exports = { LambdaService };
