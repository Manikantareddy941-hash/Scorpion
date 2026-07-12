import Docker from 'dockerode';
import { Writable } from 'stream';
import path from 'path';

export interface RunnerOptions {
  image: string;         // Container image name (e.g., 'node:18-alpine')
  cmd: string[];         // Tokenized execution arguments (e.g., ['npm', 'run', 'build'])
  workspacePath: string; // The absolute path on your host machine to compile code inside
  logger: { log: (message: string) => void }; // Hooks straight into Scorpion's SSE pipeline logger
  env?: string[];        // KEY=value pairs injected into the container (e.g., cloud credentials) — never logged
  entrypoint?: string[]; // Override the image entrypoint (e.g., ['/bin/sh', '-c'])
}

export class DockerRunnerService {
  private docker: Docker;

  constructor() {
    // Dynamically checks for standard Unix sockets or Windows Named Pipes automatically
    this.docker = new Docker();
  }

  /**
   * Spawns an isolated ephemeral container to execute tasks securely without polluting the host.
   */
  public async runInContainer(options: RunnerOptions): Promise<{ exitCode: number }> {
    const { image, cmd, workspacePath, logger, env, entrypoint } = options;
    let container: Docker.Container | null = null;

    try {
      logger.log(`[DockerRunner] Checking and caching execution runtime environment: ${image}`);
      await this.ensureImageExists(image, logger);

      // Resolve host directory explicitly for safe mounting context
      const absoluteWorkspace = path.resolve(workspacePath);

      logger.log(`[DockerRunner] Initializing isolated container shell context.`);
      
      container = await this.docker.createContainer({
        Image: image,
        Cmd: cmd,
        ...(entrypoint ? { Entrypoint: entrypoint } : {}),
        ...(env && env.length ? { Env: env } : {}),
        WorkingDir: '/workspace',
        HostConfig: {
          // Bind mount the current pipeline repository workspace directly into the container filesystem
          Binds: [`${absoluteWorkspace}:/workspace`],
          AutoRemove: false, // Keeping false explicitly until we query the exact outcome metrics
        },
        Tty: false,
      });

      // Intercept the streams before running the entry processes
      const logStream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      if (!logStream) {
        throw new Error('Failed to attach to container output streams.');
      }
      // Pipe and sanitize streams directly into your current logging subsystem
      this.streamSanitizedLogs(logStream, logger);

      logger.log(`[DockerRunner] Container spin-up successful. Executing payload script...`);
      await container.start();

      // Block until container work cycles finish execution asynchronously
      const terminationData = await container.wait();
      const exitCode = terminationData.StatusCode;

      logger.log(`[DockerRunner] Payload processing completed with industrial status code: ${exitCode}`);
      return { exitCode };

    } catch (error: any) {
      logger.log(`[DockerRunner] Severe pipeline execution failure context: ${error.message}`);
      throw error;
    } finally {
      if (container) {
        try {
          await container.remove();
          logger.log(`[DockerRunner] Infrastructure environment torn down cleanly.`);
        } catch (cleanupError: any) {
          logger.log(`[DockerRunner] Warning: Post-run container teardown structural latency: ${cleanupError.message}`);
        }
      }
    }
  }

  /**
   * Evaluates local image cache; missing tags are cleanly pulled over the network registry automatically.
   */
  private async ensureImageExists(image: string, logger: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, {}, (err, stream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error(`Failed to establish pull stream for image ${image}`));
        
        // This ensures the pipeline blocks gracefully while download operations finish
        this.docker.modem.followProgress(
          stream,
          (finishErr) => {
            if (finishErr) return reject(finishErr);
            resolve();
          },
          (progressEvent) => {
            // Optional: You could parse progressEvent.status here for high-fidelity loading logs
          }
        );
      });
    });
  }

  /**
   * Sanitizes binary stream multiplex noise from Docker engine so that plain web frontends render text perfectly.
   */
  private streamSanitizedLogs(logStream: NodeJS.ReadableStream, logger: any): void {
    const logSanitizationPipeline = new Writable({
      write(chunk, encoding, callback) {
        let buffer = chunk;
        
        // Docker multiplex stream specification header consists of exactly 8 bytes if Tty is disabled
        // [0] = Stream Type (1 = stdout, 2 = stderr), [1-3] = Reserved, [4-7] = Frame Size (Big Endian)
        if (buffer.length >= 8 && (buffer[0] === 1 || buffer[0] === 2)) {
          buffer = buffer.subarray(8);
        }

        let cleanTextOutput = buffer.toString('utf8');
        
        // Clean up terminal color headers or control strings that distort HTML log outputs
        cleanTextOutput = cleanTextOutput.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

        if (cleanTextOutput) {
          logger.log(cleanTextOutput);
        }
        callback();
      }
    });

    logStream.pipe(logSanitizationPipeline);
  }
}

export const dockerRunnerService = new DockerRunnerService();
