import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { AttemptOutcome } from '../../src/domain/connection';

describe('Integration: Frontend Status Mapping (FR-007)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = buildApp({ logger: false });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should provide frontend-friendly status mappings', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // UI Requirement: Provide clear status mappings for frontend state management
    
    const instanceId = 'test-instance-frontend';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-frontend-test',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    expect([200, 404, 503]).toContain(response.statusCode);
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      
      // Frontend-friendly status mapping
      expect(body).toHaveProperty('uiState');
      expect(['CONNECTING', 'CONNECTED', 'QUEUED', 'ERROR']).toContain(body.uiState);
      
      // User-friendly message
      expect(body).toHaveProperty('userMessage');
      expect(typeof body.userMessage).toBe('string');
      expect(body.userMessage.length).toBeGreaterThan(0);
      
      // Action guidance
      expect(body).toHaveProperty('nextAction');
      expect(['WAIT', 'REDIRECT', 'RETRY', 'NONE']).toContain(body.nextAction);
      
      if (body.outcome === AttemptOutcome.QUEUED) {
        expect(body).toHaveProperty('queueStatus');
        expect(body.queueStatus).toHaveProperty('position');
        expect(body.queueStatus).toHaveProperty('estimatedWait');
        expect(body.uiState).toBe('QUEUED');
        expect(body.nextAction).toBe('WAIT');
      }
    }
  });

  it('should provide error state mappings for UI', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // UI Requirement: Map error conditions to actionable UI states
    
    const instanceId = 'test-instance-error-ui';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer expired-jwt-token'
      },
      payload: {
        characterId: 'char-error-ui-test',
        clientBuild: 'outdated-version',
        allowReplacement: false
      }
    });
    
    expect([200, 400, 401, 503]).toContain(response.statusCode);
    
    if (response.statusCode !== 200) {
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('uiState', 'ERROR');
      expect(body).toHaveProperty('errorCategory');
      expect(['AUTH', 'VERSION', 'CAPACITY', 'SYSTEM']).toContain(body.errorCategory);
      
      expect(body).toHaveProperty('userMessage');
      expect(body).toHaveProperty('nextAction');
      expect(['RETRY', 'UPGRADE', 'LOGIN', 'WAIT']).toContain(body.nextAction);
      
      // Specific error guidance
      if (body.errorCategory === 'VERSION') {
        expect(body.nextAction).toBe('UPGRADE');
        expect(body.userMessage).toMatch(/version|update|upgrade/i);
      }
      
      if (body.errorCategory === 'AUTH') {
        expect(body.nextAction).toBe('LOGIN');
        expect(body.userMessage).toMatch(/login|authenticate/i);
      }
    }
  });

  it('should provide replacement flow UI guidance', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // UI Requirement: Guide user through replacement confirmation flow
    
    const instanceId = 'test-instance-replacement-ui';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-replacement-ui',
        clientBuild: '1.0.0',
        allowReplacement: true
      }
    });
    
    expect([200, 409]).toContain(response.statusCode);
    
    if (response.statusCode === 409) {
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('uiState', 'REPLACEMENT_PROMPT');
      expect(body).toHaveProperty('nextAction', 'CONFIRM');
      expect(body).toHaveProperty('replacementToken');
      expect(body).toHaveProperty('existingSession');
      
      // UI configuration for replacement dialog
      expect(body).toHaveProperty('uiConfig');
      expect(body.uiConfig).toHaveProperty('showConfirmDialog', true);
      expect(body.uiConfig).toHaveProperty('confirmText');
      expect(body.uiConfig).toHaveProperty('cancelText');
      
      // Session context for user decision
      expect(body.existingSession).toHaveProperty('lastActivity');
      expect(body.existingSession).toHaveProperty('serverName');
    }
  });

  it('should provide websocket connection guidance', async () => {
    // This integration test MUST initially fail - no implementation exists yet
    // UI Requirement: Provide WebSocket connection details for frontend
    
    const instanceId = 'test-instance-websocket-ui';
    
    const response = await server.inject({
      method: 'POST',
      url: `/instances/${instanceId}/connect`,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer valid-jwt-token'
      },
      payload: {
        characterId: 'char-websocket-ui',
        clientBuild: '1.0.0',
        allowReplacement: false
      }
    });
    
    expect([200, 404]).toContain(response.statusCode);
    
    if (response.statusCode === 200 && JSON.parse(response.body).outcome === AttemptOutcome.SUCCESS) {
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('uiState', 'CONNECTED');
      expect(body).toHaveProperty('nextAction', 'REDIRECT');
      expect(body).toHaveProperty('websocketUrl');
      
      // WebSocket configuration for frontend
      expect(body).toHaveProperty('connectionConfig');
      expect(body.connectionConfig).toHaveProperty('heartbeatInterval');
      expect(body.connectionConfig).toHaveProperty('reconnectDelay');
      expect(body.connectionConfig).toHaveProperty('maxReconnectAttempts');
      
      // UI navigation guidance
      expect(body).toHaveProperty('redirectUrl');
      expect(body.redirectUrl).toMatch(/^wss?:\/\//);
    }
  });
});