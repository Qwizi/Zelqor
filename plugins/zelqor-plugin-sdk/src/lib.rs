/// Guest-side SDK for building Zelqor WASM plugins.
///
/// Each plugin must call `wit_bindgen::generate!` in its own crate
/// to get the `Guest` trait and `export!` macro. This SDK re-exports
/// `wit_bindgen` and provides the path to the WIT file.
///
/// Usage in your plugin:
/// ```ignore
/// wit_bindgen::generate!({
///     world: "zelqor-plugin",
///     path: "../zelqor-plugin-sdk/wit/plugin.wit",
/// });
/// ```
pub use wit_bindgen;

/// WIT file path relative to a sibling plugin crate.
pub const WIT_PATH: &str = "../zelqor-plugin-sdk/wit/plugin.wit";
