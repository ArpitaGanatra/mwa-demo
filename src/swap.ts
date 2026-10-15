import { Buffer } from "buffer";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { JUP_API_KEY, JUP_BASE_URL } from "./constants";

type JupAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };
type JupInstruction = { programId: string; accounts: JupAccount[]; data: string };

export type SwapBuild = {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  computeBudgetInstructions: JupInstruction[];
  setupInstructions: JupInstruction[];
  swapInstruction: JupInstruction;
  cleanupInstruction: JupInstruction | null;
  otherInstructions: JupInstruction[];
  tipInstruction: JupInstruction | null;
  addressesByLookupTableAddress: Record<string, string[]>;
};

const MAX_CU = 1_400_000;

export async function getSwapBuild(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps: number;
}): Promise<SwapBuild> {
  // Build the query by hand; React Native's URLSearchParams is incomplete
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

  const res = await fetch(`${JUP_BASE_URL}/build?${query}`, {
    headers: JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {},
  });
  if (!res.ok) throw new Error(`Jupiter ${res.status}: ${await res.text()}`);
  return res.json();
}

function toInstruction(ix: JupInstruction) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

export async function buildSwapTransaction(
  connection: Connection,
  payer: PublicKey,
  build: SwapBuild,
) {
  // Jupiter returns the full lookup tables, so there's no need to fetch them over RPC
  const lookupTables = Object.entries(build.addressesByLookupTableAddress).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          addresses: addresses.map((a) => new PublicKey(a)),
          deactivationSlot: BigInt("18446744073709551615"),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
        },
      }),
  );

  const swapInstructions = [
    ...build.setupInstructions.map(toInstruction),
    toInstruction(build.swapInstruction),
    ...(build.cleanupInstruction ? [toInstruction(build.cleanupInstruction)] : []),
    ...build.otherInstructions.map(toInstruction),
    ...(build.tipInstruction ? [toInstruction(build.tipInstruction)] : []),
  ];
  const priceInstructions = build.computeBudgetInstructions.map(toInstruction);

  const {
    context: { slot: minContextSlot },
    value: latestBlockhash,
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const compile = (instructions: TransactionInstruction[]) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message(lookupTables),
    );

  // 1. Simulate at max compute to measure usage, and to catch failures before opening the wallet
  const sim = await connection.simulateTransaction(
    compile([ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }), ...swapInstructions]),
    { sigVerify: false, replaceRecentBlockhash: true },
  );
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).slice(-3).join("\n");
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`);
  }
  const units = sim.value.unitsConsumed
    ? Math.min(Math.ceil(sim.value.unitsConsumed * 1.2), MAX_CU)
    : MAX_CU;

  // 2. Final transaction: compute limit + Jupiter's priority fee + swap
  const transaction = compile([
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ...priceInstructions,
    ...swapInstructions,
  ]);

  return { transaction, latestBlockhash, minContextSlot };
}
