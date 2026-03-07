import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRootDir = path.resolve(currentDir, '..', '..');

export const loadPromptMarkdown = async (relativePath: string): Promise<string> => {
  const promptPath = path.resolve(appRootDir, relativePath);
  return fs.readFile(promptPath, 'utf8');
};
