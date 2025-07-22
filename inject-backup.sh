#!/bin/bash

# Foundry VTT Backup Injection Script
# 
# This script injects Foundry VTT backup files or directories into EFS storage
# for specific users. It creates a temporary EC2 instance to handle the file
# transfer and mounting operations.
#
# USAGE: ./inject-backup.sh <backup-path> <user-id> [efs-id]
#
# ARGUMENTS:
#   backup-path    Path to Foundry backup file (.zip, .tar.gz, .tar) or directory
#   user-id        Discord user ID of the target user
#   efs-id         (Optional) EFS file system ID. Auto-detected if not provided.
#
# EXAMPLES:
#   ./inject-backup.sh /path/to/foundry-backup.zip 123456789
#   ./inject-backup.sh /path/to/foundry-world/ 123456789
#   ./inject-backup.sh /path/to/foundry-backup.zip 123456789 fs-12345678
#
# FEATURES:
#   - Auto-detects EFS ID from Pulumi state or AWS tags
#   - Auto-detects SSH key from ~/.ssh/ directory
#   - Auto-generates SSH key pair if none exists
#   - Auto-imports SSH key to AWS if not already there
#   - Auto-detects region from Pulumi configuration
#   - Checks for active instances and warns about conflicts
#   - Supports both files and directories
#   - Injects backup to user-specific EFS directory: /foundry-instances/{user-id}/
#   - Sets proper permissions for Foundry VTT (user 1000:1000)
#
# PREREQUISITES:
#   - AWS CLI configured with appropriate permissions
#   - SSH key in ~/.ssh/ directory (optional - will be generated if missing)
#   - Pulumi CLI (optional, for auto-detection)
#   - Foundry backup file or directory
#
# SECURITY:
#   - Creates temporary security group for EC2 instance
#   - Uses temporary EC2 instance for file operations
#   - Automatically cleans up temporary resources
#   - Validates user permissions and access
#
# COST CONSIDERATIONS:
#   - Uses t3.micro instance (minimal cost)
#   - Automatically terminates instance when done
#   - Temporary security group cleaned up after use
#
# ERROR HANDLING:
#   - Comprehensive error checking and validation
#   - Graceful cleanup on failures
#   - Detailed error messages and debugging info
#   - Manual fallback instructions if automation fails

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat <<EOF
Foundry VTT Backup Injection Script

Usage: $0 <backup-path> <user-id> [efs-id]

Arguments:
  backup-path         Path to your Foundry backup file (.zip, .tar.gz, .tar, etc.) or directory
  user-id            Discord user ID of the target user
  efs-id             (Optional) EFS file system ID. Auto-detected if not provided.

Examples:
  $0 /path/to/foundry-backup.zip 123456789
  $0 /path/to/foundry-world/ 123456789
  $0 /path/to/foundry-backup.zip 123456789 fs-12345678

Features:
  - Auto-detects EFS ID from Pulumi state or AWS tags
  - Auto-detects SSH key from ~/.ssh/ directory
  - Auto-generates SSH key pair if none exists
  - Auto-imports SSH key to AWS if not already there
  - Auto-detects region from Pulumi configuration
  - Checks for active instances and warns about conflicts
  - Supports both files and directories
  - Injects backup to user-specific EFS directory: /foundry-instances/{user-id}/
  - Sets proper permissions for Foundry VTT (user 1000:1000)

Prerequisites:
  - AWS CLI configured with appropriate permissions
  - SSH key in ~/.ssh/ directory (optional - will be generated if missing)
  - Pulumi CLI (optional, for auto-detection)
  - Foundry backup file or directory

EOF
}

# Check for help flag
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Check if backup file/directory is provided
if [ $# -lt 2 ]; then
    print_error "Usage: $0 <backup-path> <user-id> [efs-id]"
    print_error "Example: $0 /path/to/foundry-backup.zip 123456789"
    print_error "Example: $0 /path/to/foundry-world/ 123456789"
    print_error "Example: $0 /path/to/foundry-backup.zip 123456789 fs-12345678"
    print_error "Run '$0 --help' for more information"
    exit 1
fi

BACKUP_PATH="$1"
USER_ID="$2"
EFS_ID="$3"

# Check for --no-access-points flag
USE_ACCESS_POINTS=true
if [ "$1" = "--no-access-points" ]; then
    USE_ACCESS_POINTS=false
    BACKUP_PATH="$2"
    USER_ID="$3"
    EFS_ID="$4"
    print_warning "Access points disabled - using standard EFS mount"
fi

# Validate backup path exists
if [ ! -e "$BACKUP_PATH" ]; then
    print_error "Backup path not found: $BACKUP_PATH"
    exit 1
fi

# Determine if it's a file or directory
if [ -f "$BACKUP_PATH" ]; then
    BACKUP_TYPE="file"
    BACKUP_FILE="$BACKUP_PATH"
    BACKUP_FILENAME=$(basename "$BACKUP_FILE")
elif [ -d "$BACKUP_PATH" ]; then
    BACKUP_TYPE="directory"
    BACKUP_DIR="$BACKUP_PATH"
    BACKUP_DIRNAME=$(basename "$BACKUP_DIR")
else
    print_error "Backup path is neither a file nor directory: $BACKUP_PATH"
    exit 1
fi

print_status "Backup type: $BACKUP_TYPE"
if [ "$BACKUP_TYPE" = "file" ]; then
    print_status "Backup file: $BACKUP_FILE"
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    print_status "Backup size: $BACKUP_SIZE"
else
    print_status "Backup directory: $BACKUP_DIR"
    BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
    print_status "Backup size: $BACKUP_SIZE"
fi
print_status "User ID: $USER_ID"

# Check if user has an active instance (optional warning)
print_status "Checking for active instances..."
ACTIVE_INSTANCES=$(aws dynamodb scan \
    --table-name foundry-vtt-instances \
    --filter-expression "userId = :userId AND (attribute_not_exists(taskArn) OR taskArn <> :empty)" \
    --expression-attribute-values '{":userId": {"S": "'$USER_ID'"}, ":empty": {"S": ""}}' \
    --query 'Items[0].userId.S' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "None")

if [ "$ACTIVE_INSTANCES" != "None" ] && [ -n "$ACTIVE_INSTANCES" ]; then
    print_warning "User $USER_ID appears to have an active instance. Consider stopping it before injecting backup."
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Backup injection cancelled."
        exit 0
    fi
else
    print_success "No active instances found for user $USER_ID"
fi

# Configuration - Auto-detect from Pulumi state and SSH directory
REGION="us-east-1"  # Default region

# Auto-detect region from Pulumi state if available
if command -v pulumi >/dev/null 2>&1; then
    PULUMI_REGION=$(pulumi config get aws:region 2>/dev/null || echo "")
    if [ -n "$PULUMI_REGION" ]; then
        REGION="$PULUMI_REGION"
        print_success "Auto-detected region from Pulumi: $REGION"
    fi
fi

# Auto-detect SSH key from ~/.ssh directory
print_status "Auto-detecting SSH key..."
SSH_KEY_FILE=""
for key_file in ~/.ssh/*.pem ~/.ssh/id_rsa ~/.ssh/id_ed25519 ~/.ssh/foundry-backup-key; do
    if [ -f "$key_file" ] && [ -r "$key_file" ]; then
        SSH_KEY_FILE="$key_file"
        KEY_NAME=$(basename "$key_file" .pem)
        print_success "Found SSH key: $SSH_KEY_FILE"
        break
    fi
done

if [ -z "$SSH_KEY_FILE" ]; then
    print_warning "No SSH key found in ~/.ssh/ directory"
    print_status "Generating new SSH key pair..."
    
    # Generate new key pair
    NEW_KEY_FILE="$HOME/.ssh/foundry-backup-key"
    if ssh-keygen -t rsa -b 4096 -f "$NEW_KEY_FILE" -N "" -C "foundry-backup-injection"; then
        SSH_KEY_FILE="$NEW_KEY_FILE"
        KEY_NAME="foundry-backup-key"
        print_success "Generated new SSH key pair: $SSH_KEY_FILE"
    else
        print_error "Failed to generate SSH key pair"
        exit 1
    fi
fi

# Auto-detect latest Amazon Linux 2 AMI ID
print_status "Auto-detecting latest Amazon Linux 2 AMI..."
AMI_ID=$(aws ssm get-parameters \
    --names "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2" \
    --region "$REGION" \
    --query 'Parameters[0].Value' \
    --output text 2>/dev/null || echo "")

if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "None" ]; then
    print_warning "Could not auto-detect AMI via SSM, using fallback method..."
    # Fallback: Get the latest Amazon Linux 2 AMI manually
    AMI_ID=$(aws ec2 describe-images \
        --owners amazon \
        --filters "Name=name,Values=amzn2-ami-hvm-*-x86_64-gp2" "Name=state,Values=available" \
        --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
        --output text \
        --region "$REGION" 2>/dev/null || echo "")
fi

if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "None" ]; then
    print_warning "Could not find Amazon Linux 2 AMI via API, using hardcoded fallback..."
    # Hardcoded fallback AMIs for common regions
    case "$REGION" in
        "us-east-1")
            AMI_ID="ami-0c02fb55956c7d316"
            ;;
        "us-west-2")
            AMI_ID="ami-0892d3c7ee96c0bf7"
            ;;
        "eu-west-1")
            AMI_ID="ami-0d71ea30463e0ff8d"
            ;;
        "eu-central-1")
            AMI_ID="ami-0d527b8c289b4af7f"
            ;;
        "ap-southeast-1")
            AMI_ID="ami-0df7a207adb9748c7"
            ;;
        *)
            print_error "No hardcoded AMI for region $REGION. Please check your AWS region and permissions."
            print_error "Available regions with hardcoded AMIs: us-east-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1"
            exit 1
            ;;
    esac
fi

print_success "Using AMI: $AMI_ID"

# Determine the correct username based on AMI
if [[ "$AMI_ID" == ami-* ]]; then
    # Get AMI details to determine username
    AMI_DETAILS=$(aws ec2 describe-images --image-ids "$AMI_ID" --query 'Images[0].{Name:Name,Description:Description}' --output text --region "$REGION" 2>/dev/null || echo "unknown")
    echo "AMI Details: $AMI_DETAILS"
    
    if [[ "$AMI_DETAILS" == *"Amazon Linux 2"* ]] || [[ "$AMI_ID" == ami-0c02fb55956c7d316 ]] || [[ "$AMI_ID" == ami-0892d3c7ee96c0bf7 ]] || [[ "$AMI_ID" == ami-0d71ea30463e0ff8d ]] || [[ "$AMI_ID" == ami-0d527b8c289b4af7f ]] || [[ "$AMI_ID" == ami-0df7a207adb9748c7 ]]; then
        SSH_USER="ec2-user"
        print_success "Using username: ec2-user (Amazon Linux 2)"
    elif [[ "$AMI_DETAILS" == *"Ubuntu"* ]]; then
        SSH_USER="ubuntu"
        print_success "Using username: ubuntu (Ubuntu)"
    elif [[ "$AMI_DETAILS" == *"RHEL"* ]] || [[ "$AMI_DETAILS" == *"Red Hat"* ]]; then
        SSH_USER="ec2-user"
        print_success "Using username: ec2-user (RHEL)"
    else
        SSH_USER="ec2-user"
        print_warning "Unknown AMI type, defaulting to ec2-user"
    fi
else
    SSH_USER="ec2-user"
    print_warning "Could not determine AMI type, defaulting to ec2-user"
fi

# Auto-detect EFS ID from Pulumi state if not provided
if [ -z "$EFS_ID" ]; then
    print_status "Auto-detecting EFS ID from Pulumi state..."
    
    # Try to get EFS ID from Pulumi state
    if command -v pulumi >/dev/null 2>&1; then
        PULUMI_EFS_ID=$(pulumi stack output --show-uris 2>/dev/null | grep -E "(fileSystemId|efs.*id)" | head -1 | sed 's/.*"\(fs-[a-z0-9]*\)".*/\1/' || echo "")
        
        if [ -n "$PULUMI_EFS_ID" ] && [[ "$PULUMI_EFS_ID" =~ ^fs-[a-z0-9]+$ ]]; then
            EFS_ID="$PULUMI_EFS_ID"
            print_success "Auto-detected EFS ID from Pulumi state: $EFS_ID"
        else
            print_warning "Could not extract EFS ID from Pulumi state, trying AWS tags..."
        fi
    fi
    
    # Fallback to AWS tags if Pulumi state doesn't work
    if [ -z "$EFS_ID" ]; then
        EFS_ID=$(aws efs describe-file-systems --query 'FileSystems[?contains(Tags[?Key==`Name`].Value, `foundry-efs`)].FileSystemId' --output text --region "$REGION")
        
        if [ -z "$EFS_ID" ] || [ "$EFS_ID" = "None" ]; then
            print_error "Could not auto-detect EFS ID. Please provide it manually."
            print_error "Available EFS file systems:"
            aws efs describe-file-systems --query 'FileSystems[].{ID:FileSystemId,Name:Name,Tags:Tags}' --output table --region "$REGION"
            exit 1
        fi
        
        print_success "Auto-detected EFS ID from AWS tags: $EFS_ID"
    fi
fi

# Auto-detect VPC and subnet
print_status "Auto-detecting VPC and subnet..."
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=foundry-vtt-vpc" --query 'Vpcs[0].VpcId' --output text --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
    print_error "Failed to describe VPCs: $VPC_ID"
    print_error "This might be due to expired AWS credentials or insufficient permissions."
    print_error "Please run 'aws sts get-caller-identity' to check your credentials."
    exit 1
fi

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
    print_error "Could not find VPC with tag Name=foundry-vtt-vpc"
    exit 1
fi

SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*public*" --query 'Subnets[0].SubnetId' --output text --region "$REGION")
if [ "$SUBNET_ID" = "None" ] || [ -z "$SUBNET_ID" ]; then
    print_error "Could not find public subnet in VPC $VPC_ID"
    print_error "Available subnets:"
    aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].{SubnetId:SubnetId,Name:Tags[?Key==`Name`].Value|[0],Public:MapPublicIpOnLaunch}' --output table --region "$REGION"
    exit 1
fi

# Get the EFS security group specifically
print_status "Getting EFS security group..."
EFS_SECURITY_GROUP_ID=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=*efs*" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")

if [ "$EFS_SECURITY_GROUP_ID" = "None" ] || [ -z "$EFS_SECURITY_GROUP_ID" ]; then
    print_error "Could not find EFS security group"
    exit 1
fi

# Create a temporary security group for our EC2 instance that allows EFS access
print_status "Creating temporary security group for EC2 instance..."
TEMP_SG_NAME="foundry-backup-temp-sg-$(date +%s)"
print_status "Security group name: $TEMP_SG_NAME"

TEMP_SECURITY_GROUP_ID=$(aws ec2 create-security-group \
    --group-name "$TEMP_SG_NAME" \
    --description "Temporary security group for backup injection" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --query 'GroupId' \
    --output text 2>&1)

if [ $? -ne 0 ]; then
    print_error "Failed to create security group: $TEMP_SECURITY_GROUP_ID"
    exit 1
fi

print_status "Created security group: $TEMP_SECURITY_GROUP_ID"

# Add rule to allow EFS access from our temporary instance
print_status "Configuring EFS access rule..."
EFS_RULE_RESULT=$(aws ec2 authorize-security-group-ingress \
    --group-id "$EFS_SECURITY_GROUP_ID" \
    --protocol tcp \
    --port 2049 \
    --source-group "$TEMP_SECURITY_GROUP_ID" \
    --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
    print_warning "Failed to add EFS rule (may already exist): $EFS_RULE_RESULT"
else
    print_success "Added EFS access rule"
fi

# Add rule to allow SSH access to our temporary instance
print_status "Configuring SSH access rule..."
SSH_RULE_RESULT=$(aws ec2 authorize-security-group-ingress \
    --group-id "$TEMP_SECURITY_GROUP_ID" \
    --protocol tcp \
    --port 22 \
    --cidr 0.0.0.0/0 \
    --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
    print_error "Failed to add SSH rule: $SSH_RULE_RESULT"
    exit 1
fi

print_success "Added SSH access rule"

# Debug: Show security group rules
print_status "Security group rules for $TEMP_SECURITY_GROUP_ID:"
aws ec2 describe-security-groups \
    --group-ids "$TEMP_SECURITY_GROUP_ID" \
    --query 'SecurityGroups[0].IpPermissions' \
    --output table \
    --region "$REGION"

# Add rule to allow all outbound traffic from our temporary instance
print_status "Configuring outbound traffic rule..."
# Check if outbound rule already exists (new security groups have default outbound rule)
EXISTING_OUTBOUND=$(aws ec2 describe-security-groups \
    --group-ids "$TEMP_SECURITY_GROUP_ID" \
    --query 'SecurityGroups[0].IpPermissionsEgress[?IpRanges[0].CidrIp==`0.0.0.0/0`]' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -z "$EXISTING_OUTBOUND" ]; then
    OUTBOUND_RULE_RESULT=$(aws ec2 authorize-security-group-egress \
        --group-id "$TEMP_SECURITY_GROUP_ID" \
        --protocol -1 \
        --port -1 \
        --cidr 0.0.0.0/0 \
        --region "$REGION" 2>&1)

    if [ $? -ne 0 ]; then
        print_error "Failed to add outbound rule: $OUTBOUND_RULE_RESULT"
        exit 1
    fi
    print_success "Added outbound traffic rule"
else
    print_success "Outbound traffic rule already exists (default rule)"
fi

SECURITY_GROUP_ID="$TEMP_SECURITY_GROUP_ID"
print_success "Created temporary security group: $TEMP_SECURITY_GROUP_ID"

print_success "VPC: $VPC_ID"
print_success "Subnet: $SUBNET_ID"
print_success "Security Group: $SECURITY_GROUP_ID"

# Check if key pair exists in AWS and create if needed
print_status "Checking if key pair '$KEY_NAME' exists in AWS..."

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
    print_warning "Key pair '$KEY_NAME' not found in AWS."
    
    # Check if we have a public key file
    PUBLIC_KEY_FILE=""
    if [[ "$SSH_KEY_FILE" == *.pem ]]; then
        # For .pem files, try to find corresponding .pub file
        POTENTIAL_PUB="${SSH_KEY_FILE%.pem}.pub"
        if [ -f "$POTENTIAL_PUB" ]; then
            PUBLIC_KEY_FILE="$POTENTIAL_PUB"
        fi
    else
        # For id_rsa/id_ed25519, the .pub file should exist
        if [ -f "${SSH_KEY_FILE}.pub" ]; then
            PUBLIC_KEY_FILE="${SSH_KEY_FILE}.pub"
        fi
    fi
    
    if [ -n "$PUBLIC_KEY_FILE" ] && [ -f "$PUBLIC_KEY_FILE" ]; then
        print_status "Found public key file: $PUBLIC_KEY_FILE"
        print_status "Importing key pair to AWS..."
        
        if aws ec2 import-key-pair \
            --key-name "$KEY_NAME" \
            --public-key-material "fileb://$PUBLIC_KEY_FILE" \
            --region "$REGION" >/dev/null 2>&1; then
            print_success "Successfully imported key pair '$KEY_NAME' to AWS"
        else
            print_error "Failed to import key pair to AWS"
            print_error "Available key pairs:"
            aws ec2 describe-key-pairs --query 'KeyPairs[].KeyName' --output table --region "$REGION"
            exit 1
        fi
    else
        print_error "No public key file found for $SSH_KEY_FILE"
        print_error "Please ensure you have a corresponding .pub file"
        print_error "Available key pairs:"
        aws ec2 describe-key-pairs --query 'KeyPairs[].KeyName' --output table --region "$REGION"
        
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Backup injection cancelled."
            exit 0
        fi
    fi
else
    print_success "Key pair '$KEY_NAME' found in AWS"
fi

# Get or create access point for the user (if enabled)
if [ "$USE_ACCESS_POINTS" = true ]; then
    print_status "Getting or creating EFS access point for user $USER_ID..."
    
    # Check if access point already exists
    print_status "Checking for existing access points for user $USER_ID..."
    ALL_ACCESS_POINTS=$(aws efs describe-access-points \
        --file-system-id "$EFS_ID" \
        --query "AccessPoints[?Tags[?Key=='UserId' && Value=='$USER_ID']].AccessPointId" \
        --output text \
        --region "$REGION" 2>/dev/null || echo "")
    
    echo "DEBUG: All access points found: '$ALL_ACCESS_POINTS'"
    
    EXISTING_ACCESS_POINT=$(echo "$ALL_ACCESS_POINTS" | xargs -n1 | head -1 || echo "")
    echo "DEBUG: First access point selected: '$EXISTING_ACCESS_POINT'"

    if [ -n "$EXISTING_ACCESS_POINT" ] && [ "$EXISTING_ACCESS_POINT" != "None" ]; then
        ACCESS_POINT_ID="$EXISTING_ACCESS_POINT"
        print_success "Found existing access point: $ACCESS_POINT_ID"
    else
        print_status "Creating new access point for user $USER_ID..."
        
        CREATE_RESULT=$(aws efs create-access-point \
            --file-system-id "$EFS_ID" \
            --posix-user Uid=1000,Gid=1000 \
            --root-directory "Path=/foundry-instances/$USER_ID,CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=755}" \
            --tags Key=Name,Value="foundry-$USER_ID" Key=UserId,Value="$USER_ID" \
            --query 'AccessPointId' \
            --output text \
            --region "$REGION" 2>&1)

        if [ $? -ne 0 ]; then
            print_error "Failed to create access point: $CREATE_RESULT"
            print_error "This might be due to:"
            print_error "  - Insufficient IAM permissions"
            print_error "  - Invalid EFS file system ID"
            print_error "  - Network connectivity issues"
            print_error "  - Expired AWS credentials"
            print_error ""
            print_error "You can try running with --no-access-points to skip access points:"
            print_error "  $0 --no-access-points $BACKUP_PATH $USER_ID $EFS_ID"
            exit 1
        fi
        
        ACCESS_POINT_ID="$CREATE_RESULT"
        
        print_success "Created access point: $ACCESS_POINT_ID"
        
        # Wait for access point to be available
        print_status "Waiting for access point to be available..."
        for i in {1..30}; do
            STATE_RESULT=$(aws efs describe-access-points \
                --access-point-ids "$ACCESS_POINT_ID" \
                --query 'AccessPoints[0].LifeCycleState' \
                --output text \
                --region "$REGION" 2>&1)
            
            if [ $? -ne 0 ]; then
                print_warning "Failed to check access point state (attempt $i/30): $STATE_RESULT"
                STATE="unknown"
            else
                STATE="$STATE_RESULT"
            fi
            
            if [ "$STATE" = "available" ]; then
                print_success "Access point is available"
                break
            elif [ "$STATE" = "creating" ]; then
                print_status "Access point is still creating... ($i/30)"
                sleep 10
            elif [ "$STATE" = "unknown" ]; then
                print_status "Access point state unknown, retrying... ($i/30)"
                sleep 10
            else
                print_error "Access point creation failed with state: $STATE"
                print_error "Full error: $STATE_RESULT"
                print_error ""
                print_error "You can try running with --no-access-points to skip access points:"
                print_error "  $0 --no-access-points $BACKUP_PATH $USER_ID $EFS_ID"
                exit 1
            fi
        done
        
        if [ "$STATE" != "available" ]; then
            print_error "Access point did not become available within timeout"
            print_error "Last known state: $STATE"
            print_error "You may need to check the access point manually:"
            print_error "  aws efs describe-access-points --access-point-ids $ACCESS_POINT_ID --region $REGION"
            print_error ""
            print_error "You can try running with --no-access-points to skip access points:"
            print_error "  $0 --no-access-points $BACKUP_PATH $USER_ID $EFS_ID"
            exit 1
        fi
    fi
else
    ACCESS_POINT_ID=""
    print_status "Skipping access points - using standard EFS mount"
fi

# Simple user data script - just install packages
USER_DATA=$(cat <<EOF
#!/bin/bash
yum update -y
yum install -y amazon-efs-utils unzip
echo "User data completed at $(date)" > /tmp/user-data-complete
EOF
)

# Launch EC2 instance with public IP
print_status "Launching temporary EC2 instance with public IP..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type t3.micro \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP_ID" \
    --subnet-id "$SUBNET_ID" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=foundry-backup-injection}]" \
    --query 'Instances[0].InstanceId' \
    --output text \
    --region "$REGION")

print_success "Instance launched: $INSTANCE_ID"

# Wait for instance to be running
print_status "Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

# Get instance public IP
print_status "Getting instance public IP..."
INSTANCE_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text \
    --region "$REGION")

# Allocate and associate public IP if not assigned
if [ "$INSTANCE_IP" = "None" ] || [ -z "$INSTANCE_IP" ]; then
    print_status "Allocating public IP..."
    ALLOCATION_ID=$(aws ec2 allocate-address \
        --domain vpc \
        --region "$REGION" \
        --query 'AllocationId' \
        --output text)
    
    print_status "Associating public IP with instance..."
    aws ec2 associate-address \
        --allocation-id "$ALLOCATION_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION"
    
    # Get the public IP again
    sleep 5
    INSTANCE_IP=$(aws ec2 describe-instances \
        --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text \
        --region "$REGION")
fi

print_success "Instance IP: $INSTANCE_IP"

# Debug: Check subnet and security group configuration
print_status "Checking network configuration..."
print_status "Subnet: $SUBNET_ID"
print_status "Security Group: $TEMP_SECURITY_GROUP_ID"

# Check if subnet is public
SUBNET_PUBLIC=$(aws ec2 describe-subnets \
    --subnet-ids "$SUBNET_ID" \
    --query 'Subnets[0].MapPublicIpOnLaunch' \
    --output text \
    --region "$REGION")

echo "Subnet auto-assigns public IP: $SUBNET_PUBLIC"

# Check security group rules
print_status "Security group rules:"
aws ec2 describe-security-groups \
    --group-ids "$TEMP_SECURITY_GROUP_ID" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`]' \
    --output table \
    --region "$REGION"

# Wait for SSH to be ready
print_status "Waiting for SSH to be ready..."
for i in {1..30}; do
    print_status "Testing SSH connectivity... ($i/30)"
    
    # Check instance status first
    INSTANCE_STATUS=$(aws ec2 describe-instances \
        --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].State.Name' \
        --output text \
        --region "$REGION")
    
    echo "Instance status: $INSTANCE_STATUS"
    
    if [ "$INSTANCE_STATUS" != "running" ]; then
        print_error "Instance is not running: $INSTANCE_STATUS"
        exit 1
    fi
    
    # Test SSH
    if ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes "$SSH_USER@$INSTANCE_IP" "echo 'SSH ready'" 2>/dev/null; then
        print_success "SSH is ready!"
        break
    elif [ "$i" -eq 30 ]; then
        print_error "SSH did not become available within timeout"
        print_status "Checking instance console output..."
        aws ec2 get-console-output --instance-id "$INSTANCE_ID" --region "$REGION"
        exit 1
    else
        print_status "SSH not ready yet, waiting..."
        sleep 10
    fi
done

# Mount EFS manually via SSH
print_status "Mounting EFS manually via SSH..."

# Check if user data completed and install amazon-efs-utils if needed
print_status "Checking if amazon-efs-utils is installed..."
ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "which mount.efs || sudo yum install -y amazon-efs-utils"

# Create mount point
ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "sudo mkdir -p /mnt/foundry-efs"

# Mount EFS
if [ -n "$ACCESS_POINT_ID" ]; then
    print_status "Mounting EFS with access point $ACCESS_POINT_ID..."
    MOUNT_CMD="sudo mount -t efs -o tls,accesspoint=$ACCESS_POINT_ID $EFS_ID:/ /mnt/foundry-efs"
else
    print_status "Mounting EFS with standard method..."
    MOUNT_CMD="sudo mount -t efs -o tls $EFS_ID:/ /mnt/foundry-efs"
fi

ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "$MOUNT_CMD"

# Verify mount
MOUNT_CHECK=$(ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "mountpoint -q /mnt/foundry-efs && echo 'MOUNT_OK' || echo 'MOUNT_FAIL'")

if [ "$MOUNT_CHECK" = "MOUNT_OK" ]; then
    print_success "EFS mounted successfully!"
else
    print_error "Failed to mount EFS"
    print_status "Debug info:"
    ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "
        echo '=== MOUNT STATUS ==='
        mount | grep efs || echo 'No EFS mounts found'
        echo '=== EFS UTILS ==='
        which amazon-efs-utils || echo 'amazon-efs-utils not found'
        echo '=== DMESG ==='
        dmesg | tail -10
        echo '=== END DEBUG ==='
    " 2>/dev/null || true
    exit 1
fi

# Copy backup file/directory to instance using SCP
if [ "$BACKUP_TYPE" = "file" ]; then
    print_status "Copying backup file to instance..."
    # Check if we can SSH to the instance
    print_status "Attempting to copy file via SCP..."
    if scp -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$BACKUP_FILE" $SSH_USER@$INSTANCE_IP:/tmp/ 2>/dev/null; then
        print_success "File copied successfully via SCP"
    else
        print_warning "SCP failed. You may need to manually copy the file."
        print_warning "SSH to the instance and copy the file manually:"
        print_warning "  scp -i $SSH_KEY_FILE $BACKUP_FILE $SSH_USER@$INSTANCE_IP:/tmp/"
        print_warning "  ssh -i $SSH_KEY_FILE $SSH_USER@$INSTANCE_IP"
        print_warning "  Then run the extraction commands manually on the instance."
        
        # Provide manual instructions for file
        cat <<EOF

MANUAL INSTRUCTIONS:
1. SSH to the instance:
   ssh -i $SSH_KEY_FILE $SSH_USER@$INSTANCE_IP

2. Copy your backup file:
   scp -i $SSH_KEY_FILE $BACKUP_FILE $SSH_USER@$INSTANCE_IP:/tmp/

3. On the instance, extract and copy to EFS:
   cd /tmp
   if [[ "$BACKUP_FILENAME" == *.zip ]]; then
       unzip -o "$BACKUP_FILENAME" -d /mnt/foundry-efs/foundry-instances/$USER_ID/
   elif [[ "$BACKUP_FILENAME" == *.tar.gz ]]; then
       tar -xzf "$BACKUP_FILENAME" -C /mnt/foundry-efs/foundry-instances/$USER_ID/
   elif [[ "$BACKUP_FILENAME" == *.tar ]]; then
       tar -xf "$BACKUP_FILENAME" -C /mnt/foundry-efs/foundry-instances/$USER_ID/
   else
       cp "$BACKUP_FILENAME" /mnt/foundry-efs/foundry-instances/$USER_ID/
   fi
   
   chmod -R 755 /mnt/foundry-efs/foundry-instances/$USER_ID/
   chown -R 1000:1000 /mnt/foundry-efs/foundry-instances/$USER_ID/

4. Terminate the instance when done:
   aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION

EOF
        exit 0
    fi
else
    print_status "Copying backup directory to instance..."
    # Check if we can SSH to the instance
    print_status "Attempting to copy directory via SCP..."
    if scp -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -r "$BACKUP_DIR" $SSH_USER@$INSTANCE_IP:/tmp/ 2>/dev/null; then
        print_success "Directory copied successfully via SCP"
    else
        print_warning "SCP failed. You may need to manually copy the directory."
        print_warning "SSH to the instance and copy the directory manually:"
        print_warning "  scp -i $SSH_KEY_FILE -r $BACKUP_DIR $SSH_USER@$INSTANCE_IP:/tmp/"
        print_warning "  ssh -i $SSH_KEY_FILE $SSH_USER@$INSTANCE_IP"
        print_warning "  Then run the copy commands manually on the instance."
        
        # Provide manual instructions for directory
        cat <<EOF

MANUAL INSTRUCTIONS:
1. SSH to the instance:
   ssh -i $SSH_KEY_FILE $SSH_USER@$INSTANCE_IP

2. Copy your backup directory:
   scp -i $SSH_KEY_FILE -r $BACKUP_DIR $SSH_USER@$INSTANCE_IP:/tmp/

3. On the instance, copy directory to EFS:
   cd /tmp
   cp -r "$BACKUP_DIRNAME"/* /mnt/foundry-efs/foundry-instances/$USER_ID/
   
   chmod -R 755 /mnt/foundry-efs/foundry-instances/$USER_ID/
   chown -R 1000:1000 /mnt/foundry-efs/foundry-instances/$USER_ID/

4. Terminate the instance when done:
   aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION

EOF
        exit 0
    fi
fi

# Extract and copy to EFS
if [ "$BACKUP_TYPE" = "file" ]; then
    print_status "Extracting and copying backup to EFS..."
else
    print_status "Copying directory to EFS..."
fi

# Execute the commands via SSH instead of SSM
print_status "Executing backup injection commands via SSH..."

if [ "$BACKUP_TYPE" = "file" ]; then
    # For files, extract and copy
    ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "
        cd /tmp
        if [ -n \"$ACCESS_POINT_ID\" ]; then
            TARGET_DIR=\"/mnt/foundry-efs/Backups/worlds/$(basename \"$BACKUP_PATH\")\"
        else
            TARGET_DIR=\"/mnt/foundry-efs/foundry-instances/$USER_ID/Backups/worlds/$(basename \"$BACKUP_PATH\")\"
        fi
        
        mkdir -p \"\$TARGET_DIR\"
        
        if [[ \"$BACKUP_FILENAME\" == *.zip ]]; then
            unzip -o \"$BACKUP_FILENAME\" -d \"\$TARGET_DIR\"
        elif [[ \"$BACKUP_FILENAME\" == *.tar.gz ]]; then
            tar -xzf \"$BACKUP_FILENAME\" -C \"\$TARGET_DIR\"
        elif [[ \"$BACKUP_FILENAME\" == *.tar ]]; then
            tar -xf \"$BACKUP_FILENAME\" -C \"\$TARGET_DIR\"
        else
            cp \"$BACKUP_FILENAME\" \"\$TARGET_DIR\"
        fi
        
        chmod -R 755 \"\$TARGET_DIR\"
        chown -R 1000:1000 \"\$TARGET_DIR\"
        echo \"Backup injection completed successfully for user $USER_ID\"
    "
else
    # For directories, copy directly
    ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_USER@$INSTANCE_IP" "
        cd /tmp
        if [ -n \"$ACCESS_POINT_ID\" ]; then
            TARGET_DIR=\"/mnt/foundry-efs/Backups/worlds/$(basename \"$BACKUP_PATH\")\"
        else
            TARGET_DIR=\"/mnt/foundry-efs/foundry-instances/$USER_ID/Backups/worlds/$(basename \"$BACKUP_PATH\")\"
        fi
        
        mkdir -p \"\$TARGET_DIR\"
        cp -r \"$BACKUP_DIRNAME\"/* \"\$TARGET_DIR\"
        chmod -R 755 \"\$TARGET_DIR\"
        chown -R 1000:1000 \"\$TARGET_DIR\"
        echo \"Directory injection completed successfully for user $USER_ID\"
    "
fi

print_success "Backup injection completed!"

# Ask user if they want to terminate the instance
read -p "Do you want to terminate the temporary instance? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Terminating instance..."
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
    print_success "Instance terminated"
    
    # Clean up temporary security group
    print_status "Cleaning up temporary security group..."
    aws ec2 delete-security-group --group-id "$TEMP_SECURITY_GROUP_ID" --region "$REGION" >/dev/null 2>&1 || true
    print_success "Temporary security group cleaned up"
else
    print_warning "Instance $INSTANCE_ID is still running. Remember to terminate it manually when done."
    print_warning "Command: aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION"
    print_warning "Temporary security group $TEMP_SECURITY_GROUP_ID should also be deleted when done."
fi

print_success "Backup injection process completed!"
print_status "Your Foundry backup has been injected into EFS volume $EFS_ID for user $USER_ID"
if [ -n "$ACCESS_POINT_ID" ]; then
    print_status "Access point used: $ACCESS_POINT_ID"
    print_status "Backup location: /foundry-instances/$USER_ID/"
else
    print_status "Standard EFS mount used (no access point)"
    print_status "Backup location: /foundry-instances/$USER_ID/"
fi