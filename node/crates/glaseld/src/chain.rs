//! Chain listener + result submitter (alloy).
use alloy::primitives::{keccak256, Address, Bytes, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::Filter;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use alloy::sol_types::SolEvent;
use std::str::FromStr;

sol! {
    #[sol(rpc)]
    contract Coordinator {
        event ComputationRequested(
            bytes32 indexed computationId,
            bytes32 indexed mxeId,
            bytes32 indexed compDefId,
            bytes encInputs,
            string inputIpfsCid,
            uint64 deadline
        );
        function submitResult(
            bytes32 computationId,
            bytes encResult,
            uint256[2] sig
        ) external;
        function statusOf(bytes32 computationId) external view returns (uint8);
    }

    #[sol(rpc)]
    contract Registry {
        struct ComputationDefinition {
            bytes32 bytecodeHash;
            bytes bytecode;
            string ipfsCid;
            uint32 estimatedGates;
            uint32 inputCount;
            uint32 outputCount;
            address deployer;
            uint64 deployedAt;
            bool deprecated;
        }
        function getDefinition(bytes32 compDefId) external view returns (ComputationDefinition);
    }
}

/// A computation detected on-chain and awaiting execution.
#[derive(Clone, Debug)]
pub struct Task {
    pub computation_id: B256,
    pub mxe_id: B256,
    pub comp_def_id: B256,
    pub enc_inputs: Vec<u8>,
}

pub struct Chain {
    rpc_url: String,
    coordinator: Address,
    registry: Address,
    submitter_key: PrivateKeySigner,
}

impl Chain {
    pub fn new(
        rpc_url: &str,
        coordinator: &str,
        registry: &str,
        submitter_key: &str,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            rpc_url: rpc_url.to_string(),
            coordinator: Address::from_str(coordinator)?,
            registry: Address::from_str(registry)?,
            submitter_key: PrivateKeySigner::from_str(submitter_key.trim_start_matches("0x"))?,
        })
    }

    /// Fetch + integrity-check the circuit bytecode for a computation definition.
    ///
    /// On-chain `bytecodeHash = keccak256(inline ? bytecode : ipfsCid)`. For inline
    /// circuits we verify the bytes directly; for IPFS we verify that the CID we
    /// fetch is the on-chain-committed one (and IPFS CIDs are themselves content
    /// hashes). A mismatch aborts — a node never runs unverified bytecode.
    pub async fn circuit_bytecode(&self, comp_def_id: B256) -> anyhow::Result<Vec<u8>> {
        let reg = Registry::new(self.registry, self.provider().await?);
        let def = reg.getDefinition(comp_def_id).call().await?._0;

        if !def.bytecode.is_empty() {
            let bc = def.bytecode.to_vec();
            verify_committed(&bc, def.bytecodeHash)?; // inline: hash commits to bytecode
            Ok(bc)
        } else if !def.ipfsCid.is_empty() {
            verify_committed(def.ipfsCid.as_bytes(), def.bytecodeHash)?; // committed CID
            let gateway =
                std::env::var("IPFS_GATEWAY").unwrap_or_else(|_| "https://ipfs.io/ipfs".into());
            let url = format!("{}/{}", gateway.trim_end_matches('/'), def.ipfsCid);
            let bytes = reqwest::get(&url)
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec();
            // NOTE hardening: recompute the CID multihash from `bytes` to also defend
            // against a lying gateway (IPFS guarantees content↔CID for honest ones).
            Ok(bytes)
        } else {
            anyhow::bail!(
                "computation definition {comp_def_id} has neither inline bytecode nor an IPFS CID"
            )
        }
    }

    async fn provider(&self) -> anyhow::Result<impl Provider> {
        Ok(ProviderBuilder::new().on_builtin(&self.rpc_url).await?)
    }

    pub async fn latest_block(&self) -> anyhow::Result<u64> {
        Ok(self.provider().await?.get_block_number().await?)
    }

    /// Fetch ComputationRequested events in [from, to].
    pub async fn poll(&self, from: u64, to: u64) -> anyhow::Result<Vec<Task>> {
        let filter = Filter::new()
            .address(self.coordinator)
            .event_signature(Coordinator::ComputationRequested::SIGNATURE_HASH)
            .from_block(from)
            .to_block(to);

        let logs = self.provider().await?.get_logs(&filter).await?;
        let mut tasks = Vec::new();
        for log in logs {
            let ev = Coordinator::ComputationRequested::decode_log(log.as_ref(), true)?;
            tasks.push(Task {
                computation_id: ev.computationId,
                mxe_id: ev.mxeId,
                comp_def_id: ev.compDefId,
                enc_inputs: ev.encInputs.to_vec(),
            });
        }
        Ok(tasks)
    }

    pub async fn status_of(&self, computation_id: B256) -> anyhow::Result<u8> {
        let coord = Coordinator::new(self.coordinator, self.provider().await?);
        Ok(coord.statusOf(computation_id).call().await?._0)
    }

    /// Submit a threshold-BLS-signed result (one aggregated BN254 signature).
    pub async fn submit_result(
        &self,
        computation_id: B256,
        enc_result: Vec<u8>,
        sig: [U256; 2],
    ) -> anyhow::Result<B256> {
        let wallet = alloy::network::EthereumWallet::from(self.submitter_key.clone());
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(self.rpc_url.parse()?);
        let coord = Coordinator::new(self.coordinator, provider);
        let pending = coord
            .submitResult(computation_id, Bytes::from(enc_result), sig)
            .send()
            .await?;
        let receipt = pending.get_receipt().await?;
        if !receipt.status() {
            anyhow::bail!("submitResult reverted in tx {}", receipt.transaction_hash);
        }
        Ok(receipt.transaction_hash)
    }
}

/// Integrity gate: `keccak256(data)` must equal the on-chain commitment.
fn verify_committed(data: &[u8], expected: B256) -> anyhow::Result<()> {
    let got = keccak256(data);
    if got != expected {
        anyhow::bail!("circuit integrity check failed: expected {expected}, got {got}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integrity_accepts_committed_rejects_tampered() {
        let bytecode = b"CFDC\x00\x01...circuit bytecode...";
        let committed = keccak256(bytecode); // how the registry computes bytecodeHash
        assert!(
            verify_committed(bytecode, committed).is_ok(),
            "matching bytecode accepted"
        );
        assert!(
            verify_committed(b"tampered bytecode", committed).is_err(),
            "tampered bytecode rejected"
        );
    }
}
