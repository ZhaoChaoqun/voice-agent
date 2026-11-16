/** Authoritative appliance state comes from the same local demo server as tools. */
import { useCallback, useEffect, useState } from "react";

import type {
  DemoConfig,
  DeviceCommand,
  HomeState,
  KnowledgeSource,
  SceneId,
} from "@shared/protocol";
import { errorMessage, request } from "@/lib/api";

export interface HomeController {
  config: DemoConfig | null;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  control: (command: DeviceCommand) => Promise<void>;
  scene: (scene: SceneId) => Promise<void>;
  reset: () => Promise<void>;
  updateHome: (home: HomeState) => void;
  addKnowledge: (source: KnowledgeSource) => void;
  dismissError: () => void;
}

export function useHome(): HomeController {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const incoming = await request<DemoConfig>("/api/config");
      setConfig((current) =>
        current && current.home.revision > incoming.home.revision
          ? { ...incoming, home: current.home }
          : incoming,
      );
      setError("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateHome = useCallback((home: HomeState): void => {
    setConfig((current) => {
      if (!current || home.revision < current.home.revision) return current;
      return { ...current, home };
    });
  }, []);

  const mutate = useCallback(
    async (path: string, body: unknown): Promise<void> => {
      setBusy(true);
      try {
        updateHome(await request<HomeState>(path, body));
        setError("");
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
    [updateHome],
  );

  const control = useCallback(
    (command: DeviceCommand): Promise<void> =>
      mutate("/api/devices/control", command),
    [mutate],
  );
  const scene = useCallback(
    (scene: SceneId): Promise<void> => mutate("/api/scenes", { scene }),
    [mutate],
  );
  const reset = useCallback(
    (): Promise<void> => mutate("/api/reset", {}),
    [mutate],
  );
  const addKnowledge = useCallback((source: KnowledgeSource): void => {
    setConfig((current) =>
      current
        ? { ...current, knowledge: [...current.knowledge, source] }
        : current,
    );
  }, []);

  return {
    config,
    error,
    busy,
    refresh,
    control,
    scene,
    reset,
    updateHome,
    addKnowledge,
    dismissError: () => setError(""),
  };
}
