#!/bin/bash

echo "Fixing SSH key in AWS..."

# Delete existing key
echo "Deleting existing key..."
aws ec2 delete-key-pair --key-name foundry-backup-key --region eu-central-1 2>/dev/null || echo "Key didn't exist or couldn't delete"

# Import the key
echo "Importing key..."
aws ec2 import-key-pair \
--key-name foundry-backup-key \
--public-key-material fileb://~/.ssh/foundry-backup-key.pub \
--region eu-central-1

if [ $? -eq 0 ]; then
    echo "✅ Key imported successfully!"
    echo "Fingerprint: $(ssh-keygen -lf ~/.ssh/foundry-backup-key | awk '{print $2}')"
else
    echo "❌ Failed to import key"
fi