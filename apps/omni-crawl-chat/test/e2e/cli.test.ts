import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, '..', '..');
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const stripAnsi = (value: string): string => value.replace(ansiPattern, '');

describe('omni-crawl-chat CLI e2e', () => {
  it('renders TUI output with planner observability', async () => {
    const { stdout } = await execFileAsync(
      'node',
      ['dist/app.js', '--prompt', 'what is (2 + 3) * 4'],
      {
        cwd: appDir,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          JOB_COMPASS_CHAT_PLANNER_MODE: 'heuristic',
        },
      },
    );

    const output = stripAnsi(stdout);
    expect(output).toContain('JOB COMPASS CHAT');
    expect(output).toContain('PLANNER TRACE');
    expect(output).toContain('TASK PLAN');
    expect(output).toContain('FINAL ANSWER');
    expect(output).toContain('The result is 20.');
  });
});
