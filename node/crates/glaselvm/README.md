# glaselvm

The command-line tool for the [Glasel Network](https://github.com/Glaselxyz/glasel-network):
scaffold a project, author a confidential-computation circuit, simulate it locally,
compile it to bytecode, and deploy it to Base.

## Install

```bash
cargo install glaselvm
```

Or download a prebuilt binary from the [Releases page](https://github.com/Glaselxyz/glasel-network/releases).

## Quick start

```bash
# Scaffold a new project (circuit + manifest + Solidity callback + README)
glaselvm new my-auction --template auction

cd my-auction

# Run the circuit locally over cleartext inputs (no chain, no nodes)
glaselvm simulate circuit.json --inputs 512000,498000

# Compile the circuit to bytecode
glaselvm compile circuit.json --out circuit.bin

# Deploy the circuit definition to Base Sepolia
glaselvm deploy-circuit circuit.bin \
  --rpc https://sepolia.base.org \
  --private-key $PRIVATE_KEY \
  --registry <ComputationRegistry address>
```

Templates: `hello` (private multiply), `auction` (sealed-bid max), `vote` (private tally).

Circuits can also be authored in plain Rust with the Arcis-style DSL in the
[`glasel-circuit`](https://crates.io/crates/glasel-circuit) crate, then serialized
to the `circuit.bin` used above.

## Learn more

See the [Glasel docs](https://github.com/Glaselxyz/glasel-network/tree/main/docs)
for the architecture, the SDK (`@glasel/client`), and running a node.

Licensed under MIT.
