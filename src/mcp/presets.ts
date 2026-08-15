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

const PLAYWRIGHT_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" id="Playwright--Streamline-Svg-Logos" height="24" width="24">
  <path fill="#2d4552" d="M7.99585 13.141725c-0.87725 0.248975 -1.452775 0.685475 -1.8319 1.12165 0.363125 -0.317775 0.849525 -0.609425 1.505675 -0.795425 0.6711 -0.1902 1.243625 -0.188825 1.7167 -0.09755v-0.369925c-0.40355 -0.0369 -0.866225 -0.0075 -1.390475 0.14125Zm-1.872 -3.109775 -3.25795 0.858325s0.059375 0.083875 0.1693 0.195775l2.76235 -0.727875s-0.03915 0.5044 -0.379075 0.9556c0.643 -0.486475 0.705375 -1.281825 0.705375 -1.281825Zm2.727125 7.65675C4.26615 18.923575 1.8404825 13.61025 1.1060875 10.852425c-0.3393 -1.273 -0.487415 -2.2371 -0.5268925 -2.859275 -0.0042425 -0.0646 -0.0022825 -0.11905 0.002285 -0.16895 -0.237835 0.01435 -0.3517015 0.137975 -0.328535 0.49525 0.0394775 0.621825 0.187595 1.585875 0.526895 2.859275C1.5139075 13.936125 3.9399 19.24945 8.52475 18.0146c0.99795 -0.26885 1.747675 -0.758525 2.310475 -1.383625 -0.51875 0.468525 -1.168 0.8375 -1.98425 1.057725Zm0.861575 -10.90855v0.3263h1.79835c-0.0369 -0.115525 -0.074075 -0.219625 -0.110975 -0.3263h-1.687375Z" stroke-width="0.25"></path>
  <path fill="#2d4552" d="M11.9129 9.46735c0.80875 0.229675 1.2365 0.7967 1.462575 1.2985l0.90175 0.2561s-0.123 -1.756175 -1.711525 -2.2074c-1.486075 -0.422225 -2.400575 0.8257 -2.5118 0.9872 0.4323 -0.308 1.063575 -0.56015 1.859 -0.3344Zm7.178175 1.3066c-1.487425 -0.424125 -2.401575 0.8264 -2.511175 0.985625 0.432625 -0.307625 1.063575 -0.559875 1.85865 -0.3331 0.80745 0.23005 1.23485 0.796375 1.461625 1.298525l0.90305 0.25705s-0.125 -1.756525 -1.71215 -2.2081Zm-0.8959 4.6305 -7.501475 -2.097125s0.0812 0.411725 0.3928 0.94485l6.3159 1.765675c0.519975 -0.30085 0.792775 -0.6134 0.792775 -0.6134ZM12.994375 19.918475C7.054675 18.326 7.77275 10.758025 8.733875 7.171825c0.395725 -1.4779 0.802575 -2.576375 1.13995 -3.312725 -0.2013 -0.041425 -0.368025 0.0646 -0.532775 0.39965 -0.358225 0.726575 -0.8163 1.90955 -1.259625 3.5656 -0.96085 3.586125 -1.67895 11.15385 4.2605 12.746325 2.79955 0.75 4.980475 -0.3899 6.60625 -2.18005 -1.543175 1.3977 -3.513425 2.181325 -5.9538 1.52785Z" stroke-width="0.25"></path>
  <path fill="#e2574c" d="M9.7126 15.915175V14.388l-4.243175 1.2032s0.313525 -1.82175 2.526475 -2.4495c0.6711 -0.1902 1.2437 -0.1889 1.7167 -0.09755V6.780125h2.124575c-0.231325 -0.714825 -0.4551 -1.26515 -0.64305 -1.64755 -0.310925 -0.632925 -0.62965 -0.21335 -1.35325 0.39185 -0.50965 0.425775 -1.797675 1.33405 -3.7359 1.85635 -1.938275 0.522625 -3.50525 0.384025 -4.15906 0.2708 -0.9268825 -0.1599 -1.4116925 -0.36345 -1.3663375 0.34155 0.03947 0.621825 0.187595 1.58595 0.5268925 2.859275C1.8405325 13.609875 4.266525 18.9232 8.85135 17.68835c1.197625 -0.3227 2.04295 -0.960525 2.6289 -1.7735h-1.76765v0.000325ZM2.865625 10.89025l3.258275 -0.858325s-0.094975 1.25345 -1.31645 1.57545c-1.2218 0.321675 -1.941825 -0.717125 -1.941825 -0.717125Z" stroke-width="0.25"></path>
  <path fill="#2ead33" d="M21.975075 6.8525c-0.84695 0.148475 -2.878875 0.33345 -5.389975 -0.339625 -2.5118 -0.672675 -4.17835 -1.849175 -4.838625 -2.402175 -0.936 -0.783975 -1.347725 -1.328825 -1.752925 -0.5047 -0.358225 0.726875 -0.816325 1.909875 -1.259725 3.565925 -0.960775 3.586125 -1.67885 11.15385 4.260525 12.7463 5.938125 1.591125 9.09945 -5.322175 10.0603 -8.908625 0.4434 -1.655725 0.637825 -2.9095 0.691325 -3.717925 0.061 -0.915775 -0.568025 -0.64995 -1.7709 -0.439175ZM10.0418 9.81945s0.936 -1.45575 2.523525 -1.00455c1.588525 0.451225 1.711525 2.207425 1.711525 2.207425l-4.23505 -1.202875ZM13.917 16.352c-2.79235 -0.817975 -3.223 -3.04465 -3.223 -3.04465l7.501125 2.0972c0 -0.00035 -1.5141 1.755175 -4.278125 0.94745Zm2.6521 -4.57605s0.9347 -1.45475 2.521925 -1.00225c1.587175 0.4519 1.71215 2.2081 1.71215 2.2081l-4.234075 -1.20585Z" stroke-width="0.25"></path>
  <path fill="#d65348" d="M8.2299 14.808525 5.4695 15.590875s0.29985 -1.708225 2.33335 -2.385175l-1.563075 -5.865975 -0.135075 0.04105c-1.93825 0.5227 -3.505225 0.384025 -4.15903 0.2708 -0.9268775 -0.159825 -1.411685 -0.36345 -1.3663375 0.341625 0.0394775 0.621825 0.187595 1.585875 0.5268925 2.85925 0.7340675 2.757425 3.160075 8.07075 7.744875 6.8359l0.135075 -0.042425 -0.756275 -2.8374ZM2.8657 10.8903l3.258275 -0.858375s-0.094975 1.25345 -1.316425 1.57545c-1.221825 0.321675 -1.94185 -0.717075 -1.94185 -0.717075Z" stroke-width="0.25"></path>
  <path fill="#1d8d22" d="m14.04295 16.382625 -0.1263 -0.0307c-2.792325 -0.8179 -3.223 -3.044575 -3.223 -3.044575l3.86805 1.0812 2.047825 -7.86915 -0.024775 -0.006525c-2.5118 -0.672675 -4.17825 -1.849175 -4.838625 -2.402175 -0.936 -0.783975 -1.347725 -1.328825 -1.752925 -0.5047 -0.357875 0.726875 -0.815975 1.909875 -1.259375 3.565925 -0.960775 3.586125 -1.67885 11.15385 4.260525 12.74625l0.121725 0.027425 0.926875 -3.562975ZM10.0418 9.819475s0.936 -1.455775 2.523525 -1.004575c1.588525 0.451225 1.711525 2.207425 1.711525 2.207425l-4.23505 -1.20285Z" stroke-width="0.25"></path>
  <path fill="#c04b41" d="m8.37055 14.7683 -0.740275 0.2101c0.174875 0.9859 0.483125 1.93205 0.966975 2.7679 0.0842 -0.0186 0.167725 -0.034575 0.2535 -0.058075 0.2248 -0.06065 0.43325 -0.13575 0.63395 -0.21765 -0.5406 -0.802225 -0.898225 -1.726175 -1.11415 -2.702275Zm-0.289075 -6.9439c-0.3804 1.419825 -0.720725 3.46345 -0.62705 5.51325 0.167675 -0.072775 0.3448 -0.140575 0.54155 -0.1964l0.13705 -0.030625c-0.167075 -2.189525 0.194075 -4.4207 0.600925 -5.93875 0.103125 -0.384025 0.206525 -0.741225 0.3096 -1.07435 -0.166025 0.105675 -0.3448 0.213975 -0.548425 0.32555 -0.137325 0.42385 -0.276 0.887125 -0.41365 1.401325Z" stroke-width="0.25"></path>
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
