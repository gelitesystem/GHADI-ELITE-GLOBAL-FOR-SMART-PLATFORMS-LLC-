# Ghadi Security Decisions

## Current gate

No production security deployment is approved in this document.

## Non-negotiable controls

1. Firebase Authentication identifies each actor.
2. Project membership governs every run, attachment, artifact, approval, and event.
3. Firestore and Storage deny by default.
4. Secrets stay in Secret Manager; no secret appears in public files, Git, logs, or client code.
5. External effect waits for a stored approval owned by the same project.

## Deferred decisions

The Auth provider, retention period, malware scanner, App Check provider, and CMEK requirement require owner decisions and emulator evidence before deployment.
