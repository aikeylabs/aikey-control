import type { RuntimeConfig } from '@/app/config/runtime';

/** Whether Axios should attach the JWT persisted by the browser. */
export function shouldAttachBrowserToken(
  cfg: Pick<RuntimeConfig, 'authMode' | 'controlPlaneMode' | 'teamGateway'>,
): boolean {
  return !(
    cfg.authMode === 'local_bypass' &&
    (cfg.controlPlaneMode === 'personal' || cfg.teamGateway === true)
  );
}
