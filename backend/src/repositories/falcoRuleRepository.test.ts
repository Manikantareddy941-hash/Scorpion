import { falcoRuleRepository } from './falcoRuleRepository';
import { databases } from '../lib/appwrite';
import { logger } from '../services/logger';

jest.mock('../lib/appwrite');
jest.mock('../services/logger');

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
      expect(logger.warn).toHaveBeenCalledWith(
        '[FalcoRuleRepository] load failed:',
        'DB error'
      );
    });
  });
});
