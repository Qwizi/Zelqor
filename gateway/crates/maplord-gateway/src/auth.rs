use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub exp: usize,
    #[serde(default)]
    pub iat: usize,
    #[serde(default)]
    pub jti: String,
    #[serde(default)]
    pub token_type: String,
}

/// Validate a JWT token and extract the user_id.
pub fn validate_token(token: &str, secret: &str) -> Result<String, String> {
    let mut validation = Validation::new(Algorithm::HS256);
    // Django's ninja_jwt doesn't require audience
    validation.validate_aud = false;
    // Required claims
    validation.required_spec_claims.clear();
    validation.required_spec_claims.insert("exp".to_string());
    validation.required_spec_claims.insert("user_id".to_string());

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|e| format!("JWT validation failed: {e}"))?;

    Ok(token_data.claims.user_id)
}

/// Check if the request Origin header is in the allowed list.
/// Returns Ok(()) if allowed, Err(Response) if blocked.
pub fn check_origin(
    headers: &axum::http::HeaderMap,
    allowed_origins: &[String],
) -> Result<(), axum::response::Response> {
    // Empty list = allow all (dev mode)
    if allowed_origins.is_empty() {
        return Ok(());
    }

    let origin = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if origin.is_empty() || !allowed_origins.iter().any(|allowed| allowed == origin) {
        tracing::warn!("WebSocket connection rejected: origin '{origin}' not in allowed list");
        return Err(axum::response::Response::builder()
            .status(403)
            .body("Forbidden: origin not allowed".into())
            .unwrap());
    }

    Ok(())
}

#[derive(Deserialize)]
struct TicketData {
    user_id: String,
    challenge: String,
    difficulty: u32,
}

/// Validate a one-time WS ticket + proof-of-work from Redis.
/// Uses GETDEL for atomic get-and-delete to prevent reuse.
pub async fn validate_ticket(
    ticket: &str,
    nonce: Option<&str>,
    redis: &mut redis::aio::ConnectionManager,
) -> Result<String, String> {
    let key = format!("ws_ticket:{ticket}");
    let data: Option<String> = redis::cmd("GETDEL")
        .arg(&key)
        .query_async(redis)
        .await
        .map_err(|e| format!("Redis error: {e}"))?;

    let data = data.ok_or_else(|| "Invalid or expired ticket".to_string())?;
    let ticket_data: TicketData =
        serde_json::from_str(&data).map_err(|e| format!("Ticket data parse error: {e}"))?;

    if let Some(nonce) = nonce {
        verify_pow(&ticket_data.challenge, nonce, ticket_data.difficulty)?;
    }

    Ok(ticket_data.user_id)
}

fn verify_pow(challenge: &str, nonce: &str, difficulty: u32) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(format!("{challenge}{nonce}"));
    let hash = hasher.finalize();
    let leading_zeros = count_leading_zero_bits(&hash);
    if leading_zeros >= difficulty {
        Ok(())
    } else {
        Err("Proof-of-work verification failed".to_string())
    }
}

fn count_leading_zero_bits(bytes: &[u8]) -> u32 {
    let mut count = 0u32;
    for &byte in bytes {
        if byte == 0 {
            count += 8;
        } else {
            count += byte.leading_zeros();
            break;
        }
    }
    count
}
