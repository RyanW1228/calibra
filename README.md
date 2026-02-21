# Calibra

**Calibra** is an on-chain, performance-based risk procurement protocol. Institutions allocate capital (a **bounty**) to purchase **calibrated operational risk forecasts**, and model providers earn rewards based on forecast accuracy after real outcomes are known.

**MVP focus:** **flight disruption risk** (delay / cancellation / threshold-based disruption).

---

## Table of Contents

- [Calibra](#calibra)
  - [Table of Contents](#table-of-contents)
  - [What Calibra Is](#what-calibra-is)
  - [Core Idea](#core-idea)
  - [High-Level Architecture](#high-level-architecture)
  - [Glossary](#glossary)
  - [Protocol Lifecycle](#protocol-lifecycle)
    - [1) Create Batch](#1-create-batch)
    - [2) Funding](#2-funding)
    - [3) Prediction Window](#3-prediction-window)
    - [4) Commit](#4-commit)
    - [5) Reveal](#5-reveal)
    - [6) Outcomes + Scoring](#6-outcomes--scoring)
    - [7) Rewards / Claims](#7-rewards--claims)
    - [8) Public Audit](#8-public-audit)
  - [UI Routes](#ui-routes)
  - [Data Model (Supabase)](#data-model-supabase)
    - [`batches`](#batches)
    - [`flights`](#flights)
    - [`submissions`](#submissions)
    - [`outcomes` (optional / MVP dependent)](#outcomes-optional--mvp-dependent)
    - [`scores` (optional / MVP dependent)](#scores-optional--mvp-dependent)
  - [On-Chain Contracts](#on-chain-contracts)
    - [Networks](#networks)
    - [Key Addresses](#key-addresses)
    - [Units (IMPORTANT)](#units-important)
    - [Commit / Reveal Cryptography](#commit--reveal-cryptography)
  - [Local Development](#local-development)
    - [Prerequisites](#prerequisites)
    - [Environment Variables](#environment-variables)
    - [Install + Run](#install--run)
  - [Deployment](#deployment)
    - [UI + API on Vercel](#ui--api-on-vercel)
    - [Database on Supabase](#database-on-supabase)
    - [Contracts (Foundry)](#contracts-foundry)
  - [Operational Notes](#operational-notes)
    - [Time Handling](#time-handling)
    - [Percent vs 0–1](#percent-vs-01)
    - [Don’t Show Premature UI](#dont-show-premature-ui)
  - [Security \& Threat Model](#security--threat-model)
  - [Testing](#testing)
  - [Troubleshooting](#troubleshooting)
    - [“Server IP address could not be found” for faucet domains](#server-ip-address-could-not-be-found-for-faucet-domains)
    - [“mint reverted: Not owner” on MockUSDC](#mint-reverted-not-owner-on-mockusdc)
    - [Wallet connected but transactions fail](#wallet-connected-but-transactions-fail)
    - [Predictions look “wrong scale”](#predictions-look-wrong-scale)
  - [Roadmap](#roadmap)
    - [Near-Term (ETHDenver MVP)](#near-term-ethdenver-mvp)
    - [Next](#next)
  - [License](#license)

---

## What Calibra Is

Calibra is designed for environments where:

- **Institutions** (airlines, OTAs, insurers, logistics operators, energy operators, etc.) need **actionable probabilistic risk forecasts**.
- **Forecast providers** (models, teams, quant shops, independent researchers) want a **credible incentive mechanism** that pays for accuracy.
- A market needs **accountable performance** over time rather than “best marketing wins.”

Calibra does **risk procurement** (institutions buying forecasts) instead of purely speculative prediction markets.

---

## Core Idea

1. An institution defines a portfolio of operational exposures (in MVP: a batch of flights) and posts a **bounty** in USDC.
2. Providers submit **probabilistic forecasts** during a defined **prediction window**.
3. After the real outcomes occur, forecasts are **scored**.
4. Providers are paid from the bounty based on score. Poor performers can be “slashed” in later versions (or simply earn less).

The result is a system where:

- Good models earn sustainably.
- Institutions get forecasts where the incentive is aligned with accuracy and calibration.

---

## High-Level Architecture

Calibra is composed of:

- **On-chain protocol (EVM)**
  - Holds funds (USDC)
  - Records commitment hashes / reveal verification
  - Computes or verifies score inputs (depending on configuration)
  - Manages reward distribution / claim flow

- **Off-chain system (UI + API)**
  - Institutional UI for creating/funding batches
  - Provider UI for submitting predictions
  - Storage layer for prediction payloads (commit/reveal friendly)
  - Outcome pipeline integration (e.g., FlightAware)
  - Public audit surface (verifiability)

- **Database (Supabase)**
  - Batch metadata: times, thresholds, status
  - Submissions registry: commit hash, reveal pointers, provider address
  - Outcome records / scoring records (depending on MVP wiring)

Hosting choices (current):

- UI + API: **Vercel**
- Database: **Supabase**

---

## Glossary

- **Batch**: A portfolio instance (e.g., all Delta departures from JFK on a specific date). Identified by a UUID in the database and a corresponding on-chain hash.
- **Flight list hash**: A canonical hash of the batch’s flight set used to bind predictions to a specific batch composition.
- **Prediction window**: The time range in which providers can submit predictions.
- **Commit**: Posting a hash on-chain that binds a provider to a prediction payload without revealing it.
- **Reveal**: Publishing enough information to prove the committed prediction payload, enabling scoring.
- **Thresholds**: Minutes thresholds used for disruption classification (e.g., 15/30/60 min delay bins).
- **Bounty**: USDC allocated to pay providers for accuracy.
- **Provider**: An address submitting predictions.
- **Public audit**: A read-only surface enabling third parties to verify commits, reveals, and outcomes.

---

## Protocol Lifecycle

### 1) Create Batch

An operator/institution creates a batch with metadata such as:

- Airline, origin, date/time window, routes, etc.
- List of included flights (schedule keys)
- Thresholds in minutes (e.g., `[15, 30, 60]`)
- Prediction window start/end
- Bounty amount (USDC base units)

This batch exists:

- **off-chain** (as the authoritative metadata record)
- and is referenced **on-chain** via a deterministic hash / ID mapping.

### 2) Funding

The institution funds the bounty in USDC.

Typical flow:

- Approve USDC allowance
- Call protocol to deposit/fund the batch bounty

### 3) Prediction Window

Providers can submit only during the open window.

> Important: the **true** start/end times are stored in the database as unix fields
> `prediction_window_start_unix` and `prediction_window_end_unix`
> and should be read from there.

### 4) Commit

Providers generate a commitment hash that binds:

- batch identifier (or batch hash)
- prediction payload hash or root
- a secret salt
- provider address (optional but recommended)
- any other fields needed to prevent replay

Then they submit the commitment to the on-chain protocol.

### 5) Reveal

After the prediction window ends (and/or after commit deadline), providers reveal:

- the prediction payload reference (or hash)
- the salt
- any Merkle root data if used

The protocol checks:

- `hash(revealed_payload + salt + batch_context)` matches the committed hash.

### 6) Outcomes + Scoring

Once real outcomes are known (e.g., flight delay/cancellation):

- outcomes are stored (and optionally committed on-chain)
- scoring is computed and recorded
- the protocol finalizes

Scoring is designed to reward:

- accuracy
- calibration (systematic miscalibration should be penalized)
- proper probability estimates rather than binary guesses

### 7) Rewards / Claims

After finalization:

- providers claim rewards proportional to performance
- the protocol pays out USDC

### 8) Public Audit

Public read-only surfaces allow verification of:

- which providers committed
- which reveals correspond to which commits
- the published outcomes used for scoring
- reward distribution / claims

---

## UI Routes

These are typical pages in the Calibra app (Next.js):

- `/fund/[batchId]`
  - Institutional funding UI for a batch
  - Displays batch parameters
  - Handles USDC approvals and funding transactions

- `/submit/[batchId]`
  - Provider submission UI
  - Shows prediction window timing and batch composition
  - Commit/reveal submission flow
  - **Claimable and audit sections should only appear after the prediction window ends** (prevents confusing UX)

- `/batch/[batchId]`
  - Batch overview
  - Flight list + latest predictions table (provider performance views)
  - Aggregated rows if applicable

- `/audit/[batchId]`
  - Public audit view
  - Verifies on-chain committed data against revealed payload pointers

> Note: Keep UI surfaces strict about time gating to avoid showing “Not wired yet” / error-y or partial components.

---

## Data Model (Supabase)

At a high level, Supabase stores:

### `batches`

Suggested fields (representative):

- `id` (uuid)
- `display_time_zone`
- `flight_count`
- `status`
- `created_at`
- `thresholds_minutes` (int[])
- `prediction_window_start_unix` (int / bigint)
- `prediction_window_end_unix` (int / bigint)
- `bounty_usdc` (bigint in **USDC base units**)
- additional metadata: airline/origin/date parameters

### `flights`

- `batch_id` (uuid)
- `schedule_key` (string, canonical identifier)
- airline / flight_number / origin / destination
- scheduled depart/arrive iso strings

### `submissions`

Representative fields (seen in practice):

- `id` (uuid)
- `batch_id` (uuid)
- `batch_id_hash` (hex)
- `provider_address` (hex)
- `commit_index` (int or null)
- `commit_hash` (hex)
- `root` (hex) (if using Merkle)
- `salt` (hex)
- `storage_bucket` / `storage_path` (where payload is stored)
- `encrypted_uri_hash` (optional)
- `created_at`

### `outcomes` (optional / MVP dependent)

- `batch_id`
- per-flight outcome records (delay minutes, cancelled, etc.)
- timestamp / source reference

### `scores` (optional / MVP dependent)

- `batch_id`
- `provider_address`
- score breakdown per threshold
- final score value
- payout amount (base units)

---

## On-Chain Contracts

### Networks

- **ADI testnet** (EVM-compatible) for protocol MVP

### Key Addresses

- **MockUSDC (ADI testnet):** `0x0033354Bc028fE794AE810b6D921E47389723dEd`

(Other addresses such as protocol contract(s) should be listed here as they stabilize.)

### Units (IMPORTANT)

- USDC values are always represented in **base units** (6 decimals).
  - `$300` is `300 * 10^6` base units.

- If you display USDC in the UI:
  - divide base units by `10^6` to get the human value.

- If you store probabilities / percents:
  - Calibra UI logic uses **percents** (e.g., `17` means `17%`)
  - **Not** 0.17.
  - This matters everywhere: rendering, validation, scoring, serialization.

### Commit / Reveal Cryptography

A robust pattern is:

- Provider builds a canonical representation of predictions (stable ordering).
- Compute `predictionsHash = keccak256(encode(predictionsPayload))`
- Compute `commitHash = keccak256(encode(batchHash, provider, predictionsHash, salt))`
- Submit `commitHash` on-chain.
- Reveal later with `(predictionsPayload, salt)` (or `(predictionsHash, salt)` plus storage pointer if payload is stored off-chain but hash-verified).

If using Merkle trees:

- compute per-flight leaves
- submit `root` with commitment
- reveal with proofs per flight when needed (advanced)

---

## Local Development

### Prerequisites

- Node.js (LTS recommended)
- pnpm / npm / yarn (pick one)
- Supabase project created
- A wallet with testnet funds + MockUSDC
- Foundry (for contracts) if deploying locally

### Environment Variables

In `calibra/.env.local` (representative):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FLIGHTAWARE_API_KEY`
- `ADI_TESTNET_RPC_URL`
- (optional) app/public vars for UI reads
- contract addresses (e.g., `MOCK_USDC`, `CALIBRA_PROTOCOL`), depending on how `lib/calibraOnchain` is wired

In `contracts/.env`:

- `ADI_TESTNET_RPC_URL`
- `ADI_TESTNET_PRIVATE_KEY` (Calibra Deployer wallet)

> Keep private keys out of the frontend `.env.local` unless you are explicitly running trusted server-side scripts.

### Install + Run

From the Calibra app directory:

1. Install:
   - `pnpm install` (or your package manager equivalent)

2. Run dev:
   - `pnpm dev`

3. Open:
   - `http://localhost:3000`

---

## Deployment

### UI + API on Vercel

- Connect the repo to Vercel.
- Set environment variables in Vercel project settings:
  - Supabase URL + keys
  - FlightAware key
  - Any public chain config (RPC URL if needed for reads)

### Database on Supabase

- Create tables and indexes for batches / flights / submissions.
- Add RLS policies:
  - Public reads for audit surfaces (optional)
  - Restricted writes for operator APIs

### Contracts (Foundry)

Typical deployment steps (example pattern):

1. `cd contracts`
2. Ensure `contracts/.env` includes:
   - `ADI_TESTNET_RPC_URL`
   - `ADI_TESTNET_PRIVATE_KEY`

3. Run script with broadcast:
   - `forge script script/DeployMockUSDC.s.sol:DeployMockUSDC --rpc-url $ADI_TESTNET_RPC_URL --broadcast --verify`

> Always use `--broadcast` for on-chain actions.

---

## Operational Notes

### Time Handling

- Treat DB `prediction_window_start_unix` and `prediction_window_end_unix` as authoritative.
- Avoid mixing client time assumptions with server values.
- Convert consistently:
  - UI display: unix -> local display time zone
  - gating logic: compare `nowUnix` to stored unix end

### Percent vs 0–1

Calibra provider predictions are expressed as **percent values**:

- `17` means `17%`
- `55.2` means `55.2%` (if allowed)
- Never interpret `0.17` as `17%` unless explicitly converted.

This impacts:

- validation
- scoring
- charts/visualization
- any “expected payout” calculations

### Don’t Show Premature UI

Avoid “error-y” or unfinished sections in production surfaces.
Specifically:

- Claimable sections and audit sections should not appear until after the prediction window ends (and/or until finalization is available).

---

## Security & Threat Model

Calibra’s MVP security design concerns include:

- **Commit-reveal integrity**
  - prevents copying predictions during the active window
  - binds provider to their forecast before outcomes are known

- **Data availability**
  - if predictions are stored off-chain, the reveal must provide a verifiable hash that matches the commitment
  - storage pointers should be durable and public after reveal (or at least auditable by intended parties)

- **Outcome oracle risk**
  - outcomes must be sourced reliably (e.g., FlightAware or comparable)
  - the system must be robust to missing or delayed data
  - audit logs should link to provenance

- **Sybil / spam submissions**
  - may require staking, allowlisting, or rate limits in later versions

- **Front-running / replay**
  - include provider address and batch hash in commit hash derivation
  - use chain ID/domain separation where applicable

This README is not a full security audit. Do not treat it as one.

---

## Testing

Suggested layers:

- **Unit tests (contracts)**
  - commitment verification
  - finalize + claim correctness
  - USDC transfer flows
  - edge cases: zero submissions, late reveal, incorrect salt

- **Integration tests (app)**
  - happy path: fund -> commit -> reveal -> audit -> claim
  - time gating (prediction window boundaries)
  - chain switching + wallet connect behavior

- **Data pipeline tests**
  - outcome fetcher idempotency
  - reconciliation between DB outcomes and on-chain finalize inputs

---

## Troubleshooting

### “Server IP address could not be found” for faucet domains

- Verify the faucet domain is correct and reachable from your network.
- Try a different network/DNS or check official ADI Foundation channels for updated faucet URLs.

### “mint reverted: Not owner” on MockUSDC

- Ensure:
  - you are calling `mint` from the owner address
  - your frontend points to the correct `MOCK_USDC` address
  - you redeployed and updated all env references consistently (frontend + backend + any cached config)
- If the contract uses `onlyOwner`, the deployer must match the owner.

### Wallet connected but transactions fail

- Confirm:
  - you are on the correct chain ID (ADI testnet)
  - you have sufficient gas funds
  - the USDC allowance is set correctly for the protocol contract address

### Predictions look “wrong scale”

- Re-check percent scaling:
  - values should be 0–100 (or slightly beyond if allowed), not 0–1.

---

## Roadmap

### Near-Term (ETHDenver MVP)

- Polished institutional UI (create/fund batch)
- Polished provider UI (commit/reveal)
- Outcome pipeline integration (FlightAware → outcomes)
- Score computation + finalize
- Public audit page with clear verification UI

### Next

- Provider reputation / long-term calibration tracking
- Staking / slashing / quality gates
- Support more operational risk portfolios beyond flights
- Better aggregation + analytics dashboards for institutions
- Multi-oracle outcome verification + dispute mechanisms
- Privacy-preserving submission variants (advanced)

---

## License

MIT License
