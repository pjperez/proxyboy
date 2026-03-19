export type ThrottleProfileId = 'none' | '3g' | 'slow-3g' | 'lte' | 'wifi' | 'custom';

export interface CustomThrottleProfile {
  downloadKbps: number;
  uploadKbps: number;
  latencyMs: number;
}

export interface ThrottleSettings {
  profileId: ThrottleProfileId;
  customProfile: CustomThrottleProfile;
}

export interface ThrottleProfilePreset {
  id: Exclude<ThrottleProfileId, 'custom'>;
  label: string;
  downloadKbps: number | null;
  uploadKbps: number | null;
  latencyMs: number;
  description: string;
}

export interface ResolvedThrottleProfile {
  id: ThrottleProfileId;
  label: string;
  downloadKbps: number | null;
  uploadKbps: number | null;
  latencyMs: number;
  description: string;
  active: boolean;
}

export const DEFAULT_CUSTOM_THROTTLE_PROFILE: CustomThrottleProfile = {
  downloadKbps: 1000,
  uploadKbps: 750,
  latencyMs: 100,
};

export const DEFAULT_THROTTLE_SETTINGS: ThrottleSettings = {
  profileId: 'none',
  customProfile: DEFAULT_CUSTOM_THROTTLE_PROFILE,
};

export const THROTTLE_PROFILE_PRESETS: readonly ThrottleProfilePreset[] = [
  {
    id: 'none',
    label: 'No throttling',
    downloadKbps: null,
    uploadKbps: null,
    latencyMs: 0,
    description: 'Use the full connection speed with no added delay.',
  },
  {
    id: '3g',
    label: '3G',
    downloadKbps: 400,
    uploadKbps: 400,
    latencyMs: 150,
    description: 'Approximate a typical 3G mobile connection.',
  },
  {
    id: 'slow-3g',
    label: 'Slow 3G',
    downloadKbps: 50,
    uploadKbps: 50,
    latencyMs: 2000,
    description: 'Simulate a very constrained mobile connection.',
  },
  {
    id: 'lte',
    label: 'LTE',
    downloadKbps: 4000,
    uploadKbps: 3000,
    latencyMs: 50,
    description: 'Simulate a moderate cellular LTE connection.',
  },
  {
    id: 'wifi',
    label: 'WiFi',
    downloadKbps: 30000,
    uploadKbps: 15000,
    latencyMs: 2,
    description: 'Simulate a fast local WiFi connection.',
  },
] as const;

const THROTTLE_PROFILE_IDS = new Set<ThrottleProfileId>([
  'none',
  '3g',
  'slow-3g',
  'lte',
  'wifi',
  'custom',
]);

function sanitizeKbps(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function sanitizeLatencyMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(value));
}

export function isThrottleProfileId(value: unknown): value is ThrottleProfileId {
  return typeof value === 'string' && THROTTLE_PROFILE_IDS.has(value as ThrottleProfileId);
}

export function normalizeCustomThrottleProfile(profile: Partial<CustomThrottleProfile> | null | undefined): CustomThrottleProfile {
  return {
    downloadKbps: sanitizeKbps(profile?.downloadKbps, DEFAULT_CUSTOM_THROTTLE_PROFILE.downloadKbps),
    uploadKbps: sanitizeKbps(profile?.uploadKbps, DEFAULT_CUSTOM_THROTTLE_PROFILE.uploadKbps),
    latencyMs: sanitizeLatencyMs(profile?.latencyMs, DEFAULT_CUSTOM_THROTTLE_PROFILE.latencyMs),
  };
}

export function normalizeThrottleSettings(settings: Partial<ThrottleSettings> | null | undefined): ThrottleSettings {
  return {
    profileId: isThrottleProfileId(settings?.profileId) ? settings.profileId : DEFAULT_THROTTLE_SETTINGS.profileId,
    customProfile: normalizeCustomThrottleProfile(settings?.customProfile),
  };
}

export function resolveThrottleProfile(settings: ThrottleSettings): ResolvedThrottleProfile {
  if (settings.profileId === 'custom') {
    return {
      id: 'custom',
      label: 'Custom',
      ...normalizeCustomThrottleProfile(settings.customProfile),
      description: 'Use the custom upload, download, and latency values.',
      active: true,
    };
  }

  const preset = THROTTLE_PROFILE_PRESETS.find((entry) => entry.id === settings.profileId) ?? THROTTLE_PROFILE_PRESETS[0];

  return {
    id: preset.id,
    label: preset.label,
    downloadKbps: preset.downloadKbps,
    uploadKbps: preset.uploadKbps,
    latencyMs: preset.latencyMs,
    description: preset.description,
    active: preset.id !== 'none',
  };
}

export function getThrottleProfileLabel(profileId: ThrottleProfileId): string {
  return resolveThrottleProfile(normalizeThrottleSettings({ profileId })).label;
}
