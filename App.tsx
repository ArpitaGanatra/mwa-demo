import { StatusBar } from "expo-status-bar";
import { MobileWalletProvider } from "@wallet-ui/react-native-web3js";
import { RPC_URL } from "./src/constants";
import HomeScreen from "./src/HomeScreen";

const identity = {
  name: "MWA Swap",
  uri: "https://example.com",
  icon: "favicon.png", // relative to uri
};

export default function App() {
  return (
    <MobileWalletProvider
      chain="solana:mainnet"
      endpoint={RPC_URL}
      identity={identity}
    >
      <HomeScreen />
      <StatusBar style="dark" />
    </MobileWalletProvider>
  );
}
