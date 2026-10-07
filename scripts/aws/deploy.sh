#!/usr/bin/env bash
#
# deploy.sh - Deploy Opaflix AWS infrastructure using CloudFormation
#
# This script:
#   1. Validates prerequisites (AWS CLI, credentials)
#   2. Generates certificates if needed
#   3. Deploys CloudFormation stack
#   4. Outputs configuration for Opaflix
#
# Usage:
#   ./deploy.sh                    # Interactive deployment
#   ./deploy.sh --dry-run          # Preview without deploying
#   ./deploy.sh --skip-certs       # Use existing certificates
#   ./deploy.sh --region eu-west-3 # Override region
#

set -euo pipefail

# =============================================================================
# Script Directory and Defaults
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/opaflix-cfn.yaml"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/config.env}"

# Default configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-opaflix}"
BUCKET_PREFIX="${BUCKET_PREFIX:-opaflix-sessions}"
GATEWAY_INSTANCE_ID="${GATEWAY_INSTANCE_ID:-}"
GATEWAY_INSTANCE_NAME="${GATEWAY_INSTANCE_NAME:-}"
CORS_ALLOWED_ORIGIN="${CORS_ALLOWED_ORIGIN:-https://opaflix.vercel.app}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/}"
CA_CERT_SSM_PARAM="${CA_CERT_SSM_PARAM:-}"

# Script options
DRY_RUN=false
SKIP_CERTS=false
CUSTOM_CA_CERT=""
WAIT_FOR_STACK=true
VERBOSE=false

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1" >&2
}

log_warn() {
    echo -e "\033[0;33m[WARNING]\033[0m $1"
}

log_debug() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "\033[0;90m[DEBUG]\033[0m $1"
    fi
}

show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy Opaflix AWS infrastructure using CloudFormation.

Options:
  --config FILE           Load configuration from file (default: ./config.env)
  --region REGION         AWS region (default: us-east-1)
  --stack-name NAME       CloudFormation stack name (default: opaflix)
  --bucket-prefix PREFIX  S3 bucket name prefix (default: opaflix-sessions)
  --gateway-id ID         EC2 Instance ID of OPA Gateway (optional if --gateway-name provided)
  --gateway-name NAME     Name tag of OPA Gateway EC2 instance (optional if --gateway-id provided)
  --cors-origin URL       CORS allowed origin (default: https://opaflix.vercel.app)
  --output-dir DIR        Output directory for certificates and config (default: ./data)
  --ssm-param NAME        SSM Parameter Store name for CA cert (default: /<stack-name>/ca-certificate)
  --skip-certs            Skip certificate generation (use existing)
  --ca-cert FILE          CA certificate file to use with --skip-certs (default: ./ca-cert.pem)
  --dry-run               Validate template without deploying
  --no-wait               Don't wait for stack creation to complete
  --verbose               Enable verbose output
  -h, --help              Show this help message

Environment Variables:
  AWS_REGION              AWS region
  AWS_PROFILE             AWS CLI profile to use
  STACK_NAME              CloudFormation stack name
  BUCKET_PREFIX           S3 bucket name prefix
  GATEWAY_INSTANCE_ID     EC2 Instance ID of OPA Gateway
  GATEWAY_INSTANCE_NAME   Name tag of OPA Gateway EC2 instance
  CORS_ALLOWED_ORIGIN     CORS allowed origin URL
  CA_CERT_SSM_PARAM       SSM Parameter Store name for CA certificate
  CONFIG_FILE             Path to config file

Examples:
  $(basename "$0")
  $(basename "$0") --config config.env
  $(basename "$0") --region eu-west-3 --bucket-prefix my-sessions
  $(basename "$0") --gateway-name my-opa-gateway
  $(basename "$0") --ssm-param /my-org/opaflix/ca-cert
  $(basename "$0") --skip-certs --ca-cert /path/to/my-ca.pem
  $(basename "$0") --dry-run --verbose
EOF
}

cleanup() {
    # Clean up temporary files on exit
    if [[ -n "${TEMP_FILE:-}" && -f "$TEMP_FILE" ]]; then
        rm -f "$TEMP_FILE"
    fi
}

trap cleanup EXIT

# =============================================================================
# Parse Arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --bucket-prefix)
            BUCKET_PREFIX="$2"
            shift 2
            ;;
        --gateway-id)
            GATEWAY_INSTANCE_ID="$2"
            shift 2
            ;;
        --gateway-name)
            GATEWAY_INSTANCE_NAME="$2"
            shift 2
            ;;
        --cors-origin)
            CORS_ALLOWED_ORIGIN="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --ssm-param)
            CA_CERT_SSM_PARAM="$2"
            shift 2
            ;;
        --skip-certs)
            SKIP_CERTS=true
            shift
            ;;
        --ca-cert)
            CUSTOM_CA_CERT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-wait)
            WAIT_FOR_STACK=false
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Load config file if it exists
if [[ -f "$CONFIG_FILE" ]]; then
    log_info "Loading configuration from $CONFIG_FILE"
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# Set default SSM parameter name based on stack name (after all overrides are applied)
CA_CERT_SSM_PARAM="${CA_CERT_SSM_PARAM:-/${STACK_NAME}/ca-certificate}"

# =============================================================================
# Validate Prerequisites
# =============================================================================

log_info "Validating prerequisites..."

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is required but not installed."
    log_error "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS CLI version
AWS_CLI_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)
log_debug "AWS CLI version: $AWS_CLI_VERSION"

# Check for jq (optional but recommended)
if ! command -v jq &> /dev/null; then
    log_warn "jq is not installed. Some output formatting may be limited."
    log_warn "Install it with: brew install jq (macOS) or apt-get install jq (Linux)"
fi

# Check AWS credentials
log_info "Checking AWS credentials..."
if ! aws sts get-caller-identity --region "$AWS_REGION" > /dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid."
    log_error "Configure credentials with: aws configure"
    log_error "Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    exit 1
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text --region "$AWS_REGION")
AWS_CALLER_ARN=$(aws sts get-caller-identity --query 'Arn' --output text --region "$AWS_REGION")
log_success "Authenticated as: $AWS_CALLER_ARN"
log_debug "Account ID: $AWS_ACCOUNT_ID"

# Check CloudFormation template exists
if [[ ! -f "$TEMPLATE_FILE" ]]; then
    log_error "CloudFormation template not found: $TEMPLATE_FILE"
    exit 1
fi

# =============================================================================
# Generate Certificates
# =============================================================================

APP_CERT_FILE="$OUTPUT_DIR/opaflix-cert.pem"
APP_KEY_FILE="$OUTPUT_DIR/opaflix-key.pem"

if [[ "$SKIP_CERTS" == "true" ]]; then
    log_info "Skipping certificate generation (--skip-certs)"

    # Use custom CA cert path if provided, otherwise default to ./ca-cert.pem
    CA_CERT_FILE="${CUSTOM_CA_CERT:-./ca-cert.pem}"
    log_info "Loading CA certificate from: $CA_CERT_FILE"

    # Verify certificates exist
    if [[ ! -f "$CA_CERT_FILE" ]]; then
        log_error "CA certificate not found: $CA_CERT_FILE"
        log_error "Run without --skip-certs to generate certificates, or use --ca-cert to specify the file."
        exit 1
    fi

    if [[ ! -f "$APP_CERT_FILE" || ! -f "$APP_KEY_FILE" ]]; then
        log_error "Application certificate/key not found in $OUTPUT_DIR"
        exit 1
    fi
else
    # Default CA cert location when generating certificates
    CA_CERT_FILE="$OUTPUT_DIR/ca-cert.pem"

    # Check if certificates already exist
    if [[ -f "$CA_CERT_FILE" && -f "$APP_CERT_FILE" ]]; then
        log_info "Certificates already exist in $OUTPUT_DIR"
        read -r -p "Use existing certificates? [Y/n] " response
        response=${response:-Y}
        if [[ "$response" =~ ^[Yy]$ ]]; then
            log_info "Using existing certificates"
        else
            log_info "Generating new certificates..."
            "$SCRIPT_DIR/generate-certificates.sh" --config "$CONFIG_FILE" --output-dir "$OUTPUT_DIR" --force
        fi
    else
        log_info "Generating certificates..."
        "$SCRIPT_DIR/generate-certificates.sh" --config "$CONFIG_FILE" --output-dir "$OUTPUT_DIR"
    fi
fi

# Read CA certificate content
CA_CERT_CONTENT=$(cat "$CA_CERT_FILE")
log_debug "CA certificate loaded ($(wc -c < "$CA_CERT_FILE") bytes)"

# =============================================================================
# Store CA Certificate in SSM Parameter Store
# =============================================================================

log_info "Storing CA certificate in SSM Parameter Store..."
log_debug "SSM Parameter name: $CA_CERT_SSM_PARAM"

# Check if parameter already exists
EXISTING_PARAM=$(aws ssm get-parameter \
    --name "$CA_CERT_SSM_PARAM" \
    --region "$AWS_REGION" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || echo "")

if [[ -n "$EXISTING_PARAM" ]]; then
    # Compare with current certificate
    if [[ "$EXISTING_PARAM" == "$CA_CERT_CONTENT" ]]; then
        log_info "SSM Parameter already contains the same certificate"
    else
        log_warn "SSM Parameter exists with different certificate"
        read -r -p "Overwrite existing certificate? [Y/n] " response
        response=${response:-Y}
        if [[ "$response" =~ ^[Yy]$ ]]; then
            aws ssm put-parameter \
                --name "$CA_CERT_SSM_PARAM" \
                --type "String" \
                --value "$CA_CERT_CONTENT" \
                --overwrite \
                --region "$AWS_REGION" \
                --description "Opaflix CA certificate for IAM Roles Anywhere Trust Anchor" \
                --tags "Key=Application,Value=Opaflix" "Key=ManagedBy,Value=deploy-script" \
                > /dev/null
            log_success "SSM Parameter updated"
        else
            log_info "Using existing certificate from SSM Parameter Store"
        fi
    fi
else
    # Create new parameter
    aws ssm put-parameter \
        --name "$CA_CERT_SSM_PARAM" \
        --type "String" \
        --value "$CA_CERT_CONTENT" \
        --region "$AWS_REGION" \
        --description "Opaflix CA certificate for IAM Roles Anywhere Trust Anchor" \
        --tags "Key=Application,Value=Opaflix" "Key=ManagedBy,Value=deploy-script" \
        > /dev/null
    log_success "CA certificate stored in SSM Parameter Store: $CA_CERT_SSM_PARAM"
fi

# =============================================================================
# Validate CloudFormation Template
# =============================================================================

log_info "Validating CloudFormation template..."

if ! aws cloudformation validate-template \
    --template-body "file://$TEMPLATE_FILE" \
    --region "$AWS_REGION" > /dev/null 2>&1; then
    log_error "CloudFormation template validation failed!"
    aws cloudformation validate-template \
        --template-body "file://$TEMPLATE_FILE" \
        --region "$AWS_REGION"
    exit 1
fi

log_success "Template validation passed"

# =============================================================================
# Check for Existing Stack
# =============================================================================

STACK_EXISTS=false
STACK_STATUS=""

if aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" > /dev/null 2>&1; then
    STACK_EXISTS=true
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)
    log_warn "Stack '$STACK_NAME' already exists (status: $STACK_STATUS)"

    if [[ "$STACK_STATUS" == *"IN_PROGRESS"* ]]; then
        log_error "Stack operation already in progress. Please wait for it to complete."
        exit 1
    fi

    if [[ "$STACK_STATUS" == *"FAILED"* || "$STACK_STATUS" == "ROLLBACK_COMPLETE" ]]; then
        log_warn "Stack is in failed state. It must be deleted before redeploying."
        read -r -p "Delete the failed stack and redeploy? [y/N] " response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            log_info "Deleting failed stack..."
            aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$AWS_REGION"
            aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
            STACK_EXISTS=false
            log_success "Failed stack deleted"
        else
            exit 1
        fi
    fi
fi

# =============================================================================
# Deploy Stack
# =============================================================================

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "Dry run mode - stack will not be deployed"
    echo ""
    echo "Configuration Summary:"
    echo "  Region:          $AWS_REGION"
    echo "  Stack Name:      $STACK_NAME"
    echo "  Bucket Prefix:   $BUCKET_PREFIX"
    echo "  CORS Origin:     $CORS_ALLOWED_ORIGIN"
    echo "  Gateway ID:      ${GATEWAY_INSTANCE_ID:-<not specified>}"
    echo "  Gateway Name:    ${GATEWAY_INSTANCE_NAME:-<not specified>}"
    echo "  CA Certificate:  $CA_CERT_FILE"
    echo "  SSM Parameter:   $CA_CERT_SSM_PARAM"
    echo ""

    # Show what would be created
    log_info "Creating change set for preview..."
    CHANGE_SET_NAME="dry-run-$(date +%s)"

    aws cloudformation create-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGE_SET_NAME" \
        --template-body "file://$TEMPLATE_FILE" \
        --parameters \
            "ParameterKey=BucketPrefix,ParameterValue=$BUCKET_PREFIX" \
            "ParameterKey=CaCertificateParameterName,ParameterValue=$CA_CERT_SSM_PARAM" \
            "ParameterKey=GatewayInstanceId,ParameterValue=$GATEWAY_INSTANCE_ID" \
            "ParameterKey=GatewayInstanceName,ParameterValue=$GATEWAY_INSTANCE_NAME" \
            "ParameterKey=CorsAllowedOrigin,ParameterValue=$CORS_ALLOWED_ORIGIN" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --change-set-type "$(if [[ "$STACK_EXISTS" == "true" ]]; then echo "UPDATE"; else echo "CREATE"; fi)" \
        > /dev/null

    log_info "Waiting for change set..."
    sleep 5

    aws cloudformation describe-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_REGION" \
        --query 'Changes[].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}' \
        --output table

    # Clean up change set
    aws cloudformation delete-change-set \
        --stack-name "$STACK_NAME" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_REGION" 2>/dev/null || true

    log_info "Dry run complete. Run without --dry-run to deploy."
    exit 0
fi

# Deploy the stack
echo ""
echo "============================================================================="
echo "Deploying Opaflix Infrastructure"
echo "============================================================================="
echo ""
echo "  Region:          $AWS_REGION"
echo "  Stack Name:      $STACK_NAME"
echo "  Bucket Prefix:   $BUCKET_PREFIX"
echo "  CORS Origin:     $CORS_ALLOWED_ORIGIN"
echo "  Gateway ID:      ${GATEWAY_INSTANCE_ID:-<not specified>}"
echo "  Gateway Name:    ${GATEWAY_INSTANCE_NAME:-<not specified>}"
echo "  SSM Parameter:   $CA_CERT_SSM_PARAM"
echo ""

if [[ "$STACK_EXISTS" == "true" ]]; then
    log_info "Updating existing stack..."
    OPERATION="update-stack"
    WAIT_OPERATION="stack-update-complete"
else
    log_info "Creating new stack..."
    OPERATION="create-stack"
    WAIT_OPERATION="stack-create-complete"
fi

aws cloudformation $OPERATION \
    --stack-name "$STACK_NAME" \
    --template-body "file://$TEMPLATE_FILE" \
    --parameters \
        "ParameterKey=BucketPrefix,ParameterValue=$BUCKET_PREFIX" \
        "ParameterKey=CaCertificateParameterName,ParameterValue=$CA_CERT_SSM_PARAM" \
        "ParameterKey=GatewayInstanceId,ParameterValue=$GATEWAY_INSTANCE_ID" \
        "ParameterKey=GatewayInstanceName,ParameterValue=$GATEWAY_INSTANCE_NAME" \
        "ParameterKey=CorsAllowedOrigin,ParameterValue=$CORS_ALLOWED_ORIGIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$AWS_REGION" \
    --tags \
        "Key=Application,Value=Opaflix" \
        "Key=ManagedBy,Value=CloudFormation" \
    > /dev/null

log_success "Stack operation initiated"

# =============================================================================
# Wait for Completion
# =============================================================================

if [[ "$WAIT_FOR_STACK" == "true" ]]; then
    log_info "Waiting for stack operation to complete..."
    log_info "This may take several minutes..."

    # Show progress
    START_TIME=$(date +%s)
    while true; do
        STATUS=$(aws cloudformation describe-stacks \
            --stack-name "$STACK_NAME" \
            --region "$AWS_REGION" \
            --query 'Stacks[0].StackStatus' \
            --output text 2>/dev/null || echo "CHECKING")

        ELAPSED=$(($(date +%s) - START_TIME))

        case "$STATUS" in
            *"COMPLETE")
                echo ""
                break
                ;;
            *"FAILED"|"ROLLBACK"*)
                echo ""
                log_error "Stack operation failed: $STATUS"

                # Show failure reason
                aws cloudformation describe-stack-events \
                    --stack-name "$STACK_NAME" \
                    --region "$AWS_REGION" \
                    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
                    --output table 2>/dev/null || true
                exit 1
                ;;
            *)
                printf "\r  Status: %-30s (elapsed: %ds)" "$STATUS" "$ELAPSED"
                sleep 5
                ;;
        esac
    done

    log_success "Stack operation completed successfully!"
else
    log_info "Stack operation started. Use --no-wait was specified."
    log_info "Check status with: aws cloudformation describe-stacks --stack-name $STACK_NAME"
    exit 0
fi

# =============================================================================
# Get Stack Outputs
# =============================================================================

log_info "Retrieving stack outputs..."

# Get all outputs
OUTPUTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs')

# Parse outputs
BUCKET_NAME=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="BucketName") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`BucketName`].OutputValue' --output text)

APP_ROLE_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AppRoleArn") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`AppRoleArn`].OutputValue' --output text)

TRUST_ANCHOR_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="TrustAnchorArn") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`TrustAnchorArn`].OutputValue' --output text)

PROFILE_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ProfileArn") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`ProfileArn`].OutputValue' --output text)

GATEWAY_ROLE_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="GatewayRoleArn") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`GatewayRoleArn`].OutputValue' --output text)

GATEWAY_PROFILE_ARN=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="GatewayInstanceProfileArn") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`GatewayInstanceProfileArn`].OutputValue' --output text)

GATEWAY_PROFILE_NAME=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="GatewayInstanceProfileName") | .OutputValue' 2>/dev/null || \
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`GatewayInstanceProfileName`].OutputValue' --output text)

# =============================================================================
# Display CloudFormation Outputs
# =============================================================================

log_info "Retrieving CloudFormation outputs..."

echo ""
echo "============================================================================="
echo "Deployment Complete!"
echo "============================================================================="
echo ""
echo "View all outputs in CloudFormation Console or run:"
echo "  aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs'"
echo ""
echo "Certificate files generated in: $OUTPUT_DIR"
echo "  CA Certificate:  ca-cert.pem (stored in SSM: $CA_CERT_SSM_PARAM)"
echo "  App Certificate: opaflix-cert.pem"
echo "  App Private Key: opaflix-key.pem"
echo ""
echo "============================================================================="
echo "Next Steps"
echo "============================================================================="
echo ""
echo "1. Get CloudFormation outputs:"
echo "     aws cloudformation describe-stacks \\"
echo "       --stack-name $STACK_NAME \\"
echo "       --region $AWS_REGION \\"
echo "       --query 'Stacks[0].Outputs[?OutputKey==\`OpaflixConfiguration\`].OutputValue' \\"
echo "       --output text"
echo ""
echo "2. Copy the configuration to your .env file and add certificates:"
echo "     - AWS_ROLES_ANYWHERE_CERTIFICATE: Content of $OUTPUT_DIR/opaflix-cert.pem"
echo "     - AWS_ROLES_ANYWHERE_PRIVATE_KEY: Content of $OUTPUT_DIR/opaflix-key.pem"
echo ""
echo "3. Verify S3 access:"
echo "     aws s3 ls s3://<bucket-name>/ --region $AWS_REGION"
echo ""
echo "Note: The instance profile was automatically attached to the OPA Gateway EC2 instance."
echo ""
