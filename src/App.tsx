import { useMemo, useState } from "react";
import { useSettingsStore } from "./state/settings";
import { listTopOffOptions } from "./utils/calculations";
import StandardBlendTab from "./components/StandardBlendTab";
import MultiGasTab from "./components/MultiGasTab";
import UtilitiesTab from "./components/UtilitiesTab";
import SettingsPanel from "./components/SettingsPanel";

const App = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<"standard" | "multi" | "utilities">("standard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useSettingsStore();

  const topOffOptions = useMemo(() => listTopOffOptions(settings.customGases), [settings.customGases]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="app-title">Barefoot Blender</div>
          <div className="tag">Progressive Web App</div>
        </div>
        <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      <nav className="tab-bar">
        <button
          className={`tab-button ${activeTab === "standard" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("standard")}
        >
          Standard Blend
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
        {activeTab === "multi" && <MultiGasTab settings={settings} topOffOptions={topOffOptions} />}
        {activeTab === "utilities" && <UtilitiesTab settings={settings} />}
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
};

export default App;
