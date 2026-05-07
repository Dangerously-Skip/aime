# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please report it
**privately** by emailing **infosec@nib.com.au** or by raising a [Cloud Services
ticket](https://nibgroup.atlassian.net/servicedesk/customer/portal/11). Do not
file public issues or pull requests for security findings.

## Standards

This repository follows the
[nib Group Application Security Verification Standard](https://github.com/redacted-org/redacted-org-standards/tree/master/.backstage/docs/asvs)
which is aligned with OWASP ASVS and CPS234.

Coverage areas include:

- Architecture, threat modelling, and secure design
- Authentication, session management, and access control
- Validation, sanitisation, and encoding
- Cryptography
- Error handling and [logging](https://github.com/redacted-org/redacted-org-standards/blob/master/.backstage/docs/documentation/logging.md)
- Data protection and PII handling
- Communications security
- Malicious-code defences
- Business-logic, file/resource, API/web-services, and configuration controls

## Supply-chain checks

Pull requests run automated security gates (Nullify code, containers,
dependencies, secrets) before merge. Findings must be acknowledged or
remediated in line with the team's policy.

## Owner

The repository is owned by the **@redacted-org/redacted-team** team.
Vulnerability reports are triaged by the team's CODEOWNERS.
