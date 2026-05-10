# `reveal2video` - Reveal.js to Video Converter

I was tired of endless recording sessions using [OBS](https://github.com/obsproject/obs-studio) (great tool BTW) watching my [reveal.js](https://github.com/hakimel/reveal.js) slideshows with audio-playback only to "convert" them into an HQ video (*.mkv).

So I finally came up with this (mostly vibe-coded using [gemini-cli](https://github.com/google-gemini/gemini-cli)) terminal-based tool to render a [reveal.js](https://github.com/hakimel/reveal.js) slideshow with audio-playback (using [`audio-slideshow`](https://github.com/rajgoel/reveal.js-plugins/blob/master/audio-slideshow/README.md) or its Quarto-port [`audio-slideshow`](https://github.com/kapsner/audio-slideshow)) directly into a high-quality MKV video. Under the hood, `reveal2video` launches a browser and captures snapshots by navigating through slides and fragments. Available audio files are automatically mapped to each screenshot, ensuring synchronization of slide and fragment transitions with their corresponding audio files.

## Features

- **Automated Capture**: Uses [Puppeteer](https://github.com/puppeteer/puppeteer) to navigate through slides and fragments.
- **Dry Run (PDF Export)**: Capture all slides and fragments and save them as a high-quality PDF.
- **Audio Synchronization**: Maps audio files to specific slides/fragments using [reveal.js](https://github.com/hakimel/reveal.js) conventions (`H.V.webm` or `H.V.F.webm`).
- **Precision Timing**: Extracts exact audio durations using [`ffprobe`](https://ffmpeg.org/ffprobe.html) to ensure the video stays in sync.
- **Configurable Settling Delay**: Adjustable timeout to ensure the DOM is fully rendered before capturing screenshots.
- **Headless Rendering**: Works in the background without needing a visible browser window.
- **Optimized Quality**: Captures at 1440p (QHD) and renders at 1080p (FHD) for superior sharpness (supersampling).

## System Requirements

Before using the tool, ensure you have the following installed on your system:

### 1. Node.js & NPM
Download and install from [nodejs.org](https://nodejs.org/).

### 2. FFmpeg & FFprobe
These are required for audio processing and video encoding.
- **Ubuntu/Debian**: `sudo apt update && sudo apt install ffmpeg`
- **macOS (Homebrew)**: `brew install ffmpeg`
- **Windows**: Download binaries from [ffmpeg.org](https://ffmpeg.org/download.html) and add the `bin` folder to your system `PATH`.

### 3. Chromium/Chrome
Puppeteer requires a browser to render the slides. Usually, it downloads a local version during `npm install`, but you can also use your system's Chrome.

## Installation

1. Navigate to the tool directory:
   ```bash
   cd reveal2video
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

Run the script directly using Node:

```bash
./reveal2video.js [options] <html-file> [output.mkv]
```

### Options

| Flag | Description |
| :--- | :--- |
| `-d`, `--dry-run` | Dry run: capture screenshots and save as PDF instead of video. |
| `-t`, `--delay <ms>` | Delay in milliseconds to wait for the DOM to settle before each screenshot. Defaults to 300ms. |
| `-j`, `--concurrency <n>` | Number of parallel encoding jobs. Defaults to 2. |
| `--browser <path>` | Path to Chromium/Chrome executable. If not provided, the tool will try to detect it automatically on your system. |
| `--no-sandbox` | Disables the Puppeteer sandbox. Use only in trusted environments (e.g., specific Docker containers). |
| `--disable-setuid-sandbox` | Disables the setuid sandbox for Puppeteer. |
| `--help`, `-h` | Show usage information and available options. |

## Compiling to an Executable

You can compile the tool into a standalone binary using `pkg`. Note that while this bundles the Node.js code, **FFmpeg and Chromium must still be installed on the host system**. The binary will attempt to locate a system-installed Chrome/Chromium if no `--browser` path is specified.

1. Install `pkg` globally:
   ```bash
   npm install -g pkg
   ```

2. Compile for your platform (example for Linux):
   ```bash
   pkg . --targets node18-linux-x64 --output reveal2video
   ```
   *(Replace `linux` with `macos` or `win` as needed).*

   > [!NOTE]
   > You might see warnings like `Failed to make bytecode` for `typed-query-selector`. These are caused by Puppeteer's TypeScript definition files and **can be safely ignored**. The resulting binary will function correctly.

3. Run the binary:
   ```bash
   ./reveal2video /path/to/slideshow.html
   ```

### Making the tool available system-wide

To run the tool from anywhere in your terminal without specifying the path to the binary, you can move it to a folder in your system's `PATH`.

1. **Create a `bin` directory** in your home folder (if it doesn't exist):
   ```bash
   mkdir -p ~/bin
   ```

2. **Move the binary** to that directory:
   ```bash
   mv reveal2video ~/bin/
   ```

3. **Add `~/bin` to your `PATH`**:
   Add the following line to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`):
   ```bash
   export PATH="$HOME/bin:$PATH"
   ```
   Then, reload your configuration:
   ```bash
   source ~/.bashrc  # or ~/.zshrc
   ```

Now you can simply run `reveal2video slideshow.html` from any directory.

:bulb: Tip: to use puppeteer's chromium, you can find out its path by running `node -e 'console.log(require("puppeteer").executablePath())'` in a shell and provide the resulting path with the `--browser` flag to the reveal2video executable.

## Technical Specifications

The tool uses the following default settings for constant bitrate and high-quality encoding:

| Parameter | Default Value | Description |
| :--- | :--- | :--- |
| **Container** | Matroska (.mkv) | Ideal for high-quality streams and seamless concatenation. |
| **Capture Resolution** | 2560 x 1440 (1440p) | QHD (Quad HD) for detail. |
| **Output Resolution** | 1920 x 1080 (1080p) | FHD (Full HD) for broad compatibility. |
| **Frame Rate** | 25 FPS | Constant frame rate. |
| **Video Bitrate** | 10 Mb/s (CBR) | High constant bitrate for superior visual quality. |
| **Video Codec** | libx264 (H.264) | High Profile, Level 4.1. |
| **Pixel Format** | yuv420p | Broad hardware and player compatibility. |
| **Audio Codec** | AAC | Advanced Audio Coding. |
| **Audio Bitrate** | 192 kb/s (CBR) | High constant audio quality. |
| **Sample Rate** | 44.1 kHz | CD-quality audio sampling rate. |

## How it works

1. **Extraction**: The tool launches a headless browser, navigates to every slide/fragment, and takes a high-resolution screenshot.
2. **Analysis**: It identifies the associated audio file for each state and calculates its exact duration.
3. **Processing**: Individual video segments are created for each slide/fragment state using the constant bitrate settings.
4. **Final Assembly**: All segments are concatenated into a single MKV file.
