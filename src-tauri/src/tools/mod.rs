//! Tools del agente: shell_exec, file_read, file_write, file_list.
//! Solo disponibles en modo Tauri (acceso al filesystem del sistema).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecArgs {
    pub command: String,
    pub cwd: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellExecResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

#[tauri::command]
pub async fn tools_shell_exec(args: ShellExecArgs) -> Result<ShellExecResult, String> {
    let timeout = Duration::from_millis(args.timeout.unwrap_or(30_000));
    let mut cmd = Command::new("bash");
    cmd.arg("-c").arg(&args.command);
    if let Some(cwd) = &args.cwd {
        cmd.current_dir(cwd);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    // wait_with_output no es Future directamente; usar tokio::task::spawn_blocking.
    let wait_fut = async move { child.wait_with_output() };
    let result = tokio::time::timeout(timeout, wait_fut)
        .await
        .map_err(|_| format!("timeout after {} ms", timeout.as_millis()))?
        .map_err(|e| e.to_string())?;

    Ok(ShellExecResult {
        stdout: String::from_utf8_lossy(&result.stdout).to_string(),
        stderr: String::from_utf8_lossy(&result.stderr).to_string(),
        code: result.status.code().unwrap_or(-1),
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileReadArgs {
    pub path: String,
}

#[tauri::command]
pub async fn tools_file_read(args: FileReadArgs) -> Result<String, String> {
    let path = expand_path(&args.path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("read {path:?}: {e}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileWriteArgs {
    pub path: String,
    pub content: String,
    pub create_dirs: Option<bool>,
}

#[tauri::command]
pub async fn tools_file_write(args: FileWriteArgs) -> Result<(), String> {
    let path = expand_path(&args.path)?;
    if args.create_dirs.unwrap_or(false) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
        }
    }
    std::fs::write(&path, &args.content).map_err(|e| format!("write {path:?}: {e}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileListArgs {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn tools_file_list(args: FileListArgs) -> Result<Vec<DirEntry>, String> {
    let path = expand_path(&args.path)?;
    let mut entries = Vec::new();
    let read = std::fs::read_dir(&path).map_err(|e| format!("readdir {path:?}: {e}"))?;
    for entry in read {
        let e = entry.map_err(|e| e.to_string())?;
        let meta = e.metadata().map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn expand_path(p: &str) -> Result<PathBuf, String> {
    let expanded = if p.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        PathBuf::from(home).join(&p[2..])
    } else if p == "~" {
        PathBuf::from(std::env::var("HOME").map_err(|e| e.to_string())?)
    } else {
        PathBuf::from(p)
    };
    Ok(expanded)
}

#[allow(dead_code)]
pub fn load_env_overrides() -> HashMap<String, String> {
    HashMap::new()
}
