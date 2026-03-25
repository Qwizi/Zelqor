/// Application configuration loaded from environment variables.
#[derive(Clone)]
pub struct AppConfig {
    pub secret_key: String,
    pub redis_host: String,
    pub redis_port: u16,
    pub redis_game_db: u8,
    pub django_internal_url: String,
    pub internal_secret: String,
    pub gateway_port: u16,
    pub livekit_url: String,
    pub livekit_public_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    /// Allowed WebSocket origins — shares CORS_ALLOWED_ORIGINS with Django.
    /// Empty = allow all (dev mode).
    pub allowed_ws_origins: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            secret_key: std::env::var("SECRET_KEY")
                .unwrap_or_else(|_| "django-insecure-dev-key-change-in-production".into()),
            redis_host: std::env::var("REDIS_HOST").unwrap_or_else(|_| "redis".into()),
            redis_port: std::env::var("REDIS_PORT")
                .unwrap_or_else(|_| "6379".into())
                .parse()
                .unwrap_or(6379),
            redis_game_db: std::env::var("REDIS_GAME_DB")
                .unwrap_or_else(|_| "1".into())
                .parse()
                .unwrap_or(1),
            django_internal_url: std::env::var("DJANGO_INTERNAL_URL")
                .unwrap_or_else(|_| "http://backend:8000".into()),
            internal_secret: std::env::var("INTERNAL_SECRET")
                .unwrap_or_else(|_| "dev-internal-secret".into()),
            gateway_port: std::env::var("GATEWAY_PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .unwrap_or(8080),
            livekit_url: std::env::var("LIVEKIT_URL")
                .unwrap_or_else(|_| "ws://livekit:7880".into()),
            livekit_public_url: std::env::var("LIVEKIT_PUBLIC_URL")
                .unwrap_or_else(|_| "ws://localhost:7880".into()),
            livekit_api_key: std::env::var("LIVEKIT_API_KEY")
                .unwrap_or_else(|_| "devkey".into()),
            livekit_api_secret: std::env::var("LIVEKIT_API_SECRET")
                .unwrap_or_else(|_| "devsecret-maplord-at-least-32-chars-long".into()),
            allowed_ws_origins: std::env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        }
    }

    pub fn redis_url(&self) -> String {
        if let Ok(password) = std::env::var("REDIS_PASSWORD") {
            if !password.is_empty() {
                return format!(
                    "redis://:{}@{}:{}/{}",
                    password, self.redis_host, self.redis_port, self.redis_game_db
                );
            }
        }
        format!(
            "redis://{}:{}/{}",
            self.redis_host, self.redis_port, self.redis_game_db
        )
    }

    /// Validate configuration secrets.
    ///
    /// In production (`ENVIRONMENT=production`) insecure defaults cause a panic.
    /// In all other environments they emit warnings so developers notice early.
    pub fn validate(&self) {
        let is_prod = std::env::var("ENVIRONMENT")
            .unwrap_or_default()
            .eq_ignore_ascii_case("production");

        if is_prod {
            if self.secret_key.starts_with("django-insecure") {
                panic!("SECRET_KEY must be set to a secure value in production");
            }
            if self.internal_secret == "dev-internal-secret" {
                panic!("INTERNAL_SECRET must be set to a secure value in production");
            }
            if std::env::var("REDIS_PASSWORD").unwrap_or_default().is_empty() {
                panic!("REDIS_PASSWORD must be set in production");
            }
        } else {
            if self.secret_key.starts_with("django-insecure") {
                tracing::warn!(
                    "Using insecure default SECRET_KEY — do not use in production"
                );
            }
            if self.internal_secret == "dev-internal-secret" {
                tracing::warn!(
                    "Using insecure default INTERNAL_SECRET — do not use in production"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Env var tests must run sequentially — shared mutex across all submodules.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    // -----------------------------------------------------------------------
    // AppConfig::redis_url
    // -----------------------------------------------------------------------

    mod redis_url {
        use super::*;

        fn config_with(host: &str, port: u16, db: u8) -> AppConfig {
            AppConfig {
                secret_key: "key".to_string(),
                redis_host: host.to_string(),
                redis_port: port,
                redis_game_db: db,
                django_internal_url: "http://backend:8000".to_string(),
                internal_secret: "secret".to_string(),
                gateway_port: 8080,
                livekit_url: "ws://livekit:7880".to_string(),
                livekit_public_url: "ws://localhost:7880".to_string(),
                livekit_api_key: "key".to_string(),
                livekit_api_secret: "devsecret-maplord-at-least-32-chars-long".to_string(),
                allowed_ws_origins: vec![],
            }
        }

        #[test]
        fn url_contains_host_port_and_db() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::remove_var("REDIS_PASSWORD");
            let cfg = config_with("redis", 6379, 1);
            let url = cfg.redis_url();
            assert_eq!(url, "redis://redis:6379/1");
        }

        #[test]
        fn url_includes_password_when_set() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_PASSWORD", "s3cr3t");
            let cfg = config_with("redis", 6379, 1);
            let url = cfg.redis_url();
            std::env::remove_var("REDIS_PASSWORD");
            assert_eq!(url, "redis://:s3cr3t@redis:6379/1");
        }

        #[test]
        fn url_without_password_when_env_empty() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_PASSWORD", "");
            let cfg = config_with("redis", 6379, 1);
            let url = cfg.redis_url();
            std::env::remove_var("REDIS_PASSWORD");
            assert_eq!(url, "redis://redis:6379/1");
        }

        #[test]
        fn url_uses_custom_host() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::remove_var("REDIS_PASSWORD");
            let cfg = config_with("my-redis-host", 6380, 2);
            let url = cfg.redis_url();
            assert!(url.contains("my-redis-host"));
        }

        #[test]
        fn url_uses_custom_port() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::remove_var("REDIS_PASSWORD");
            let cfg = config_with("localhost", 6380, 0);
            let url = cfg.redis_url();
            assert!(url.contains(":6380/"));
        }

        #[test]
        fn url_uses_custom_db_number() {
            let cfg = config_with("redis", 6379, 5);
            let url = cfg.redis_url();
            assert!(url.ends_with("/5"));
        }

        #[test]
        fn url_has_redis_scheme() {
            let cfg = config_with("redis", 6379, 1);
            assert!(cfg.redis_url().starts_with("redis://"));
        }
    }

    // -----------------------------------------------------------------------
    // AppConfig::from_env — default values
    // -----------------------------------------------------------------------

    mod from_env_defaults {
        use super::*;

        // Run with env vars cleared to hit all defaults.
        fn default_config() -> AppConfig {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // Temporarily unset env vars that would interfere.
            // We use a scoped approach: store originals, unset, load, restore.
            let vars = [
                "SECRET_KEY",
                "REDIS_HOST",
                "REDIS_PORT",
                "REDIS_GAME_DB",
                "DJANGO_INTERNAL_URL",
                "INTERNAL_SECRET",
                "GATEWAY_PORT",
                "LIVEKIT_URL",
                "LIVEKIT_PUBLIC_URL",
                "LIVEKIT_API_KEY",
                "LIVEKIT_API_SECRET",
                "CORS_ALLOWED_ORIGINS",
            ];
            let originals: Vec<(_, Option<String>)> = vars
                .iter()
                .map(|k| (*k, std::env::var(k).ok()))
                .collect();

            for key in &vars {
                std::env::remove_var(key);
            }

            let cfg = AppConfig::from_env();

            // Restore
            for (key, val) in originals {
                match val {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }

            cfg
        }

        #[test]
        fn default_redis_host_is_redis() {
            let cfg = default_config();
            assert_eq!(cfg.redis_host, "redis");
        }

        #[test]
        fn default_redis_port_is_6379() {
            let cfg = default_config();
            assert_eq!(cfg.redis_port, 6379);
        }

        #[test]
        fn default_redis_game_db_is_1() {
            let cfg = default_config();
            assert_eq!(cfg.redis_game_db, 1);
        }

        #[test]
        fn default_gateway_port_is_8080() {
            let cfg = default_config();
            assert_eq!(cfg.gateway_port, 8080);
        }

        #[test]
        fn default_django_url_points_to_backend() {
            let cfg = default_config();
            assert_eq!(cfg.django_internal_url, "http://backend:8000");
        }

        #[test]
        fn default_allowed_ws_origins_is_empty() {
            let cfg = default_config();
            assert!(
                cfg.allowed_ws_origins.is_empty(),
                "empty CORS_ALLOWED_ORIGINS should produce empty vec"
            );
        }

        #[test]
        fn default_secret_key_is_insecure_dev_key() {
            let cfg = default_config();
            assert!(
                cfg.secret_key.contains("insecure"),
                "default key should be obviously insecure for dev"
            );
        }
    }

    // -----------------------------------------------------------------------
    // AppConfig::from_env — reading actual env vars
    // -----------------------------------------------------------------------

    mod from_env_overrides {
        use super::*;

        #[test]
        fn cors_allowed_origins_splits_on_comma() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var(
                "CORS_ALLOWED_ORIGINS",
                "https://app.maplord.com,https://staging.maplord.com",
            );
            let cfg = AppConfig::from_env();
            std::env::remove_var("CORS_ALLOWED_ORIGINS");
            assert!(cfg.allowed_ws_origins.contains(&"https://app.maplord.com".to_string()));
            assert!(cfg.allowed_ws_origins.contains(&"https://staging.maplord.com".to_string()));
        }

        #[test]
        fn cors_allowed_origins_trims_whitespace() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var(
                "CORS_ALLOWED_ORIGINS",
                "  https://app.maplord.com , https://staging.maplord.com  ",
            );
            let cfg = AppConfig::from_env();
            std::env::remove_var("CORS_ALLOWED_ORIGINS");
            assert!(cfg
                .allowed_ws_origins
                .contains(&"https://app.maplord.com".to_string()));
        }

        #[test]
        fn cors_allowed_origins_filters_empty_entries() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // Leading/trailing commas produce empty strings — they should be dropped.
            std::env::set_var("CORS_ALLOWED_ORIGINS", ",https://app.maplord.com,");
            let cfg = AppConfig::from_env();
            std::env::remove_var("CORS_ALLOWED_ORIGINS");
            assert!(cfg.allowed_ws_origins.contains(&"https://app.maplord.com".to_string()));
            // Empty strings from leading/trailing commas must not appear
            assert!(!cfg.allowed_ws_origins.contains(&"".to_string()));
        }

        #[test]
        fn redis_port_invalid_string_falls_back_to_6379() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_PORT", "not-a-number");
            let cfg = AppConfig::from_env();
            std::env::remove_var("REDIS_PORT");
            assert_eq!(cfg.redis_port, 6379);
        }

        #[test]
        fn gateway_port_invalid_string_falls_back_to_8080() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("GATEWAY_PORT", "bad");
            let cfg = AppConfig::from_env();
            std::env::remove_var("GATEWAY_PORT");
            assert_eq!(cfg.gateway_port, 8080);
        }

        #[test]
        fn redis_port_valid_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_PORT", "6380");
            let cfg = AppConfig::from_env();
            std::env::remove_var("REDIS_PORT");
            assert_eq!(cfg.redis_port, 6380);
        }

        #[test]
        fn redis_game_db_invalid_string_falls_back_to_1() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_GAME_DB", "not-a-u8");
            let cfg = AppConfig::from_env();
            std::env::remove_var("REDIS_GAME_DB");
            assert_eq!(cfg.redis_game_db, 1);
        }

        #[test]
        fn redis_game_db_valid_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("REDIS_GAME_DB", "3");
            let cfg = AppConfig::from_env();
            std::env::remove_var("REDIS_GAME_DB");
            assert_eq!(cfg.redis_game_db, 3);
        }

        #[test]
        fn secret_key_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("SECRET_KEY", "my-very-secure-secret-key");
            let cfg = AppConfig::from_env();
            std::env::remove_var("SECRET_KEY");
            assert_eq!(cfg.secret_key, "my-very-secure-secret-key");
        }

        #[test]
        fn internal_secret_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("INTERNAL_SECRET", "prod-internal-secret");
            let cfg = AppConfig::from_env();
            std::env::remove_var("INTERNAL_SECRET");
            assert_eq!(cfg.internal_secret, "prod-internal-secret");
        }

        #[test]
        fn livekit_api_key_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("LIVEKIT_API_KEY", "my-lk-key");
            let cfg = AppConfig::from_env();
            std::env::remove_var("LIVEKIT_API_KEY");
            assert_eq!(cfg.livekit_api_key, "my-lk-key");
        }

        #[test]
        fn gateway_port_valid_override_is_respected() {
            let _guard = super::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("GATEWAY_PORT", "9090");
            let cfg = AppConfig::from_env();
            std::env::remove_var("GATEWAY_PORT");
            assert_eq!(cfg.gateway_port, 9090);
        }
    }

    // -----------------------------------------------------------------------
    // AppConfig::validate — production vs dev behaviour
    // -----------------------------------------------------------------------

    mod validate {
        use super::*;

        fn secure_config() -> AppConfig {
            AppConfig {
                secret_key: "a-very-long-and-secure-production-secret-key".to_string(),
                redis_host: "redis".to_string(),
                redis_port: 6379,
                redis_game_db: 1,
                django_internal_url: "http://backend:8000".to_string(),
                internal_secret: "prod-internal-secret-not-default".to_string(),
                gateway_port: 8080,
                livekit_url: "ws://livekit:7880".to_string(),
                livekit_public_url: "ws://localhost:7880".to_string(),
                livekit_api_key: "prodkey".to_string(),
                livekit_api_secret: "devsecret-maplord-at-least-32-chars-long".to_string(),
                allowed_ws_origins: vec![],
            }
        }

        fn insecure_config() -> AppConfig {
            AppConfig {
                secret_key: "django-insecure-dev-key-change-in-production".to_string(),
                internal_secret: "dev-internal-secret".to_string(),
                ..secure_config()
            }
        }

        /// Run `validate()` under a specific `ENVIRONMENT` value and restore
        /// both `ENVIRONMENT` and `REDIS_PASSWORD` afterwards.
        fn run_validate_with_env(
            cfg: &AppConfig,
            environment: &str,
            redis_password: Option<&str>,
        ) {
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

            let orig_env = std::env::var("ENVIRONMENT").ok();
            let orig_pw = std::env::var("REDIS_PASSWORD").ok();

            std::env::set_var("ENVIRONMENT", environment);
            match redis_password {
                Some(pw) => std::env::set_var("REDIS_PASSWORD", pw),
                None => std::env::remove_var("REDIS_PASSWORD"),
            }

            cfg.validate();

            match orig_env {
                Some(v) => std::env::set_var("ENVIRONMENT", v),
                None => std::env::remove_var("ENVIRONMENT"),
            }
            match orig_pw {
                Some(v) => std::env::set_var("REDIS_PASSWORD", v),
                None => std::env::remove_var("REDIS_PASSWORD"),
            }
        }

        #[test]
        fn dev_mode_with_insecure_defaults_does_not_panic() {
            // In non-production environments insecure defaults are only warnings.
            let cfg = insecure_config();
            // Should not panic regardless of REDIS_PASSWORD.
            run_validate_with_env(&cfg, "development", None);
        }

        #[test]
        fn dev_mode_with_secure_config_does_not_panic() {
            let cfg = secure_config();
            run_validate_with_env(&cfg, "development", Some("s3cr3t"));
        }

        #[test]
        fn staging_environment_with_insecure_defaults_does_not_panic() {
            // "staging" is not "production" so the panic branch should not fire.
            let cfg = insecure_config();
            run_validate_with_env(&cfg, "staging", None);
        }

        #[test]
        #[should_panic(expected = "SECRET_KEY must be set to a secure value in production")]
        fn production_with_insecure_secret_key_panics() {
            let cfg = insecure_config();
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("ENVIRONMENT", "production");
            std::env::set_var("REDIS_PASSWORD", "s3cr3t");
            cfg.validate();
        }

        #[test]
        #[should_panic(expected = "INTERNAL_SECRET must be set to a secure value in production")]
        fn production_with_default_internal_secret_panics() {
            let cfg = AppConfig {
                secret_key: "secure-key-long-enough-for-production".to_string(),
                internal_secret: "dev-internal-secret".to_string(),
                ..secure_config()
            };
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("ENVIRONMENT", "production");
            std::env::set_var("REDIS_PASSWORD", "s3cr3t");
            cfg.validate();
        }

        #[test]
        #[should_panic(expected = "REDIS_PASSWORD must be set in production")]
        fn production_without_redis_password_panics() {
            let cfg = secure_config();
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("ENVIRONMENT", "production");
            std::env::remove_var("REDIS_PASSWORD");
            cfg.validate();
        }

        #[test]
        #[should_panic(expected = "REDIS_PASSWORD must be set in production")]
        fn production_with_empty_redis_password_panics() {
            let cfg = secure_config();
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            std::env::set_var("ENVIRONMENT", "production");
            std::env::set_var("REDIS_PASSWORD", "");
            cfg.validate();
        }

        #[test]
        fn production_with_all_secure_values_does_not_panic() {
            let cfg = secure_config();
            run_validate_with_env(&cfg, "production", Some("strong-redis-password"));
        }

        #[test]
        fn production_check_is_case_insensitive_for_environment_value() {
            // "Production" (capital P) must also trigger the production checks.
            // A secure config must pass.
            let cfg = secure_config();
            run_validate_with_env(&cfg, "Production", Some("strong-redis-password"));
        }
    }
}
