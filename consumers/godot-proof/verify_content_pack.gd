# Headless consumption proof for worldfiller content packs (pack format 1).
#
# Run:
#   godot --headless --script verify_content_pack.gd -- <world-pack-dir> <content-pack-dir>
#
# Mirrors src/consume/verifyPack.ts from nothing but the two packs:
# identity pairing, payload hashes, and every placement/territory cell
# checked against the world pack's reference walkability bitgrid
# (base64, row-major, LSB-first, walkable = 1). Exit 0 on success,
# 1 on any refusal. This is the reference for the future
# worldfiller_importer addon; see docs/CONTENT_PACK_FORMAT.md.
extends SceneTree


func _fail(message: String) -> void:
	push_error("verify-content-pack: " + message)
	quit(1)


func _read_json(dir: String, name: String) -> Variant:
	var path := dir.path_join(name)
	if not FileAccess.file_exists(path):
		_fail("missing file " + path)
		return null
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		_fail(name + " is not valid JSON")
	return parsed


func _sha256(dir: String, name: String) -> String:
	var bytes := FileAccess.get_file_as_bytes(dir.path_join(name))
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		_fail("usage: -- <world-pack-dir> <content-pack-dir>")
		return
	var world_dir: String = args[0]
	var content_dir: String = args[1]

	var manifest: Dictionary = _read_json(content_dir, "manifest.json")
	if manifest.get("pack") != "worldfiller-content-pack" or int(manifest.get("packFormat", -1)) != 1:
		_fail("not a worldfiller content pack (format 1)")
		return
	for file_name: String in manifest["files"]:
		if _sha256(content_dir, file_name) != manifest["files"][file_name]:
			_fail("payload hash mismatch for " + file_name)
			return

	var world_manifest: Dictionary = _read_json(world_dir, "manifest.json")
	var base: Dictionary = manifest["base"]
	if base["generationIdentitySha256"] != world_manifest["generator"]["generationIdentitySha256"]:
		_fail("content pack directed against a different world (generation identity mismatch)")
		return
	if base["artifactSha256"] != world_manifest["baseArtifactSha256"]:
		_fail("content pack base artifact hash does not match the world pack")
		return

	var walkability: Dictionary = _read_json(world_dir, "walkability.json")
	var width := int(walkability["width"])
	var height := int(walkability["height"])
	var grid := Marshalls.base64_to_raw(walkability["grid"])

	var placements: Dictionary = _read_json(content_dir, "placements.json")
	var placement_count := 0
	for placement: Dictionary in placements["placements"]:
		var access: Array = placement["accessCell"]
		if not _walkable(grid, width, height, int(access[0]), int(access[1])):
			_fail(str(placement["id"]) + " access cell is not walkable")
			return
		if placement["rule"] == "world_boss.v1":
			var origin: Array = placement["arenaOrigin"]
			var side := int(placement["arenaSide"])
			for y in range(int(origin[1]), int(origin[1]) + side):
				for x in range(int(origin[0]), int(origin[0]) + side):
					if not _walkable(grid, width, height, x, y):
						_fail(str(placement["id"]) + " arena cell is not walkable")
						return
		placement_count += 1

	var territories: Dictionary = _read_json(content_dir, "territories.json")
	var territory_cells := 0
	for territory: Dictionary in territories["territories"]:
		for run: Array in territory["cells"]["runs"]:
			for i in range(int(run[2])):
				if not _walkable(grid, width, height, int(run[0]) + i, int(run[1])):
					_fail(str(territory["id"]) + " territory cell is not walkable")
					return
				territory_cells += 1

	print("verify-content-pack: OK — %d placements, %d territory cells against %dx%d reference walkability" % [
		placement_count, territory_cells, width, height,
	])
	quit(0)


func _walkable(grid: PackedByteArray, width: int, height: int, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	var index := y * width + x
	return (grid[index >> 3] >> (index & 7)) & 1 == 1
