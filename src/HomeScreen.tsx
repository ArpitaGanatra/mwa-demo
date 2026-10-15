import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useMobileWallet } from "@wallet-ui/react-native-web3js";
import { SLIPPAGE_BPS, SOL_MINT, USDC_DECIMALS, USDC_MINT } from "./constants";
import { buildSwapTransaction, getSwapBuild, SwapBuild } from "./swap";

const formatUsdc = (raw: string) => (Number(raw) / 10 ** USDC_DECIMALS).toFixed(4);

export default function HomeScreen() {
  const { account, connect, disconnect, connection, signAndSendTransactions } =
    useMobileWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<SwapBuild | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!account) return setBalance(null);
    setBalance((await connection.getBalance(account.address)) / LAMPORTS_PER_SOL);
  }, [account, connection]);

  useEffect(() => {
    refreshBalance().catch(() => {});
  }, [refreshBalance]);

  // Wraps every action with a loading state and error display
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const swapParams = () => {
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
    if (!account) throw new Error("Connect a wallet first");
    if (!lamports || lamports <= 0) throw new Error("Enter a valid SOL amount");
    return {
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: String(lamports),
      taker: account.address.toBase58(),
      slippageBps: SLIPPAGE_BPS,
    };
  };

  const onConnect = () =>
    run("Connecting…", async () => {
      await connect();
    });

  const onDisconnect = () =>
    run("Disconnecting…", async () => {
      await disconnect();
      setQuote(null);
      setSignature(null);
    });

  const onQuote = () =>
    run("Fetching quote…", async () => {
      setSignature(null);
      setQuote(await getSwapBuild(swapParams()));
    });

  const onSwap = () =>
    run("Preparing swap…", async () => {
      if (!account) return;
      // Fetch a fresh route so the displayed quote can't be stale
      const build = await getSwapBuild(swapParams());
      const { transaction, latestBlockhash, minContextSlot } = await buildSwapTransaction(
        connection,
        account.address,
        build,
      );

      setBusy("Approve in your wallet…");
      const sig = await signAndSendTransactions(transaction, minContextSlot);

      setBusy("Confirming…");
      const { value } = await connection.confirmTransaction(
        { signature: sig, ...latestBlockhash },
        "confirmed",
      );
      if (value.err) throw new Error(`Swap failed on-chain: ${JSON.stringify(value.err)}`);

      setSignature(sig);
      setQuote(null);
      await refreshBalance();
    });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MWA Swap</Text>

      {!account ? (
        <Button title="Connect wallet" onPress={onConnect} disabled={!!busy} />
      ) : (
        <>
          <Text selectable style={styles.mono}>
            {account.address.toBase58()}
          </Text>
          <Text>Balance: {balance === null ? "…" : `${balance.toFixed(4)} SOL`}</Text>

          <Text style={styles.label}>Swap SOL → USDC</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(t) => {
              setAmount(t);
              setQuote(null);
            }}
            keyboardType="decimal-pad"
            placeholder="Amount in SOL"
          />
          <Button title="Get quote" onPress={onQuote} disabled={!!busy} />

          {quote && (
            <Text>
              ≈ {formatUsdc(quote.outAmount)} USDC (min {formatUsdc(quote.otherAmountThreshold)})
            </Text>
          )}

          <Button title="Swap" onPress={onSwap} disabled={!!busy || !quote} />
          <Button title="Disconnect" color="#888" onPress={onDisconnect} disabled={!!busy} />
        </>
      )}

      {busy && (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text> {busy}</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {signature && (
        <Text
          style={styles.link}
          onPress={() => Linking.openURL(`https://solscan.io/tx/${signature}`)}
        >
          Swap confirmed. View on Solscan
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 64, gap: 12, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "600" },
  label: { marginTop: 12, fontWeight: "600" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  error: { color: "#c00" },
  link: { color: "#06c", textDecorationLine: "underline" },
});
