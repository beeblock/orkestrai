# Bot sidebar layout

The installed beta.11 reproduced a 1,259 px scroll width inside a 273 px sidebar with a long account name. An intrinsic-width account selector expanded its parent grid; long group IDs and form rows needed their own width limits as well.

The layout now bounds the grid and selector, truncates the selected account name while keeping its complete option available, wraps group IDs and lets narrow action rows wrap. It does not hide an overflowing page behind an x-axis clip.

The sidebar starts with Work sequence and Routines shortcuts, followed by all connected channels. Instructions, execution/limits, security, recent activity and memory are separate keyboard-accessible accordion sections. Workflow opens its editor directly; Routines reveals and focuses the existing routine controls. Reused render snippets preserve one copy of the shared channel state and requests. The ordinary Conversation profile keeps its existing layout.

Production-browser coverage uses long unbroken account names, long group IDs and instructions, expanded controls, 320–1440 px windows, both themes and all three locales. It verifies scroll width, control bounds, full-name access and the shortcuts. Existing bot/channel and Conversation scenarios are checked separately. Source compilation and localized catalogs are checked before the build. Final runtime evidence is retained in the isolated QA directory after verification.
