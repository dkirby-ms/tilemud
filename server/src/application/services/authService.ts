import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { IPlayersRepository } from '../../infra/persistence/playersRepository';
import { createServiceLogger } from '../../infra/monitoring/logger';
import { config } from '../../config/env';

// Auth input validation schemas
export const AuthTokenInputSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  clientVersion: z.string().optional(),
  playerDisplayName: z.string().min(3).max(32).optional(),
});

export const SessionTicketSchema = z.object({
  sessionId: z.string().uuid(),
  playerId: z.string().uuid(),
  displayName: z.string().min(3).max(32),
  expiresAt: z.date(),
  issuedAt: z.date(),
  permissions: z.array(z.string()).optional(),
});

export type AuthTokenInput = z.infer<typeof AuthTokenInputSchema>;
export type SessionTicket = z.infer<typeof SessionTicketSchema>;

export interface AuthResult {
  success: boolean;
  ticket?: SessionTicket;
  error?: string;
  retryAfterMs?: number;
}

/**
 * Auth service implementing FR-009: Session handshake and ticket issuance
 * Validates external tokens and creates internal session tickets
 */
export class AuthService {
  private readonly serviceLogger = createServiceLogger('AuthService');

  constructor(private readonly playersRepo: IPlayersRepository) {}

  /**
   * Validate an external auth token and issue a session ticket
   * Mock implementation for development - replace with real auth provider
   */
  async issueSessionTicket(input: AuthTokenInput): Promise<AuthResult> {
    try {
      // Validate input
      const validatedInput = AuthTokenInputSchema.parse(input);
      
      this.serviceLogger.info({
        event: 'auth_attempt',
        token: validatedInput.token.substring(0, 8) + '...', // Log prefix only for security
        clientVersion: validatedInput.clientVersion,
      }, 'Processing auth token');

      // Mock token validation logic - replace with real auth provider
      const authResult = await this.validateExternalToken(validatedInput.token);
      if (!authResult.valid) {
        this.serviceLogger.warn({
          event: 'auth_failed',
          reason: authResult.reason,
          token: validatedInput.token.substring(0, 8) + '...',
        }, 'Token validation failed');
        
        return {
          success: false,
          error: authResult.reason || 'Invalid token',
          ...(authResult.retryAfterMs !== undefined && { retryAfterMs: authResult.retryAfterMs }),
        };
      }

      // Get or create player record
      if (!authResult.externalPlayerId) {
        this.serviceLogger.error({
          event: 'missing_external_id',
          token: validatedInput.token.substring(0, 8) + '...',
        }, 'External player ID missing from auth result');
        
        return {
          success: false,
          error: 'Invalid authentication data',
        };
      }

      const player = await this.getOrCreatePlayer(
        authResult.externalPlayerId,
        validatedInput.playerDisplayName || authResult.displayName || 'Anonymous'
      );

      if (!player) {
        this.serviceLogger.error({
          event: 'player_creation_failed',
          externalPlayerId: authResult.externalPlayerId,
        }, 'Failed to get or create player');
        
        return {
          success: false,
          error: 'Failed to create player session',
        };
      }

      // Generate session ticket
      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (config.SESSION_TTL_SECONDS * 1000));

      const ticket: SessionTicket = {
        sessionId,
        playerId: player.id,
        displayName: player.displayName,
        expiresAt,
        issuedAt: now,
        permissions: this.getPlayerPermissions(player.status),
      };

      // Update player last login
      await this.playersRepo.updateLastLogin(player.id);

      this.serviceLogger.info({
        event: 'session_issued',
        sessionId,
        playerId: player.id,
        displayName: player.displayName,
        expiresAt,
      }, `Session ticket issued for player ${player.displayName}`);

      return {
        success: true,
        ticket,
      };

    } catch (error) {
      this.serviceLogger.error({
        event: 'auth_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        input: { ...input, token: input.token.substring(0, 8) + '...' },
      }, 'Auth service error');

      return {
        success: false,
        error: 'Authentication service temporarily unavailable',
        retryAfterMs: 5000,
      };
    }
  }

  /**
   * Validate a session ticket
   */
  async validateSessionTicket(ticket: SessionTicket): Promise<boolean> {
    try {
      // Validate ticket structure
      SessionTicketSchema.parse(ticket);

      // Check expiration
      if (new Date() > ticket.expiresAt) {
        this.serviceLogger.debug({
          event: 'ticket_expired',
          sessionId: ticket.sessionId,
          playerId: ticket.playerId,
          expiresAt: ticket.expiresAt,
        }, 'Session ticket expired');
        return false;
      }

      // Verify player still exists and is active
      const player = await this.playersRepo.findById(ticket.playerId);
      if (!player || player.status !== 'active') {
        this.serviceLogger.warn({
          event: 'player_inactive',
          sessionId: ticket.sessionId,
          playerId: ticket.playerId,
          playerStatus: player?.status,
        }, 'Player inactive or not found');
        return false;
      }

      return true;
    } catch (error) {
      this.serviceLogger.error({
        event: 'ticket_validation_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId: ticket.sessionId,
      }, 'Ticket validation failed');
      return false;
    }
  }

  /**
   * Refresh a session ticket (extend expiration)
   */
  async refreshSessionTicket(ticket: SessionTicket): Promise<AuthResult> {
    try {
      // Validate current ticket
      const isValid = await this.validateSessionTicket(ticket);
      if (!isValid) {
        return {
          success: false,
          error: 'Invalid or expired session',
        };
      }

      // Create new ticket with extended expiration
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (config.SESSION_TTL_SECONDS * 1000));

      const refreshedTicket: SessionTicket = {
        ...ticket,
        sessionId: uuidv4(), // New session ID for security
        expiresAt,
        issuedAt: now,
      };

      this.serviceLogger.debug({
        event: 'session_refreshed',
        oldSessionId: ticket.sessionId,
        newSessionId: refreshedTicket.sessionId,
        playerId: ticket.playerId,
        expiresAt,
      }, 'Session ticket refreshed');

      return {
        success: true,
        ticket: refreshedTicket,
      };
    } catch (error) {
      this.serviceLogger.error({
        event: 'refresh_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId: ticket.sessionId,
      }, 'Session refresh failed');

      return {
        success: false,
        error: 'Failed to refresh session',
      };
    }
  }

  /**
   * Mock external token validation - replace with real auth provider
   */
  private async validateExternalToken(token: string): Promise<{
    valid: boolean;
    externalPlayerId?: string;
    displayName?: string;
    reason?: string;
    retryAfterMs?: number;
  }> {
    // Mock validation logic for development
    if (token === 'invalid') {
      return { valid: false, reason: 'Invalid token' };
    }
    
    if (token === 'expired') {
      return { valid: false, reason: 'Token expired' };
    }
    
    if (token === 'rate_limited') {
      return { valid: false, reason: 'Rate limited', retryAfterMs: 10000 };
    }

    // Mock successful validation
    const mockExternalId = token.includes('test') ? `mock_${token}` : `user_${token.substring(0, 8)}`;
    const mockDisplayName = token.includes('test') ? 'TestPlayer' : `Player_${token.substring(0, 4)}`;
    
    return {
      valid: true,
      externalPlayerId: mockExternalId,
      displayName: mockDisplayName,
    };
  }

  /**
   * Get or create player from external ID
   */
  private async getOrCreatePlayer(externalPlayerId: string, displayName: string) {
    try {
      // Try to find existing player by external ID (stored in a field we'd add to Player entity)
      // For now, we'll create a simple lookup by display name as a placeholder
      let player = await this.playersRepo.findByDisplayName(displayName);
      
      if (!player) {
        // Create new player
        player = await this.playersRepo.create({
          displayName: displayName,
          status: 'active',
          externalId: externalPlayerId, // This field would need to be added to Player entity
        } as any); // Type assertion for mock - real implementation would have proper types
        
        this.serviceLogger.info({
          event: 'player_created',
          playerId: player.id,
          displayName: player.displayName,
          externalPlayerId,
        }, `Created new player: ${player.displayName}`);
      }
      
      return player;
    } catch (error) {
      this.serviceLogger.error({
        event: 'player_lookup_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        externalPlayerId,
        displayName,
      }, 'Failed to get or create player');
      return null;
    }
  }

  /**
   * Get player permissions based on status
   */
  private getPlayerPermissions(status: string): string[] {
    const basePermissions = ['play', 'chat', 'join_guild'];
    
    switch (status) {
      case 'admin':
        return [...basePermissions, 'moderate', 'admin'];
      case 'moderator':
        return [...basePermissions, 'moderate'];
      case 'banned':
        return []; // No permissions
      case 'muted':
        return basePermissions.filter(p => p !== 'chat');
      default:
        return basePermissions;
    }
  }
}

// Factory function
export function createAuthService(playersRepo: IPlayersRepository): AuthService {
  return new AuthService(playersRepo);
}