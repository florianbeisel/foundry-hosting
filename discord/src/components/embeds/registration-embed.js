const { EmbedBuilder } = require("discord.js");

class RegistrationEmbedBuilder {
  static create() {
    return new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("Register Your Foundry VTT Instance")
      .setDescription(
        "Create and manage your personal Foundry VTT instance with flexible license options."
      )
      .addFields([
        {
          name: "🚀 Instance Features",
          value:
            "• Dedicated Foundry VTT server\n• Custom URL based on your username\n• Full admin access\n• Real-time status monitoring",
        },
        {
          name: "🔑 License Options",
          value:
            "• **BYOL (Bring Your Own License):** Use your own Foundry license\n• **Shared Instances:** Use community-shared licenses (schedule-based access)\n• **License Pooling:** Share your license with the community",
        },
        {
          name: "💰 Cost Model",
          value:
            "• Transparent usage tracking\n• Voluntary cost coverage via Ko-fi\n• No upfront fees or forced payments\n• Supporter role discounts available",
        },
      ])
      .setFooter({
        text: "💡 Tip: Licenses can be pooled, instances are shared. Click Register to get started!",
      })
      .setTimestamp();
  }

  static createStatsEmbed(summary, costData, licensePools, supporterData) {
    const { supporterCount, totalSupporterCredits } = supporterData;

    const adjustedUncoveredCost = Math.max(
      0,
      costData ? costData.totalUncovered - totalSupporterCredits : 0
    );

    const totalCoverage = costData
      ? costData.totalDonations + totalSupporterCredits
      : 0;

    const coveragePercentage =
      costData && costData.totalCosts > 0
        ? Math.round((totalCoverage / costData.totalCosts) * 100)
        : 0;

    const coverageColor =
      coveragePercentage >= 100 ? "🟢" : coveragePercentage >= 75 ? "🟡" : "🔴";

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("📊 Foundry VTT Community Statistics")
      .setDescription("Real-time overview of our community's Foundry VTT usage")
      .setTimestamp();

    // Instance Status
    embed.addFields([
      {
        name: "🚀 Instance Status",
        value: [
          `**Total Instances:** ${summary.totalInstances}`,
          `**Currently Running:** ${summary.runningInstances}`,
          `**BYOL Instances:** ${summary.byolInstances}`,
          `**Shared Instances:** ${summary.pooledInstances}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "🔗 License Pool Status",
        value: [
          `**Active License Pools:** ${licensePools.length}`,
          `**Total Shared Licenses:** ${licensePools.length}`,
          `**Available for Scheduling:** ${
            licensePools.length > 0 ? "✅ Yes" : "❌ None"
          }`,
          `**Community Members Sharing:** ${licensePools.length}`,
        ].join("\n"),
        inline: true,
      },
    ]);

    // Cost Coverage
    const costLine =
      summary.estimatedMonthlyCost !== undefined
        ? `$${summary.estimatedMonthlyCost.toFixed(2)}`
        : `$${(summary.runningInstances * 0.1 * 720).toFixed(2)}`;

    embed.addFields([
      {
        name: `${coverageColor} Cost Coverage (${coveragePercentage}%)`,
        value: [
          `**Monthly Cost:** ${costLine}`,
          `**Donations Received:** $${
            costData?.totalDonations.toFixed(2) || "0.00"
          }`,
          ...(supporterCount > 0
            ? [
                `**Supporter Credits:** $${totalSupporterCredits.toFixed(
                  2
                )} (${supporterCount} users)`,
              ]
            : []),
          `**Remaining Uncovered:** $${adjustedUncoveredCost.toFixed(2)}`,
        ].join("\n"),
        inline: false,
      },
    ]);

    // License Pool Details
    if (licensePools.length > 0) {
      const poolDetails = licensePools
        .slice(0, 3)
        .map((pool) => `**${pool.ownerUsername}**`)
        .join("\n");

      const morePools =
        licensePools.length > 3
          ? `\n*+${licensePools.length - 3} more license pools...*`
          : "";

      embed.addFields([
        {
          name: "🤝 Active License Pools",
          value: poolDetails + morePools,
          inline: false,
        },
      ]);
    }

    embed.setFooter({
      text: "💡 Tip: Use '/foundry dashboard' to get started!",
    });

    return embed;
  }
}

module.exports = { RegistrationEmbedBuilder };
