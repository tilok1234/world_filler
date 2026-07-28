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

## Documented coverage gap

`crossing_route_walk` (recorded bridge/ford crossing cells) does not occur in
any committed tiny world — their water is crossed by street fords instead.
The rung is covered by:

- synthetic unit tests in `tests/ladder.test.ts` (fixture-independent), and
- the local canonical world check below (8 recorded crossing cells).

## Local full-scale check (optional, not required by CI)

The canonical 256² world `small-cold-coastal` (~31 MB as a pack) is not
committed. With a WorldForge checkout available, regenerate and verify it
locally:

```sh
# in the WorldForge checkout (or a scratch copy):
npm install && npm run build
node --max-old-space-size=8192 dist/src/cli.js export-game-pack \
  fixtures/recipes/small-cold-coastal.json --out <somewhere>/small-cold-coastal-pack

# in this repository:
mkdir -p outputs/local-packs
cp -r <somewhere>/small-cold-coastal-pack outputs/local-packs/small-cold-coastal
npm test          # the parity suite picks up outputs/local-packs/* automatically
```

Verified at F0 (WorldForge commit `bb7832f`, behavior 47): 65,536 cells
bit-identical, flood 33893 from spawn (240, 125), all 15 ladder rungs
exercised including 8 recorded route-crossing cells.

## Regenerating the committed fixtures

Only as an explicit, logged decision (upstream behavior bump adoption):
re-run `export-game-pack` for each recipe above, replace `packs/<name>`,
update `provenance/<name>.json` (new commit/identity), re-record
`expected-coverage.json`, and note the adoption in the commit message.
