export type CatalogOrientationPolicy = "portrait" | "landscape" | "free" | "preserve";

export type CatalogOrientationRuntime = {
  lockPortrait: () => void | Promise<void>;
  lockLandscape?: () => void | Promise<void>;
  unlock: () => void | Promise<void>;
};

type OrientationOwner = "catalog" | "player";

export function createOrientationOwnershipCoordinator() {
  let owner: OrientationOwner = "catalog";
  let policy: CatalogOrientationPolicy | null = null;
  let runtime: CatalogOrientationRuntime | null = null;
  let revision = 0;
  let registration = 0;
  let operationTail: Promise<void> = Promise.resolve();

  const enqueueCatalogPolicy = (expectedRevision: number) => {
    const operation = operationTail.then(async () => {
      if (
        owner !== "catalog" ||
        revision !== expectedRevision ||
        !policy ||
        !runtime
      )
        return false;
      if (policy === "portrait") await runtime.lockPortrait();
      if (policy === "landscape") {
        if (runtime.lockLandscape) await runtime.lockLandscape();
        else await runtime.unlock();
      }
      if (policy === "free") await runtime.unlock();
      return owner === "catalog" && revision === expectedRevision;
    });
    operationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const registerCatalogPolicy = (
    nextPolicy: CatalogOrientationPolicy,
    nextRuntime: CatalogOrientationRuntime,
  ) => {
    const token = ++registration;
    policy = nextPolicy;
    runtime = nextRuntime;
    const expectedRevision = ++revision;
    if (owner === "catalog") void enqueueCatalogPolicy(expectedRevision);

    return () => {
      if (registration !== token) return;
      policy = null;
      runtime = null;
      revision += 1;
    };
  };

  const acquirePlayer = async () => {
    owner = "player";
    revision += 1;
    await operationTail;
  };

  const handoffPlayerToCatalog = async () => {
    if (!policy || !runtime) return false;
    owner = "catalog";
    const expectedRevision = ++revision;
    return enqueueCatalogPolicy(expectedRevision);
  };

  const reassertCatalogPolicy = async () => {
    if (owner !== "catalog" || !policy || !runtime) return false;
    const expectedRevision = ++revision;
    await enqueueCatalogPolicy(expectedRevision);
    return true;
  };

  const snapshot = () => ({ owner, policy, revision });

  return {
    registerCatalogPolicy,
    acquirePlayer,
    handoffPlayerToCatalog,
    reassertCatalogPolicy,
    snapshot,
  };
}

const orientationOwnership = createOrientationOwnershipCoordinator();

export const registerCatalogOrientationPolicy =
  orientationOwnership.registerCatalogPolicy;
export const acquirePlayerOrientationOwnership =
  orientationOwnership.acquirePlayer;
export const handoffPlayerOrientationToCatalog =
  orientationOwnership.handoffPlayerToCatalog;
export const reassertCatalogOrientationPolicy =
  orientationOwnership.reassertCatalogPolicy;
