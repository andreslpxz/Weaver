//! AWS Bedrock invoke con SigV4 nativo (sin proxy URL).
//!
//! Esto permite que el frontend llame a Bedrock directamente vía Tauri,
//! sin necesidad de un proxy CORS. La firma SigV4 se calcula en Rust con
//! `aws-sigv4` y se envía la request HTTP con `reqwest`.
//!
//! Flujo:
//!   1. El frontend llama `bedrock_invoke(model_id, body, region, access_key,
//!      secret_key, session_token)` vía tauriInvoke.
//!   2. Rust construye la HTTP request: POST /model/{model_id}/invoke
//!      a https://bedrock-runtime.{region}.amazonaws.com
//!   3. Firma con SigV4 (ServiceName=bedrock, Region=dada).
//!   4. Envía la request y devuelve el body de la respuesta.

use anyhow::{anyhow, Result};
use aws_credential_types::Credentials;
use aws_sigv4::http_request::{
    sign as sigv4_sign, SignableBody, SignableRequest, SigningParams, SigningSettings,
};
use aws_smithy_runtime_api::client::identity::Identity;
use std::time::SystemTime;
use http::{Method, Uri};
use reqwest::Client;
use std::time::Duration;

const SERVICE_NAME: &str = "bedrock";

/// Comando Tauri expuesto al frontend como `bedrock_invoke`.
#[tauri::command]
pub async fn bedrock_invoke(
    model_id: String,
    body: String,
    region: String,
    access_key: String,
    secret_key: String,
    session_token: Option<String>,
) -> Result<String, String> {
    invoke_bedrock(
        &model_id,
        &body,
        &region,
        &access_key,
        &secret_key,
        session_token.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Función principal: invoca un modelo de Bedrock con firma SigV4.
pub async fn invoke_bedrock(
    model_id: &str,
    body: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    session_token: Option<&str>,
) -> Result<String> {
    let endpoint = format!(
        "https://bedrock-runtime.{}.amazonaws.com/model/{}/invoke",
        region,
        encode_path(model_id)
    );

    let credentials = Credentials::new(
        access_key,
        secret_key,
        session_token.map(|s| s.to_string()),
        None,
        "weaver-bedrock",
    );
    let identity = Identity::new(credentials, None);

    let signing_params = SigningParams::builder()
        .identity(&identity)
        .region(region)
        .name(SERVICE_NAME)
        .time(SystemTime::now())
        .settings(SigningSettings::default())
        .build()
        .map_err(|e| anyhow!("SigningParams::build: {:?}", e))?;

    let uri: Uri = endpoint
        .parse()
        .map_err(|e| anyhow!("parse uri: {}", e))?;

    let headers = [
        ("content-type", "application/json"),
        (
            "host",
            Box::leak(
                format!("bedrock-runtime.{}.amazonaws.com", region)
                    .into_boxed_str(),
            ),
        ),
    ];

    let signable = SignableRequest::new(
        "POST",
        uri.to_string(),
        headers.iter().map(|(k, v)| (*k, *v)),
        SignableBody::Bytes(body.as_bytes()),
    )
    .map_err(|e| anyhow!("SignableRequest::new: {:?}", e))?;

    let (signing_instructions, _) = sigv4_sign(signable, &signing_params)
        .map_err(|e| anyhow!("sigv4 sign: {:?}", e))?
        .into_parts();

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;

    let mut reqwest_req = client
        .post(&endpoint)
        .header("content-type", "application/json");

    for (name, value) in signing_instructions.headers() {
        reqwest_req = reqwest_req.header(name.as_str(), value.as_str());
    }
    if let Some(token) = session_token {
        reqwest_req = reqwest_req.header("x-amz-security-token", token);
    }

    let reqwest_req = reqwest_req.body(body.to_string()).build()?;
    let response = client.execute(reqwest_req).await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyhow!("Bedrock error {}: {}", status, text));
    }
    Ok(text)
}

/// Codifica un segmento de path para URL (RFC 3986 unreserved chars).
fn encode_path(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
            out.push(c);
        } else {
            for b in c.to_string().into_bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_path() {
        assert_eq!(encode_path("anthropic.claude-3"), "anthropic.claude-3");
        assert_eq!(encode_path("anthropic.claude:3"), "anthropic.claude%3A3");
        assert_eq!(encode_path("a/b"), "a%2Fb");
    }
}
