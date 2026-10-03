# On-chain issuance setup

## Current repository status

The checked-in local configuration is currently demo/off-chain mode: `SOLANA_ENABLE` and `CERTIFICATE_PROGRAM_ID` are not configured. Certificate issuance and verification therefore use the database/IPFS fallback, and the on-chain integration test is skipped. Do not describe local certificates as live Solana transactions until a funded devnet deploy has been completed and a transaction signature has been captured.

The frontend issues certificates with a transaction signed by the approved issuer's connected Phantom wallet. The issuer wallet pays transaction fees and account rent; the backend does not need a Solana payer keypair for this client-signed flow. Never place issuer wallet secrets in the backend or repository.

To enable real on-chain issuance, set the following environment variables in `backend/.env` or your deployment environment:

- `SOLANA_ENABLE=true`
- `SOLANA_CLUSTER=devnet` (or `mainnet-beta`)
- `SOLANA_RPC_URL` (optional, defaults to cluster)
- `CERTIFICATE_PROGRAM_ID` — Anchor program ID (default set in `solana-program`)
- `PINATA_JWT` — required to pin real IPFS metadata before the wallet-signed transaction

The issuer must also have an approved account whose approved wallet address matches the connected Phantom wallet. That wallet needs enough SOL on the selected cluster to pay transaction fees and account creation (issuer PDA and certificate PDA). The backend checks the confirmed transaction and on-chain account before recording an issuance.

For CI/testing, use `DEMO_MODE=true` to run without on-chain features. Demo and off-chain certificates are not Solana transactions.
