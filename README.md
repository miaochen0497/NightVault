# NightVault

NightVault is a confidential staking platform that allows players to mint the fully homomorphic encrypted `fTEST` token, stake their balance, and accrue a guaranteed 1% daily yield that can be claimed at any time. The project combines Zama’s FHEVM with a streamlined React front end so that balances, staking positions, and reward accrual remain private while still being provable on-chain.

## Project Overview

NightVault delivers a complete privacy-preserving staking experience:
- Players mint encrypted `fTEST` tokens directly from the `ERC7984Test` contract.
- Staked balances accrue interest at a fixed 1% daily rate, compounded discretely when a user interacts.
- Encrypted rewards can be previewed and claimed without revealing balances publicly.
- A production-ready interface built with React, Vite, viem, RainbowKit, and ethers guides users through every action with Zama’s relayer services handling FHE-specific signing flows.

## Key Advantages

- **Confidential staking**: Uses ERC-7984 encryption and Zama FHEVM primitives so that balances and rewards never appear in plaintext on-chain.
- **Guaranteed 1% daily yield**: Rewards are computed automatically every time a user stakes, unstakes, or claims, ensuring predictable growth without manual calculations.
- **Seamless wallet integration**: RainbowKit and WalletConnect provide a frictionless onboarding flow for EVM wallets, including mobile.
- **Full-stack transparency**: Contracts, deployment scripts, tasks, and front-end logic are open, deterministic, and fully typed in TypeScript.
- **Battle-tested tooling**: Built on Hardhat, TypeChain, ESLint, and Prettier with structured scripts for compilation, testing, deployment, and verification.

## Problems We Solve

- **Privacy loss in DeFi staking**: Traditional staking exposes balances and reward history. NightVault keeps values encrypted while preserving verifiability.
- **Complex FHE integration**: Abstracts Zama’s FHEVM setup into reusable scripts and services so developers can focus on financial logic instead of cryptographic plumbing.
- **Fragmented user journeys**: Presents minting, staking, reward previews, and claims in a single responsive interface that guides players through decryption workflows.
- **Hard-to-maintain deployments**: Deployment scripts, environment configuration, and ABI management are codified to prevent drift between contracts and the front end.

## Architecture & Technology

- **Smart Contracts**: `ERC7984Test.sol` for minting encrypted `fTEST`; `FTESTStaking.sol` for staking, accrual, and reward claims with Zama’s Sepolia configuration.
- **Tooling & Testing**: Hardhat, TypeScript, hardhat-deploy, ethers v6, TypeChain, chai, mocha, solidity-coverage, and Hardhat tasks for recurring actions.
- **Frontend**: React + Vite application located in `app/` using viem for reads, ethers for writes, RainbowKit for wallet onboarding, TanStack Query for caching, and custom hooks for Zama relayer integration.
- **FHE Services**: Zama relayer SDK handles encrypted handle management, EIP-712 signing, and user-side decryption of confidential amounts.
- **Deployments & ABIs**: Hardhat stores compiled artifacts and live deployment metadata under `deployments/`. The front end imports ABIs copied from `deployments/sepolia` to guarantee parity with the deployed contracts.

## Core User Flows

1. **Mint fTEST**  
   Connect a wallet and call `mintFree()` to receive 100 `fTEST` (scaled to match 6 decimals) with balances stored as encrypted handles.
2. **Stake Encrypted Tokens**  
   Enter the amount to stake, the UI encrypts it through Zama’s SDK, and `FTESTStaking.stake` transfers the encrypted value while accruing pending rewards at 1% per elapsed day.
3. **Monitor Positions Privately**  
   The `getStake` view returns encrypted handles which users decrypt client-side via the relayer to see principal, rewards, and last accrual timestamp without exposing raw numbers on-chain.
4. **Unstake or Claim Rewards**  
   Users can partially or fully unstake; the contract automatically adjusts encrypted balances and sends tokens back via confidential transfers. Rewards can be claimed independently at any time.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 8+
- Access to an Infura project (for Sepolia connectivity)
- A funded EOA whose private key can be used for deployments (no mnemonic support)

### Clone & Install

```bash
git clone <repository-url>
cd NightVault
npm install
```

Install front-end dependencies:

```bash
cd app
npm install
cd ..
```

### Configure Environment Variables

Create a `.env` file in the project root with:

```
INFURA_API_KEY=<your_infura_project_id>
PRIVATE_KEY=<0x-prefixed_private_key_for_deployer>
ETHERSCAN_API_KEY=<optional_for_verification>
```

The Hardhat config loads these via `dotenv`. Do not use mnemonics; deployments require a raw private key.

### Build & Test Smart Contracts

```bash
npm run compile
npm run test
```

Generate coverage and lint reports when needed:

```bash
npm run coverage
npm run lint
```

### Run a Local FHEVM Node

```bash
npx hardhat node
```

In a second terminal, deploy contracts locally:

```bash
npx hardhat deploy --network localhost
```

### Deploy to Sepolia

1. Ensure the `.env` file contains a funded private key and an Infura API key.
2. Compile contracts (`npm run compile`) to refresh artifacts.
3. Deploy:
   ```bash
   npm run deploy:sepolia
   ```
4. (Optional) Verify on Etherscan:
   ```bash
   npm run verify:sepolia -- <DEPLOYED_CONTRACT_ADDRESS>
   ```
5. Copy the generated ABIs and addresses from `deployments/sepolia/*.json` into the front-end configuration (`app/src/config/contracts.ts`) to guarantee alignment with the live network.

### Frontend Setup & Usage

1. Update the WalletConnect project ID inside `app/src/config/wagmi.ts`.
2. Replace the placeholder addresses and ABIs in `app/src/config/contracts.ts` with the artifacts exported from `deployments/sepolia`.
3. Start the UI:
   ```bash
   cd app
   npm run dev
   ```
   Vite runs on port 5173 by default; follow the CLI link to open it in your browser.
4. Connect a wallet through RainbowKit, mint `fTEST`, stake, refresh balances (triggering decryption via the relayer), and claim rewards.

## Directory Layout

```
contracts/              # Solidity sources (ERC7984Test, FTESTStaking, examples)
deploy/                 # Hardhat-deploy scripts for local and Sepolia networks
deployments/            # Auto-generated deployment metadata and ABIs
tasks/                  # Custom Hardhat tasks for account utilities and examples
test/                   # TypeScript test suite for staking logic
app/                    # React + Vite front end (no Tailwind, hooks kept intact)
docs/                   # Zama FHEVM integration notes and relayer documentation
```

## Testing Strategy

- **Unit tests**: Located under `test/`, written in TypeScript using Hardhat Network Helpers.
- **Coverage**: `npm run coverage` instruments contracts via `solidity-coverage`, ensuring staking math and encrypted flows remain intact.
- **Frontend validation**: Manual QA through Vite dev server, focusing on encryption/decryption flows, staking actions, and proof generation.

## Roadmap

- **Automated relayer deployment**: Containerize the Zama relayer to simplify local development and CI.
- **Advanced reward models**: Support variable APRs, promotional boosts, and multi-asset staking pools while retaining encrypted accounting.
- **Multichain roll-out**: Extend beyond Sepolia to additional testnets and mainnets once FHEVM support is available.
- **UI enhancements**: Introduce analytics dashboards, historical reward charts, and localization without compromising confidentiality.
- **Security hardening**: Expand fuzzing, static analysis, and third-party audits focused on encrypted arithmetic and access control.

## Support & Resources

- **Zama FHEVM Docs**: https://docs.zama.ai/fhevm
- **Hardhat Documentation**: https://hardhat.org/docs
- **RainbowKit**: https://www.rainbowkit.com
- **Viem**: https://viem.sh

NightVault demonstrates how private-by-default DeFi experiences can be built today by pairing Zama’s FHEVM with familiar Ethereum tooling. Contributions and feedback are welcome.
