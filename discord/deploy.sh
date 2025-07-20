#!/bin/bash

# Discord Bot Deployment Script
# This script builds, pushes to ECR, and updates the ECS service

set -e  # Exit on any error

echo "🚀 Starting Discord Bot deployment..."

# Set default AWS region if not provided
AWS_REGION=${AWS_REGION:-eu-central-1}
STACK_NAME=${PULUMI_STACK:-development}

echo "📋 Using AWS Region: $AWS_REGION"
echo "📋 Using Pulumi Stack: $STACK_NAME"

# Get ECR repository URL from Pulumi stack outputs
echo "🔍 Getting ECR repository URL from Pulumi..."
ECR_REPO_URL=$(pulumi stack output discordBotOutputs --stack $STACK_NAME --json | jq -r '.ecrRepository.url')

if [ "$ECR_REPO_URL" == "null" ] || [ -z "$ECR_REPO_URL" ]; then
    echo "❌ Failed to get ECR repository URL from Pulumi stack outputs"
    echo "💡 Make sure you've deployed the Pulumi stack first: pulumi up"
    exit 1
fi

echo "✅ ECR Repository: $ECR_REPO_URL"

# Extract registry URL
ECR_REGISTRY=$(echo $ECR_REPO_URL | cut -d'/' -f1)

# Login to ECR
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

# Build Docker image for ARM64 (AWS Graviton - cheaper)
echo "🔨 Building Docker image for linux/arm64..."
docker build --platform linux/arm64 -t foundry-vtt-discord-bot .

# Tag for ECR
echo "🏷️  Tagging image for ECR..."
docker tag foundry-vtt-discord-bot:latest $ECR_REPO_URL:latest

# Push to ECR
echo "📤 Pushing image to ECR..."
docker push $ECR_REPO_URL:latest

# Get ECS service info
echo "🔍 Getting ECS service details..."
ECS_SERVICE_NAME=$(pulumi stack output discordBotOutputs --stack $STACK_NAME --json | jq -r '.service.name')
ECS_CLUSTER_NAME=$(pulumi stack output clusterName --stack $STACK_NAME 2>/dev/null || echo "foundry-vtt-cluster")

if [ "$ECS_SERVICE_NAME" == "null" ] || [ -z "$ECS_SERVICE_NAME" ]; then
    echo "❌ Failed to get ECS service name from Pulumi stack outputs"
    exit 1
fi

echo "✅ ECS Service: $ECS_SERVICE_NAME"
echo "✅ ECS Cluster: $ECS_CLUSTER_NAME"

# Force new deployment to pick up the new image
echo "🔄 Forcing ECS service to redeploy with new image..."
aws ecs update-service \
--cluster $ECS_CLUSTER_NAME \
--service $ECS_SERVICE_NAME \
--force-new-deployment \
--region $AWS_REGION

echo "✅ Deployment initiated! The service will pull the new image and restart."
echo "🔍 You can monitor the deployment with:"
echo "   aws ecs describe-services --cluster $ECS_CLUSTER_NAME --services $ECS_SERVICE_NAME --region $AWS_REGION"
echo ""
echo "🎉 Discord Bot deployment complete!"