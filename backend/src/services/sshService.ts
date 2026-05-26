import { Client } from 'ssh2';

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
   * Established a cryptographically secure, isolated session to execute delivery payloads.
   */
  public async executeDeployment(options: DeployOptions): Promise<{ success: boolean }> {
    const { server, deployPath, commands, logger } = options;
    const conn = new Client();

    return new Promise((resolve, reject) => {
      conn.on('ready', () => {
        logger.log(`[SSHService] Connection handshake established successfully with endpoint: ${server.host}`);
        
        // Chain operations inside a targeted deployment path
        const flattenedPayload = `cd ${deployPath} && ${commands.join(' && ')}`;
        
        conn.exec(flattenedPayload, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          // Pipe target system execution streams line-by-line back to your frontend SSE log interface
          stream.on('data', (data: Buffer) => {
            const lines = data.toString('utf8').split('\n');
            lines.forEach(line => {
              if (line.trim()) logger.log(`[Remote Host OS] ${line.trim()}`);
            });
          });

          stream.stderr.on('data', (data: Buffer) => {
            const lines = data.toString('utf8').split('\n');
            lines.forEach(line => {
              if (line.trim()) logger.log(`[Remote Host WARN] ${line.trim()}`);
            });
          });

          stream.on('close', (exitCode: number) => {
            conn.end();
            if (exitCode === 0) {
              logger.log(`[SSHService] Isolated workload processing terminated with clean status code: 0`);
              resolve({ success: true });
            } else {
              logger.log(`[SSHService] Host architecture process returned an execution error: ${exitCode}`);
              resolve({ success: false });
            }
          });
        });
      }).on('error', (handshakeErr) => {
        logger.log(`[SSHService] Fatal infrastructure transport error: ${handshakeErr.message}`);
        reject(handshakeErr);
      }).connect({
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
