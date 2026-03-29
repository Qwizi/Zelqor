use livekit_api::access_token::{AccessToken, VideoGrants};

/// Generate a LiveKit access token for a player joining a match voice room.
///
/// - `room_name`  — LiveKit room identifier (equals the match UUID)
/// - `user_id`    — participant identity embedded in the JWT `sub` claim
/// - `username`   — human-readable display name embedded in the JWT `name` claim
///
/// The token is valid for 24 hours and grants the participant permission to join
/// the room, publish audio/video, and subscribe to other participants.
pub fn generate_voice_token(
    api_key: &str,
    api_secret: &str,
    room_name: &str,
    user_id: &str,
    username: &str,
) -> Result<String, String> {
    let grants = VideoGrants {
        room_join: true,
        room: room_name.to_string(),
        can_publish: true,
        can_subscribe: true,
        ..Default::default()
    };

    AccessToken::with_api_key(api_key, api_secret)
        .with_identity(user_id)
        .with_name(username)
        .with_grants(grants)
        .with_ttl(std::time::Duration::from_secs(86400))
        .to_jwt()
        .map_err(|e| format!("Failed to generate LiveKit token: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The livekit-api crate validates the secret at construction time but
    // does not require a real LiveKit server to generate JWT strings.
    // All tests here are fully synchronous and pure.

    const API_KEY: &str = "devkey";
    const API_SECRET: &str = "a-secret-that-is-long-enough-for-livekit";

    mod generate_voice_token {
        use super::*;

        #[test]
        fn returns_ok_for_valid_inputs() {
            let result =
                generate_voice_token(API_KEY, API_SECRET, "room-abc", "user-1", "Alice");
            assert!(
                result.is_ok(),
                "valid inputs should produce a token, got: {:?}",
                result.unwrap_err()
            );
        }

        #[test]
        fn token_is_non_empty_string() {
            let token =
                generate_voice_token(API_KEY, API_SECRET, "room-abc", "user-1", "Alice")
                    .expect("token generation should succeed");
            assert!(!token.is_empty(), "generated token must not be empty");
        }

        #[test]
        fn token_is_valid_jwt_structure() {
            // A JWT has exactly three dot-separated segments.
            let token =
                generate_voice_token(API_KEY, API_SECRET, "match-xyz", "user-2", "Bob")
                    .expect("token generation should succeed");
            let segments: Vec<&str> = token.split('.').collect();
            assert_eq!(
                segments.len(),
                3,
                "LiveKit token should be a three-part JWT, got: {token}"
            );
        }

        #[test]
        fn different_rooms_produce_different_tokens() {
            let t1 =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Alice")
                    .expect("first token");
            let t2 =
                generate_voice_token(API_KEY, API_SECRET, "room-2", "user-1", "Alice")
                    .expect("second token");
            // Tokens for different rooms must differ (the payload contains the room name).
            assert_ne!(t1, t2, "different rooms should yield different tokens");
        }

        #[test]
        fn different_users_produce_different_tokens() {
            let t1 =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Alice")
                    .expect("first token");
            let t2 =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-2", "Alice")
                    .expect("second token");
            assert_ne!(t1, t2, "different user IDs should yield different tokens");
        }

        #[test]
        fn different_api_keys_produce_different_tokens() {
            let t1 =
                generate_voice_token("key-a", API_SECRET, "room-1", "user-1", "Alice")
                    .expect("first token");
            let t2 =
                generate_voice_token("key-b", API_SECRET, "room-1", "user-1", "Alice")
                    .expect("second token");
            assert_ne!(t1, t2, "different API keys should yield different tokens");
        }

        #[test]
        fn empty_username_still_produces_token() {
            // Username is a display hint — an empty string should be accepted.
            let result =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "");
            assert!(
                result.is_ok(),
                "empty username should still produce a valid token"
            );
        }

        #[test]
        fn empty_room_name_is_rejected_by_livekit_sdk() {
            // The LiveKit SDK validates that room and identity are non-empty.
            // An empty room name must produce an error rather than a token.
            let result =
                generate_voice_token(API_KEY, API_SECRET, "", "user-1", "Alice");
            assert!(
                result.is_err(),
                "empty room name should be rejected by the LiveKit SDK"
            );
        }

        #[test]
        fn empty_user_id_is_rejected_by_livekit_sdk() {
            // An empty identity (user_id) must produce an error rather than a token.
            let result =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "", "Alice");
            assert!(
                result.is_err(),
                "empty user_id should be rejected by the LiveKit SDK"
            );
        }

        #[test]
        fn different_usernames_produce_different_tokens() {
            let t1 =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Alice")
                    .expect("first token");
            let t2 =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Bob")
                    .expect("second token");
            assert_ne!(
                t1, t2,
                "tokens for different display names must differ"
            );
        }

        #[test]
        fn lobby_prefixed_room_name_is_accepted() {
            // The matchmaking handler generates room names like "lobby_{id}".
            let result = generate_voice_token(
                API_KEY,
                API_SECRET,
                "lobby_550e8400-e29b-41d4-a716-446655440000",
                "user-1",
                "Alice",
            );
            assert!(
                result.is_ok(),
                "lobby-prefixed room name should produce a valid token"
            );
        }

        #[test]
        fn token_payload_segment_is_non_empty() {
            // The second segment (payload) of the JWT must be non-empty.
            let token =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Alice")
                    .expect("token generation should succeed");

            let payload_b64 = token
                .split('.')
                .nth(1)
                .expect("JWT must have a payload segment");

            assert!(!payload_b64.is_empty(), "JWT payload segment must not be empty");
        }

        #[test]
        fn token_header_segment_is_non_empty() {
            // The first segment (header) identifies the algorithm.
            let token =
                generate_voice_token(API_KEY, API_SECRET, "room-1", "user-1", "Alice")
                    .expect("token generation should succeed");

            let header_b64 = token
                .split('.')
                .next()
                .expect("JWT must have a header segment");

            assert!(!header_b64.is_empty(), "JWT header segment must not be empty");
        }
    }
}
