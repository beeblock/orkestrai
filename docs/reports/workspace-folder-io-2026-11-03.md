# Workspace folder I/O availability

The owner reproduced Windows Core unavailability after selecting the large game directory even with Code Intelligence disabled on 0.49.1. That is evidence against assigning the entire incident to graph indexing. Current source inspection found synchronous project-directory validation, root canonicalization and AGENTS.md/CLAUDE.md synchronization in WorkspaceService's create/update path.

## Correction

- Directory/root checks, canonicalization, instruction reads and writes are asynchronous and awaited before completing create/update. Additional roots are all validated before persistence.
- Read instruction text through a bounded regular-file reader. It rejects links, special files, binary NUL content, files over 1 MiB and changed file identities; partial filesystem reads are completed without dropping content. Nonblocking/no-follow open flags are used where supported.
- Missing files remain distinguishable from unreadable/unsupported files. Unsupported files are preserved rather than replaced with empty defaults. Both instruction targets are read before either is written.
- Bridge instruction merging uses the same reader. No provider login or credential configuration is changed by this correction.
- A skipped instruction synchronization logs a bounded workspace identifier without the file content. Failed writes retain their existing semantics; this is not a new atomic transaction across two files.

## Verification

- The workspace create/folder-change regression fails against the original synchronous WorkspaceService and passes with the correction. It checks actual project-file I/O calls, preserved owner rules and unchanged disabled graph mode.
- A delayed instruction read leaves the event loop and creation of another workspace available; the original operation completes after the delay is released.
- Real-file tests cover short UTF-8 reads, missing/oversized/special/linked/binary files and replacement between inspection and opening. FIFO/link tests run on POSIX; a real Windows run remains necessary.
- Focused reader, workspace availability and existing provisioning suites: 16 passed.

This removes a confirmed blocking design pattern. It does not establish that these particular files caused the owner's Windows stall, nor does it remove the 59.9 GB of old Floors remotely. The published 0.51.1 does not contain this follow-up.
