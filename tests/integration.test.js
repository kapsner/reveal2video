const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLI_PATH = path.resolve(__dirname, '../reveal2video.js');
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

test('Dry run - simple presentation to PDF', async (t) => {
    const input = path.join(FIXTURES_DIR, 'simple.html');
    const output = path.join(FIXTURES_DIR, 'simple.pdf');

    // Ensure output doesn't exist
    if (fs.existsSync(output)) fs.unlinkSync(output);

    console.log(`Running CLI: node ${CLI_PATH} --dry-run --no-sandbox ${input}`);
    const result = spawnSync('node', [CLI_PATH, '--dry-run', '--no-sandbox', input], { encoding: 'utf8' });

    assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
    assert.ok(fs.existsSync(output), 'Output PDF should be created');

    const stats = fs.statSync(output);
    assert.ok(stats.size > 1000, `PDF is too small (${stats.size} bytes), might be empty`);

    // Cleanup
    fs.unlinkSync(output);
});

test('Dry run - complex presentation to PDF', async (t) => {
    const input = path.join(FIXTURES_DIR, 'complex.html');
    const output = path.join(FIXTURES_DIR, 'complex.pdf');

    // Ensure output doesn't exist
    if (fs.existsSync(output)) fs.unlinkSync(output);

    const result = spawnSync('node', [CLI_PATH, '--dry-run', '--no-sandbox', input], { encoding: 'utf8' });

    assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
    assert.ok(fs.existsSync(output), 'Output PDF should be created');

    const stats = fs.statSync(output);
    assert.ok(stats.size > 5000, `PDF is too small (${stats.size} bytes)`);

    // Cleanup
    fs.unlinkSync(output);
});
