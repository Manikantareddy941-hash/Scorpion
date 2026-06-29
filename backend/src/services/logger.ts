import winston from 'winston';
import LokiTransport from 'winston-loki';

const isProduction = process.env.NODE_ENV === 'production';
const lokiEnabled = !!process.env.LOKI_URL && isProduction;

// Production logs to stdout as JSON so the cluster's log pipeline can parse them;
// local dev gets human-readable pretty output.
const consoleFormat = isProduction
  ? winston.format.json()
  : winston.format.prettyPrint();

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    ...(lokiEnabled ? [
      new LokiTransport({
        host: process.env.LOKI_URL!,
        labels: { 
          app: 'scorpion', 
          env: process.env.NODE_ENV || 'development' 
        },
        json: true,
        format: winston.format.json(),
        replaceTimestamp: true,
        onConnectionError: (err: any) => {
          if (process.env.NODE_ENV !== 'production') return; // silent in dev
          console.error('[Loki] Connection error:', err.message);
        }
      }) as winston.transport
    ] : [])
  ]
});
