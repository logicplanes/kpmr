# Security

Report a vulnerability in KPMR, or a catalogue that verifies with KPMR's key but wasn't published by kpmr.kaeso.app, privately through [a security advisory in the Kaeso repository](https://github.com/logicplanes/kaeso/security/advisories/new). Don't open an issue for it.

The public half of the catalogue signing key is in `/v1/keys.json` and built into Kaeso. If the key is ever replaced, a Kaeso release ships the new key before kpmr.kaeso.app signs with it.
