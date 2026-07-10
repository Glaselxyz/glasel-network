# Testnet Disclaimer

Glasel is currently a **testnet**. Please read this before building on it.

- **Test tokens have no value.** GLASEL on Robinhood Chain testnet is for testing only. It is
  not for sale, cannot be bought, and will never be redeemable for anything.
- **Things may reset.** Contracts may be redeployed, the operator cluster may be
  rebuilt, and balances/computations may be wiped without notice. Do not store
  anything you cannot afford to lose.
- **No uptime guarantee.** The network is operated best-effort. Nodes may go down
  for maintenance. Check the status page before assuming an outage is your fault.
- **Not audited for mainnet.** The contracts have an internal review and an
  audit-prep package, but **no external audit yet**. An external audit is the gate
  before any mainnet / real-value deployment. Do not use this code to secure real
  funds.
- **Experimental cryptography surfaces.** Some layers are production-grade; others
  are explicitly experimental or simulated. See
  [SECURITY-MODEL.md](SECURITY-MODEL.md) for the honest per-layer grading,
  including which parts of the MPC path are simulated on the current testnet
  cluster.
- **Keys are your responsibility.** Use throwaway keys funded only with testnet
  ETH. Never put a mainnet key or any key holding real value into a testnet tool.

By using the testnet you accept that it is provided "as is", without warranty, and
that the operators are not liable for any loss arising from its use.
