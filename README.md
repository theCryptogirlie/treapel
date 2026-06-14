# Open Payments Prototype (Pay-Per-Second Stream)

A minimal, functional proof-of-concept implementing the complete **10-step Open Payments flow** to simulate a pay-per-second content stream (e.g., pay-per-second courses).

> Based on the official guide: https://openpayments.dev/guides/accept-otp-online-purchase

---

## What This Does

This script simulates what happens when a learner presses "Play" on a pay-per-second course. The learner's wallet is charged per second of content consumed, and the creator receives the funds via the [Interledger Protocol](https://interledger.org/) using the [Open Payments standard](https://openpayments.dev/).

| Step | Action | API |
|------|--------|-----|
| 1 | **Wallet Discovery** - fetch wallet address info for both creator and learner | `GET /wallet-address` |
| 2 | **Incoming Payment Grant** - get token to create incoming payment on creator's wallet | `POST /grant` (creator auth) |
| 3 | **Create Incoming Payment** - define how much the creator expects to receive | `POST /incoming-payments` |
| 4 | **Quote Grant** - get token to create a quote on learner's wallet | `POST /grant` (learner auth) |
| 5 | **Create Quote** - calculate exact debit amounts | `POST /quotes` |
| 6 | **Interactive Outgoing Payment Grant** - initiate GNAP auth flow requiring learner consent | `POST /grant` (interactive) |
| 7 | **Redirect Learner** - open the `interact.redirect` URL in a browser | User interaction |
| 8 | **Grant Continuation** - exchange `interact_ref` for a final access token | `POST /continue` |
| 9 | **Stream Simulation**- simulate video playback, accumulating cost per second | Simulation |
| 10 | **Execute Payment** - create the outgoing payment, triggering the ILP transfer | `POST /outgoing-payments` |

---

## Prerequisites

- Node.js 18+
- Accounts at [https://wallet.interledger-test.dev](https://wallet.interledger-test.dev) (free testnet)
- Two wallet handles (one for "creator", one for "learner")
- Generated Developer Keys (private keys) for both accounts

---

## Setup

### 1. Clone and install

```bash
# Clone this repository and install dependencies
git clone <repository-url>
cd <project-root>
npm install
```

### 2. Get testnet credentials

1. Go to [https://wallet.interledger-test.dev](https://wallet.interledger-test.dev)
2. Login to your accounts for both the creator and the learner.
3. Navigate to **Settings → Developer Keys**
4. Click **Generate Keys** — download the private keys (e.g., `creator.key` and `student.key`) and copy the **Key IDs**.

### 3. Configure environment

Create a `.env` file in the project root:

```env
# ── Student (Learner / Sender) ──
LEARNER_WALLET_ADDRESS=https://ilp.interledger-test.dev/your-learner-handle
LEARNER_KEY_ID=your-learner-key-id
LEARNER_PRIVATE_KEY_PATH=./student.key

# ── Creator (Receiver) ──
CREATOR_WALLET_ADDRESS=https://ilp.interledger-test.dev/your-creator-handle
CREATOR_KEY_ID=your-creator-key-id
CREATOR_PRIVATE_KEY_PATH=./creator.key

# ── Payment Config ──
RATE_PER_SECOND=100
ASSET_CODE=USD
ASSET_SCALE=3
SIMULATE_SECONDS=10

# ── Redirect ──
REDIRECT_URL=http://localhost:3000/watch/confirm
```

Move your downloaded private keys into the project root and ensure they match the paths in `.env`.

### 4. Fund your testnet wallets

In the testnet wallet UI, add test funds to the learner's wallet so they can pay for the stream.

---

## Running the Prototype

Run the script using `ts-node`:

```bash
npx ts-node index.ts
```

The script will:
1. Run steps 1–6 automatically.
2. **Pause and print a URL** — open it in your browser to approve the payment grant from the learner's account.
3. After approval, the browser will redirect you to `http://localhost:3000/watch/confirm?interact_ref=...`.
4. Copy the `interact_ref` value and paste it back into the terminal.
5. The script will simulate the stream playback (Step 9).
6. Complete Step 10 automatically and print the payment execution result.

---

## Project Structure

```text
open-payments-prototype/
├── index.ts               # Full 10-step Open Payments flow simulator
├── .env                   # Configuration file (ignored by git)
├── creator.key            # Creator's private key (ignored by git)
├── student.key            # Learner's private key (ignored by git)
├── package.json
└── README.md
```

---

## Key Concepts

**GNAP (Grant Negotiation and Authorization Protocol)** — The auth mechanism used by Open Payments. Unlike OAuth 2.0, GNAP supports interactive grants that require explicit user consent.

**Wallet Address** — A URL (like `https://ilp.interledger-test.dev/username`) that acts as a payment pointer and discovery endpoint.

**Incoming Payment** — A resource created on the receiver's wallet defining the amount they expect to receive.

**Quote** — Calculated on the sender's wallet; confirms the exact debit/receive amounts.

**Outgoing Payment** — The final resource that actually moves money via ILP when created.

---

## Related

- [Open Payments Docs](https://openpayments.dev/)
- [Interledger Protocol](https://interledger.org/)
- Example platform (Building Pending) — real-time micropayment learning platform built on Open Payments
