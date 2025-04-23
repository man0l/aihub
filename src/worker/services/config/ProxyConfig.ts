import { config } from 'dotenv';

config();

export interface ProxyConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
}

export function getProxyConfig(): ProxyConfig {
  // Parse enabled flag
  const enabled = process.env.PROXY_ENABLED === 'true';

  const config = {
    enabled,
    host: process.env.PROXY_HOST || '',
    port: parseInt(process.env.PROXY_PORT || '80', 10),
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || ''
  };

  // Log only once and only if debug is needed
  if (process.env.DEBUG_PROXY === 'true') {
    console.log('[ProxyConfig] Proxy status: ' + (config.enabled ? 'enabled' : 'disabled'));
    
    // Validate configuration only if enabled
    if (config.enabled) {
      const missingFields = [];
      if (!config.host) missingFields.push('host');
      if (!config.username) missingFields.push('username');
      if (!config.password) missingFields.push('password');
      
      if (missingFields.length > 0) {
        console.warn(`[ProxyConfig] Warning: Proxy is enabled but missing: ${missingFields.join(', ')}`);
      }
    }
  }

  return config;
}

export function getProxyUrl(): string | undefined {
  const config = getProxyConfig();
  if (!config.enabled) {
    return undefined;
  }
  
  if (!config.host || !config.username || !config.password) {
    if (process.env.DEBUG_PROXY === 'true') {
      console.warn('[ProxyConfig] Missing required proxy configuration');
    }
    return undefined;
  }
  
  return `http://${config.username}:${config.password}@${config.host}:${config.port}`;
} 