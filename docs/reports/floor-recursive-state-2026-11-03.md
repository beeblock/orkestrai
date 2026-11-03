# Preventing internal-state copies in Floors

The owner found approximately 59.9 GB in the Windows game's `.orkestrai/floors`, with heavy game/build/generated content in the checkouts. We cannot inspect those remote files from this Mac. Directory size alone does not prove the complete Windows Core-stall mechanism.

## Reproduced defects

1. A clean HEAD containing tracked `.orkestrai` data was used unchanged as the next Floor base. Git ignore rules do not remove already tracked files. This reproduces nested internal state being copied into a new Floor.
2. The ignore repair accepted `current.includes('.orkestrai')`; a comment alone bypassed it. Untracked internal data then entered the working-tree snapshot.
3. Repair assumed `.git/info/exclude` under the selected directory. Linked checkouts have a `.git` file, so that write failed silently.
4. The old fixed 3 GiB guard did not account for total untracked snapshot bytes or the tracked checkout size.

## Correction

- Exclude only reserved runtime `.orkestrai/floors`, `.orkestrai/reviews`, the generated `.orkestrai/bin/orkestrai` and `.orkestrai/bin/orkestrai.cmd` launchers, `.orkestrai/workspace.json` and `.orkestrai/runtime.json` paths at every depth through Git pathspecs before enumerating untracked files or staging tracked changes. Remove previously tracked internal state only from the private snapshot index. The owner index, HEAD and source files are preserved.
- Use the recognized Unity root-cache policy for new snapshots. Preserve authored source and artwork; `game` and `generated` are not classified as disposable by name.
- Resolve the actual Git exclude path through Git and update exact ignore lines asynchronously. Keep snapshot exclusions mandatory even if convenience ignore repair fails.
- Inspect explicitly selected existing branches before checkout. If they contain internal app data, preserve the branch and files and return an actionable error. Creating a new Floor from the main checkout safely excludes that state.
- Reserve aggregate tracked-change and untracked snapshot space before staging blobs, including space for the planned checkout, and recheck tracked checkout bytes before materializing a worktree. These estimates are conservative, not promises about filesystem allocation or future build size.
- The UI, CLI and MCP share FloorService, so the same protections apply to owner-created and agent-created Floors. The new branch error is localized in all three UI languages.

## Verification

Three initial reproductions failed before the correction: tracked clean HEAD, an ignore-comment-only repository, and an unsafe existing branch. They now pass. Additional tests cover linked `.git` files, owner file/index preservation, authored generated artwork, Unity cache exclusion and both disk-budget failure paths before worktree creation.

Existing Floor suite before the last budget/Unity additions: 53 passed. All eight focused new guards pass, including a workspace subdirectory whose name contains pathspec metacharacters. Final full-suite/build results are recorded at handoff.

The owner correctly identified that blanket .orkestrai omission would also remove portable definitions from new snapshots. That unpublished draft was narrowed before packaging. Tracked roles, skills, native designs, approved references, custom bin scripts and unknown authored files are preserved. Only known runtime paths are mandatory exclusions. Generated Git ignores retain runtime/privacy defaults while exposing roles, skills, presets, designs and fallback skill references. Only identifiable app-generated blocks are migrated; independent owner ignores remain authoritative. Both new and existing branches with portable definitions are covered by real Git tests.

No existing owner worktrees, artifacts or Git objects were deleted, and no Windows cleanup was performed. Removing legacy accumulated Floors still requires integration and ownership evidence; deleting `.orkestrai` wholesale is unsafe.
