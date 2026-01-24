export interface Deployment {
  id: string;
  name?: string;
  deploy?: string;
  [key: string]: unknown;
}

/** Send deployment to backend. Empty stub for now. */
export function sendDeployment(_deployment: Deployment): void {}
