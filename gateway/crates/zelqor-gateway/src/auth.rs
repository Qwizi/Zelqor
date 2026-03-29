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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};
    use jsonwebtoken::{encode, EncodingKey, Header};
    use std::time::{SystemTime, UNIX_EPOCH};

    const TEST_SECRET: &str = "test-secret-key-for-unit-tests";

    fn now_secs() -> usize {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as usize
    }

    fn make_token(user_id: &str, exp: usize, secret: &str) -> String {
        let claims = Claims {
            user_id: user_id.to_string(),
            exp,
            iat: now_secs(),
            jti: "test-jti".to_string(),
            token_type: "access".to_string(),
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .expect("encoding should succeed in test setup")
    }

    // -----------------------------------------------------------------------
    // validate_token
    // -----------------------------------------------------------------------

    mod validate_token {
        use super::*;

        #[test]
        fn returns_user_id_for_valid_token() {
            let token = make_token("user-42", now_secs() + 3600, TEST_SECRET);

            let result = validate_token(&token, TEST_SECRET);

            assert!(
                result.is_ok(),
                "valid token should succeed, got: {:?}",
                result.unwrap_err()
            );
            assert_eq!(result.unwrap(), "user-42");
        }

        #[test]
        fn returns_error_for_expired_token() {
            // exp 120 seconds in the past — well beyond the 60-second default leeway
            let token = make_token("user-99", now_secs() - 120, TEST_SECRET);

            let result = validate_token(&token, TEST_SECRET);

            assert!(result.is_err(), "expired token should be rejected");
            assert!(
                result.unwrap_err().contains("JWT validation failed"),
                "error message should mention JWT validation"
            );
        }

        #[test]
        fn returns_error_for_wrong_secret() {
            let token = make_token("user-7", now_secs() + 3600, TEST_SECRET);

            let result = validate_token(&token, "completely-different-secret");

            assert!(result.is_err(), "wrong signature should be rejected");
        }

        #[test]
        fn returns_error_for_malformed_token() {
            let result = validate_token("not.a.valid.jwt.string", TEST_SECRET);

            assert!(result.is_err(), "malformed token should be rejected");
        }

        #[test]
        fn returns_error_for_empty_string() {
            let result = validate_token("", TEST_SECRET);

            assert!(result.is_err(), "empty string should be rejected");
        }

        #[test]
        fn returns_error_for_token_signed_with_empty_secret() {
            // Token signed with "" should be rejected when we expect a real secret
            let token = make_token("user-1", now_secs() + 3600, "");

            let result = validate_token(&token, TEST_SECRET);

            assert!(result.is_err(), "token with wrong secret should be rejected");
        }

        #[test]
        fn preserves_exact_user_id_from_claims() {
            let uid = "abc-def-123-456-ghi";
            let token = make_token(uid, now_secs() + 3600, TEST_SECRET);

            let result = validate_token(&token, TEST_SECRET).expect("should decode valid token");

            assert_eq!(result, uid);
        }
    }

    // -----------------------------------------------------------------------
    // check_origin
    // -----------------------------------------------------------------------

    mod check_origin {
        use super::*;

        fn headers_with_origin(origin: &str) -> HeaderMap {
            let mut h = HeaderMap::new();
            h.insert(
                axum::http::header::ORIGIN,
                HeaderValue::from_str(origin).unwrap(),
            );
            h
        }

        #[test]
        fn allows_any_origin_when_list_is_empty() {
            let headers = headers_with_origin("http://untrusted.example.com");
            let allowed: Vec<String> = vec![];

            let result = check_origin(&headers, &allowed);

            assert!(result.is_ok(), "empty allowed list should permit all origins");
        }

        #[test]
        fn allows_matching_origin() {
            let headers = headers_with_origin("https://app.zelqor.com");
            let allowed = vec!["https://app.zelqor.com".to_string()];

            let result = check_origin(&headers, &allowed);

            assert!(
                result.is_ok(),
                "known origin should be allowed, got Err response"
            );
        }

        #[test]
        fn allows_one_of_multiple_origins() {
            let headers = headers_with_origin("https://staging.zelqor.com");
            let allowed = vec![
                "https://app.zelqor.com".to_string(),
                "https://staging.zelqor.com".to_string(),
            ];

            let result = check_origin(&headers, &allowed);

            assert!(result.is_ok(), "second entry in allowed list should match");
        }

        #[test]
        fn rejects_unknown_origin() {
            let headers = headers_with_origin("https://evil.example.com");
            let allowed = vec!["https://app.zelqor.com".to_string()];

            let result = check_origin(&headers, &allowed);

            assert!(result.is_err(), "unlisted origin should be rejected");
        }

        #[test]
        fn rejects_missing_origin_header() {
            let headers = HeaderMap::new();
            let allowed = vec!["https://app.zelqor.com".to_string()];

            let result = check_origin(&headers, &allowed);

            assert!(result.is_err(), "missing Origin header should be rejected");
        }

        #[test]
        fn rejects_partial_origin_match() {
            // Substring must not be treated as a match
            let headers = headers_with_origin("https://app.zelqor.com.evil.com");
            let allowed = vec!["https://app.zelqor.com".to_string()];

            let result = check_origin(&headers, &allowed);

            assert!(
                result.is_err(),
                "substring of an allowed origin should not be accepted"
            );
        }

        #[test]
        fn rejects_wrong_scheme() {
            let headers = headers_with_origin("http://app.zelqor.com");
            let allowed = vec!["https://app.zelqor.com".to_string()];

            let result = check_origin(&headers, &allowed);

            assert!(
                result.is_err(),
                "http scheme should be rejected when only https is allowed"
            );
        }
    }

    // -----------------------------------------------------------------------
    // count_leading_zero_bits
    // -----------------------------------------------------------------------

    mod count_leading_zero_bits {
        use super::*;

        #[test]
        fn returns_zero_for_high_bit_set() {
            // 0xFF = 1111_1111 — no leading zeros
            assert_eq!(count_leading_zero_bits(&[0xFF]), 0);
        }

        #[test]
        fn counts_eight_zeros_for_null_byte() {
            // 0x00 = 0000_0000 — 8 leading zeros
            assert_eq!(count_leading_zero_bits(&[0x00, 0xFF]), 8);
        }

        #[test]
        fn counts_leading_zeros_for_0x0f() {
            // 0x0F = 0000_1111 — 4 leading zeros
            assert_eq!(count_leading_zero_bits(&[0x0F]), 4);
        }

        #[test]
        fn counts_leading_zeros_for_0x01() {
            // 0x01 = 0000_0001 — 7 leading zeros
            assert_eq!(count_leading_zero_bits(&[0x01]), 7);
        }

        #[test]
        fn counts_leading_zeros_for_0x80() {
            // 0x80 = 1000_0000 — 0 leading zeros
            assert_eq!(count_leading_zero_bits(&[0x80]), 0);
        }

        #[test]
        fn counts_across_two_null_bytes_then_non_zero() {
            // [0x00, 0x00, 0x0F] = 16 + 4 = 20 leading zeros
            assert_eq!(count_leading_zero_bits(&[0x00, 0x00, 0x0F]), 20);
        }

        #[test]
        fn returns_zero_for_empty_slice() {
            assert_eq!(count_leading_zero_bits(&[]), 0);
        }

        #[test]
        fn stops_counting_after_first_nonzero_byte() {
            // [0x00, 0x10, 0x00] — 8 from first byte + 3 from 0x10, does not count the trailing 0x00
            assert_eq!(count_leading_zero_bits(&[0x00, 0x10, 0x00]), 11);
        }
    }

    // -----------------------------------------------------------------------
    // validate_token — additional algorithm / claims edge cases
    // -----------------------------------------------------------------------

    mod validate_token_extra {
        use super::*;
        use jsonwebtoken::{encode, EncodingKey, Header, Algorithm};

        #[test]
        fn rejects_token_signed_with_hs512() {
            // Build a token with HS512 instead of the expected HS256.
            let claims = Claims {
                user_id: "user-hs512".to_string(),
                exp: now_secs() + 3600,
                iat: now_secs(),
                jti: "jti-hs512".to_string(),
                token_type: "access".to_string(),
            };
            let token = encode(
                &Header::new(Algorithm::HS512),
                &claims,
                &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
            )
            .expect("HS512 encoding should succeed in test setup");

            // validate_token only accepts HS256 — HS512 tokens must be rejected.
            let result = validate_token(&token, TEST_SECRET);
            assert!(result.is_err(), "HS512-signed token should be rejected by HS256 validator");
            assert!(
                result.unwrap_err().contains("JWT validation failed"),
                "error message should mention JWT validation failure"
            );
        }

        #[test]
        fn rejects_token_missing_user_id_claim() {
            // Craft a minimal payload that lacks the required `user_id` claim.
            // We encode a raw JSON object that has `exp` but no `user_id`.
            #[derive(serde::Serialize)]
            struct NoUserIdClaims {
                exp: usize,
                iat: usize,
            }
            let claims = NoUserIdClaims {
                exp: now_secs() + 3600,
                iat: now_secs(),
            };
            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
            )
            .expect("encoding should succeed");

            // validate_token requires `user_id` in required_spec_claims.
            let result = validate_token(&token, TEST_SECRET);
            assert!(result.is_err(), "token without user_id should be rejected");
        }

        #[test]
        fn rejects_token_missing_exp_claim() {
            // A token without `exp` violates the required_spec_claims set.
            #[derive(serde::Serialize)]
            struct NoExpClaims {
                user_id: String,
            }
            let claims = NoExpClaims {
                user_id: "user-no-exp".to_string(),
            };
            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
            )
            .expect("encoding should succeed");

            let result = validate_token(&token, TEST_SECRET);
            assert!(result.is_err(), "token without exp should be rejected");
        }

        #[test]
        fn accepts_token_with_arbitrary_token_type() {
            // token_type is not validated by validate_token — only user_id matters.
            let claims = Claims {
                user_id: "user-refresh".to_string(),
                exp: now_secs() + 3600,
                iat: now_secs(),
                jti: "jti-refresh".to_string(),
                token_type: "refresh".to_string(),
            };
            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
            )
            .expect("encoding should succeed");

            // validate_token does not enforce token_type — it just extracts user_id.
            let result = validate_token(&token, TEST_SECRET);
            assert!(
                result.is_ok(),
                "validate_token does not reject by token_type, got: {:?}",
                result.unwrap_err()
            );
            assert_eq!(result.unwrap(), "user-refresh");
        }

        #[test]
        fn rejects_completely_empty_user_id_when_present() {
            // An empty string user_id is technically valid JSON but semantically
            // useless — however validate_token returns whatever is in the claim.
            // This test documents the current behaviour (pass-through).
            let claims = Claims {
                user_id: String::new(),
                exp: now_secs() + 3600,
                iat: now_secs(),
                jti: "jti-empty-uid".to_string(),
                token_type: "access".to_string(),
            };
            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
            )
            .expect("encoding should succeed");

            // The function extracts the claim as-is; an empty string is returned.
            let result = validate_token(&token, TEST_SECRET);
            assert!(result.is_ok(), "validate_token does not enforce non-empty user_id");
            assert_eq!(result.unwrap(), "");
        }
    }

    // -----------------------------------------------------------------------
    // verify_pow
    // -----------------------------------------------------------------------

    mod verify_pow {
        use super::*;
        use sha2::{Digest, Sha256};

        /// Brute-force a nonce that satisfies the given difficulty.
        fn mine_nonce(challenge: &str, difficulty: u32) -> String {
            for i in 0u64.. {
                let nonce = i.to_string();
                let mut h = Sha256::new();
                h.update(format!("{challenge}{nonce}"));
                let hash = h.finalize();
                if count_leading_zero_bits(&hash) >= difficulty {
                    return nonce;
                }
            }
            unreachable!("nonce search exhausted u64 range")
        }

        #[test]
        fn accepts_valid_proof_of_work() {
            let challenge = "test-challenge-abc";
            let difficulty = 4; // low difficulty — fast to mine in tests
            let nonce = mine_nonce(challenge, difficulty);

            let result = verify_pow(challenge, &nonce, difficulty);

            assert!(
                result.is_ok(),
                "mined nonce should satisfy difficulty {difficulty}, got: {:?}",
                result.unwrap_err()
            );
        }

        #[test]
        fn rejects_nonce_with_wrong_challenge() {
            let challenge = "test-challenge-abc";
            let difficulty = 4;
            let nonce = mine_nonce(challenge, difficulty);

            // Same nonce, different challenge — hash won't match
            let result = verify_pow("different-challenge", &nonce, difficulty);

            assert!(result.is_err(), "nonce for wrong challenge should be rejected");
        }

        #[test]
        fn rejects_nonce_that_does_not_meet_difficulty() {
            // difficulty=1 means the hash must have at least 1 leading zero bit.
            // Find a nonce that satisfies difficulty=1 but check it fails at difficulty=32.
            let challenge = "test-challenge-xyz";
            let nonce = mine_nonce(challenge, 1);

            // difficulty=32 is very unlikely to be satisfied by a difficulty=1 nonce
            let result = verify_pow(challenge, &nonce, 32);

            // This might occasionally pass by luck at very low difficulty, so we
            // use a high threshold to make the test stable
            let mut h = Sha256::new();
            h.update(format!("{challenge}{nonce}"));
            let hash = h.finalize();
            let zeros = count_leading_zero_bits(&hash);
            if zeros < 32 {
                assert!(result.is_err(), "nonce with only {zeros} leading zeros should fail difficulty 32");
            }
        }

        #[test]
        fn accepts_zero_difficulty_with_any_nonce() {
            // difficulty=0 means any nonce is valid
            let result = verify_pow("any-challenge", "any-nonce", 0);

            assert!(
                result.is_ok(),
                "difficulty=0 should accept any nonce, got: {:?}",
                result.unwrap_err()
            );
        }

        #[test]
        fn rejects_empty_nonce_for_nontrivial_difficulty() {
            // An empty nonce is astronomically unlikely to produce 20 leading zero bits
            let result = verify_pow("some-challenge", "", 20);

            let mut h = Sha256::new();
            h.update("some-challenge");
            let hash = h.finalize();
            let zeros = count_leading_zero_bits(&hash);
            if zeros < 20 {
                assert!(result.is_err(), "empty nonce produced only {zeros} zeros, should fail difficulty 20");
            }
        }
    }
}
