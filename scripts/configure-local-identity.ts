import "dotenv/config";
const provider = JSON.parse(process.env.OIDC_PROVIDERS!)[0] as {
  issuer: string;
};
const issuer = new URL(provider.issuer);
if (
  process.env.NODE_ENV !== "development" ||
  process.env.LOCAL_SELF_SERVICE_SIGNUP !== "true" ||
  !["127.0.0.1", "localhost"].includes(issuer.hostname)
)
  throw new Error(
    "This configuration applies only to explicit local development signup.",
  );
let ready = false;
for (let i = 0; i < 90; i++) {
  try {
    if (
      (await fetch(provider.issuer + "/.well-known/openid-configuration")).ok
    ) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) throw new Error("Local identity service is not ready.");
const auth = await fetch(
  issuer.origin + "/realms/master/protocol/openid-connect/token",
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: process.env.KEYCLOAK_ADMIN_USER!,
      password: process.env.KEYCLOAK_ADMIN_PASSWORD!,
    }),
  },
);
if (!auth.ok) throw new Error("Could not configure local identity service.");
const token = (await auth.json()).access_token as string;
const headers = {
  authorization: "Bearer " + token,
  "Content-Type": "application/json",
};
const root = issuer.origin + "/admin" + issuer.pathname;
const themed = await fetch(root, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    loginTheme: "freightnaut",
    displayName: "Freightnaut Docs",
  }),
});
if (!themed.ok) throw new Error("Could not apply the local sign-in theme.");
const response = await fetch(root + "/users/profile", { headers });
if (!response.ok)
  throw new Error("Could not read the local registration profile.");
const profile = await response.json();
profile.attributes = profile.attributes.filter(
  (attribute: { name: string }) =>
    !["firstName", "lastName"].includes(attribute.name),
);
const updated = await fetch(root + "/users/profile", {
  method: "PUT",
  headers,
  body: JSON.stringify(profile),
});
if (!updated.ok)
  throw new Error("Could not simplify the local registration form.");
console.log(
  "Local signup now asks only for email and password. Email verification is disabled only in this local development realm.",
);
