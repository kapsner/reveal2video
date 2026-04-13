#!/usr/bin/env node

/**
 * reveal2mp4 - Convert Reveal.js slideshow with audio to MP4
 *
 * Usage: ./reveal2mp4.js <html-file> [output.mp4]
 */

const puppeteer = require('puppeteer');
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
const help = argv.includes('--help') || argv.includes('-h');
const noSandbox = argv.includes('--no-sandbox');
const disableSetuidSandbox = argv.includes('--disable-setuid-sandbox');

// Find browser/concurrency flags
let concurrency = 2;
let browserPath = null;

const jIdx = argv.findIndex(arg => arg === '-j' || arg === '--concurrency');
if (jIdx !== -1 && argv[jIdx + 1]) {
  const val = parseInt(argv[jIdx + 1]);
  if (!isNaN(val)) concurrency = val;
}

const bIdx = argv.findIndex(arg => arg === '--browser' || arg === '--chrome-path');
if (bIdx !== -1 && argv[bIdx + 1]) {
  browserPath = argv[bIdx + 1];
}

// Filter out flags and their values from arguments
const args = argv.filter((arg, i) => {
  if (arg.startsWith('--') || arg.startsWith('-')) return false;
  if (i > 0 && (argv[i-1] === '-j' || argv[i-1] === '--concurrency' || argv[i-1] === '--browser' || argv[i-1] === '--chrome-path')) return false;
  return true;
});

if (args.length < 1 || help) {
  console.log('Reveal.js to MP4 Converter');
  console.log('Usage: reveal2mp4 [options] <html-file> [output.mp4]');
  console.log('\nOptions:');
  console.log('  -j, --concurrency <n>    Number of parallel encoding jobs (default: 2)');
  console.log('  --browser <path>         Path to Chromium/Chrome executable');
  console.log('  --no-sandbox             Disable Puppeteer sandbox (use with caution)');
  console.log('  --disable-setuid-sandbox Disable Puppeteer setuid sandbox (use with caution)');
  console.log('\nRequirements:');
  console.log('  - Node.js, Puppeteer');
  console.log('  - FFmpeg and FFprobe installed in PATH');
  process.exit(0);
}

function findChrome() {
  const platform = os.platform();
  const paths = {
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    win32: [
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ]
  };

  const possiblePaths = paths[platform] || [];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const activeProcesses = new Set();

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${cmd} ${args.join(' ')}\n${result.stderr}`);
  }
  return result.stdout;
}

function asyncRunCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    activeProcesses.add(child);
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      activeProcesses.delete(child);
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${cmd} ${args.join(' ')}\n${stderr}`));
      } else {
        resolve();
      }
    });
    child.on('error', (err) => {
      activeProcesses.delete(child);
      reject(err);
    });
  });
}

const htmlFile = path.resolve(args[0]);
if (!fs.existsSync(htmlFile)) {
    console.error(`Error: File not found: ${htmlFile}`);
    process.exit(1);
}

const outputFile = args[1] || htmlFile.replace(/\.html$/, '.mp4');
if (path.resolve(outputFile) === htmlFile) {
    console.error('Error: Output file must be different from input file.');
    process.exit(1);
}

async function getAudioDuration(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    // Try standard duration first
    let d = runCommand('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
    ]).trim();

    // If N/A, read last packet timestamp (common for browser-recorded webm)
    if (d === 'N/A' || d === '') {
        const out = runCommand('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'packet=pts_time',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);
        const lines = out.trim().split('\n');
        d = lines[lines.length - 1];
    }
    const val = parseFloat(d);
    return isNaN(val) ? null : val;
  } catch (e) {
    return null;
  }
}

async function run() {
  const startTime = Date.now();
  let browser;
  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reveal2mp4-'));
    console.log(`>>> Using temporary directory: ${tmpDir}`);

    console.log('>>> Initializing Browser...');
    const puppeteerArgs = [];
    if (noSandbox) puppeteerArgs.push('--no-sandbox');
    if (disableSetuidSandbox) puppeteerArgs.push('--disable-setuid-sandbox');

    const launchOptions = {
      headless: "new",
      args: puppeteerArgs
    };

    if (browserPath) {
      launchOptions.executablePath = browserPath;
    } else {
      const found = findChrome();
      if (found) {
        console.log(`>>> Automatically detected browser: ${found}`);
        launchOptions.executablePath = found;
      }
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 2560, height: 1440 });

    console.log(`>>> Loading Slideshow: ${htmlFile}...`);
    await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle2' });

    // Wait for Reveal to be ready
    await page.waitForFunction('typeof Reveal !== "undefined" && Reveal.isReady()', { timeout: 10000 });

    // Inject CSS to disable transitions and animations for instant rendering
    await page.addStyleTag({
      content: `
        * {
          -webkit-transition: none !important;
          -moz-transition: none !important;
          -ms-transition: none !important;
          -o-transition: none !important;
          transition: none !important;
          -webkit-animation: none !important;
          -moz-animation: none !important;
          -ms-animation: none !important;
          -o-animation: none !important;
          animation: none !important;
        }
        .reveal .audio-controls {
          display: none !important;
        }
      `
    });

    // Get Audio Config from Reveal
    const audioConfig = await page.evaluate(`(() => {
      const config = Reveal.getConfig().audio || {};
      return {
        prefix: config.prefix || './audio/',
        suffix: config.suffix || '.webm',
        defaultDuration: config.defaultDuration || 5
      };
    })()`);

    // Security check: ensure prefix and suffix don't contain path traversal
    if (audioConfig.prefix.includes('..') || audioConfig.suffix.includes('..') || audioConfig.prefix.startsWith('/')) {
        throw new Error('Security Error: Invalid audio prefix or suffix in Reveal configuration.');
    }

    const states = [];
    let hasMore = true;

    // Navigate to start
    console.log('>>> Extracting Slides and Fragments...');
    await page.evaluate('Reveal.slide(0, 0, -1)');

    let step = 0;
    while (hasMore) {
      // Small safety delay to ensure DOM is settled
      await new Promise(r => setTimeout(r, 100));

      const indices = await page.evaluate('Reveal.getIndices()');
      const h = indices.h;
      const v = indices.v;
      const f = (indices.f === undefined || indices.f === -1) ? null : indices.f;

      const screenshotPath = path.join(tmpDir, `step_${step.toString().padStart(4, '0')}.png`);
      await page.screenshot({ path: screenshotPath });

      // Identify audio file
      let audioFileName = `${h}.${v}${f !== null ? '.' + f : ''}${audioConfig.suffix}`;
      let audioPath = path.join(path.dirname(htmlFile), audioConfig.prefix, audioFileName);

      let duration = await getAudioDuration(audioPath);
      if (!duration) {
        duration = audioConfig.defaultDuration;
        audioPath = null;
      }

      states.push({ screenshotPath, audioPath, duration, label: `${h}.${v}${f !== null ? '.' + f : ''}` });

      // Go to next state
      hasMore = await page.evaluate(`(() => {
        const currentIndices = Reveal.getIndices();
        Reveal.next();
        const nextIndices = Reveal.getIndices();
        return currentIndices.h !== nextIndices.h || currentIndices.v !== nextIndices.v || currentIndices.f !== nextIndices.f;
      })()`);

      step++;
    }
    await browser.close();
    browser = null;
    console.log(`>>> Captured ${states.length} states.`);

    // Encoding segments
    console.log(`>>> Encoding Video Segments (concurrency: ${concurrency})...`);
    const segments = [];
    const queue = states.map((s, i) => ({ s, i }));
    let completed = 0;

    async function worker() {
      while (queue.length > 0) {
        const { s, i } = queue.shift();
        const segmentPath = path.join(tmpDir, `segment_${i.toString().padStart(4, '0')}.mp4`);

        let ffmpegArgs;
        if (s.audioPath) {
          ffmpegArgs = [
            '-y', '-v', 'error',
            '-loop', '1', '-i', s.screenshotPath,
            '-i', s.audioPath,
            '-c:v', 'libx264', '-t', s.duration.toString(),
            '-pix_fmt', 'yuv420p', '-vf', 'scale=2560:1440',
            '-c:a', 'aac', '-b:a', '192k',
            segmentPath
          ];
        } else {
          ffmpegArgs = [
            '-y', '-v', 'error',
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-loop', '1', '-i', s.screenshotPath,
            '-c:v', 'libx264', '-t', s.duration.toString(),
            '-pix_fmt', 'yuv420p', '-vf', 'scale=2560:1440',
            '-c:a', 'aac', '-shortest',
            segmentPath
          ];
        }

        await asyncRunCommand('ffmpeg', ffmpegArgs);
        completed++;
        process.stdout.write(`\r    Progress: ${completed}/${states.length} segments encoded...`);
        segments[i] = segmentPath;
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, states.length) }, worker);
    await Promise.all(workers);
    console.log('\n>>> All segments encoded.');
    // Final concatenation
    const concatFile = path.join(tmpDir, 'concat.txt');
    const concatContent = segments.map(s => `file '${path.basename(s)}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);

    console.log('>>> Concatenating Final Video...');
    // We run concat in the tmp directory to avoid path issues
    runCommand('ffmpeg', [
        '-y', '-v', 'error',
        '-f', 'concat', '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        path.resolve(outputFile)
    ], { cwd: tmpDir });

    console.log(`\n>>> Success! Video saved to: ${outputFile}`);
    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    console.log(`>>> Total Duration: ${durationSec}s`);

  } catch (err) {
    console.error('\n>>> Error occurred:', err.message);
    process.exitCode = 1;
  } finally {
    // Kill any active subprocesses
    for (const child of activeProcesses) {
      try { child.kill('SIGTERM'); } catch (e) {}
    }
    activeProcesses.clear();

    if (browser) {
        try { await browser.close(); } catch (e) {}
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`>>> Cleaned up temporary directory: ${tmpDir}`);
      } catch (e) {
        console.warn(`\n>>> Warning: Failed to clean up temporary directory: ${tmpDir}. Error: ${e.message}`);
      }
    }
  }
}

// Global signal handling to trigger cleanup
process.on('SIGINT', () => {
    console.log('\n>>> Process interrupted. Cleaning up...');
    process.exit(1); // Triggers 'exit' event or we can just let run() finish its finally
});
process.on('SIGTERM', () => {
    console.log('\n>>> Process terminated. Cleaning up...');
    process.exit(1);
});

run();
