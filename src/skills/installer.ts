/**
 * Installer de skills: wrapper sobre `npx skills add <url> --skill <name>`.
 *
 * La ejecución real la hace el backend Rust vía `tauri-plugin-shell` o un
 * comando Tauri dedicado. El frontend sólo orquesta.
 */

import { skillsRegistry, type Skill } from './registry';
import { Command } from '@tauri-apps/plugin-shell';

export interface InstallResult {
  ok: boolean;
  skill?: Skill;
  message: string;
}

export const skillsInstaller = {
  /**
   * Instala una skill desde una URL (ej. github.com/vercel-labs/skills).
   * Equivale a: `npx skills add <url> --skill <name>`
   */
  async install(url: string, skillName?: string): Promise<InstallResult> {
    try {
      const args = ['skills', 'add', url];
      if (skillName) args.push('--skill', skillName);
      const cmd = Command.create('npx', args);
      const output = await cmd.execute();
      if (output.code !== 0) {
        return { ok: false, message: `npx exit ${output.code}: ${output.stderr.slice(0, 200)}` };
      }
      // El comando npx skills add escribe en disco; aquí no parseamos su output
      // porque el formato varía. En su lugar, devolvemos un placeholder.
      const skill: Skill = {
        name: skillName ?? url.split('/').pop() ?? 'unnamed',
        description: `Instalada desde ${url}`,
        triggers: [],
        toolsRequired: [],
        body: `(Skill instalada desde ${url}. Contenido cargado al próximo inicio.)`,
        source: 'installed',
      };
      await skillsRegistry.register(skill);
      return { ok: true, skill, message: 'Instalada correctamente' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },

  /**
   * Instala la skill `find-skills` del repo vercel-labs/skills (recomendada).
   */
  async installFindSkills(): Promise<InstallResult> {
    return this.install('https://github.com/vercel-labs/skills', 'find-skills');
  },
};
