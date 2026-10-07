# CLAUDE.md - Project Context for AI Assistants

This file provides context and guidelines for AI assistants working on the Opaflix project.

## Project Overview

**Opaflix** is a web application for replaying Okta Privileged Access (OPA) session recordings from AWS S3 storage. It supports both SSH terminal sessions (.cast files) and RDP desktop sessions (.mkv files) with Okta OIDC authentication.

### Key Features

- **Dual Deployment Modes**: Single-tenant (ENV-based) or multi-tenant (database-backed)
- **Single-Tenant Mode**: No database required, all config from environment variables
- **Multi-Tenant Support**: Single deployment serves multiple OPA teams/tenants
- **Configuration UI**: Web-based interface for viewing/editing tenant settings (AWS, OPA API) with authentication method selector
- **IAM Roles Anywhere**: Certificate-based AWS authentication for external deployments (no static keys needed)
- **Infrastructure Graph**: Visual topology of OPA infrastructure (Gateways, Projects, Servers)
- **Dashboard**: Overview page with session statistics and recent activity
- **SSH Session Replay**: Playback of terminal sessions using asciinema-player
- **RDP Session Replay**: Playback of desktop sessions using HTML5 video player
- **Advanced Search**: Filter sessions by server, username, project, team, and date range
- **OPA API Integration**: Dropdowns populated with real data from OPA API (servers, users, projects, teams)
- **Server-side Pagination**: Efficient handling of large session lists
- **Sortable Columns**: Click table headers to sort ascending/descending
- **Resizable Columns**: Drag column borders to resize
- **Per-Tenant Session Indexing**: Database-backed index for fast search with caching
- **Okta OIDC Authentication**: Secure access via Okta SSO
- **AWS S3 Integration**: Stream recordings directly from S3
- **LRU Caching**: Intelligent file caching for performance
- **Rate Limiting**: Protection against abuse
- **Security Hardened**: Helmet.js headers, CSP, input validation
- **Modern UI**: Okta Admin Dashboard-style interface with sidebar navigation

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Template Engine**: Handlebars (express-handlebars)
- **Authentication**: Okta OIDC Middleware
- **Database**: PostgreSQL (with pg driver, optional Neon)
- **Cloud Storage**: AWS S3 SDK v3
- **Logging**: Winston
- **Validation**: Joi
- **Security**: Helmet.js, express-rate-limit

## Deployment Modes

Opaflix supports two deployment modes:

| Mode | Database | Configuration | URL Parameters |
| ---- | ------- | ------------ | ------------- |
| **Single-Tenant** | Not required | Environment variables | None needed |
| **Multi-Tenant** | PostgreSQL required | Database + `/config` page | `?tenant=X&team=Y` required |

### Mode Selection

Set via the `MULTITENANT` environment variable:
- `MULTITENANT=NO` (default): Single-tenant mode
- `MULTITENANT=YES`: Multi-tenant mode

## Single-Tenant Architecture

In single-tenant mode, Opaflix runs without a database. All configuration comes from environment variables.

### Key Characteristics
- **No Database**: PostgreSQL not required
- **ENV-based Config**: Okta, AWS, and OPA API settings from environment variables
- **No URL Parameters**: No `?team=` parameter needed
- **In-Memory Indices**: Session indices stored in memory only (rebuilt on restart)
- **Read-Only Config Page**: `/config` shows settings but doesn't allow updates

### Request Flow (Single-Tenant)
1. Request arrives (no `?team=` parameter needed)
2. `tenantResolver` middleware uses `singleTenantConfig` from app config
3. `req.tenantContext` is populated with ENV-based config
4. Services use config from environment variables

### Key Functions
- `environment.js` - Builds `singleTenantConfig` object when `MULTITENANT=NO`
- `tenantConfigService.js` - Returns `singleTenantConfig` directly (no DB query)
- `sessionIndexService.js` - Skips database persistence for indices

## Multi-Tenant Architecture

In multi-tenant mode, Opaflix supports multiple tenants with database-backed configuration.

### Architecture Overview
- **Database**: PostgreSQL stores tenant configs in `tenants` and `tenant_configs` tables
- **Tenant Resolution**: Middleware extracts tenant URL and team from `?tenant=X&team=Y` query params or session
- **Per-Request Credentials**: S3 and OPA API services receive tenant config per-request
- **Session Indices**: Per-tenant indices stored in `session_indices` table with caching

### Key Services
- `databaseService.js` - Connection pool, auto-creates tables on startup
- `tenantConfigService.js` - Load/cache team configs from database
- `tenantResolver.js` - Middleware to resolve tenant/team from request

### Request Flow
1. Request arrives with `?tenant=tenantUrl&team=teamName`
2. `tenantResolver` middleware looks up tenant by URL, then team by (tenant_id, team_name)
3. `req.tenantContext` is populated with `{ tenantId, tenantUrl, teamName, config }`
4. Controllers pass `tenantContext.config` to services
5. Services use team-specific credentials for S3/OPA operations
6. OPA API URL is the tenant URL directly (e.g., `https://demo-blue-sky-1234.pam.okta.com`)

### Database Schema

The architecture uses a single `tenants` table with a composite key on (tenant_url, team_name).

**tenants table** (one row per team configuration):
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_url VARCHAR(255) NOT NULL,  -- e.g., demo-blue-sky-1234.pam.okta.com
  team_name VARCHAR(255) NOT NULL,   -- e.g., blue-sky
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_url, team_name)
);

CREATE INDEX idx_tenants_lookup ON tenants(tenant_url, team_name);
CREATE INDEX idx_tenants_active ON tenants(is_active);
```

**tenant_configs table** (per-tenant settings):
```sql
CREATE TABLE tenant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_key VARCHAR(255) NOT NULL,
  config_value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, config_key)
);

CREATE INDEX idx_tenant_configs_lookup ON tenant_configs(tenant_id, config_key);
```

**session_indices table** (per-tenant session cache):
```sql
CREATE TABLE session_indices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_type VARCHAR(10) NOT NULL,
  index_data JSONB NOT NULL,
  session_count INTEGER DEFAULT 0,
  last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, session_type)
);

CREATE INDEX idx_session_indices_lookup ON session_indices(tenant_id, session_type);
```

## Project Structure

```text
opaflix/
├── src/
│   ├── app.js                    # Express app setup
│   ├── index.js                  # Application entry point
│   ├── config/
│   │   ├── environment.js        # Environment validation & config (database config)
│   │   ├── logger.js             # Winston logger setup
│   │   └── constants.js          # App constants
│   ├── controllers/
│   │   ├── apiController.js      # API endpoint handlers (OPA filter options, refresh status)
│   │   ├── configController.js   # Configuration page controller
│   │   ├── dashboardController.js # Dashboard statistics & overview
│   │   ├── graphController.js    # Infrastructure graph visualization
│   │   ├── sessionController.js  # Session listing & playback logic
│   │   └── healthController.js   # Health check endpoint
│   ├── middleware/
│   │   ├── authentication.js     # Okta OIDC middleware
│   │   ├── errorHandler.js       # Global error handling
│   │   ├── rateLimiter.js        # Rate limiting config
│   │   ├── securityHeaders.js    # Helmet.js security headers
│   │   └── tenantResolver.js     # Tenant resolution from request
│   ├── routes/
│   │   ├── index.js              # Route setup (includes dashboard route)
│   │   ├── api.js                # API routes (OPA data endpoints, refresh status)
│   │   ├── auth.js               # Authentication routes
│   │   ├── config.js             # Configuration page routes
│   │   ├── graph.js              # Infrastructure graph routes
│   │   ├── health.js             # Health check route
│   │   └── session.js            # Session replay routes
│   ├── services/
│   │   ├── s3Service.js          # AWS S3 interactions (multi-tenant, presigned URLs)
│   │   ├── fileParser.js         # Session file parsing
│   │   ├── oktaService.js        # Okta OIDC utilities
│   │   ├── opaApiService.js      # OPA API integration for infrastructure graph
│   │   ├── opaGraphService.js    # OPA infrastructure graph data service
│   │   ├── sessionIndexService.js # Per-tenant session index for search/pagination
│   │   ├── databaseService.js    # PostgreSQL connection pool and schema management
│   │   └── tenantConfigService.js # Load/cache tenant configs from database
│   ├── utils/
│   │   ├── validation.js         # Input validation helpers
│   │   ├── errorMessages.js      # Error message constants
│   │   └── paginationHelper.js   # Pagination calculation utilities
│   └── views/
│       ├── layouts/
│       │   └── main.hbs          # Main layout template
│       ├── partials/
│       │   ├── advancedSearchModal.hbs # Advanced search modal popup
│       │   ├── filterBar.hbs     # Search/filter bar with sort controls
│       │   ├── pagination.hbs    # Pagination controls
│       │   └── sessionTable.hbs  # Shared session table component
│       ├── sessions/
│       │   ├── listSsh.hbs       # SSH session list view
│       │   ├── listRdp.hbs       # RDP session list view
│       │   ├── playbackSsh.hbs   # SSH playback player
│       │   └── playbackRdp.hbs   # RDP playback player
│       ├── config.hbs            # Tenant configuration page
│       ├── dashboard.hbs         # Dashboard overview page
│       ├── graph.hbs             # Infrastructure graph visualization
│       └── error.hbs             # Error page template
├── public/
│   ├── css/
│   │   ├── main.css              # Application styles
│   │   ├── config.css            # Configuration page styles
│   │   ├── dashboard.css         # Dashboard page styles
│   │   ├── graph.css             # Infrastructure graph styles
│   │   └── sessions.css          # Session list/playback styles
│   └── js/
│       ├── sessionList.js        # Shared JS for session list pages (search, sort, pagination)
│       ├── configPage.js         # Configuration page JavaScript
│       └── graph.js              # Infrastructure graph JavaScript
├── scripts/
│   ├── aws/                      # AWS deployment scripts
│   │   ├── opaflix-cfn.yaml      # CloudFormation template
│   │   ├── deploy.sh             # Deploy AWS infrastructure
│   │   └── generate-certificates.sh  # Generate certificates for IAM Roles Anywhere
│   └── convert-sessions/         # Session conversion tools
│       ├── convert-sessions.sh   # Bash script for one-time .asa conversion
│       ├── opaflix-sync.py   # Python service for continuous S3 sync
│       ├── opaflix-sync.env.example  # Python service config template
│       ├── opaflix-sync.service  # Systemd service file
│       └── README.md            # Conversion scripts documentation
├── .env                          # Environment variables (gitignored)
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── package.json                  # NPM dependencies & scripts
├── Dockerfile                    # Docker container definition
├── docker-compose.yml            # Docker Compose configuration
├── Makefile                      # Common tasks automation
├── README.md                     # User-facing documentation
├── AWS.md                        # AWS setup guide
├── CHANGELOG.md                  # Project changelog
├── CLAUDE.md                     # This file
└── CLAUDE_PROMPT.md              # Extended AI assistant context
```

## Coding Conventions

### General Principles

1. **Keep it Simple**: Avoid over-engineering. Prefer simple, readable solutions.
2. **Security First**: Always validate inputs, sanitize outputs, and follow security best practices.
3. **Error Handling**: Use try-catch blocks and proper error propagation to middleware.
4. **Logging**: Use the Winston logger for all logging (not console.log).
5. **Configuration**: All config must be in `.env` and validated via `environment.js`.

### Node.js & Express Patterns

- **CommonJS Modules**: Use `require()` and `module.exports` (not ES6 imports)
- **Async/Await**: Prefer async/await over Promise chains or callbacks
- **Middleware Order**: Security → Parsing → Session → Auth → Routes → Error Handlers
- **Route Organization**: Keep routes in separate files, logic in controllers
- **Service Layer**: Business logic and external API calls go in services/

### File Naming

- Use **camelCase** for JavaScript files (e.g., `sessionController.js`)
- Use **kebab-case** for view files (e.g., `list-ssh.hbs` → actually use camelCase for consistency)
- Use **lowercase** for directories (e.g., `controllers/`, `middleware/`)

### Code Style

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes for strings (except JSON)
- **Semicolons**: Required at end of statements
- **Line Length**: Aim for 80-100 characters, max 120
- **Trailing Commas**: Not required but acceptable in arrays/objects
- **Comments**: Write clear, concise comments explaining "why", not "what"

### Environment Variables

All environment variables must be:

1. **Defined in `.env.example`** with placeholder values
2. **Validated in `src/config/environment.js`** using Joi schema
3. **Documented in README.md** and relevant docs

**Mode Selection**:
- `MULTITENANT` - `YES`/`TRUE`/`1` for multi-tenant, `NO`/`FALSE`/`0` for single-tenant (default: `NO`)

**Common Configuration** (Always Required):
- `BASE_URI` - Application URL (e.g., `http://localhost:3000`)
- `SESSION_SECRET` - Session encryption key (min 32 chars)
- `NODE_ENV` - `development` or `production` (default: `development`)
- `PORT` - HTTP port (default: 3000)
- `LOG_LEVEL` - Logging level (default: `info`)

**Single-Tenant Configuration** (Required when `MULTITENANT=NO`):
- `OKTA_ISSUER` - Okta issuer URL
- `OKTA_CLIENT_ID` - Okta client ID
- `OKTA_CLIENT_SECRET` - Okta client secret
- `AWS_ACCESS_KEY_ID` - AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key
- `AWS_REGION` - AWS region
- `AWS_S3_BUCKET` - S3 bucket name
- `AWS_ROLE_ARN` - IAM role to assume for S3 access (optional, recommended)
- `AWS_ROLE_SESSION_NAME` - Session name for CloudTrail (default: `opaflix-session`)
- `AWS_ROLE_DURATION_SECONDS` - Credential lifetime 900-43200 (default: 3600)
- `AWS_ROLE_EXTERNAL_ID` - External ID for cross-account access (optional)
- `OPA_TENANT_URL` - OPA tenant URL (e.g., `demo-blue-sky-1234.pam.okta.com`) (optional)
- `OPA_TEAM_NAME` - Team name within the OPA tenant (optional)
- `OPA_API_KEY_ID` - OPA API key ID for graph/filters (optional)
- `OPA_API_KEY_SECRET` - OPA API key secret (optional)

**Multi-Tenant Database Configuration** (Required when `MULTITENANT=YES`):
- `VERCEL_NEON_PREFIX` - Prefix for Vercel Neon PostgreSQL variables (default: `OPAFLIX`)
- `PGHOST` - PostgreSQL hostname
- `<prefix>_PGHOST` - Fallback PostgreSQL hostname when `PGHOST` is not set
- `PGPORT` - PostgreSQL port (default: 5432)
- `PGDATABASE` - PostgreSQL database name
- `<prefix>_PGDATABASE` - Fallback database name when `PGDATABASE` is not set
- `PGUSER` - PostgreSQL user
- `<prefix>_PGUSER` - Fallback PostgreSQL user when `PGUSER` is not set
- `PGPASSWORD` - PostgreSQL password
- `<prefix>_PGPASSWORD` - Fallback PostgreSQL password when `PGPASSWORD` is not set
- `PGSSLMODE` - SSL mode for connections (default: require)

**Multi-Tenant Cache Configuration** (Optional):
- `CONFIG_CACHE_TTL_MINUTES` - Tenant config cache TTL (default: 5)
- `SESSION_INDEX_REFRESH_MINUTES` - Session index refresh interval (default: 5)

**Tenant Configuration (Multi-Tenant Only)**:
In multi-tenant mode, tenant-specific configuration (Okta, AWS, OPA API) is stored in the database. Use the `/config` page to manage these settings per-tenant, or insert values directly into the `tenant_configs` table.

### AWS Authentication

AWS credentials are configured differently based on deployment mode.

**Authentication Methods:**

Opaflix supports two AWS authentication methods:

1. **Static Access Keys** (Simple): Use access key/secret directly for S3 operations
2. **IAM Roles Anywhere** (Recommended): Use X.509 certificates for authentication without static credentials

**IAM Roles Anywhere Benefits:**
- No static AWS credentials needed (certificate-based authentication)
- Temporary credentials that auto-expire (default: 1 hour)
- Ideal for external deployments (Vercel, Heroku, on-premises)
- Better security posture - no long-lived secrets to manage
- Certificate CN and expiration displayed in config UI for easy management

**Single-Tenant Mode**:
- Static credentials from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` environment variables
- OR IAM Roles Anywhere from `AWS_ROLES_ANYWHERE_*` environment variables
- `AWS_REGION` and `AWS_S3_BUCKET` are always required
- Configuration page shows settings as read-only

**Multi-Tenant Mode**:
- Credentials stored per-tenant in the `tenant_configs` database table
- Configure via the `/config` page with authentication method selector
- Switching methods automatically deletes unused credentials from database
- Certificate details (CN, expiration date) displayed for IAM Roles Anywhere

**IAM Roles Anywhere Flow:**
1. Opaflix signs request with X.509 certificate and private key
2. AWS Roles Anywhere validates certificate against Trust Anchor
3. Temporary credentials are returned and cached in memory
4. Credentials are automatically refreshed 5 minutes before expiry
5. S3 operations use the temporary credentials

When working with AWS credentials:

- Never hardcode credentials in code
- Use environment variables (single-tenant) or the `/config` page (multi-tenant)
- Prefer IAM Roles Anywhere for production external deployments
- Monitor certificate expiration dates shown in the config UI

### Advanced Search Filter Options

Filter dropdowns in the Advanced Search modal are populated from **session data** (not OPA API). This means only servers, users, and projects that have actual session recordings will appear in the dropdowns.

**How It Works:**
1. When the advanced search modal opens, the client fetches `/api/filter-options`
2. Server extracts unique values from the session index (already in memory)
3. Returns sorted lists of servers, users, and projects
4. Dropdowns are populated with this data, cached client-side in sessionStorage (5 min)

**Files Involved:**
- `src/services/sessionIndexService.js` - `getFilterOptions()` extracts unique values
- `src/controllers/apiController.js` - API endpoint handler
- `src/routes/api.js` - API route definitions
- `public/js/sessionList.js` - Client-side dropdown population

### OPA API Integration (Optional)

Opaflix can integrate with the Okta Privileged Access (OPA) API for the **Infrastructure Graph** feature. This is **optional** - if not configured, the graph will not display data.

> **Note**: OPA API is used **only for the Infrastructure Graph**, not for filter dropdowns.

**Single-Tenant Mode**:
- Credentials from `OPA_TENANT_URL`, `OPA_TEAM_NAME`, `OPA_API_KEY_ID`, `OPA_API_KEY_SECRET` environment variables

**Multi-Tenant Mode**:
- Credentials stored per-tenant in the `tenant_configs` database table
- Configure via the `/config` page (OPA API section)

**Required Service User Permissions** (for Infrastructure Graph):

| Capability | Graph Feature |
| ---------- | ------------- |
| `gateways.list` | Gateway nodes |
| `resource_groups.list` | Project grouping |
| `projects.list` | Project nodes |
| `team.servers.list` | Server nodes |

**Files Involved:**
- `src/services/opaApiService.js` - OPA API client with token management
- `src/services/opaGraphService.js` - Graph data fetching and processing

## Security Considerations

### Authentication & Authorization

- **All routes** except `/health` and `/login` require Okta authentication
- Use `requireAuth` middleware from `middleware/authentication.js`
- Never bypass authentication for convenience

### Input Validation

- **Validate all user inputs** using Joi or custom validators in `utils/validation.js`
- **Prevent path traversal**: Use `validateS3Key()` for S3 object keys
- **Sanitize outputs**: Use Handlebars auto-escaping, never use triple-stash `{{{}}}`

### Security Headers

- Helmet.js configured in `middleware/securityHeaders.js`
- CSP policy defined to allow asciinema player and video player
- Modify CSP only if absolutely necessary for new features

### CSP Compliance - No Inline Event Handlers

**IMPORTANT**: The application uses a strict Content Security Policy that blocks inline event handlers.

**DO NOT USE:**
```html
<!-- These will be blocked by CSP -->
<button onclick="doSomething()">Click</button>
<select onchange="handleChange()">...</select>
```

**USE INSTEAD:**
```html
<!-- Use IDs or data attributes -->
<button id="myButton">Click</button>
<select id="mySelect">...</select>
```

```javascript
// Attach event listeners in JavaScript
document.getElementById('myButton').addEventListener('click', doSomething);
document.getElementById('mySelect').addEventListener('change', handleChange);
```

All client-side event handlers must be attached via `addEventListener()` in JavaScript files (e.g., `public/js/sessionList.js`).

### Rate Limiting

- List endpoints: 100 req/min per user
- Playback/download endpoints: 100 req/min per user
- Adjust limits in `middleware/rateLimiter.js` if needed

### Secrets Management

- Use `.env` file for local development
- Use AWS Secrets Manager or similar for production
- Never commit `.env` or any secrets to git
- Rotate credentials regularly

## Testing & Validation

### Before Committing

1. **Run the linter**: `npm run lint`
2. **Test locally**: `npm start` and verify functionality
3. **Check logs**: Ensure no errors in console
4. **Test authentication**: Verify Okta login works
5. **Test S3 access**: Verify session files load correctly

### Manual Testing Checklist

- [ ] Health endpoint responds: `curl http://localhost:3000/health`
- [ ] Login redirects to Okta
- [ ] Dashboard page displays with statistics
- [ ] SSH session list loads with pagination
- [ ] RDP session list loads with pagination
- [ ] Simple search filters sessions
- [ ] Advanced search modal opens and filters work
- [ ] Date range filter works correctly
- [ ] Table column sorting works (click headers)
- [ ] Column resizing works (drag column borders)
- [ ] SSH playback works
- [ ] RDP playback works
- [ ] Logout clears session and redirects to Okta

## Common Tasks

### Adding a New Route

1. Define route in `src/routes/` (e.g., `src/routes/myRoute.js`)
2. Create controller in `src/controllers/` (e.g., `src/controllers/myController.js`)
3. Add authentication middleware if needed
4. Register route in `src/routes/index.js`
5. Update CHANGELOG.md

### Adding a New Environment Variable

1. Add to `.env.example` with description
2. Add Joi validation in `src/config/environment.js`
3. Add to config object returned by `getConfig()`
4. Document in README.md and relevant docs
5. Update CHANGELOG.md

### Adding a New View

1. Create `.hbs` file in `src/views/` (in appropriate subdirectory)
2. Use `main` layout: `{{!< main }}`
3. Pass data from controller using `res.render('viewName', data)`
4. Test rendering with real data
5. Consider using Handlebars helpers for common formatting (substring, year, etc.)

### Working with Handlebars Helpers

Custom Handlebars helpers are configured in `src/app.js`:

- **substring**: Extract substring from text (useful for truncation)
- **year**: Get current year for copyright notices
- **eq**: Equality comparison for conditionals

When adding new helpers:

1. Define the helper function in `src/app.js` during express-handlebars setup
2. Document the helper's purpose and parameters in code comments
3. Update this section with helper name and usage

### Working with Shared Partials

The application uses shared Handlebars partials to reduce code duplication between SSH and RDP session pages.

**Available Partials** (in `src/views/partials/`):

- **filterBar.hbs**: Search box, advanced search button, sort controls
- **sessionTable.hbs**: Session data table with sortable columns
- **pagination.hbs**: Page navigation controls
- **advancedSearchModal.hbs**: Modal popup for advanced filtering

**Using Partials:**
```handlebars
{{!-- Include with root context access --}}
{{> filterBar}}
{{> sessionTable}}
{{> pagination}}
{{> advancedSearchModal}}
```

**Accessing Root Context in Partials:**
Use `@root` to access variables from the main template context:
```handlebars
{{@root.sessionType}}
{{@root.sortField}}
{{@root.advancedFilters.server}}
```

**Required Context Variables for Session List Pages:**
- `sessionType`: 'ssh' or 'rdp'
- `sessions`: Array of session objects
- `pagination`: Pagination object from paginationHelper
- `sortField`: Current sort field
- `sortOrder`: 'asc' or 'desc'
- `searchQuery`: Current search text
- `advancedFilters`: Object with server, username, project, team, dateFrom, dateTo
- `hasActiveFilters`: Boolean indicating if any filters are active

### Building the Infrastructure Graph React Bundle

The infrastructure graph (`/graph`) uses React and ReactFlow, bundled with esbuild.

**Source files**: `src/graph/*.jsx` (React components)
**Output**: `public/js/graph-bundle.js` (minified IIFE bundle)
**Build config**: `esbuild.graph.mjs`

**When to rebuild:**
Run `npm run build:graph` after modifying ANY file in `src/graph/`:
- `InfraGraph.jsx` - Main graph component
- `index.jsx` - Entry point and exports
- `nodes/*.jsx` - Node type components (GatewayNode, ProjectNode, ServerNode, etc.)
- `components/*.jsx` - Shared components (NodePopup, Legend, Icons)

**Build workflow:**
```bash
# 1. Make changes to src/graph/*.jsx files
# 2. Rebuild the bundle
npm run build:graph

# 3. Commit both source AND compiled bundle
git add src/graph/ public/js/graph-bundle.js
git commit -m "feat: description of graph changes"
```

**Important:** The compiled bundle is checked into git. Docker builds copy `public/js/graph-bundle.js` directly - they do NOT compile it. Always commit the rebuilt bundle after changes.

**Watch mode** (for development):
```bash
npm run build:graph -- --watch
```

### Modifying AWS S3 Logic

1. Update `src/services/s3Service.js`
2. Ensure support for all three auth methods (profile, keys, default)
3. Add error handling with meaningful messages
4. Update `AWS.md` documentation if behavior changes
5. Test with different credential configurations

### Adding a New Dependency

1. Install via npm: `npm install package-name`
2. Document purpose in code comments
3. Update README.md if it's a major dependency
4. Verify Docker build still works: `docker build -t opaflix .`

> [!IMPORTANT]
> Always install npm packages from the public registry (`registry.npmjs.org`), never from internal/proprietary registries (e.g. Artifactory, JFrog, or scoped internal mirrors). If a local or global `.npmrc` points `registry` or a scoped registry at an internal host, override it explicitly for this project, e.g.:
> ```bash
> npm install package-name --registry=https://registry.npmjs.org/ --@okta:registry=https://registry.npmjs.org/
> ```
> Verify `package-lock.json` only contains `"resolved"` URLs under `registry.npmjs.org` before committing:
> ```bash
> grep '"resolved"' package-lock.json | grep -v "registry.npmjs.org"
> ```
> This should return no output.

### Converting OPA Session Recordings

Opaflix includes scripts to convert OPA session recordings from `.asa` format to playable formats using the `sft` CLI tool.

**Prerequisites**:

- Install Okta Privileged Access client (`sft`) from [Okta Privileged Access Documentation](https://help.okta.com/oie/en-us/content/topics/privileged-access/tool-setup/install-client.htm)

**Bash Script** (`scripts/convert-sessions/convert-sessions.sh`):

```bash
# Basic usage
./scripts/convert-sessions/convert-sessions.sh

# Custom directories
./scripts/convert-sessions/convert-sessions.sh /var/log/sft/sessions /var/log/sft/sessions-converted
```

**Conversion Commands**:

The script uses `sft session-logs export` for conversions:

```bash
# SSH session conversion (.asa → .cast)
# --output takes full file path
sft session-logs export --format asciinema /path/to/source.asa --output /path/to/output.cast

# RDP session conversion (.asa → .mkv)
# --output takes directory only; output filename will be {source}.asa-N.mkv
sft session-logs export --format mkv --output /path/to/output-dir /path/to/source.asa
```

For detailed usage and automation setup, see [scripts/convert-sessions/README.md](scripts/convert-sessions/README.md).

## Documentation Requirements

### When to Update Documentation

- **README.md**: User-facing changes, new features, setup changes
- **AWS.md**: AWS-related changes, credential handling, S3 configuration
- **CHANGELOG.md**: All notable changes (features, fixes, security)
- **CLAUDE.md**: Project structure changes, new conventions, architectural decisions
- **Code Comments**: Complex logic, non-obvious decisions, security considerations

### Documentation Style

- Use clear, concise language
- Provide examples for complex concepts
- Use proper Markdown formatting
- Include links to external resources when relevant
- Keep TOC updated for long documents

## Error Handling

### HTTP Error Codes

- **200 OK**: Successful request
- **400 Bad Request**: Invalid input/parameters
- **401 Unauthorized**: Not authenticated
- **403 Forbidden**: Authenticated but not authorized
- **404 Not Found**: Resource doesn't exist
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server-side error

### Error Response Format

```javascript
{
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE",
    "details": {} // Optional additional details
  }
}
```

### Logging Errors

```javascript
// Use logger, not console.log
logger.error('Error description', {
  error: err.message,
  stack: err.stack,
  userId: req.user?.id,
  path: req.path,
});
```

## Performance Considerations

### Session Index Service

The `sessionIndexService.js` maintains a per-tenant index of all sessions for fast search and pagination:

- **Database Persistence**: Index stored in `session_indices` table per tenant
- **In-Memory Caching**: Index loaded into memory for fast access
- **On-Demand Staleness**: Triggers background refresh when cache is stale (>5 minutes)
- **Non-Blocking Refresh**: Returns current data immediately while refreshing in background
- **Progress Tracking**: Real-time progress available via `/api/refresh/status` endpoint
- **Search**: Full-text search across server, username, project, team fields
- **Advanced Filtering**: Supports field-specific filters and date range

**Key Functions:**
- `getPagedResults(type, page, pageSize, searchQuery, sortField, sortOrder, advancedFilters, tenantContext)`: Get filtered/paginated results
- `rebuildIndex(tenantContext)`: Force refresh from S3
- `getRefreshStatus(tenantId)`: Get current refresh status and progress
- `getStats(tenantId)`: Get index statistics

### Session Playback via Presigned URLs

Session recordings are served directly from S3 using presigned URLs:

- **SSH sessions** (.cast): URL passed to frontend, fetched via JavaScript
- **RDP sessions** (.mkv): URL used directly as video source
- **URL expiration**: 60 minutes (configurable in `s3Service.js`)
- **Benefits**: Zero server bandwidth, no local caching needed, direct S3 delivery
- **Download button**: Available on playback pages for direct file download

The `getPresignedUrl()` function in `src/services/s3Service.js` generates these URLs.

### S3 Best Practices

- Use presigned URLs for direct client-to-S3 access (no server bandwidth)
- Use S3 Transfer Acceleration if available
- Consider CloudFront CDN for production

### Database Considerations

- PostgreSQL stores tenant configurations and session indices
- Connection pooling handled by `databaseService.js`
- Session indices are cached in-memory and persisted to database
- Tables auto-created on startup if they don't exist
- Tables: `tenants`, `tenant_configs`, `session_indices`

## Deployment

### Docker Profiles

The project uses Docker Compose profiles to separate development and production environments:

- **prod** (default): Production build with optimized image
- **dev**: Development build with source code mounted for live reload

### Production Deployment

```bash
# Using Makefile (recommended)
make start           # Start in background
make start-logs      # Start and follow logs
make stop            # Stop containers
make restart         # Restart containers
make logs            # View logs
make build           # Build image
make rebuild         # Force rebuild from scratch

# Direct docker-compose
docker compose --profile prod up -d
```

### Development with Docker

The dev profile mounts your local source code, allowing you to edit files and see changes without rebuilding:

```bash
# Using Makefile (recommended)
make dev-start       # Start dev containers (source mounted)
make dev-start-logs  # Start and follow logs
make dev-stop        # Stop dev containers
make dev-restart     # Restart dev containers
make dev-logs        # View dev logs
make dev-build       # Build dev image
make dev-rebuild     # Force rebuild dev image

# Direct docker-compose
docker compose --profile dev up -d
```

### Local Development (without Docker)

```bash
make install         # Install dependencies
make dev             # Run with nodemon (auto-reload)
```

### Environment-Specific Config

- **Development**: Use `NODE_ENV=development`, local Okta dev tenant
- **Production**: Use `NODE_ENV=production`, secure cookies, HTTPS only
- **AWS Credentials**: Store access keys securely, use AWS Secrets Manager in production

## Troubleshooting Guide

### Common Issues

1. **"AWS credentials not configured"**
   - Configure AWS credentials via the `/config` page (AWS S3 section)
   - Ensure all required fields are filled: Access Key ID, Secret Access Key, Region, Bucket

2. **"Okta authentication failed"**
   - Verify Okta settings in the database for this tenant
   - Check Okta app redirect URIs match `BASE_URI`

3. **"Cannot access S3 bucket"**
   - Verify bucket exists and credentials have permissions
   - Check bucket region in `/config` matches the actual bucket region

4. **"Session expired"**
   - Re-authenticate with Okta

## Changelog Management

### When Making Changes

1. Add entry under `[Unreleased]` section in `CHANGELOG.md`
2. Use appropriate category: Added, Changed, Deprecated, Removed, Fixed, Security
3. Write clear, user-facing descriptions
4. Link to issues/PRs if applicable

### Before Releasing

1. Move `[Unreleased]` changes to new version section
2. Add release date
3. Follow semantic versioning (MAJOR.MINOR.PATCH)
4. Create git tag: `git tag -a v1.2.3 -m "Release v1.2.3"`

## Contact & Resources

### External Documentation

- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [Okta OIDC Middleware](https://github.com/okta/okta-oidc-js/tree/master/packages/oidc-middleware)
- [AWS S3 SDK v3 Docs](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [Winston Logger](https://github.com/winstonjs/winston)
- [Helmet.js Security](https://helmetjs.github.io/)
- [Handlebars Templates](https://handlebarsjs.com/)

### Project Resources

- **Main README**: [README.md](README.md) - Getting started guide
- **AWS Setup**: [AWS.md](AWS.md) - Comprehensive AWS configuration guide
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) - Version history

### README Style

To emphatize important information in the README, use formatting such as:

> [!NOTE]  
> Highlights information that users should take into account, even when skimming.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]  
> Crucial information necessary for users to succeed.

> [!WARNING]  
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]
> Negative potential consequences of an action.

---

**Last Updated**: 2026-10-06

This document should be kept up-to-date as the project evolves. When making significant architectural changes, update this file accordingly.

## Keeping CLAUDE.md Updated

When making changes to the project, update this file if any of the following occur:

1. **Project Structure Changes**: New directories, files, or reorganization
2. **New Features**: Major functionality additions (update Key Features section)
3. **Architectural Decisions**: New patterns, conventions, or design choices
4. **Documentation Changes**: New docs added or existing docs restructured
5. **Technology Stack Changes**: New major dependencies or framework changes
6. **Coding Convention Updates**: New standards or best practices adopted

Always update the "Last Updated" date and version reference when making changes to this file.

## Git commits
When making changes, auto create commits, following these guidelines:
- Use clear, descriptive commit messages
- Reference relevant issues or PRs in the commit message
- Use semantic commit message format (e.g., `feat: add new feature`, `fix : resolve bug`, `docs: update documentation`)
- Avoid committing large, unrelated changes in a single commit

## Versioning

The application version in `package.json` is used for cache busting of static assets (CSS/JS files). Follow these guidelines:

- **Increment the PATCH version** (e.g., `1.0.0` → `1.0.1`) with every commit that modifies code
- **Increment the MINOR version** (e.g., `1.0.1` → `1.1.0`) for new features or significant changes
- **Propose incrementing the MAJOR version** (e.g., `1.1.0` → `2.0.0`) for breaking changes or major architectural overhauls

This ensures browsers always fetch fresh static assets after deployments.
