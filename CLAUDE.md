@AGENTS.md

Main spec: `SPEC.md` (read section 1 rules first). Current progress: `STATUS.md`. Architecture decisions: `docs/DECISIONS.md`.

User guide: `docs/USER-GUIDE.md` is what the in-app AI help answers from. Any change that people would notice (a button, a rule, a flow, a menu, a bot command) updates the guide in the same PR, in plain Russian, as the app is after the change. `modules/ai/help.test.ts` fails when a menu section has no part in the guide.
