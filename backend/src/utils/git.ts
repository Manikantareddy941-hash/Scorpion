import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

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
    const command = `git clone --branch ${options.branch} --depth 1 ${options.cloneUrl} "${options.destination}"`;
    console.log(`[Git] Cloning ${options.cloneUrl} (${options.branch})...`);
    
    await execAsync(command, { timeout: 60000 }); // 1 minute timeout for clone
    console.log(`[Git] Clone successful to ${options.destination}`);
  } catch (error) {
    console.error(`[Git] Failed to clone ${options.cloneUrl}:`, error);
    throw error;
  }
}
