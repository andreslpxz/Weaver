/**
 * Tipos canónicos que cruzan la frontera Tauri (Rust ↔ TypeScript).
 * Mantener en sync con src-tauri/src/atspi/types.rs y src-tauri/src/automation/windows.rs.
 */

export type Role =
  | 'window' | 'dialog' | 'frame' | 'panel'
  | 'push_button' | 'toggle_button' | 'check_box' | 'radio_button'
  | 'combo_box' | 'edit_bar' | 'entry' | 'text' | 'label'
  | 'menu_item' | 'menu' | 'menu_bar'
  | 'list' | 'list_item' | 'tree' | 'tree_item'
  | 'table' | 'table_cell' | 'tab' | 'tab_list'
  | 'scroll_bar' | 'slider' | 'spin_button'
  | 'link' | 'image' | 'separator' | 'canvas' | 'unknown';

export interface Rect { x: number; y: number; width: number; height: number; }

export interface StateSet { 0?: string[] } // se serializa como BTreeSet → array

export interface AccessibleNode {
  path: string;
  bus_name: string;
  name: string;
  description: string;
  role: Role;
  role_raw: string;
  states: string[];
  rect: Rect | null;
  text: string | null;
  actions: string[];
  children: AccessibleNode[];
}

export interface ApplicationInfo {
  name: string;
  bus_name: string;
  root_path: string;
  pid: number;
  child_count: number;
}

export interface WindowInfo {
  id: string;
  title: string;
  desktop: number;
  pid: number;
  geometry: [number, number, number, number];
}
