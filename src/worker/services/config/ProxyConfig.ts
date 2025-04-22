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
  return {
    enabled: process.env.PROXY_ENABLED === 'true',
    host: process.env.PROXY_HOST || '',
    port: parseInt(process.env.PROXY_PORT || '80', 10),
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || ''
  };
}

export function getProxyUrl(): string | undefined {
  const config = getProxyConfig();
  if (!config.enabled) return undefined;
  
  return `http://${config.username}:${config.password}@${config.host}:${config.port}`;
} 