/** Shared demo limits, not manufacturer operating specifications. */

// Used by server command validation and the browser device inspector so safe
// demo ranges cannot drift between manual controls and model function calls.
export const CONTROL_LIMITS = {
  tv: { volume: { min: 0, max: 100 } },
  fridge: {
    fridgeTemp: { min: 2, max: 8 },
    freezerTemp: { min: -24, max: -16 },
  },
  ac: { temperature: { min: 16, max: 30 } },
  humidifier: { targetHumidity: { min: 30, max: 70 } },
  lights: { brightness: { min: 0, max: 100 } },
} as const;
