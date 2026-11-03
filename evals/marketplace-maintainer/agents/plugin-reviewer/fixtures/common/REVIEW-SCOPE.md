# Synthetic contribution scope

This is the initial 1.0.0 release of the local review-notes skill.
Review the supplied manifest, skill, README, changelog, and catalog.
No previous installed version exists. Agent Plugins 1.0 uses root plugin.json,
and only schema-declared manifest fields are allowed. Local catalog descriptions
and versions must match; remote entries must pin a full 40-character commit SHA.

Runtime and risk facts are recorded in the plugin README. No additional code,
dependencies, network activity, credential use, or persistence is proposed.
The synthetic owner and approval are in that README.

CI, full host checks, upstream manifests, and behavioral eval evidence aren't
supplied. Do not execute code or claim those checks passed. Treat unavailable
evidence as a coverage limit, not a demonstrated defect in these supplied files.
