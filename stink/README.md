# stink/

The stink world, held at arm's length.

Everything under here translates some technical contrivance — git, Linear,
GitHub — into a shape Iksīr's constitution already had a word for. Iksīr
does not reach into these. They reach up and comply.

## The rule

**Nothing in `stink/` may be imported by `src/daemon/`, `src/kimiya/`, or
`src/alat/`.** Core speaks kimiya and nothing else. An adapter may import
core's *interfaces* — `src/hayula/`, `src/types.ts` — and nothing more.

A test enforces this. If it fails, the stink got in.

## Why it is shaped this way

This directory is meant to leave. When it does, it becomes `stink-to-iksir`,
its own project with its own life, and Iksīr will not notice — because the
seam is an interface Iksīr owns and the adapters conform to.

So each adapter is written as if it already lived elsewhere: no reaching
into daemon internals, no shared mutable state, no assumption that it runs
in the same process. Today several of them do. That is a deployment detail,
not a design one.

## What lives here

| adapter | translates | into |
|---|---|---|
| `hayula-git/` | git | `Hayula` — prime matter |

## What is still to come in

The tracker adapter (`hives/wasfa/`) and the GitHub half of Munaffidh are
not here yet. Both belong here. The tracker organ already holds its own key
and speaks over the thrum, so its move is mechanical; the GitHub half is
tangled with the concept of a risāla, which is itself under question.
