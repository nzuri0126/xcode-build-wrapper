#!/usr/bin/env node

/**
 * xcode-build.js - Graceful Xcode build wrapper with error handling
 * 
 * Usage:
 *   node xcode-build.js --project <path> --scheme <name> [options]
 * 
 * Examples:
 *   node xcode-build.js --project /path/to/Yumami --scheme Yumami
 *   node xcode-build.js --project /path/to/Yumami --scheme Yumami --command test --device "iPhone 16 Pro"
 *   node xcode-build.js --project /path/to/Yumami --scheme Yumami --command archive --archive-path /tmp/Yumami.xcarchive
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const wantsHelp = args.includes('--help') || args.includes('-h');

const ALLOWED_COMMANDS = new Set(['build', 'test', 'archive', 'clean']);
const command = (getArg('--command') || 'build').toLowerCase();
const usesSimulatorDestination = (cmd) => cmd === 'build' || cmd === 'test';

const projectPath = getArg('--project');
const scheme = getArg('--scheme');
const deviceName = getArg('--device') || 'iPhone 16 Pro';
const logFile = getArg('--log') || '/tmp/xcode-build.log';
const quiet = args.includes('--quiet');

const archivePathArg = getArg('--archive-path');

const defaultTimeout = command === 'test' ? 600 : 300;
const timeoutArg = getArg('--timeout');
const timeout = Number.parseInt(timeoutArg ?? String(defaultTimeout), 10);

const printUsage = (stream = process.stdout) => {
  stream.write(
`Xcode Build Wrapper

Usage:
  node xcode-build.js --project <path-to-project-dir> --scheme <scheme-name> [options]

Options:
  --command <build|test|archive|clean>  Xcodebuild operation (default: build)
  --device <name>                      Simulator device (build/test only, default: iPhone 16 Pro)
  --timeout <seconds>                   Timeout in seconds (default: 300; test default: 600)
  --archive-path <path>                 Required for --command archive (path to .xcarchive)
  --log <log-file-path>                 Log file path (default: /tmp/xcode-build.log)
  --quiet                              Minimal output (for automation)
  -h, --help                           Show this help text

Examples:
  node xcode-build.js --project /path/to/App --scheme App
  node xcode-build.js --project /path/to/App --scheme App --command test
  node xcode-build.js --project /path/to/App --scheme App --command archive --archive-path /tmp/App.xcarchive
  node xcode-build.js --project /path/to/App --scheme App --command clean
`
  );
};

if (wantsHelp) {
  printUsage(process.stdout);
  process.exit(0);
}

if (!projectPath || !scheme) {
  console.error('❌ Missing required arguments: --project and --scheme are required.\n');
  printUsage(process.stderr);
  process.exit(1);
}

if (!ALLOWED_COMMANDS.has(command)) {
  console.error(`❌ Invalid --command "${command}". Allowed: build, test, archive, clean.\n`);
  printUsage(process.stderr);
  process.exit(1);
}

if (!Number.isFinite(timeout) || timeout <= 0) {
  console.error(`❌ Invalid --timeout "${timeoutArg}". Must be a positive integer.\n`);
  printUsage(process.stderr);
  process.exit(1);
}

if (command === 'archive' && !archivePathArg) {
  console.error('❌ --archive-path is required when --command archive is used.\n');
  printUsage(process.stderr);
  process.exit(1);
}

// Find workspace or project file
let buildTarget = '';
const workspaceFile = fs.readdirSync(projectPath).find(f => f.endsWith('.xcworkspace'));
const projectFile = fs.readdirSync(projectPath).find(f => f.endsWith('.xcodeproj'));

if (workspaceFile) {
  buildTarget = `-workspace "${workspaceFile}"`;
} else if (projectFile) {
  buildTarget = `-project "${projectFile}"`;
} else {
  console.error('❌ No .xcworkspace or .xcodeproj found in', projectPath);
  process.exit(1);
}

let archivePath = null;
if (command === 'archive') {
  archivePath = path.resolve(projectPath, archivePathArg);
}

if (!quiet) {
  console.log('🔨 Xcode Build Wrapper');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📂 Project: ${projectPath}`);
  console.log(`📱 Scheme: ${scheme}`);
  console.log(`🧰 Command: ${command}`);
  if (usesSimulatorDestination(command)) {
    console.log(`📲 Device: ${deviceName}`);
  }
  if (command === 'archive') {
    console.log(`📦 Archive: ${archivePath}`);
  }
  console.log(`⏱️  Timeout: ${timeout}s`);
  console.log(`📝 Log: ${logFile}`);
  console.log('');
}

// Verify device exists
if (usesSimulatorDestination(command)) {
  try {
    const devices = execSync('xcrun simctl list devices available', { encoding: 'utf8' });
    if (!devices.includes(deviceName)) {
      console.error(`❌ Device "${deviceName}" not found in available simulators`);
      console.error('\nAvailable devices:');
      console.error(devices);
      process.exit(1);
    }
    if (!quiet) console.log(`✅ Device "${deviceName}" found`);
  } catch (err) {
    console.error('❌ Failed to list devices:', err.message);
    process.exit(1);
  }
}

const commandVerb =
  command === 'test' ? 'Testing' :
  command === 'archive' ? 'Archiving' :
  command === 'clean' ? 'Cleaning' :
  'Building';

const buildCmdParts = [
  'xcodebuild',
  buildTarget,
  `-scheme "${scheme}"`,
  ...(usesSimulatorDestination(command)
    ? [`-destination "platform=iOS Simulator,name=${deviceName}"`]
    : []),
  '-skipMacroValidation',
  ...(command === 'archive'
    ? [`-archivePath "${archivePath}"`, 'archive']
    : [command])
];

const buildCmd = buildCmdParts.join(' ');

if (!quiet) {
  console.log(`\n🚀 Starting ${command}...`);
  console.log(`   ${buildCmd.substring(0, 80)}...`);
  console.log('');
}

// Spawn build process
const startTime = Date.now();
const logStream = fs.createWriteStream(logFile);
const build = spawn('sh', ['-c', buildCmd], {
  cwd: projectPath,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true // Create process group for clean kill
});

let timedOut = false;
let lastOutput = Date.now();

// Timeout handler
const timeoutHandle = setTimeout(() => {
  timedOut = true;
  try {
    if (build.pid) {
      process.kill(-build.pid, 'SIGKILL'); // Kill process group
    }
  } catch (err) {
    build.kill('SIGKILL');
  }
}, timeout * 1000);

// Progress indicator
const progressInterval = quiet ? null : setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  process.stdout.write(`\r⏳ ${commandVerb}... ${elapsed}s elapsed`);
}, 1000);

// Capture output
build.stdout.on('data', (data) => {
  logStream.write(data);
  lastOutput = Date.now();
});

build.stderr.on('data', (data) => {
  logStream.write(data);
  lastOutput = Date.now();
});

// Cleanup helper
const cleanup = (code) => {
  clearTimeout(timeoutHandle);
  if (progressInterval) clearInterval(progressInterval);
  
  // Kill entire process tree FIRST
  try {
    if (build.pid) {
      process.kill(-build.pid, 'SIGKILL'); // Kill entire process group
    }
  } catch (err) {
    // Process might already be dead
  }
  
  // Close log stream (but don't wait for it)
  try {
    logStream.end();
  } catch (err) {
    // Ignore log stream errors
  }
  
  // Force exit immediately after a brief delay (don't wait for stream)
  setTimeout(() => {
    process.exit(code);
  }, 100);
};

// Handle completion
build.on('close', (code) => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (!quiet) console.log(`\r                                        `); // Clear progress line

  const commandLabel = command.toUpperCase();

  if (timedOut) {
    console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`❌ ${commandLabel} TIMED OUT (${timeout}s)`);
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`📝 Full log: ${logFile}`);
    cleanup(124); // Standard timeout exit code
  } else if (code === 0) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${commandLabel} SUCCESSFUL (${elapsed}s)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📝 Full log: ${logFile}`);
    cleanup(0);
  } else {
    console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`❌ ${commandLabel} FAILED (exit code ${code})`);
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Try to extract error from log
    try {
      const logContent = fs.readFileSync(logFile, 'utf8');
      const errorMatch = logContent.match(/error:.*$/m);
      if (errorMatch) {
        console.error(`\n🔍 Error: ${errorMatch[0]}`);
      }

      // Check for common issues
      if (logContent.includes('Unable to find a device')) {
        console.error('\n💡 Tip: Device not found. List available devices with:');
        console.error('   xcrun simctl list devices');
      }
    } catch (err) {
      // Ignore log read errors
    }

    console.error(`\n📝 Full log: ${logFile}`);
    cleanup(code);
  }
});

// Handle script termination
process.on('SIGINT', () => {
  console.log(`\n\n🛑 ${command.toUpperCase()} cancelled by user`);
  cleanup(130);
});

process.on('SIGTERM', () => {
  console.log(`\n\n🛑 ${command.toUpperCase()} terminated`);
  cleanup(143);
});
