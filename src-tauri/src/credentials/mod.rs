//! FASE 8 — Credentials module.
//!
//! Cifrado AES-256-GCM para credentials. La master key se obtiene del
//! OS keyring (preferido) o se autogenera en la primera ejecución.
//!
//! API pública (comandos Tauri):
//!   - credentials_list() → Vec<CredentialMetadata> (sin datos)
//!   - credentials_create(name, type, data) → Credential
//!   - credentials_update(id, name?, data?) → Credential
//!   - credentials_delete(id)
//!   - credentials_get_decrypted(id) → DecryptedCredential (sólo engine)
//!
//! Seguridad:
//!   - NUNCA se envían datos cifrados al frontend (sólo metadatos).
//!   - NUNCA se loggean datos descifrados.
//!   - El comando `credentials_get_decrypted` está marcado como interno
//!     y no debería exponerse al frontend directamente.

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::db::DbState;

pub struct CredentialsState {
    pub master_key: Vec<u8>,
}

/// Entidad Credential (lo que se persiste en SQLite).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub id: String,
    pub name: String,
    pub r#type: String, // CredentialType enum como string
    pub encrypted_data: String, // base64
    pub iv: String,             // base64
    pub created_at: i64,
    pub updated_at: i64,
}

/// Credential sin el dato cifrado — lo que el frontend ve.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMetadata {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Credential> for CredentialMetadata {
    fn from(c: Credential) -> Self {
        Self {
            id: c.id,
            name: c.name,
            r#type: c.r#type,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// Credential ya descifrada — lo que el engine le pasa al nodo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptedCredential {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub data: serde_json::Value, // Record<string, string>
}

/// Inicializa el state de credentials: obtiene o genera la master key.
pub fn init_credentials_state() -> Result<CredentialsState> {
    let key = get_or_create_master_key()?;
    Ok(CredentialsState { master_key: key })
}

/// Obtiene la master key del keyring, o la genera y guarda si no existe.
fn get_or_create_master_key() -> Result<Vec<u8>> {
    const KEYRING_SERVICE: &str = "weaver";
    const KEYRING_USER: &str = "credentials_master_key";

    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .context("Failed to create keyring entry")?;

    match entry.get_password() {
        Ok(password) => {
            // La password es la key en base64.
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(password)
                .context("Failed to decode master key from keyring")
        }
        Err(keyring::Error::NoEntry) => {
            // Generar nueva key de 32 bytes (AES-256).
            let mut key = vec![0u8; 32];
            use rand::RngCore;
            rand::thread_rng().fill_bytes(&mut key);

            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&key);
            entry.set_password(&encoded)
                .context("Failed to save master key to keyring")?;
            Ok(key)
        }
        Err(e) => Err(anyhow!("Keyring error: {}", e)),
    }
}

/// Cifra datos JSON con AES-256-GCM. Devuelve (ciphertext_base64, iv_base64).
pub fn encrypt(master_key: &[u8], plaintext: &[u8]) -> Result<(String, String)> {
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use aes_gcm::aead::{Aead, KeyInit};
    use base64::Engine;
    use rand::RngCore;

    let key = Key::<Aes256Gcm>::from_slice(master_key);
    let cipher = Aes256Gcm::new(key);

    let mut iv_bytes = vec![0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv_bytes);
    let nonce = Nonce::from_slice(&iv_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow!("Encryption failed: {}", e))?;

    Ok((
        base64::engine::general_purpose::STANDARD.encode(&ciphertext),
        base64::engine::general_purpose::STANDARD.encode(&iv_bytes),
    ))
}

/// Descifra datos AES-256-GCM.
pub fn decrypt(master_key: &[u8], ciphertext_b64: &str, iv_b64: &str) -> Result<Vec<u8>> {
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    use aes_gcm::aead::{Aead, KeyInit};
    use base64::Engine;

    let key = Key::<Aes256Gcm>::from_slice(master_key);
    let cipher = Aes256Gcm::new(key);

    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(ciphertext_b64)
        .context("Failed to decode ciphertext")?;
    let iv_bytes = base64::engine::general_purpose::STANDARD
        .decode(iv_b64)
        .context("Failed to decode IV")?;
    let nonce = Nonce::from_slice(&iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| anyhow!("Decryption failed: {}", e))?;

    Ok(plaintext)
}

// ============================================================================
// Comandos Tauri
// ============================================================================

#[tauri::command]
pub fn credentials_list(db: State<'_, DbState>) -> Result<Vec<CredentialMetadata>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, type, created_at, updated_at FROM credentials ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CredentialMetadata {
                id: row.get(0)?,
                name: row.get(1)?,
                r#type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn credentials_create(
    db: State<'_, DbState>,
    state: State<'_, CredentialsState>,
    name: String,
    credential_type: String,
    data: serde_json::Value,
) -> Result<CredentialMetadata, String> {
    let plaintext = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let (encrypted_data, iv) = encrypt(&state.master_key, &plaintext).map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO credentials (id, name, type, encrypted_data, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![id, name, credential_type, encrypted_data, iv, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(CredentialMetadata {
        id,
        name,
        r#type: credential_type,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn credentials_update(
    db: State<'_, DbState>,
    state: State<'_, CredentialsState>,
    id: String,
    name: Option<String>,
    data: Option<serde_json::Value>,
) -> Result<CredentialMetadata, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    if let Some(d) = data {
        let plaintext = serde_json::to_vec(&d).map_err(|e| e.to_string())?;
        let (encrypted_data, iv) = encrypt(&state.master_key, &plaintext).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE credentials SET encrypted_data = ?, iv = ?, updated_at = ? WHERE id = ?",
            params![encrypted_data, iv, now, id],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(n) = name {
        conn.execute(
            "UPDATE credentials SET name = ?, updated_at = ? WHERE id = ?",
            params![n, now, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut stmt = conn
        .prepare("SELECT id, name, type, created_at, updated_at FROM credentials WHERE id = ?")
        .map_err(|e| e.to_string())?;
    let metadata = stmt
        .query_row(params![id], |row| {
            Ok(CredentialMetadata {
                id: row.get(0)?,
                name: row.get(1)?,
                r#type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(metadata)
}

#[tauri::command]
pub fn credentials_delete(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials WHERE id = ?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// SOLO PARA USO INTERNO DEL ENGINE. No exponer al frontend directamente.
#[tauri::command]
pub fn credentials_get_decrypted(
    db: State<'_, DbState>,
    state: State<'_, CredentialsState>,
    id: String,
) -> Result<DecryptedCredential, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, type, encrypted_data, iv FROM credentials WHERE id = ?")
        .map_err(|e| e.to_string())?;
    let cred = stmt
        .query_row(params![id], |row| {
            Ok(Credential {
                id: row.get(0)?,
                name: row.get(1)?,
                r#type: row.get(2)?,
                encrypted_data: row.get(3)?,
                iv: row.get(4)?,
                created_at: 0,
                updated_at: 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let plaintext = decrypt(&state.master_key, &cred.encrypted_data, &cred.iv)
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

    Ok(DecryptedCredential {
        id: cred.id,
        name: cred.name,
        r#type: cred.r#type,
        data,
    })
}

/// Resuelve todas las credentials referenciadas por un workflow antes de
/// ejecutarlo. Devuelve un mapa nodeId → { credName → data }.
pub fn resolve_workflow_credentials(
    db: &Mutex<Connection>,
    state: &CredentialsState,
    workflow_nodes: &[serde_json::Value],
) -> Result<std::collections::HashMap<String, std::collections::HashMap<String, serde_json::Value>>> {
    let mut result: std::collections::HashMap<String, std::collections::HashMap<String, serde_json::Value>> =
        std::collections::HashMap::new();

    for node in workflow_nodes {
        let config = node.get("config").and_then(|c| c.as_object());
        if let Some(config) = config {
            if let Some(cred_id) = config.get("credentialId").and_then(|v| v.as_str()) {
                let conn = db.lock().map_err(|e| anyhow!("{}", e))?;
                let mut stmt = conn
                    .prepare("SELECT id, name, type, encrypted_data, iv FROM credentials WHERE id = ?")?;
                let cred = stmt.query_row(params![cred_id], |row| {
                    Ok(Credential {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        r#type: row.get(2)?,
                        encrypted_data: row.get(3)?,
                        iv: row.get(4)?,
                        created_at: 0,
                        updated_at: 0,
                    })
                })?;
                drop(stmt);
                drop(conn);

                let plaintext = decrypt(&state.master_key, &cred.encrypted_data, &cred.iv)?;
                let data: serde_json::Value = serde_json::from_slice(&plaintext)?;

                let node_id = node.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                result.entry(node_id).or_default().insert("auth".to_string(), data);
            }
        }
    }

    Ok(result)
}
