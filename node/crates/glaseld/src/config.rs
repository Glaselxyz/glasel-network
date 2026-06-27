//! GlaselOS configuration (glaseld.toml). Mirrors the shape in §8.5 of the spec,
//! trimmed to what the Phase-3 daemon needs.
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub rpc_url: String,
    #[serde(default = "default_poll")]
    pub poll_interval_ms: u64,
    #[serde(default)]
    pub start_block: u64,
    /// Process a single computation then exit (used by the e2e).
    #[serde(default)]
    pub run_once: bool,
    /// Optional Prometheus `/metrics` scrape address (e.g. "0.0.0.0:9090").
    #[serde(default)]
    pub metrics_addr: Option<String>,
    pub contracts: Contracts,
    pub cluster: Cluster,
    pub engine: Engine,
    pub signers: Signers,
    /// When present, computations run as a real multi-party BGW session over the
    /// authenticated, encrypted mesh instead of the single-process engine.
    #[serde(default)]
    pub mpc: Option<Mpc>,
    /// When present, computations run under MP-SPDZ MASCOT (malicious-secure).
    /// Takes precedence over `mpc`/engine. Requires a built MP-SPDZ.
    #[serde(default)]
    pub malicious: Option<Malicious>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Malicious {
    /// Path to a built MP-SPDZ checkout (see node/scripts/setup-mpspdz.sh).
    pub mpspdz_dir: String,
    /// Number of MASCOT parties (default 2).
    #[serde(default = "default_parties")]
    pub parties: usize,
    /// Party 0's host that every party dials (default localhost — the single-host
    /// distributed POC; set to party 0's IP for a real multi-node cluster).
    #[serde(default = "default_host")]
    pub host: String,
    /// Base port shared by all parties (default 14500).
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_parties() -> usize {
    2
}
fn default_host() -> String {
    "localhost".to_string()
}
fn default_port() -> u16 {
    14500
}

#[derive(Debug, Deserialize, Clone)]
pub struct Mpc {
    /// This node's party index (1..=n) in the cluster.
    pub party_id: usize,
    /// The party that recovers + secret-shares the inputs (default party 1).
    #[serde(default = "default_dealer")]
    pub dealer_id: usize,
    /// BGW threshold `t` (cluster needs `n ≥ 2t + 1`).
    pub threshold: usize,
    /// This node's Noise static private key (hex); its public key is in the roster.
    pub identity_private_key: String,
    /// The cluster roster: `parties[k-1]` is party `k`'s address + Noise pubkey.
    pub parties: Vec<Party>,
    /// Only the node with `submitter = true` posts the result on-chain (the
    /// others compute the same opened result but don't duplicate the submit).
    #[serde(default)]
    pub submitter: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Party {
    pub addr: String,
    pub pubkey: String,
}

fn default_dealer() -> usize {
    1
}

#[derive(Debug, Deserialize)]
pub struct Contracts {
    pub coordinator: String,
    pub cluster_manager: String,
    pub computation_registry: String,
}

#[derive(Debug, Deserialize)]
pub struct Cluster {
    /// X25519 private key the cluster uses to decrypt inputs. In production this
    /// is never materialised on one node — it is a distributed DKG share and
    /// decryption runs in MPC. The simulated engine holds it directly.
    pub x25519_private_key: String,
    /// BN254 group secret key (hex, `sk ∈ F_r`) used to threshold-sign results.
    /// Established by the cluster DKG; its public key is registered on-chain via
    /// `setBlsGroupKey`. In production no node holds the whole key (each holds a
    /// DKG share); the simulated daemon holds the combined key.
    pub bls_group_secret: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct Engine {
    /// Optional fallback recipient key for the BGW/MASCOT paths. The default
    /// single-process engine ignores this and seals each result to the per-job
    /// recipient key carried inside the sealed inputs (so any developer can
    /// decrypt their own result). Defaults to the zero key when omitted.
    #[serde(default)]
    pub recipient_public_key: String,
}

#[derive(Debug, Deserialize)]
pub struct Signers {
    /// Node operator ECDSA keys that threshold-sign the result.
    pub keys: Vec<String>,
}

fn default_poll() -> u64 {
    500
}

impl Config {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let raw =
            std::fs::read_to_string(path).map_err(|e| anyhow::anyhow!("reading {path}: {e}"))?;
        Ok(toml::from_str(&raw)?)
    }
}

/// Resolve a secret reference. Production deployments should NOT inline secrets
/// in `glaseld.toml` (a shared/committed file); instead use:
///   - `env:VAR_NAME`  — read from an environment variable
///   - `file:/path`    — read from a (chmod 600) file, e.g. an encrypted-FS mount
/// A bare value is treated as an inline secret (logged-discouraged for prod).
pub fn resolve_secret(spec: &str) -> anyhow::Result<String> {
    if let Some(var) = spec.strip_prefix("env:") {
        std::env::var(var).map_err(|_| anyhow::anyhow!("secret env var '{var}' not set"))
    } else if let Some(path) = spec.strip_prefix("file:") {
        Ok(std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("reading secret file '{path}': {e}"))?
            .trim()
            .to_string())
    } else {
        Ok(spec.to_string())
    }
}

/// True if any node secret is inlined in the config (so we can warn at startup).
pub fn has_inline_secret(cfg: &Config) -> bool {
    let inline = |s: &str| !s.starts_with("env:") && !s.starts_with("file:");
    inline(&cfg.cluster.x25519_private_key)
        || inline(&cfg.cluster.bls_group_secret)
        || cfg.signers.keys.iter().any(|k| inline(k))
}

pub fn hex32(s: &str) -> anyhow::Result<[u8; 32]> {
    let b = hex::decode(s.trim_start_matches("0x"))?;
    if b.len() != 32 {
        anyhow::bail!("expected 32 bytes, got {}", b.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&b);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::resolve_secret;

    #[test]
    fn resolve_secret_handles_inline_env_file() {
        assert_eq!(resolve_secret("0xdeadbeef").unwrap(), "0xdeadbeef"); // inline
        std::env::set_var("GLASELD_TEST_SECRET", "abc123");
        assert_eq!(resolve_secret("env:GLASELD_TEST_SECRET").unwrap(), "abc123");
        assert!(resolve_secret("env:GLASELD_NONEXISTENT_XYZ").is_err());
        let path = std::env::temp_dir().join("glaseld_secret_test.txt");
        std::fs::write(&path, "filesecret\n").unwrap();
        assert_eq!(
            resolve_secret(&format!("file:{}", path.display())).unwrap(),
            "filesecret"
        );
    }
}
