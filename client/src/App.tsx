import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AgentLogProvider } from "./contexts/AgentLogContext";
import { WalletProvider } from "./contexts/WalletContext";
import Dashboard from "./pages/Dashboard";
import Swaps from "./pages/Swaps";
import AdminPanel from "./pages/AdminPanel";
function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Dashboard} />
      <Route path={"/swaps"} component={Dashboard} />
      {/* Hidden admin panel — not linked from consumer UI */}
      <Route path={"/admin"} component={AdminPanel} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export { Swaps };

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <AgentLogProvider>
          <WalletProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </WalletProvider>
        </AgentLogProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
