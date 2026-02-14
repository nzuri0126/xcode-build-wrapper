# Xcode Build Wrapper

Graceful Xcode build wrapper with proper error handling, timeouts, and status reporting.

## Why This Exists

- **Prevents gateway hangs** - Explicit timeouts and error handling
- **Clear error reporting** - Extracts and displays build errors
- **Progress tracking** - Shows elapsed time during builds
- **Graceful failures** - Always exits cleanly (never hangs)

## Usage

```bash
node xcode-build.js \
  --project <path-to-project-dir> \
  --scheme <scheme-name> \
  [--command <build|test|archive|clean>] \
  [--device "Device Name"] \
  [--timeout <seconds>] \
  [--archive-path <path>] \
  [--log <log-file-path>] \
  [--quiet]
```

Notes:
- `--command` defaults to `build`
- Default timeout is `300s` (default timeout is `600s` for `--command test`)
- `--archive-path` is required when `--command archive` is used
- `--device` is only used for `--command build` and `--command test`

## Examples

```bash
# Build Yumami for iPhone 16 Pro
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --device "iPhone 16 Pro"

# Run tests (default timeout is 600s unless --timeout is provided)
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --command test \
  --device "iPhone 16 Pro"

# Archive (requires --archive-path)
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --command archive \
  --archive-path /tmp/Yumami.xcarchive

# Clean
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --command clean

# Build with custom timeout (10 minutes)
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --device "iPhone 16 Pro" \
  --timeout 600

# Build with custom log location
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --log /tmp/my-build.log

# Quiet mode (minimal output, for automation)
node xcode-build.js \
  --project /Users/nzuri/code/yumami \
  --scheme Yumami \
  --quiet
```

## Exit Codes

- `0` - Command successful
- `1` - Invalid arguments or setup error
- `65` - Command failed (Xcode error)
- `124` - Timeout
- `130` - Cancelled by user (Ctrl+C)
- `143` - Terminated by signal

## Features

✅ **Timeout protection** - Never hangs (default 5 min; test default 10 min)
✅ **Device validation** - Checks device exists before build/test
✅ **Progress indicator** - Shows elapsed time  
✅ **Error extraction** - Pulls key errors from build log  
✅ **Signal handling** - Graceful cleanup on Ctrl+C  
✅ **Log streaming** - Full build log saved to file

## Integration with OpenClaw

**Important:** Always set the OpenClaw exec timeout slightly longer than the wrapper timeout to prevent exec-level hangs.

```javascript
// In HEARTBEAT.md or autonomous workflows:
exec({
  command: `node /Users/nzuri/.openclaw/workspace/tools/xcode-wrapper/xcode-build.js \\
    --project /Users/nzuri/code/yumami \\
    --scheme Yumami \\
    --device "iPhone 16 Pro" \\
    --timeout 300 \\
    --quiet`,  // Minimal output for automation
  timeout: 310  // CRITICAL: exec timeout > wrapper timeout (prevents gateway hang)
})

// Always check exit code:
if (result.exitCode === 0) {
  console.log("✅ Build successful!");
} else if (result.exitCode === 124) {
  console.error("❌ Build timed out");
} else {
  console.error(`❌ Build failed with code ${result.exitCode}`);
}
```

**Why this prevents hangs:**
1. Wrapper timeout kills xcodebuild after 300s
2. Wrapper cleanup exits within 100ms
3. OpenClaw exec timeout (310s) is longer, so wrapper finishes cleanly
4. No orphaned processes or stream hangs

## Troubleshooting

**Device not found:**
```bash
# List available devices
xcrun simctl list devices

# Create missing device
xcrun simctl create "iPhone 16 Pro" \
  "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro" \
  "com.apple.CoreSimulator.SimRuntime.iOS-26-2"
```

**Build timing out:**
- Increase timeout with `--timeout 600` (10 minutes)
- Check log file for stuck dependency resolution
- Try `--command clean` first

**Gateway still hanging:**
- Check that you're using the wrapper (not raw xcodebuild)
- Verify timeout is set on both wrapper AND exec call
- Check error-learn for patterns: `error-learn query "xcodebuild"`
