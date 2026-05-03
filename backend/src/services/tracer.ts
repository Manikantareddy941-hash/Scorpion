import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'scorpion-backend',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0'
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces'
  }),
  instrumentations: [getNodeAutoInstrumentations()]
});

console.log('[Tracing] Initializing OpenTelemetry SDK...');
sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[Tracing] SDK shut down successfully'))
    .catch((error) => console.error('[Tracing] Error shutting down SDK', error))
    .finally(() => process.exit(0));
});

export default sdk;
