//! Chain operations for the CLI: deploy a circuit to ComputationRegistry and
//! read fee estimates from FeeOracle (alloy).
use alloy::primitives::{Address, Bytes, B256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use alloy::sol_types::SolEvent;
use std::str::FromStr;

sol! {
    #[sol(rpc)]
    contract Registry {
        event ComputationDefinitionDeployed(bytes32 indexed compDefId, address indexed deployer, uint32 estimatedGates);
        function deployComputationDefinition(bytes bytecode, string ipfsCid, uint32 estimatedGates, uint32 inputCount, uint32 outputCount) external returns (bytes32);
    }
    #[sol(rpc)]
    contract Fee {
        function estimateFee(bytes32 compDefId, uint256 callbackGasLimit) external view returns (uint256);
        function deadlineForCircuit(bytes32 compDefId) external view returns (uint64);
    }
}

pub async fn deploy_circuit(
    rpc: &str,
    private_key: &str,
    registry: &str,
    bytecode: Vec<u8>,
    estimated_gates: u32,
    input_count: u32,
    output_count: u32,
) -> anyhow::Result<B256> {
    let signer = PrivateKeySigner::from_str(private_key.trim_start_matches("0x"))?;
    let wallet = alloy::network::EthereumWallet::from(signer);
    let provider = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(rpc.parse()?);
    let reg = Registry::new(Address::from_str(registry)?, provider);

    let receipt = reg
        .deployComputationDefinition(
            Bytes::from(bytecode),
            String::new(),
            estimated_gates,
            input_count,
            output_count,
        )
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        anyhow::bail!("deployComputationDefinition reverted");
    }

    for log in receipt.inner.logs() {
        if let Ok(ev) = Registry::ComputationDefinitionDeployed::decode_log(log.as_ref(), true) {
            return Ok(ev.compDefId);
        }
    }
    anyhow::bail!("no ComputationDefinitionDeployed event in receipt")
}

pub async fn estimate_fee(
    rpc: &str,
    fee_oracle: &str,
    comp_def_id: B256,
    callback_gas: u64,
) -> anyhow::Result<(String, u64)> {
    let provider = ProviderBuilder::new().on_http(rpc.parse()?);
    let fee = Fee::new(Address::from_str(fee_oracle)?, provider);
    let f = fee
        .estimateFee(comp_def_id, alloy::primitives::U256::from(callback_gas))
        .call()
        .await?
        ._0;
    let d = fee.deadlineForCircuit(comp_def_id).call().await?._0;
    Ok((f.to_string(), d))
}
