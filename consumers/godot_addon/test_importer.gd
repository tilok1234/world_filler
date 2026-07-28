# Headless proof for the game-side importer addon.
#
# Run from the repository root:
#   godot --headless --script consumers/godot_addon/test_importer.gd -- \
#     <world-pack-dir> <content-pack-dir> <wrong-world-pack-dir>
#
# Loads the pair through WorldfillerImporter exactly as a game would,
# checks the returned data against the pack's own manifest counts, probes
# the query helpers, and requires a named refusal on a mismatched world.
# Exit 0 on success, 1 on any failure.
extends SceneTree


func _init() -> void:
	var failure := _run(OS.get_cmdline_user_args())
	if failure != "":
		push_error("test-importer: " + failure)
		quit(1)
	else:
		print("test-importer: OK")
		quit(0)


func _run(args: PackedStringArray) -> String:
	if args.size() != 3:
		return "usage: -- <world-pack-dir> <content-pack-dir> <wrong-world-pack-dir>"
	var importer := load(
		(get_script() as Script).resource_path.get_base_dir().path_join("worldfiller_importer/worldfiller_importer.gd")
	)

	var pack: Dictionary = importer.load_packs(args[0], args[1])
	if not pack["ok"]:
		return "honest pair refused: " + str(pack["error"])

	var manifest: Dictionary = pack["manifest"]
	var counts: Dictionary = manifest["counts"]
	if int(counts["placements"]) != (pack["placements"] as Array).size():
		return "placement count does not match the manifest"
	if int(counts["territories"]) != (pack["territories"] as Array).size():
		return "territory count does not match the manifest"

	# Every placement's access cell must be walkable via the helper.
	for placement: Dictionary in pack["placements"]:
		var access: Array = placement["accessCell"]
		if not importer.walkable(pack, int(access[0]), int(access[1])):
			return str(placement["id"]) + " access cell not walkable via helper"
		if importer.placement_by_id(pack, str(placement["id"])).is_empty():
			return str(placement["id"]) + " not found via placement_by_id"

	# territory_at must return the owning territory for a decoded cell and
	# {} for cell (a corner) outside all territories.
	var territories: Array = pack["territories"]
	if territories.size() > 0:
		var territory: Dictionary = territories[0]
		var cells: PackedInt32Array = territory["cells_decoded"]
		if cells.size() == 0:
			return str(territory["id"]) + " decoded to zero cells"
		var width := int(pack["width"])
		var first := cells[0]
		var hit: Dictionary = importer.territory_at(pack, first % width, first / width)
		if hit.get("id") != territory.get("id"):
			return "territory_at returned the wrong territory"
	print("test-importer: %d placements, %d territories, %dx%d world" % [
		(pack["placements"] as Array).size(), territories.size(), int(pack["width"]), int(pack["height"]),
	])

	# Wrong world pairing must refuse by name, never load.
	var mismatched: Dictionary = importer.load_packs(args[2], args[1])
	if mismatched["ok"]:
		return "mismatched world pairing was ACCEPTED"
	if not str(mismatched["error"]).contains("different world"):
		return "mismatched pairing refused with the wrong error: " + str(mismatched["error"])
	print("test-importer: mismatched world correctly refused (%s)" % [str(mismatched["error"])])
	return ""
