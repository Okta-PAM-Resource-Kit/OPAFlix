# AWS Setup Guide for Opaflix

This guide covers configuring AWS credentials and S3 bucket access for Opaflix.

## Table of Contents

1. [Authentication Overview](#authentication-overview)
2. [Creating an S3 Bucket](#creating-an-s3-bucket)
3. [S3 CORS Configuration](#s3-cors-configuration)
4. [Configuring S3 Access for Opaflix](#configuring-s3-access-for-opaflix)
   - [Method 1: Static Access Keys](#method-1-static-access-keys-simple)
   - [Method 2: IAM Roles Anywhere](#method-2-iam-roles-anywhere-recommended-for-external-deployments)
5. [Mounting S3 as Local Folder](#mounting-s3-as-local-folder)
6. [Automated Deployment with CloudFormation](#automated-deployment-with-cloudformation)
7. [Verification and Testing](#verification-and-testing)
8. [Troubleshooting](#troubleshooting)
9. [Additional Resources](#additional-resources)

---

## Authentication Overview

Opaflix supports two AWS authentication methods. Choose based on your deployment environment:

| Method | Static Keys Required | Best For |
| ------ | ------------------ | ------- |
| [**Method 1: Static Access Keys**](#method-1-static-access-keys-simple) | Yes | Simple setups, development |
| [**Method 2: IAM Roles Anywhere**](#method-2-iam-roles-anywhere-recommended-for-external-deployments) | No | External deployments (Vercel, on-prem) |

> [!TIP]
> **For Vercel/external deployments**: Use Method 2 (IAM Roles Anywhere). It eliminates the need for any static AWS credentials.

---

## Creating an S3 Bucket

### Method A: Using AWS Console (Web Interface)

1. **Sign in to AWS Console**
   - Navigate to [https://console.aws.amazon.com/](https://console.aws.amazon.com/)
   - Sign in with your credentials

2. **Open S3 Service**
   - In the search bar, type "S3" and click on "S3" from the results
   - Or navigate to [https://s3.console.aws.amazon.com/](https://s3.console.aws.amazon.com/)

3. **Create Bucket**
   - Click the **"Create bucket"** button
   - Enter bucket details:
     - **Bucket name**: i.e. `opaflix-media-{your-org-name}` (must be globally unique)
     - **AWS Region**: Choose closest to your users (e.g., `us-east-1`)

4. **Configure Bucket Settings**
   - **Object Ownership**: ACLs disabled (recommended)
   - **Block Public Access**: Enable all (recommended for security)
   - **Bucket Versioning**: Enable (recommended for data protection)
   - **Encryption**: Enable server-side encryption with Amazon S3 managed keys (SSE-S3)

5. **Review and Create**
   - Review all settings
   - Click **"Create bucket"**

### Method B: Using AWS CLI

1. **Create S3 Bucket**
   ```bash
   # Basic bucket creation
   aws s3 mb s3://opaflix-media-{your-org-name} --region us-east-1

   # With specific configuration
   aws s3api create-bucket \
     --bucket opaflix-media-{your-org-name} \
     --region us-east-1 \
     --create-bucket-configuration LocationConstraint=us-east-1
   ```
2. **Enable Encryption**
   ```bash
   aws s3api put-bucket-encryption \
     --bucket opaflix-media-{your-org-name} \
     --server-side-encryption-configuration '{
       "Rules": [{
         "ApplyServerSideEncryptionByDefault": {
           "SSEAlgorithm": "AES256"
         }
       }]
     }'
   ```

3. **Verify Bucket Creation**
   ```bash
   aws s3 ls
   ```

---

## S3 CORS Configuration

> [!IMPORTANT]
> CORS (Cross-Origin Resource Sharing) configuration is **required** for Opaflix to play session recordings. Without it, browsers will block requests to S3 and playback will fail.

When Opaflix plays session recordings, the browser fetches files directly from S3 using presigned URLs. By default, S3 blocks these cross-origin requests for security. You must configure CORS on your S3 bucket to allow requests from your Opaflix domain.

### Why CORS is Needed

When you access Opaflix at `https://your-opaflix-domain.com`, the browser fetches `.cast` (SSH) and `.mkv` (RDP) files directly from S3 (e.g., `https://your-bucket.s3.us-east-1.amazonaws.com`). Since these are different origins, the browser's same-origin policy blocks the requests unless S3 explicitly allows them via CORS headers.

**Symptoms of missing CORS configuration:**
- SSH sessions show "Failed to load session" or blank player
- RDP videos fail to play with network errors
- Browser console shows: `Access to fetch at 'https://...s3.amazonaws.com/...' has been blocked by CORS policy`

### CORS Configuration

Use the following CORS configuration for your S3 bucket. Replace `https://your-opaflix-domain.com` with your actual Opaflix URL:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": ["https://your-opaflix-domain.com"],
        "ExposeHeaders": [],
        "MaxAgeSeconds": 3600
    }
]
```

**Configuration options:**

| Field | Value | Description |
| ----- | ---- | ---------- |
| `AllowedHeaders` | `["*"]` | Allow all headers (required for presigned URLs) |
| `AllowedMethods` | `["GET", "HEAD"]` | Only read operations needed |
| `AllowedOrigins` | Your Opaflix URL | The domain where Opaflix is hosted |
| `ExposeHeaders` | `[]` | No custom headers needed |
| `MaxAgeSeconds` | `3600` | Cache preflight for 1 hour |

**Multiple origins:** If you have multiple environments (e.g., production and staging), add all origins:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": [
            "https://opaflix.example.com",
            "https://opaflix-staging.example.com",
            "http://localhost:3000"
        ],
        "ExposeHeaders": [],
        "MaxAgeSeconds": 3600
    }
]
```

### Method A: Using AWS Console (Web Interface)

1. **Open S3 Console**
   - Navigate to [https://s3.console.aws.amazon.com/](https://s3.console.aws.amazon.com/)
   - Click on your bucket name

2. **Go to Permissions Tab**
   - Click the **"Permissions"** tab
   - Scroll down to **"Cross-origin resource sharing (CORS)"**
   - Click **"Edit"**

3. **Add CORS Configuration**
   - Paste the JSON configuration from above
   - Replace `https://your-opaflix-domain.com` with your actual domain
   - Click **"Save changes"**

### Method B: Using AWS CLI

1. **Create CORS Configuration File**
   ```bash
   cat > cors-config.json << 'EOF'
   [
       {
           "AllowedHeaders": ["*"],
           "AllowedMethods": ["GET", "HEAD"],
           "AllowedOrigins": ["https://your-opaflix-domain.com"],
           "ExposeHeaders": [],
           "MaxAgeSeconds": 3600
       }
   ]
   EOF
   ```

2. **Apply CORS Configuration**
   ```bash
   aws s3api put-bucket-cors \
       --bucket your-bucket-name \
       --cors-configuration file://cors-config.json
   ```

3. **Verify CORS Configuration**
   ```bash
   aws s3api get-bucket-cors --bucket your-bucket-name
   ```

### Testing CORS Configuration

After configuring CORS, verify it works:

1. **Using curl:**
   ```bash
   curl -I -X OPTIONS \
       -H "Origin: https://your-opaflix-domain.com" \
       -H "Access-Control-Request-Method: GET" \
       "https://your-bucket.s3.your-region.amazonaws.com/test-file.cast"
   ```

   You should see `Access-Control-Allow-Origin` in the response headers.

2. **In Opaflix:**
   - Open a session playback page
   - Check browser DevTools (F12) → Network tab
   - The S3 request should complete successfully (200 status)

---

## Configuring S3 Access for Opaflix

Opaflix needs credentials to access your S3 bucket and read session recordings. Choose one of the following methods:

| Method | Complexity | Best For | Static Keys Required |
| ------ | --------- | ------- | ------------------ |
| **[Method 1: Static Access Keys](#method-1-static-access-keys-simple)** | Simple | Development, simple deployments | Yes |
| **[Method 2: IAM Roles Anywhere](#method-2-iam-roles-anywhere-recommended-for-external-deployments)** | Advanced | Vercel, on-prem, production | No |

> [!TIP]
> **Not sure which to choose?**
> - For **quick setup or development**, use **Method 1** (Static Access Keys)
> - For **production deployments outside AWS** (Vercel, Heroku, on-prem), use **Method 2** (IAM Roles Anywhere) - it's more secure as it doesn't require long-lived credentials

---

## Method 1: Static Access Keys (Simple)

This method uses long-lived IAM access keys to authenticate with AWS. It's the simplest approach but requires storing credentials securely.

> [!TIP]
> For security, create dedicated IAM users with least privilege access rather than using root account credentials.

### Overview

You'll create an IAM user with S3 read permissions and generate access keys for Opaflix.

**Recommended approach**: Create two separate IAM users:
- **`opaflix-reader`** - Read-only access for the Opaflix web application
- **`opaflix-s3fs`** - Read-write access for s3fs mount on gateway servers (if needed)

### IAM Policy Options

Choose the appropriate policy based on your use case:

#### Option A: Read-Only Policy (Opaflix Web Application)

Use this policy for the Opaflix web application. It provides the minimum permissions needed to list and download session recordings.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::opaflix-media-{your-org-name}",
        "arn:aws:s3:::opaflix-media-{your-org-name}/*"
      ]
    }
  ]
}
```

#### Option B: Read-Write Policy (s3fs Mount on Gateway)

Use this policy for mounting S3 on your gateway server via s3fs. The conversion script needs write access to upload converted session files.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::opaflix-media-{your-org-name}",
        "arn:aws:s3:::opaflix-media-{your-org-name}/*"
      ]
    }
  ]
}
```

> [!NOTE]
> If you prefer a simpler setup, you can use a single user with the read-write policy for both purposes. However, following the principle of least privilege with separate users is recommended for production environments.

### Method A: Using AWS Console (Web Interface)

1. **Navigate to IAM**
   - Go to [https://console.aws.amazon.com/iam/](https://console.aws.amazon.com/iam/)
   - Click **"Users"** in the left sidebar

2. **Create New User**
   - Click **"Create user"**
   - Enter username: `opaflix-reader` (for Opaflix) or `opaflix-s3fs` (for gateway mount)
   - Click **"Next"**

3. **Set Permissions**
   - Select **"Attach policies directly"**
   - Click **"Create policy"** to create a custom policy
   - Choose **JSON** tab and paste the appropriate policy from above (Option A or Option B)
   - Name the policy (e.g., `OpaflixS3ReadOnly` or `OpaflixS3ReadWrite`)
   - Click **"Create policy"**
   - Return to user creation and attach the newly created policy
   - Click **"Next"** → **"Create user"**

4. **Create Access Key**
   - Click on the newly created user
   - Go to **"Security credentials"** tab
   - Scroll to **"Access keys"** section
   - Click **"Create access key"**
   - Choose use case: **"Application running outside AWS"**
   - Click **"Next"**
   - (Optional) Add description tag
   - Click **"Create access key"**

5. **Save Credentials**
   - **IMPORTANT**: Copy both credentials immediately
     - `Access key ID`: Shows as `AKIAXXXXXXXXXXXXXXXX`
     - `Secret access key`: Shows as `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - Click **"Download .csv file"** (recommended)
   - Store securely - you cannot retrieve the secret key again!

### Method B: Using AWS CLI

1. **Create IAM User**
   ```bash
   # For Opaflix web application (read-only)
   aws iam create-user --user-name opaflix-reader

   # For s3fs mount on gateway (read-write)
   aws iam create-user --user-name opaflix-s3fs
   ```

2. **Create Custom Policies**

   **Read-Only Policy (for Opaflix web app):**
   ```bash
   # Create policy file
   cat > opaflix-readonly-policy.json << 'EOF'
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::opaflix-media-{your-org-name}",
           "arn:aws:s3:::opaflix-media-{your-org-name}/*"
         ]
       }
     ]
   }
   EOF

   # Create and attach policy
   aws iam create-policy \
     --policy-name OpaflixS3ReadOnly \
     --policy-document file://opaflix-readonly-policy.json

   # Attach policy to user (replace ACCOUNT_ID with your AWS account ID)
   aws iam attach-user-policy \
     --user-name opaflix-reader \
     --policy-arn arn:aws:iam::ACCOUNT_ID:policy/OpaflixS3ReadOnly
   ```

   **Read-Write Policy (for s3fs mount):**
   ```bash
   # Create policy file
   cat > opaflix-readwrite-policy.json << 'EOF'
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::opaflix-media-{your-org-name}",
           "arn:aws:s3:::opaflix-media-{your-org-name}/*"
         ]
       }
     ]
   }
   EOF

   # Create and attach policy
   aws iam create-policy \
     --policy-name OpaflixS3ReadWrite \
     --policy-document file://opaflix-readwrite-policy.json

   # Attach policy to user (replace ACCOUNT_ID with your AWS account ID)
   aws iam attach-user-policy \
     --user-name opaflix-s3fs \
     --policy-arn arn:aws:iam::ACCOUNT_ID:policy/OpaflixS3ReadWrite
   ```

3. **Create Access Keys**
   ```bash
   # For Opaflix web app
   aws iam create-access-key --user-name opaflix-reader

   # For s3fs mount
   aws iam create-access-key --user-name opaflix-s3fs
   ```

4. **Save Output**
   - The command will output:
   ```json
   {
     "AccessKey": {
       "UserName": "opaflix-reader",
       "AccessKeyId": "AKIAXXXXXXXXXXXXXXXX",
       "Status": "Active",
       "SecretAccessKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
       "CreateDate": "2026-03-16T..."
     }
   }
   ```
   - Copy `AccessKeyId` and `SecretAccessKey` for use in Opaflix configuration

5. **Verify User and Permissions**
   ```bash
   # List users
   aws iam list-users

   # List policies attached to user
   aws iam list-attached-user-policies --user-name opaflix-reader
   aws iam list-attached-user-policies --user-name opaflix-s3fs

   # List access keys
   aws iam list-access-keys --user-name opaflix-reader
   aws iam list-access-keys --user-name opaflix-s3fs
   ```

### Configure Opaflix

Add the credentials to your Opaflix configuration:

**Single-Tenant Mode (`.env` file):**

```bash
# AWS Credentials
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1
AWS_S3_BUCKET=opaflix-media-{your-org-name}
```

**Multi-Tenant Mode:**

Configure via the `/config` page in the AWS Configuration section:
1. Navigate to `/config?team=your-team-name`
2. Enter the **Access Key ID** and **Secret Access Key**
3. Enter the **Region** and **S3 Bucket** name
4. Click **Save Changes**

> [!NOTE]
> After configuring, test by navigating to the Sessions page. If configured correctly, you should see your session recordings listed.

---

## Method 2: IAM Roles Anywhere (Recommended for External Deployments)

This method uses X.509 certificates to authenticate with AWS - **no static access keys needed**. It's more complex to set up but provides better security for production deployments.

### Overview

IAM Roles Anywhere allows applications running **outside of AWS** to obtain temporary credentials using certificates. This is ideal for:

- Deployments on Vercel, Heroku, or other platforms
- On-premises servers
- Other cloud providers (Azure, GCP)

**You'll configure:**
1. A **Trust Anchor** - Tells AWS to trust your Certificate Authority
2. An **IAM Role** - Defines what permissions the certificate holder gets
3. A **Profile** - Links the trust anchor to the role
4. An **X.509 Certificate** - Used by Opaflix to authenticate

### Architecture Overview

```
┌─────────────────┐     X.509 Signed Request    ┌─────────────────┐
│   Opaflix       │ ─────────────────────────▶  │  AWS Roles      │
│   (on Vercel)   │                             │  Anywhere       │
│                 │                             │                 │
│  Has X.509 cert │  ◀─────────────────────     │  Validates cert │
│  from your CA   │   Temp AWS Credentials      │  via Trust      │
└─────────────────┘   (1 hour lifetime)         │  Anchor         │
                                                └─────────────────┘
```

### Prerequisites

1. **A Certificate Authority (CA)** - Either:
   - AWS Private CA (if you already have one)
   - Your organization's internal CA
   - A self-signed CA (recommended, see Step 1)

2. **X.509 Certificate** - Issued by your CA for Opaflix

3. **AWS IAM Role** - With S3 permissions (see [Creating AWS Access Keys](#creating-aws-access-keys))

### Step 1: Create a Trust Anchor

The Trust Anchor tells AWS to trust certificates from your CA.

> [!IMPORTANT]
> **AWS Private CA costs ~$400/month** per CA. Only use AWS Private CA if your organization already has one. For most Opaflix deployments, using an **External certificate bundle** (self-signed CA) is the recommended and cost-effective approach.

#### Option A: External Certificate Bundle (Recommended)

Generate a self-signed CA certificate chain using OpenSSL. This is free and works perfectly for IAM Roles Anywhere.

> [!IMPORTANT]
> The CA certificate **must** include `basicConstraints = CA:TRUE` or AWS will reject it with "Incorrect basic constraints for CA certificate".

```bash
# Create a directory for your certificates
mkdir -p ~/.opaflix-certs && cd ~/.opaflix-certs

# 1. Generate Root CA private key (4096-bit RSA)
openssl genrsa -out ca-key.pem 4096

# 2. Create CA config file with required extensions
cat > ca.cnf << 'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Your Organization
OU = IT
CN = Opaflix Root CA

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF

# 3. Create Root CA certificate with proper extensions (valid for 10 years)
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca-cert.pem -config ca.cnf

# 4. Verify the CA certificate has correct extensions
openssl x509 -in ca-cert.pem -text -noout | grep -A1 "Basic Constraints"
# Expected output: CA:TRUE

# 5. Generate Opaflix application private key (2048-bit RSA)
openssl genrsa -out opaflix-key.pem 2048

# 6. Create Certificate Signing Request (CSR)
openssl req -new -key opaflix-key.pem -out opaflix.csr \
  -subj "/C=US/ST=California/L=San Francisco/O=Your Organization/OU=IT/CN=opaflix-app"

# 7. Create signing config with client authentication extensions
#    IMPORTANT: These extensions are REQUIRED for IAM Roles Anywhere!
cat > sign-app.cnf << 'EOF'
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

# 8. Sign the certificate with your CA using the extensions config (valid for 10 years)
openssl x509 -req -days 3650 -in opaflix.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out opaflix-cert.pem \
  -extfile sign-app.cnf

# 9. Verify the certificate chain
openssl verify -CAfile ca-cert.pem opaflix-cert.pem
# Expected output: opaflix-cert.pem: OK

# 10. Verify the certificate has correct extensions
openssl x509 -in opaflix-cert.pem -text -noout | grep -A1 "Key Usage"
# Expected output:
#   X509v3 Key Usage: critical
#       Digital Signature, Key Encipherment
#   X509v3 Extended Key Usage:
#       TLS Web Client Authentication
```

> [!WARNING]
> **The certificate MUST have these extensions** or IAM Roles Anywhere will reject it with "Untrusted certificate. Insufficient certificate":
> - `keyUsage = critical, digitalSignature, keyEncipherment`
> - `extendedKeyUsage = clientAuth` (TLS Web Client Authentication)

**Files created:**
| File | Description | Keep Secret? |
| ---- | ---------- | ----------- |
| `ca-key.pem` | CA private key | **YES** - Store securely offline |
| `ca-cert.pem` | CA certificate | No - Upload to AWS Trust Anchor |
| `ca.cnf` | CA config file | No - Can be deleted after CA creation |
| `sign-app.cnf` | Signing extensions config | No - Keep for certificate renewal |
| `opaflix-key.pem` | App private key | **YES** - Configure in Opaflix |
| `opaflix-cert.pem` | App certificate | No - Configure in Opaflix |

#### Option B: AWS Private CA (Enterprise)

Only use this option if your organization already has AWS Private CA:

1. Navigate to **AWS Certificate Manager** → **Private CA**
2. Select your existing Private CA
3. Note the **CA ARN** for use in the Trust Anchor

#### Creating the Trust Anchor

##### Using AWS Console

1. Navigate to **IAM** → **Roles Anywhere** → **Manage** → **Trust anchors** (`https://{{region}}.console.aws.amazon.com/rolesanywhere`)
2. Click **Create trust anchor**
3. Choose **External certificate bundle**
4. Upload your `ca-cert.pem` file (the CA certificate, NOT the private key)
5. Name it (e.g., `OpaflixTrustAnchor`)
6. Click **Create trust anchor**
7. Copy the **Trust Anchor ARN**

##### Using AWS CLI

```bash
# For external CA certificate (recommended)
aws rolesanywhere create-trust-anchor \
  --name OpaflixTrustAnchor \
  --source "sourceType=CERTIFICATE_BUNDLE,sourceData={x509CertificateData=$(cat ca-cert.pem | base64 -w0)}" \
  --enabled

# Copy the trustAnchorArn from the output
```

> [!TIP]
> **Certificate Rotation**: The app certificate (`opaflix-cert.pem`) should be rotated annually. Keep your CA certificate (`ca-cert.pem`) and key secure - you'll need them to issue new app certificates.

### Step 2: Create an IAM Role

Create an IAM role that Roles Anywhere will assume to access S3. This role needs:
1. **S3 permissions** - To read session recordings from your bucket
2. **Trust policy** - To allow Roles Anywhere to assume it (configured in Step 4)

#### Using AWS Console

1. Navigate to **IAM** → **Roles** → **Create role**
2. Select **Custom trust policy**
3. For now, paste this temporary trust policy (we'll update it in Step 4):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Service": "rolesanywhere.amazonaws.com"
         },
         "Action": "sts:AssumeRole"
       }
     ]
   }
   ```
4. Click **Next**
5. Click **Create policy** to create the S3 permissions policy:
   - Choose **JSON** tab and paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::YOUR-BUCKET-NAME",
           "arn:aws:s3:::YOUR-BUCKET-NAME/*"
         ]
       }
     ]
   }
   ```
   - Replace `YOUR-BUCKET-NAME` with your S3 bucket name
   - Name the policy: `OpaflixS3ReadOnly`
   - Click **Create policy**
6. Return to role creation, refresh and select `OpaflixS3ReadOnly`
7. Name the role: `OpaflixS3Access`
8. Click **Create role**
9. Copy the **Role ARN** (e.g., `arn:aws:iam::123456789012:role/OpaflixS3Access`)

#### Using AWS CLI

```bash
# 1. Create the S3 permissions policy
cat > s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name OpaflixS3ReadOnly \
  --policy-document file://s3-policy.json

# 2. Create temporary trust policy (will be updated in Step 4)
cat > trust-policy-temp.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "rolesanywhere.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# 3. Create the role
aws iam create-role \
  --role-name OpaflixS3Access \
  --assume-role-policy-document file://trust-policy-temp.json

# 4. Attach the S3 policy to the role (replace ACCOUNT_ID)
aws iam attach-role-policy \
  --role-name OpaflixS3Access \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/OpaflixS3ReadOnly

# 5. Get the role ARN
aws iam get-role --role-name OpaflixS3Access --query 'Role.Arn' --output text
```

### Step 3: Create a Profile

The Profile links your Trust Anchor to the IAM role and defines session settings.

#### Using AWS Console

1. Navigate to **IAM** → **Roles Anywhere** → **Manage** → **Profiles** (`https://{{region}}.console.aws.amazon.com/rolesanywhere/`)
2. Click **Create profile**
3. Configure:
   - **Name**: `OpaflixProfile`
   - **Role ARN**: Select `OpaflixS3Access` (created in Step 2)
   - **Session duration**: 3600 seconds (1 hour)
4. Click **Create profile**
5. Copy the **Profile ARN**

#### Using AWS CLI

```bash
# Replace ACCOUNT_ID with your AWS account ID
aws rolesanywhere create-profile \
  --name OpaflixProfile \
  --role-arns "arn:aws:iam::ACCOUNT_ID:role/OpaflixS3Access" \
  --duration-seconds 3600 \
  --enabled

# Copy the profileArn from the output
```

### Step 4: Secure the IAM Role Trust Policy

Now update the temporary trust policy created in Step 2 with proper security conditions. This is critical to prevent unauthorized access.

> [!WARNING]
> **Always include `Condition` statements** in your role trust policy. Without them, any valid certificate from the CA could assume the role. The policy below restricts access by:
> 1. **Trust Anchor ARN** - Only certificates validated by your specific trust anchor
> 2. **Certificate Subject CN** - Only certificates with the exact Common Name you specify

#### Using AWS Console

1. Open the [IAM Console](https://console.aws.amazon.com/iam/)
2. Navigate to **Roles** and select your role (e.g., `OpaflixS3Access`)
3. Click the **Trust relationships** tab
4. Click **Edit trust policy**
5. Replace the existing policy with the following (update the placeholder values):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "rolesanywhere.amazonaws.com"
      },
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession",
        "sts:SetSourceIdentity"
      ],
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:rolesanywhere:REGION:ACCOUNT_ID:trust-anchor/TRUST_ANCHOR_ID"
        },
        "StringEquals": {
          "aws:PrincipalTag/x509Subject/CN": "opaflix-app"
        }
      }
    }
  ]
}
```

6. Click **Update policy**

**Replace in the policy above:**
| Placeholder | Value | Example | Where to Find |
| ----------- | ---- | ------ | ------------ |
| `REGION` | Trust Anchor region | `eu-west-3` | **MUST match** the region in your Trust Anchor ARN from Step 1 |
| `ACCOUNT_ID` | Your 12-digit AWS account ID | `123456789012` | From your Trust Anchor ARN |
| `TRUST_ANCHOR_ID` | Trust Anchor ID | `e31a37a7-e786-46a5-8966-0102d1ab2fd2` | Last part of Trust Anchor ARN from Step 1 |
| `opaflix-app` | Certificate Common Name | `opaflix-app` | Must match the `-subj "/CN=..."` used in Step 1 |

> [!IMPORTANT]
> **The region in `aws:SourceArn` MUST match your Trust Anchor's region!**
>
> If your Trust Anchor ARN is:
> `arn:aws:rolesanywhere:eu-west-3:742387644796:trust-anchor/e31a37a7-...`
>
> Then the trust policy condition MUST use:
> `"aws:SourceArn": "arn:aws:rolesanywhere:eu-west-3:742387644796:trust-anchor/e31a37a7-..."`
>
> **Not** `us-east-1` or any other region, even if your S3 bucket is in a different region.

> [!NOTE]
> The `x509Subject/CN` condition ensures only certificates with the exact Common Name `opaflix-app` (as generated in Step 1) can assume this role. If you used a different CN when generating your certificate, update the value accordingly.

#### Using AWS CLI

```bash
# Create the trust policy file (update placeholders first!)
cat > trust-policy-rolesanywhere.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "rolesanywhere.amazonaws.com"
      },
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession",
        "sts:SetSourceIdentity"
      ],
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:rolesanywhere:REGION:ACCOUNT_ID:trust-anchor/TRUST_ANCHOR_ID"
        },
        "StringEquals": {
          "aws:PrincipalTag/x509Subject/CN": "opaflix-app"
        }
      }
    }
  ]
}
EOF

# Apply the trust policy to the role
aws iam update-assume-role-policy \
  --role-name OpaflixS3Access \
  --policy-document file://trust-policy-rolesanywhere.json
```

> [!IMPORTANT]
> **Before running the command above**, make sure to replace:
> - `REGION` with the region from your Trust Anchor ARN (e.g., `eu-west-3`)
> - `ACCOUNT_ID` with your AWS account ID
> - `TRUST_ANCHOR_ID` with the ID from your Trust Anchor ARN
>
> **The region must match your Trust Anchor's region**, not your S3 bucket region!

> [!TIP]
> You can add more conditions for additional security. See the [AWS Roles Anywhere trust model documentation](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html) for all available principal tags (`x509Subject/O`, `x509Issuer/CN`, etc.).

### Step 5: Prepare Your Certificate

If you followed **Step 1 Option A** (External Certificate Bundle), you already have the required certificates:

- `opaflix-cert.pem` - The application certificate
- `opaflix-key.pem` - The application private key

#### Renewing an Expired Certificate

When your certificate expires (after 1 year), generate a new one using your existing CA:

```bash
cd ~/.opaflix-certs

# Generate new private key
openssl genrsa -out opaflix-key-new.pem 2048

# Create new CSR
openssl req -new -key opaflix-key-new.pem -out opaflix-new.csr \
  -subj "/C=US/ST=California/L=San Francisco/O=Your Organization/OU=IT/CN=opaflix-app"

# Ensure signing config exists (same as initial setup)
cat > sign-app.cnf << 'EOF'
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

# Sign with existing CA (include extensions!)
openssl x509 -req -days 3650 -in opaflix-new.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out opaflix-cert-new.pem \
  -extfile sign-app.cnf

# Verify chain and extensions
openssl verify -CAfile ca-cert.pem opaflix-cert-new.pem
openssl x509 -in opaflix-cert-new.pem -noout -ext keyUsage,extendedKeyUsage

# Replace old certificates
mv opaflix-key-new.pem opaflix-key.pem
mv opaflix-cert-new.pem opaflix-cert.pem
```

Then update the certificate and private key in your Opaflix configuration.

### Step 6: Configure Opaflix

Add the Roles Anywhere configuration to your environment:

```bash
# IAM Roles Anywhere (no static AWS keys needed!)
AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN=arn:aws:rolesanywhere:us-east-1:123456789012:trust-anchor/abc123
AWS_ROLES_ANYWHERE_PROFILE_ARN=arn:aws:rolesanywhere:us-east-1:123456789012:profile/def456
AWS_ROLES_ANYWHERE_ROLE_ARN=arn:aws:iam::123456789012:role/OpaflixS3Access

# Certificate and private key (PEM format)
# Option 1: Inline with escaped newlines
AWS_ROLES_ANYWHERE_CERTIFICATE="-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----"
AWS_ROLES_ANYWHERE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"

# S3 bucket settings (still required)
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

> [!TIP]
> **For Vercel**: Store the certificate and private key as environment variables. Use `\n` for newlines in the PEM content.

### Configuration Summary

| Variable | Required | Description |
| -------- | ------- | ---------- |
| `AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN` | Yes | Trust anchor ARN |
| `AWS_ROLES_ANYWHERE_PROFILE_ARN` | Yes | Profile ARN |
| `AWS_ROLES_ANYWHERE_ROLE_ARN` | Yes | IAM role to assume |
| `AWS_ROLES_ANYWHERE_CERTIFICATE` | Yes | X.509 certificate (PEM) |
| `AWS_ROLES_ANYWHERE_PRIVATE_KEY` | Yes | Private key (PEM) |
| `AWS_REGION` | Yes | AWS region |
| `AWS_S3_BUCKET` | Yes | S3 bucket name |

### Verify Setup

#### Quick Test Script

Use the included test script to verify your Roles Anywhere configuration:

```bash
# Run from the opaflix directory
./scripts/test-roles-anywhere.sh
```

This script verifies:
- Certificate and private key are valid and match
- Trust anchor exists and is enabled
- Profile exists, is enabled, and includes your role
- Role exists and trusts Roles Anywhere service
- All regions match correctly

#### Manual Test with AWS Signing Helper

You can also test using the official AWS credential helper:

```bash
# Install the credential helper
# Download from: https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html

# Test credential retrieval
aws_signing_helper credential-process \
  --certificate opaflix-cert.pem \
  --private-key opaflix-key.pem \
  --trust-anchor-arn arn:aws:rolesanywhere:eu-west-3:123456789012:trust-anchor/abc123 \
  --profile-arn arn:aws:rolesanywhere:eu-west-3:123456789012:profile/def456 \
  --role-arn arn:aws:iam::123456789012:role/OpaflixS3Access

# Should return JSON with AccessKeyId, SecretAccessKey, SessionToken
```

### Security Best Practices

1. **Protect the private key** - Store securely, never commit to git
2. **Use short-lived certificates** - Rotate regularly (90 days recommended)
3. **Restrict the Trust Anchor** - Only trust necessary CAs
4. **Add conditions to the role** - Restrict by source IP, certificate subject, etc.
5. **Monitor CloudTrail** - Audit Roles Anywhere sessions

---

## Mounting S3 as Local Folder

You can mount your S3 bucket directly on the OPA Gateway server so that converted session recordings are automatically stored in S3. This eliminates the need for manual file synchronization.

The conversion script (see [scripts/convert-sessions/README.md](../scripts/convert-sessions/README.md)) outputs files to `/var/log/sft/sessions-converted/`. By mounting this directory to your S3 bucket, converted files are automatically uploaded to S3.

### Overview

We use **s3fs-fuse** to mount S3 buckets as local filesystems. s3fs is available for most Linux distributions and provides a FUSE-based file system backed by Amazon S3.

### Prerequisites

- AWS credentials with S3 read/write access (created in previous sections)
- Root or sudo access on the gateway server

### Installation

#### Ubuntu / Debian

```bash
# Update package list
sudo apt update

# Install s3fs
sudo apt install -y s3fs
```

#### RHEL / CentOS / Amazon Linux

```bash
# Enable EPEL repository (if not already enabled)
sudo yum install -y epel-release

# Install s3fs-fuse
sudo yum install -y s3fs-fuse
```

For Amazon Linux 2023:
```bash
sudo dnf install -y s3fs-fuse
```

### Configure AWS Credentials

Create a credentials file for s3fs:

```bash
# Create credentials file
echo "ACCESS_KEY_ID:SECRET_ACCESS_KEY" | sudo tee /etc/passwd-s3fs > /dev/null

# Replace with your actual credentials
sudo sed -i 's/ACCESS_KEY_ID/YOUR_AWS_ACCESS_KEY_ID/' /etc/passwd-s3fs
sudo sed -i 's/SECRET_ACCESS_KEY/YOUR_AWS_SECRET_ACCESS_KEY/' /etc/passwd-s3fs

# Set secure permissions (required by s3fs)
sudo chmod 600 /etc/passwd-s3fs
```

**Example:**
```bash
echo "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" | sudo tee /etc/passwd-s3fs > /dev/null
sudo chmod 600 /etc/passwd-s3fs
```

### Create Mount Point

```bash
# Create the mount directory
sudo mkdir -p /var/log/sft/sessions-converted

# Set ownership (replace 'opaflix' with the user running the conversion script)
sudo chown opaflix:opaflix /var/log/sft/sessions-converted
```

### Manual Mount (Testing)

Test the mount before configuring automatic mounting:

```bash
# Mount the S3 bucket
sudo s3fs your-bucket-name /var/log/sft/sessions-converted \
    -o passwd_file=/etc/passwd-s3fs \
    -o url=https://s3.YOUR_REGION.amazonaws.com \
    -o use_path_request_style \
    -o allow_other \
    -o umask=0022 \
    -o uid=$(id -u opaflix) \
    -o gid=$(id -g opaflix)

# Verify the mount
df -h /var/log/sft/sessions-converted
ls -la /var/log/sft/sessions-converted
```

**Mount Options Explained:**
| Option | Description |
| ------ | ---------- |
| `passwd_file` | Path to credentials file |
| `url` | S3 endpoint URL (use your bucket's region) |
| `use_path_request_style` | Use path-style URLs (required for some regions) |
| `allow_other` | Allow other users to access the mount |
| `umask` | Set default file permissions |
| `uid/gid` | Set file ownership |

### Automatic Mount at Boot

#### Method A: Using /etc/fstab (Recommended)

Add an entry to `/etc/fstab` for automatic mounting at boot:

```bash
# Add to /etc/fstab
echo "your-bucket-name /var/log/sft/sessions-converted fuse.s3fs _netdev,allow_other,umask=0022,passwd_file=/etc/passwd-s3fs,url=https://s3.YOUR_REGION.amazonaws.com,use_path_request_style,uid=$(id -u opaflix),gid=$(id -g opaflix) 0 0" | sudo tee -a /etc/fstab
```

**Example for us-east-1 region:**
```bash
echo "opaflix-media-myorg /var/log/sft/sessions-converted fuse.s3fs _netdev,allow_other,umask=0022,passwd_file=/etc/passwd-s3fs,url=https://s3.us-east-1.amazonaws.com,use_path_request_style,uid=1001,gid=1001 0 0" | sudo tee -a /etc/fstab
```

Test the fstab entry:
```bash
# Unmount if currently mounted
sudo umount /var/log/sft/sessions-converted

# Mount using fstab
sudo mount /var/log/sft/sessions-converted

# Verify
df -h /var/log/sft/sessions-converted
```

#### Method B: Using systemd Mount Unit

Create a systemd mount unit for more control:

**Create `/etc/systemd/system/var-log-sft-sessions\x2dconverted.mount`:**

```ini
[Unit]
Description=Mount S3 bucket for OPA session recordings
After=network-online.target
Wants=network-online.target

[Mount]
What=your-bucket-name
Where=/var/log/sft/sessions-converted
Type=fuse.s3fs
Options=_netdev,allow_other,umask=0022,passwd_file=/etc/passwd-s3fs,url=https://s3.YOUR_REGION.amazonaws.com,use_path_request_style,uid=1001,gid=1001

[Install]
WantedBy=multi-user.target
```

Enable and start the mount:
```bash
sudo systemctl daemon-reload
sudo systemctl enable var-log-sft-sessions\\x2dconverted.mount
sudo systemctl start var-log-sft-sessions\\x2dconverted.mount

# Check status
sudo systemctl status var-log-sft-sessions\\x2dconverted.mount
```

### Verify Integration with Conversion Script

Once mounted, the conversion script will automatically write files to S3:

```bash
# Run conversion script
/path/to/opaflix/scripts/convert-sessions/convert-sessions.sh /var/log/sft/sessions /var/log/sft/sessions-converted

# Verify files are in S3
aws s3 ls s3://your-bucket-name/

# You should see the converted .cast and .mkv files
```

### Performance Considerations

S3 mounted via s3fs has different performance characteristics than local storage:

| Operation | Performance |
| --------- | ---------- |
| Sequential writes | Good (buffered) |
| Random writes | Poor (not recommended) |
| Large file reads | Good |
| Small file operations | Moderate latency |

**Recommendations:**
- The conversion script writes files sequentially, which works well with s3fs
- For high-volume environments, consider writing to local storage first, then syncing to S3
- Enable s3fs caching for better read performance:
  ```bash
  -o use_cache=/tmp/s3fs-cache
  ```

### Troubleshooting S3 Mount

#### "Transport endpoint is not connected"

The mount was disconnected. Remount:
```bash
sudo umount -l /var/log/sft/sessions-converted
sudo mount /var/log/sft/sessions-converted
```

#### "Permission denied"

Check credentials file permissions:
```bash
ls -la /etc/passwd-s3fs
# Should show: -rw------- (600)
```

#### Mount fails at boot

Ensure `_netdev` option is set and network is available:
```bash
# Check if network dependency is correct
sudo systemctl list-dependencies var-log-sft-sessions\\x2dconverted.mount
```

#### Slow performance

Enable caching and adjust buffer sizes:
```bash
-o use_cache=/tmp/s3fs-cache \
-o parallel_count=15 \
-o multipart_size=52 \
-o max_dirty_data=1024
```

---

## Automated Deployment with CloudFormation

For quick setup, Opaflix provides a CloudFormation template that creates all required AWS resources automatically, including:

- S3 bucket with encryption and security best practices
- IAM role for OPA Gateway (read/write access via EC2 instance profile)
- IAM role for Opaflix application (read-only access via IAM Roles Anywhere)
- Trust Anchor and Profile for IAM Roles Anywhere
- Automatic instance profile attachment to OPA Gateway EC2

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. OpenSSL for certificate generation

### Quick Start

```bash
cd scripts/aws

# Generate certificates and deploy everything
./deploy.sh --region us-east-1 --gateway-name your-opa-gateway

# Or step by step:
./generate-certificates.sh
./deploy.sh --skip-certs
```

### How It Works

The deployment script:
1. **Generates certificates** - Creates CA and application certificates for IAM Roles Anywhere
2. **Stores CA cert in SSM** - Uploads the CA certificate to AWS SSM Parameter Store as a String parameter
3. **Deploys CloudFormation** - Creates all AWS resources, referencing the CA cert from SSM
4. **Outputs configuration** - Displays CloudFormation outputs with all ARNs and settings needed for Opaflix

### SSM Parameter Store for CA Certificate

The CA certificate is stored in SSM Parameter Store instead of being passed directly to CloudFormation. This provides:

- **Easier rotation** - Update the certificate without modifying CloudFormation
- **Audit trail** - SSM Parameter Store logs access via CloudTrail
- **No size limits** - Avoids CloudFormation parameter size limitations
- **Public data** - Certificates are public information, stored as String parameters

**Default parameter path:** `/opaflix/ca-certificate`

#### Manual SSM Operations

```bash
# Store CA certificate manually
aws ssm put-parameter \
  --name "/opaflix/ca-certificate" \
  --type "String" \
  --value "$(cat ca-cert.pem)" \
  --region us-east-1 \
  --description "Opaflix CA certificate for IAM Roles Anywhere"

# View stored certificate (for verification)
aws ssm get-parameter \
  --name "/opaflix/ca-certificate" \
  --query 'Parameter.Value' \
  --output text \
  --region us-east-1

# Delete certificate (if needed)
aws ssm delete-parameter \
  --name "/opaflix/ca-certificate" \
  --region us-east-1
```

### CloudFormation Parameters

| Parameter | Default | Description |
| --------- | ------ | ---------- |
| `BucketPrefix` | `opaflix-sessions` | S3 bucket name prefix |
| `S3Region` | `us-east-1` | S3 bucket region (must match stack region) |
| `CaCertificateParameterName` | `/opaflix/ca-certificate` | SSM parameter path for CA cert |
| `CorsAllowedOrigin` | `https://opaflix.vercel.app` | CORS allowed origin for S3 |
| `GatewayInstanceName` | (empty) | EC2 instance name tag (optional) |
| `GatewayInstanceId` | (empty) | EC2 instance ID (optional) |

### CloudFormation Outputs

The stack provides comprehensive outputs for Opaflix configuration:

| Output | Description |
| ------ | ---------- |
| `OpaflixConfiguration` | Complete .env variables for single-tenant deployment |
| `CertificateFilesPaths` | Paths to generated certificate files |
| `BucketName` | S3 bucket name |
| `BucketRegion` | S3 bucket region |
| `AppRoleArn` | IAM role ARN for Opaflix app |
| `TrustAnchorArn` | IAM Roles Anywhere Trust Anchor ARN |
| `ProfileArn` | IAM Roles Anywhere Profile ARN |
| `GatewayInstanceProfileName` | Instance profile name for OPA Gateway |

**Get configuration:**
```bash
aws cloudformation describe-stacks \
  --stack-name opaflix \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`OpaflixConfiguration`].OutputValue' \
  --output text
```

### Certificate Files

After deployment, certificate files are in `scripts/aws/data/`:

| File | Description |
| ---- | ---------- |
| `ca-cert.pem` | CA certificate (stored in SSM Parameter Store) |
| `opaflix-cert.pem` | Application certificate (for Opaflix config) |
| `opaflix-key.pem` | Application private key (for Opaflix config) |

---

## Verification and Testing

Test your credentials before running Opaflix:

```bash
# Set credentials (temporary for testing)
export AWS_ACCESS_KEY_ID=your_key_here
export AWS_SECRET_ACCESS_KEY=your_secret_here

# Verify identity
aws sts get-caller-identity

# Test S3 access
aws s3 ls s3://opaflix-media-{your-org-name}

# Expected output:
# {
#   "UserId": "AIDAXXXXXXXXXXXXXXXXX",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/opaflix-reader"
# }
```

---

## Troubleshooting

### Session Playback Issues

#### Issue: CORS Error - "Access blocked by CORS policy"

**Error message:**
```
Access to fetch at 'https://bucket.s3.region.amazonaws.com/...' from origin 'https://your-domain.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Solution:**
Configure CORS on your S3 bucket. See [S3 CORS Configuration](#s3-cors-configuration) section above.

**Checklist:**
1. Verify CORS is configured: `aws s3api get-bucket-cors --bucket your-bucket-name`
2. Ensure `AllowedOrigins` includes your exact Opaflix domain (including `https://`)
3. Ensure `AllowedMethods` includes `GET` and `HEAD`
4. If using CloudFront, CORS must be configured on both CloudFront and S3

#### Issue: "Failed to load session" or blank player

**Possible causes:**

1. **CORS not configured** - See above
2. **Presigned URL expired** - URLs expire after 60 minutes; refresh the page
3. **File doesn't exist** - Verify the file exists in S3:
   ```bash
   aws s3 ls s3://your-bucket/path/to/file.cast
   ```
4. **Network error** - Check browser DevTools → Network tab for specific errors

### S3 Access Issues

#### Issue: "Bucket name already exists"

- S3 bucket names are globally unique across all AWS accounts
- Try a different name like `opaflix-media-{your-org-name}` or `opaflix-media-{random-id}`

#### Issue: "Access Denied" errors

**Possible causes:**

1. **User lacks permissions**
   ```bash
   # Check your identity
   aws sts get-caller-identity

   # Check attached policies
   aws iam list-attached-user-policies --user-name your-username
   ```

2. **Bucket policy blocks access**
   - Contact your AWS administrator
   - Verify IAM user has `s3:*` permissions on the bucket

3. **Wrong credentials**
   - Double-check configuration values
   - Ensure no extra spaces or quotes around values

#### Issue: "Region mismatch"

- Ensure `AWS_REGION` in the configuration matches your bucket region
- Check bucket region: `aws s3api get-bucket-location --bucket opaflix-media-{your-org-name}`

### IAM Roles Anywhere Issues

#### Issue: "Untrusted certificate. Insufficient certificate"

**Cause:** Your certificate is missing required X.509 extensions for client authentication.

**Solution:** Regenerate your certificate with the proper extensions:

```bash
# Create signing config with required extensions
cat > sign-app.cnf << 'EOF'
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

# Sign certificate with extensions
openssl x509 -req -days 3650 -in opaflix.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out opaflix-cert.pem \
  -extfile sign-app.cnf

# Verify extensions are present
openssl x509 -in opaflix-cert.pem -noout -ext keyUsage,extendedKeyUsage
# Expected: "Digital Signature, Key Encipherment" and "TLS Web Client Authentication"
```

**Required extensions:**
- `keyUsage = critical, digitalSignature, keyEncipherment`
- `extendedKeyUsage = clientAuth`

#### Issue: "Invalid signature"

**Possible causes:**

1. **Wrong serial number format** - The certificate serial number must be in decimal format, not hex. This is handled automatically by Opaflix.

2. **Request format issue** - Ensure you're using the latest version of Opaflix which sends parameters correctly.

**Diagnostic steps:**
```bash
# Test with AWS official signing helper
curl -sL -o /tmp/aws_signing_helper \
  https://rolesanywhere.amazonaws.com/releases/1.1.1/X86_64/Darwin/aws_signing_helper
chmod +x /tmp/aws_signing_helper

/tmp/aws_signing_helper credential-process \
  --certificate opaflix-cert.pem \
  --private-key opaflix-key.pem \
  --trust-anchor-arn "YOUR_TRUST_ANCHOR_ARN" \
  --profile-arn "YOUR_PROFILE_ARN" \
  --role-arn "YOUR_ROLE_ARN"
```

If this works but Opaflix doesn't, update to the latest version.

#### Issue: "Access Denied" after successful Roles Anywhere authentication

**Cause:** The IAM role doesn't have S3 permissions.

**Solution:** Add S3 permissions to your IAM role:

1. Go to **IAM** → **Roles** → Your role (e.g., `OpaflixS3Access`)
2. Click **Add permissions** → **Attach policies**
3. Create an inline policy or attach `AmazonS3ReadOnlyAccess`

**Minimum required permissions:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    }
  ]
}
```

#### Issue: "Invalid or empty profile provided"

**Cause:** Region mismatch between Trust Anchor and trust policy.

**Solution:** Ensure the `aws:SourceArn` in your role's trust policy uses the **same region as your Trust Anchor**, not your S3 bucket region.

If your Trust Anchor is in `eu-west-3`, your trust policy must reference: `"aws:SourceArn": "arn:aws:rolesanywhere:eu-west-3:..."`

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

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS IAM Roles Anywhere Documentation](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html)
- [AWS CLI Reference](https://docs.aws.amazon.com/cli/latest/)
- [S3 Pricing Calculator](https://calculator.aws/)

---

**Last Updated**: 2026-03-30
