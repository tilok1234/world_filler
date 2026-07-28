# Headless consumption proof for worldfiller content packs (pack format 1).
#
# Run:
#   godot --headless --script verify_content_pack.gd -- <world-pack-dir> <content-pack-dir>
#
# Mirrors src/consume/verifyPack.ts check-for-check from nothing but the
# two packs: manifest identity and format pins, the exact four-name files
# table hash-verified, report.json reportFormat 1 and ok true, base
# pairing (identity + world.json byte hash + format/dimensions), manifest
# self-consistency against the hashed payloads, closed format-1 enums,
# dungeon anchor existence, and every placement/territory cell checked
# against the world pack's reference walkability bitgrid (base64,
# row-major, LSB-first, walkable = 1). Every malformed input is a named
# refusal — never a script error. Exit 0 on success, 1 on any refusal.
# This is the reference for the future worldfiller_importer addon; see
# docs/CONTENT_PACK_FORMAT.md.
extends SceneTree

const REQUIRED_FILES: Array[String] = ["content-plan.json", "placements.json", "report.json", "territories.json"]
const PLACEMENT_RULES: Array[String] = ["world_boss.v1", "dungeon_binding.v1"]
const RESPAWN_PRESSURES: Array[String] = ["low", "medium", "high"]


func _init() -> void:
	var failure := _verify(OS.get_cmdline_user_args())
	if failure != "":
		push_error("verify-content-pack: " + failure)
		quit(1)
	else:
		quit(0)


# Returns "" on success, a named refusal otherwise. Every path returns —
# a refusal is never a crash, and the process always exits.
func _verify(args: PackedStringArray) -> String:
	if args.size() != 2:
		return "usage: -- <world-pack-dir> <content-pack-dir>"
	var world_dir: String = args[0]
	var content_dir: String = args[1]

	var manifest_v: Variant = _read_json(content_dir, "manifest.json")
	if typeof(manifest_v) != TYPE_DICTIONARY:
		return "manifest.json is missing or not a JSON object (not a content pack)"
	var manifest: Dictionary = manifest_v
	if manifest.get("pack") != "worldfiller-content-pack":
		return "manifest.pack is not worldfiller-content-pack"
	if not _is_exact_int(manifest.get("packFormat"), 1):
		return "unsupported packFormat %s; this verifier reads format 1" % [str(manifest.get("packFormat"))]

	# Files table: exactly the four payload names, hash-verified.
	if typeof(manifest.get("files")) != TYPE_DICTIONARY:
		return "manifest.files table is missing"
	var files: Dictionary = manifest["files"]
	var listed: Array = files.keys()
	listed.sort()
	if listed != REQUIRED_FILES:
		return "manifest.files must list exactly %s (got: %s)" % [", ".join(REQUIRED_FILES), ", ".join(listed)]
	for file_name: String in REQUIRED_FILES:
		var path := content_dir.path_join(file_name)
		if not FileAccess.file_exists(path):
			return "payload file %s listed in manifest.files is missing" % [file_name]
		if _sha256(path) != files[file_name]:
			return "payload hash mismatch for " + file_name

	# Payloads, parsed only after their bytes hash-verified.
	var plan_v: Variant = _read_json(content_dir, "content-plan.json")
	var placements_v: Variant = _read_json(content_dir, "placements.json")
	var territories_v: Variant = _read_json(content_dir, "territories.json")
	var report_v: Variant = _read_json(content_dir, "report.json")
	if typeof(plan_v) != TYPE_DICTIONARY or typeof(placements_v) != TYPE_DICTIONARY \
			or typeof(territories_v) != TYPE_DICTIONARY or typeof(report_v) != TYPE_DICTIONARY:
		return "a payload file is not a JSON object"
	var plan: Dictionary = plan_v
	var placements_doc: Dictionary = placements_v
	var territories_doc: Dictionary = territories_v
	var report: Dictionary = report_v

	# Payload format pins: packFormat 1 fixes every payload format at 1.
	if not _is_exact_int(plan.get("planFormat"), 1):
		return "content-plan.json planFormat is not 1"
	if not _is_exact_int(placements_doc.get("placementsFormat"), 1):
		return "placements.json placementsFormat is not 1"
	if not _is_exact_int(territories_doc.get("territoriesFormat"), 1):
		return "territories.json territoriesFormat is not 1"
	if not _is_exact_int(report.get("reportFormat"), 1):
		return "report.json reportFormat is not 1"

	# The audit that authorized this pack: a hand-built pack without a
	# passing report is not a valid pack.
	if report.get("ok") != true:
		return "report.json .ok is not true — the pack carries a failing (or tampered) audit"

	# Base pairing against the world pack: generation identity AND the
	# world.json byte hash, plus artifact format and dimensions.
	var world_manifest_v: Variant = _read_json(world_dir, "manifest.json")
	if typeof(world_manifest_v) != TYPE_DICTIONARY:
		return "world pack manifest.json is missing or not a JSON object"
	var world_manifest: Dictionary = world_manifest_v
	if typeof(manifest.get("base")) != TYPE_DICTIONARY:
		return "manifest.base is missing"
	var base: Dictionary = manifest["base"]
	var world_generator_v: Variant = world_manifest.get("generator")
	if typeof(world_generator_v) != TYPE_DICTIONARY:
		return "world pack manifest carries no generator block"
	var world_generator: Dictionary = world_generator_v
	if base.get("generationIdentitySha256") != world_generator.get("generationIdentitySha256"):
		return "content pack directed against a different world (generation identity mismatch)"
	if base.get("artifactSha256") != world_manifest.get("baseArtifactSha256"):
		return "content pack base artifact hash does not match the world pack"
	if base.get("artifactFormat") != world_manifest.get("artifactFormat"):
		return "manifest.base.artifactFormat disagrees with the world pack"
	var world_dims_v: Variant = world_manifest.get("dimensions")
	if typeof(world_dims_v) != TYPE_DICTIONARY:
		return "world pack manifest carries no dimensions"
	var world_dims: Dictionary = world_dims_v
	if base.get("width") != world_dims.get("width") or base.get("height") != world_dims.get("height"):
		return "manifest.base width/height disagree with the world pack"

	# Manifest self-consistency: identity fields duplicated from the hashed
	# payloads must agree, and counts must equal the actual array lengths.
	for entry: Array in [
		["content-plan.json", plan],
		["placements.json", placements_doc],
		["territories.json", territories_doc],
		["report.json", report],
	]:
		var doc_name: String = entry[0]
		var doc: Dictionary = entry[1]
		if doc.get("directorRecipeSha256") != manifest.get("directorRecipeSha256"):
			return "manifest.directorRecipeSha256 does not match " + doc_name
		if doc.get("directorBehaviorVersion") != manifest.get("directorBehaviorVersion"):
			return "manifest.directorBehaviorVersion does not match " + doc_name
		if doc.get("recipeName") != manifest.get("recipeName"):
			return "manifest.recipeName does not match " + doc_name
		if doc.get("analysisVersion") != manifest.get("analysisVersion"):
			return "manifest.analysisVersion does not match " + doc_name
		if doc.get("rulePacks") != manifest.get("rulePacks"):
			return "manifest.rulePacks do not match " + doc_name
		var doc_base_v: Variant = doc.get("base")
		if typeof(doc_base_v) != TYPE_DICTIONARY:
			return doc_name + " carries no base block"
		var doc_base: Dictionary = doc_base_v
		if doc_base.get("generationIdentitySha256") != base.get("generationIdentitySha256"):
			return "manifest.base.generationIdentitySha256 does not match " + doc_name
		if doc_name != "report.json" and doc.get("directorSeed") != manifest.get("directorSeed"):
			return "manifest.directorSeed does not match " + doc_name

	if typeof(manifest.get("counts")) != TYPE_DICTIONARY:
		return "manifest.counts is missing"
	var counts: Dictionary = manifest["counts"]
	if typeof(placements_doc.get("placements")) != TYPE_ARRAY:
		return "placements.json carries no placements array"
	if typeof(placements_doc.get("failures")) != TYPE_ARRAY or typeof(placements_doc.get("unboundAnchors")) != TYPE_ARRAY:
		return "placements.json carries no failures/unboundAnchors arrays"
	if typeof(territories_doc.get("territories")) != TYPE_ARRAY or typeof(territories_doc.get("failures")) != TYPE_ARRAY:
		return "territories.json carries no territories/failures arrays"
	var placements: Array = placements_doc["placements"]
	var territories: Array = territories_doc["territories"]
	if not _is_exact_int(counts.get("placements"), placements.size()) \
			or not _is_exact_int(counts.get("territories"), territories.size()) \
			or not _is_exact_int(counts.get("placementFailures"), (placements_doc["failures"] as Array).size()) \
			or not _is_exact_int(counts.get("territoryFailures"), (territories_doc["failures"] as Array).size()) \
			or not _is_exact_int(counts.get("unboundAnchors"), (placements_doc["unboundAnchors"] as Array).size()):
		return "manifest.counts disagree with the payload documents"

	# Ground truth: the world pack's reference walkability bitgrid, pinned
	# to the frozen encoding and cross-checked against the manifest dims.
	var walkability_v: Variant = _read_json(world_dir, "walkability.json")
	if typeof(walkability_v) != TYPE_DICTIONARY:
		return "world pack walkability.json is missing or not a JSON object"
	var walkability: Dictionary = walkability_v
	if walkability.get("encoding") != "base64-bitpacked-row-major-lsb-first":
		return "unsupported walkability encoding %s" % [str(walkability.get("encoding"))]
	var width_v: Variant = walkability.get("width")
	var height_v: Variant = walkability.get("height")
	if typeof(width_v) != TYPE_FLOAT and typeof(width_v) != TYPE_INT:
		return "walkability.json carries no numeric width"
	if typeof(height_v) != TYPE_FLOAT and typeof(height_v) != TYPE_INT:
		return "walkability.json carries no numeric height"
	var width := int(width_v)
	var height := int(height_v)
	if width != int(world_dims.get("width", -1)) or height != int(world_dims.get("height", -1)):
		return "walkability.json dimensions disagree with the world manifest"
	if typeof(walkability.get("grid")) != TYPE_STRING:
		return "walkability.json carries no grid string"
	var grid := Marshalls.base64_to_raw(walkability["grid"])
	var expected_bytes := (width * height + 7) >> 3
	if grid.size() != expected_bytes:
		return "walkability grid is %d bytes; %dx%d needs exactly %d" % [grid.size(), width, height, expected_bytes]

	# World POIs for the dungeon anchor check (id -> cell).
	var world_v: Variant = _read_json(world_dir, "world.json")
	if typeof(world_v) != TYPE_DICTIONARY:
		return "world pack world.json is missing or not a JSON object"
	var world: Dictionary = world_v
	if typeof(world.get("pois")) != TYPE_ARRAY:
		return "world.json carries no pois array"
	var poi_cells := {}
	for poi_v: Variant in world["pois"]:
		if typeof(poi_v) != TYPE_DICTIONARY:
			return "world.json pois entry is not an object"
		var poi: Dictionary = poi_v
		poi_cells[int(poi.get("id", -1))] = poi.get("cell")

	var placement_count := 0
	for placement_v: Variant in placements:
		if typeof(placement_v) != TYPE_DICTIONARY:
			return "placements entry is not an object"
		var placement: Dictionary = placement_v
		var placement_id := str(placement.get("id"))
		var rule_v: Variant = placement.get("rule")
		if not (rule_v is String) or not PLACEMENT_RULES.has(rule_v):
			return placement_id + " carries unknown placement rule " + str(rule_v)
		var access_v: Variant = placement.get("accessCell")
		if not _is_cell(access_v):
			return placement_id + " carries no accessCell pair"
		var access: Array = access_v
		if not _walkable(grid, width, height, int(access[0]), int(access[1])):
			return placement_id + " access cell is not walkable"
		if rule_v == "world_boss.v1":
			var origin_v: Variant = placement.get("arenaOrigin")
			var side_v: Variant = placement.get("arenaSide")
			if not _is_cell(origin_v) or not (typeof(side_v) == TYPE_FLOAT or typeof(side_v) == TYPE_INT):
				return placement_id + " carries no arena"
			var origin: Array = origin_v
			var side := int(side_v)
			if side < 1:
				return placement_id + " carries no arena"
			for y in range(int(origin[1]), int(origin[1]) + side):
				for x in range(int(origin[0]), int(origin[0]) + side):
					if not _walkable(grid, width, height, x, y):
						return placement_id + " arena cell is not walkable"
		if rule_v == "dungeon_binding.v1":
			var anchor_id := int(placement.get("anchorPoiId", -1))
			if not poi_cells.has(anchor_id):
				return placement_id + " binds anchor poi #%d which does not exist in the world pack" % [anchor_id]
			var poi_cell_v: Variant = poi_cells[anchor_id]
			var cell_v: Variant = placement.get("cell")
			if not _is_cell(poi_cell_v) or not _is_cell(cell_v):
				return placement_id + " anchor/cell pair is malformed"
			var poi_cell: Array = poi_cell_v
			var cell: Array = cell_v
			if int(poi_cell[0]) != int(cell[0]) or int(poi_cell[1]) != int(cell[1]):
				return placement_id + " anchor poi #%d moved" % [anchor_id]
		placement_count += 1

	var territory_cells := 0
	for territory_v: Variant in territories:
		if typeof(territory_v) != TYPE_DICTIONARY:
			return "territories entry is not an object"
		var territory: Dictionary = territory_v
		var territory_id := str(territory.get("id"))
		if typeof(territory.get("cells")) != TYPE_DICTIONARY:
			return territory_id + " carries no cells block"
		var cells_block: Dictionary = territory["cells"]
		if cells_block.get("encoding") != "runs":
			return territory_id + " carries unknown cell encoding " + str(cells_block.get("encoding"))
		if not RESPAWN_PRESSURES.has(territory.get("respawnPressure")):
			return territory_id + " carries unknown respawnPressure " + str(territory.get("respawnPressure"))
		if typeof(cells_block.get("runs")) != TYPE_ARRAY:
			return territory_id + " carries no runs array"
		var decoded := {}
		for run_v: Variant in cells_block["runs"]:
			if typeof(run_v) != TYPE_ARRAY:
				return territory_id + " run is not an array"
			var run: Array = run_v
			if run.size() != 3:
				return territory_id + " run is not an [x, y, length] triple"
			var x0 := int(run[0])
			var y0 := int(run[1])
			var run_length := int(run[2])
			# Runs never cross rows (frozen contract): refuse, never wrap.
			if x0 < 0 or y0 < 0 or run_length < 1 or x0 + run_length > width:
				return territory_id + " run [%d, %d, %d] is malformed (row-crossing or non-positive)" % [x0, y0, run_length]
			for i in range(run_length):
				if not _walkable(grid, width, height, x0 + i, y0):
					return territory_id + " territory cell is not walkable"
				decoded[y0 * width + x0 + i] = true
		if not _is_exact_int(territory.get("cellCount"), decoded.size()):
			return territory_id + " cellCount %s does not match its runs (%d)" % [str(territory.get("cellCount")), decoded.size()]
		territory_cells += decoded.size()

	print("verify-content-pack: OK — %d placements, %d territory cells against %dx%d reference walkability" % [
		placement_count, territory_cells, width, height,
	])
	return ""


func _read_json(dir: String, name: String) -> Variant:
	var path := dir.path_join(name)
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _sha256(path: String) -> String:
	var bytes := FileAccess.get_file_as_bytes(path)
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


# JSON numbers parse as floats; accept a value only when it is exactly the
# integer expected — no lossy int() coercion (1.9 is a refusal, not a 1).
func _is_exact_int(value: Variant, expected: int) -> bool:
	if typeof(value) == TYPE_INT:
		return int(value) == expected
	if typeof(value) == TYPE_FLOAT:
		var f: float = value
		return f == floor(f) and int(f) == expected
	return false


func _is_cell(value: Variant) -> bool:
	if typeof(value) != TYPE_ARRAY:
		return false
	var pair: Array = value
	if pair.size() != 2:
		return false
	for member: Variant in pair:
		if typeof(member) != TYPE_FLOAT and typeof(member) != TYPE_INT:
			return false
	return true


func _walkable(grid: PackedByteArray, width: int, height: int, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	var index := y * width + x
	return (grid[index >> 3] >> (index & 7)) & 1 == 1
