import type { RealtimeIntentEnvelope } from "@/types";
import { intentMovePayloadSchema, moveDirectionSchema } from "@/types";
import type { SessionRealtimeClient } from "@/features/session/colyseusClient";
import { getSessionState } from "@/features/session/sessionStore";

export interface MovementIntentOptions {
  direction: string;
  magnitude?: number;
  metadata?: Record<string, unknown>;
}

export interface MovementControllerDependencies {
  realtimeClient: Pick<SessionRealtimeClient, "sendIntent" | "isConnected">;
}

export interface MovementController {
  send: (options: MovementIntentOptions) => Promise<void>;
}

const isSessionReady = (status: string): boolean => status === "active" || status === "degraded";

export const createMovementController = (dependencies: MovementControllerDependencies): MovementController => {
  const { realtimeClient } = dependencies;

  const send = async ({ direction, magnitude = 1, metadata }: MovementIntentOptions): Promise<void> => {
    const store = getSessionState();

    if (!isSessionReady(store.status)) {
      throw new Error(`Cannot send movement intent while session status is ${store.status}`);
    }

    if (!realtimeClient.isConnected()) {
      throw new Error("Realtime client is not connected");
    }

    const normalizedDirection = moveDirectionSchema.parse(direction);
    const payloadInput: Record<string, unknown> = {
      sequence: store.nextSequence(),
      direction: normalizedDirection,
      magnitude
    };

    if (metadata && Object.keys(metadata).length > 0) {
      payloadInput.metadata = metadata;
    }

    const payload = intentMovePayloadSchema.parse(payloadInput);

    const envelope: RealtimeIntentEnvelope = {
      type: "intent.move",
      payload
    };

    await realtimeClient.sendIntent(envelope);
  };

  return { send };
};
