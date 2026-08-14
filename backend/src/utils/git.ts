import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { logger, errorContext } from '../services/logger';

const execFileAsync = promisify(execFile);

/**
 * Strips `user:token@` from a clone URL before it reaches a log.
 *
 * Callers splice an access token into the host — pipelineService builds
 * `https://${token}@...` for private repos — so both lines below were writing a
 * live credential into the log on every clone, success and failure alike.
 *
 * Not redactUrl(): that one handles the admission webhook's path-borne token and
 * sensitive query params, neither of which is the userinfo form.
 */
const stripUserinfo = (url: string): string => url.replace(/\/\/[^@/]*@/, '//');

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
    logger.info(`[Git] Cloning ${stripUserinfo(options.cloneUrl)} (${options.branch})...`);

    await execFileAsync('git', ['clone', '--branch', options.branch, '--depth', '1', options.cloneUrl, options.destination], { timeout: 60000 }); // 1 minute timeout for clone
    logger.info(`[Git] Clone successful to ${options.destination}`);
  } catch (error) {
    logger.error(`[Git] Failed to clone ${stripUserinfo(options.cloneUrl)}:`, {
      event: 'GIT_CLONE_FAILED', branch: options.branch, ...errorContext(error),
    });
    throw error;
  }
}
