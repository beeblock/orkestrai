# Computer Control

Computer Control operates the interactive desktop of the computer running
Orkestrai. It does not open a replacement browser profile or move desktop apps
into a Portal. The Computer node, Workbench, agent MCP and CLI share the same
workspace configuration, evidence and execution boundary.

## Start With A Request

Tell an existing agent, by typing, dictation or Remote:

> Open Calculator, calculate 73 times 19, verify the result on screen and record it.

The agent should perform this complete workflow:

1. Create a briefing note and an active Kanban task assigned to itself. Creating
   its own task does not inject a second prompt into its running turn.
2. Call `computer_prepare` with that task and a stable idempotency key. This
   creates or reuses the single Computer node and connects it to the agent.
3. Call `computer_inspect`. Check activation, permissions and exact app IDs.
4. Call `computer_launch` for the approved app. An existing window is focused
   first; otherwise its registered native application is opened without custom
   command-line arguments. Wait for its window, then inspect again.
5. Observe, act inside the exact allowed window, and capture again. For the
   example, the actual Calculator must show **1387**. A calculation performed
   only in the agent's reasoning or shell is not desktop-control validation.
6. Write the result and evidence path into the note, complete the task only
   after verification, and send a concise answer to the user.

The user authorizes access; the agent creates and executes its own workflow.
Agents cannot grant OS permissions or override a paused node.

## Authorize Once, Within A Boundary

The Computer node starts disabled unless its first agent-created preparation
can inherit an **already enabled Bounded** workspace policy that includes the
`computer` capability and exact `allowedApps`. A subsequent preparation never
changes an existing node's configuration. It cannot silently re-enable control.

In Computer, choose allowed applications and enable control. You can enter an
application ID before opening it. Closed authorized apps remain visible so you
can launch or revoke them. Under **Automations > Security**, set the standing
application boundary and risk gates for unattended work. Display grants are
separate; agents cannot capture or click the entire desktop.

On macOS, grant Orkestrai **Accessibility**, **Screen & System Audio Recording**
and **Automation** when requested by the operating system. The signed app and
helpers include microphone and Apple Events entitlements. Entitlements allow
the OS to request access; they do not grant consent on the user's behalf.

| Host | Launch identifier | Requirements |
| --- | --- | --- |
| macOS | `com.apple.calculator`, `com.google.Chrome` | Registered bundle ID; Accessibility and capture permissions |
| Windows | `CalculatorApp`, `chrome`, `msedge`, `notepad` | Interactive desktop; registered App Paths executable or supported system app |
| Linux | Registered `.desktop` ID or matching `WM_CLASS` | X11, `xdotool`, `wmctrl`, screenshot helper and `gio` for launch |

Inspect returns the actual identifiers of authorized open windows. An
unregistered launch target fails explicitly: there is no arbitrary executable,
shell command or argument fallback. Linux Wayland and protected secret typing
on Linux remain unsupported. Windows screenshots/input require an available
interactive desktop; this is not a headless service or lock-screen bypass.

## Remote And Existing Browser Sessions

Use the leader chat or Team agent conversation in Remote, for example:

> In the Chrome window already open on my desktop, inspect the email from Alice
> about the report. Summarize it and prepare a reply; do not send it yet.

Remote delivers the request to the existing **host** agent. The agent must
reuse that desktop window and account, not create a new Portal or profile.
The host must be awake with Core, provider access and the interactive session
available. Locked sessions, sleep and missing OS grants can block execution.
Remote chat is an instruction channel, not a live desktop video stream.

For a site already in an Orkestrai Portal, use that same Portal's typed tools.
Prefer Portal or Integration Center when structured actions and narrower
website/account grants are available. A native browser application grant is
broader than a per-site Portal grant.

## Commands, Retries And Gates

All agent commands require an authenticated live terminal identity, an active
task assigned to that agent and `idempotencyKey`. The workspace token alone
does not grant Computer access.

```json
{
  "tool": "computer_launch",
  "arguments": {
    "applicationId": "com.apple.calculator",
    "taskId": "<active-task-uuid>",
    "idempotencyKey": "calculator-task:launch:1"
  }
}
```

Equivalent CLI:

```sh
orkestrai computer prepare --task "$TASK_ID" --idempotency calculator-task:prepare
orkestrai computer inspect --json
orkestrai computer launch com.apple.calculator --task "$TASK_ID" --idempotency calculator-task:launch
```

`computer_focus`, `computer_type`, `computer_type_secret`,
`computer_shortcut`, `computer_screenshot` and `computer_click` use a window ID
from inspection. Agent clicks are normalized from 0 to 1 inside that window.
Treat window IDs as opaque. macOS binds them to the process and native
CoreGraphics window number, not a reorderable Accessibility list index.
Ambiguous matches fail closed. Window captures use that exact native ID and
report actual PNG pixel dimensions, including Retina resolution.
Input focus is checked again before delivery. Another workspace cannot issue
simultaneous native input through this executor. A busy response is retryable
with the same key; a possibly partial failure requires inspection before a
deliberate new action. Successful duplicate requests do not execute twice.

Before the action that sends mail or publishes, pass
`risk: "external_publication"` (CLI `--risk external_publication`). Use
`purchase`, `secret_export`, `bulk_destructive`, `account_permission` or another
matching risk for the corresponding action. The enforcing Security policy
must be enabled. Its configured gate executes **before** input, and approval
is bound to the content digest, actor and exact attempt. Retry a gated action
with the same key after approval; changing its input requires new approval.

Pixel-based control cannot automatically infer every business consequence of
a click or keystroke. Risk classification depends on the agent's declaration;
this is not proof that every unsafe action can be detected. An unrestricted
shell also remains outside this broker's hard enforcement boundary. The agent
instructions prohibit using shell automation to bypass a denial or gate.

For manual keyboard input, select an allowed window in the panel first. The
selection stays bound to that window while you type in Orkestrai; changing
the desktop's foreground app does not silently redirect the text. A closed
or revoked target disables input until you choose another allowed window.

## Credentials And Evidence

`computer_type_secret` accepts only a SecretRef explicitly bound to integration
`computer`, operation `computer.type_secret`, and the exact authorized app.
Its value travels through protected stdin on macOS/Windows, not process
arguments, and is not returned to the agent or persisted in the audit.
Native process output is suppressed during secret delivery, including errors
that might echo input. Linux refuses this operation rather than silently using
an insecure channel.

Screenshots live under `.orkestrai/computer/evidence` with bounded retention;
paths escaping the workspace through symlinks are rejected. The node refreshes
state and captures while visible. Saved screenshots are **read-only evidence**,
not a stale click map. Native captures can include visible private content:
unlike a structured Portal, an arbitrary desktop app does not expose reliable
password-field masking. Do not capture a visible raw credential.

Control Center and Security Audit expose brokered actor, operation, target,
outcome, request digest and evidence metadata, not typed content. Free-shell
effects are inferred separately and must not be confused with exact brokered
action records.
