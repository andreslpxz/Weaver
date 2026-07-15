/**
 * Catálogo de servidores MCP pre-configurados.
 *
 * Estos servidores se pueden instalar con un solo click desde la vista de
 * Complementos. Cada uno tiene:
 * - Logo SVG (inline para no depender de assets externos)
 * - Comando + args listos para usar
 * - Variables de entorno requeridas (API keys, tokens, etc.)
 * - Descripción de qué hace
 * - Instrucciones de cómo obtener las credenciales
 */

// ============================================================================
// Logos SVG (inline para no depender de assets externos)
// Deben declararse antes de MCP_PRESETS porque se usan en el array.
// ============================================================================

const GITHUB_LOGO = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
</svg>`;

const PLAYWRIGHT_LOGO = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="11" fill="#2EAD33"/>
<circle cx="12" cy="12" r="8" fill="white"/>
<circle cx="12" cy="12" r="4" fill="#2EAD33"/>
<circle cx="12" cy="12" r="1.5" fill="white"/>
</svg>`;

const GOOGLE_DRIVE_LOGO = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
<path d="M7.71 3.5L1.15 15l3.42 6 6.56-11.5L7.71 3.5zm1.06 13.99L12.24 22h6.84l-3.42-6.02-6.89.01zM22.85 15L16.29 3.5h-6.84L16.01 15h6.84z"/>
</svg>`;

const NOTION_LOGO = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
<path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.29c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.373-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933L9.21 9.395v9.523l1.215.28s0 .558-.677.558l-2.707.165c-.234-.327 0-.84.187-.84l.841-.233V8.697l-.841-.093c-.093-.42.14-.933.748-.98l2.94-.187 4.294 6.497V8.976l-1.027-.117c-.093-.513.281-.84.748-.886zm-12.96-7.39L13.2.27c1.122-.093 1.542-.047 2.242.606l5.06 3.71c.466.327.653.607.653.934v13.997c0 .7-.373 1.12-1.12 1.166l-13.31.793c-.654.047-1.028-.187-1.355-.606L2.24 16.34c-.373-.513-.514-.933-.514-1.4V5.02c0-.56.234-1.027.7-1.12z"/>
</svg>`;

const FIGMA_LOGO = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 24c2.208 0 4-1.792 4-4v-4H8c-2.208 0-4 1.792-4 4s1.792 4 4 4z" fill="#0ACF83"/>
<path d="M4 12c0-2.208 1.792-4 4-4h4v8H8c-2.208 0-4-1.792-4-4z" fill="#A259FF"/>
<path d="M4 4c0-2.208 1.792-4 4-4h4v8H8C5.792 8 4 6.208 4 4z" fill="#F24E1E"/>
<path d="M12 0h4c2.208 0 4 1.792 4 4s-1.792 4-4 4h-4V0z" fill="#FF7262"/>
<path d="M20 12c0 2.208-1.792 4-4 4s-4-1.792-4-4 1.792-4 4-4 4 1.792 4 4z" fill="#1ABCFE"/>
</svg>`;

// ============================================================================
// Tipos
// ============================================================================

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  category: 'developer' | 'productivity' | 'design' | 'browser';
  logo: string;
  color: string;
  command: string;
  args: string[];
  envVars: McpEnvVar[];
  docsUrl: string;
  exampleTools: string[];
}

export interface McpEnvVar {
  name: string;
  label: string;
  type: 'password' | 'text' | 'url';
  required: boolean;
  helpText: string;
  obtainUrl?: string;
}

// ============================================================================
// Catálogo de presets MCP oficiales
// ============================================================================

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositorios, issues, PRs, commits, actions y más desde GitHub.',
    category: 'developer',
    color: '#24292f',
    logo: GITHUB_LOGO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envVars: [
      {
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        helpText: 'Token con permisos repo, read:user, workflow.',
        obtainUrl: 'https://github.com/settings/tokens/new?scopes=repo,read:user,workflow',
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    exampleTools: [
      'create_issue',
      'get_file_contents',
      'create_branch',
      'create_pull_request',
      'list_commits',
      'search_repositories',
    ],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Automatización de navegador: navegar, clickear, scrapear, hacer screenshots.',
    category: 'browser',
    color: '#2EAD33',
    logo: PLAYWRIGHT_LOGO,
    command: 'npx',
    args: ['-y', '@executeautomation/playwright-mcp-server'],
    envVars: [],
    docsUrl: 'https://github.com/executeautomation/mcp-playwright',
    exampleTools: [
      'navigate',
      'click',
      'fill',
      'screenshot',
      'get_text',
      'evaluate',
      'wait_for_selector',
    ],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Buscar y leer archivos de tu Google Drive.',
    category: 'productivity',
    color: '#1FA463',
    logo: GOOGLE_DRIVE_LOGO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-drive'],
    envVars: [
      {
        name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        label: 'Service Account Email',
        type: 'text',
        required: true,
        helpText: 'Email de la service account de Google Cloud (xxx@project.iam.gserviceaccount.com).',
        obtainUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
      },
      {
        name: 'GOOGLE_PRIVATE_KEY',
        label: 'Private Key',
        type: 'password',
        required: true,
        helpText: 'Clave privada de la service account (empieza con "-----BEGIN PRIVATE KEY-----").',
        obtainUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-drive',
    exampleTools: [
      'search_files',
      'read_file',
      'list_folders',
      'create_file',
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Buscar, leer y editar páginas y bases de datos de Notion.',
    category: 'productivity',
    color: '#000000',
    logo: NOTION_LOGO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    envVars: [
      {
        name: 'NOTION_API_KEY',
        label: 'Notion API Key (Internal Integration Token)',
        type: 'password',
        required: true,
        helpText: 'Token de integración interna de Notion (empieza con "ntn_").',
        obtainUrl: 'https://www.notion.so/profile/integrations',
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/notion',
    exampleTools: [
      'search_pages',
      'get_page',
      'create_page',
      'update_page',
      'query_database',
    ],
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Leer diseños, componentes y estilos de archivos de Figma.',
    category: 'design',
    color: '#F24E1E',
    logo: FIGMA_LOGO,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-figma'],
    envVars: [
      {
        name: 'FIGMA_API_KEY',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        helpText: 'Token de acceso personal de Figma.',
        obtainUrl: 'https://www.figma.com/developers/api#access-tokens',
      },
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/figma',
    exampleTools: [
      'get_file',
      'get_file_nodes',
      'get_components',
      'get_styles',
      'export_image',
    ],
  },
];

/** Obtiene un preset por ID. */
export function getPreset(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}

/** Lista todos los presets disponibles. */
export function listPresets(): McpPreset[] {
  return MCP_PRESETS;
}
