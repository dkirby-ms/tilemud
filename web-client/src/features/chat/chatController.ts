import type { RealtimeIntentEnvelope } from "@/types";
import { intentChatPayloadSchema } from "@/types";
import type { SessionRealtimeClient } from "@/features/session/colyseusClient";
import { getSessionState } from "@/features/session/sessionStore";

export interface ChatIntentOptions {
  channel: string;
  message: string;
  locale?: string;
}

export interface ChatControllerDependencies {
  realtimeClient: Pick<SessionRealtimeClient, "sendIntent" | "isConnected">;
}

export interface ChatController {
  send: (options: ChatIntentOptions) => Promise<void>;
}

const isSessionReady = (status: string): boolean => status === "active" || status === "degraded";

export const createChatController = ({ realtimeClient }: ChatControllerDependencies): ChatController => {
  const send = async ({ channel, message, locale }: ChatIntentOptions): Promise<void> => {
    const store = getSessionState();

    if (!isSessionReady(store.status)) {
      throw new Error(`Cannot send chat intent while session status is ${store.status}`);
    }

    if (!realtimeClient.isConnected()) {
      throw new Error("Realtime client is not connected");
    }

    const payload = intentChatPayloadSchema.parse({
      sequence: store.nextSequence(),
      channel,
      message,
      ...(locale ? { locale } : {})
    });

    const envelope: RealtimeIntentEnvelope = {
      type: "intent.chat",
      payload
    };

    await realtimeClient.sendIntent(envelope);
  };

  return { send };
};
