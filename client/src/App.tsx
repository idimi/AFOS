import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AgentLogProvider } from "./contexts/AgentLogContext";
import { WalletProvider } from "./contexts/WalletContext";
import { MultiChainWalletProvider } from "./contexts/MultiChainWalletContext";
import { LightPeerProvider } from "./contexts/LightPeerContext";
import { ChatProvider } from "./contexts/ChatContext";
import { PriceProvider } from "./contexts/PriceContext";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletChatBridge } from "./components/WalletChatBridge";
import { WalletToastManager } from "./components/WalletToastManager";
import Dashboard from "./pages/Dashboard";
import Swaps from "./pages/Swaps";
import AdminPanel from "./pages/AdminPanel";
import LandingPage from "./pages/LandingPage";

/** Scrolls the window to the top whenever the pathname changes. */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);
  return null;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <>
      <ScrollToTop />
      <Switch>
      {/* Public landing page — no auth required */}
      <Route path={"/"} component={LandingPage} />
      {/* Authenticated app shell */}
      <Route path={"/app"} component={Dashboard} />
      <Route path={"/app/:rest*"} component={Dashboard} />
      {/* Hidden admin panel — not linked from consumer UI */}
      <Route path={"/admin"} component={AdminPanel} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </>
  );
}

export { Swaps };

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <AgentLogProvider>
          <WalletProvider>
            <MultiChainWalletProvider>
            <LightPeerProvider>
            <ChatProvider>
            <WalletModalProvider>
            <PriceProvider>
            <TooltipProvider>
              <WalletChatBridge />
              <WalletToastManager />
              <Toaster />
              <Router />
            </TooltipProvider>
            </PriceProvider>
            </WalletModalProvider>
            </ChatProvider>
            </LightPeerProvider>
            </MultiChainWalletProvider>
          </WalletProvider>
        </AgentLogProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
