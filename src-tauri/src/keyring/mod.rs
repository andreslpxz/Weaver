//! Almacenamiento seguro de API keys en el llavero del OS.
//!
//! En Linux usa `libsecret` (vía `gnome-keyring` o `kwallet`); en macOS
//! Keychain; en Windows Credential Manager. La crate `keyring` abstrae todo.

use anyhow::{anyhow, Result};
use keyring::Entry;

const SERVICE: &str = "weaver";

fn entry_for(provider_id: &str) -> Result<Entry> {
    Entry::new(SERVICE, provider_id).map_err(|e| anyhow!("no se pudo crear entry: {e}"))
}

pub fn set_api_key(provider_id: &str, key: &str) -> Result<()> {
    entry_for(provider_id)?
        .set_password(key)
        .map_err(|e| anyhow!("set_password falló: {e}"))
}

pub fn get_api_key(provider_id: &str) -> Result<Option<String>> {
    match entry_for(provider_id)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow!("get_password falló: {e}")),
    }
}

pub fn delete_api_key(provider_id: &str) -> Result<()> {
    match entry_for(provider_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow!("delete_credential falló: {e}")),
    }
}

/// Devuelve la lista de providers para los que ya hay una API key almacenada.
/// Como `keyring` no permite enumerar, probamos los IDs canónicos.
pub fn list_providers_with_keys() -> Vec<String> {
    let known = [
        "openai", "anthropic", "google", "azure", "cohere", "grok", "perplexity",
        "together", "cerebras", "qwen", "glm", "groq", "openrouter", "lightning",
        "nvidia", "deepseek", "mistral", "meta", "vertexai", "bedrock", "huggingface",
    ];
    known
        .into_iter()
        .filter(|p| get_api_key(p).ok().flatten().is_some())
        .map(str::to_string)
        .collect()
}
