// backend/src/services/sshService.ts
import { Client } from 'ssh2';

// Wraps a value in single quotes for safe inclusion in a remote shell command,
// escaping any embedded single quotes so deployPath can't break out into new commands.
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface RemoteServerConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

export interface DeployOptions {
  server: RemoteServerConfig;
  deployPath: string;
  commands: string[];
  logger: { log: (message: string) => void };
}

export class SshService {
  /**
   * Executes a series of deployment commands on a remote server via SSH.
   * Standard output and error streams are forwarded line‑by‑line to the provided logger.
   */
  public async executeDeployment(options: DeployOptions): Promise<{ success: boolean }> {
    const { server, deployPath, commands, logger } = options;
    const conn = new Client();

    return new Promise((resolve, reject) => {
      conn
        .on('ready', () => {
          logger.log(`[SSHService] Connected to ${server.host}`);
          const payload = `cd ${shellEscape(deployPath)} && ${commands.join(' && ')}`;
          conn.exec(payload, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }
            stream.on('data', (data: Buffer) => {
              data
                .toString('utf8')
                .split('\n')
                .forEach(line => {
                  if (line.trim()) logger.log(`[Remote] ${line.trim()}`);
                });
            });
            stream.stderr.on('data', (data: Buffer) => {
              data
                .toString('utf8')
                .split('\n')
                .forEach(line => {
                  if (line.trim()) logger.log(`[Remote][ERR] ${line.trim()}`);
                });
            });
            stream.on('close', (code: number) => {
              conn.end();
              if (code === 0) {
                logger.log('[SSHService] Deployment succeeded');
                resolve({ success: true });
              } else {
                logger.log(`[SSHService] Deployment failed with exit code ${code}`);
                resolve({ success: false });
              }
            });
          });
        })
        .on('error', err => {
          logger.log(`[SSHService] Connection error: ${err.message}`);
          reject(err);
        })
        .connect({
          host: server.host,
          port: server.port,
          username: server.username,
          privateKey: server.privateKey,
          readyTimeout: 15000
        });
    });
  }
}

export const sshService = new SshService();
