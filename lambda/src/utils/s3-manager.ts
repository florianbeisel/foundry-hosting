import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  HeadBucketCommand,
  PutBucketOwnershipControlsCommand,
} from "@aws-sdk/client-s3";

export class S3Manager {
  private s3: S3Client;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || "us-east-1";
    this.s3 = new S3Client({ region: this.region });
  }

  async createFoundryBucket(
    userId: string,
    sanitizedUsername: string
  ): Promise<string> {
    // Create bucket name with sanitized username for better readability
    const bucketName = `foundry-${sanitizedUsername}-${userId.slice(
      -8
    )}`.toLowerCase();

    console.log(`Setting up S3 bucket: ${bucketName}`);

    try {
      // Check if bucket already exists
      let bucketExists = false;
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: bucketName }));
        bucketExists = true;
        console.log(`S3 bucket already exists: ${bucketName}`);
      } catch (headError: any) {
        if (
          headError.name === "NoSuchBucket" ||
          headError.name === "NotFound"
        ) {
          bucketExists = false;
        } else {
          // Re-throw other errors (like access denied)
          throw headError;
        }
      }

      // Create the bucket only if it doesn't exist
      if (!bucketExists) {
        console.log(`Creating new S3 bucket: ${bucketName}`);
        const createCommand = new CreateBucketCommand({
          Bucket: bucketName,
          CreateBucketConfiguration:
            this.region !== "us-east-1"
              ? {
                  LocationConstraint: this.region as any, // AWS regions are valid LocationConstraints
                }
              : undefined,
        });

        try {
          await this.s3.send(createCommand);
          console.log(`✅ S3 bucket created: ${bucketName}`);
        } catch (createError: any) {
          // Handle race condition where bucket was created between head and create calls
          if (
            createError.name === "BucketAlreadyOwnedByYou" ||
            createError.name === "BucketAlreadyExists"
          ) {
            console.log(`S3 bucket was created concurrently: ${bucketName}`);
          } else {
            throw createError;
          }
        }
      }

      // Always configure the bucket (in case previous configuration failed)
      console.log(`Configuring S3 bucket: ${bucketName}`);

      // Enable ACLs on the bucket (required for Foundry VTT uploads)
      await this.enableBucketAcls(bucketName);

      // Configure Block Public Access settings to allow public policies
      await this.configurePublicAccessBlock(bucketName);

      // Configure bucket policy for public read access
      await this.configureBucketPolicy(bucketName);

      // Configure CORS for Foundry VTT
      await this.configureBucketCors(bucketName);

      // Enable versioning (optional but recommended)
      await this.enableBucketVersioning(bucketName);

      console.log(`✅ S3 bucket configured successfully: ${bucketName}`);
      return bucketName;
    } catch (error) {
      console.error(`Failed to setup S3 bucket ${bucketName}:`, error);
      throw new Error(`S3 bucket setup failed: ${error}`);
    }
  }

  private async enableBucketAcls(bucketName: string): Promise<void> {
    // Enable ACLs on the bucket (required for Foundry VTT uploads)
    const command = new PutBucketOwnershipControlsCommand({
      Bucket: bucketName,
      OwnershipControls: {
        Rules: [
          {
            ObjectOwnership: "BucketOwnerPreferred", // Allows ACLs
          },
        ],
      },
    });

    await this.s3.send(command);
  }

  private async configurePublicAccessBlock(bucketName: string): Promise<void> {
    // Allow public policies and ACLs for static asset serving
    const command = new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false, // This is the key setting that was blocking us
        RestrictPublicBuckets: false,
      },
    });

    await this.s3.send(command);
  }

  private async configureBucketPolicy(bucketName: string): Promise<void> {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Action: "s3:GetObject",
          Effect: "Allow",
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Principal: "*",
        },
      ],
    };

    const command = new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy),
    });

    await this.s3.send(command);
  }

  private async configureBucketCors(bucketName: string): Promise<void> {
    const corsConfiguration = {
      CORSRules: [
        {
          AllowedOrigins: ["*"],
          AllowedHeaders: ["*"],
          AllowedMethods: ["GET", "POST", "HEAD"],
          ExposeHeaders: [],
          MaxAgeSeconds: 3000,
        },
      ],
    };

    const command = new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: corsConfiguration,
    });

    await this.s3.send(command);
  }

  private async enableBucketVersioning(bucketName: string): Promise<void> {
    const command = new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: {
        Status: "Enabled",
      },
    });

    await this.s3.send(command);
  }

  async deleteFoundryBucket(bucketName: string): Promise<void> {
    console.log(`Deleting S3 bucket: ${bucketName}`);

    try {
      // First, delete all objects and versions in the bucket
      await this.emptyBucket(bucketName);

      // Wait a moment for eventual consistency
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Then delete the bucket itself
      const deleteCommand = new DeleteBucketCommand({
        Bucket: bucketName,
      });

      await this.s3.send(deleteCommand);
      console.log(`✅ S3 bucket deleted: ${bucketName}`);
    } catch (error) {
      console.error(`Failed to delete S3 bucket ${bucketName}:`, error);

      // If bucket is still not empty, provide more helpful error message
      if (error instanceof Error && error.message.includes("BucketNotEmpty")) {
        throw new Error(
          `S3 bucket deletion failed: Bucket still contains objects after emptying. This may be due to eventual consistency - please try again in a few minutes.`
        );
      }

      throw new Error(`S3 bucket deletion failed: ${error}`);
    }
  }

  private async emptyBucket(bucketName: string): Promise<void> {
    try {
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      let listResponse: any;

      do {
        // List all object versions in the bucket (including delete markers)
        const listCommand = new ListObjectVersionsCommand({
          Bucket: bucketName,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        });

        listResponse = await this.s3.send(listCommand);

        // Collect all versions and delete markers to delete
        const objectsToDelete: any[] = [];

        // Add all object versions
        if (listResponse.Versions && listResponse.Versions.length > 0) {
          objectsToDelete.push(
            ...listResponse.Versions.map((version: any) => ({
              Key: version.Key!,
              VersionId: version.VersionId!,
            }))
          );
        }

        // Add all delete markers
        if (
          listResponse.DeleteMarkers &&
          listResponse.DeleteMarkers.length > 0
        ) {
          objectsToDelete.push(
            ...listResponse.DeleteMarkers.map((marker: any) => ({
              Key: marker.Key!,
              VersionId: marker.VersionId!,
            }))
          );
        }

        // Delete all versions and delete markers in batches
        if (objectsToDelete.length > 0) {
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: objectsToDelete,
            },
          });

          await this.s3.send(deleteCommand);
          console.log(
            `Deleted ${objectsToDelete.length} object versions/delete markers from ${bucketName}`
          );
        }

        keyMarker = listResponse.NextKeyMarker;
        versionIdMarker = listResponse.NextVersionIdMarker;
      } while (listResponse.IsTruncated);

      console.log(`✅ Successfully emptied bucket: ${bucketName}`);
    } catch (error) {
      console.error(`Failed to empty bucket ${bucketName}:`, error);
      // Don't throw here - we still want to try to delete the bucket
    }
  }

  generateFoundryAwsConfig(
    bucketName: string,
    accessKeyId: string,
    secretAccessKey: string
  ): string {
    const awsConfig = {
      buckets: [bucketName],
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    };

    return JSON.stringify(awsConfig);
  }

  getBucketUrl(bucketName: string): string {
    return `https://${bucketName}.s3.${this.region}.amazonaws.com`;
  }
}
