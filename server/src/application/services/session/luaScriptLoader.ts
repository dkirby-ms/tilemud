/**
 * Lua script loader for Redis operations
 * Loads and caches Lua scripts for atomic operations
 */

import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

export interface LoadedScript {
  sha: string;
  source: string;
}

export class LuaScriptLoader {
  private redis: Redis;
  private scriptCache = new Map<string, LoadedScript>();
  private scriptsLoaded = false;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Load all Lua scripts from the scripts directory
   */
  async loadScripts(): Promise<void> {
    if (this.scriptsLoaded) return;

    try {
      const scriptsDir = path.join(__dirname);
      const scriptFiles = fs.readdirSync(scriptsDir).filter(file => file.endsWith('.lua'));

      for (const scriptFile of scriptFiles) {
        const scriptName = path.basename(scriptFile, '.lua');
        const scriptPath = path.join(scriptsDir, scriptFile);
        const scriptSource = fs.readFileSync(scriptPath, 'utf8');

        // Load script into Redis and get SHA
        const sha = await this.redis.script('LOAD', scriptSource) as string;
        
        this.scriptCache.set(scriptName, {
          sha,
          source: scriptSource
        });

        console.info(`Loaded Lua script: ${scriptName} (${sha})`);
      }

      this.scriptsLoaded = true;
      console.info(`Successfully loaded ${this.scriptCache.size} Lua scripts`);
    } catch (error) {
      console.error('Failed to load Lua scripts:', error);
      throw error;
    }
  }

  /**
   * Execute a loaded Lua script by name
   */
  async executeScript(
    scriptName: string, 
    keys: string[] = [], 
    args: (string | number)[] = []
  ): Promise<any> {
    const script = this.scriptCache.get(scriptName);
    if (!script) {
      throw new Error(`Script not found: ${scriptName}`);
    }

    try {
      // Try to execute with SHA first (faster)
      return await this.redis.evalsha(script.sha, keys.length, ...keys, ...args.map(String));
    } catch (error: any) {
      // If script not found in Redis cache, reload and retry
      if (error.message && error.message.includes('NOSCRIPT')) {
        console.warn(`Script ${scriptName} not in Redis cache, reloading...`);
        const sha = await this.redis.script('LOAD', script.source) as string;
        this.scriptCache.set(scriptName, { ...script, sha });
        return await this.redis.evalsha(sha, keys.length, ...keys, ...args.map(String));
      }
      throw error;
    }
  }

  /**
   * Check if script is loaded
   */
  hasScript(scriptName: string): boolean {
    return this.scriptCache.has(scriptName);
  }

  /**
   * Get script SHA for direct execution
   */
  getScriptSha(scriptName: string): string | null {
    const script = this.scriptCache.get(scriptName);
    return script ? script.sha : null;
  }

  /**
   * Reload a specific script
   */
  async reloadScript(scriptName: string): Promise<void> {
    const scriptsDir = path.join(__dirname);
    const scriptPath = path.join(scriptsDir, `${scriptName}.lua`);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script file not found: ${scriptPath}`);
    }

    const scriptSource = fs.readFileSync(scriptPath, 'utf8');
    const sha = await this.redis.script('LOAD', scriptSource) as string;

    this.scriptCache.set(scriptName, { sha, source: scriptSource });
    console.info(`Reloaded Lua script: ${scriptName} (${sha})`);
  }

  /**
   * Clear script cache (for testing)
   */
  clearCache(): void {
    this.scriptCache.clear();
    this.scriptsLoaded = false;
  }

  /**
   * Get statistics about loaded scripts
   */
  getStats(): {
    scriptsLoaded: number;
    scriptNames: string[];
    loaded: boolean;
  } {
    return {
      scriptsLoaded: this.scriptCache.size,
      scriptNames: Array.from(this.scriptCache.keys()),
      loaded: this.scriptsLoaded
    };
  }
}

// Global script loader instance
let globalScriptLoader: LuaScriptLoader | null = null;

/**
 * Initialize global script loader
 */
export function initializeScriptLoader(redis: Redis): LuaScriptLoader {
  globalScriptLoader = new LuaScriptLoader(redis);
  return globalScriptLoader;
}

/**
 * Get global script loader instance
 */
export function getScriptLoader(): LuaScriptLoader {
  if (!globalScriptLoader) {
    throw new Error('Script loader not initialized. Call initializeScriptLoader first.');
  }
  return globalScriptLoader;
}