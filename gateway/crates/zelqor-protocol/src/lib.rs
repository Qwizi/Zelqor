use serde::{Deserialize, Serialize};

/// Messages sent from the central gateway to a gamenode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GatewayToNode {
    /// Forward a player action to the gamenode running their match.
    PlayerAction {
        match_id: String,
        user_id: String,
        action: serde_json::Value,
    },
    /// Notify gamenode that a player connected.
    PlayerConnect {
        match_id: String,
        user_id: String,
    },
    /// Notify gamenode that a player disconnected.
    PlayerDisconnect {
        match_id: String,
        user_id: String,
    },
    /// Request gamenode to start a new match.
    StartMatch {
        match_id: String,
        match_data: serde_json::Value,
    },
    /// Heartbeat ping.
    Heartbeat,
    /// Push match regions data to the gamenode (sent after StartMatch).
    MatchRegions {
        match_id: String,
        regions: serde_json::Value,
    },
    /// Push neighbor map to the gamenode (sent on registration).
    NeighborMap {
        neighbors: serde_json::Value,
    },
    /// Push system module states to the gamenode.
    SystemModules {
        modules: serde_json::Value,
    },
}

/// Messages sent from a gamenode back to the central gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeToGateway {
    /// Broadcast tick state to all players in a match.
    TickBroadcast {
        match_id: String,
        tick: u64,
        tick_data: serde_json::Value,
    },
    /// Match has finished.
    MatchFinished {
        match_id: String,
        winner_id: Option<String>,
        total_ticks: u64,
        final_state: serde_json::Value,
    },
    /// A player was eliminated.
    PlayerEliminated {
        match_id: String,
        user_id: String,
    },
    /// Heartbeat response with node status.
    HeartbeatAck {
        active_matches: u32,
        cpu_load: f32,
    },
    /// Registration message sent on initial connection.
    Register {
        server_id: String,
        server_name: String,
        region: String,
        max_matches: u32,
    },
    /// Save a game state snapshot (fire-and-forget, proxied by gateway).
    SaveSnapshot {
        match_id: String,
        tick: u64,
        state_data: serde_json::Value,
    },
    /// Update match status (fire-and-forget).
    UpdateMatchStatus {
        match_id: String,
        status: String,
    },
    /// Update player alive status (fire-and-forget).
    UpdatePlayerAlive {
        match_id: String,
        user_id: String,
        is_alive: bool,
    },
    /// Send a chat message in a match (fire-and-forget).
    SendChatMessage {
        match_id: String,
        user_id: String,
        content: String,
    },
    /// Report an anticheat violation (fire-and-forget).
    ReportViolation {
        match_id: String,
        player_id: String,
        violation_kind: String,
        severity: String,
        detail: String,
        tick: u64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // -----------------------------------------------------------------------
    // GatewayToNode roundtrip tests
    // -----------------------------------------------------------------------

    #[test]
    fn gateway_to_node_player_action_roundtrip() {
        let msg = GatewayToNode::PlayerAction {
            match_id: "match-1".into(),
            user_id: "user-42".into(),
            action: json!({"move": "forward"}),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: GatewayToNode =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            GatewayToNode::PlayerAction {
                match_id,
                user_id,
                action,
            } => {
                assert_eq!(match_id, "match-1");
                assert_eq!(user_id, "user-42");
                assert_eq!(action, json!({"move": "forward"}));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn gateway_to_node_player_connect_roundtrip() {
        let msg = GatewayToNode::PlayerConnect {
            match_id: "match-2".into(),
            user_id: "user-7".into(),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: GatewayToNode =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            GatewayToNode::PlayerConnect { match_id, user_id } => {
                assert_eq!(match_id, "match-2");
                assert_eq!(user_id, "user-7");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn gateway_to_node_player_disconnect_roundtrip() {
        let msg = GatewayToNode::PlayerDisconnect {
            match_id: "match-3".into(),
            user_id: "user-99".into(),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: GatewayToNode =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            GatewayToNode::PlayerDisconnect { match_id, user_id } => {
                assert_eq!(match_id, "match-3");
                assert_eq!(user_id, "user-99");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn gateway_to_node_start_match_roundtrip() {
        let msg = GatewayToNode::StartMatch {
            match_id: "match-4".into(),
            match_data: json!({"map": "europa", "players": 4}),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: GatewayToNode =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            GatewayToNode::StartMatch {
                match_id,
                match_data,
            } => {
                assert_eq!(match_id, "match-4");
                assert_eq!(match_data["map"], "europa");
                assert_eq!(match_data["players"], 4);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn gateway_to_node_heartbeat_roundtrip() {
        let msg = GatewayToNode::Heartbeat;
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: GatewayToNode =
            serde_json::from_str(&serialized).expect("deserialize");
        assert!(matches!(deserialized, GatewayToNode::Heartbeat));
    }

    // -----------------------------------------------------------------------
    // NodeToGateway roundtrip tests
    // -----------------------------------------------------------------------

    #[test]
    fn node_to_gateway_tick_broadcast_roundtrip() {
        let msg = NodeToGateway::TickBroadcast {
            match_id: "match-1".into(),
            tick: 42,
            tick_data: json!({"units": []}),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::TickBroadcast {
                match_id,
                tick,
                tick_data,
            } => {
                assert_eq!(match_id, "match-1");
                assert_eq!(tick, 42);
                assert_eq!(tick_data["units"], json!([]));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn node_to_gateway_match_finished_roundtrip() {
        let msg = NodeToGateway::MatchFinished {
            match_id: "match-5".into(),
            winner_id: Some("user-1".into()),
            total_ticks: 500,
            final_state: json!({"territories": 42}),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::MatchFinished {
                match_id,
                winner_id,
                total_ticks,
                final_state,
            } => {
                assert_eq!(match_id, "match-5");
                assert_eq!(winner_id, Some("user-1".into()));
                assert_eq!(total_ticks, 500);
                assert_eq!(final_state["territories"], 42);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn node_to_gateway_match_finished_no_winner_roundtrip() {
        let msg = NodeToGateway::MatchFinished {
            match_id: "match-6".into(),
            winner_id: None,
            total_ticks: 100,
            final_state: json!({}),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::MatchFinished { winner_id, .. } => {
                assert_eq!(winner_id, None);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn node_to_gateway_player_eliminated_roundtrip() {
        let msg = NodeToGateway::PlayerEliminated {
            match_id: "match-7".into(),
            user_id: "user-3".into(),
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::PlayerEliminated { match_id, user_id } => {
                assert_eq!(match_id, "match-7");
                assert_eq!(user_id, "user-3");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn node_to_gateway_heartbeat_ack_roundtrip() {
        let msg = NodeToGateway::HeartbeatAck {
            active_matches: 3,
            cpu_load: 0.42,
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::HeartbeatAck {
                active_matches,
                cpu_load,
            } => {
                assert_eq!(active_matches, 3);
                assert!((cpu_load - 0.42_f32).abs() < 1e-5);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn node_to_gateway_register_roundtrip() {
        let msg = NodeToGateway::Register {
            server_id: "node-eu-1".into(),
            server_name: "EU Frankfurt #1".into(),
            region: "eu-west".into(),
            max_matches: 10,
        };
        let serialized = serde_json::to_string(&msg).expect("serialize");
        let deserialized: NodeToGateway =
            serde_json::from_str(&serialized).expect("deserialize");
        match deserialized {
            NodeToGateway::Register {
                server_id,
                server_name,
                region,
                max_matches,
            } => {
                assert_eq!(server_id, "node-eu-1");
                assert_eq!(server_name, "EU Frankfurt #1");
                assert_eq!(region, "eu-west");
                assert_eq!(max_matches, 10);
            }
            _ => panic!("wrong variant"),
        }
    }

    // -----------------------------------------------------------------------
    // Tag field presence in JSON output
    // -----------------------------------------------------------------------

    #[test]
    fn serialized_gateway_to_node_contains_type_tag() {
        let msg = GatewayToNode::Heartbeat;
        let json = serde_json::to_value(&msg).expect("serialize");
        assert_eq!(json["type"], "Heartbeat");
    }

    #[test]
    fn serialized_node_to_gateway_contains_type_tag() {
        let msg = NodeToGateway::HeartbeatAck {
            active_matches: 0,
            cpu_load: 0.0,
        };
        let json = serde_json::to_value(&msg).expect("serialize");
        assert_eq!(json["type"], "HeartbeatAck");
    }
}
