#!/usr/bin/env python3
"""
OPA Session Sync Service

Monitors a directory for new OPA session recordings (.asa files),
converts them to playable formats (.cast/.mkv), and uploads to S3.

This is a continuous service designed to run as a daemon (e.g., via systemd).
It uses filesystem events (via watchdog) for instant detection of new files.

Usage:
    # Run directly (foreground) - uses environment variables
    python3 opaflix-sync.py

    # Run with custom .env file
    python3 opaflix-sync.py --env-file /path/to/config.env

    # Run as systemd service (see opaflix-sync.service)
    sudo systemctl start opaflix-sync

Configuration is via environment variables (see opaflix-sync.env.example).
Use --env-file to load configuration from a .env file.
"""

import os
import sys
import time
import signal
import logging
import argparse
import subprocess
import queue
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Set
from collections import OrderedDict

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    print("ERROR: boto3 is required. Install with: pip install boto3")
    sys.exit(1)

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("ERROR: watchdog is required. Install with: pip install watchdog")
    sys.exit(1)


class AsaFileHandler(FileSystemEventHandler):
    """
    Watchdog event handler for .asa file creation.

    When a new .asa file is created in the watched directory,
    it queues the file for processing by the main service.
    """

    def __init__(self, file_queue: queue.Queue, logger: logging.Logger):
        """
        Initialize the file handler.

        Args:
            file_queue: Thread-safe queue for passing files to main thread
            logger: Logger instance for logging events
        """
        super().__init__()
        self.file_queue = file_queue
        self.logger = logger
        self.queued_files: Set[str] = set()  # Prevent duplicate events

    def on_created(self, event):
        """Handle file creation events."""
        if event.is_directory:
            return

        file_path = Path(event.src_path)
        if file_path.suffix.lower() == '.asa':
            # Prevent duplicate queueing (watchdog may fire multiple events)
            file_key = str(file_path)
            if file_key in self.queued_files:
                return
            self.queued_files.add(file_key)
            self.logger.debug(f"Detected new file: {file_path.name}")
            self.file_queue.put(file_path)

    def mark_processed(self, file_path: Path):
        """Remove a file from the queued set after processing."""
        self.queued_files.discard(str(file_path))


class OPASessionSync:
    """
    Opaflix Sync
    Continuous service for syncing OPA session recordings to S3.

    Features:
    - Filesystem event monitoring via watchdog for instant file detection
    - Conversion to .cast (SSH) or .mkv (RDP) formats
    - S3 upload with duplicate detection
    - Configurable cleanup of old source files
    - Graceful shutdown handling
    """

    def __init__(self):
        """Initialize the service with configuration from environment variables."""
        # Directory configuration
        self.source_dir = Path(os.getenv('OPA_SOURCE_DIR', '/var/log/sft/sessions'))
        self.temp_dir = Path(os.getenv('OPA_TEMP_DIR', '/tmp/sessions-temp'))

        # Processing options
        self.conversion_timeout = int(os.getenv('OPA_CONVERSION_TIMEOUT', '3600'))
        self.delete_after_days = int(os.getenv('OPA_DELETE_AFTER_DAYS', '0'))
        self.delete_after_upload = os.getenv('OPA_DELETE_AFTER_UPLOAD', 'false').lower() in ('true', '1', 'yes')

        # Watchdog configuration
        self.file_settle_delay = float(os.getenv('OPA_FILE_SETTLE_DELAY', '5.0'))
        self.cleanup_interval = int(os.getenv('OPA_CLEANUP_INTERVAL', '86400'))

        # AWS configuration
        self.bucket = os.getenv('AWS_S3_BUCKET')
        self.s3_prefix = os.getenv('AWS_S3_PREFIX', '').strip('/')
        self.aws_region = os.getenv('AWS_REGION', 'us-east-1')

        # Source file upload configuration
        self.upload_source_file = os.getenv('OPA_UPLOAD_SOURCE_FILE', 'false').lower() in ('true', '1', 'yes')
        self.s3_source_prefix = os.getenv('AWS_S3_SOURCE_PREFIX', '').strip('/')

        # Logging configuration
        log_level = os.getenv('OPA_LOG_LEVEL', 'INFO').upper()
        log_file = os.getenv('OPA_LOG_FILE')

        self._setup_logging(log_level, log_file)

        # Validate required configuration
        self._validate_config()

        # Initialize S3 client
        self.s3 = self._create_s3_client()

        # State management
        self.running = True
        # Bounded LRU cache for S3 file existence (prevents unbounded memory growth)
        self.s3_files_cache: OrderedDict = OrderedDict()
        self.s3_cache_max_size = int(os.getenv('OPA_S3_CACHE_MAX_SIZE', '50000'))

        # File queue for watchdog events
        self.file_queue: queue.Queue = queue.Queue()

        # Statistics
        self.stats = {
            'files_processed': 0,
            'files_uploaded': 0,
            'files_skipped': 0,
            'files_failed': 0,
            'start_time': datetime.now()
        }

        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._shutdown_handler)
        signal.signal(signal.SIGINT, self._shutdown_handler)

    def _setup_logging(self, log_level: str, log_file: Optional[str]):
        """Configure logging with console and optional file output."""
        self.logger = logging.getLogger('opaflix-sync')
        self.logger.setLevel(getattr(logging, log_level, logging.INFO))

        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG)
        console_format = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(console_format)
        self.logger.addHandler(console_handler)

        # File handler (optional)
        if log_file:
            try:
                log_path = Path(log_file)
                log_path.parent.mkdir(parents=True, exist_ok=True)
                file_handler = logging.FileHandler(log_file)
                file_handler.setLevel(logging.DEBUG)
                file_handler.setFormatter(console_format)
                self.logger.addHandler(file_handler)
            except Exception as e:
                self.logger.warning(f"Could not set up file logging: {e}")

    def _validate_config(self):
        """Validate required configuration is present."""
        errors = []

        if not self.bucket:
            errors.append("AWS_S3_BUCKET is required")

        if errors:
            for error in errors:
                self.logger.error(error)
            sys.exit(1)

        # Validate source directory exists
        if not self.source_dir.exists():
            self.logger.warning(f"Source directory does not exist: {self.source_dir}")

    def _create_s3_client(self):
        """Create S3 client using boto3's default credential chain.

        Credential sources (in order of precedence):
        1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
        2. Shared credential file (~/.aws/credentials)
        3. EC2 instance metadata (IAM instance profile)
        """
        try:
            return boto3.client('s3', region_name=self.aws_region)
        except NoCredentialsError:
            self.logger.error("AWS credentials not found")
            sys.exit(1)

    def _shutdown_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        sig_name = signal.Signals(signum).name
        self.logger.info(f"Received {sig_name}, shutting down gracefully...")
        self.running = False

    def _format_size(self, size_bytes: int) -> str:
        """Format file size in human-readable format."""
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

    def _add_to_s3_cache(self, filename: str):
        """Add filename to bounded S3 cache, evicting oldest if full."""
        if filename in self.s3_files_cache:
            # Move to end (most recently used)
            self.s3_files_cache.move_to_end(filename)
        else:
            self.s3_files_cache[filename] = True
            # Evict oldest entries if cache is full
            while len(self.s3_files_cache) > self.s3_cache_max_size:
                self.s3_files_cache.popitem(last=False)

    def load_s3_file_list(self):
        """
        Load list of existing files from S3 into bounded memory cache.
        Called at startup to avoid redundant conversions.
        Uses LRU eviction to prevent unbounded memory growth.
        """
        self.logger.info("Loading existing files from S3...")
        self.s3_files_cache.clear()

        try:
            paginator = self.s3.get_paginator('list_objects_v2')
            params = {'Bucket': self.bucket}
            if self.s3_prefix:
                params['Prefix'] = self.s3_prefix

            total_files = 0
            for page in paginator.paginate(**params):
                if 'Contents' in page:
                    for obj in page['Contents']:
                        # Store just the filename (without prefix)
                        key = obj['Key']
                        if self.s3_prefix and key.startswith(self.s3_prefix + '/'):
                            filename = key[len(self.s3_prefix) + 1:]
                        else:
                            filename = key
                        total_files += 1
                        self._add_to_s3_cache(filename)

            self.logger.info(f"Found {total_files} existing files in S3, cached {len(self.s3_files_cache)}")
            if len(self.s3_files_cache) >= self.s3_cache_max_size:
                self.logger.warning(
                    f"S3 cache at max size ({self.s3_cache_max_size}), "
                    f"some older files not cached - duplicates may be re-processed"
                )
        except ClientError as e:
            self.logger.error(f"Failed to list S3 files: {e}")
            # Continue without cache - will fall back to individual checks

    def s3_file_exists(self, filename: str) -> bool:
        """Check if a filename exists in the S3 cache."""
        if filename in self.s3_files_cache:
            # Move to end (most recently used)
            self.s3_files_cache.move_to_end(filename)
            return True
        return False

    def s3_pattern_exists(self, pattern: str) -> Optional[str]:
        """
        Check if any file matching a glob pattern exists in the S3 cache.

        Args:
            pattern: Glob pattern (e.g., "stem.asa*.mkv")

        Returns:
            The matching filename if found, None otherwise
        """
        import fnmatch
        for filename in self.s3_files_cache:
            if fnmatch.fnmatch(filename, pattern):
                # Move to end (most recently used)
                self.s3_files_cache.move_to_end(filename)
                return filename
        return None

    def s3_key_exists(self, key: str) -> bool:
        """
        Check if a key already exists in S3 (direct API call).

        Args:
            key: The S3 object key to check

        Returns:
            True if the key exists, False otherwise
        """
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            self.logger.error(f"Error checking S3 key {key}: {e}")
            raise

    def upload_to_s3(self, local_path: Path, s3_key: str) -> bool:
        """
        Upload a file to S3.

        Args:
            local_path: Path to the local file
            s3_key: Destination S3 key

        Returns:
            True if upload succeeded, False otherwise
        """
        try:
            file_size = self._format_size(local_path.stat().st_size)
            self.logger.info(f"Uploading to s3://{self.bucket}/{s3_key} [{file_size}]")
            self.s3.upload_file(str(local_path), self.bucket, s3_key)
            return True
        except ClientError as e:
            self.logger.error(f"Failed to upload {local_path} to S3: {e}")
            return False

    def get_s3_key(self, filename: str) -> str:
        """
        Generate the S3 key for a converted file.

        Args:
            filename: The converted filename (e.g., "ssh~...~.cast")

        Returns:
            The S3 object key (with optional prefix)
        """
        if self.s3_prefix:
            return f"{self.s3_prefix}/{filename}"
        return filename

    def get_source_s3_key(self, filename: str) -> str:
        """
        Generate the S3 key for a source .asa file.

        Args:
            filename: The source filename (e.g., "ssh~...~.asa")

        Returns:
            The S3 object key (with optional source prefix)
        """
        if self.s3_source_prefix:
            return f"{self.s3_source_prefix}/{filename}"
        return filename

    def convert_session(self, source_file: Path) -> Optional[Path]:
        """
        Convert a single .asa file to playable format.

        Args:
            source_file: Path to the .asa file

        Returns:
            Path to the converted file, or None if conversion failed
        """
        filename = source_file.name
        stem = source_file.stem  # filename without .asa extension
        source_size = source_file.stat().st_size

        # Determine session type and output format
        if filename.startswith('rdp~'):
            output_format = 'mkv'
            output_ext = '.mkv'
        elif filename.startswith('ssh~'):
            output_format = 'asciinema'
            output_ext = '.cast'
        else:
            self.logger.warning(f"Unknown session type: {filename}")
            return None

        # Create temp directory if needed
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        # Determine output path
        output_file = self.temp_dir / f"{stem}{output_ext}"

        # Build conversion command (run at low priority with nice)
        # Note: sft command syntax differs between formats:
        #   SSH: --output takes full file path -> outputs exact filename
        #   RDP: --output takes directory only -> outputs as {original}.asa-N.mkv
        if output_format == 'mkv':
            cmd = [
                'nice', '-n', '19',
                'sft', 'session-logs', 'export',
                '--insecure',
                '--format', 'mkv',
                '--output', str(self.temp_dir),  # directory only
                str(source_file)
            ]
        else:
            cmd = [
                'nice', '-n', '19',
                'sft', 'session-logs', 'export',
                '--insecure',
                '--format', 'asciinema',
                str(source_file),
                '--output', str(output_file)  # full file path
            ]

        self.logger.debug(f"Running: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.conversion_timeout
            )

            # Log sft output in debug mode
            if result.stdout:
                self.logger.debug(f"sft stdout: {result.stdout.strip()}")
            if result.stderr:
                self.logger.debug(f"sft stderr: {result.stderr.strip()}")

            if result.returncode != 0:
                self.logger.error(f"Conversion failed for {filename} (exit code {result.returncode})")
                return None

            # Verify output file exists
            if not output_file.exists():
                # For MKV files, sft outputs with .asa-N.mkv suffix (e.g., file.asa-0.mkv)
                if output_format == 'mkv':
                    pattern = f"{stem}.asa*.mkv"
                    matches = list(self.temp_dir.glob(pattern))
                    if matches:
                        output_file = matches[0]
                        self.logger.debug(f"Found MKV output: {output_file.name}")
                    else:
                        self.logger.error(f"Conversion completed but output file not found")
                        self.logger.debug(f"Searched for pattern: {pattern} in {self.temp_dir}")
                        return None
                else:
                    self.logger.error(f"Conversion completed but output file not found: {output_file}")
                    return None

            source_size_fmt = self._format_size(source_size)
            output_size_fmt = self._format_size(output_file.stat().st_size)
            self.logger.info(f"Successfully converted: {filename} [{source_size_fmt}] -> {output_file.name} [{output_size_fmt}]")
            return output_file

        except subprocess.TimeoutExpired:
            self.logger.error(f"Conversion timed out after {self.conversion_timeout}s: {filename}")
            return None
        except FileNotFoundError:
            self.logger.error("sft command not found. Please install Okta ASA CLI.")
            return None
        except Exception as e:
            self.logger.error(f"Conversion error for {filename}: {e}")
            return None

    def process_file(self, asa_file: Path) -> bool:
        """
        Process a single .asa file: check S3, convert, upload.

        Args:
            asa_file: Path to the .asa file

        Returns:
            True if processing succeeded (or skipped), False if failed
        """
        filename = asa_file.name
        stem = asa_file.stem

        # Determine session type and check S3 cache BEFORE conversion
        if filename.startswith('rdp~'):
            session_type = 'rdp'
            # RDP outputs as {stem}.asa-N.mkv - check pattern in cache
            pattern = f"{stem}.asa*.mkv"
            existing = self.s3_pattern_exists(pattern)
            if existing:
                self.logger.debug(f"Already in S3, skipping: {existing}")
                self.stats['files_skipped'] += 1
                return True
        elif filename.startswith('ssh~'):
            session_type = 'ssh'
            # SSH outputs exact filename {stem}.cast
            output_filename = f"{stem}.cast"
            if self.s3_file_exists(output_filename):
                self.logger.debug(f"Already in S3, skipping: {output_filename}")
                self.stats['files_skipped'] += 1
                return True
        else:
            self.logger.warning(f"Skipping unknown file type: {filename}")
            return True

        # Convert the file
        file_size = self._format_size(asa_file.stat().st_size)
        self.logger.info(f"Processing: {filename} [{file_size}]")
        converted_file = self.convert_session(asa_file)

        if not converted_file:
            self.stats['files_failed'] += 1
            return False

        # Generate S3 key from actual converted filename
        s3_key = self.get_s3_key(converted_file.name)

        # Upload to S3
        if not self.upload_to_s3(converted_file, s3_key):
            self.stats['files_failed'] += 1
            # Keep temp file for manual inspection
            return False

        self.stats['files_uploaded'] += 1

        # Add to S3 cache so we don't process this file again
        self._add_to_s3_cache(converted_file.name)

        # Optionally upload source .asa file for archival
        if self.upload_source_file:
            source_s3_key = self.get_source_s3_key(filename)
            if self.upload_to_s3(asa_file, source_s3_key):
                self.logger.info(f"Source file archived: {filename}")
            else:
                self.logger.warning(f"Failed to archive source file: {filename}")

        # Clean up temp file
        try:
            converted_file.unlink()
            self.logger.debug(f"Removed temp file: {converted_file}")
        except Exception as e:
            self.logger.warning(f"Could not remove temp file {converted_file}: {e}")

        # Optionally delete source file after successful upload
        if self.delete_after_upload:
            try:
                asa_file.unlink()
                self.logger.info(f"Deleted source file: {filename}")
            except Exception as e:
                self.logger.warning(f"Could not delete source file {filename}: {e}")

        return True

    def cleanup_old_files(self):
        """Delete source files older than configured number of days, only if uploaded to S3."""
        if self.delete_after_days <= 0:
            return

        if not self.source_dir.exists():
            return

        cutoff_date = datetime.now() - timedelta(days=self.delete_after_days)

        # First pass: count old files without S3 lookup
        old_files = []
        for asa_file in self.source_dir.glob('*.asa'):
            try:
                mtime = datetime.fromtimestamp(asa_file.stat().st_mtime)
                if mtime < cutoff_date:
                    old_files.append(asa_file)
            except Exception as e:
                self.logger.warning(f"Could not check file age for {asa_file}: {e}")

        if not old_files:
            self.logger.debug("No old files to clean up")
            return

        # Only refresh S3 cache if we actually have files to delete
        self.logger.info(f"Found {len(old_files)} files older than {self.delete_after_days} days, refreshing S3 cache...")
        self.load_s3_file_list()

        deleted_count = 0
        skipped_count = 0

        for asa_file in old_files:
            try:
                mtime = datetime.fromtimestamp(asa_file.stat().st_mtime)
                filename = asa_file.name
                stem = asa_file.stem

                # Check if file has been uploaded to S3 before deleting
                in_s3 = False
                if filename.startswith('ssh~'):
                    in_s3 = self.s3_file_exists(f"{stem}.cast")
                elif filename.startswith('rdp~'):
                    in_s3 = self.s3_pattern_exists(f"{stem}.asa*.mkv") is not None

                if in_s3:
                    asa_file.unlink()
                    deleted_count += 1
                    self.logger.info(f"Deleted old file: {filename} (modified {mtime})")
                else:
                    skipped_count += 1
                    self.logger.debug(f"Skipping old file not in S3: {filename}")
            except Exception as e:
                self.logger.warning(f"Could not process old file {asa_file}: {e}")

        if deleted_count > 0:
            self.logger.info(f"Cleaned up {deleted_count} old files")
        if skipped_count > 0:
            self.logger.warning(f"Skipped {skipped_count} old files not yet in S3")

    def scan_directory(self) -> List[Path]:
        """
        Scan source directory for .asa files.

        Returns:
            List of .asa file paths, sorted by modification time (oldest first)
        """
        if not self.source_dir.exists():
            return []

        asa_files = list(self.source_dir.glob('*.asa'))

        # Sort: SSH files first (lighter), then RDP (heavier); within each type newest first
        asa_files.sort(key=lambda f: (f.name.startswith('rdp~'), -f.stat().st_mtime))

        return asa_files

    def log_stats(self):
        """Log current statistics."""
        uptime = datetime.now() - self.stats['start_time']
        self.logger.info(
            f"Stats: processed={self.stats['files_processed']}, "
            f"uploaded={self.stats['files_uploaded']}, "
            f"skipped={self.stats['files_skipped']}, "
            f"failed={self.stats['files_failed']}, "
            f"uptime={uptime}"
        )

    def _run_watchdog_loop(self):
        """Run the main watchdog event loop."""
        self.logger.info("Starting watchdog observer...")

        # Create event handler
        handler = AsaFileHandler(self.file_queue, self.logger)

        # Create and start observer
        observer = Observer()
        observer.schedule(handler, str(self.source_dir), recursive=False)
        observer.start()

        self.logger.info(f"Watching directory: {self.source_dir}")

        files_since_last_stats = 0
        last_cleanup = datetime.now()

        try:
            while self.running:
                try:
                    # Wait for a file with timeout (allows checking running flag)
                    file_path = self.file_queue.get(timeout=5.0)

                    # Small delay to let file finish writing
                    if self.file_settle_delay > 0:
                        time.sleep(self.file_settle_delay)

                    # Process the file
                    if file_path.exists():
                        self.process_file(file_path)
                        self.stats['files_processed'] += 1
                        files_since_last_stats += 1

                    # Clean up queued_files tracking to prevent memory growth
                    handler.mark_processed(file_path)

                    # Log stats periodically (every 10 files)
                    if files_since_last_stats >= 10:
                        self.log_stats()
                        files_since_last_stats = 0

                except queue.Empty:
                    # No file in queue, continue waiting
                    pass

                # Periodic cleanup
                if (datetime.now() - last_cleanup).total_seconds() >= self.cleanup_interval:
                    self.cleanup_old_files()
                    last_cleanup = datetime.now()

        finally:
            self.logger.info("Stopping watchdog observer...")
            observer.stop()
            observer.join(timeout=5.0)

    def run(self):
        """Main service entry point."""
        self.logger.info("=" * 60)
        self.logger.info("OPA Session Sync Service Starting")
        self.logger.info("=" * 60)
        self.logger.info(f"Source directory: {self.source_dir}")
        self.logger.info(f"Temp directory: {self.temp_dir}")
        self.logger.info(f"S3 bucket: {self.bucket}")
        self.logger.info(f"S3 prefix: {self.s3_prefix or '(none)'}")
        self.logger.info(f"Conversion timeout: {self.conversion_timeout}s")
        self.logger.info(f"Delete after days: {self.delete_after_days or 'disabled'}")
        self.logger.info(f"Delete after upload: {self.delete_after_upload}")
        self.logger.info(f"Upload source files: {self.upload_source_file}")
        if self.upload_source_file:
            self.logger.info(f"Source file prefix: {self.s3_source_prefix or '(root)'}")
        self.logger.info(f"File settle delay: {self.file_settle_delay}s")
        self.logger.info(f"Cleanup interval: {self.cleanup_interval}s")
        self.logger.info(f"S3 cache max size: {self.s3_cache_max_size}")

        if os.getenv('AWS_ACCESS_KEY_ID'):
            self.logger.info("AWS Auth: Using environment credentials")
        else:
            self.logger.info("AWS Auth: Using EC2 instance profile (default credential chain)")
        self.logger.info("=" * 60)

        # Verify sft is available
        try:
            result = subprocess.run(['sft', 'version'], capture_output=True, text=True)
            self.logger.info(f"sft CLI: {result.stdout.strip()}")
        except FileNotFoundError:
            self.logger.error("sft command not found. Please install Okta Privileged Access client.")
            self.logger.error("See: https://help.okta.com/oie/en-us/content/topics/privileged-access/tool-setup/install-client.htm")
            sys.exit(1)

        # Load existing S3 files to skip already-uploaded sessions
        self.load_s3_file_list()

        # Initial scan: process existing files before watching
        self.logger.info("Performing initial scan for existing files...")
        try:
            asa_files = self.scan_directory()
            if asa_files:
                self.logger.info(f"Found {len(asa_files)} existing .asa files to process (files already in S3 will be skipped)")
                for asa_file in asa_files:
                    if not self.running:
                        break
                    self.process_file(asa_file)
                    self.stats['files_processed'] += 1
            else:
                self.logger.info("No existing files found")
        except Exception as e:
            self.logger.error(f"Error during initial scan: {e}", exc_info=True)

        # Run watchdog event loop
        try:
            self._run_watchdog_loop()
        except Exception as e:
            self.logger.error(f"Fatal error in main loop: {e}", exc_info=True)

        # Final stats on shutdown
        self.logger.info("=" * 60)
        self.logger.info("OPA Session Sync Service Shutting Down")
        self.log_stats()
        self.logger.info("=" * 60)


def load_env_file(env_file_path):
    """
    Load environment variables from .env file.

    Supports:
    - KEY=VALUE format
    - Comments (lines starting with #)
    - Empty lines
    - Quoted values (single and double quotes)
    - Values with spaces when quoted

    Args:
        env_file_path: Path to .env file

    Raises:
        SystemExit: If .env file doesn't exist or cannot be read
    """
    try:
        with open(env_file_path, 'r') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()

                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue

                # Parse KEY=VALUE
                if '=' not in line:
                    print(f"Warning: Invalid line {line_num} in {env_file_path}: {line}", file=sys.stderr)
                    continue

                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()

                # Remove quotes if present
                if (value.startswith('"') and value.endswith('"')) or \
                   (value.startswith("'") and value.endswith("'")):
                    value = value[1:-1]

                os.environ[key] = value

        print(f"Loaded configuration from: {env_file_path}", file=sys.stderr)

    except FileNotFoundError:
        print(f"ERROR: .env file not found: {env_file_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to load .env file: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    """Entry point for the service."""
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description='OPA Session Sync Service - Monitors and uploads OPA session recordings to S3'
    )
    parser.add_argument(
        '--env-file',
        help='Path to .env configuration file (loads before service starts)'
    )
    args = parser.parse_args()

    # Load .env file if specified (before creating service instance)
    if args.env_file:
        load_env_file(args.env_file)

    # Create and run service
    service = OPASessionSync()
    service.run()


if __name__ == '__main__':
    main()
