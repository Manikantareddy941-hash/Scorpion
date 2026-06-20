import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../services/logger';

const execFileAsync = promisify(execFile);

export interface CloneOptions {
  cloneUrl: string;
  branch: string;
  destination: string;
}

export async function cloneRepo(options: CloneOptions) {
  try {
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(options.destination), { recursive: true });
    
    // Clone specific branch with depth 1 for speed
    logger.info(`[Git] Cloning ${options.cloneUrl} (${options.branch})...`);

    await execFileAsync('git', ['clone', '--branch', options.branch, '--depth', '1', options.cloneUrl, options.destination], { timeout: 60000 }); // 1 minute timeout for clone
    logger.info(`[Git] Clone successful to ${options.destination}`);
  } catch (error) {
    logger.error(`[Git] Failed to clone ${options.cloneUrl}:`, error);
    throw error;
  }
}
