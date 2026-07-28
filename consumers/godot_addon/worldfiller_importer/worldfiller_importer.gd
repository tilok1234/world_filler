class_name WorldfillerImporter
extends RefCounted
# The game-side importer for worldfiller content packs (pack format 1).
#
# Copy this FOLDER into your Godot 4 project (anywhere, e.g.
# res://worldfiller/), ship a world pack + its content pack with your
# game data, then:
#
#   var pack := WorldfillerImporter.load_packs(world_dir, content_dir)
#   if not pack.ok:
#       push_error(pack.error)   # refusal, never garbage
#
# On success `pack` carries everything the game needs (see README.md):
# placements, territories (with decoded cells), the plan, walkability,
# and query helpers below. Implements every importer obligation from
# docs/CONTENT_PACK_FORMAT.md — a tampered, mismatched, or hand-built
# pack is refused with a named error, exactly like the reference
# verifiers this file mirrors (consumers/godot-proof/verify_content_pack.gd).
#
# Runtime split (frozen doctrine): the pack is permanent structure.
# Spawning, door/kill/loot state are yours — persist them as game-side
# deltas keyed by placement/territory id.

const REQUIRED_FILES: Array[String] = ["content-plan.json", "placements.json", "report.json", "territories.json"]
const PLACEMENT_RULES: Array[String] = ["world_boss.v1", "dungeon_binding.v1"]
const RESPAWN_PRESSURES: Array[String] = ["low", "medium", "high"]


## Load and fully verify a world pack + content pack pair.
## Returns a Dictionary: { ok: bool, error: String } plus, when ok:
##   width, height          world dimensions in cells
##   grid                   PackedByteArray walkability bitgrid (LSB-first)
##   manifest, plan, report parsed payload documents (Dictionaries)
##   placements             Array[Dictionary] — each placement row
##   territories            Array[Dictionary] — each territory row, plus
##                          "cells_decoded": PackedInt32Array of y*width+x
##   pois_by_id             Dictionary poi id -> poi Dictionary
static func load_packs(world_dir: String, content_dir: String) -> Dictionary:
	var out := { "ok": false, "error": "" }

	var manifest_v: Variant = _read_json(content_dir, "manifest.json")
	if typeof(manifest_v) != TYPE_DICTIONARY:
		return _fail(out, "manifest.json is missing or not a JSON object (not a content pack)")
	var manifest: Dictionary = manifest_v
	if manifest.get("pack") != "worldfiller-content-pack":
		return _fail(out, "manifest.pack is not worldfiller-content-pack")
	if not _is_exact_int(manifest.get("packFormat"), 1):
		return _fail(out, "unsupported packFormat %s; this importer reads format 1" % [str(manifest.get("packFormat"))])

	# Files table: exactly the four payload names, hash-verified.
	if typeof(manifest.get("files")) != TYPE_DICTIONARY:
		return _fail(out, "manifest.files table is missing")
	var files: Dictionary = manifest["files"]
	var listed: Array = files.keys()
	listed.sort()
	if listed != REQUIRED_FILES:
		return _fail(out, "manifest.files must list exactly %s (got: %s)" % [", ".join(REQUIRED_FILES), ", ".join(listed)])
	for file_name: String in REQUIRED_FILES:
		var path := content_dir.path_join(file_name)
		if not FileAccess.file_exists(path):
			return _fail(out, "payload file %s listed in manifest.files is missing" % [file_name])
		if _sha256(path) != files[file_name]:
			return _fail(out, "payload hash mismatch for " + file_name)

	var plan_v: Variant = _read_json(content_dir, "content-plan.json")
	var placements_v: Variant = _read_json(content_dir, "placements.json")
	var territories_v: Variant = _read_json(content_dir, "territories.json")
	var report_v: Variant = _read_json(content_dir, "report.json")
	if typeof(plan_v) != TYPE_DICTIONARY or typeof(placements_v) != TYPE_DICTIONARY \
			or typeof(territories_v) != TYPE_DICTIONARY or typeof(report_v) != TYPE_DICTIONARY:
		return _fail(out, "a payload file is not a JSON object")
	var plan: Dictionary = plan_v
	var placements_doc: Dictionary = placements_v
	var territories_doc: Dictionary = territories_v
	var report: Dictionary = report_v

	# Payload format pins: packFormat 1 fixes every payload format at 1.
	if not _is_exact_int(plan.get("planFormat"), 1):
		return _fail(out, "content-plan.json planFormat is not 1")
	if not _is_exact_int(placements_doc.get("placementsFormat"), 1):
		return _fail(out, "placements.json placementsFormat is not 1")
	if not _is_exact_int(territories_doc.get("territoriesFormat"), 1):
		return _fail(out, "territories.json territoriesFormat is not 1")
	if not _is_exact_int(report.get("reportFormat"), 1):
		return _fail(out, "report.json reportFormat is not 1")

	# A hand-built pack without a passing audit is not a valid pack.
	if report.get("ok") != true:
		return _fail(out, "report.json .ok is not true — the pack carries a failing (or tampered) audit")

	# Base pairing against the world pack.
	var world_manifest_v: Variant = _read_json(world_dir, "manifest.json")
	if typeof(world_manifest_v) != TYPE_DICTIONARY:
		return _fail(out, "world pack manifest.json is missing or not a JSON object")
	var world_manifest: Dictionary = world_manifest_v
	if typeof(manifest.get("base")) != TYPE_DICTIONARY:
		return _fail(out, "manifest.base is missing")
	var base: Dictionary = manifest["base"]
	var world_generator_v: Variant = world_manifest.get("generator")
	if typeof(world_generator_v) != TYPE_DICTIONARY:
		return _fail(out, "world pack manifest carries no generator block")
	var world_generator: Dictionary = world_generator_v
	if base.get("generationIdentitySha256") != world_generator.get("generationIdentitySha256"):
		return _fail(out, "content pack directed against a different world (generation identity mismatch)")
	if base.get("artifactSha256") != world_manifest.get("baseArtifactSha256"):
		return _fail(out, "content pack base artifact hash does not match the world pack")
	if base.get("artifactFormat") != world_manifest.get("artifactFormat"):
		return _fail(out, "manifest.base.artifactFormat disagrees with the world pack")
	var world_dims_v: Variant = world_manifest.get("dimensions")
	if typeof(world_dims_v) != TYPE_DICTIONARY:
		return _fail(out, "world pack manifest carries no dimensions")
	var world_dims: Dictionary = world_dims_v
	if base.get("width") != world_dims.get("width") or base.get("height") != world_dims.get("height"):
		return _fail(out, "manifest.base width/height disagree with the world pack")

	# Manifest self-consistency against the hashed payloads.
	for entry: Array in [
		["content-plan.json", plan],
		["placements.json", placements_doc],
		["territories.json", territories_doc],
		["report.json", report],
	]:
		var doc_name: String = entry[0]
		var doc: Dictionary = entry[1]
		if doc.get("directorRecipeSha256") != manifest.get("directorRecipeSha256"):
			return _fail(out, "manifest.directorRecipeSha256 does not match " + doc_name)
		if doc.get("directorBehaviorVersion") != manifest.get("directorBehaviorVersion"):
			return _fail(out, "manifest.directorBehaviorVersion does not match " + doc_name)
		if doc.get("recipeName") != manifest.get("recipeName"):
			return _fail(out, "manifest.recipeName does not match " + doc_name)
		if doc.get("analysisVersion") != manifest.get("analysisVersion"):
			return _fail(out, "manifest.analysisVersion does not match " + doc_name)
		if doc.get("rulePacks") != manifest.get("rulePacks"):
			return _fail(out, "manifest.rulePacks do not match " + doc_name)
		var doc_base_v: Variant = doc.get("base")
		if typeof(doc_base_v) != TYPE_DICTIONARY:
			return _fail(out, doc_name + " carries no base block")
		var doc_base: Dictionary = doc_base_v
		if doc_base.get("generationIdentitySha256") != base.get("generationIdentitySha256"):
			return _fail(out, "manifest.base.generationIdentitySha256 does not match " + doc_name)
		if doc_name != "report.json" and doc.get("directorSeed") != manifest.get("directorSeed"):
			return _fail(out, "manifest.directorSeed does not match " + doc_name)

	if typeof(manifest.get("counts")) != TYPE_DICTIONARY:
		return _fail(out, "manifest.counts is missing")
	var counts: Dictionary = manifest["counts"]
	if typeof(placements_doc.get("placements")) != TYPE_ARRAY:
		return _fail(out, "placements.json carries no placements array")
	if typeof(placements_doc.get("failures")) != TYPE_ARRAY or typeof(placements_doc.get("unboundAnchors")) != TYPE_ARRAY:
		return _fail(out, "placements.json carries no failures/unboundAnchors arrays")
	if typeof(territories_doc.get("territories")) != TYPE_ARRAY or typeof(territories_doc.get("failures")) != TYPE_ARRAY:
		return _fail(out, "territories.json carries no territories/failures arrays")
	var placements: Array = placements_doc["placements"]
	var territories: Array = territories_doc["territories"]
	if not _is_exact_int(counts.get("placements"), placements.size()) \
			or not _is_exact_int(counts.get("territories"), territories.size()) \
			or not _is_exact_int(counts.get("placementFailures"), (placements_doc["failures"] as Array).size()) \
			or not _is_exact_int(counts.get("territoryFailures"), (territories_doc["failures"] as Array).size()) \
			or not _is_exact_int(counts.get("unboundAnchors"), (placements_doc["unboundAnchors"] as Array).size()):
		return _fail(out, "manifest.counts disagree with the payload documents")

	# Walkability ground truth from the world pack.
	var walkability_v: Variant = _read_json(world_dir, "walkability.json")
	if typeof(walkability_v) != TYPE_DICTIONARY:
		return _fail(out, "world pack walkability.json is missing or not a JSON object")
	var walkability: Dictionary = walkability_v
	if walkability.get("encoding") != "base64-bitpacked-row-major-lsb-first":
		return _fail(out, "unsupported walkability encoding %s" % [str(walkability.get("encoding"))])
	var width_v: Variant = walkability.get("width")
	var height_v: Variant = walkability.get("height")
	if (typeof(width_v) != TYPE_FLOAT and typeof(width_v) != TYPE_INT) \
			or (typeof(height_v) != TYPE_FLOAT and typeof(height_v) != TYPE_INT):
		return _fail(out, "walkability.json carries no numeric dimensions")
	var width := int(width_v)
	var height := int(height_v)
	if width != int(world_dims.get("width", -1)) or height != int(world_dims.get("height", -1)):
		return _fail(out, "walkability.json dimensions disagree with the world manifest")
	if typeof(walkability.get("grid")) != TYPE_STRING:
		return _fail(out, "walkability.json carries no grid string")
	var grid := Marshalls.base64_to_raw(walkability["grid"])
	if grid.size() != (width * height + 7) >> 3:
		return _fail(out, "walkability grid byte length does not match %dx%d" % [width, height])

	# World POIs (id -> poi) for anchor checks and dungeon queries.
	var world_v: Variant = _read_json(world_dir, "world.json")
	if typeof(world_v) != TYPE_DICTIONARY:
		return _fail(out, "world pack world.json is missing or not a JSON object")
	var world: Dictionary = world_v
	if typeof(world.get("pois")) != TYPE_ARRAY:
		return _fail(out, "world.json carries no pois array")
	var pois_by_id := {}
	for poi_v: Variant in world["pois"]:
		if typeof(poi_v) != TYPE_DICTIONARY:
			return _fail(out, "world.json pois entry is not an object")
		var poi: Dictionary = poi_v
		pois_by_id[int(poi.get("id", -1))] = poi

	# Placements: closed enums, ground truth, anchor existence.
	for placement_v: Variant in placements:
		if typeof(placement_v) != TYPE_DICTIONARY:
			return _fail(out, "placements entry is not an object")
		var placement: Dictionary = placement_v
		var placement_id := str(placement.get("id"))
		var rule_v: Variant = placement.get("rule")
		if not (rule_v is String) or not PLACEMENT_RULES.has(rule_v):
			return _fail(out, placement_id + " carries unknown placement rule " + str(rule_v))
		var access_v: Variant = placement.get("accessCell")
		if not _is_cell(access_v):
			return _fail(out, placement_id + " carries no accessCell pair")
		var access: Array = access_v
		if not _walkable_raw(grid, width, height, int(access[0]), int(access[1])):
			return _fail(out, placement_id + " access cell is not walkable")
		if rule_v == "world_boss.v1":
			var origin_v: Variant = placement.get("arenaOrigin")
			var side_v: Variant = placement.get("arenaSide")
			if not _is_cell(origin_v) or not (typeof(side_v) == TYPE_FLOAT or typeof(side_v) == TYPE_INT) or int(side_v) < 1:
				return _fail(out, placement_id + " carries no arena")
			var origin: Array = origin_v
			for y in range(int(origin[1]), int(origin[1]) + int(side_v)):
				for x in range(int(origin[0]), int(origin[0]) + int(side_v)):
					if not _walkable_raw(grid, width, height, x, y):
						return _fail(out, placement_id + " arena cell is not walkable")
		if rule_v == "dungeon_binding.v1":
			var anchor_id := int(placement.get("anchorPoiId", -1))
			if not pois_by_id.has(anchor_id):
				return _fail(out, placement_id + " binds anchor poi #%d which does not exist in the world pack" % [anchor_id])
			var poi_cell_v: Variant = (pois_by_id[anchor_id] as Dictionary).get("cell")
			var cell_v: Variant = placement.get("cell")
			if not _is_cell(poi_cell_v) or not _is_cell(cell_v):
				return _fail(out, placement_id + " anchor/cell pair is malformed")
			if int((poi_cell_v as Array)[0]) != int((cell_v as Array)[0]) or int((poi_cell_v as Array)[1]) != int((cell_v as Array)[1]):
				return _fail(out, placement_id + " anchor poi #%d moved" % [anchor_id])

	# Territories: closed enums, run rule, ground truth; decode cells.
	for territory_v: Variant in territories:
		if typeof(territory_v) != TYPE_DICTIONARY:
			return _fail(out, "territories entry is not an object")
		var territory: Dictionary = territory_v
		var territory_id := str(territory.get("id"))
		if typeof(territory.get("cells")) != TYPE_DICTIONARY:
			return _fail(out, territory_id + " carries no cells block")
		var cells_block: Dictionary = territory["cells"]
		if cells_block.get("encoding") != "runs":
			return _fail(out, territory_id + " carries unknown cell encoding " + str(cells_block.get("encoding")))
		if not RESPAWN_PRESSURES.has(territory.get("respawnPressure")):
			return _fail(out, territory_id + " carries unknown respawnPressure " + str(territory.get("respawnPressure")))
		if typeof(cells_block.get("runs")) != TYPE_ARRAY:
			return _fail(out, territory_id + " carries no runs array")
		var decoded := {}
		for run_v: Variant in cells_block["runs"]:
			if typeof(run_v) != TYPE_ARRAY or (run_v as Array).size() != 3:
				return _fail(out, territory_id + " run is not an [x, y, length] triple")
			var run: Array = run_v
			var x0 := int(run[0])
			var y0 := int(run[1])
			var run_length := int(run[2])
			# Runs never cross rows (frozen contract): refuse, never wrap.
			if x0 < 0 or y0 < 0 or run_length < 1 or x0 + run_length > width:
				return _fail(out, territory_id + " run [%d, %d, %d] is malformed" % [x0, y0, run_length])
			for i in range(run_length):
				if not _walkable_raw(grid, width, height, x0 + i, y0):
					return _fail(out, territory_id + " territory cell is not walkable")
				decoded[y0 * width + x0 + i] = true
		if not _is_exact_int(territory.get("cellCount"), decoded.size()):
			return _fail(out, territory_id + " cellCount does not match its runs")
		var packed := PackedInt32Array()
		for cell_index: int in decoded.keys():
			packed.append(cell_index)
		packed.sort()
		territory["cells_decoded"] = packed

	out["ok"] = true
	out["manifest"] = manifest
	out["plan"] = plan
	out["report"] = report
	out["placements"] = placements
	out["territories"] = territories
	out["width"] = width
	out["height"] = height
	out["grid"] = grid
	out["pois_by_id"] = pois_by_id
	return out


## True when cell (x, y) is walkable ground in the loaded world.
static func walkable(pack: Dictionary, x: int, y: int) -> bool:
	return _walkable_raw(pack["grid"], pack["width"], pack["height"], x, y)


## The territory owning cell (x, y), or {} when none. Builds and caches
## a cell->territory index on first call.
static func territory_at(pack: Dictionary, x: int, y: int) -> Dictionary:
	if not pack.has("_territory_of"):
		var lookup := {}
		var territories: Array = pack["territories"]
		for index in range(territories.size()):
			for cell_index: int in (territories[index] as Dictionary)["cells_decoded"]:
				lookup[cell_index] = index
		pack["_territory_of"] = lookup
	var key: int = y * int(pack["width"]) + x
	var territory_of: Dictionary = pack["_territory_of"]
	if not territory_of.has(key):
		return {}
	return pack["territories"][territory_of[key]]


## The placement with this id, or {} when none.
static func placement_by_id(pack: Dictionary, id: String) -> Dictionary:
	for placement: Dictionary in pack["placements"]:
		if placement.get("id") == id:
			return placement
	return {}


static func _fail(out: Dictionary, message: String) -> Dictionary:
	out["ok"] = false
	out["error"] = "worldfiller_importer: " + message
	return out


static func _read_json(dir: String, name: String) -> Variant:
	var path := dir.path_join(name)
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func _sha256(path: String) -> String:
	var bytes := FileAccess.get_file_as_bytes(path)
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


# JSON numbers parse as floats; accept only the exact expected integer.
static func _is_exact_int(value: Variant, expected: int) -> bool:
	if typeof(value) == TYPE_INT:
		return int(value) == expected
	if typeof(value) == TYPE_FLOAT:
		var f: float = value
		return f == floor(f) and int(f) == expected
	return false


static func _is_cell(value: Variant) -> bool:
	if typeof(value) != TYPE_ARRAY:
		return false
	var pair: Array = value
	if pair.size() != 2:
		return false
	for member: Variant in pair:
		if typeof(member) != TYPE_FLOAT and typeof(member) != TYPE_INT:
			return false
	return true


static func _walkable_raw(grid: PackedByteArray, width: int, height: int, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	var index := y * width + x
	return (grid[index >> 3] >> (index & 7)) & 1 == 1
