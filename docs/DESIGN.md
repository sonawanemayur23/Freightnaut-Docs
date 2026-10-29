# Workspace design conventions

Keep the operation clear: a shipment is the source of truth for its invoice and packing list. Use the navy and amber identity, quiet light surfaces, self-hosted DM Sans and a restrained type hierarchy. Tenant brand colors and names come from resolved settings, including parent locks. Never fill an empty workspace with invented business data.

Navigation groups daily shipment work and administrative tasks. Show actions only within the current actor’s permissions; the API remains the authority. Choose the first accessible customer account for daily work, with explicit partner consoles in the workspace selector. Preserve authorized workspace and selected shipment in the URL. Global search supports Cmd/Ctrl K, focus and Escape through the native dialog.

Shipment details autosave with optimistic concurrency, a visible saved/error state and a flush before navigation. Workspace settings save explicitly; leaving with unsaved configuration is blocked until it is saved or discarded. Configuration is grouped by company, regional/trade, documents, branding and custom fields; inheritance controls stay available within each field. Local registration goes directly to the identity provider’s registration page and retains its native security controls.

Use visible labels and focus rings. Keep loading, empty, no-results, error and read-only states deliberate. Dialogs use native focus containment and Escape. On small screens, the shipment goods table becomes labeled cards, document previews scale to available width, and navigation moves to the bottom. Respect reduced-motion preferences. Currency, country names, dates and time zones follow resolved workspace configuration.

Verification uses a disposable database and temporary identities. Browser coverage includes registration, session boundaries, persisted edits, immediate navigation, reload, responsive overflow, and reviewer restrictions. Screenshots are review evidence, not seeded production content. Further usability and accessibility review with real users remains part of release preparation.
