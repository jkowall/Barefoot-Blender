import { useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "./state/settings";
import { listTopOffOptions } from "./utils/calculations";
import { isNativeApp } from "./utils/platform";
import {
  getSubscriptionStatus,
  openManageSubscription,
  purchaseAnnual,
  restorePurchases,
  type SubscriptionStatus
} from "./services/subscription";
import type { BugReportSource } from "./services/bugReport";
import StandardBlendTab from "./components/StandardBlendTab";
import TopOffTab from "./components/TopOffTab";
import MultiGasTab from "./components/MultiGasTab";
import UtilitiesTab from "./components/UtilitiesTab";
import SettingsPanel from "./components/SettingsPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import SafetyAcknowledgement from "./components/SafetyAcknowledgement";
import SubscriptionPaywall from "./components/SubscriptionPaywall";
import BugReportDialog from "./components/BugReportDialog";

const APP_VERSION = __APP_VERSION__;
const CHANGELOG_URL = "https://github.com/jkowall/Barefoot-Blender/blob/main/CHANGELOG.md";
const REPO_URL = "https://github.com/jkowall/Barefoot-Blender";
const SAFETY_ACK_KEY = "barefoot-blender-safety-acknowledged";

type AppTab = "standard" | "topoff" | "multi" | "utilities";

type BugReportRequest = {
  source: BugReportSource;
  errorMessage?: string;
};

const getInitialSafetyAcknowledgement = (): boolean =>
  typeof window === "undefined" ? false : window.localStorage.getItem(SAFETY_ACK_KEY) === "true";

const getInitialSubscriptionStatus = (): SubscriptionStatus => {
  const nativeApp = isNativeApp();
  return {
    loading: true,
    active: !nativeApp,
    source: nativeApp ? "unknown" : "web"
  };
};

const App = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<AppTab>("standard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugReportRequest, setBugReportRequest] = useState<BugReportRequest | null>(null);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(getInitialSafetyAcknowledgement);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>(getInitialSubscriptionStatus);
  const settings = useSettingsStore();

  const topOffOptions = useMemo(() => listTopOffOptions(settings.customGases), [settings.customGases]);

  useEffect(() => {
    let mounted = true;
    void getSubscriptionStatus().then((status) => {
      if (mounted) {
        setSubscriptionStatus(status);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const acknowledgeSafety = (): void => {
    window.localStorage.setItem(SAFETY_ACK_KEY, "true");
    setSafetyAcknowledged(true);
  };

  const runSubscriptionAction = (action: () => Promise<SubscriptionStatus>): void => {
    setSubscriptionStatus((current) => ({ ...current, loading: true, error: undefined }));
    void action().then(setSubscriptionStatus);
  };

  const manageSubscription = (): void => {
    void openManageSubscription();
  };

  const openBugReport = (source: BugReportSource, error?: Error): void => {
    setBugReportRequest({
      source,
      errorMessage: error?.message
    });
  };

  if (!safetyAcknowledged) {
    return <SafetyAcknowledgement onAcknowledge={acknowledgeSafety} />;
  }

  if (isNativeApp() && !subscriptionStatus.active) {
    return (
      <SubscriptionPaywall
        status={subscriptionStatus}
        onPurchase={() => runSubscriptionAction(purchaseAnnual)}
        onRestore={() => runSubscriptionAction(restorePurchases)}
        onManage={manageSubscription}
      />
    );
  }

  return (
    <>
      <ErrorBoundary onReportBug={(error) => openBugReport("crash", error)}>
        <div className="app">
          <header className="app-header">
            <div className="app-brand">
              <img className="app-logo" src="/logo-64.png" alt="Barefoot Blender logo" />
              <div className="app-title-group">
                <div className="app-title">Barefoot Blender</div>
                <div className="app-subtitle">Trimix Gas Blending Toolkit</div>
              </div>
            </div>
            <div className="app-actions">
              <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
            </div>
          </header>

          <nav className="app-nav">
            <button
              className={`tab-button ${activeTab === "standard" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("standard")}
            >
              Standard Blend
            </button>
            <button
              className={`tab-button ${activeTab === "topoff" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("topoff")}
            >
              Top-Off What-If
            </button>
            <button
              className={`tab-button ${activeTab === "multi" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("multi")}
            >
              Multi-Gas Blend
            </button>
            <button
              className={`tab-button ${activeTab === "utilities" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("utilities")}
            >
              Utilities
            </button>
          </nav>

          <main className="content">
            {activeTab === "standard" && (
              <StandardBlendTab
                settings={settings}
                topOffOptions={topOffOptions}
                trainingModeEnabled={settings.trainingModeEnabled}
              />
            )}
            {activeTab === "topoff" && (
              <TopOffTab
                settings={settings}
                topOffOptions={topOffOptions}
                trainingModeEnabled={settings.trainingModeEnabled}
              />
            )}
            {activeTab === "multi" && (
              <MultiGasTab
                settings={settings}
                topOffOptions={topOffOptions}
                trainingModeEnabled={settings.trainingModeEnabled}
              />
            )}
            {activeTab === "utilities" && (
              <UtilitiesTab settings={settings} trainingModeEnabled={settings.trainingModeEnabled} />
            )}
          </main>

          <footer className="app-footer">
            <span className="app-version">Version {APP_VERSION}</span>
            <div className="app-footer-links">
              <button
                aria-pressed={settings.trainingModeEnabled}
                className={`training-mode-toggle ${settings.trainingModeEnabled ? "active" : ""}`}
                type="button"
                onClick={() => settings.setTrainingModeEnabled(!settings.trainingModeEnabled)}
              >
                Training Mode {settings.trainingModeEnabled ? "On" : "Off"}
              </button>
              <span className="app-footer-separator">•</span>
              <a className="app-footer-link" href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
                Release notes
              </a>
              <span className="app-footer-separator">•</span>
              <a className="app-footer-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <span className="app-footer-separator">•</span>
              <a className="app-footer-link" href="/privacy/" target="_blank" rel="noopener noreferrer">
                Privacy
              </a>
              <span className="app-footer-separator">•</span>
              <a className="app-footer-link" href="/terms/" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
              <span className="app-footer-separator">•</span>
              <a className="app-footer-link" href="/support/" target="_blank" rel="noopener noreferrer">
                Support
              </a>
              <span className="app-footer-separator">•</span>
              <button
                className="app-footer-link app-footer-link-button"
                type="button"
                onClick={() => openBugReport("footer")}
              >
                Report bug
              </button>
            </div>
          </footer>

          {settingsOpen && (
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              onReportBug={() => {
                setSettingsOpen(false);
                openBugReport("settings");
              }}
            />
          )}
        </div>
      </ErrorBoundary>
      {bugReportRequest !== null && (
        <BugReportDialog
          activeTab={activeTab}
          appVersion={APP_VERSION}
          errorMessage={bugReportRequest.errorMessage}
          onClose={() => setBugReportRequest(null)}
          source={bugReportRequest.source}
        />
      )}
    </>
  );
};

export default App;
