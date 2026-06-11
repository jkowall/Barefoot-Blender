export const BUG_REPORT_EMAIL = "jkowall@gmail.com";
export const MAILTO_URL_MAX_LENGTH = 1800;

export type BugReportPlatform = "web" | "ios" | "android" | "unknown";
export type BugReportSource = "footer" | "settings" | "crash";
export type BugReportRuntimeContext = "browser" | "pwa" | "native" | "unknown";

type DiagnosticPrimitive = string | number | boolean | null;
type DiagnosticValue = DiagnosticPrimitive | DiagnosticObject | DiagnosticValue[];
type DiagnosticObject = {
  [key: string]: DiagnosticValue;
};

export type BugReportDiagnosticsInput = {
  appVersion: string;
  platform: BugReportPlatform;
  runtimeContext: BugReportRuntimeContext;
  userAgent?: string;
  urlPath?: string;
  activeTab?: string;
  pressureUnit?: string;
  depthUnit?: string;
  online?: boolean;
  viewport?: {
    width?: number;
    height?: number;
  };
  currentInputs?: Record<string, unknown>;
  errorMessage?: string;
};

export type BrowserDiagnostics = {
  runtimeContext: BugReportRuntimeContext;
  userAgent?: string;
  urlPath?: string;
  online?: boolean;
  viewport?: {
    width?: number;
    height?: number;
  };
};

export type BrowserDiagnosticsEnvironment = {
  navigator?: Pick<Navigator, "userAgent" | "onLine"> & { standalone?: boolean };
  location?: Pick<Location, "pathname" | "search" | "hash">;
  innerWidth?: number;
  innerHeight?: number;
  matchMedia?: (query: string) => { matches: boolean };
};

export type BugReportInput = {
  appVersion: string;
  platform: BugReportPlatform;
  source: BugReportSource;
  whatHappened: string;
  expectedBehavior: string;
  contactEmail?: string;
  includeDiagnostics: boolean;
  diagnostics?: BugReportDiagnosticsInput;
};

export type BugReport = {
  subject: string;
  body: string;
  diagnostics?: DiagnosticObject;
};

export type MailtoLink = {
  url: string;
  truncated: boolean;
};

const sensitiveKeyPattern = /(authorization|customer|env|key|localstorage|password|receipt|revenuecat|secret|stack|token)/i;

const sanitizeText = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const formatOptionalText = (value: string): string => {
  const sanitized = sanitizeText(value);
  return sanitized.length > 0 ? sanitized : "Not provided";
};

const isDiagnosticValue = (value: DiagnosticValue | undefined): value is DiagnosticValue => value !== undefined;

const sanitizeDiagnosticValue = (value: unknown, depth = 0): DiagnosticValue | undefined => {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (value === undefined || depth >= 4) return undefined;
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, 12)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1))
      .filter(isDiagnosticValue);
    return sanitized;
  }
  if (typeof value === "object") {
    const result: DiagnosticObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) continue;
      const sanitized = sanitizeDiagnosticValue(nestedValue, depth + 1);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }
  return undefined;
};

export const sanitizeBugReportDiagnostics = (input: BugReportDiagnosticsInput): DiagnosticObject => {
  const diagnostics: DiagnosticObject = {
    appVersion: input.appVersion,
    platform: input.platform,
    runtimeContext: input.runtimeContext
  };

  const optionalFields: Record<string, unknown> = {
    userAgent: input.userAgent,
    urlPath: input.urlPath,
    activeTab: input.activeTab,
    pressureUnit: input.pressureUnit,
    depthUnit: input.depthUnit,
    online: input.online,
    viewport: input.viewport,
    currentInputs: input.currentInputs,
    errorMessage: input.errorMessage
  };

  for (const [key, value] of Object.entries(optionalFields)) {
    const sanitized = sanitizeDiagnosticValue(value);
    if (sanitized !== undefined) {
      diagnostics[key] = sanitized;
    }
  }

  return diagnostics;
};

export const collectBrowserDiagnostics = (
  environment: BrowserDiagnosticsEnvironment | undefined = globalThis
): BrowserDiagnostics => {
  const standaloneDisplay = environment?.matchMedia?.("(display-mode: standalone)").matches === true;
  const standaloneNavigator = environment?.navigator?.standalone === true;
  const runtimeContext = standaloneDisplay || standaloneNavigator ? "pwa" : "browser";
  const location = environment?.location;
  const urlPath = location === undefined ? undefined : `${location.pathname}${location.search}${location.hash}`;

  return {
    runtimeContext,
    userAgent: environment?.navigator?.userAgent,
    urlPath,
    online: environment?.navigator?.onLine,
    viewport:
      environment?.innerWidth === undefined && environment?.innerHeight === undefined
        ? undefined
        : {
            width: environment.innerWidth,
            height: environment.innerHeight
          }
  };
};

const buildDiagnosticsSection = (diagnostics: DiagnosticObject): string =>
  Object.entries(diagnostics)
    .map(([key, value]) => {
      const formattedValue = typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value);
      return `${key}: ${formattedValue}`;
    })
    .join("\n");

export const buildBugReportSubject = (input: Pick<BugReportInput, "appVersion" | "platform" | "source">): string =>
  `Barefoot Blender bug report (${input.platform}, v${input.appVersion}, ${input.source})`;

export const buildBugReport = (input: BugReportInput): BugReport => {
  const diagnostics = input.includeDiagnostics && input.diagnostics !== undefined
    ? sanitizeBugReportDiagnostics(input.diagnostics)
    : undefined;
  const body = [
    "Barefoot Blender bug report",
    "",
    "What happened?",
    formatOptionalText(input.whatHappened),
    "",
    "What did you expect?",
    formatOptionalText(input.expectedBehavior),
    "",
    "Contact",
    formatOptionalText(input.contactEmail ?? ""),
    "",
    "Diagnostics",
    diagnostics === undefined ? "Not included" : buildDiagnosticsSection(diagnostics)
  ].join("\n");

  return {
    subject: buildBugReportSubject(input),
    body,
    diagnostics
  };
};

const buildMailtoUrl = (subject: string, body: string, email = BUG_REPORT_EMAIL): string =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const truncateBodyForMailto = (subject: string, body: string, maxUrlLength: number): string => {
  let characterLimit = Math.min(body.length, 900);
  while (characterLimit > 180) {
    const candidate = `${body.slice(0, characterLimit).trimEnd()}\n\n[Email body shortened. Use Copy report for the full report.]`;
    if (buildMailtoUrl(subject, candidate).length <= maxUrlLength) {
      return candidate;
    }
    characterLimit -= 120;
  }
  return "Bug report details were too long for this email handoff. Use Copy report in the app to send the full report.";
};

export const buildBugReportMailtoLink = (
  report: Pick<BugReport, "subject" | "body">,
  maxUrlLength = MAILTO_URL_MAX_LENGTH
): MailtoLink => {
  const fullUrl = buildMailtoUrl(report.subject, report.body);
  if (fullUrl.length <= maxUrlLength) {
    return {
      url: fullUrl,
      truncated: false
    };
  }

  return {
    url: buildMailtoUrl(report.subject, truncateBodyForMailto(report.subject, report.body, maxUrlLength)),
    truncated: true
  };
};
