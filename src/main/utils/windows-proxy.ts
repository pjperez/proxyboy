import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

export async function setSystemProxy(host: string, port: number): Promise<void> {
  try {
    await execFileAsync('reg', ['add', REGISTRY_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
    await execFileAsync('reg', ['add', REGISTRY_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `${host}:${port}`, '/f']);
    // Bypass local addresses
    await execFileAsync('reg', ['add', REGISTRY_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', 'localhost;127.0.0.1;<local>', '/f']);
    // Notify Windows of the change
    await notifyInternetSettingsChange();
  } catch (error) {
    throw new Error(`Failed to set system proxy: ${error}`);
  }
}

export async function clearSystemProxy(): Promise<void> {
  try {
    await execFileAsync('reg', ['add', REGISTRY_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
    await notifyInternetSettingsChange();
  } catch (error) {
    throw new Error(`Failed to clear system proxy: ${error}`);
  }
}

export async function isSystemProxyEnabled(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', REGISTRY_KEY, '/v', 'ProxyEnable']);
    return stdout.includes('0x1');
  } catch {
    return false;
  }
}

async function notifyInternetSettingsChange(): Promise<void> {
  // Use PowerShell to notify the system of internet settings change
  const script = `
    $signature = @'
    [DllImport("wininet.dll", SetLastError = true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
    $type = Add-Type -MemberDefinition $signature -Name WinInet -Namespace PInvoke -PassThru
    $INTERNET_OPTION_SETTINGS_CHANGED = 39
    $INTERNET_OPTION_REFRESH = 37
    $type::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0) | Out-Null
    $type::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0) | Out-Null
  `;
  try {
    await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  } catch {
    // Non-critical: proxy still works even if notification fails
  }
}
