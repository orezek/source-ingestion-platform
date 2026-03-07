import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import React from 'react';
import { render } from 'ink';

import { loadOmniCrawlChatEnv } from './env.js';
import { runChatGraph } from './graph/graph.js';
import { createPlanner } from './planner/create-planner.js';
import { AppScreen } from './tui/app-screen.js';

const printUsage = (): void => {
  console.log(`Usage: pnpm -C apps/omni-crawl-chat start -- --prompt "what is (2 + 3) * 4"`);
};

const parsePromptArg = (argv: string[]): string | null => {
  const args = [...argv];
  let prompt: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === '--help' || current === '-h') {
      printUsage();
      process.exit(0);
    }

    if (current === '--prompt' || current === '-p') {
      prompt = args[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  if (prompt) {
    return prompt.trim();
  }

  const positional = args
    .filter((arg) => !arg.startsWith('-'))
    .join(' ')
    .trim();
  return positional.length > 0 ? positional : null;
};

const promptInteractively = async (): Promise<string> => {
  const interfaceHandle = readline.createInterface({ input, output });
  try {
    const response = await interfaceHandle.question('omni-crawl-chat> ');
    return response.trim();
  } finally {
    interfaceHandle.close();
  }
};

const main = async (): Promise<void> => {
  const env = loadOmniCrawlChatEnv();
  const promptFromArgs = parsePromptArg(process.argv.slice(2));
  const userMessage = promptFromArgs ?? (process.stdin.isTTY ? await promptInteractively() : null);

  if (!userMessage || userMessage.length === 0) {
    throw new Error('A prompt is required. Pass --prompt <text> or run interactively in a TTY.');
  }

  const planner = createPlanner({
    mode: env.JOB_COMPASS_CHAT_PLANNER_MODE,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    geminiTemperature: env.GEMINI_TEMPERATURE,
    geminiThinkingLevel: env.GEMINI_THINKING_LEVEL,
  });

  const state = await runChatGraph(
    {
      planner,
      maxSteps: env.JOB_COMPASS_CHAT_MAX_STEPS,
    },
    userMessage,
  );

  const app = render(React.createElement(AppScreen, { state }));
  await app.waitUntilExit();
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`omni-crawl-chat failed: ${message}`);
  process.exitCode = 1;
});
