Drop your WorldForge worlds here.

Each world is a folder exported by WorldForge ("export-game-pack") that
contains manifest.json, world.json, walkability.json, and
validation-report.json. Copy the whole folder into this directory, e.g.

  worlds\
    my-big-world\
      manifest.json
      world.json
      walkability.json
      validation-report.json

Then double-click START-HERE.bat: every world in here gets a content
pack generated under outputs\export\<name>-content, each with its own
view.html map you can double-click.

By default every world is directed with the example recipe. To give a
world its own recipe, put a file with the world's folder name in the
recipes\ directory (recipes\my-big-world.json) — see recipes\README.txt.

To REgenerate a world's content (after changing its recipe or replacing
the world), delete outputs\export\<name>-content and run START-HERE.bat
again. Generation is deterministic: same world + same recipe = the
exact same content, every time.
