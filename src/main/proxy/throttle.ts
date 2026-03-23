import { resolveThrottleProfile, type ResolvedThrottleProfile, type ThrottleSettings } from '../../shared/throttle';

interface ThrottleLaneState {
  nextAvailableAt: number;
}

function getTransmissionDelayMs(chunkSize: number, kbps: number | null): number {
  if (!kbps || chunkSize <= 0) {
    return 0;
  }

  return Math.ceil((chunkSize * 8) / kbps);
}

function scheduleChunk(
  lane: ThrottleLaneState,
  chunk: Buffer,
  kbps: number | null,
  callback: (err: null, chunk: Buffer) => void,
): void {
  const transmissionDelayMs = getTransmissionDelayMs(chunk.length, kbps);
  if (transmissionDelayMs === 0) {
    callback(null, chunk);
    return;
  }

  const now = Date.now();
  const startAt = Math.max(lane.nextAvailableAt, now);
  const totalDelayMs = Math.max(0, startAt - now) + transmissionDelayMs;
  lane.nextAvailableAt = startAt + transmissionDelayMs;

  setTimeout(() => callback(null, chunk), totalDelayMs);
}

export class FlowThrottleController {
  private readonly resolvedProfile: ResolvedThrottleProfile;
  private readonly uploadLane: ThrottleLaneState = { nextAvailableAt: 0 };
  private readonly downloadLane: ThrottleLaneState = { nextAvailableAt: 0 };

  constructor(settings: ThrottleSettings) {
    this.resolvedProfile = resolveThrottleProfile(settings);
  }

  getProfile(): ResolvedThrottleProfile {
    return this.resolvedProfile;
  }

  getConnectionLatencyMs(): number {
    return this.resolvedProfile.active ? this.resolvedProfile.latencyMs : 0;
  }

  scheduleUploadChunk(chunk: Buffer, callback: (err: null, chunk: Buffer) => void): void {
    scheduleChunk(this.uploadLane, chunk, this.resolvedProfile.uploadKbps, callback);
  }

  scheduleDownloadChunk(chunk: Buffer, callback: (err: null, chunk: Buffer) => void): void {
    scheduleChunk(this.downloadLane, chunk, this.resolvedProfile.downloadKbps, callback);
  }
}

export function createFlowThrottleController(settings: ThrottleSettings): FlowThrottleController {
  return new FlowThrottleController(settings);
}
