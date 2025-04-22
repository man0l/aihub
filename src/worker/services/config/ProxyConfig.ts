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
  // Log raw environment variables and their types
  console.log('[ProxyConfig] Raw environment variables:');
  console.log(`[ProxyConfig] PROXY_ENABLED=${process.env.PROXY_ENABLED} (type: ${typeof process.env.PROXY_ENABLED})`);
  console.log(`[ProxyConfig] PROXY_ENABLED === 'true': ${process.env.PROXY_ENABLED === 'true'}`);
  console.log(`[ProxyConfig] PROXY_HOST=${process.env.PROXY_HOST || '(not set)'}`);
  console.log(`[ProxyConfig] PROXY_PORT=${process.env.PROXY_PORT || '80'}`);
  console.log(`[ProxyConfig] PROXY_USERNAME=${process.env.PROXY_USERNAME ? '(set)' : '(not set)'}`);
  console.log(`[ProxyConfig] PROXY_PASSWORD=${process.env.PROXY_PASSWORD ? '(set)' : '(not set)'}`);

  // Parse enabled flag with more detailed logging
  const enabled = process.env.PROXY_ENABLED === 'true';
  console.log(`[ProxyConfig] Parsed PROXY_ENABLED=${enabled}`);

  const config = {
    enabled,
    host: process.env.PROXY_HOST || '',
    port: parseInt(process.env.PROXY_PORT || '80', 10),
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || ''
  };

  // Log the resulting configuration with validation
  console.log('[ProxyConfig] Resolved configuration:');
  console.log(`[ProxyConfig] enabled=${config.enabled} (${typeof config.enabled})`);
  console.log(`[ProxyConfig] host=${config.host ? '(set)' : '(not set)'} (${config.host.length} chars)`);
  console.log(`[ProxyConfig] port=${config.port} (${typeof config.port})`);
  console.log(`[ProxyConfig] username=${config.username ? '(set)' : '(not set)'} (${config.username.length} chars)`);
  console.log(`[ProxyConfig] password=${config.password ? '(set)' : '(not set)'} (${config.password.length} chars)`);

  // Validate configuration
  if (config.enabled) {
    console.log('[ProxyConfig] Validating enabled proxy configuration...');
    const missingFields = [];
    if (!config.host) missingFields.push('host');
    if (!config.username) missingFields.push('username');
    if (!config.password) missingFields.push('password');
    
    if (missingFields.length > 0) {
      console.warn(`[ProxyConfig] Warning: Proxy is enabled but missing: ${missingFields.join(', ')}`);
    } else {
      console.log('[ProxyConfig] All required proxy fields are set');
    }
  }

  return config;
}

export function getProxyUrl(): string | undefined {
  const config = getProxyConfig();
  if (!config.enabled) {
    console.log('[ProxyConfig] Proxy is disabled, not generating URL');
    return undefined;
  }
  
  if (!config.host || !config.username || !config.password) {
    console.warn('[ProxyConfig] Missing required proxy configuration:');
    if (!config.host) console.warn('[ProxyConfig] - Missing host');
    if (!config.username) console.warn('[ProxyConfig] - Missing username');
    if (!config.password) console.warn('[ProxyConfig] - Missing password');
    return undefined;
  }
  
  console.log(`[ProxyConfig] Generated proxy URL for ${config.host}:${config.port}`);
  return `http://${config.username}:${config.password}@${config.host}:${config.port}`;
} 