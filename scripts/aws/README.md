# Opaflix AWS Infrastructure Automation

This directory contains scripts and CloudFormation templates to automate the AWS infrastructure setup for Opaflix.

> [!CAUTION]
> These scripts create AWS resources that may incur costs. Please review the code and understand the resources being created before running. Always deploy to a test account first.

> [!WARNING]
> These scripts are provided as-is without any warranty. They aim to simplify the resource creation in AWS, but you must read, understand and validate both the bash scripts and the CloudFormation templates. Use at your own risk. Always follow AWS best practices for security and cost management.

> [!INFO]
> This script suppose that your OPA Gateway EC2 instance is already created and running. It will automatically attach the necessary IAM instance profile to it. If you haven't set up your OPA Gateway yet, please do so before running this deployment.

## Overview

These scripts automate the creation of:

- **S3 Bucket**: Encrypted storage for session recordings with unique naming
- **IAM Roles**:
  - Read/Write role for OPA Gateway (EC2 instance profile)
  - Read-only role for Opaflix application (IAM Roles Anywhere)
- **IAM Roles Anywhere**: Certificate-based authentication for Opaflix
- **X.509 Certificates**: CA and application certificates for Roles Anywhere

## Prerequisites

1. **AWS CLI** - [Installation guide](https://aws.amazon.com/cli/)
   ```bash
   # Verify installation
   aws --version
   ```

2. **OpenSSL** - For certificate generation
   ```bash
   # macOS
   brew install openssl

   # Ubuntu/Debian
   sudo apt-get install openssl
   ```

3. **AWS Credentials** - Configured with sufficient permissions
   ```bash
   # Configure credentials
   aws configure
   ```

4. **Required IAM Permissions** for deployment:
   - `cloudformation:*`
   - `s3:*`
   - `iam:*`
   - `rolesanywhere:*`

5. **Existing OPA Gateway EC2 Instance** - The script will attach the instance profile to this instance. You can identify it by either:
   - **Instance ID** (e.g., `i-0123456789abcdef0`) - Takes priority if both are provided
   - **Instance Name** (the `Name` tag value) - Looked up automatically if ID is not provided

## Quick Start

```bash
# 1. Navigate to scripts directory
cd scripts/aws

# 2. Create configuration file
cp config.env.example config.env

# 3. Edit configuration (optional - defaults work fine if your EC2 name is `demoeng-opa-gateway`)
vim config.env

# 4. Deploy infrastructure
./deploy.sh
```

## File Structure

```
scripts/aws/
├── README.md                      # This file
├── deploy.sh                      # Main deployment script
├── teardown.sh                    # Cleanup / delete resources
├── generate-certificates.sh       # Certificate generation
├── config.env.example             # Configuration template
└── opaflix-cfn.yaml               # CloudFormation template
```

## Scripts

### deploy.sh

Main deployment script that orchestrates the entire setup.

```bash
# Basic deployment
./deploy.sh

# Preview without deploying
./deploy.sh --dry-run

# Use existing certificates
./deploy.sh --skip-certs

# Custom region and stack name
./deploy.sh --region eu-west-1 --stack-name my-opaflix

# Show all options
./deploy.sh --help
```

**Options:**

| Option | Description | Default |
| ------ | ---------- | ------ |
| `--config FILE` | Configuration file | `config.env` |
| `--region REGION` | AWS region | `us-east-1` |
| `--stack-name NAME` | CloudFormation stack name | `opaflix-infrastructure` |
| `--bucket-prefix PREFIX` | S3 bucket prefix | `opaflix-sessions` |
| `--environment ENV` | Environment tag | `production` |
| `--output-dir DIR` | Output directory | `./data` |
| `--skip-certs` | Skip certificate generation | - |
| `--dry-run` | Preview without deploying | - |
| `--no-wait` | Don't wait for completion | - |
| `--verbose` | Verbose output | - |

**Generated Files:**

After deployment, the script creates:

- `data/deploy-output.env` - Environment variables for Opaflix
- `data/deploy-output.json` - JSON configuration
- `data/ca-cert.pem` - CA certificate (Trust Anchor)
- `data/opaflix-cert.pem` - Application certificate
- `data/opaflix-key.pem` - Application private key

### generate-certificates.sh

Generate X.509 certificates for IAM Roles Anywhere.

```bash
# Generate with defaults
./generate-certificates.sh

# Use config file
./generate-certificates.sh --config config.env

# Custom certificate details
./generate-certificates.sh --cn my-app --org "My Company" --days 730

# Overwrite existing certificates
./generate-certificates.sh --force
```

**Generated Certificates:**

| File | Purpose |
| ---- | ------ |
| `ca-cert.pem` | CA certificate (used as Trust Anchor) |
| `ca-key.pem` | CA private key (keep secure!) |
| `opaflix-cert.pem` | Application certificate |
| `opaflix-key.pem` | Application private key |

## Configuration

### config.env

Copy `config.env.example` to `config.env` and customize:

```bash
# AWS Settings
AWS_REGION=us-east-1
BUCKET_PREFIX=opaflix-sessions
STACK_NAME=opaflix-infrastructure
ENVIRONMENT=production

# IAM Roles Anywhere
ROLES_ANYWHERE_SESSION_DURATION=3600

# Certificate Settings
CERT_VALIDITY_DAYS=365
CERT_CN=opaflix-app
CERT_ORGANIZATION=MyOrganization
```

### S3 Bucket Naming

The bucket name is automatically generated to be globally unique:

```
{prefix}-{random6}
```

Example: `opaflix-sessions-a1b2c3`

## CloudFormation Template

### Parameters

| Parameter | Description | Default |
| --------- | ---------- | ------ |
| `BucketPrefix` | S3 bucket name prefix | `opaflix-sessions` |
| `CaCertificatePem` | CA certificate for Trust Anchor | (required) |
| `GatewayInstanceId` | EC2 Instance ID (e.g., i-0123456789abcdef0) | (optional) |
| `GatewayInstanceName` | Name tag of the OPA Gateway EC2 instance | (optional) |

> **Note:** You must provide either `GatewayInstanceId` or `GatewayInstanceName`. If both are provided, Instance ID takes priority. If only Name is provided, the Lambda function will look up the instance by its Name tag.

### Resources Created

1. **S3 Bucket**
   - AES-256 server-side encryption
   - Public access blocked
   - Secure transport enforced

2. **IAM Role: Gateway (R/W)**
   - Trust: EC2 service
   - Permissions: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`
   - **Automatically attached** to the specified EC2 instance

3. **IAM Role: Opaflix App (R/O)**
   - Trust: `rolesanywhere.amazonaws.com`
   - Permissions: `s3:GetObject`, `s3:ListBucket`
   - Scoped to Trust Anchor

4. **IAM Roles Anywhere Trust Anchor**
   - Uses CA certificate for validation

5. **IAM Roles Anywhere Profile**
   - Links to Opaflix role
   - Session duration: 1 hour

6. **Lambda Function (Auto-attach)**
   - Automatically attaches instance profile to Gateway EC2
   - Removes association on stack deletion

### Outputs

| Output | Description |
| ------ | ---------- |
| `BucketName` | S3 bucket name |
| `BucketArn` | S3 bucket ARN |
| `BucketRegion` | S3 bucket region |
| `OpaflixRoleArn` | Opaflix app IAM role ARN |
| `TrustAnchorArn` | Roles Anywhere Trust Anchor ARN |
| `ProfileArn` | Roles Anywhere Profile ARN |
| `OpaflixEnvConfig` | Configuration settings for Opaflix |

## Usage with Opaflix

### Single-Tenant Mode

After deployment, configure Opaflix by copying values from Cloudformation output:

```bash
# .env file
AWS_S3_BUCKET=opaflix-sessions-xxx
AWS_REGION=us-east-1
AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN=arn:aws:rolesanywhere:...
AWS_ROLES_ANYWHERE_PROFILE_ARN=arn:aws:rolesanywhere:...
AWS_ROLES_ANYWHERE_ROLE_ARN=arn:aws:iam::123456789012:role/opaflix-app-...
AWS_ROLES_ANYWHERE_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
AWS_ROLES_ANYWHERE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# Note: For PEM values, use \n for newlines (e.g., "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----")
```

### Multi-Tenant Mode

Use the values from Cloudformation output in the Opaflix `/config` page:

1. Navigate to `/config?team=your-team`
2. Select "IAM Roles Anywhere" authentication method
3. Enter the ARNs from the deployment output
4. Upload the certificate and key files

### OPA Gateway Setup

The IAM instance profile is **automatically attached** to your OPA Gateway EC2 instance during stack deployment. No manual steps required!

You can identify your OPA Gateway using either:
- **Instance ID** (e.g., `i-0123456789abcdef0`) - Takes priority if both are provided
- **Instance Name** (the `Name` tag value) - Looked up automatically if ID is not provided

The Lambda function will:
1. Resolve the instance ID (directly or via Name tag lookup)
2. Automatically attach the instance profile to the EC2 instance
3. Remove the association when the stack is deleted

> **Note:** If the instance already has an instance profile attached, it will be replaced with the Opaflix profile.

> **Warning:** If multiple instances have the same Name tag, the deployment will fail. In this case, use the Instance ID instead.

---

## Additional Resources

### Project Documentation

| Document | Description |
| -------- | ----------- |
| [README.md](README.md) | Main documentation and quick start guide (this file) |
| [docs/AWS.md](docs/AWS.md) | AWS S3 setup and configuration |
| [scripts/convert-sessions/README.md](scripts/convert-sessions/README.md) | Sessions conversion scripts |
| [scripts/aws/README.md](scripts/aws/README.md) | AWS CLI utilities and CloudFormation template |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [CLAUDE.md](CLAUDE.md) | AI assistant context |

### External Resources

- [AWS CloudFormation Documentation](https://docs.aws.amazon.com/cloudformation/)
- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [AWS IAM Roles Anywhere Documentation](https://docs.aws.amazon.com/rolesanywhere/)
- [AWS S3 Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/best-practices.html)
- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

---

**Last Updated**: 2026-03-30
