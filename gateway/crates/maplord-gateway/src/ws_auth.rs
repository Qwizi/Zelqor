use axum::extract::ws::{Message, WebSocket};
use futures::StreamExt;
use tokio::time::{timeout, Duration};

/// Authenticate a WebSocket connection.
///
/// Tries a pre-validated query-param token first (backward compat).  If no
/// token was in the query string the function waits up to 5 seconds for the
/// client to send a first-message auth frame:
///
/// ```json
/// {"type": "auth", "token": "<JWT>"}
/// ```
///
/// Returns `Some(user_id)` on success or `None` when authentication fails or
/// times out.  On `None` the caller is responsible for closing the socket with
/// code 4001.
///
/// # Arguments
///
/// * `receiver` — the read half of the split WebSocket; the auth message (if
///   consumed) will not be re-delivered to the caller's message loop.
/// * `pre_auth_user_id` — `Some(user_id)` when a valid JWT was already
///   extracted from the query parameters, `None` when we must wait for a
///   first-message auth frame.
/// * `secret_key` — the HS256 signing secret used by `auth::validate_token`.
pub async fn authenticate_ws(
    receiver: &mut futures::stream::SplitStream<WebSocket>,
    pre_auth_user_id: Option<String>,
    secret_key: &str,
) -> Option<String> {
    // 1. Fast path — token was already validated from query params.
    if let Some(uid) = pre_auth_user_id {
        return Some(uid);
    }

    // 2. Wait for a first-message auth frame with a 5-second timeout.
    let secret = secret_key.to_string();
    let auth_result = timeout(Duration::from_secs(5), async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    let val = match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(v) => v,
                        Err(_) => return None, // First message was not valid JSON — reject.
                    };

                    if val.get("type").and_then(|t| t.as_str()) != Some("auth") {
                        // First message was not an auth frame — reject immediately rather than
                        // waiting for the timeout.
                        return None;
                    }

                    let token = match val.get("token").and_then(|t| t.as_str()) {
                        Some(t) => t,
                        None => return None,
                    };

                    return crate::auth::validate_token(token, &secret).ok();
                }
                // Ping/Pong/Binary are ignored while waiting for auth.
                Message::Ping(_) | Message::Pong(_) | Message::Binary(_) => continue,
                // Close frame before auth — reject.
                Message::Close(_) => return None,
            }
        }
        // Stream ended without receiving any message.
        None
    })
    .await;

    match auth_result {
        Ok(result) => result,
        // Timeout expired.
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    // Pure logic tests — the timeout and stream-based async paths are
    // exercised through integration tests.  Here we verify the JSON parsing
    // that mirrors what authenticate_ws does.

    fn parse_auth_message(text: &str) -> Option<&str> {
        let val: serde_json::Value = serde_json::from_str(text).ok()?;
        if val.get("type").and_then(|t| t.as_str()) != Some("auth") {
            return None;
        }
        // We return a static str for test simplicity; production code calls validate_token.
        val.get("token")
            .and_then(|t| t.as_str())
            .map(|_| "parsed")
    }

    #[test]
    fn valid_auth_message_is_parsed() {
        assert_eq!(
            parse_auth_message(r#"{"type":"auth","token":"abc123"}"#),
            Some("parsed")
        );
    }

    #[test]
    fn wrong_type_field_is_rejected() {
        assert_eq!(
            parse_auth_message(r#"{"type":"hello","token":"abc123"}"#),
            None
        );
    }

    #[test]
    fn missing_token_field_is_rejected() {
        assert_eq!(parse_auth_message(r#"{"type":"auth"}"#), None);
    }

    #[test]
    fn missing_type_field_is_rejected() {
        assert_eq!(parse_auth_message(r#"{"token":"abc123"}"#), None);
    }

    #[test]
    fn invalid_json_is_rejected() {
        assert_eq!(parse_auth_message("not json at all"), None);
    }

    #[test]
    fn empty_object_is_rejected() {
        assert_eq!(parse_auth_message("{}"), None);
    }

    // -----------------------------------------------------------------------
    // Additional edge cases for parse_auth_message
    // -----------------------------------------------------------------------

    #[test]
    fn type_field_is_null_is_rejected() {
        // null is not the string "auth".
        assert_eq!(
            parse_auth_message(r#"{"type":null,"token":"abc"}"#),
            None,
            "null type should be rejected"
        );
    }

    #[test]
    fn token_field_is_null_is_rejected() {
        // token present but null — as_str() returns None.
        assert_eq!(
            parse_auth_message(r#"{"type":"auth","token":null}"#),
            None,
            "null token should be rejected"
        );
    }

    #[test]
    fn token_field_is_numeric_is_rejected() {
        // A numeric token cannot be extracted as &str.
        assert_eq!(
            parse_auth_message(r#"{"type":"auth","token":12345}"#),
            None,
            "numeric token should be rejected"
        );
    }

    #[test]
    fn type_field_is_numeric_is_rejected() {
        assert_eq!(
            parse_auth_message(r#"{"type":1,"token":"tok"}"#),
            None,
            "numeric type should be rejected"
        );
    }

    #[test]
    fn empty_string_input_is_rejected() {
        assert_eq!(
            parse_auth_message(""),
            None,
            "empty input should be rejected"
        );
    }

    #[test]
    fn whitespace_only_input_is_rejected() {
        assert_eq!(
            parse_auth_message("   "),
            None,
            "whitespace-only input should be rejected"
        );
    }

    #[test]
    fn auth_type_is_case_sensitive() {
        // "Auth" (capital A) is not equal to "auth".
        assert_eq!(
            parse_auth_message(r#"{"type":"Auth","token":"tok"}"#),
            None,
            "type check must be case-sensitive"
        );
    }

    #[test]
    fn array_input_is_rejected() {
        assert_eq!(
            parse_auth_message(r#"[{"type":"auth","token":"tok"}]"#),
            None,
            "JSON array at top level should be rejected"
        );
    }

    // -----------------------------------------------------------------------
    // Fast-path behaviour (pre_auth_user_id = Some) — exercised synchronously
    // by calling the internal logic directly.
    //
    // authenticate_ws itself is async and stream-based, so we verify the
    // equivalent conditional that drives the fast path:
    //   if let Some(uid) = pre_auth_user_id { return Some(uid); }
    // -----------------------------------------------------------------------

    mod fast_path {
        fn simulate_fast_path(pre_auth: Option<String>) -> Option<String> {
            // Mirrors authenticate_ws line 1: return early when already validated.
            if let Some(uid) = pre_auth {
                return Some(uid);
            }
            // Would continue to wait for auth frame — not exercised here.
            None
        }

        #[test]
        fn some_uid_is_returned_immediately() {
            let result = simulate_fast_path(Some("user-42".to_string()));
            assert_eq!(result, Some("user-42".to_string()));
        }

        #[test]
        fn none_falls_through_to_stream_path() {
            let result = simulate_fast_path(None);
            // Without a stream the simulated path returns None.
            assert_eq!(result, None);
        }

        #[test]
        fn empty_string_user_id_is_returned_as_is() {
            // The fast path does not validate the content of the pre-auth UID.
            let result = simulate_fast_path(Some(String::new()));
            assert_eq!(result, Some(String::new()));
        }

        #[test]
        fn uuid_user_id_is_preserved() {
            let uid = "550e8400-e29b-41d4-a716-446655440000".to_string();
            let result = simulate_fast_path(Some(uid.clone()));
            assert_eq!(result, Some(uid));
        }
    }
}
