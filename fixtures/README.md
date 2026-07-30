# Fixture worlds

Committed game packs, generated once from WorldForge and frozen with recorded
provenance (`provenance/<name>.json`). World Filler builds and tests against
these on a clean clone with **no WorldForge checkout present** — that is the
isolation contract.

| Pack | Size | World | Why committed |
|---|---|---|---|
| `packs/fen-hollow` | 64² tiny | swamp hollow | swamp/stream/pier/trail rungs |
| `packs/dust-hollow` | 64² tiny | dry hollow | dry biomes, street fords, trails |
| `packs/tiny-temperate` | 64² tiny | upstream canonical tiny | fences, mixed rungs |

`expected-coverage.json` pins the exact per-rung cell counts of every
committed pack. If a regenerated pack changes those counts, upstream behavior
moved — review the change and re-record deliberately; never absorb it
silently.

## Documented coverage gaps

- `crossing_route_walk` (recorded bridge/ford crossing cells) does not
  occur in any committed tiny world — their water is crossed by street
  fords instead. Covered by synthetic unit tests in
  `tests/ladder.test.ts` and by the local packs below (canonical 8
  cells, dusk overworld 3).
- `structure_stamp_block` (the WYSIWYG art-outline stamp sealing a
  footprint cell the ladder would walk) fires in no shipped world so
  far — every stamped cell also carries a painted structure tile, which
  the ladder blocks first. Covered by synthetic unit tests in
  `tests/ladder.test.ts`; it exists to mirror upstream pack semantics
  exactly.

## Local full-scale check (optional, not required by CI)

The canonical 256² world `small-cold-coastal` (~31 MB as a pack) is not
committed. Since the behavior-72 adoption (sl-0039) it is IMPORTED from
the WorldForge release, verified against the release digests:

```sh
gh release download "small-cold-coastal-pack-dusk@b65" --repo tilok1234/WorldForge --pattern "*.zip"
# verify the zip sha256 against the release notes' zipSha256, then unzip:
mkdir -p outputs/local-packs
cp -r <unzipped>/small-cold-coastal-pack-dusk outputs/local-packs/small-cold-coastal
npm test          # the parity suite picks up outputs/local-packs/* automatically
```

Verified 2026-07-30 (release `small-cold-coastal-pack-dusk@b65`,
sourceCommit `4497729`): 65,536 cells bit-identical, flood 34641 from
spawn (240, 125), 626 moss-carpet cells walking (matching the upstream
moss ruling's recorded canonical count) and 8 recorded route-crossing
cells. The dusk overworld (`wildshot-overworld-pack-dusk@b72`) imports
the same way. Fallback if an import ever fails parity: regenerate from
the release's sourceCommit in a scratch copy (below) and record why.

## Regenerating the committed fixtures

Only as an explicit, logged decision (upstream behavior bump adoption):
extract the target commit read-only (`git -C <WorldForge> archive
<commit> | tar -x -C <scratch>`), `npm install && npm run build` there,
re-run `export-game-pack fixtures/recipes/<name>.json --out <dir>
--allow-dirty` for each recipe above (the flag bypasses the publish
gate in the git-less scratch and skips the release upload), replace
`packs/<name>`, update `provenance/<name>.json` (new commit/identity),
re-record `expected-coverage.json`, and note the adoption in the commit
message. Current fixtures: WorldForge behavior 72, commit `bbc10cdb`
(adopted 2026-07-30, sl-0039).
