/**
 * Capability contract registry — one entry per enterprise module.
 * Modules become self-describing: integration tests and the certification
 * pipeline read the registry rather than the module source.
 */
import { validateContract, type CapabilityContract, type ContractValidation } from "./capabilityContract";
import { CUSTOMER_OPERATIONS_CONTRACT } from "./customerOperations.contract";
import { DELIVERY_LOGISTICS_CONTRACT } from "./deliveryLogistics.contract";
import { FINANCE_REFUNDS_CONTRACT } from "./financeRefunds.contract";
import { TRUST_SAFETY_CONTRACT } from "./trustSafety.contract";
import { FLEET_CONTRACT } from "./fleet.contract";
import { MOBILITY_CONTRACT } from "./mobility.contract";
import { CORPORATE_CONTRACT } from "./corporate.contract";
import { MARKETPLACE_CONTRACT } from "./marketplace.contract";

export * from "./capabilityContract";
export {
  CUSTOMER_OPERATIONS_CONTRACT,
  DELIVERY_LOGISTICS_CONTRACT,
  FINANCE_REFUNDS_CONTRACT,
  TRUST_SAFETY_CONTRACT,
  FLEET_CONTRACT,
  MOBILITY_CONTRACT,
  CORPORATE_CONTRACT,
  MARKETPLACE_CONTRACT,
};

export const CAPABILITY_CONTRACTS: CapabilityContract[] = [
  CUSTOMER_OPERATIONS_CONTRACT,
  DELIVERY_LOGISTICS_CONTRACT,
  FINANCE_REFUNDS_CONTRACT,
  TRUST_SAFETY_CONTRACT,
  FLEET_CONTRACT,
  MOBILITY_CONTRACT,
  CORPORATE_CONTRACT,
  MARKETPLACE_CONTRACT,
];


export function contractFor(module: string): CapabilityContract | undefined {
  return CAPABILITY_CONTRACTS.find((c) => c.module === module);
}

export function validateAllContracts(): ContractValidation[] {
  return CAPABILITY_CONTRACTS.map(validateContract);
}

/** Cross-module event wiring check: every consumed event must be published somewhere. */
export interface EventWiringGap {
  consumer: string;
  event: string;
}

export function unwiredConsumedEvents(): EventWiringGap[] {
  const published = new Set(CAPABILITY_CONTRACTS.flatMap((c) => c.publishes.map((e) => e.name)));
  return CAPABILITY_CONTRACTS.flatMap((c) =>
    c.consumes.filter((e) => !published.has(e.name)).map((e) => ({ consumer: c.module, event: e.name })),
  );
}
