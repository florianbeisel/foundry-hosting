import {
  IAMClient,
  CreateUserCommand,
  DeleteUserCommand,
  CreateAccessKeyCommand,
  DeleteAccessKeyCommand,
  PutUserPolicyCommand,
  DeleteUserPolicyCommand,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

export class IAMManager {
  private iam: IAMClient;

  constructor() {
    this.iam = new IAMClient({ region: process.env.AWS_REGION || "us-east-1" });
  }

  async createFoundryUser(
    userId: string,
    sanitizedUsername: string,
    bucketName: string
  ): Promise<{ accessKeyId: string; secretAccessKey: string }> {
    const userName = `foundry-${sanitizedUsername}-${userId.slice(-8)}`;

    console.log(`Creating IAM user: ${userName}`);

    try {
      // Create IAM user
      const createUserCommand = new CreateUserCommand({
        UserName: userName,
        Path: "/foundry/",
        Tags: [
          {
            Key: "UserId",
            Value: userId,
          },
          {
            Key: "SanitizedUsername",
            Value: sanitizedUsername,
          },
          {
            Key: "Application",
            Value: "FoundryVTT",
          },
          {
            Key: "Purpose",
            Value: "S3BucketAccess",
          },
        ],
      });

      await this.iam.send(createUserCommand);

      // Create policy for S3 bucket access
      await this.attachS3BucketPolicy(userName, bucketName);

      // Create access key
      const accessKey = await this.createAccessKey(userName);

      console.log(`✅ IAM user created with S3 access: ${userName}`);
      return accessKey;
    } catch (error) {
      console.error(`Failed to create IAM user ${userName}:`, error);
      throw new Error(`IAM user creation failed: ${error}`);
    }
  }

  private async attachS3BucketPolicy(
    userName: string,
    bucketName: string
  ): Promise<void> {
    const policyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:PutObject",
            "s3:PutObjectAcl",
            "s3:DeleteObject",
            "s3:ListBucket",
            "s3:GetBucketLocation",
          ],
          Resource: [
            `arn:aws:s3:::${bucketName}`,
            `arn:aws:s3:::${bucketName}/*`,
          ],
        },
      ],
    };

    const command = new PutUserPolicyCommand({
      UserName: userName,
      PolicyName: "FoundryS3BucketAccess",
      PolicyDocument: JSON.stringify(policyDocument),
    });

    await this.iam.send(command);
  }

  private async createAccessKey(
    userName: string
  ): Promise<{ accessKeyId: string; secretAccessKey: string }> {
    const command = new CreateAccessKeyCommand({
      UserName: userName,
    });

    const response = await this.iam.send(command);

    if (
      !response.AccessKey?.AccessKeyId ||
      !response.AccessKey?.SecretAccessKey
    ) {
      throw new Error("Failed to create access key");
    }

    return {
      accessKeyId: response.AccessKey.AccessKeyId,
      secretAccessKey: response.AccessKey.SecretAccessKey,
    };
  }

  async deleteFoundryUser(
    userId: string,
    sanitizedUsername: string
  ): Promise<void> {
    const userName = `foundry-${sanitizedUsername}-${userId.slice(-8)}`;

    console.log(`Deleting IAM user: ${userName}`);

    try {
      // List and delete all access keys
      const listKeysCommand = new ListAccessKeysCommand({
        UserName: userName,
      });

      const listResponse = await this.iam.send(listKeysCommand);

      if (listResponse.AccessKeyMetadata) {
        for (const keyMetadata of listResponse.AccessKeyMetadata) {
          const deleteKeyCommand = new DeleteAccessKeyCommand({
            UserName: userName,
            AccessKeyId: keyMetadata.AccessKeyId,
          });

          await this.iam.send(deleteKeyCommand);
          console.log(`Deleted access key: ${keyMetadata.AccessKeyId}`);
        }
      }

      // Delete user policy
      const deletePolicyCommand = new DeleteUserPolicyCommand({
        UserName: userName,
        PolicyName: "FoundryS3BucketAccess",
      });

      try {
        await this.iam.send(deletePolicyCommand);
      } catch (error) {
        // Policy might not exist, continue
        console.log(`Policy deletion failed (might not exist): ${error}`);
      }

      // Delete IAM user
      const deleteUserCommand = new DeleteUserCommand({
        UserName: userName,
      });

      await this.iam.send(deleteUserCommand);
      console.log(`✅ IAM user deleted: ${userName}`);
    } catch (error) {
      console.error(`Failed to delete IAM user ${userName}:`, error);
      throw new Error(`IAM user deletion failed: ${error}`);
    }
  }
}
