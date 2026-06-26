//! `glasel.toml` — the project manifest. Read by `glaselvm` so commands can
//! default the circuit path and contract addresses from the project instead of
//! requiring every flag each invocation.
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub project: Project,
    #[serde(default)]
    pub network: Network,
    #[serde(default)]
    pub contracts: Contracts,
}

#[derive(Debug, Deserialize)]
pub struct Project {
    pub name: String,
    /// Path to the circuit authoring file (relative to the manifest).
    pub circuit: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct Network {
    #[serde(default)]
    pub rpc: Option<String>,
    #[serde(default)]
    pub chain_id: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Contracts {
    #[serde(default)]
    pub coordinator: Option<String>,
    #[serde(default)]
    pub computation_registry: Option<String>,
    #[serde(default)]
    pub fee_oracle: Option<String>,
    #[serde(default)]
    pub glasel_token: Option<String>,
}

impl Manifest {
    /// Load `glasel.toml` from `dir` (default the current directory).
    pub fn load_from(dir: &Path) -> anyhow::Result<Manifest> {
        let path = dir.join("glasel.toml");
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("reading {}: {e}", path.display()))?;
        Ok(toml::from_str(&raw)?)
    }

    /// Best-effort load from the current directory; `None` if absent/unreadable.
    pub fn maybe_cwd() -> Option<Manifest> {
        Manifest::load_from(Path::new(".")).ok()
    }
}
