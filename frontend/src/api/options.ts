import {
  pathsApiDeploymentsGetParametersQueryStatusValues as status,
  pathsApiDeploymentsGetParametersQueryTypeValues as type,
  pathsApiDeploymentsGetParametersQueryEnvironmentValues as environment,
  pathsApiDeploymentsGetParametersQuerySort_byValues as sort,
  pathsApiDeploymentsGetParametersQuerySort_orderValues as order,
} from "./generated/schema";

// Keep generator-specific names at the contract boundary.
export const deploymentOptions = { status, type, environment, sort, order };
