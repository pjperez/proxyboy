import * as http from 'http';
import * as https from 'https';
import { shouldBypassUpstreamProxy, type UpstreamProxySettings } from '../../shared/upstream-proxy';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export interface UpstreamProxyAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

function buildProxyUrl(settings: UpstreamProxySettings): URL {
  const protocol = settings.type === 'socks5' ? 'socks5:' : 'http:';
  const url = new URL(`${protocol}//${settings.host}:${settings.port}`);
  if (settings.username) {
    url.username = settings.username;
  }
  if (settings.password) {
    url.password = settings.password;
  }
  return url;
}

export function createDirectAgents(): UpstreamProxyAgents {
  return {
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
  };
}

export function createUpstreamProxyAgents(settings: UpstreamProxySettings): UpstreamProxyAgents | null {
  if (!settings.enabled || !settings.host) {
    return null;
  }

  const proxyUrl = buildProxyUrl(settings);

  if (settings.type === 'socks5') {
    const httpAgent = new SocksProxyAgent(proxyUrl);
    const httpsAgent = new SocksProxyAgent(proxyUrl);
    return {
      // http-mitm-proxy expects Node's concrete Agent types even though these
      // agent-base implementations are the runtime-compatible request agents.
      httpAgent: httpAgent as unknown as http.Agent,
      httpsAgent: httpsAgent as unknown as https.Agent,
    };
  }

  return {
    httpAgent: new HttpProxyAgent(proxyUrl) as unknown as http.Agent,
    httpsAgent: new HttpsProxyAgent(proxyUrl) as unknown as https.Agent,
  };
}

