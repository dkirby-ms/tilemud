// T052: Unit tests for rule config service & stamping (FR-016)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuleConfigService } from '../../src/application/services/ruleConfigService';
import type { CreateRuleConfigInput, RuleType } from '../../src/application/services/ruleConfigService';

describe('RuleConfigService', () => {
  let ruleConfigService: RuleConfigService;
  
  beforeEach(() => {
    ruleConfigService = new RuleConfigService();
  });

  describe('createRuleConfig', () => {
    it('should create new rule config', async () => {
      const input: CreateRuleConfigInput = {
        type: 'arena',
        version: '1.0.0',
        name: 'Test Arena Rules',
        description: 'Test description',
        config: { maxPlayers: 300, tileTimeout: 5000 },
        createdBy: 'admin-123',
        tags: ['test']
      };

      const config = await ruleConfigService.createRuleConfig(input);

      expect(config.id).toBeDefined();
      expect(config.type).toBe('arena');
      expect(config.version).toBe('1.0.0');
      expect(config.name).toBe('Test Arena Rules');
      expect(config.isActive).toBe(true);
      expect(config.createdAt).toBeInstanceOf(Date);
    });

    it('should validate input schema', async () => {
      const invalidInput = {
        type: 'invalid-type',
        version: 'invalid-version',
        name: '',
        config: {},
        createdBy: 'not-a-uuid'
      } as any;

      await expect(ruleConfigService.createRuleConfig(invalidInput)).rejects.toThrow();
    });

    it('should set as active version when created', async () => {
      const input: CreateRuleConfigInput = {
        type: 'battle',
        version: '2.1.0',
        name: 'Battle Rules v2',
        config: { battleDuration: 600000 },
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      const activeConfig = await ruleConfigService.getActiveRuleConfig('battle');

      expect(activeConfig?.id).toBe(config.id);
    });
  });

  describe('getActiveRuleConfig', () => {
    it('should return active rule config for type', async () => {
      const input: CreateRuleConfigInput = {
        type: 'chat',
        version: '1.5.0',
        name: 'Chat Rules',
        config: { maxMessageLength: 500 },
        createdBy: 'admin-123',
        tags: []
      };

      await ruleConfigService.createRuleConfig(input);
      const activeConfig = await ruleConfigService.getActiveRuleConfig('chat');

      expect(activeConfig).toBeDefined();
      expect(activeConfig?.type).toBe('chat');
      expect(activeConfig?.version).toBe('1.5.0');
    });

    it('should return null for type with no active config', async () => {
      const activeConfig = await ruleConfigService.getActiveRuleConfig('guild');
      expect(activeConfig).toBeNull();
    });
  });

  describe('getRuleConfigsByType', () => {
    it('should return configs sorted by version', async () => {
      const types: RuleType = 'player';
      
      // Create multiple versions
      const inputs: CreateRuleConfigInput[] = [
        {
          type: types,
          version: '1.0.0',
          name: 'Player Rules v1',
          config: {},
          createdBy: 'admin-123',
          tags: []
        },
        {
          type: types,
          version: '2.0.0',
          name: 'Player Rules v2',
          config: {},
          createdBy: 'admin-123',
          tags: []
        },
        {
          type: types,
          version: '1.5.0',
          name: 'Player Rules v1.5',
          config: {},
          createdBy: 'admin-123',
          tags: []
        }
      ];

      for (const input of inputs) {
        await ruleConfigService.createRuleConfig(input);
      }

      const configs = await ruleConfigService.getRuleConfigsByType(types);

      expect(configs).toHaveLength(3);
      expect(configs[0].version).toBe('2.0.0'); // Newest first
      expect(configs[1].version).toBe('1.5.0');
      expect(configs[2].version).toBe('1.0.0');
    });

    it('should return empty array for type with no configs', async () => {
      const configs = await ruleConfigService.getRuleConfigsByType('system');
      expect(configs).toEqual([]);
    });
  });

  describe('version stamping', () => {
    it('should create version stamp with metadata', async () => {
      const input: CreateRuleConfigInput = {
        type: 'arena',
        version: '1.2.3',
        name: 'Test Rules',
        config: { test: true },
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      const stamp = ruleConfigService.createVersionStamp(config);

      expect(stamp.ruleConfigId).toBe(config.id);
      expect(stamp.version).toBe('1.2.3');
      expect(stamp.type).toBe('arena');
      expect(stamp.stampedAt).toBeInstanceOf(Date);
      expect(stamp.checksum).toBeDefined();
    });

    it('should create consistent checksums for same config', async () => {
      const input: CreateRuleConfigInput = {
        type: 'battle',
        version: '1.0.0',
        name: 'Test Battle Rules',
        config: { duration: 300000 },
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      
      const stamp1 = ruleConfigService.createVersionStamp(config);
      const stamp2 = ruleConfigService.createVersionStamp(config);

      expect(stamp1.checksum).toBe(stamp2.checksum);
    });

    it('should create different stamps at different times', async () => {
      const input: CreateRuleConfigInput = {
        type: 'moderation',
        version: '2.0.0',
        name: 'Moderation Rules',
        config: { maxWarnings: 3 },
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      
      const stamp1 = ruleConfigService.createVersionStamp(config);
      
      // Wait a moment to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const stamp2 = ruleConfigService.createVersionStamp(config);

      expect(stamp1.stampedAt).not.toEqual(stamp2.stampedAt);
      expect(stamp1.checksum).toBe(stamp2.checksum); // Same config = same checksum
    });
  });

  describe('rule activation', () => {
    it('should activate specific rule config version', async () => {
      const type: RuleType = 'guild';
      
      // Create two versions
      const input1: CreateRuleConfigInput = {
        type,
        version: '1.0.0',
        name: 'Guild Rules v1',
        config: { maxMembers: 50 },
        createdBy: 'admin-123',
        tags: []
      };

      const input2: CreateRuleConfigInput = {
        type,
        version: '2.0.0',
        name: 'Guild Rules v2',
        config: { maxMembers: 100 },
        createdBy: 'admin-123',
        tags: []
      };

      const config1 = await ruleConfigService.createRuleConfig(input1);
      const config2 = await ruleConfigService.createRuleConfig(input2);

      // Should be active (latest created)
      let activeConfig = await ruleConfigService.getActiveRuleConfig(type);
      expect(activeConfig?.id).toBe(config2.id);

      // Activate the older version
      await ruleConfigService.activateRuleConfig(config1.id, 'admin-123');
      
      activeConfig = await ruleConfigService.getActiveRuleConfig(type);
      expect(activeConfig?.id).toBe(config1.id);
    });

    it('should deactivate rule config', async () => {
      const input: CreateRuleConfigInput = {
        type: 'system',
        version: '1.0.0',
        name: 'System Rules',
        config: { maintenanceMode: false },
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      
      // Should be active initially
      let activeConfig = await ruleConfigService.getActiveRuleConfig('system');
      expect(activeConfig).toBeDefined();

      // Deactivate
      await ruleConfigService.deactivateRuleConfig(config.id, 'admin-123');

      activeConfig = await ruleConfigService.getActiveRuleConfig('system');
      expect(activeConfig).toBeNull();
    });
  });

  describe('audit logging', () => {
    it('should log rule config creation', async () => {
      const input: CreateRuleConfigInput = {
        type: 'arena',
        version: '1.0.0',
        name: 'Test Arena Rules',
        config: {},
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      const auditLog = await ruleConfigService.getAuditLog(config.id);

      expect(auditLog).toBeDefined();
      expect(auditLog.length).toBeGreaterThan(0);
      
      const creationEntry = auditLog.find(entry => entry.action === 'created');
      expect(creationEntry).toBeDefined();
      expect(creationEntry?.ruleConfigId).toBe(config.id);
      expect(creationEntry?.actorId).toBe('admin-123');
    });

    it('should log rule config activation', async () => {
      const input: CreateRuleConfigInput = {
        type: 'battle',
        version: '1.0.0',
        name: 'Battle Rules',
        config: {},
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      await ruleConfigService.activateRuleConfig(config.id, 'admin-123');

      const auditLog = await ruleConfigService.getAuditLog(config.id);
      
      const activationEntry = auditLog.find(entry => entry.action === 'activated');
      expect(activationEntry).toBeDefined();
    });

    it('should provide audit statistics', async () => {
      const stats = await ruleConfigService.getStats();

      expect(stats).toBeDefined();
      expect(stats.totalConfigs).toBeGreaterThanOrEqual(0);
      expect(stats.activeConfigs).toBeGreaterThanOrEqual(0);
      expect(stats.configsByType).toBeDefined();
      expect(stats.recentAuditEntries).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle invalid rule config ID gracefully', async () => {
      const auditLog = await ruleConfigService.getAuditLog('invalid-id');
      expect(auditLog).toEqual([]);
    });

    it('should handle activation of non-existent config', async () => {
      await expect(ruleConfigService.activateRuleConfig('non-existent-id', 'admin-123'))
        .rejects.toThrow();
    });

    it('should validate semver format', async () => {
      const invalidVersionInputs = [
        '1.0', // Missing patch
        '1', // Missing minor and patch
        '1.0.0.0', // Too many parts
        'v1.0.0', // Has prefix
        '1.0.0-beta', // Pre-release not allowed
      ];

      for (const version of invalidVersionInputs) {
        const input: CreateRuleConfigInput = {
          type: 'arena',
          version,
          name: 'Test',
          config: {},
          createdBy: 'admin-123',
          tags: []
        };

        await expect(ruleConfigService.createRuleConfig(input)).rejects.toThrow();
      }
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent rule creation', async () => {
      const promises = [];
      
      for (let i = 1; i <= 10; i++) {
        const input: CreateRuleConfigInput = {
          type: 'arena',
          version: `1.0.${i}`,
          name: `Arena Rules v1.0.${i}`,
          config: { version: i },
          createdBy: 'admin-123',
          tags: []
        };
        
        promises.push(ruleConfigService.createRuleConfig(input));
      }

      const configs = await Promise.all(promises);
      
      expect(configs).toHaveLength(10);
      configs.forEach((config, index) => {
        expect(config.version).toBe(`1.0.${index + 1}`);
      });
    });

    it('should handle concurrent stamp creation', async () => {
      const input: CreateRuleConfigInput = {
        type: 'battle',
        version: '1.0.0',
        name: 'Battle Rules',
        config: {},
        createdBy: 'admin-123',
        tags: []
      };

      const config = await ruleConfigService.createRuleConfig(input);
      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(ruleConfigService.createVersionStamp(config));
      }

      const stamps = await Promise.all(promises);
      
      expect(stamps).toHaveLength(50);
      stamps.forEach(stamp => {
        expect(stamp.ruleConfigId).toBe(config.id);
        expect(stamp.version).toBe('1.0.0');
        expect(stamp.checksum).toBeDefined();
      });

      // All stamps should have same checksum (same config)
      const uniqueChecksums = new Set(stamps.map(s => s.checksum));
      expect(uniqueChecksums.size).toBe(1);
    });
  });

  describe('version comparison', () => {
    it('should correctly sort versions', async () => {
      const type: RuleType = 'player';
      const versions = ['2.0.0', '1.0.0', '1.10.0', '1.2.0', '1.0.10'];
      
      for (const version of versions) {
        const input: CreateRuleConfigInput = {
          type,
          version,
          name: `Rules ${version}`,
          config: {},
          createdBy: 'admin-123',
          tags: []
        };
        
        await ruleConfigService.createRuleConfig(input);
      }

      const configs = await ruleConfigService.getRuleConfigsByType(type);
      const sortedVersions = configs.map(c => c.version);
      
      // Should be sorted newest to oldest
      expect(sortedVersions).toEqual(['2.0.0', '1.10.0', '1.2.0', '1.0.10', '1.0.0']);
    });
  });

  describe('performance', () => {
    it('should handle high volume rule lookups efficiently', async () => {
      // Create some test rules
      for (let i = 1; i <= 5; i++) {
        const input: CreateRuleConfigInput = {
          type: 'arena',
          version: `1.0.${i}`,
          name: `Arena Rules v1.0.${i}`,
          config: {},
          createdBy: 'admin-123',
          tags: []
        };
        
        await ruleConfigService.createRuleConfig(input);
      }

      const start = Date.now();
      const promises = [];
      
      // Perform many concurrent lookups
      for (let i = 0; i < 100; i++) {
        promises.push(ruleConfigService.getActiveRuleConfig('arena'));
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - start;

      // All results should be the same
      const uniqueResults = new Set(results.map(r => r?.id));
      expect(uniqueResults.size).toBe(1);

      // Should complete quickly
      expect(duration).toBeLessThan(1000);
    });
  });
});