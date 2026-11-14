import { describe, it, expect } from 'vitest';

describe('diagFirstLine', () => {
  it('JSON do exporter vira só code/message, sem stack', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const { diagFirstLine } = await import('../src/instrumentation.js');
    const json = JSON.stringify({
      stack: 'AggregateError [ECONNREFUSED]: \n    at internalConnectMultiple (node:net:1122:18)',
      errors: 'Error: connect ECONNREFUSED 192.0.2.1:4318,Error: connect ENETUNREACH ::1:4318',
      code: 'ECONNREFUSED',
    });
    const line = diagFirstLine(json);
    expect(line).toBe('Error: connect ECONNREFUSED 192.0.2.1:4318');
    expect(line).not.toContain('stack');
    expect(diagFirstLine({ message: 'timeout', code: 'ETIMEDOUT', stack: 'Error: timeout\n at x' })).toBe('ETIMEDOUT: timeout');
    expect(diagFirstLine({ stack: 'AggregateError [ECONNREFUSED]: \n at x' })).toBe('AggregateError [ECONNREFUSED]:');
    expect(diagFirstLine(new Error('boom\n at y'))).toBe('Error: boom');
  });
});
