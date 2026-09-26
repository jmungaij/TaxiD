/**
 * AI Service Implementation Registry.
 *
 * A capability contract may only declare an AI service as `live` when the
 * service is backed by a shipped, deterministic engine *and* an evaluation
 * harness. This registry is the single source of that evidence: the maturity
 * gate refuses to certify a `live` service that is not registered here, which
 * makes AI readiness levels auditable instead of self-declared.
 *
 * Pure configuration. No runtime dependencies.
 */
import type { AiCapabilitySpec } from "@/lib/contracts";

export type AiService = AiCapabilitySpec["service"];

export interface AiImplementationEvidence {
  /** Module that implements the service. */
  engine: string;
  /** Exported entrypoint inside the engine. */
  entrypoint: string;
  /** Deterministic evaluation or certification harness for the service. */
  harness: string;
  /** Closed-loop control surface, when the output drives automated action. */
  closedLoop?: string;
}

type ModuleRegistry = Partial<Record<AiService, AiImplementationEvidence>>;

export const AI_SERVICE_IMPLEMENTATIONS: Record<string, ModuleRegistry> = {
  customer_operations: {
    classification: {
      engine: "src/lib/platform/rulesEngine.ts",
      entrypoint: "evaluatePolicy",
      harness: "src/lib/platform/__tests__ · rules engine decision trace tests",
    },
    prioritization: {
      engine: "src/lib/platform/customerIntelligence.ts",
      entrypoint: "analyseCustomer",
      harness: "certifyCustomerIntelligence",
    },
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "certifyCustomerIntelligence",
      closedLoop: "src/lib/platform/autonomousOperations.ts · certifyAutonomousOperations",
    },
    forecasting: {
      engine: "src/lib/platform/scalabilityPlanning.ts",
      entrypoint: "projectResource",
      harness: "certifyScalability",
    },
    sop_recommendation: {
      engine: "src/lib/platform/processIntelligence.ts",
      entrypoint: "analyseProcess",
      harness: "certifyProcessIntelligence",
    },
  },
  delivery_logistics: {
    forecasting: {
      engine: "src/lib/logistics/predictionEngine.ts",
      entrypoint: "forecastCapacity",
      harness: "evaluateEta · ETA_THRESHOLDS",
    },
    risk_detection: {
      engine: "src/lib/logistics/predictionEngine.ts",
      entrypoint: "detectAnomalies",
      harness: "src/lib/logistics/logisticsHardening.ts · certifyPredictionQuality",
      closedLoop: "src/lib/delivery/dispatchActions.ts · governed dispatch actions",
    },
    sop_recommendation: {
      engine: "src/lib/logistics/logisticsCopilot.ts",
      entrypoint: "askLogisticsCopilot",
      harness: "certifyCopilot",
    },
  },
  finance_refunds: {
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/financialIntelligence.ts · certifyFinancialIntelligence",
      closedLoop: "src/lib/platform/rulesEngine.ts · finance auto-approval policy",
    },
    forecasting: {
      engine: "src/lib/platform/financialIntelligence.ts",
      entrypoint: "analyseLine",
      harness: "certifyFinancialIntelligence",
    },
  },
  trust_safety: {
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/trustIntelligence.ts · certifyTrustIntelligence",
      closedLoop: "src/lib/platform/rulesEngine.ts · trust_safety escalation policy",
    },
    prioritization: {
      engine: "src/lib/platform/trustIntelligence.ts",
      entrypoint: "certifyTrustIntelligence",
      harness: "src/domains/trust/__tests__/trustConflict.test.ts",
    },
  },
  fleet: {
    forecasting: {
      engine: "src/lib/platform/scalabilityPlanning.ts",
      entrypoint: "projectResource",
      harness: "certifyScalability",
    },
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/workforceIntelligence.ts · certifyWorkforce",
      closedLoop: "src/lib/platform/rulesEngine.ts · fleet activation policy",
    },
  },
  mobility: {
    forecasting: {
      engine: "src/lib/platform/marketplaceOptimization.ts",
      entrypoint: "optimiseCell",
      harness: "certifyMarketplace",
    },
    prioritization: {
      engine: "src/lib/platform/rulesEngine.ts",
      entrypoint: "evaluatePolicy",
      harness: "src/lib/platform/__tests__ · mobility dispatch policy tests",
    },
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/trustIntelligence.ts · certifyTrustIntelligence",
      closedLoop: "src/lib/platform/rulesEngine.ts · mobility GPS-integrity escalation",
    },
  },
  corporate: {
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/financialIntelligence.ts · certifyFinancialIntelligence",
      closedLoop: "src/lib/platform/rulesEngine.ts · corporate spend-anomaly policy",
    },
    forecasting: {
      engine: "src/lib/platform/financialIntelligence.ts",
      entrypoint: "analyseLine",
      harness: "certifyFinancialIntelligence",
    },
  },
  marketplace: {
    forecasting: {
      engine: "src/lib/platform/marketplaceOptimization.ts",
      entrypoint: "optimiseCell",
      harness: "certifyMarketplace",
    },
    prioritization: {
      engine: "src/lib/platform/marketplace360.ts",
      entrypoint: "runMarketplace360",
      harness: "src/lib/platform/__tests__ · marketplace 360 certification tests",
    },
    risk_detection: {
      engine: "src/lib/platform/riskScore.ts",
      entrypoint: "assessOperationalRisk",
      harness: "src/lib/platform/trustIntelligence.ts · certifyTrustIntelligence",
      closedLoop: "src/lib/platform/rulesEngine.ts · marketplace gaming escalation",
    },
  },
};

export function aiImplementation(module: string, service: AiService): AiImplementationEvidence | undefined {
  return AI_SERVICE_IMPLEMENTATIONS[module]?.[service];
}

/** Registered live-capable services for a module. */
export function registeredAiServices(module: string): AiService[] {
  return Object.keys(AI_SERVICE_IMPLEMENTATIONS[module] ?? {}) as AiService[];
}
