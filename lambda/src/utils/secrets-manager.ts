import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  RestoreSecretCommand,
} from "@aws-sdk/client-secrets-manager";

interface FoundryCredentials {
  username: string;
  password: string;
  admin_key: string;
}

export class SecretsManager {
  private secrets: SecretsManagerClient;

  constructor() {
    this.secrets = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }

  async storeCredentials(
    userId: string,
    username: string,
    password: string,
    adminKey: string
  ): Promise<string> {
    const secretName = `foundry-credentials-${userId}`;

    const secretValue: FoundryCredentials = {
      username,
      password,
      admin_key: adminKey,
    };

    try {
      const command = new CreateSecretCommand({
        Name: secretName,
        Description: `Foundry VTT credentials for user ${userId}`,
        SecretString: JSON.stringify(secretValue),
        Tags: [
          {
            Key: "UserId",
            Value: userId,
          },
          {
            Key: "Application",
            Value: "FoundryVTT",
          },
        ],
      });

      const response = await this.secrets.send(command);
      return response.ARN!;
    } catch (error: any) {
      if (error.name === "ResourceExistsException") {
        // Secret already exists, update it
        const updateCommand = new UpdateSecretCommand({
          SecretId: secretName,
          SecretString: JSON.stringify(secretValue),
        });

        const response = await this.secrets.send(updateCommand);
        return response.ARN!;
      } else if (
        error.name === "InvalidRequestException" &&
        error.message &&
        error.message.includes("scheduled for deletion")
      ) {
        // Secret is scheduled for deletion, try to restore it first
        console.log(
          `Secret ${secretName} is scheduled for deletion, attempting to restore...`
        );

        try {
          // Restore the secret from deletion
          await this.secrets.send(
            new RestoreSecretCommand({
              SecretId: secretName,
            })
          );

          console.log(`Successfully restored secret ${secretName}`);

          // Now update it with new credentials
          const updateCommand = new UpdateSecretCommand({
            SecretId: secretName,
            SecretString: JSON.stringify(secretValue),
          });

          const response = await this.secrets.send(updateCommand);
          return response.ARN!;
        } catch (restoreError: any) {
          console.error(
            `Failed to restore secret ${secretName}:`,
            restoreError
          );

          // If restore fails, we might need to wait for complete deletion
          // or the secret might be in an intermediate state
          throw new Error(
            `Secret ${secretName} is scheduled for deletion and cannot be restored. ` +
              `Please try again in a few minutes, or contact an admin if this persists. ` +
              `Original error: ${error.message}`
          );
        }
      }
      throw error;
    }
  }

  async getCredentials(userId: string): Promise<FoundryCredentials | null> {
    const secretName = `foundry-credentials-${userId}`;

    try {
      const command = new GetSecretValueCommand({
        SecretId: secretName,
      });

      const response = await this.secrets.send(command);
      return JSON.parse(response.SecretString!);
    } catch (error: any) {
      // Only log as error if it's not a simple "not found" case
      if (error.name === "ResourceNotFoundException") {
        console.log(
          `No existing credentials found for user ${userId} (normal for new users)`
        );
      } else {
        console.error(
          `Error retrieving credentials for user ${userId}:`,
          error
        );
      }
      return null;
    }
  }

  async deleteSecret(secretArn: string): Promise<void> {
    const command = new DeleteSecretCommand({
      SecretId: secretArn,
      ForceDeleteWithoutRecovery: true,
    });

    await this.secrets.send(command);
  }
}
