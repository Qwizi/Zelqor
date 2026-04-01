//! Plugin loader — receives plugin list from the gateway (pushed via
//! WebSocket), downloads WASM blobs, caches them locally, and loads them
//! into a [`PluginManager`].
//!
//! The gamenode never contacts Django directly — the gateway fetches the
//! plugin list and pushes it as a `GatewayToNode::PluginList` message.

use crate::config::NodeConfig;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tracing::{debug, error, info, warn};
use zelqor_plugins::{
    host::WasmPlugin, sandbox::SandboxConfig, PluginManifest, PluginManager,
};

/// A single plugin entry as received from the gateway's PluginList message.
#[derive(Debug, Deserialize)]
pub(crate) struct PluginEntry {
    slug: String,
    name: String,
    version: String,
    author: String,
    hooks: Vec<String>,
    permissions: Vec<String>,
    min_engine_version: Option<String>,
    wasm_url: Option<String>,
    wasm_hash: String,
    #[allow(dead_code)]
    config: serde_json::Value,
    #[allow(dead_code)]
    priority: i32,
}

/// Download and load plugins from a JSON plugin list pushed by the gateway.
///
/// The `plugins_json` value is the array received in `GatewayToNode::PluginList`.
/// On any error the function logs a warning and returns an empty manager so
/// the gamenode can still run (just without plugins).
pub async fn load_plugins_from_list(
    http_client: &reqwest::Client,
    cfg: &NodeConfig,
    plugins_json: &serde_json::Value,
) -> PluginManager {
    let mut manager = PluginManager::new();

    let entries: Vec<PluginEntry> = match serde_json::from_value(plugins_json.clone()) {
        Ok(e) => e,
        Err(e) => {
            warn!("Failed to parse plugin list from gateway: {e}");
            return manager;
        }
    };

    if entries.is_empty() {
        info!("No plugins installed on this server");
        return manager;
    }

    info!(
        count = entries.len(),
        "Received plugin list from gateway, downloading WASM files"
    );

    // Ensure the local plugin cache directory exists.
    let cache_dir = PathBuf::from(&cfg.plugins_dir);
    if let Err(e) = tokio::fs::create_dir_all(&cache_dir).await {
        error!("Failed to create plugin cache dir {:?}: {e}", cache_dir);
        return manager;
    }

    // Download each plugin and load it.
    for entry in &entries {
        let wasm_url = match &entry.wasm_url {
            Some(u) if !u.is_empty() => u,
            _ => {
                warn!(
                    plugin = %entry.slug,
                    "Plugin has no WASM URL, skipping"
                );
                continue;
            }
        };

        match download_and_load(http_client, &cache_dir, entry, wasm_url).await {
            Ok(plugin) => {
                info!(
                    plugin = %entry.slug,
                    version = %entry.version,
                    hooks = ?entry.hooks,
                    "Loaded plugin"
                );
                manager.register(Box::new(plugin));
            }
            Err(e) => {
                error!(
                    plugin = %entry.slug,
                    error = %e,
                    "Failed to load plugin, skipping"
                );
            }
        }
    }

    info!(
        loaded = manager.plugin_count(),
        total = entries.len(),
        "Plugin loading complete"
    );
    manager
}

/// Download a single plugin WASM file (with local cache) and return a loaded
/// [`WasmPlugin`].
async fn download_and_load(
    http_client: &reqwest::Client,
    cache_dir: &Path,
    entry: &PluginEntry,
    wasm_url: &str,
) -> anyhow::Result<WasmPlugin> {
    // Cache file: {plugins_dir}/{slug}-{hash_prefix}.wasm
    let hash_prefix = if entry.wasm_hash.len() >= 12 {
        &entry.wasm_hash[..12]
    } else {
        &entry.wasm_hash
    };
    let cache_file = cache_dir.join(format!("{}-{}.wasm", entry.slug, hash_prefix));

    // Use cached file if it exists and hash matches.
    let wasm_bytes = if cache_file.exists() {
        debug!(
            plugin = %entry.slug,
            path = %cache_file.display(),
            "Using cached WASM file"
        );
        let bytes = tokio::fs::read(&cache_file).await?;
        // Re-validate hash of cached file to detect corruption/tampering.
        if !entry.wasm_hash.is_empty() {
            let computed = sha256_hex(&bytes);
            if computed != entry.wasm_hash {
                warn!(
                    plugin = %entry.slug,
                    "Cached WASM hash mismatch, re-downloading"
                );
                let _ = tokio::fs::remove_file(&cache_file).await;
                return Box::pin(download_and_load(http_client, cache_dir, entry, wasm_url)).await;
            }
        }
        bytes
    } else {
        debug!(
            plugin = %entry.slug,
            url = %wasm_url,
            "Downloading WASM file"
        );
        let resp = http_client
            .get(wasm_url)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Download failed for {}: {e}", entry.slug))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(anyhow::anyhow!(
                "WASM download for {} returned {status}",
                entry.slug
            ));
        }

        let bytes = resp.bytes().await?.to_vec();

        // Verify hash if provided.
        if !entry.wasm_hash.is_empty() {
            let computed = sha256_hex(&bytes);
            if computed != entry.wasm_hash {
                return Err(anyhow::anyhow!(
                    "Hash mismatch for {}: expected {}, got {}",
                    entry.slug,
                    entry.wasm_hash,
                    computed
                ));
            }
        }

        // Write to cache.
        if let Err(e) = tokio::fs::write(&cache_file, &bytes).await {
            warn!(
                plugin = %entry.slug,
                error = %e,
                "Failed to cache WASM file (continuing anyway)"
            );
        }

        bytes
    };

    // Build the manifest from the API response.
    let manifest = PluginManifest {
        name: entry.name.clone(),
        version: entry.version.clone(),
        author: entry.author.clone(),
        hooks: entry.hooks.clone(),
        permissions: entry.permissions.clone(),
        min_engine_version: entry.min_engine_version.clone(),
    };

    let sandbox = SandboxConfig::default();
    let plugin = WasmPlugin::load(&wasm_bytes, manifest, sandbox)
        .map_err(|e| anyhow::anyhow!("WASM load failed for {}: {e}", entry.slug))?;

    Ok(plugin)
}

/// Compute SHA-256 hex digest of a byte slice.
fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_consistent() {
        let hash = sha256_hex(b"hello world");
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }
}
