# 🍿 Opaflix

**Okta Privileged Access Session Replay Tool** — Replay OPA SSH and RDP session recordings from AWS S3 with Okta OIDC authentication.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?logo=apache)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green.svg?logo=nodedotjs)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg?logo=docker)](https://docker.com/)
[![Vercel](https://img.shields.io/badge/Vercel-Ready-black.svg?logo=vercel)](https://vercel.com/)
[![AWS](https://img.shields.io/badge/AWS-S3-orange.svg?logo=amazonaws)](https://aws.amazon.com/s3/)
[![Python](https://img.shields.io/badge/Python-Scripts-blue.svg?logo=python)](https://python.org/)
[![Okta](https://img.shields.io/badge/Okta-Integrated-black.svg?logo=okta)](https://okta.com/)

---

## 📑 Table of Contents

- [Overview](#-overview)
  - [Key Features](#-key-features)
  - [Screenshots](#-screenshots) / [Sample Video](#-sample-video)
  - [How It Works](#-how-it-works-high-level-data-flow)
- [Quick Start](#-quick-start)
  - [Local Node.js](#local-nodejs)
  - [Deploy to Vercel](#-deploy-to-vercel)
- [Prerequisites](#-prerequisites)
- [Single-Tenant Mode](#-single-tenant-mode)
- [Multi-Tenant Mode](#-multi-tenant-mode)
- [Configuration](#️-configuration)
- [OPA Gateway Setup](#-opa-gateway-setup)
- [Session Conversion](#-session-conversion)
  - [Conversion Script](#conversion-script)
- [API Reference](#-api-reference)
- [Security](#-security)
- [Scalability Considerations](#-scalability-considerations)
- [Resources](#-resources)
- [Author](#-author)
  - [Special Thanks](#-special-thanks)

---

## 🎯 Overview

Opaflix is a web application for replaying Okta Privileged Access (OPA) session recordings stored in AWS S3. It provides a web interface for browsing and playing back SSH terminal sessions (`.cast`) and RDP desktop sessions (`.mkv`).

🍿 **Like Netflix, but for your PAM Session recordings!** Opaflix delivers a seamless experience for security teams, auditors, and administrators to review privileged access sessions with ease.

> [!TIP]
> **Quick Start** - Get running in 5 minutes! Jump to [Quick Start](#-quick-start) for the fastest setup path.

### ❓ Why Opaflix?

OPA session recording provides the audit foundation. Opaflix adds a lightweight companion interface for teams that want to browse, search, and replay exported recordings from a centralized S3 archive.

It's highly inspired by an old project of our former colleague [Daniel Harris](https://github.com/mrdanielmh/): [opa-utils](https://github.com/mrdanielmh/opa-utils). Since the project is not maintained anymore, I decided to create a new one with a more modern tech stack, and - to be transparent - the heavy help of the AI (Vibe coding with Claude Code).

Opaflix is built with *Node.js*, *Express*, and *Handlebars* for the backend, and uses *[Asciinema Player](https://asciinema.org/)* for SSH session playback and HTML5 video for RDP sessions. It also integrates with the *[OPA API](https://developer.okta.com/docs/api/openapi/opa)* to provide real-time data for the infrastructure graph.

> [!CAUTION]
> **Not an Official Okta Product** - Opaflix is an independent community project.
>
> While I am an employee of Okta, Inc. this project was developed by me entirely in my private capacity.  Opaflix is not an official Okta product and is not endorsed, supported or maintained by Okta.
>
> Use at your own risk and always test in a non-production environment first.

### 🚀 Key Features

- **Dashboard** — Overview page with session statistics, recent activity, and quick access to session lists.

- **Session Lists** — Browse SSH and RDP sessions with:
  - *Server-side Pagination* — Handles thousands of sessions efficiently
  - *Sortable Columns* — Click headers to sort ascending/descending
  - *Resizable Columns* — Drag column borders to resize
  - *Different search behaviors*:
    - *Simple Search* — Quick text search across all fields
    - *Advanced Search* — Filter by server, username, project, team, date range

- **Sessions Playback**:
  - *SSH Sessions* — Asciinema-player with play/pause, speed control, seek
  - *RDP Sessions* — HTML5 video player with standard controls
  - *Direct Download* — Download button on playback pages for offline access
  - *Direct S3 Streaming* — Sessions are streamed directly from S3 using presigned URLs (no server bandwidth consumed for playback)

- **IAM Roles Anywhere** — Certificate-based AWS auth for external deployments (static keys supported as well)

- **OPA API Integration** — Dropdowns populated with real data from your OPA tenant

- **Infrastructure Graph** — Visual topology showing:
  - Gateways → Projects → Servers relationships
  - Interactive navigation with expand/collapse
  - Real-time data from OPA API

- **Single or Multi-Tenant** — Simple ENV-based config or database-backed multi-team deployment
  - **[Single-Tenant](#-single-tenant-mode)** (default): No database required, config from environment variables
  - **[Multi-Tenant](#-multi-tenant-mode)**: PostgreSQL database required, supports multiple teams with isolated configs.

- **Configuration UI** — Web interface for managing tenant settings (multi-tenant) or viewing current config (single-tenant):
  - *Authentication Method Selector* — Choose between Access Keys or IAM Roles Anywhere
  - *Certificate Management* — Upload PEM files directly, view certificate CN and expiration date
  - *Auto-Cleanup* — Switching auth methods automatically removes unused credentials
  - *Expiration Alerts* — Color-coded certificate status (valid, expiring soon, expired)

### 📸 Screenshots

| Dashboard | Session List | Playback RDP | Playback SSH |
| ----------- | -------------- | ---------- | --------- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Sessions](docs/screenshots/sessions.png) | ![Playback RDP](docs/screenshots/playback.png) | ![Playback SSH](docs/screenshots/playback-ssh.png) |
| | | | |

| Configuration UI | Search & Sorting | Graph |
| ----------- | -------------- | ---------- |
| ![Configuration UI](docs/screenshots/configuration.png) | ![Simple Search](docs/screenshots/search_simple.png) ![Advanced Search](docs/screenshots/search_advanced.png) ![Sorting](docs/screenshots/search_sorting.png) | ![Infrastructure Graph](docs/screenshots/graph1.png) ![Graph Details](docs/screenshots/graph4.png) |
| | | |

### 🎥 Sample Video

https://github.com/user-attachments/assets/364eecf2-c99e-42d2-b84a-0de262042b97

### ⚠️ Limitations

- **Opaflix v1 access model** - Opaflix currently applies one flat recording access scope. Use it for trusted PAM administrators and auditors, and rely on deployment isolation, Okta app assignment, and network controls until granular in-app authorization is added.
- **S3 only** - Opaflix currently focuses on S3-backed exported recordings. Other storage backends may be evaluated in the future based on feedback.
- **Powered by Vibe Coding** - Even if the code was revised and tested, I'm not a developer and Opaflix was written with the heavy usage of Vibe Coding (powered by Claude Code), so I can't exclude bugs and security issues. This is a community-built tool and has not undergone formal product security review. Use with caution and always test in a non-production environment first.

### 🔄 How It Works (High-Level Data Flow)

The following is a high-level overview of the Opaflix data flow:

```mermaid
---
config:
  layout: elk
---
flowchart LR
 subgraph User["1️⃣ &nbsp; Privileged Access"]
        Admin["👤 &nbsp; Administrator"]
  end
   subgraph Gateway["2️⃣ &nbsp; OPA Gateway"]
        Broker["SFT Broker"]
        Session[("Session Recording<br>/var/log/sft/sessions/*.asa")]
  end
    subgraph Target["3️⃣ &nbsp; Target"]
      Server["🖥️ &nbsp; Server"]
  end
 subgraph SyncService["4️⃣ &nbsp; opaflix-sync"]
        Convert["Session Conversion<br>.asa → .cast / .mkv"]
  end

 subgraph Storage["5️⃣ &nbsp; AWS S3"]
        S3[("Converted Sessions<br>.cast / .mkv")]
  end
 subgraph Playback["6️⃣ &nbsp; Opaflix"]
        Web["Web Application"]
        Browser["🌐 &nbsp; Browser"]
  end


    Broker --> Session & Server
    Session --> Convert
    Convert -- Upload --> S3
    S3 --> Web
    Web --> Browser
    Admin -.-> Server
    Admin --> Broker

    style Admin fill:#ffffff
    style Convert fill:#ffffff
    style Broker fill:#ffffff
    style Session fill:#ffffff
    style S3 fill:#ffffff
    style Web fill:#ffffff
    style Browser fill:#ffffff
    style Server fill:#ffffff
    style User fill:#BBDEFB
    style Gateway fill:#C8E6C9
    style Storage fill:#FFF9C4
    style Playback fill:#FFCDD2
    style SyncService fill:#E1BEE7
```

| Step | Actor | Description |
| ----- | ----- | ----------- |
| **1** | Administrator | Connects to target server via SSH or RDP using OPA Gateway as passthrough / bastion host |
| **2** | OPA Gateway | Proxies the connection to the target server and records the session in native `.asa` format |
| **3** | Target Server | The actual server being accessed (recorded by the gateway) |
| **4** | opaflix-sync | Converts `.asa` → `.cast` (SSH) or `.mkv` (RDP), uploads to S3 |
| **5** | AWS S3 | Stores converted session recordings |
| **6** | Opaflix | Web interface for browsing and playing back sessions |

> [!NOTE]
> The opaflix-sync script may be installed on the same server as the OPA Gateway or on a separate server with access to the `.asa` files. See [Session Conversion](#-session-conversion) for details.

### 🏗️ Opaflix Application Architecture

The following diagram illustrates the architecture of the Opaflix application, including its interactions with Okta for authentication, AWS S3 for storage, and the OPA API for real-time data:

```mermaid
---
config:
  layout: dagre
---
flowchart LR
 subgraph Client["Client"]
        Browser["🌐 Browser"]
  end
 subgraph Opaflix["Opaflix"]
        App["Express.js App"]
        Auth["Okta OIDC"]
  end
 subgraph AWS["AWS"]
        S3[("AWS S3")]
  end
  subgraph OktaCloud["Okta Cloud"]
        OPA["OPA API"]
        Okta["Okta IdP"]
  end
  subgraph Database["Database"]
        PG[("PostgreSQL")]
  end
    Browser --> App
    App --> Auth & S3 & OPA
    App -.-> PG
    Auth --> Okta
```

---

## 🚀 Quick Start

Get Opaflix running in 5 minutes using **single-tenant mode** (no database required):

### Local Node.js

1. Clone the Repository

    ```bash
    git clone https://github.com/fabiograsso/okta-opaflix.git
    cd opaflix
    ```

2. Create Environment File

    ```bash
    cp .env.example .env
    ```

3. Configure Settings

    Edit `.env` with your credentials:

    ```bash
    # Single-tenant mode (default)
    MULTITENANT=NO

    # Okta Authentication
    OKTA_ISSUER=https://your-tenant.okta.com
    OKTA_CLIENT_ID=your-client-id
    OKTA_CLIENT_SECRET=your-client-secret

    # AWS S3
    AWS_ACCESS_KEY_ID=your-access-key
    AWS_SECRET_ACCESS_KEY=your-secret-key
    AWS_REGION=us-east-1
    AWS_S3_BUCKET=your-bucket

    # Application
    BASE_URI=http://localhost:3000
    SESSION_SECRET=your-secure-secret-minimum-32-characters-long
    ```

4. Start the Server
    - 💻 **Option 1 - Local Node.js**

    ```bash
    npm install
    npm start
    ```

    - 🐳 **Option 2 - Docker**

    ```bash
    docker run -d -p 3000:3000 --env-file .env --name opaflix opaflix:latest

    # Or (Makefile with Docker Compose)

    make start

    # Or (direct Docker Compose)

    docker compose --profile prod up -d
    ```

5. Access Opaflix

    Open `http://localhost:3000`

> [!TIP]
> Single-tenant mode is the simplest deployment. For serving multiple teams, see [Multi-Tenant Mode](#-multi-tenant-mode).

### ▲ Deploy to Vercel

You can deploy Opaflix to Vercel in single-tenant mode with one click. This setup uses S3 Access Key, but you can also use IAM Roles Anywhere for AWS authentication (see [AWS.md](docs/AWS.md)). You can also switch in [multi-tenant mode](#-multi-tenant-mode), but it requires a PostgreSQL database (such as Neon).

For a Vercel deployment using a **Neon** integration, connect the Neon instance to your Vercel project, set `OPAFLIX` as **Custom Environment Variable Prefix
**, and then use its default `OPAFLIX_PGHOST`, `OPAFLIX_PGUSER`, `OPAFLIX_PGDATABASE`, and `OPAFLIX_PGPASSWORD` environment variables when the corresponding `PG*` variables are not set. The standard `PGHOST`, `PGUSER`, `PGDATABASE`, and `PGPASSWORD` variables take precedence. Set `VERCEL_NEON_PREFIX` when the integration uses a different prefix; it defaults to `OPAFLIX`.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffabiograsso%2Fokta-opaflix&env=MULTITENANT,OKTA_ISSUER,OKTA_CLIENT_ID,OKTA_CLIENT_SECRET,AWS_REGION,AWS_S3_BUCKET,AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY,BASE_URI,SESSION_SECRET,OPA_API_TEAM_NAME,OPA_API_KEY_ID,OPA_API_KEY_SECRET&envDescription=Required%20configuration%20for%20Opaflix%20single-tenant%20deployment&envLink=https%3A%2F%2Fgithub.com%2Ffabiograsso%2Fokta-opaflix%2Fblob%2Fmain%2FREADME.md%23-configuration&project-name=opaflix&repository-name=okta-opaflix)

> [!WARNING]
> **Security Warning**
>
> - Use Vercel Environment Variables to securely store your AWS and Okta credentials. Do not hardcode secrets in your code or commit them to version control.
> - For production deployments, consider using IAM Roles Anywhere for AWS authentication to avoid static access keys. See [AWS.md](docs/AWS.md) for setup instructions.
> - Do not allow public access to your Opaflix deployment. Use Vercel's password protection or IP allowlisting features to restrict access.

#### Vercel Prerequisites

Before deploying to Vercel, you need:

1. **AWS Infrastructure** — S3 bucket with Access Key credentials (or you need to change the env variables for IAM Roles Anywhere)
2. **Okta OIDC App** — Web application for authentication
3. **OPA API Credentials** (optional) — For infrastructure graph visualization

#### Why Vercel?

- **Free Tier** — Perfect for small teams and testing
- **Serverless** — Pay only for what you use, scales automatically
- **No Server Management** — Focus on functionality, not infrastructure
- **Global CDN** — Fast worldwide access

#### Vercel Configuration

The included `vercel.json` configures:

- Static file serving from `public/` directory
- Node.js serverless function for the Express app
- Route mapping for CSS, JS, and other assets

---

## 📦 Prerequisites

### Common Requirements

| Component | Required | Description |
| --------- | -------- | ----------- |
| **Node.js 24+** | Yes | JavaScript runtime |
| **Okta OIDC App** | Yes | Authentication via Okta SSO |
| **AWS S3 Bucket** | Yes | Storage for converted session recordings |
| **OPA API Credentials** | No | Optional — for infrastructure graph visualization |

### Additional for Multi-Tenant Mode

| Component | Required | Description |
| --------- | -------- | ----------- |
| **PostgreSQL** | Yes | Tenant configuration storage (Neon recommended) |

### Okta OIDC Setup

1. Create a new **Web Application** in Okta Admin Console
2. Set **Sign-in redirect URI**: `http://localhost:3000/authorization-code/callback` (or your custom domain)
3. Set **Sign-out redirect URI**: `http://localhost:3000/login` (or your custom domain)
4. Copy Client ID and Secret

---

## 🏠 Single-Tenant Mode

Single-tenant mode is the default and simplest deployment option. All configuration comes from environment variables — no database required.

### When to Use

- Single team or organization
- Simple deployment without database infrastructure
- Development and testing

### Configuration

```bash
# .env file
MULTITENANT=NO #Default is NO, can be omitted

# Required: Application
BASE_URI=http://localhost:3000
SESSION_SECRET=your-secure-secret-minimum-32-characters-long

# Required: Okta Authentication
OKTA_ISSUER=https://your-tenant.okta.com
OKTA_CLIENT_ID=your-client-id
OKTA_CLIENT_SECRET=your-client-secret

# Required: AWS S3
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket

# Method 1: Static Access Keys (simple)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Method 2: IAM Roles Anywhere
# AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN=arn:aws:rolesanywhere:region:account:trust-anchor/id
# AWS_ROLES_ANYWHERE_PROFILE_ARN=arn:aws:rolesanywhere:region:account:profile/id
# AWS_ROLES_ANYWHERE_ROLE_ARN=arn:aws:iam::account:role/RoleName
# AWS_ROLES_ANYWHERE_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# AWS_ROLES_ANYWHERE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Optional: OPA API (for infrastructure graph)
OPA_TENANT_URL=your-org.pam.okta.com      # Full OPA tenant URL
OPA_TEAM_NAME=your-team                   # Team name within the OPA tenant
OPA_API_KEY_ID=your-key-id
OPA_API_KEY_SECRET=your-key-secret
```

Behavior:

- Session indices stored in-memory only (rebuilt on restart)
- To change settings, update `.env` and restart the application

> [!IMPORTANT]
> In single-tenant mode, the `/config` page is read-only. All settings must be changed via environment variables.

---

## 🏢 Multi-Tenant Mode

Multi-tenant mode enables a single Opaflix deployment to serve multiple OPA teams, each with isolated configuration.

### Enabling Multi-Tenant Mode

```bash
# .env file
MULTITENANT=YES

# Required: PostgreSQL Database
PGHOST=your-host.neon.tech
PGPORT=5432
PGDATABASE=neondb
PGUSER=your-user
PGPASSWORD=your-password
PGSSLMODE=require

# Required: Application
BASE_URI=http://localhost:3000
SESSION_SECRET=your-secure-secret-minimum-32-characters-long
```

### PostgreSQL Setup

We recommend [Neon](https://neon.tech) for serverless PostgreSQL:

1. Create a free database at [neon.tech](https://neon.tech)
2. Copy connection details to your `.env` file
3. Tables are auto-created on startup

### Creating Tenants

The architecture uses a `tenants` table with a composite key on (tenant_url, team_name):

- **tenant_url**: The OPA instance URL (e.g., `demo-blue-sky-1234.pam.okta.com`)
- **team_name**: The team name within that OPA instance (e.g., `blue-sky`)

Each tenant requires at minimum the OIDC configuration (issuer, client ID, client secret). AWS and OPA settings can be configured later via the UI.

Create tenants via SQL:

```sql
-- PostgreSQL script to create tenant and configuration
DO $$
DECLARE
    v_tenant_url text := 'demo-blue-sky-1234.pam.okta.com';  -- Your OPA instance URL
    v_team_name text := 'blue-sky';  -- Your team name
    v_description text := 'Blue Sky Team';
    v_client_id text := 'your-okta-client-id';
    v_client_secret text := 'your-okta-client-secret';
    v_issuer text := 'https://your-tenant.okta.com/oauth2/default';
    v_tenant_id uuid;
BEGIN
    -- Create tenant (unique combination of tenant_url + team_name)
    INSERT INTO tenants (tenant_url, team_name, description, is_active)
    VALUES (v_tenant_url, v_team_name, v_description, true)
    RETURNING id INTO v_tenant_id;

    -- Insert tenant configuration
    INSERT INTO tenant_configs (tenant_id, config_key, config_value) VALUES
        (v_tenant_id, 'okta.clientId', v_client_id),
        (v_tenant_id, 'okta.clientSecret', v_client_secret),
        (v_tenant_id, 'okta.issuer', v_issuer);

    RAISE NOTICE 'Created tenant % / % (ID %)', v_tenant_url, v_team_name, v_tenant_id;
END $$;
```

Then configure at `http://localhost:3000/config?tenant=demo-blue-sky-1234.pam.okta.com&team=blue-sky`.

> [!TIP]
> **Preview vs Production**: The environment is determined by the tenant URL:
>
> - Production: `*.pam.okta.com`
> - Preview: `*.pam.oktapreview.com`

> [!NOTE]
> I'm evaluating improvements on the initial tenant creation process. In the future, I may add a UI for creating tenants directly from the application.

### How It Works

```mermaid
flowchart LR
    Request["Request with\n?tenant=...&team=..."] --> Resolver["Tenant Resolver"]
    Resolver --> DB[("PostgreSQL")]
    DB --> Config["Team Config"]
    Config --> Services["OIDC / S3 / OPA API"]
```

### URL Parameters

| Parameter | Values | Description |
| --------- | ----- | ---------- |
| `?tenant=` | Tenant URL | Required — the OPA instance URL (e.g., `demo-blue-sky-1234.pam.okta.com`) |
| `?team=` | Team name | Required — identifies the team within the tenant |

**Examples:**

```txt
http://localhost:3000/?tenant=demo-blue-sky-1234.pam.okta.com&team=blue-sky
http://localhost:3000/sessions/list?tenant=demo-blue-sky-1234.pam.okta.com&team=blue-sky
http://localhost:3000/?tenant=demo-blue-sky-1234.pam.oktapreview.com&team=blue-sky
```

> [!NOTE]
> The tenant and team are stored in your session and in cookies after first access. Switch by visiting a URL with different parameters.

### Database Schema

```mermaid
erDiagram
    tenants ||--o{ tenant_configs : has
    tenants ||--o{ session_indices : has

    tenants {
        uuid id PK
        varchar tenant_url
        varchar team_name
        text description
        boolean is_active
    }

    tenant_configs {
        uuid id PK
        uuid tenant_id FK
        varchar config_key
        text config_value
    }

    session_indices {
        uuid id PK
        uuid tenant_id FK
        varchar session_type
        jsonb index_data
        integer session_count
    }
```

| Table | Purpose | Key Constraint |
| ----- | ------ | ------------- |
| `tenants` | Tenant (OPA instance + team combination) | `UNIQUE(tenant_url, team_name)` |
| `tenant_configs` | Per-tenant settings (Okta, AWS, OPA) | `UNIQUE(tenant_id, config_key)` |
| `session_indices` | Cached session list for fast search | `UNIQUE(tenant_id, session_type)` |

**Config Keys** (stored in `tenant_configs`):

| Category | Keys |
| -------- | --- |
| Okta | `okta.issuer`, `okta.clientId`, `okta.clientSecret` |
| AWS (Keys) | `aws.region`, `aws.bucket`, `aws.accessKeyId`, `aws.secretAccessKey` |
| AWS (Roles Anywhere) | `aws.roleArn`, `aws.rolesAnywhereTrustAnchorArn`, `aws.rolesAnywhereProfileArn`, `aws.rolesAnywhereCertificate`, `aws.rolesAnywherePrivateKey` |
| OPA API | `opaApi.keyId`, `opaApi.keySecret` |

> Team name for OPA API comes from the `tenants.team_name` column.

**Example: Multiple teams in one OPA instance**:

```sql
-- Multiple teams in the same OPA instance (each is a separate tenant row)
INSERT INTO tenants (tenant_url, team_name, description) VALUES
    ('demo-blue-sky-1234.pam.okta.com', 'blue-sky', 'Blue Sky Team'),
    ('demo-blue-sky-1234.pam.okta.com', 'red-sky', 'Red Sky Team');
```

> [!NOTE]
> Tables are auto-created on startup.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Single-Tenant | Multi-Tenant | Default | Description |
| -------- | ------------ | ----------- | ------ | ---------- |
| `MULTITENANT` | — | — | `NO` | Mode: `YES`/`TRUE`/`1` or `NO`/`FALSE`/`0` |
| `OKTA_ISSUER` | Required | — | — | Okta issuer URL |
| `OKTA_CLIENT_ID` | Required | — | — | Okta client ID |
| `OKTA_CLIENT_SECRET` | Required | — | — | Okta client secret |
| `AWS_REGION` | Required | — | — | AWS region |
| `AWS_S3_BUCKET` | Required | — | — | S3 bucket name |
| **Method 1: Access Keys** | | | | |
| `AWS_ACCESS_KEY_ID` | Conditional | — | — | AWS access key (if not using Roles Anywhere) |
| `AWS_SECRET_ACCESS_KEY` | Conditional | — | — | AWS secret key (if not using Roles Anywhere) |
| **Method 2: IAM Roles Anywhere** | | | | |
| `AWS_ROLES_ANYWHERE_TRUST_ANCHOR_ARN` | Conditional | — | — | Trust Anchor ARN |
| `AWS_ROLES_ANYWHERE_PROFILE_ARN` | Conditional | — | — | Profile ARN |
| `AWS_ROLES_ANYWHERE_ROLE_ARN` | Conditional | — | — | IAM Role ARN |
| `AWS_ROLES_ANYWHERE_CERTIFICATE` | Conditional | — | — | X.509 certificate (PEM) |
| `AWS_ROLES_ANYWHERE_PRIVATE_KEY` | Conditional | — | — | Private key (PEM) |
| **OPA Configuration** | | | | |
| `OPA_TENANT_URL` | Optional | — | — | OPA instance URL (e.g., `demo-blue-sky-1234.pam.okta.com`) |
| `OPA_TEAM_NAME` | Optional | — | — | Team name within the OPA instance |
| `OPA_API_KEY_ID` | Optional | — | — | OPA API key ID (for graph) |
| `OPA_API_KEY_SECRET` | Optional | — | — | OPA API key secret |
| **Database (Multi-Tenant Only)** | | | | |
| `PGHOST` | — | Required | — | PostgreSQL hostname |
| `PGPORT` | — | Optional | `5432` | PostgreSQL port |
| `PGDATABASE` | — | Required | — | Database name |
| `PGUSER` | — | Required | — | Database user |
| `PGPASSWORD` | — | Required | — | Database password |
| `PGSSLMODE` | — | Optional | `require` | SSL mode |
| **Application** | | | | |
| `BASE_URI` | Required | Required | — | Application URL |
| `SESSION_SECRET` | Required | Required | — | Session key (min 32 chars) |
| `NODE_ENV` | Optional | Optional | `production` | Environment |
| `PORT` | Optional | Optional | `3000` | HTTP port |
| `LOG_LEVEL` | Optional | Optional | `info` | Logging level |

> [!TIP]
> For AWS authentication, use **either** Access Keys (Method 1) **or** IAM Roles Anywhere (Method 2). IAM Roles Anywhere is recommended for external deployments. See [AWS.md](docs/AWS.md) for detailed setup.

### Tenant Configuration (Multi-Tenant Only)

In multi-tenant mode, per-tenant settings are managed via the **`/config`** page and stored in the database:

| Section | Settings | Editable |
| ------- | ------- | ------- |
| **Okta OIDC** | Issuer, Client ID, Client Secret | Read-only |
| **AWS S3** | Auth method, Region, Bucket, Access Keys or Roles Anywhere | Yes |
| **OPA API** | API Key ID, API Key Secret | Yes |

**AWS Authentication Options:**

- **Access Keys** — Traditional access key ID + secret access key
- **IAM Roles Anywhere** — X.509 certificate-based auth (recommended for external deployments)

For detailed AWS setup, see [docs/AWS.md](docs/AWS.md).

The config page displays certificate details (CN, expiration date, status) when using IAM Roles Anywhere. Switching authentication methods automatically cleans up unused credentials from the database.

> [!IMPORTANT]
> Okta settings are read-only in the UI for security. You can modify them only directly in the database.

---

## 🔧 OPA Gateway Setup

Opaflix requires session recordings in a specific filename format.

### Required Filename Format

```txt
{protocol}~{timestamp}~{teamName}~{projectName}~{serverName}~{username}~{hash}.asa
```

### Gateway Configuration

Edit `/etc/sft/sft-gatewayd.yaml`:

```yaml
LogFileNameFormats:
  SSHRecording: "{{.Protocol}}~{{.StartTime}}~{{.TeamName}}~{{.ProjectName}}~{{.ServerName}}~{{.Username}}~"
  RDPRecording: "{{.Protocol}}~{{.StartTime}}~{{.TeamName}}~{{.ProjectName}}~{{.ServerName}}~{{.Username}}~"
```

Restart the gateway:

```bash
sudo systemctl restart sft-gatewayd
```

### Okta Documentation

- [Configure PAM Gateway](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-gateway-configure.htm)
- [Session Capture Overview](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-session-capture.htm)
- [Enable Session Capture](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-enable-session-capture.htm)

---

## 🔄 Session Conversion

OPA recordings (`.asa`) must be converted to playable formats before uploading to S3.

### Prerequisites

| Tool | Purpose | Installation |
| ---- | ------ | ----------- |
| **sft CLI** | Convert session recordings | [Okta Privileged Access Docs](https://help.okta.com/oie/en-us/content/topics/privileged-access/tool-setup/install-client.htm) |
| **RDP Transcoder** | RDP to MKV conversion | [RDP Transcoder Docs](https://help.okta.com/oie/en-us/content/topics/privileged-access/gateways/pam-rdp-transcoder.htm) |

### Conversion Commands

```bash
# SSH: .asa → .cast
sft session-logs export --insecure --format asciinema /path/source.asa --output /path/output.cast

# RDP: .asa → .mkv
sft session-logs export --insecure --format mkv --output /path/output.mkv /path/source.asa
```

> [!NOTE]
> The `--insecure` flag skips signature verification for offline/batch processing. Use only in trusted environments.

### Conversion Script

A sample python script is provided, it will automatically look for any new files, convert them and upload them to S3.

Features:

- **Instant File Detection**: Uses watchdog filesystem events for immediate processing of new files
- **S3 Integration**: Uploads converted files directly to S3 via boto3
- **Duplicate Detection**: Skips files already present in S3
- **Sequential Processing**: Processes one file at a time for stability
- **Configurable Cleanup**: Optionally deletes old source files
- **Graceful Shutdown**: Handles SIGTERM/SIGINT for clean service stops
- **Comprehensive Logging**: Detailed logs with configurable verbosity
- **Systemd Integration**: Ready-to-use service file included

See [scripts/convert-sessions/](scripts/convert-sessions/) for details.

### S3 Upload

After conversion, sync to S3:

```bash
aws s3 sync /var/log/sft/converted/ssh/ s3://your-bucket/ --include "*.cast"
aws s3 sync /var/log/sft/converted/rdp/ s3://your-bucket/ --include "*.mkv"
```

> [!TIP]
> Remember to add your Opaflix domain to the CORS configuration of your S3 bucket to allow direct streaming. You can find more information in the [AWS Documentation](scripts/aws/README.md)

---

## 📡 API Reference

### Routes

| Method | Path | Auth | Description |
| ------ | --- | --- | ---------- |
| `GET` | `/` | Yes | Dashboard |
| `GET` | `/sessions/list` | Yes | Session list (`?type=ssh` or `?type=rdp`) |
| `GET` | `/sessions/playback/ssh` | Yes | SSH player |
| `GET` | `/sessions/playback/rdp` | Yes | RDP player |
| `GET` | `/sessions/stream/rdp` | Yes | Stream RDP video |
| `GET` | `/config` | Yes | Configuration page |
| `POST` | `/config` | Yes | Update configuration (multi-tenant only) |
| `GET` | `/graph` | Yes | Infrastructure graph |
| `GET` | `/api/filter-options` | Yes | Filter dropdown data (from sessions) |
| `GET` | `/api/refresh/status` | Yes | Session refresh status |
| `GET` | `/login` | No | Okta login |
| `GET` | `/logout` | Yes | Clear session |
| `GET` | `/health` | No | Health check |

---

## 🔒 Security

> [!WARNING]
> **Security Considerations**: While basic security measures are implemented, Opaflix has not undergone a formal security audit. Use with caution, especially in production environments.
> I warmly suggest deploying behind a WAF and/or VPN, and not exposing it directly to the internet without proper protections in place.

### Authentication

- All routes except `/health` and `/login` require Okta authentication via OpenID Connect
- Session cookies are `httpOnly`, `secure`, and `sameSite`

### Security Headers

Helmet.js provides:

- Content Security Policy (CSP)
- X-Content-Type-Options
- X-Frame-Options
- Strict-Transport-Security (HSTS)
- X-XSS-Protection

### Input Validation

- Path traversal prevention on S3 keys
- Joi schema validation on all inputs
- XSS prevention via Handlebars auto-escaping

### Rate Limiting

- Prevents abuse and ensures fair usage
- Configurable in `src/config/constants.js`

| Endpoint Type | Limit | Window |
| ------------- | ---- | ----- |
| Session lists / API | 10 req | 1 minute |
| Playback / Downloads | 10 req | 1 minute |

Rate limits apply per authenticated user. Exceeding limits returns HTTP 429.

### Health Check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": { "server": "ok", "s3": "ok", "memory": "ok" }
}
```

---

## 📊 Scalability Considerations

Opaflix stores session indices in JSONB format for fast search and pagination. The table below shows estimated memory usage and S3 listing times for different session counts:

| Sessions | JSONB Size | In-Memory | S3 Listing Time | Recommendation |
|----------|-----------|-----------|-----------------|----------------|
| 1,000 | ~350 KB | ~900 KB | ~0.2s | ✅ Optimal |
| 10,000 | ~3.5 MB | ~9 MB | ~2s | ✅ Good |
| 25,000 | ~9 MB | ~23 MB | ~5s | ✅ Good |
| 50,000 | ~18 MB | ~45 MB | ~10s | ⚠️ Acceptable |
| 75,000 | ~26 MB | ~68 MB | ~15s | ⚠️ Acceptable |
| 100,000 | ~35 MB | ~90 MB | ~20s | ⚠️ Near limit |
| 200,000 | ~70 MB | ~180 MB | ~40s | ❌ Consider alternatives |
| 300,000 | ~105 MB | ~270 MB | ~60s | ❌ Not recommended |
| 500,000 | ~175 MB | ~450 MB | ~1.5 min | ❌ Not recommended |
| 1,000,000 | ~350 MB | ~900 MB | ~3 min | ❌ Architecture change needed |

**Notes:**
- *JSONB Size*: Storage in PostgreSQL `session_indices` table (~350 bytes per session)
- *In-Memory*: RAM usage when index is loaded with enriched fields (~2.5x storage)
- *S3 Listing Time*: Initial index build time (1,000 objects per API call, ~200ms each)

> [!IMPORTANT]
> For deployments exceeding **100,000 sessions**, consider:
> - Implementing time-based partitioning (archive old sessions)
> - Migrating to a dedicated sessions table with proper SQL indexing
> - Using event-driven architecture (S3 triggers → Lambda → DB)

---

## 📚 Resources

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

- [Okta Privileged Access Documentation](https://help.okta.com/oie/en-us/content/topics/privileged-access/pam-get-started.htm)
- [Okta OIDC / Express Integration](https://github.com/okta-samples/okta-express-sample)
- [AWS S3 SDK v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [AWS IAM Roles Anywhere](https://aws.amazon.com/iam/roles-anywhere/)
- [Helmet.js Security](https://helmetjs.github.io/)
- [Okta OPA API Documentation](https://developer.okta.com/docs/api/openapi/opa)
- [Asciinema Player](https://asciinema.org/)

---

## 👤 Author

**Fabio Grasso**

- Blog: [iam.fabiograsso.net](https://iam.fabiograsso.net)
- GitHub: [@fabiograsso](https://github.com/fabiograsso)
- LinkedIn: [Fabio Grasso](https://www.linkedin.com/in/fabiograsso82)

### 🙏 Special Thanks

- **Pascale Kik** - For her invaluable feedback and testing efforts during the early stages of development. Her insights helped shape the user experience and identify critical issues.
- **Okta Community** - For their support and engagement, which inspired the creation of Opaflix as a tool to benefit PAM administrators and auditors.

---

**Last Updated**: 2026-10-06

<p align="center">
  Made with ❤️ for the Okta community
</p>

*While I am an employee of Okta, Inc. this project was developed by me entirely in my private capacity.  Opaflix is not an official Okta product and is not endorsed, supported or maintained by Okta.*
