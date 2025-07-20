import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeTargetGroupsCommand,
  DescribeRulesCommand,
  ModifyRuleCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

export class ALBManager {
  private elbv2: ElasticLoadBalancingV2Client;
  private loadBalancerArn: string;
  private vpcId: string;

  constructor(loadBalancerArn: string, vpcId: string) {
    this.elbv2 = new ElasticLoadBalancingV2Client({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.loadBalancerArn = loadBalancerArn;
    this.vpcId = vpcId;
  }

  async createUserTargetGroup(sanitizedUsername: string): Promise<string> {
    const targetGroupName = `foundry-${sanitizedUsername}`;

    const command = new CreateTargetGroupCommand({
      Name: targetGroupName,
      Protocol: "HTTP",
      Port: 30000,
      VpcId: this.vpcId,
      TargetType: "ip",
      HealthCheckPath: "/",
      HealthCheckPort: "30000",
      HealthCheckProtocol: "HTTP",
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 10,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
      Matcher: {
        HttpCode: "200,302", // Foundry might redirect on first access
      },
      Tags: [
        {
          Key: "Name",
          Value: `foundry-${sanitizedUsername}`,
        },
        {
          Key: "SanitizedUsername",
          Value: sanitizedUsername,
        },
        {
          Key: "Application",
          Value: "FoundryVTT",
        },
      ],
    });

    const response = await this.elbv2.send(command);
    return response.TargetGroups![0].TargetGroupArn!;
  }

  async deleteUserTargetGroup(targetGroupArn: string): Promise<void> {
    const command = new DeleteTargetGroupCommand({
      TargetGroupArn: targetGroupArn,
    });

    await this.elbv2.send(command);
  }

  async registerTaskWithTargetGroup(
    targetGroupArn: string,
    taskPrivateIp: string
  ): Promise<void> {
    const command = new RegisterTargetsCommand({
      TargetGroupArn: targetGroupArn,
      Targets: [
        {
          Id: taskPrivateIp,
          Port: 30000,
        },
      ],
    });

    await this.elbv2.send(command);
  }

  async deregisterTaskFromTargetGroup(
    targetGroupArn: string,
    taskPrivateIp: string
  ): Promise<void> {
    const command = new DeregisterTargetsCommand({
      TargetGroupArn: targetGroupArn,
      Targets: [
        {
          Id: taskPrivateIp,
          Port: 30000,
        },
      ],
    });

    await this.elbv2.send(command);
  }

  async createListenerRule(
    sanitizedUsername: string,
    targetGroupArn: string,
    priority: number
  ): Promise<string> {
    // Get the default HTTPS listener ARN (you'll need to pass this in or discover it)
    const listenerArn = await this.getHttpsListenerArn();

    const command = new CreateRuleCommand({
      ListenerArn: listenerArn,
      Priority: priority,
      Conditions: [
        {
          Field: "host-header",
          Values: [`${sanitizedUsername}.${process.env.DOMAIN_NAME}`],
        },
      ],
      Actions: [
        {
          Type: "forward",
          TargetGroupArn: targetGroupArn,
        },
      ],
      Tags: [
        {
          Key: "SanitizedUsername",
          Value: sanitizedUsername,
        },
      ],
    });

    const response = await this.elbv2.send(command);
    return response.Rules![0].RuleArn!;
  }

  async deleteListenerRule(ruleArn: string): Promise<void> {
    const command = new DeleteRuleCommand({
      RuleArn: ruleArn,
    });

    await this.elbv2.send(command);
  }

  private async getHttpsListenerArn(): Promise<string> {
    // This would typically be passed as an environment variable
    // For now, return the environment variable
    const listenerArn = process.env.ALB_HTTPS_LISTENER_ARN;
    if (!listenerArn) {
      throw new Error("ALB_HTTPS_LISTENER_ARN environment variable not set");
    }
    return listenerArn;
  }

  async getNextAvailablePriority(): Promise<number> {
    const listenerArn = await this.getHttpsListenerArn();

    // Get all existing rules and find the next available priority
    const command = new DescribeRulesCommand({
      ListenerArn: listenerArn,
    });

    const response = await this.elbv2.send(command);
    const priorities =
      response.Rules?.map((rule) => rule.Priority)
        .filter((p) => p !== "default")
        .map(Number) || [];

    // Find the next available priority (starting from 100, incrementing by 10)
    let nextPriority = 100;
    while (priorities.includes(nextPriority)) {
      nextPriority += 10;
    }

    return nextPriority;
  }
}
