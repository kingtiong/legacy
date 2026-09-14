# Security policy

Legacy Ladder is designed to hold funds for ten years with no early exit, so vulnerabilities matter more here
than almost anywhere. Thank you for looking.

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security problem.**

Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include what an
attacker could do, the affected contract and function, and a proof of concept if you have one.

We will acknowledge a report within 72 hours. A funded bug bounty will be announced before any mainnet
deployment.

## Scope

- Smart contracts in `contracts/src`
- Deployment scripts in `contracts/script`
- The website only where it could mislead a user into signing something harmful

## Status

Pre-launch. No contract is deployed to mainnet and none has been audited yet. See
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
