import winston from 'winston';
import LokiTransport from 'winston-loki';

const lokiEnabled = !!process.env.LOKI_URL;

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
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
        onConnectionError: (err) => console.error('[Loki] Connection error:', err)
      }) as winston.transport
    ] : [])
  ]
});
