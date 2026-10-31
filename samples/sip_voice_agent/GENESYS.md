# Connect Genesys Cloud through SIP

This guide covers a Genesys Cloud SIP trunk connected to the sample's generated
SIP address. Other Genesys products have different administration interfaces.
The Agent and Python commands are the same as for another SIP PBX; Genesys owns
its call flow, queue routing, and the trunk settings. This is a configuration guide,
not evidence of an interoperability test against your Genesys organization.

## 1. Prepare the Azure side

Follow the [sample README](README.md) to create the Agent, a same-project
`SipInbound` connection, authorized transfer targets, and a SIP binding. Save the
returned `incoming_call_url` unchanged. The URI is a destination, not an account
to register. No local media server, Genesys SDK, or Genesys API token is needed
for this SIP-only path.

For digest authentication, put the Connection's username/password in the Genesys
trunk's outbound Digest Authentication settings. For IP ACL, configure the actual
signaling egress CIDRs of your Genesys deployment or intervening SBC in the Azure
Connection. The caller-number filter uses the caller identity arriving at the
gateway; verify whether Genesys preserves the original caller or presents another
identity. Caller filtering and SIP authentication are separate.

## 2. Configure the Genesys trunk and route

In Genesys Cloud, configure a suitable BYOC external trunk and its site's number
plan/outbound route so the generated destination selects that trunk. Set SIP
transport to TLS, use the generated host and port, and meet the gateway's
certificate/trust requirements. Match the gateway's media encryption and codecs;
internal 24 kHz PCM does not force the external SIP codec. Use the supported
network/media ranges for your Genesys deployment, SBC, and Azure gateway.

In Architect, use **Transfer to Number** with the exact returned SIP URI as the
destination. Preserve its routing user, hostname, port, and URI parameters through
number-plan normalization or Request URI Override. Verify the resulting INVITE
Request-URI rather than manually constructing an Agent address.

Genesys documents SIP-address destinations in
[Set up a Transfer to Number action](https://help.genesys.cloud/articles/transfer-external-number-2/).
See [External trunk settings](https://help.genesys.cloud/articles/external-trunk-settings/)
and [Test destination phone numbers with the call simulator](https://help.genesys.cloud/articles/test-destination-phone-numbers-with-the-call-simulator/)
for the trunk and route configuration. A carrier/SBC may impose additional restrictions.

## 3. Keep the intended transfer topology

For an original Genesys call delegated to the external Voice Agent, the desired
flow is:

```text
Caller -- Genesys -- SIP Proxy / MG -- Voice Agent
             ^            |
             +-- REFER ---+   Refer-To identifies the configured destination
```

On the Genesys trunk receiving the MG's REFER, enable **Take Back and Transfer**
(inbound REFER), if this topology and trunk support it. This differs from
**Release Link Transfer** (outbound REFER), which lets Genesys release its own
resources when it transfers an external party. Keep Genesys in the path when
you need it to receive a later transfer request. Do not enable release-link
behavior indiscriminately on the initial delegation.

See the two distinct settings in
[Genesys external trunk documentation](https://help.genesys.cloud/articles/external-trunk-settings/#take-back-and-transfer).
The actual REFER peer can be an SBC or carrier rather than Genesys itself; that
peer must preserve or implement the required behavior too.

The current SIP provider's configured target is an E.164 phone number. To return
to Genesys, use an authorized number routed to the intended Genesys flow/queue;
prevent that flow from immediately sending the caller back to the Voice Agent.
This sample does not accept a Genesys queue UUID, extension, or arbitrary queue SIP
URI as a native queue-transfer command. Direct queue API routing is a separate integration.

## 4. Verify call behavior

Use separate calls for these checks:

- Speak and receive an audible relevant reply; test interruptions and two-way media.
- Ask for a human. Check the generated REFER target, subscription result, and
  actual connected destination. An accepted REFER alone does not establish that
  a person answered. Confirm the original call survives a rejected/busy transfer.
- Ask to end the call. Verify the farewell and SIP BYE, then ensure the original
  caller's Genesys flow disconnects or resumes exactly as intended. A BYE ends a
  SIP leg; Genesys decides what happens to other participants and flow execution.
- Confirm routing does not loop and that Agent, Vienna call, MG call, and Genesys
  conversation identifiers can be correlated for diagnosis.

## What differs from another SIP platform?

| Area | Shared SIP/sample behavior | Genesys configuration |
|---|---|---|
| Audio | Generated SIP URI, TLS, negotiated media | BYOC trunk, site route, Architect flow, codec/SRTP settings |
| Transfer | Existing MG/provider operation and configured target | Inbound REFER policy and the route from the target number to the correct queue |
| End call | Voice ending followed by provider hangup | Behavior of the Genesys flow after the external SIP leg ends |
| Context | No automatic summary or reason delivery | Agree an API/UUI/header contract and how the receiving queue/desktop consumes it |

The transfer system tool's `reason` is model context; this implementation does not forward it
or a handoff summary to Genesys. Genesys supports
[User to User Information](https://help.genesys.cloud/articles/about-user-to-user-information-uui/),
but this sample does not populate UUI. Delivering summaries, caller context, or
completed actions through an authenticated Genesys API/MCP tool is separate work,
including its own token acquisition and renewal.

[Audio Connector](https://help.genesys.cloud/articles/audio-connector-overview/)
uses the AudioHook WebSocket protocol. It is a different integration path and is
not configured by this SIP sample. SIP transport authentication is also separate
from OAuth authentication for external MCP tools.
