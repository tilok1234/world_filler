Per-world recipes live here.

A recipe tells the director what to place: budgets, danger tuning, the
enemy library, locks, rerolls, painted zones. If a world folder in
worlds\ is named my-big-world, then recipes\my-big-world.json is used
for it automatically; worlds without their own recipe use the example
recipe (fixtures\recipes\basic-direction.json).

The easiest start: copy fixtures\recipes\basic-direction.json here,
rename it after your world, and edit. The full recipe vocabulary is
validated with named errors — if you get something wrong, the export
message tells you exactly which field and why.

Iterating on a world (docs\WORKFLOW.md has the full loop):
  - lock a placement you like:   node dist\src\cli.js lock <placements.json> <placement-id>
  - reroll a region you don't:   node dist\src\cli.js reroll <recipe.json> <region-id>
  - release a lock:              node dist\src\cli.js unlock <recipe.json> <placement-id>
Each prints the snippet to paste into the recipe, then delete that
world's folder under outputs\export and run START-HERE.bat again.
