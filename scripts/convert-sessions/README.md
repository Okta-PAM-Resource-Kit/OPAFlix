# OPA Session Recording Conversion Script

This document describes the scripts in `scripts/convert-sessions/` for converting and syncing Okta Privileged Access (OPA) session recordings from the proprietary `.asa` format to standard playback formats.

> [!WARNING]
> **The conversion scripts are provided as-is and serve as examples.** You can customize them or build versions that better fit your specific requirements, directory structure, and automation needs.

> [!IMPORTANT]
> **RDP Conversion Resource Requirements**: The RDP transcoder is CPU and memory intensive. Ensure your system has at least **4GB RAM** (8GB recommended) for reliable RDP session conversion. See [Resource Requirements](#resource-requirements) for details.

## Table of Contents

1. [Supported Conversions](#supported-conversions)
2. [Prerequisites](#prerequisites)
3. [Resource Requirements](#resource-requirements)
4. [One-Time Conversion Script](#one-time-conversion-script) (`convert-sessions.sh`)
5. [Continuous Sync Service](#continuous-sync-service) (`opaflix-sync.py`)
   - [Usage](#usage)
   - [Running with Custom .env File](#running-with-custom-env-file)
   - [Continuously Run with Systemd](#continuously-run-with-systemd)

---

## Supported Conversions

- **SSH Sessions** (`.asa`) → **Asciinema** (`.cast`)
- **RDP Sessions** (`.asa`) → **Video** (`.mkv`)

## Prerequisites

### 1. Okta Privileged Access Client (`sft`)

The `sft` command-line tool is required for converting session recordings:

- **Installation**: [Okta Privileged Access CLI Documentation](https://help.okta.com/oie/en-us/content/topics/privileged-access/tool-setup/install-client.htm)
- **Purpose**: Converts session recordings from `.asa` format to standard playback formats
- **Verify installation**: `sft version`

### 2. RDP Transcoder (for RDP sessions)

RDP session conversion to `.mkv` requires the RDP Transcoder to be installed:

- **Documentation**: [RDP Transcoder Installation](https://help.okta.com/oie/en-us/content/topics/privileged-access/gateways/pam-rdp-transcoder.htm)
- **Purpose**: Decodes RDP session data into video format

Both tools must be installed on the OPA Gateway or on any server running the conversion script.

## Resource Requirements

### RDP Conversion (Heavy Workload)

The RDP transcoder is **CPU and memory intensive**. Converting RDP sessions involves decoding graphics data and encoding it as video, which requires significant system resources.

| Resource | Minimum | Recommended | Notes |
| -------- | ------ | ---------- | ---- |
| **Memory** | 4 GB | 8 GB | Large RDP sessions may require more |
| **CPU** | 2 cores | 4+ cores | Multi-core improves conversion speed |
| **Disk I/O** | Standard | SSD | Faster disk speeds up processing |

### SSH Conversion (Light Workload)

SSH session conversion is lightweight — it primarily involves text parsing and format conversion with minimal CPU and memory overhead.

### Production Deployment Recommendation

> [!WARNING]
> **For production environments, consider running the conversion process on a dedicated server separate from the OPA Gateway.**

Running conversions on the Gateway server can impact:
- **Gateway Performance** — CPU/memory contention during heavy conversions
- **Session Latency** — User connections may experience delays
- **System Stability** — Memory pressure from large RDP sessions

**Recommended Architecture:**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OPA Gateway   │────▶│ Conversion Host │────▶│    AWS S3       │
│ (session files) │ NFS │ (sft + scripts) │     │ (final storage) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

Options for separating the conversion workload:

1. **NFS/Shared Storage** — Mount Gateway's session directory on conversion host
2. **rsync/SCP** — Periodically copy files to conversion host
3. **S3 Staging** — Upload raw `.asa` files to S3, convert from there

## Conversion Commands

The `sft session-logs export` command handles conversion for both RDP and SSH sessions:

```bash
# SSH session conversion (.asa → .cast)
sft session-logs export --insecure --format asciinema /path/to/source.asa --output /path/to/output.cast

# RDP session conversion (.asa → .mkv)
sft session-logs export --insecure --format mkv --output /path/to/output.mkv /path/to/source.asa
```

### About the `--insecure` Flag

The `--insecure` flag skips signature verification during conversion. This simplifies the conversion process by:

- Not requiring an active OPA session
- Not requiring valid OPA credentials on the conversion server
- Allowing offline/batch processing

**Security Note**: Only use `--insecure` in trusted environments where the source `.asa` files are known to be authentic (e.g., files directly from your OPA Gateway).

---

## One-Time Conversion Script

### Bash Script (`scripts/convert-sessions/convert-sessions.sh`)

Simple, straightforward bash script. It will bulk convert all `.asa` files in the source directory to `.cast` (SSH) or `.mkv` (RDP) in the destination directory.

#### Usage

```bash
# Basic usage (default directories)
./scripts/convert-sessions/convert-sessions.sh

# Custom directories
./scripts/convert-sessions/convert-sessions.sh /path/to/source /path/to/destination

# Example
./scripts/convert-sessions/convert-sessions.sh /var/log/sft/sessions /var/log/sft/sessions-converted
```

#### Features

- Simple and easy to read
- Colored console output
- Logging to `/var/log/sft/conversion.log`
- Skips already converted files
- Detailed conversion summary
- Uses official `sft` CLI tool for reliable conversions

## Input File Format

The script expects OPA session files with this naming pattern (configured via Gateway `LogFileNameFormats`):

```
{protocol}~{timestamp}~{teamName}~{projectName}~{serverName}~{username}~{sessionId}.asa
```

### Examples

**SSH Session:**
```
ssh~20260313T110949.8162~demo-pam-fg~internet_facing_servers~opa-gateway~fabio.grasso~-1-69b3f07c-700dcad375027b8061babae4.asa
```

**RDP Session:**
```
rdp~20251028T195805.3323~demo-pam-fg~ad_servers~EC2AMAZ-58L9ASR~fabio.grasso~-1-6901204b-52e4eda710b03bf1280a0033.asa
```

See the main [README.md](../README.md#opa-gateway-configuration) for Gateway configuration details.

### Logging

#### Console Output

The script provides real-time progress with:

- Timestamp
- Log level (INFO, WARN, ERROR)
- Action description
- Color coding for easy reading

#### Log File

Detailed logs are written to: `conversion.log`

### Error Handling

The script:

- Skips already converted files (by default)
- Logs errors but continues processing
- Provides summary of successes and failures
- Exits with non-zero code if any conversion fails

### Integration with OpaFlix

After conversion, upload the converted files to your S3 bucket:

```bash
# Sync converted files to S3 (flat structure at bucket root)
aws s3 sync /var/log/sft/sessions-converted/ s3://your-bucket/ --include "*.cast"
aws s3 sync /var/log/sft/sessions-converted/ s3://your-bucket/ --include "*.mkv"
```

Or with subdirectories preserved:

```bash
aws s3 sync /var/log/sft/sessions-converted/ s3://your-bucket/sessions/ \
  --exclude "*.asa" \
  --include "*.mkv" \
  --include "*.cast"
```

---

## Continuous Sync Service

### Python Service (`scripts/convert-sessions/opaflix-sync.py`)

A continuous service that monitors a directory for new OPA session recordings, converts them to playable formats, and uploads them to S3. Unlike the one-time bash script, this service runs continuously as a daemon.

### Features

- **Instant File Detection**: Uses watchdog filesystem events for immediate processing of new files
- **S3 Integration**: Uploads converted files directly to S3 via boto3
- **Duplicate Detection**: Skips files already present in S3
- **Sequential Processing**: Processes one file at a time for stability
- **Configurable Cleanup**: Optionally deletes old source files
- **Graceful Shutdown**: Handles SIGTERM/SIGINT for clean service stops
- **Comprehensive Logging**: Detailed logs with configurable verbosity
- **Systemd Integration**: Ready-to-use service file included

### Prerequisites

In addition to the [common prerequisites](#prerequisites), the sync service requires:

- **Python 3.6+**
- **boto3**: AWS SDK for Python
- **watchdog**: Filesystem event monitoring library

```bash
# Install required packages
pip install boto3 watchdog

# Or with pip3
pip3 install boto3 watchdog
```

### Configuration

The service is configured via environment variables. Copy the example file and edit as needed:

```bash
# Copy example configuration
sudo mkdir -p /etc/opaflix
sudo cp scripts/convert-sessions/opaflix-sync.env.example /etc/opaflix/opaflix-sync.env
sudo chmod 600 /etc/opaflix/opaflix-sync.env

# Edit configuration
sudo nano /etc/opaflix/opaflix-sync.env
```

#### Required Settings

| Variable | Description | Example |
| -------- | ---------- | ------ |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_S3_BUCKET` | S3 bucket name | `my-opaflix-bucket` |

#### Optional Settings

| Variable | Default | Description |
| -------- | ------ | ---------- |
| `OPA_SOURCE_DIR` | `/var/log/sft/sessions` | Directory containing `.asa` files |
| `OPA_TEMP_DIR` | `/var/log/sft/sessions-temp` | Temp directory for conversions |
| `OPA_CONVERSION_TIMEOUT` | `3600` | Max seconds per conversion |
| `OPA_DELETE_AFTER_DAYS` | `0` | Delete source files older than N days (0=disabled) |
| `OPA_DELETE_AFTER_UPLOAD` | `false` | Delete source file after successful upload |
| `OPA_FILE_SETTLE_DELAY` | `1.0` | Seconds to wait before processing new file (allows writes to complete) |
| `OPA_CLEANUP_INTERVAL` | `60` | Seconds between cleanup checks for old files |
| `OPA_LOG_LEVEL` | `INFO` | Log verbosity: DEBUG, INFO, WARNING, ERROR |
| `OPA_LOG_FILE` | (none) | Optional log file path |
| `AWS_S3_PREFIX` | (none) | Optional S3 key prefix for uploads |
| `AWS_ACCESS_KEY_ID` | (none) | AWS access key (optional if using instance profile) |
| `AWS_SECRET_ACCESS_KEY` | (none) | AWS secret key (optional if using instance profile) |

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are only required if not using an EC2 instance profile with appropriate permissions.

### Usage

#### Running with Custom .env File

The recommended approach for testing and development is to use the `--env-file` argument:

```bash
# Run with a custom .env file
python3 scripts/convert-sessions/opaflix-sync.py --env-file /path/to/config.env

# Example: Use the example file as a template
cp scripts/convert-sessions/opaflix-sync.env.example my-config.env
# Edit my-config.env with your settings
python3 scripts/convert-sessions/opaflix-sync.py --env-file my-config.env
```

This is useful for:
- Testing different configurations
- Running one-off conversions with specific settings
- Managing multiple deployment configurations

#### Alternative Methods for Loading .env Files

If you prefer not to use `--env-file`, you can load environment variables using shell methods:

```bash
# Method 1: Source the .env file (bash-specific)
source /path/to/config.env
python3 scripts/convert-sessions/opaflix-sync.py

# Method 2: Use env command (POSIX-compatible)
env $(cat /path/to/config.env | grep -v '^#' | xargs) python3 scripts/convert-sessions/opaflix-sync.py

# Method 3: Export variables manually
export AWS_S3_BUCKET=my-bucket
export AWS_REGION=us-east-1
python3 scripts/convert-sessions/opaflix-sync.py
```

### Running Manually (Foreground)

For testing or debugging with environment variables:

```bash
# Set environment variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_REGION=us-east-1
export AWS_S3_BUCKET=your-bucket
export OPA_SOURCE_DIR=/var/log/sft/sessions
export OPA_TEMP_DIR=/var/log/sft/sessions-temp
export OPA_LOG_LEVEL=DEBUG

# Run the service
python3 scripts/convert-sessions/opaflix-sync.py
```

Press `Ctrl+C` to stop gracefully.

### Continuously Run with Systemd

This section provides a comprehensive guide for deploying the OPA Session Sync service in production using systemd.

#### Prerequisites

Before starting, ensure you have:

- Linux system with systemd (RHEL/CentOS 7+, Ubuntu 16.04+, Debian 8+)
- Python 3.6 or later
- boto3 package: `pip3 install boto3`
- Okta ASA CLI (`sft`) installed and in PATH
- AWS credentials (IAM instance profile or static keys)
- Access to the OPA session recording directory

##### Step 1: Copy Files to Installation Directory

```bash
# Create installation directory
sudo mkdir -p /opt/opaflix/

# Download files to installation directory
sudo curl -o /opt/opaflix/opaflix-sync.py https://raw.githubusercontent.com/fabiograsso/okta-opaflix/main/scripts/convert-sessions/opaflix-sync.py
sudo curl -o /opt/opaflix/opaflix-sync.env https://raw.githubusercontent.com/fabiograsso/okta-opaflix/main/scripts/convert-sessions/opaflix-sync.env.example
sudo curl -o /opt/opaflix/opaflix-sync.service https://raw.githubusercontent.com/fabiograsso/okta-opaflix/main/scripts/convert-sessions/opaflix-sync.service 

# Set ownership and permissions
sudo chown -R root:root /opt/opaflix
sudo chmod -R 700 /opt/opaflix
sudo chmod +x /opt/opaflix/opaflix-sync.py
```

> [!NOTE]
> The `sft-gatewayd` process run as `root` on the OPA Gateway, so the sync service must also run as root to access the session files. Ensure proper permissions and security measures are in place.

##### Step 2: Configure the Service

Edit the configuration file:

```bash
# Edit configuration with your settings
sudo nano /etc/opaflix/opaflix-sync.env
# Or
sudo vi /etc/opaflix/opaflix-sync.env
```

**Minimum required settings**:

```bash
# /etc/opaflix/opaflix-sync.env
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-opaflix-bucket

# If NOT using EC2 instance profile, add credentials:
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
```

##### Step 3: Install Systemd Service

Copy and enable the service file:

```bash
# Link the service file to systemd
sudo ln -s /opt/opaflix/opaflix-sync.service /etc/systemd/system/opaflix-sync.service

# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable opaflix-sync

# Start the service
sudo systemctl start opaflix-sync
```

##### Step 4: Verify Installation

Check that everything is working:

```bash
# Check service status
sudo systemctl status opaflix-sync

# View recent logs
sudo journalctl -u opaflix-sync -n 50

# Follow logs in real-time
sudo journalctl -u opaflix-sync -f
```

Expected output on successful start:

```
============================================================
OPA Session Sync Service Starting
============================================================
Source directory: /var/log/sft/sessions
Temp directory: /var/log/sft/sessions-temp
S3 bucket: your-opaflix-bucket
...
============================================================
```

##### Service File Reference

The `opaflix-sync.service` file contains:

| Directive | Purpose |
| --------- | ------ |
| `ExecStart` | Runs the Python script |
| `EnvironmentFile` | Loads configuration from `/etc/opaflix/opaflix-sync.env` |
| `Restart=on-failure` | Auto-restarts on crash |
| `RestartSec=30` | Waits 30 seconds before restart |

##### Managing the Service

Common service management commands:

```bash
# Start the service
sudo systemctl start opaflix-sync

# Stop the service
sudo systemctl stop opaflix-sync

# Restart the service (after config changes)
sudo systemctl restart opaflix-sync

# Check service status
sudo systemctl status opaflix-sync

# Disable auto-start on boot
sudo systemctl disable opaflix-sync

# Enable auto-start on boot
sudo systemctl enable opaflix-sync
```

### Monitoring

#### View Logs

```bash
# Follow logs in real-time
sudo journalctl -u opaflix-sync -f

# View recent logs
sudo journalctl -u opaflix-sync --since "1 hour ago"

# View logs with full output
sudo journalctl -u opaflix-sync -n 100 --no-pager
```

#### Service Statistics

The service logs statistics every 10 files processed:

```
Stats: processed=42, uploaded=38, skipped=4, failed=0, uptime=0:45:23
```

- **processed**: Total files checked this session
- **uploaded**: Files successfully converted and uploaded
- **skipped**: Files already present in S3
- **failed**: Files that failed conversion or upload

## Support

For issues related to:
- **Opaflix application**: See main [README.md](../README.md)
- **AWS S3 setup**: See [AWS.md](../../docs/AWS.md)
- **Conversion scripts**: Open an issue on GitHub

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

- [Okta Privileged Access Gateway Documentation](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-gateway-overview.htm)
- [Configure PAM Gateway](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-gateway-configure.htm)
- [Session Capture Overview](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-session-capture.htm)
- [Enable Session Capture](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-enable-session-capture.htm)
- [RDP Transcoder](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-rdp-transcoder.htm)
- [View Session Logs](https://help.okta.com/en-us/content/topics/privileged-access/gateways/pam-gateway-view-session-logs.htm)
- [Okta Privileged Access CLI Documentation](https://help.okta.com/en-us/content/topics/privileged-access/tool-setup/install-client.htm)
- [AWS S3 Documentation](https://aws.amazon.com/s3/)
- [boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
- [watchdog Documentation](https://python-watchdog.readthedocs.io/en/latest/)
- [systemd Documentation](https://www.freedesktop.org/wiki/Software/systemd/)

---

**Last Updated**: 2026-03-30
