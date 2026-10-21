# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **API key**, or the **user name and password**, of an Umami account,
  stored by Gladys in the integration configuration (never written to
  `/data`, never logged); they are only sent to the address configured (or to
  `https://api.umami.is` for Umami Cloud), and redirects are not followed so
  they never reach another host;
- the **session token** Umami gives in exchange for the password: kept in
  memory only;
- `/data/umami-state.json`: what the scene triggers remember per website
  (spike under way, day of the first visitor, silent or not; no secret);
- network: HTTP(S) requests to Umami, nothing else; no port is opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Umami itself (Umami Cloud or the self-hosted server).
