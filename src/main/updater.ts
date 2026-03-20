import { app, autoUpdater } from 'electron';
import { EventEmitter } from 'events';
import type { AppUpdateState } from '../shared/types';

const DEFAULT_UPDATE_HOST = 'https://update.electronjs.org';
const DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function isAutoUpdateSupported(platform = process.platform, isPackaged = app.isPackaged): boolean {
  return isPackaged && platform === 'win32';
}

export function buildUpdateFeedUrl(
  repo: string,
  version: string,
  platform = process.platform,
  arch = process.arch,
  host = DEFAULT_UPDATE_HOST,
): string {
  return `${host.replace(/\/+$/, '')}/${repo}/${platform}-${arch}/${version}`;
}

function inferReleaseVersion(args: unknown[]): string | undefined {
  for (const value of args) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

export class UpdateManager extends EventEmitter {
  private readonly state: AppUpdateState;
  private intervalId: NodeJS.Timeout | null = null;
  private listenersAttached = false;
  private configured = false;
  private readonly onCheckingForUpdate = () => {
    this.state.checking = true;
    this.state.error = undefined;
    this.emitState();
  };
  private readonly onUpdateAvailable = (...args: unknown[]) => {
    this.state.checking = false;
    this.state.updateAvailable = true;
    this.state.updateDownloaded = false;
    this.state.latestVersion = inferReleaseVersion(args);
    this.state.error = undefined;
    this.state.lastCheckedAt = Date.now();
    this.emitState();
  };
  private readonly onUpdateNotAvailable = () => {
    this.state.checking = false;
    this.state.updateAvailable = false;
    this.state.updateDownloaded = false;
    this.state.latestVersion = undefined;
    this.state.error = undefined;
    this.state.lastCheckedAt = Date.now();
    this.emitState();
  };
  private readonly onUpdateDownloaded = (...args: unknown[]) => {
    this.state.checking = false;
    this.state.updateAvailable = true;
    this.state.updateDownloaded = true;
    this.state.latestVersion = inferReleaseVersion(args) || this.state.latestVersion;
    this.state.error = undefined;
    this.state.lastCheckedAt = Date.now();
    this.emitState();
  };
  private readonly onError = (error: Error) => {
    this.state.checking = false;
    this.state.error = error.message;
    this.state.lastCheckedAt = Date.now();
    this.emitState();
  };

  constructor(
    private readonly repo: string,
    enabled: boolean,
  ) {
    super();
    this.state = {
      supported: isAutoUpdateSupported(),
      enabled,
      checking: false,
      updateAvailable: false,
      updateDownloaded: false,
      currentVersion: app.getVersion(),
    };
  }

  init(): void {
    if (!this.state.supported) {
      return;
    }

    this.attachListeners();
    this.configureFeed();

    if (this.state.enabled) {
      this.startAutomaticChecks();
    }
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  setEnabled(enabled: boolean): { success: boolean; state: AppUpdateState } {
    this.state.enabled = enabled;

    if (enabled) {
      this.startAutomaticChecks();
    } else {
      this.stopAutomaticChecks();
      this.state.checking = false;
    }

    this.emitState();
    return { success: true, state: this.getState() };
  }

  async checkForUpdates(): Promise<{ success: boolean; state: AppUpdateState; error?: string }> {
    if (!this.state.supported) {
      this.state.error = 'Auto-update is only supported in packaged Windows builds.';
      this.emitState();
      return { success: false, state: this.getState(), error: this.state.error };
    }

    this.configureFeed();

    try {
      this.state.error = undefined;
      this.state.checking = true;
      this.emitState();
      autoUpdater.checkForUpdates();
      return { success: true, state: this.getState() };
    } catch (error: any) {
      this.state.checking = false;
      this.state.error = error.message;
      this.state.lastCheckedAt = Date.now();
      this.emitState();
      return { success: false, state: this.getState(), error: error.message };
    }
  }

  installUpdate(): { success: boolean; error?: string } {
    if (!this.state.updateDownloaded) {
      return { success: false, error: 'No downloaded update is ready to install yet.' };
    }

    autoUpdater.quitAndInstall();
    return { success: true };
  }

  dispose(): void {
    this.stopAutomaticChecks();
    if (this.listenersAttached) {
      autoUpdater.removeListener('checking-for-update', this.onCheckingForUpdate);
      autoUpdater.removeListener('update-available', this.onUpdateAvailable);
      autoUpdater.removeListener('update-not-available', this.onUpdateNotAvailable);
      autoUpdater.removeListener('update-downloaded', this.onUpdateDownloaded);
      autoUpdater.removeListener('error', this.onError);
      this.listenersAttached = false;
    }
  }

  private startAutomaticChecks(): void {
    this.stopAutomaticChecks();
    void this.checkForUpdates();
    this.intervalId = setInterval(() => {
      void this.checkForUpdates();
    }, DEFAULT_UPDATE_INTERVAL_MS);
  }

  private stopAutomaticChecks(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private configureFeed(): void {
    if (this.configured) {
      return;
    }

    autoUpdater.setFeedURL({
      url: buildUpdateFeedUrl(this.repo, app.getVersion()),
      headers: {
        'User-Agent': `${app.getName()}/${app.getVersion()} (${process.platform}: ${process.arch})`,
      },
    });
    this.configured = true;
  }

  private attachListeners(): void {
    if (this.listenersAttached) {
      return;
    }

    autoUpdater.on('checking-for-update', this.onCheckingForUpdate);
    autoUpdater.on('update-available', this.onUpdateAvailable);
    autoUpdater.on('update-not-available', this.onUpdateNotAvailable);
    autoUpdater.on('update-downloaded', this.onUpdateDownloaded);
    autoUpdater.on('error', this.onError);

    this.listenersAttached = true;
  }

  private emitState(): void {
    this.emit('state-changed', this.getState());
  }
}
