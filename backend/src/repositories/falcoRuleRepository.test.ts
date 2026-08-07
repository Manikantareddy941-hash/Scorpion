import { falcoRuleRepository } from './falcoRuleRepository';
import { databases } from '../lib/appwrite';
import { logger } from '../services/logger';

jest.mock('../lib/appwrite');
// Pin the storage facade to its legacy Appwrite path — this suite asserts on
// databases.* calls; the Postgres path is covered by pg/falcoRulePgRepository.test.ts.
jest.mock('../db/pool', () => ({ isPostgresEnabled: () => false, getPool: jest.fn(), closePool: jest.fn() }));
// Not a bare automock. Automocking turns every export into a jest.fn() returning
// undefined, including errorContext — and the call sites pass its result straight in
// as the log metadata, so the assertion below would receive `undefined` rather than
// the payload. Only `logger` itself needs faking.
jest.mock('../services/logger', () => ({
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('falcoRuleRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listRules', () => {
    it('returns valid rules and skips malformed rows', async () => {
      const mockDocs = [
        {
          $id: 'valid-1',
          template: 'terminal-shell-in-container',
          params: '{"allowedProcs":["tini"]}',
          appScope: undefined,
          severityOverride: undefined,
          suppressed: false,
          enabled: true,
        },
        {
          $id: 'malformed-1',
          template: 'terminal-shell-in-container',
          params: 'not valid json',
          appScope: undefined,
          severityOverride: undefined,
          suppressed: false,
          enabled: true,
        },
        {
          $id: 'unknown-template',
          template: 'unknown-rule',
          params: '{}',
          appScope: undefined,
          severityOverride: undefined,
          suppressed: false,
          enabled: true,
        },
        {
          $id: 'valid-2',
          template: 'outbound-unknown-domain',
          params: '{"allowedDomains":["example.com"]}',
          appScope: undefined,
          severityOverride: undefined,
          suppressed: false,
          enabled: true,
        },
      ];

      (databases.listDocuments as jest.Mock).mockResolvedValue({
        documents: mockDocs,
      });

      const rules = await falcoRuleRepository.listRules();

      expect(rules).toHaveLength(2);
      expect(rules[0].id).toBe('valid-1');
      expect(rules[0].template).toBe('terminal-shell-in-container');
      expect(rules[1].id).toBe('valid-2');
      expect(rules[1].template).toBe('outbound-unknown-domain');
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping rule malformed-1'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping rule unknown-template'));
    });

    it('returns empty array on database error', async () => {
      (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('DB error'));

      const rules = await falcoRuleRepository.listRules();

      expect(rules).toEqual([]);
      // The value stays pinned: this assertion exists because the old form
      // certified that 'DB error' reached a logger that silently dropped it.
      // objectContaining absorbs the `stack` key errorContext adds outside
      // production, without weakening the check on the message itself.
      expect(logger.warn).toHaveBeenCalledWith(
        '[FalcoRuleRepository] load failed',
        expect.objectContaining({ error: 'DB error' })
      );
    });
  });
});
