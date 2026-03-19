interface ProxyResult {
  success?: boolean;
  error?: string;
  canceled?: boolean;
  port?: number;
}

interface ProxyBoyLikeApi {
  proxy?: {
    start: () => Promise<ProxyResult>;
    stop: () => Promise<ProxyResult>;
    setSystemProxy: (enabled: boolean) => Promise<ProxyResult>;
  };
  app?: {
    exportHar: (flowIds?: string[]) => Promise<ProxyResult>;
    importHar: () => Promise<ProxyResult>;
  };
  traffic?: {
    clear: () => Promise<ProxyResult>;
    delete: (id: string) => Promise<ProxyResult>;
  };
}

export interface ProxyToggleResult {
  success: boolean;
  running: boolean;
  isSystemProxy: boolean;
  port?: number;
  error: string;
}

function failure(error: string, extras: Partial<ProxyToggleResult> = {}): ProxyToggleResult {
  return {
    success: false,
    running: false,
    isSystemProxy: false,
    error,
    ...extras,
  };
}

export async function toggleProxyRecording(
  api: ProxyBoyLikeApi | undefined,
  proxyRunning: boolean,
  isSystemProxy: boolean,
): Promise<ProxyToggleResult> {
  if (!api?.proxy) {
    return failure('Proxy controls are unavailable.');
  }

  if (proxyRunning) {
    let nextIsSystemProxy = isSystemProxy;
    if (isSystemProxy) {
      const systemResult = await api.proxy.setSystemProxy(false);
      if (!systemResult?.success) {
        return failure(systemResult?.error || 'Failed to disable the system proxy.', {
          running: true,
          isSystemProxy,
        });
      }
      nextIsSystemProxy = false;
    }

    const stopResult = await api.proxy.stop();
    if (!stopResult?.success) {
      return failure(stopResult?.error || 'Failed to stop the proxy.', {
        running: true,
        isSystemProxy: nextIsSystemProxy,
      });
    }

    return {
      success: true,
      running: false,
      isSystemProxy: false,
      error: '',
    };
  }

  const startResult = await api.proxy.start();
  if (!startResult?.success) {
    return failure(startResult?.error || 'Failed to start the proxy.');
  }

  return {
    success: true,
    running: true,
    isSystemProxy: false,
    port: startResult.port,
    error: '',
  };
}

export async function exportHarFile(api: ProxyBoyLikeApi | undefined, flowIds?: string[]) {
  if (!api?.app) {
    return { success: false, canceled: false, error: 'HAR export is unavailable.' };
  }

  const result = await api.app.exportHar(flowIds);
  return {
    success: Boolean(result?.success),
    canceled: Boolean(result?.canceled),
    error: result?.error || 'Failed to export HAR.',
  };
}

export async function importHarFile(api: ProxyBoyLikeApi | undefined) {
  if (!api?.app) {
    return { success: false, canceled: false, error: 'HAR import is unavailable.' };
  }

  const result = await api.app.importHar();
  return {
    success: Boolean(result?.success),
    canceled: Boolean(result?.canceled),
    error: result?.error || 'Failed to import HAR.',
  };
}

export async function clearTrafficFlows(api: ProxyBoyLikeApi | undefined) {
  if (!api?.traffic) {
    return { success: false, error: 'Traffic controls are unavailable.' };
  }

  const result = await api.traffic.clear();
  return {
    success: Boolean(result?.success),
    error: result?.error || 'Failed to clear captured traffic.',
  };
}

export async function deleteTrafficFlow(api: ProxyBoyLikeApi | undefined, id: string) {
  if (!api?.traffic) {
    return { success: false, error: 'Traffic controls are unavailable.' };
  }

  const result = await api.traffic.delete(id);
  return {
    success: Boolean(result?.success),
    error: result?.error || 'Failed to remove the selected request.',
  };
}
