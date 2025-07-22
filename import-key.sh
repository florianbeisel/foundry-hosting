#!/bin/bash

# Import SSH key to AWS
echo "Importing SSH key to AWS..."

# Check if key exists
if [ ! -f ~/.ssh/foundry-backup-key.pub ]; then
    echo "Error: Public key not found at ~/.ssh/foundry-backup-key.pub"
    exit 1
fi

# Import the key
aws ec2 import-key-pair \
--key-name foundry-backup-key \
--public-key-material fileb://~/.ssh/foundry-backup-key.pub \
--region eu-central-1

if [ $? -eq 0 ]; then
    echo "✅ Key imported successfully!"
    echo "You can now run the backup script."
else
    echo "❌ Failed to import key"
    echo "Make sure your AWS credentials are valid:"
    echo "  aws sts get-caller-identity"
fi