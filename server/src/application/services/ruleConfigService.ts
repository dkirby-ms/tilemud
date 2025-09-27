import { z } from 'zod';
import { createServiceLogger } from '../../infra/monitoring/logger';

// Rule configuration schemas
export const RuleTypeSchema = z.enum([
  'arena',
  'battle',
  'chat',
  'guild',
  'player',
  'moderation',
  'system'
]);

export type RuleType = z.infer<typeof RuleTypeSchema>;

export const RuleConfigSchema = z.object({
  id: z.string().uuid(),
  type: RuleTypeSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (x.y.z)'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()), // Flexible JSON config
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
  createdBy: z.string().uuid(),
  tags: z.array(z.string()).default([]),
});

export const CreateRuleConfigInputSchema = z.object({
  type: RuleTypeSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()),
  createdBy: z.string().uuid(),
  tags: z.array(z.string()).default([]),
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;
export type CreateRuleConfigInput = z.infer<typeof CreateRuleConfigInputSchema>;

// Audit log entry schema
export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.date(),
  ruleConfigId: z.string().uuid(),
  action: z.enum(['created', 'updated', 'activated', 'deactivated', 'deleted']),
  actorId: z.string().uuid(), // Player or system that performed the action
  actorType: z.enum(['player', 'system', 'migration']),
  previousValue: z.record(z.string(), z.unknown()).optional(),
  newValue: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export interface RuleConfigStats {
  totalConfigs: number;
  activeConfigs: number;
  configsByType: Record<RuleType, number>;
  recentAuditEntries: number;
  lastConfigUpdate?: Date | undefined;
  lastAuditEntry?: Date;
}

export interface RuleVersionStamp {
  ruleConfigId: string;
  version: string;
  type: RuleType;
  stampedAt: Date;
  checksum?: string;
}

/**
 * Rule configuration version loader and audit logger implementing FR-016
 * Manages versioned rule configurations with comprehensive audit logging
 */
export class RuleConfigService {
  private readonly serviceLogger = createServiceLogger('RuleConfigService');
  
  // In-memory storage for rule configs (in production, this would be a database)
  private ruleConfigs = new Map<string, RuleConfig>();
  private auditLog: AuditLogEntry[] = [];
  private activeVersions = new Map<RuleType, string>(); // type -> ruleConfigId
  
  private stats: RuleConfigStats = {
    totalConfigs: 0,
    activeConfigs: 0,
    configsByType: {
      arena: 0,
      battle: 0,
      chat: 0,
      guild: 0,
      player: 0,
      moderation: 0,
      system: 0,
    },
    recentAuditEntries: 0,
  };

  constructor() {
    this.serviceLogger.info({
      event: 'rule_config_service_initialized',
    }, 'Rule configuration service initialized');
    
    this.loadDefaultConfigs();
  }

  /**
   * Create a new rule configuration
   */
  async createRuleConfig(input: CreateRuleConfigInput): Promise<RuleConfig> {
    try {
      CreateRuleConfigInputSchema.parse(input);

      const now = new Date();
      const ruleConfig: RuleConfig = {
        id: this.generateId(),
        type: input.type,
        version: input.version,
        name: input.name,
        description: input.description,
        config: input.config,
        isActive: true,
        createdAt: now,
        createdBy: input.createdBy,
        tags: input.tags,
      };

      this.ruleConfigs.set(ruleConfig.id, ruleConfig);
      this.setAsActiveVersion(input.type, ruleConfig.id);
      this.updateStats();

      // Log the creation
      await this.logAuditEntry({
        ruleConfigId: ruleConfig.id,
        action: 'created',
        actorId: input.createdBy,
        actorType: 'player',
        newValue: { ...input },
        reason: `Created new ${input.type} rule configuration`,
        metadata: {},
      });

      this.serviceLogger.info({
        event: 'rule_config_created',
        ruleConfigId: ruleConfig.id,
        type: ruleConfig.type,
        version: ruleConfig.version,
        name: ruleConfig.name,
        createdBy: ruleConfig.createdBy,
      }, `Rule configuration created: ${ruleConfig.name} v${ruleConfig.version}`);

      return ruleConfig;
    } catch (error) {
      this.serviceLogger.error({
        event: 'rule_config_creation_error',
        input: input,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to create rule configuration');
      throw error;
    }
  }

  /**
   * Get rule configuration by ID
   */
  async getRuleConfig(id: string): Promise<RuleConfig | null> {
    return this.ruleConfigs.get(id) || null;
  }

  /**
   * Get active rule configuration for a type
   */
  async getActiveRuleConfig(type: RuleType): Promise<RuleConfig | null> {
    const activeId = this.activeVersions.get(type);
    if (!activeId) {
      return null;
    }

    const config = this.ruleConfigs.get(activeId);
    if (!config || !config.isActive) {
      // Clean up stale reference
      this.activeVersions.delete(type);
      return null;
    }

    return config;
  }

  /**
   * Get all rule configurations for a type
   */
  async getRuleConfigsByType(type: RuleType): Promise<RuleConfig[]> {
    const configs: RuleConfig[] = [];
    
    for (const config of Array.from(this.ruleConfigs.values())) {
      if (config.type === type) {
        configs.push(config);
      }
    }

    // Sort by version (newest first)
    return configs.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  /**
   * Activate a specific rule configuration version
   */
  async activateRuleConfig(id: string, actorId: string, reason?: string): Promise<boolean> {
    try {
      const config = this.ruleConfigs.get(id);
      if (!config) {
        this.serviceLogger.warn({
          event: 'activate_rule_config_not_found',
          ruleConfigId: id,
          actorId: actorId,
        }, `Cannot activate rule config - not found: ${id}`);
        return false;
      }

      // Deactivate current active config of this type
      const currentActiveId = this.activeVersions.get(config.type);
      if (currentActiveId && currentActiveId !== id) {
        const currentConfig = this.ruleConfigs.get(currentActiveId);
        if (currentConfig) {
          await this.deactivateRuleConfig(currentActiveId, actorId, `Replaced by ${config.version}`);
        }
      }

      // Activate the new config
      if (!config.isActive) {
        const updatedConfig = { ...config, isActive: true, updatedAt: new Date() };
        this.ruleConfigs.set(id, updatedConfig);
      }

      this.setAsActiveVersion(config.type, id);
      this.updateStats();

      await this.logAuditEntry({
        ruleConfigId: id,
        action: 'activated',
        actorId: actorId,
        actorType: 'player',
        newValue: { isActive: true },
        reason: reason || `Activated ${config.type} rule configuration v${config.version}`,
        metadata: {},
      });

      this.serviceLogger.info({
        event: 'rule_config_activated',
        ruleConfigId: id,
        type: config.type,
        version: config.version,
        actorId: actorId,
        reason: reason,
      }, `Rule configuration activated: ${config.name} v${config.version}`);

      return true;
    } catch (error) {
      this.serviceLogger.error({
        event: 'activate_rule_config_error',
        ruleConfigId: id,
        actorId: actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to activate rule configuration');
      return false;
    }
  }

  /**
   * Deactivate a rule configuration
   */
  async deactivateRuleConfig(id: string, actorId: string, reason?: string): Promise<boolean> {
    try {
      const config = this.ruleConfigs.get(id);
      if (!config) {
        return false;
      }

      if (config.isActive) {
        const updatedConfig = { ...config, isActive: false, updatedAt: new Date() };
        this.ruleConfigs.set(id, updatedConfig);

        // Remove from active versions if it was active
        if (this.activeVersions.get(config.type) === id) {
          this.activeVersions.delete(config.type);
        }

        this.updateStats();

        await this.logAuditEntry({
          ruleConfigId: id,
          action: 'deactivated',
          actorId: actorId,
          actorType: 'player',
          previousValue: { isActive: true },
          newValue: { isActive: false },
          reason: reason || `Deactivated ${config.type} rule configuration v${config.version}`,
          metadata: {},
        });

        this.serviceLogger.info({
          event: 'rule_config_deactivated',
          ruleConfigId: id,
          type: config.type,
          version: config.version,
          actorId: actorId,
          reason: reason,
        }, `Rule configuration deactivated: ${config.name} v${config.version}`);
      }

      return true;
    } catch (error) {
      this.serviceLogger.error({
        event: 'deactivate_rule_config_error',
        ruleConfigId: id,
        actorId: actorId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 'Failed to deactivate rule configuration');
      return false;
    }
  }

  /**
   * Create a version stamp for replay/audit purposes
   */
  createVersionStamp(ruleConfig: RuleConfig): RuleVersionStamp {
    const stamp: RuleVersionStamp = {
      ruleConfigId: ruleConfig.id,
      version: ruleConfig.version,
      type: ruleConfig.type,
      stampedAt: new Date(),
      checksum: this.generateChecksum(ruleConfig),
    };

    this.serviceLogger.debug({
      event: 'version_stamp_created',
      stamp: stamp,
    }, `Version stamp created for ${ruleConfig.type} v${ruleConfig.version}`);

    return stamp;
  }

  /**
   * Get audit log entries for a rule configuration
   */
  async getAuditLog(ruleConfigId?: string, limit: number = 50): Promise<AuditLogEntry[]> {
    let entries = this.auditLog;

    if (ruleConfigId) {
      entries = entries.filter(entry => entry.ruleConfigId === ruleConfigId);
    }

    // Sort by timestamp (newest first) and limit results
    return entries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get service statistics
   */
  getStats(): RuleConfigStats {
    return { ...this.stats };
  }

  /**
   * Get all active rule configurations (for system initialization)
   */
  async getActiveRuleConfigs(): Promise<Record<RuleType, RuleConfig | null>> {
    const activeConfigs: Record<RuleType, RuleConfig | null> = {
      arena: null,
      battle: null,
      chat: null,
      guild: null,
      player: null,
      moderation: null,
      system: null,
    };

    for (const typeAndId of Array.from(this.activeVersions.entries())) {
      const [type, configId] = typeAndId;
      const config = this.ruleConfigs.get(configId);
      if (config && config.isActive) {
        activeConfigs[type] = config;
      }
    }

    return activeConfigs;
  }

  /**
   * Export rule configuration for backup/migration
   */
  async exportRuleConfig(id: string): Promise<{ config: RuleConfig; auditLog: AuditLogEntry[] } | null> {
    const config = this.ruleConfigs.get(id);
    if (!config) {
      return null;
    }

    const auditEntries = await this.getAuditLog(id);
    
    return {
      config: config,
      auditLog: auditEntries,
    };
  }

  /**
   * Private method to log audit entries
   */
  private async logAuditEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      ...entry,
    };

    this.auditLog.push(auditEntry);
    this.stats.recentAuditEntries++;
    this.stats.lastAuditEntry = auditEntry.timestamp;

    // Keep audit log size manageable (in production, this would be persisted)
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000); // Keep most recent 5000 entries
    }

    this.serviceLogger.debug({
      event: 'audit_entry_logged',
      auditEntry: auditEntry,
    }, `Audit entry logged: ${entry.action} on ${entry.ruleConfigId}`);
  }

  /**
   * Set a rule config as the active version for its type
   */
  private setAsActiveVersion(type: RuleType, ruleConfigId: string): void {
    this.activeVersions.set(type, ruleConfigId);
    
    this.serviceLogger.debug({
      event: 'active_version_set',
      type: type,
      ruleConfigId: ruleConfigId,
    }, `Active version set for ${type}: ${ruleConfigId}`);
  }

  /**
   * Update service statistics
   */
  private updateStats(): void {
    this.stats.totalConfigs = this.ruleConfigs.size;
    this.stats.activeConfigs = 0;
    
    // Reset type counts
    for (const type of Object.keys(this.stats.configsByType) as RuleType[]) {
      this.stats.configsByType[type] = 0;
    }

    // Count configs by type and active status
    for (const config of Array.from(this.ruleConfigs.values())) {
      this.stats.configsByType[config.type]++;
      
      if (config.isActive) {
        this.stats.activeConfigs++;
      }

      if (!this.stats.lastConfigUpdate || config.updatedAt && config.updatedAt > this.stats.lastConfigUpdate) {
        this.stats.lastConfigUpdate = config.updatedAt;
      }
    }
  }

  /**
   * Compare semantic versions
   */
  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;

      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }

    return 0;
  }

  /**
   * Generate a simple checksum for rule config
   */
  private generateChecksum(ruleConfig: RuleConfig): string {
    const content = JSON.stringify({
      type: ruleConfig.type,
      version: ruleConfig.version,
      config: ruleConfig.config,
    });
    
    // Simple hash function (in production, would use proper crypto hash)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(16);
  }

  /**
   * Generate a UUID (simplified version)
   */
  private generateId(): string {
    return 'rule-' + Math.random().toString(36).substring(2) + '-' + Date.now().toString(36);
  }

  /**
   * Load default rule configurations
   */
  private loadDefaultConfigs(): void {
    const defaultConfigs = [
      {
        type: 'arena' as RuleType,
        version: '1.0.0',
        name: 'Default Arena Rules',
        description: 'Standard arena combat rules',
        config: {
          maxPlayersPerArena: 100,
          battleTimeout: 300000, // 5 minutes
          allowSpectators: true,
          enableRealTimeUpdates: true,
        },
        createdBy: 'system',
        tags: ['default', 'arena'],
      },
      {
        type: 'battle' as RuleType,
        version: '1.0.0',
        name: 'Default Battle Rules',
        description: 'Standard battle resolution rules',
        config: {
          maxTurnTime: 30000, // 30 seconds
          enableReplayCapture: true,
          allowSurrender: true,
          experienceMultiplier: 1.0,
        },
        createdBy: 'system',
        tags: ['default', 'battle'],
      },
      {
        type: 'chat' as RuleType,
        version: '1.0.0',
        name: 'Default Chat Rules',
        description: 'Standard chat moderation rules',
        config: {
          maxMessageLength: 500,
          rateLimit: 10, // messages per minute
          enableProfanityFilter: true,
          enableSpamDetection: true,
        },
        createdBy: 'system',
        tags: ['default', 'chat'],
      },
    ];

    for (const configInput of defaultConfigs) {
      try {
        // Create without logging (since it's initialization)
        const ruleConfig: RuleConfig = {
          id: this.generateId(),
          type: configInput.type,
          version: configInput.version,
          name: configInput.name,
          description: configInput.description,
          config: configInput.config,
          isActive: true,
          createdAt: new Date(),
          createdBy: 'system',
          tags: configInput.tags,
        };

        this.ruleConfigs.set(ruleConfig.id, ruleConfig);
        this.setAsActiveVersion(ruleConfig.type, ruleConfig.id);
      } catch (error) {
        this.serviceLogger.error({
          event: 'default_config_load_error',
          configInput: configInput,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Failed to load default rule configuration');
      }
    }

    this.updateStats();

    this.serviceLogger.info({
      event: 'default_configs_loaded',
      count: defaultConfigs.length,
      stats: this.stats,
    }, `Loaded ${defaultConfigs.length} default rule configurations`);
  }
}

/**
 * Factory function to create RuleConfigService instance
 */
export function createRuleConfigService(): RuleConfigService {
  return new RuleConfigService();
}