import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";

export class Route53Manager {
  private route53: Route53Client;
  private hostedZoneId: string;
  private domainName: string;

  constructor(hostedZoneId: string, domainName: string) {
    this.route53 = new Route53Client({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.hostedZoneId = hostedZoneId;
    this.domainName = domainName;
  }

  async createUserDNSRecord(
    sanitizedUsername: string,
    albDnsName: string,
    albZoneId: string
  ): Promise<void> {
    const recordName = `${sanitizedUsername}.${this.domainName}`;

    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Create DNS record for Foundry user ${sanitizedUsername}`,
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: recordName,
              Type: "A",
              AliasTarget: {
                DNSName: albDnsName,
                EvaluateTargetHealth: false,
                HostedZoneId: albZoneId,
              },
            },
          },
        ],
      },
    });

    await this.route53.send(command);
  }

  async deleteUserDNSRecord(
    sanitizedUsername: string,
    albDnsName: string,
    albZoneId: string
  ): Promise<void> {
    const recordName = `${sanitizedUsername}.${this.domainName}`;

    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: this.hostedZoneId,
      ChangeBatch: {
        Comment: `Delete DNS record for Foundry user ${sanitizedUsername}`,
        Changes: [
          {
            Action: "DELETE",
            ResourceRecordSet: {
              Name: recordName,
              Type: "A",
              AliasTarget: {
                DNSName: albDnsName,
                EvaluateTargetHealth: false,
                HostedZoneId: albZoneId,
              },
            },
          },
        ],
      },
    });

    await this.route53.send(command);
  }

  getUserFoundryUrl(sanitizedUsername: string): string {
    return `https://${sanitizedUsername}.${this.domainName}`;
  }
}
