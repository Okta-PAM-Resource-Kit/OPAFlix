#!/bin/bash
#
# OPA Session Recording Converter
#
# This script converts Okta Privileged Access (OPA) session recordings from
# .asa format to playable formats:
#   - RDP sessions -> .mkv (video)
#   - SSH sessions -> .cast (asciinema)
#
# Usage: ./convert-sessions.sh [source_dir] [dest_dir] [timeout_seconds]
#

set -euo pipefail

# Configuration
SOURCE_DIR="${1:-/var/log/sft/sessions}"
DEST_DIR="${2:-/var/log/sft/sessions-converted}"
TIMEOUT=${3:-3600}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    local msg="${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    echo -e "$msg"
}

log_warn() {
    local msg="${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    echo -e "$msg"
}

log_error() {
    local msg="${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    echo -e "$msg"
}

# Check if conversion tools are available
check_dependencies() {
    # Check for sft tool
    if ! command -v sft &> /dev/null; then
        log_error "sft command not found. Please install Okta Privileged Access client."
        log_error "Install from: https://help.okta.com/oie/en-us/content/topics/privileged-access/tool-setup/install-client.htm"
        exit 1
    fi
}

# Create destination directory structure
setup_directories() {
    log_info "Setting up directory structure..."

    mkdir -p "$DEST_DIR"

    if [[ ! -w "$DEST_DIR" ]]; then
        log_error "Destination directory $DEST_DIR is not writable"
        exit 1
    fi

    log_info "Directories created: $DEST_DIR"
}

# Convert RDP session from .asa to .mkv
convert_rdp_session() {
    local source_file="$1"
    local filename=$(basename "$source_file" .asa)
    local dest_file="$DEST_DIR/${filename}.mkv"

    # Check if already converted
    if [[ -f "$dest_file" ]]; then
        log_warn "✓ Already converted (skipping)"
        return 0
    fi

    # Run with systemd resource limits, timeout, and unbuffered output
    if nice -n 19 timeout $TIMEOUT stdbuf -oL -eL sft session-logs export --insecure --format mkv --output "$DEST_DIR" "$source_file" 2>&1 | while IFS= read -r line; do
        echo "$line"
    done; then
        log_info "✓ Successfully converted to: $dest_file"
        return 0
    else
        local exit_code=${PIPESTATUS[0]}
        if [[ $exit_code -eq 124 ]]; then
            log_error "✗ Conversion timed out after $TIMEOUT seconds"
        else
            log_error "✗ Conversion failed with exit code: $exit_code"
        fi
        return 1
    fi
}

# Convert SSH session from .asa to .cast
convert_ssh_session() {
    local source_file="$1"
    local filename=$(basename "$source_file" .asa)
    local dest_file="$DEST_DIR/${filename}.cast"

    # Check if already converted
    if [[ -f "$dest_file" ]]; then
        log_warn "✓ Already converted (skipping)"
        return 0
    fi

    # Run with systemd resource limits, timeout, and unbuffered output
    if nice -n 19 timeout $TIMEOUT stdbuf -oL -eL sft session-logs export --insecure --format asciinema --output "$dest_file" "$source_file" 2>&1 | while IFS= read -r line; do
        echo "$line"
    done; then
        log_info "✓ Successfully converted to: $dest_file"
        return 0
    else
        local exit_code=${PIPESTATUS[0]}
        if [[ $exit_code -eq 124 ]]; then
            log_error "✗ Conversion timed out after $TIMEOUT seconds"
        else
            log_error "✗ Conversion failed with exit code: $exit_code"
        fi
        return 1
    fi
}

# Process all session files
process_sessions() {
    local total_files=0
    local rdp_success=0
    local ssh_success=0
    local rdp_failed=0
    local ssh_failed=0

    log_info "Starting session conversion from: $SOURCE_DIR"

    # Check if source directory exists
    if [[ ! -d "$SOURCE_DIR" ]]; then
        log_error "Source directory does not exist: $SOURCE_DIR"
        exit 1
    fi

    # Find all .asa files
    log_info "Searching for .asa files..."

    # Count total files first
    local file_count=$(find "$SOURCE_DIR" -maxdepth 1 -name "*.asa" -type f | wc -l | tr -d ' ')
    log_info "Found $file_count .asa files to process"

    if [[ $file_count -eq 0 ]]; then
        log_warn "No .asa files found in $SOURCE_DIR"
        return
    fi

    log_info "Starting conversion..."

    # Sort: SSH files first (lighter), then RDP (heavier); within each type by mtime
    mapfile -t sorted_files < <(
        ls -t "$SOURCE_DIR"/ssh~*.asa 2>/dev/null
        ls -t "$SOURCE_DIR"/rdp~*.asa 2>/dev/null
    )

    # Process all .asa files using a for loop
    for file in "${sorted_files[@]}"; do
        # Check if glob matched anything
        if [[ ! -f "$file" ]]; then
            log_warn "No .asa files found (glob didn't match)"
            break
        fi

        total_files=$((total_files + 1))

        local filename=$(basename "$file")

        log_info "[$total_files/$file_count] Processing: $filename"

        if [[ "$filename" == rdp~* ]]; then
            if convert_rdp_session "$file"; then
                rdp_success=$((rdp_success + 1))
            else
                rdp_failed=$((rdp_failed + 1))
            fi
        elif [[ "$filename" == ssh~* ]]; then
            if convert_ssh_session "$file"; then
                ssh_success=$((ssh_success + 1))
            else
                ssh_failed=$((ssh_failed + 1))
            fi
        else
            log_warn "Unknown session type: $filename (skipping)"
        fi

    done

    log_info "Finished processing loop"
    log_info "Total files counter: $total_files"

    # Print summary
    log_info "========================================="
    log_info "Conversion Summary:"
    log_info "  Total files processed: $total_files"

    if [[ $total_files -eq 0 ]]; then
        log_warn "No .asa files found in $SOURCE_DIR"
        log_info "Expected file pattern: {rdp,ssh}~<timestamp>~...~.asa"
    else
        log_info "  RDP conversions: $rdp_success successful, $rdp_failed failed"
        log_info "  SSH conversions: $ssh_success successful, $ssh_failed failed"
    fi

    log_info "  Output directory: $DEST_DIR"
    log_info "========================================="
}

# Main execution
main() {
    # Ensure log directory exists

    log_info "OPA Session Recording Converter Started"
    log_info "Source: $SOURCE_DIR"
    log_info "Destination: $DEST_DIR"

    check_dependencies
    setup_directories
    process_sessions

    log_info "Conversion process completed"
}

# Run main function
main "$@"
