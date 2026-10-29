import * as oidc from "openid-client";
import type { AppConfig } from "../config.js";
export class IdentityProviders {
  private clients = new Map<string, Promise<oidc.Configuration>>();
  constructor(private config: AppConfig) {}
  definition(id: string) {
    return this.config.OIDC_PROVIDERS.find((p) => p.id === id);
  }
  async get(id: string) {
    const provider = this.definition(id);
    if (!provider) throw new Error("Unknown identity provider");
    if (!this.clients.has(id)) {
      const promise = oidc.discovery(
        new URL(provider.issuer),
        provider.clientId,
        { client_secret: provider.clientSecret },
        oidc.ClientSecretPost(provider.clientSecret),
        {
          timeout: 10,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(this.config.NODE_ENV !== "production" &&
            provider.issuer.startsWith("http:")
              ? [oidc.allowInsecureRequests]
              : []),
          ],
        },
      );
      this.clients.set(id, promise);
      promise.catch(() => this.clients.delete(id));
    }
    return this.clients.get(id)!;
  }
}
