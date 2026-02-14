#!/usr/bin/env node

/**
 * xcode-build.js - Graceful Xcode build wrapper with error handling
 * 
 * Usage:
 *   node xcode-build.js --project <path> --scheme <name> [--device <name>] [--timeout <seconds>]
 * 
 * Example:
 *   node xcode-build.js --project /path/to/Yumami --scheme Yumami --device "iPhone 16 Pro"
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

const projectPath = getArg('--project');
const scheme = getArg('--scheme');
const deviceName = getArg('--device') || 'iPhone 16 Pro';
const timeout = parseInt(getArg('--timeout') || '300'); // Default 5 minutes
const logFile = getArg('--log') || '/tmp/xcode-build.log';
const quiet = args.includes('--quiet');

if (!projectPath || !scheme) {
  console.error('Usage: node xcode-build.js --project <path> --scheme <name> [--device <name>] [--timeout <seconds>]');
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

if (!quiet) {
  console.log('🔨 Xcode Build Wrapper');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📂 Project: ${projectPath}`);
  console.log(`📱 Scheme: ${scheme}`);
  console.log(`📲 Device: ${deviceName}`);
  console.log(`⏱️  Timeout: ${timeout}s`);
  console.log(`📝 Log: ${logFile}`);
  console.log('');
}

// Verify device exists
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

// Build command (skip clean to avoid file duplication issues)
const buildCmd = `xcodebuild ${buildTarget} -scheme "${scheme}" -destination "platform=iOS Simulator,name=${deviceName}" -skipMacroValidation build`;

if (!quiet) {
  console.log('\n🚀 Starting build...');
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
  process.stdout.write(`\r⏳ Building... ${elapsed}s elapsed`);
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
  
  if (timedOut) {
    console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`❌ BUILD TIMED OUT (${timeout}s)`);
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`📝 Full log: ${logFile}`);
    cleanup(124); // Standard timeout exit code
  } else if (code === 0) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ BUILD SUCCESSFUL (${elapsed}s)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📝 Full log: ${logFile}`);
    cleanup(0);
  } else {
    console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.error(`❌ BUILD FAILED (exit code ${code})`);
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
  console.log('\n\n🛑 Build cancelled by user');
  cleanup(130);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Build terminated');
  cleanup(143);
});
