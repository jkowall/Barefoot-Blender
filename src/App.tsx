import { useMemo, useState } from "react";
import { useSettingsStore } from "./state/settings";
import { listTopOffOptions } from "./utils/calculations";
import StandardBlendTab from "./components/StandardBlendTab";
import TopOffTab from "./components/TopOffTab";
import MultiGasTab from "./components/MultiGasTab";
import UtilitiesTab from "./components/UtilitiesTab";
import SettingsPanel from "./components/SettingsPanel";

const APP_VERSION = __APP_VERSION__;
const CHANGELOG_URL = "https://github.com/jkowall/Barefoot-Blender/blob/main/CHANGELOG.md";
const REPO_URL = "https://github.com/jkowall/Barefoot-Blender";

const App = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<"standard" | "topoff" | "multi" | "utilities">("standard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useSettingsStore();

  const topOffOptions = useMemo(() => listTopOffOptions(settings.customGases), [settings.customGases]);

  return (
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
          <StandardBlendTab settings={settings} topOffOptions={topOffOptions} />
        )}
        {activeTab === "topoff" && (
          <TopOffTab settings={settings} topOffOptions={topOffOptions} />
        )}
        {activeTab === "multi" && <MultiGasTab settings={settings} topOffOptions={topOffOptions} />}
        {activeTab === "utilities" && <UtilitiesTab settings={settings} />}
      </main>

      <footer className="app-footer">
        <span className="app-version">Version {APP_VERSION}</span>
        <div className="app-footer-links">
          <a className="app-footer-link" href={CHANGELOG_URL} target="_blank" rel="noreferrer">
            Release notes
          </a>
          <span className="app-footer-separator">•</span>
          <a className="app-footer-link" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </footer>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
};

export default App;
