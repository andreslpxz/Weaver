/**
 * FASE 3 / 8 — Tipos de Credentials.
 *
 * Una Credential es un conjunto de datos sensibles (API keys, tokens,
 * user/password) que un nodo referencia por ID. El dato cifrado vive
 * en SQLite; el frontend sólo ve metadatos (name, type).
 *
 * Tipos predefinidos cubren los auth schemes más comunes. Se pueden
 * añadir más sin modificar el engine.
 */

export type CredentialType =
  | 'httpBasicAuth'
  | 'httpHeaderAuth'
  | 'httpQueryAuth'
  | 'oAuth2Api'
  | 'discordApi'
  | 'slackApi'
  | 'githubApi'
  | 'openaiApi'
  | 'anthropicApi'
  | 'genericApi'
  | 'smtp'
  | 'postgres'
  | 'mysql';

/** Definición de un tipo de credential (qué fields tiene). */
export interface CredentialTypeDef {
  type: CredentialType;
  displayName: string;
  icon?: string;
  /** Fields sensibles que se cifran. */
  properties: CredentialProperty[];
}

export interface CredentialProperty {
  name: string;
  displayName?: string;
  type: 'string' | 'password' | 'number' | 'hidden';
  required?: boolean;
  placeholder?: string;
  default?: string | number;
}

/** Entidad Credential (lo que se persiste en SQLite). */
export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  /** Datos cifrados (AES-256-GCM) en base64. */
  encryptedData: string;
  /** IV usado para el cifrado (base64). */
  iv: string;
  createdAt: number;
  updatedAt: number;
}

/** Credential sin el dato cifrado — lo que el frontend ve. */
export type CredentialMetadata = Omit<Credential, 'encryptedData' | 'iv'>;

/** Credential ya descifrada — lo que el engine le pasa al nodo. */
export interface DecryptedCredential {
  id: string;
  name: string;
  type: CredentialType;
  data: Record<string, string>;
}

/** Catálogo de tipos de credential predefinidos. */
export const CREDENTIAL_TYPES: CredentialTypeDef[] = [
  {
    type: 'httpBasicAuth',
    displayName: 'HTTP Basic Auth',
    properties: [
      { name: 'user', displayName: 'User', type: 'string', required: true },
      { name: 'password', displayName: 'Password', type: 'password', required: true },
    ],
  },
  {
    type: 'httpHeaderAuth',
    displayName: 'HTTP Header Auth',
    properties: [
      { name: 'name', displayName: 'Header Name', type: 'string', required: true, placeholder: 'Authorization' },
      { name: 'value', displayName: 'Header Value', type: 'password', required: true, placeholder: 'Bearer ...' },
    ],
  },
  {
    type: 'httpQueryAuth',
    displayName: 'HTTP Query Auth',
    properties: [
      { name: 'name', displayName: 'Query Param Name', type: 'string', required: true, placeholder: 'api_key' },
      { name: 'value', displayName: 'Query Param Value', type: 'password', required: true },
    ],
  },
  {
    type: 'oAuth2Api',
    displayName: 'OAuth2',
    properties: [
      { name: 'accessToken', displayName: 'Access Token', type: 'password', required: true },
      { name: 'refreshToken', displayName: 'Refresh Token', type: 'password' },
      { name: 'clientId', displayName: 'Client ID', type: 'string' },
      { name: 'clientSecret', displayName: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'discordApi',
    displayName: 'Discord Webhook',
    properties: [
      { name: 'webhookUrl', displayName: 'Webhook URL', type: 'string', required: true },
    ],
  },
  {
    type: 'slackApi',
    displayName: 'Slack API',
    properties: [
      { name: 'token', displayName: 'Bot Token', type: 'password', required: true },
      { name: 'channel', displayName: 'Default Channel', type: 'string' },
    ],
  },
  {
    type: 'githubApi',
    displayName: 'GitHub',
    properties: [
      { name: 'token', displayName: 'Personal Access Token', type: 'password', required: true },
    ],
  },
  {
    type: 'openaiApi',
    displayName: 'OpenAI',
    properties: [
      { name: 'apiKey', displayName: 'API Key', type: 'password', required: true },
    ],
  },
  {
    type: 'anthropicApi',
    displayName: 'Anthropic',
    properties: [
      { name: 'apiKey', displayName: 'API Key', type: 'password', required: true },
    ],
  },
  {
    type: 'genericApi',
    displayName: 'Generic API Key',
    properties: [
      { name: 'apiKey', displayName: 'API Key', type: 'password', required: true },
    ],
  },
  {
    type: 'smtp',
    displayName: 'SMTP',
    properties: [
      { name: 'host', displayName: 'Host', type: 'string', required: true },
      { name: 'port', displayName: 'Port', type: 'number', required: true },
      { name: 'user', displayName: 'User', type: 'string' },
      { name: 'password', displayName: 'Password', type: 'password' },
    ],
  },
  {
    type: 'postgres',
    displayName: 'PostgreSQL',
    properties: [
      { name: 'host', displayName: 'Host', type: 'string', required: true },
      { name: 'port', displayName: 'Port', type: 'number', required: true, default: '5432' },
      { name: 'database', displayName: 'Database', type: 'string', required: true },
      { name: 'user', displayName: 'User', type: 'string', required: true },
      { name: 'password', displayName: 'Password', type: 'password' },
    ],
  },
  {
    type: 'mysql',
    displayName: 'MySQL',
    properties: [
      { name: 'host', displayName: 'Host', type: 'string', required: true },
      { name: 'port', displayName: 'Port', type: 'number', required: true, default: '3306' },
      { name: 'database', displayName: 'Database', type: 'string', required: true },
      { name: 'user', displayName: 'User', type: 'string', required: true },
      { name: 'password', displayName: 'Password', type: 'password' },
    ],
  },
];

export function getCredentialTypeDef(type: CredentialType): CredentialTypeDef | undefined {
  return CREDENTIAL_TYPES.find((t) => t.type === type);
}
