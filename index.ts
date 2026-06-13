import {
  createAuthenticatedClient,
  isPendingGrant,
  isFinalizedGrantWithAccessToken,
} from "@interledger/open-payments";
import * as readline from "readline";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const CONFIG = {
  // Freelancer wallet (receiver)
  FREELANCER_WALLET_ADDRESS: process.env.FREELANCER_WALLET_ADDRESS || "",
  FREELANCER_KEY_ID: process.env.FREELANCER_KEY_ID || "",
  FREELANCER_PRIVATE_KEY_PATH: process.env.FREELANCER_PRIVATE_KEY_PATH || "./freelancer.key",

  // Client wallet (sender)
  CLIENT_WALLET_ADDRESS: process.env.CLIENT_WALLET_ADDRESS || "",
  CLIENT_KEY_ID: process.env.CLIENT_KEY_ID || "",
  CLIENT_PRIVATE_KEY_PATH: process.env.CLIENT_PRIVATE_KEY_PATH || "./client.key",

  // Invoice Config
  INVOICE_AMOUNT: Number(process.env.INVOICE_AMOUNT || "100"),
  ASSET_CODE: process.env.ASSET_CODE || "USD",
  ASSET_SCALE: Number(process.env.ASSET_SCALE || "3"),

  // Redirect
  REDIRECT_URL: process.env.REDIRECT_URL || "http://localhost:3000/confirm",
};

function log(label: string, msg: string, data?: unknown) {
  console.log(`\n[${label}] ${msg}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => { rl.close(); resolve(answer.trim()); });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateConfig() {
  const missing: string[] = [];
  if (!CONFIG.FREELANCER_KEY_ID) missing.push("FREELANCER_KEY_ID");
  if (!CONFIG.CLIENT_KEY_ID) missing.push("CLIENT_KEY_ID");
  if (!fs.existsSync(CONFIG.FREELANCER_PRIVATE_KEY_PATH))
    missing.push(`FREELANCER_PRIVATE_KEY_PATH (file not found: ${CONFIG.FREELANCER_PRIVATE_KEY_PATH})`);
  if (!fs.existsSync(CONFIG.CLIENT_PRIVATE_KEY_PATH))
    missing.push(`CLIENT_PRIVATE_KEY_PATH (file not found: ${CONFIG.CLIENT_PRIVATE_KEY_PATH})`);
  if (missing.length > 0) {
    console.error("\n Missing config:");
    missing.forEach((m) => console.error(`   • ${m}`));
    console.error("\nSee .env\n");
    process.exit(1);
  }
}

async function run() {
  console.log("FREELANCER INVOICE PAYMENT — Open Payments via ILP");
  console.log(`Invoice Amount : ${CONFIG.INVOICE_AMOUNT} ${CONFIG.ASSET_CODE} (scale ${CONFIG.ASSET_SCALE})`);
  console.log(`\n  Freelancer wallet : ${CONFIG.FREELANCER_WALLET_ADDRESS}`);
  console.log(`  Client wallet     : ${CONFIG.CLIENT_WALLET_ADDRESS}`);

  validateConfig();

  const freelancerPrivateKey = fs.readFileSync(path.resolve(CONFIG.FREELANCER_PRIVATE_KEY_PATH), "utf8");
  const clientPrivateKey = fs.readFileSync(path.resolve(CONFIG.CLIENT_PRIVATE_KEY_PATH), "utf8");

  const freelancerClient = await createAuthenticatedClient({
    keyId: CONFIG.FREELANCER_KEY_ID,
    privateKey: freelancerPrivateKey,
    walletAddressUrl: CONFIG.FREELANCER_WALLET_ADDRESS,
  });

  const clientClient = await createAuthenticatedClient({
    keyId: CONFIG.CLIENT_KEY_ID,
    privateKey: clientPrivateKey,
    walletAddressUrl: CONFIG.CLIENT_WALLET_ADDRESS,
  });

  // ── STEP 1: Wallet Discovery ────────────────────────────────────────────────
  log("STEP 1", "WALLET DISCOVERY");

  const [freelancerWallet, clientWallet] = await Promise.all([
    freelancerClient.walletAddress.get({ url: CONFIG.FREELANCER_WALLET_ADDRESS }),
    clientClient.walletAddress.get({ url: CONFIG.CLIENT_WALLET_ADDRESS }),
  ]);

  log("STEP 1", "Wallets resolved.", {
    freelancer: {
      id: freelancerWallet.id,
      authServer: freelancerWallet.authServer,
      resourceServer: freelancerWallet.resourceServer,
    },
    client: {
      id: clientWallet.id,
      authServer: clientWallet.authServer,
      resourceServer: clientWallet.resourceServer,
    },
  });

  // ── STEP 2: Create Incoming Payment (Freelancer raises invoice) ─────────────
  log("STEP 2", "CREATE INCOMING PAYMENT (Freelancer raises invoice)");

  const freelancerIncomingGrant = await freelancerClient.grant.request(
    { url: freelancerWallet.authServer },
    {
      access_token: {
        access: [{ type: "incoming-payment", actions: ["create"] }],
      },
    }
  );

  if (!isFinalizedGrantWithAccessToken(freelancerIncomingGrant)) {
    throw new Error("Expected non-interactive incoming payment grant");
  }

  const incomingPayment = await freelancerClient.incomingPayment.create(
    {
      url: freelancerWallet.resourceServer,
      accessToken: freelancerIncomingGrant.access_token.value,
    },
    {
      walletAddress: freelancerWallet.id,
      incomingAmount: {
        value: String(CONFIG.INVOICE_AMOUNT),
        assetCode: CONFIG.ASSET_CODE,
        assetScale: CONFIG.ASSET_SCALE,
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      metadata: {
        type: "invoice",
        description: "Freelance project payment",
      },
    }
  );

  log("STEP 2", "Incoming payment created.", {
    id: incomingPayment.id,
    incomingAmount: incomingPayment.incomingAmount,
    expiresAt: incomingPayment.expiresAt,
  });

  // ── STEP 3: Create Quote (Client checks the cost) ──────────────────────────
  log("STEP 3", "CREATE QUOTE (Client checks the cost)");

  const clientQuoteGrant = await clientClient.grant.request(
    { url: clientWallet.authServer },
    {
      access_token: {
        access: [{ type: "quote", actions: ["create"] }],
      },
    }
  );

  if (!isFinalizedGrantWithAccessToken(clientQuoteGrant)) {
    throw new Error("Expected non-interactive quote grant");
  }

  const quote = await clientClient.quote.create(
    {
      url: clientWallet.resourceServer,
      accessToken: clientQuoteGrant.access_token.value,
    },
    {
      method: "ilp",
      walletAddress: clientWallet.id,
      receiver: incomingPayment.id,
    }
  );

  log("STEP 3", "Quote created.", {
    id: quote.id,
    sendAmount: quote.debitAmount,
    receiveAmount: quote.receiveAmount,
  });

  // ── STEP 4: Request Outgoing Payment Grant (Client authorizes payment) ──────
  log("STEP 4", "REQUEST OUTGOING PAYMENT GRANT (Client authorizes payment)");

  const NONCE = crypto.randomBytes(16).toString("hex");

  const pendingGrant = await clientClient.grant.request(
    { url: clientWallet.authServer },
    {
      access_token: {
        access: [
          {
            identifier: clientWallet.id,
            type: "outgoing-payment",
            actions: ["create"],
            limits: {
              debitAmount: quote.debitAmount,
            },
          },
        ],
      },
      interact: {
        start: ["redirect"],
        finish: {
          method: "redirect",
          uri: CONFIG.REDIRECT_URL,
          nonce: NONCE,
        },
      },
    }
  );

  if (!isPendingGrant(pendingGrant)) {
    throw new Error("Expected a pending (interactive) outgoing payment grant");
  }

  log("STEP 4", "Initiating GNAP interactive auth flow...");
  console.log(`\n  ${pendingGrant.interact.redirect}\n`);
  console.log(`  After approval, redirect to:`);
  console.log(`  ${CONFIG.REDIRECT_URL}?interact_ref=<REF>&hash=<HASH>\n`);

  const interactRef = await prompt("  Paste the interact_ref and press Enter: ");
  if (!interactRef) throw new Error("interact_ref required");

  log("STEP 4", "Exchanging interact_ref for access token...");

  const outgoingGrant = await clientClient.grant.continue(
    {
      url: pendingGrant.continue.uri,
      accessToken: pendingGrant.continue.access_token.value,
    },
    { interact_ref: interactRef }
  );

  if (!isFinalizedGrantWithAccessToken(outgoingGrant)) {
    throw new Error("Expected finalized outgoing payment grant");
  }

  log("STEP 4", "Access token obtained.");

  // ── STEP 5: Execute Payment (Money moves) ──────────────────────────────────
  log("STEP 5", "EXECUTE PAYMENT (Money moves)");

  const outgoingPayment = await clientClient.outgoingPayment.create(
    {
      url: clientWallet.resourceServer,
      accessToken: outgoingGrant.access_token.value,
    },
    {
      walletAddress: clientWallet.id,
      quoteId: quote.id,
      metadata: {
        type: "invoice-payment",
        description: "Freelance project payment settlement",
      },
    }
  );

  log("STEP 5", "Payment executed — funds transferred via ILP!", {
    id: outgoingPayment.id,
    status: outgoingPayment.state,
    sentAmount: outgoingPayment.sentAmount,
    receiveAmount: outgoingPayment.receiveAmount,
  });

  console.log("\n─────────────────────────────────────────────────");
  console.log("INVOICE SETTLED");
  console.log(`\n  Invoice Amount    : ${CONFIG.INVOICE_AMOUNT} ${CONFIG.ASSET_CODE}`);
  console.log(`  Incoming Payment  : ${incomingPayment.id}`);
  console.log(`  Quote             : ${quote.id}`);
  console.log(`  Outgoing Payment  : ${outgoingPayment.id}`);
  console.log(`  Status            : ${outgoingPayment.state}`);
  console.log();
}

run().catch((err) => {
  console.error("Error:", err.message || err);
  console.dir(err, { depth: null });
  process.exit(1);
});
