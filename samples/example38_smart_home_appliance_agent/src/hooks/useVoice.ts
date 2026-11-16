/** React binding for the independently testable browser voice transport. */
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  VoiceClient,
  type VoiceOptions,
  type VoiceSnapshot,
} from "@/lib/voice-client";

export interface VoiceSession extends VoiceSnapshot {
  connect: (microphone: boolean) => Promise<boolean>;
  stop: () => void;
  sendText: (value: string) => Promise<boolean>;
  toggleMute: () => void;
  cancel: () => void;
}

export function useVoice(options: VoiceOptions): VoiceSession {
  const [client] = useState(() => new VoiceClient(options));
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => {
    client.configure(options);
  }, [client, options.model, options.language, options.onHome]);
  useEffect(() => () => client.stop(), [client]);
  return {
    ...snapshot,
    connect: client.connect,
    stop: client.stop,
    sendText: client.sendText,
    toggleMute: client.toggleMute,
    cancel: client.cancel,
  };
}
