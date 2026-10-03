import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import { captureAttribution } from './lib/social/attribution'
import { installEdgeFunctionGuard } from './lib/runtime/edgeFunctionGuard'

installEdgeFunctionGuard();
import { GlobalErrorBoundary, attemptStaleBundleRecovery, classifyRuntimeError } from './components/system/GlobalErrorBoundary'
import { recordDiagnostic, supportReference, newCorrelationId } from './lib/runtime/diagnostics'
import { buildManifest, hasMixedDependencyBundles } from './lib/runtime/buildManifest'
import './index.css'
import './tw-utilities.css'

// First-party attribution capture. First touch is written once and never
// overwritten, so a later campaign visit cannot rewrite how a customer was
// originally acquired. Storage failures degrade attribution, never the app.
captureAttribution();

// Sentry — no-op when VITE_SENTRY_DSN is unset (local/preview builds).
// Errors captured client-side include the same correlation_id our edge
// functions echo back in REG-xxx responses, so a single Sentry event links
// the browser trace and the backend request.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

// Deployment integrity: two dependency generations in one document means stale
// and current bundles are live together (the classic "React is null" failure).
if (hasMixedDependencyBundles()) {
  recordDiagnostic({
    category: 'DEPLOYMENT',
    severity: 'CRITICAL',
    operation: 'mixed_dependency_bundles',
    message: 'More than one Vite dependency generation is live in this document.',
    errorCode: 'DEPENDENCY_ERROR',
    metadata: { ...buildManifest() },
  });
}

// Errors thrown outside React's render path (async handlers, dynamic imports)
// never reach the error boundary — capture and recover from them here.
window.addEventListener('error', (event) => {
  const error = event.error instanceof Error ? event.error : new Error(String(event.message ?? 'unknown error'));
  const kind = classifyRuntimeError(error);
  const correlationId = newCorrelationId();
  recordDiagnostic({
    category: kind === 'CHUNK_LOAD_ERROR' || kind === 'DEPENDENCY_ERROR' ? 'DEPLOYMENT' : 'RUNTIME',
    severity: 'ERROR',
    operation: 'window_error',
    message: error.message,
    correlationId,
    errorCode: kind,
    metadata: { reference: supportReference(correlationId), kind, ...buildManifest() },
  });
  void attemptStaleBundleRecovery(kind);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason ?? 'unhandled rejection'));
  const kind = classifyRuntimeError(error);
  const correlationId = newCorrelationId();
  recordDiagnostic({
    category: kind === 'CHUNK_LOAD_ERROR' || kind === 'DEPENDENCY_ERROR' ? 'DEPLOYMENT' : 'RUNTIME',
    severity: 'ERROR',
    operation: 'unhandled_rejection',
    message: error.message,
    correlationId,
    errorCode: kind,
    metadata: { reference: supportReference(correlationId), kind, ...buildManifest() },
  });
  void attemptStaleBundleRecovery(kind);
});

createRoot(document.getElementById("root")!).render(
  <GlobalErrorBoundary>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </GlobalErrorBoundary>
);
