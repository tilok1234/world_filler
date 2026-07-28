# Headless consumption proof for worldfiller content packs (pack format 1).
#
# Run:
#   godot --headless --script verify_content_pack.gd -- <world-pack-dir> <content-pack-dir>
#
# Mirrors src/consume/verifyPack.ts check-for-check from nothing but the
# two packs on disk: format gate, exact files table + payload hashes,
# base identity pairing and dimensions, report.ok, closed enums (unknown
# values are errors, never defaults), dungeon anchor existence, territory
# run bounds and cellCount, manifest identity/count self-consistency, and
# every placement/territory cell checked against the world pack's
# reference walkability bitgrid (base64, row-major, LSB-first,
# walkable = 1). Exit 0 on success, 1 on any refusal — malformed input
# is a named refusal, never a script crash. This is the reference for
# the future worldfiller_importer addon; see docs/CONTENT_PACK_FORMAT.md.
extends SceneTree

const PAYLOAD_FILES: Array[String] = ["content-plan.json", "placements.json", "report.json", "territories.json"]
const PLACEMENT_RULES: Array[String] = ["world_boss.v1", "dungeon_binding.v1"]
const RESPAWN_PRESSURES: Array[String] = ["low", "medium", "high"]

var failed := false


func _fail(message: String) -> void:
	failed = true
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


func _read_dict(dir: String, name: String) -> Dictionary:
	var parsed: Variant = _read_json(dir, name)
	if failed:
		return {}
	if typeof(parsed) != TYPE_DICTIONARY:
		_fail(name + " is not a JSON object")
		return {}
	return parsed


func _sha256(dir: String, name: String) -> String:
	var bytes := FileAccess.get_file_as_bytes(dir.path_join(name))
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


# JSON numbers parse as floats; a format gate must not coerce "1" or 1.9
# into 1. Exact integral match only.
func _is_exact_int(value: Variant, expected: int) -> bool:
	if typeof(value) == TYPE_FLOAT:
		return value == float(expected) and value == floor(value)
	if typeof(value) == TYPE_INT:
		return value == expected
	return false


func _cell_pair(value: Variant) -> Array:
	if typeof(value) != TYPE_ARRAY:
		return []
	var arr: Array = value
	if arr.size() != 2 or typeof(arr[0]) not in [TYPE_FLOAT, TYPE_INT] or typeof(arr[1]) not in [TYPE_FLOAT, TYPE_INT]:
		return []
	return [int(arr[0]), int(arr[1])]


func _identity_agrees(manifest: Dictionary, name: String, doc: Dictionary, check_seed: bool) -> bool:
	var mismatches: Array[String] = []
	if doc.get("directorRecipeSha256") != manifest.get("directorRecipeSha256"):
		mismatches.append("directorRecipeSha256")
	if doc.get("directorBehaviorVersion") != manifest.get("directorBehaviorVersion"):
		mismatches.append("directorBehaviorVersion")
	if JSON.stringify(doc.get("rulePacks"), "", true) != JSON.stringify(manifest.get("rulePacks"), "", true):
		mismatches.append("rulePacks")
	if doc.get("analysisVersion") != manifest.get("analysisVersion"):
		mismatches.append("analysisVersion")
	if doc.get("recipeName") != manifest.get("recipeName"):
		mismatches.append("recipeName")
	if check_seed and doc.get("directorSeed") != manifest.get("directorSeed"):
		mismatches.append("directorSeed")
	var doc_base: Variant = doc.get("base")
	var manifest_base: Variant = manifest.get("base")
	if typeof(doc_base) != TYPE_DICTIONARY or typeof(manifest_base) != TYPE_DICTIONARY \
			or doc_base.get("generationIdentitySha256") != manifest_base.get("generationIdentitySha256"):
		mismatches.append("base.generationIdentitySha256")
	if mismatches.size() > 0:
		_fail(name + " identity disagrees with manifest.json on " + ", ".join(mismatches))
		return false
	return true


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		_fail("usage: -- <world-pack-dir> <content-pack-dir>")
		return
	var world_dir: String = args[0]
	var content_dir: String = args[1]

	var manifest := _read_dict(content_dir, "manifest.json")
	if failed:
		return
	if manifest.get("pack") != "worldfiller-content-pack" or not _is_exact_int(manifest.get("packFormat"), 1):
		_fail("not a worldfiller content pack (format 1)")
		return

	# The files table MUST list exactly the four payload files; payload
	# bytes are hash-verified before anything trusts their content.
	var files: Variant = manifest.get("files")
	if typeof(files) != TYPE_DICTIONARY:
		_fail("manifest.files table is missing")
		return
	var listed: Array = files.keys()
	listed.sort()
	if listed != PAYLOAD_FILES:
		_fail("manifest.files must list exactly " + ", ".join(PAYLOAD_FILES))
		return
	for file_name: String in PAYLOAD_FILES:
		if not FileAccess.file_exists(content_dir.path_join(file_name)):
			_fail("payload file " + file_name + " is missing")
			return
		if _sha256(content_dir, file_name) != files[file_name]:
			_fail("payload hash mismatch for " + file_name)
			return

	# Base identity pairing plus format/dimension cross-checks against
	# the world pack (world manifest AND world.json agree with base).
	var world_manifest := _read_dict(world_dir, "manifest.json")
	if failed:
		return
	var base: Variant = manifest.get("base")
	if typeof(base) != TYPE_DICTIONARY:
		_fail("manifest.base is missing")
		return
	var generator: Variant = world_manifest.get("generator")
	if typeof(generator) != TYPE_DICTIONARY \
			or base.get("generationIdentitySha256") != generator.get("generationIdentitySha256"):
		_fail("content pack directed against a different world (generation identity mismatch)")
		return
	if base.get("artifactSha256") != world_manifest.get("baseArtifactSha256"):
		_fail("content pack base artifact hash does not match the world pack")
		return
	var world_dimensions: Variant = world_manifest.get("dimensions")
	if typeof(world_dimensions) != TYPE_DICTIONARY \
			or base.get("artifactFormat") != world_manifest.get("artifactFormat") \
			or base.get("width") != world_dimensions.get("width") \
			or base.get("height") != world_dimensions.get("height"):
		_fail("manifest.base format/dimensions disagree with the world pack")
		return

	var walkability := _read_dict(world_dir, "walkability.json")
	if failed:
		return
	if walkability.get("encoding") != "base64-bitpacked-row-major-lsb-first":
		_fail("unsupported walkability encoding " + str(walkability.get("encoding")))
		return
	var width := int(walkability.get("width", 0))
	var height := int(walkability.get("height", 0))
	if width <= 0 or height <= 0 or float(width) != float(base.get("width")) or float(height) != float(base.get("height")):
		_fail("walkability.json dimensions disagree with the content pack base")
		return
	var grid := Marshalls.base64_to_raw(str(walkability.get("grid", "")))
	@warning_ignore("integer_division")
	var expected_bytes := (width * height + 7) / 8
	if grid.size() != expected_bytes:
		_fail("walkability grid is %d bytes; %dx%d needs %d" % [grid.size(), width, height, expected_bytes])
		return

	# The audit that authorized this export: a pack without a passing
	# report is not a valid pack (importer obligation 4).
	var report := _read_dict(content_dir, "report.json")
	if failed:
		return
	if not _is_exact_int(report.get("reportFormat"), 1):
		_fail("report.json reportFormat is not 1")
		return
	if report.get("ok") != true:
		_fail("report.json .ok is not true — this pack was not authorized by a passing audit")
		return

	var content_plan := _read_dict(content_dir, "content-plan.json")
	if failed:
		return
	if not _is_exact_int(content_plan.get("planFormat"), 1):
		_fail("content-plan.json planFormat is not 1")
		return

	# Anchor ground truth for dungeon bindings: the world's own POIs.
	var world := _read_dict(world_dir, "world.json")
	if failed:
		return
	var poi_cells := {}
	var pois: Variant = world.get("pois")
	if typeof(pois) != TYPE_ARRAY:
		_fail("world.json pois table is missing")
		return
	for poi: Variant in pois:
		if typeof(poi) == TYPE_DICTIONARY and typeof(poi.get("id")) in [TYPE_FLOAT, TYPE_INT]:
			poi_cells[int(poi["id"])] = _cell_pair(poi.get("cell"))

	var placements := _read_dict(content_dir, "placements.json")
	if failed:
		return
	if not _is_exact_int(placements.get("placementsFormat"), 1):
		_fail("placements.json placementsFormat is not 1")
		return
	if typeof(placements.get("placements")) != TYPE_ARRAY:
		_fail("placements.json placements[] is missing")
		return
	var placement_count := 0
	for placement: Variant in placements["placements"]:
		if typeof(placement) != TYPE_DICTIONARY:
			_fail("placements[] entry is not an object")
			return
		var id := str(placement.get("id", "(missing id)"))
		var rule: Variant = placement.get("rule")
		if rule not in PLACEMENT_RULES:
			_fail(id + " carries unknown rule " + str(rule) + " — unknown enum values are errors, never defaults")
			return
		var access := _cell_pair(placement.get("accessCell"))
		if access.is_empty():
			_fail(id + " accessCell is malformed")
			return
		if not _walkable(grid, width, height, access[0], access[1]):
			_fail(id + " access cell is not walkable")
			return
		if rule == "world_boss.v1":
			var origin := _cell_pair(placement.get("arenaOrigin"))
			var side_raw: Variant = placement.get("arenaSide")
			if origin.is_empty() or typeof(side_raw) not in [TYPE_FLOAT, TYPE_INT]:
				_fail(id + " carries no arena")
				return
			var side := int(side_raw)
			for y in range(origin[1], origin[1] + side):
				for x in range(origin[0], origin[0] + side):
					if not _walkable(grid, width, height, x, y):
						_fail(id + " arena cell is not walkable")
						return
		if rule == "dungeon_binding.v1":
			var anchor_raw: Variant = placement.get("anchorPoiId")
			if typeof(anchor_raw) not in [TYPE_FLOAT, TYPE_INT]:
				_fail(id + " carries no anchorPoiId")
				return
			var anchor_id := int(anchor_raw)
			if not poi_cells.has(anchor_id):
				_fail(id + " binds anchor poi #%d which does not exist in the world pack" % anchor_id)
				return
			var cell := _cell_pair(placement.get("cell"))
			var poi_cell: Array = poi_cells[anchor_id]
			if cell.is_empty() or poi_cell.is_empty() or cell[0] != poi_cell[0] or cell[1] != poi_cell[1]:
				_fail(id + " anchor poi #%d moved" % anchor_id)
				return
		placement_count += 1

	var territories := _read_dict(content_dir, "territories.json")
	if failed:
		return
	if not _is_exact_int(territories.get("territoriesFormat"), 1):
		_fail("territories.json territoriesFormat is not 1")
		return
	if typeof(territories.get("territories")) != TYPE_ARRAY:
		_fail("territories.json territories[] is missing")
		return
	var territory_cells := 0
	for territory: Variant in territories["territories"]:
		if typeof(territory) != TYPE_DICTIONARY:
			_fail("territories[] entry is not an object")
			return
		var tid := str(territory.get("id", "(missing id)"))
		var cells: Variant = territory.get("cells")
		if typeof(cells) != TYPE_DICTIONARY or cells.get("encoding") != "runs":
			_fail(tid + " cells.encoding is not \"runs\" — unknown enum values are errors")
			return
		if territory.get("respawnPressure") not in RESPAWN_PRESSURES:
			_fail(tid + " respawnPressure is not low|medium|high")
			return
		var runs: Variant = cells.get("runs")
		if typeof(runs) != TYPE_ARRAY:
			_fail(tid + " cells.runs is missing")
			return
		var seen := {}
		for run: Variant in runs:
			if typeof(run) != TYPE_ARRAY or (run as Array).size() != 3:
				_fail(tid + " has a malformed run")
				return
			var x := int(run[0])
			var y := int(run[1])
			var length := int(run[2])
			if x < 0 or y < 0 or length < 1 or x + length > width:
				_fail(tid + " run [%d, %d, %d] is invalid at width %d — runs never cross rows" % [x, y, length, width])
				return
			for i in range(length):
				if not _walkable(grid, width, height, x + i, y):
					_fail(tid + " territory cell is not walkable")
					return
				seen[y * width + x + i] = true
		if not _is_exact_int(territory.get("cellCount"), seen.size()):
			_fail(tid + " cellCount %s does not match its runs (%d)" % [str(territory.get("cellCount")), seen.size()])
			return
		territory_cells += seen.size()

	# Manifest self-consistency: the manifest is the one unhashed file, so
	# its duplicated identity fields and counts must agree with the
	# hashed payload documents.
	if not _identity_agrees(manifest, "content-plan.json", content_plan, true):
		return
	if not _identity_agrees(manifest, "placements.json", placements, true):
		return
	if not _identity_agrees(manifest, "territories.json", territories, true):
		return
	if not _identity_agrees(manifest, "report.json", report, false):
		return
	var counts: Variant = manifest.get("counts")
	if typeof(counts) != TYPE_DICTIONARY \
			or not _is_exact_int(counts.get("placements"), placement_count) \
			or not _is_exact_int(counts.get("territories"), (territories["territories"] as Array).size()) \
			or typeof(placements.get("failures")) != TYPE_ARRAY \
			or not _is_exact_int(counts.get("placementFailures"), (placements["failures"] as Array).size()) \
			or typeof(territories.get("failures")) != TYPE_ARRAY \
			or not _is_exact_int(counts.get("territoryFailures"), (territories["failures"] as Array).size()) \
			or typeof(placements.get("unboundAnchors")) != TYPE_ARRAY \
			or not _is_exact_int(counts.get("unboundAnchors"), (placements["unboundAnchors"] as Array).size()):
		_fail("manifest.counts disagree with the payload documents")
		return

	print("verify-content-pack: OK — %d placements, %d territory cells against %dx%d reference walkability" % [
		placement_count, territory_cells, width, height,
	])
	quit(0)


func _walkable(grid: PackedByteArray, width: int, height: int, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	var index := y * width + x
	return (grid[index >> 3] >> (index & 7)) & 1 == 1
