import { trace, SpanStatusCode } from '@opentelemetry/api';
import { errorMessage } from './logger';

const tracer = trace.getTracer('scorpion');

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(err) });
      // recordException takes OTel's `Exception` union, not `unknown`. An Error
      // satisfies it directly; anything else is recorded as its message string.
      span.recordException(err instanceof Error ? err : errorMessage(err));
      throw err;
    } finally {
      span.end();
    }
  });
}
