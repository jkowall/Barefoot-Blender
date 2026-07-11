import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSessionStore, type SessionState } from "../state/session";
import { useSettingsStore, type SettingsSnapshot } from "../state/settings";
import {
  buildBugReport,
  buildBugReportMailtoLink,
  collectBrowserDiagnostics,
  type BugReportPlatform,
  type BugReportSource
} from "../services/bugReport";
import { getNativePlatform, isNativeApp } from "../utils/platform";

type BugReportDialogProps = {
  activeTab: string;
  appVersion: string;
  errorMessage?: string;
  onClose: () => void;
  source: BugReportSource;
};

const getPlatform = (): BugReportPlatform => getNativePlatform() ?? "web";

const getCurrentInputs = (activeTab: string, session: SessionState): Record<string, unknown> | undefined => {
  if (activeTab === "standard") return session.standardBlend;
  if (activeTab === "topoff") return session.topOff;
  if (activeTab === "multi") return session.multiGas;
  if (activeTab === "utilities") return session.utilities;
  return undefined;
};

const buildSettingsSummary = (settings: SettingsSnapshot): Pick<
  SettingsSnapshot,
  "pressureUnit" | "depthUnit" | "defaultMaxPPO2" | "defaultContingencyPPO2" | "oxygenIsNarcotic"
> => ({
  pressureUnit: settings.pressureUnit,
  depthUnit: settings.depthUnit,
  defaultMaxPPO2: settings.defaultMaxPPO2,
  defaultContingencyPPO2: settings.defaultContingencyPPO2,
  oxygenIsNarcotic: settings.oxygenIsNarcotic
});

const BugReportDialog = ({
  activeTab,
  appVersion,
  errorMessage,
  onClose,
  source
}: BugReportDialogProps): JSX.Element => {
  const settings = useSettingsStore();
  const session = useSessionStore();
  const [whatHappened, setWhatHappened] = useState(errorMessage === undefined ? "" : `Crash: ${errorMessage}`);
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const previewRef = useRef<HTMLTextAreaElement>(null);

  const report = useMemo(() => {
    const browserDiagnostics = collectBrowserDiagnostics();
    const platform = getPlatform();
    const diagnostics = {
      appVersion,
      platform,
      runtimeContext: isNativeApp() ? "native" as const : browserDiagnostics.runtimeContext,
      userAgent: browserDiagnostics.userAgent,
      urlPath: browserDiagnostics.urlPath,
      activeTab,
      pressureUnit: settings.pressureUnit,
      depthUnit: settings.depthUnit,
      online: browserDiagnostics.online,
      viewport: browserDiagnostics.viewport,
      currentInputs: {
        settings: buildSettingsSummary(settings),
        activeCalculator: getCurrentInputs(activeTab, session)
      },
      errorMessage
    };

    return buildBugReport({
      appVersion,
      platform,
      source,
      whatHappened,
      expectedBehavior,
      contactEmail,
      includeDiagnostics,
      diagnostics
    });
  }, [activeTab, appVersion, contactEmail, errorMessage, expectedBehavior, includeDiagnostics, session, settings, source, whatHappened]);

  const mailto = useMemo(() => buildBugReportMailtoLink(report), [report]);

  const emailReport = (): void => {
    if (typeof window === "undefined") {
      setStatus("Email handoff is unavailable in this environment. Copy the report instead.");
      return;
    }
    window.location.href = mailto.url;
    setStatus(mailto.truncated
      ? "Email opened with a shortened report. Copy report has the full content."
      : "Email opened. Copy report remains available if the mail client did not launch.");
  };

  const copyReport = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(report.body);
      setStatus("Report copied.");
    } catch {
      previewRef.current?.focus();
      previewRef.current?.select();
      setStatus("Clipboard unavailable. The report preview is selected for manual copy.");
    }
  };

  return (
    <div className="bug-report-panel" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
      <div className="card bug-report-card">
        <div className="bug-report-header">
          <h2 id="bug-report-title">Report bug</h2>
          <button className="settings-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="bug-report-form">
          <div className="field">
            <label htmlFor="bug-report-happened">What happened?</label>
            <textarea
              id="bug-report-happened"
              rows={4}
              value={whatHappened}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setWhatHappened(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="bug-report-expected">What did you expect?</label>
            <textarea
              id="bug-report-expected"
              rows={3}
              value={expectedBehavior}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setExpectedBehavior(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="bug-report-contact">Optional contact email</label>
            <input
              id="bug-report-contact"
              type="email"
              value={contactEmail}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setContactEmail(event.target.value)}
            />
          </div>

          <label className="bug-report-checkbox">
            <input
              type="checkbox"
              checked={includeDiagnostics}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setIncludeDiagnostics(event.target.checked)}
            />
            <span>Include app diagnostics</span>
          </label>

          <div className="field">
            <label htmlFor="bug-report-preview">Report preview</label>
            <textarea
              id="bug-report-preview"
              ref={previewRef}
              className="bug-report-preview"
              readOnly
              rows={10}
              value={report.body}
            />
          </div>

          {mailto.truncated && (
            <div className="warning">
              Email handoff will be shortened because the report is large. Copy report keeps the full content.
            </div>
          )}
          {status !== undefined && <div className="table-note">{status}</div>}
        </div>

        <div className="bug-report-actions">
          <button className="settings-close" type="button" onClick={() => void copyReport()}>
            Copy report
          </button>
          <button className="calculate-button bug-report-email" type="button" onClick={emailReport}>
            Email report
          </button>
        </div>
      </div>
    </div>
  );
};

export default BugReportDialog;
