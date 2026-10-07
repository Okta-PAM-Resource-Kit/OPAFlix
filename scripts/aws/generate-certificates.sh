#!/usr/bin/env bash
#
# generate-certificates.sh - Generate CA and application certificates for IAM Roles Anywhere
#
# This script creates:
#   - CA certificate (ca-cert.pem, ca-key.pem) - Used as Trust Anchor in AWS
#   - App certificate (opaflix-cert.pem, opaflix-key.pem) - Used by Opaflix for authentication
#
# Usage:
#   ./generate-certificates.sh                    # Interactive mode with defaults
#   ./generate-certificates.sh --config config.env # Load settings from file
#   ./generate-certificates.sh --cn opaflix-app --org MyOrg --days 365
#

set -euo pipefail

# =============================================================================
# Default Configuration
# =============================================================================

CERT_VALIDITY_DAYS="${CERT_VALIDITY_DAYS:-3650}"
CA_VALIDITY_DAYS="${CA_VALIDITY_DAYS:-3650}"
CERT_CN="${CERT_CN:-opaflix-app}"
CERT_ORGANIZATION="${CERT_ORGANIZATION:-Opaflix}"
CERT_OU="${CERT_OU:-Engineering}"
CERT_COUNTRY="${CERT_COUNTRY:-US}"
CERT_STATE="${CERT_STATE:-California}"
CERT_LOCALITY="${CERT_LOCALITY:-San Francisco}"
KEY_SIZE="${KEY_SIZE:-4096}"
OUTPUT_DIR="${OUTPUT_DIR:-./}"
UPLOAD_TO_SSM="${UPLOAD_TO_SSM:-false}"
SSM_PARAM_NAME="${SSM_PARAM_NAME:-/opaflix/ca-certificate}"
AWS_REGION="${AWS_REGION:-us-east-1}"

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

show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Generate CA and application certificates for IAM Roles Anywhere.

Options:
  --config FILE         Load configuration from file
  --output-dir DIR      Output directory (default: ./data)
  --cn NAME             Certificate Common Name (default: opaflix-app)
  --org NAME            Organization name (default: Opaflix)
  --ou NAME             Organizational Unit (default: Engineering)
  --country CODE        Country code (default: US)
  --state NAME          State/Province (default: California)
  --locality NAME       City/Locality (default: San Francisco)
  --days N              App certificate validity in days (default: 365)
  --ca-days N           CA certificate validity in days (default: 3650)
  --key-size N          RSA key size in bits (default: 4096)
  --upload-ssm          Upload CA certificate to SSM Parameter Store
  --ssm-param NAME      SSM Parameter name (default: /opaflix/ca-certificate)
  --region REGION       AWS region for SSM (default: us-east-1)
  --force               Overwrite existing certificates
  -h, --help            Show this help message

Examples:
  $(basename "$0")
  $(basename "$0") --config config.env
  $(basename "$0") --cn my-app --org "My Company" --days 730
  $(basename "$0") --upload-ssm --region eu-west-1
EOF
}

# =============================================================================
# Parse Arguments
# =============================================================================

FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --cn)
            CERT_CN="$2"
            shift 2
            ;;
        --org)
            CERT_ORGANIZATION="$2"
            shift 2
            ;;
        --ou)
            CERT_OU="$2"
            shift 2
            ;;
        --country)
            CERT_COUNTRY="$2"
            shift 2
            ;;
        --state)
            CERT_STATE="$2"
            shift 2
            ;;
        --locality)
            CERT_LOCALITY="$2"
            shift 2
            ;;
        --days)
            CERT_VALIDITY_DAYS="$2"
            shift 2
            ;;
        --ca-days)
            CA_VALIDITY_DAYS="$2"
            shift 2
            ;;
        --key-size)
            KEY_SIZE="$2"
            shift 2
            ;;
        --upload-ssm)
            UPLOAD_TO_SSM=true
            shift
            ;;
        --ssm-param)
            SSM_PARAM_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --force)
            FORCE=true
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

# Load config file if specified
if [[ -n "${CONFIG_FILE:-}" ]]; then
    if [[ -f "$CONFIG_FILE" ]]; then
        log_info "Loading configuration from $CONFIG_FILE"
        # shellcheck source=/dev/null
        source "$CONFIG_FILE"
    else
        log_error "Config file not found: $CONFIG_FILE"
        exit 1
    fi
fi

# =============================================================================
# Validation
# =============================================================================

# Check for OpenSSL
if ! command -v openssl &> /dev/null; then
    log_error "OpenSSL is required but not installed."
    log_error "Install it with: brew install openssl (macOS) or apt-get install openssl (Linux)"
    exit 1
fi

# Validate key size
if [[ ! "$KEY_SIZE" =~ ^(2048|4096)$ ]]; then
    log_error "Key size must be 2048 or 4096"
    exit 1
fi

# Validate validity days
if [[ "$CERT_VALIDITY_DAYS" -lt 1 || "$CERT_VALIDITY_DAYS" -gt 3650 ]]; then
    log_error "Certificate validity must be between 1 and 3650 days"
    exit 1
fi

# =============================================================================
# Create Output Directory
# =============================================================================

mkdir -p "$OUTPUT_DIR"

# Check for existing certificates
CA_KEY="$OUTPUT_DIR/ca-key.pem"
CA_CERT="$OUTPUT_DIR/ca-cert.pem"
APP_KEY="$OUTPUT_DIR/opaflix-key.pem"
APP_CERT="$OUTPUT_DIR/opaflix-cert.pem"

if [[ -f "$CA_CERT" || -f "$APP_CERT" ]] && [[ "$FORCE" != "true" ]]; then
    log_warn "Certificates already exist in $OUTPUT_DIR"
    log_warn "Use --force to overwrite existing certificates"

    # Show existing certificate info
    if [[ -f "$CA_CERT" ]]; then
        echo ""
        log_info "Existing CA certificate:"
        openssl x509 -in "$CA_CERT" -noout -subject -dates 2>/dev/null || true
    fi
    if [[ -f "$APP_CERT" ]]; then
        echo ""
        log_info "Existing app certificate:"
        openssl x509 -in "$APP_CERT" -noout -subject -dates 2>/dev/null || true
    fi
    exit 0
fi

# =============================================================================
# Generate CA Certificate
# =============================================================================

log_info "Generating CA certificate..."

# Generate CA private key
openssl genrsa -out "$CA_KEY" "$KEY_SIZE" 2>/dev/null

# Create CA certificate with required X.509 v3 extensions for AWS IAM Roles Anywhere
# Uses -addext flags (requires OpenSSL 1.1.1+)
openssl req -x509 -new -nodes \
    -key "$CA_KEY" \
    -sha256 \
    -days "$CA_VALIDITY_DAYS" \
    -out "$CA_CERT" \
    -subj "/C=$CERT_COUNTRY/ST=$CERT_STATE/L=$CERT_LOCALITY/O=$CERT_ORGANIZATION/OU=$CERT_OU/CN=Opaflix-CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"

log_success "CA certificate generated: $CA_CERT"

# Verify CA certificate has required extensions
log_info "Verifying CA certificate extensions..."
if openssl x509 -in "$CA_CERT" -noout -text 2>/dev/null | grep -q "CA:TRUE"; then
    log_success "CA certificate has basicConstraints CA:TRUE"
else
    log_error "CA certificate missing basicConstraints CA:TRUE extension!"
    exit 1
fi

# =============================================================================
# Generate Application Certificate
# =============================================================================

log_info "Generating application certificate..."

# Generate app private key
openssl genrsa -out "$APP_KEY" "$KEY_SIZE" 2>/dev/null

# Create certificate signing request (CSR)
CSR_FILE="$OUTPUT_DIR/opaflix.csr"
openssl req -new \
    -key "$APP_KEY" \
    -out "$CSR_FILE" \
    -subj "/C=$CERT_COUNTRY/ST=$CERT_STATE/L=$CERT_LOCALITY/O=$CERT_ORGANIZATION/OU=$CERT_OU/CN=$CERT_CN"

# Sign the CSR with CA certificate
openssl x509 -req \
    -in "$CSR_FILE" \
    -CA "$CA_CERT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -out "$APP_CERT" \
    -days "$CERT_VALIDITY_DAYS" \
    -sha256 \
    2>/dev/null

# Clean up CSR
rm -f "$CSR_FILE" "$OUTPUT_DIR/ca-cert.srl"

log_success "Application certificate generated: $APP_CERT"

# =============================================================================
# Validate Certificates
# =============================================================================

log_info "Validating certificates..."

# Verify certificate chain
if openssl verify -CAfile "$CA_CERT" "$APP_CERT" > /dev/null 2>&1; then
    log_success "Certificate chain verified successfully"
else
    log_error "Certificate chain verification failed!"
    exit 1
fi

# Verify key matches certificate
APP_CERT_MODULUS=$(openssl x509 -in "$APP_CERT" -noout -modulus 2>/dev/null)
APP_KEY_MODULUS=$(openssl rsa -in "$APP_KEY" -noout -modulus 2>/dev/null)

if [[ "$APP_CERT_MODULUS" == "$APP_KEY_MODULUS" ]]; then
    log_success "Private key matches certificate"
else
    log_error "Private key does not match certificate!"
    exit 1
fi

# =============================================================================
# Upload to SSM Parameter Store (Optional)
# =============================================================================

if [[ "$UPLOAD_TO_SSM" == "true" ]]; then
    log_info "Uploading CA certificate to SSM Parameter Store..."

    # Check for AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is required for SSM upload but not installed."
        log_error "Install it from: https://aws.amazon.com/cli/"
        log_warn "Skipping SSM upload. You can manually upload later with:"
        log_warn "  aws ssm put-parameter --name '$SSM_PARAM_NAME' --type String --value \"\$(cat $CA_CERT)\" --region $AWS_REGION"
    else
        # Check AWS credentials
        if ! aws sts get-caller-identity --region "$AWS_REGION" > /dev/null 2>&1; then
            log_error "AWS credentials not configured or invalid."
            log_warn "Skipping SSM upload. Configure credentials and run manually."
        else
            CA_CERT_CONTENT=$(cat "$CA_CERT")

            # Check if parameter already exists
            EXISTING_PARAM=$(aws ssm get-parameter \
                --name "$SSM_PARAM_NAME" \
                --region "$AWS_REGION" \
                --query 'Parameter.Value' \
                --output text 2>/dev/null || echo "")

            if [[ -n "$EXISTING_PARAM" && "$FORCE" != "true" ]]; then
                log_warn "SSM Parameter '$SSM_PARAM_NAME' already exists."
                log_warn "Use --force to overwrite."
            else
                OVERWRITE_FLAG=""
                if [[ -n "$EXISTING_PARAM" ]]; then
                    OVERWRITE_FLAG="--overwrite"
                fi

                aws ssm put-parameter \
                    --name "$SSM_PARAM_NAME" \
                    --type "String" \
                    --value "$CA_CERT_CONTENT" \
                    $OVERWRITE_FLAG \
                    --region "$AWS_REGION" \
                    --description "Opaflix CA certificate for IAM Roles Anywhere Trust Anchor" \
                    --tags "Key=Application,Value=Opaflix" "Key=ManagedBy,Value=generate-certificates" \
                    > /dev/null

                log_success "CA certificate uploaded to SSM: $SSM_PARAM_NAME"
            fi
        fi
    fi
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "============================================================================="
echo "Certificate Generation Complete"
echo "============================================================================="
echo ""
echo "Files created in $OUTPUT_DIR:"
echo "  CA Certificate:       $CA_CERT"
echo "  CA Private Key:       $CA_KEY"
echo "  App Certificate:      $APP_CERT"
echo "  App Private Key:      $APP_KEY"
echo ""
echo "CA Certificate Details:"
openssl x509 -in "$CA_CERT" -noout -subject -dates | sed 's/^/  /'
echo ""
echo "App Certificate Details:"
openssl x509 -in "$APP_CERT" -noout -subject -dates | sed 's/^/  /'
echo ""
echo "Next Steps:"
echo "  1. Store CA certificate in SSM Parameter Store (if not already done):"
echo "     aws ssm put-parameter --name '$SSM_PARAM_NAME' --type String \\"
echo "       --value \"\$(cat $CA_CERT)\" --region $AWS_REGION"
echo ""
echo "  2. Deploy AWS infrastructure using one of:"
echo "     - ./deploy.sh (recommended) - automatically stores cert in SSM"
echo "     - AWS Console: provide SSM parameter name in CaCertificateParameterName"
echo ""
echo "  3. Use the app certificate and key in Opaflix configuration"
echo ""
if [[ "$UPLOAD_TO_SSM" == "true" ]]; then
    echo "SSM Parameter: $SSM_PARAM_NAME (region: $AWS_REGION)"
    echo ""
fi
log_warn "Keep the private keys secure! Do not commit them to version control."
