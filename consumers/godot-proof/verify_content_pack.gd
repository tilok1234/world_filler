# Headless consumption proof for worldfiller content packs (formats 1-2).
#
# Run:
#   godot --headless --script verify_content_pack.gd -- <world-pack-dir> <content-pack-dir>
#
# Mirrors src/consume/verifyPack.ts refusal-for-refusal from nothing but
# the two packs on disk: files-table completeness (exactly the four
# payload files, parsed from the same bytes that were hash-verified),
# report.json ok, payload format pins, manifest/payload identity and
# count agreement, base pairing + format/dimension cross-checks, dungeon
# anchor existence against world.json, unknown enum values as errors,
# territory runs that never cross rows, and every placement/territory
# cell checked against the world pack's reference walkability bitgrid
# (base64, row-major, LSB-first, walkable = 1). Every malformed input is
# a named refusal, never a script error — the process always exits, 0 on
# success and 1 on any refusal. Full world-pack hash verification is the
# game importer's separate duty (it loads the world pack through its own
# reader); this proof pins the cheap cross-checks the TS reference also
# performs. This is the reference for the future worldfiller_importer
# addon; see docs/CONTENT_PACK_FORMAT.md.
extends SceneTree

const PAYLOAD_FILES: Array[String] = ["content-plan.json", "placements.json", "report.json", "territories.json"]
const PLACEMENT_RULES_V1: Array[String] = ["world_boss.v1", "dungeon_binding.v1"]
const PLACEMENT_RULES_V2: Array[String] = ["world_boss.v1", "dungeon_binding.v1", "encounter_site.v1"]
const RESPAWN_PRESSURES: Array[String] = ["low", "medium", "high"]
const WALKABILITY_ENCODING := "base64-bitpacked-row-major-lsb-first"

var _refused := false


func _refuse(message: String) -> void:
	push_error("verify-content-pack: " + message)
	_refused = true


func _sha256(bytes: PackedByteArray) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(bytes)
	return ctx.finish().hex_encode()


func _read_json_dict(dir: String, name: String) -> Variant:
	var path := dir.path_join(name)
	if not FileAccess.file_exists(path):
		_refuse("missing file " + path)
		return null
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		_refuse(name + " is not a JSON object")
		return null
	return parsed


func _parse_json_dict(bytes: PackedByteArray, name: String) -> Variant:
	var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		_refuse(name + " is not a JSON object")
		return null
	return parsed


func _dict_in(container: Dictionary, key: String, context: String) -> Variant:
	var value: Variant = container.get(key)
	if typeof(value) != TYPE_DICTIONARY:
		_refuse(context + "." + key + " is not an object")
		return null
	return value


func _array_in(container: Dictionary, key: String, context: String) -> Variant:
	var value: Variant = container.get(key)
	if typeof(value) != TYPE_ARRAY:
		_refuse(context + "." + key + " is not an array")
		return null
	return value


# JSON numbers parse as floats; an integer field must be a whole float.
func _is_int(value: Variant) -> bool:
	return typeof(value) == TYPE_FLOAT and value == floorf(value)


func _int_pair(value: Variant) -> bool:
	if typeof(value) != TYPE_ARRAY:
		return false
	var pair: Array = value
	return pair.size() == 2 and _is_int(pair[0]) and _is_int(pair[1])


func _walkable(grid: PackedByteArray, width: int, height: int, x: int, y: int) -> bool:
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	var index := y * width + x
	return (grid[index >> 3] >> (index & 7)) & 1 == 1


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		_refuse("usage: -- <world-pack-dir> <content-pack-dir>")
		quit(1)
		return
	var ok := _verify(args[0], args[1])
	quit(0 if ok and not _refused else 1)


func _verify(world_dir: String, content_dir: String) -> bool:
	var manifest_v: Variant = _read_json_dict(content_dir, "manifest.json")
	if manifest_v == null:
		return false
	var manifest: Dictionary = manifest_v
	if manifest.get("pack") != "worldfiller-content-pack":
		_refuse("manifest.pack is not worldfiller-content-pack")
		return false
	var pack_format: Variant = manifest.get("packFormat")
	if not _is_int(pack_format) or (pack_format != 1.0 and pack_format != 2.0):
		_refuse("unsupported packFormat " + str(pack_format) + "; this verifier reads formats 1-2")
		return false
	var placement_rules: Array[String] = PLACEMENT_RULES_V1 if pack_format == 1.0 else PLACEMENT_RULES_V2
	var expected_placements_format: float = pack_format

	# The files table must list exactly the four format-1 payload files —
	# a shorter table would leave consumed bytes unhashed, a longer one is
	# an unknown name. Payloads are parsed from the hash-verified bytes.
	var files_v: Variant = _dict_in(manifest, "files", "manifest")
	if files_v == null:
		return false
	var files: Dictionary = files_v
	for name in PAYLOAD_FILES:
		if not files.has(name):
			_refuse("manifest.files must list " + name + " (format 1 packs carry exactly " + ", ".join(PAYLOAD_FILES) + ")")
			return false
	for name in files:
		if not PAYLOAD_FILES.has(name):
			_refuse("manifest.files lists unknown payload " + str(name))
			return false
	var payload_bytes := {}
	for name in PAYLOAD_FILES:
		if not FileAccess.file_exists(content_dir.path_join(name)):
			_refuse("payload file " + name + " listed in manifest.files is missing")
			return false
		var bytes := FileAccess.get_file_as_bytes(content_dir.path_join(name))
		if typeof(files[name]) != TYPE_STRING or _sha256(bytes) != files[name]:
			_refuse("payload hash mismatch for " + name)
			return false
		payload_bytes[name] = bytes

	var plan_v: Variant = _parse_json_dict(payload_bytes["content-plan.json"], "content-plan.json")
	if plan_v == null:
		return false
	var plan: Dictionary = plan_v
	var placements_doc_v: Variant = _parse_json_dict(payload_bytes["placements.json"], "placements.json")
	if placements_doc_v == null:
		return false
	var placements_doc: Dictionary = placements_doc_v
	var territories_doc_v: Variant = _parse_json_dict(payload_bytes["territories.json"], "territories.json")
	if territories_doc_v == null:
		return false
	var territories_doc: Dictionary = territories_doc_v
	var report_v: Variant = _parse_json_dict(payload_bytes["report.json"], "report.json")
	if report_v == null:
		return false
	var report: Dictionary = report_v

	# packFormat 1 fixes every payload format at 1 (no best-effort reads).
	if plan.get("planFormat") != 1.0:
		_refuse("content-plan.json planFormat " + str(plan.get("planFormat")) + "; format-1 packs carry planFormat 1")
		return false
	if placements_doc.get("placementsFormat") != expected_placements_format:
		_refuse("placements.json placementsFormat " + str(placements_doc.get("placementsFormat")) + " does not match packFormat " + str(int(pack_format)))
		return false
	if territories_doc.get("territoriesFormat") != 1.0:
		_refuse("territories.json territoriesFormat " + str(territories_doc.get("territoriesFormat")) + "; format-1 packs carry territoriesFormat 1")
		return false
	if report.get("reportFormat") != 1.0:
		_refuse("report.json reportFormat " + str(report.get("reportFormat")) + "; format-1 packs carry reportFormat 1")
		return false

	# Importer obligation 4: the pack was audited. A hand-built pack
	# without a passing report is not a valid pack.
	if report.get("ok") != true:
		_refuse("report.json says ok is not true — the pack carries a failing (or tampered) audit")
		return false

	# The manifest is the only unhashed file, so every identity field and
	# count it duplicates must agree with the hashed payload documents.
	var identity_docs := {
		"content-plan.json": plan,
		"placements.json": placements_doc,
		"territories.json": territories_doc,
		"report.json": report,
	}
	var manifest_base_v: Variant = _dict_in(manifest, "base", "manifest")
	if manifest_base_v == null:
		return false
	var manifest_base: Dictionary = manifest_base_v
	for name in identity_docs:
		var doc: Dictionary = identity_docs[name]
		if doc.get("directorRecipeSha256") != manifest.get("directorRecipeSha256"):
			_refuse("manifest.directorRecipeSha256 disagrees with " + name)
			return false
		if doc.get("directorBehaviorVersion") != manifest.get("directorBehaviorVersion"):
			_refuse("manifest.directorBehaviorVersion disagrees with " + name)
			return false
		if doc.get("recipeName") != manifest.get("recipeName"):
			_refuse("manifest.recipeName disagrees with " + name)
			return false
		var doc_base_v: Variant = _dict_in(doc, "base", name)
		if doc_base_v == null:
			return false
		var doc_base: Dictionary = doc_base_v
		if doc_base.get("generationIdentitySha256") != manifest_base.get("generationIdentitySha256"):
			_refuse("manifest.base.generationIdentitySha256 disagrees with " + name)
			return false
		if name != "report.json" and doc.get("directorSeed") != manifest.get("directorSeed"):
			_refuse("manifest.directorSeed disagrees with " + name)
			return false

	var placements_arr_v: Variant = _array_in(placements_doc, "placements", "placements.json")
	var placement_failures_v: Variant = _array_in(placements_doc, "failures", "placements.json")
	var unbound_v: Variant = _array_in(placements_doc, "unboundAnchors", "placements.json")
	var territories_arr_v: Variant = _array_in(territories_doc, "territories", "territories.json")
	var territory_failures_v: Variant = _array_in(territories_doc, "failures", "territories.json")
	if placements_arr_v == null or placement_failures_v == null or unbound_v == null \
			or territories_arr_v == null or territory_failures_v == null:
		return false
	var placements_arr: Array = placements_arr_v
	var territories_arr: Array = territories_arr_v
	var counts_v: Variant = _dict_in(manifest, "counts", "manifest")
	if counts_v == null:
		return false
	var counts: Dictionary = counts_v
	if counts.get("placements") != placements_arr.size() \
			or counts.get("placementFailures") != (placement_failures_v as Array).size() \
			or counts.get("unboundAnchors") != (unbound_v as Array).size() \
			or counts.get("territories") != territories_arr.size() \
			or counts.get("territoryFailures") != (territory_failures_v as Array).size():
		_refuse("manifest.counts disagree with the payload documents")
		return false

	# Base identity cross-check against the world pack: BOTH the
	# generation identity and the world.json byte hash must match — the
	# blessed pairing rule — and the recorded artifact format and
	# dimensions must agree with the world pack.
	var world_manifest_v: Variant = _read_json_dict(world_dir, "manifest.json")
	if world_manifest_v == null:
		return false
	var world_manifest: Dictionary = world_manifest_v
	var generator_v: Variant = _dict_in(world_manifest, "generator", "world manifest")
	if generator_v == null:
		return false
	if manifest_base.get("generationIdentitySha256") != (generator_v as Dictionary).get("generationIdentitySha256"):
		_refuse("content pack directed against a different world (generation identity mismatch)")
		return false
	if manifest_base.get("artifactSha256") != world_manifest.get("baseArtifactSha256"):
		_refuse("content pack base artifact hash does not match the world pack")
		return false
	if manifest_base.get("artifactFormat") != world_manifest.get("artifactFormat"):
		_refuse("manifest.base.artifactFormat disagrees with the world pack")
		return false
	var world_dims_v: Variant = _dict_in(world_manifest, "dimensions", "world manifest")
	if world_dims_v == null:
		return false
	var world_dims: Dictionary = world_dims_v
	if manifest_base.get("width") != world_dims.get("width") or manifest_base.get("height") != world_dims.get("height"):
		_refuse("manifest.base dimensions disagree with the world pack")
		return false

	# Ground truth from the world pack's REFERENCE walkability bitgrid —
	# encoding pinned, dimensions cross-checked, byte length validated.
	var walkability_v: Variant = _read_json_dict(world_dir, "walkability.json")
	if walkability_v == null:
		return false
	var walkability: Dictionary = walkability_v
	if walkability.get("encoding") != WALKABILITY_ENCODING:
		_refuse("unsupported walkability encoding " + str(walkability.get("encoding")))
		return false
	if not _is_int(walkability.get("width")) or not _is_int(walkability.get("height")):
		_refuse("walkability.json width/height are not integers")
		return false
	var width := int(walkability.get("width"))
	var height := int(walkability.get("height"))
	if float(width) != world_dims.get("width") or float(height) != world_dims.get("height"):
		_refuse("walkability.json dimensions disagree with the world manifest")
		return false
	if typeof(walkability.get("grid")) != TYPE_STRING:
		_refuse("walkability.json grid is not a string")
		return false
	var grid := Marshalls.base64_to_raw(walkability.get("grid"))
	if grid.size() != (width * height + 7) >> 3:
		_refuse("walkability.json grid decodes to " + str(grid.size()) + " bytes; " + str((width * height + 7) >> 3) + " expected")
		return false

	# Anchor POIs from the world artifact, for dungeon binding checks.
	var world_v: Variant = _read_json_dict(world_dir, "world.json")
	if world_v == null:
		return false
	var pois_v: Variant = _array_in(world_v, "pois", "world.json")
	if pois_v == null:
		return false
	var poi_cells := {}
	for poi_v: Variant in (pois_v as Array):
		if typeof(poi_v) != TYPE_DICTIONARY:
			_refuse("world.json pois contains a non-object entry")
			return false
		var poi: Dictionary = poi_v
		if not _is_int(poi.get("id")) or not _int_pair(poi.get("cell")):
			_refuse("world.json poi entry lacks integer id or cell")
			return false
		poi_cells[poi.get("id")] = poi.get("cell")

	var placement_count := 0
	for placement_v: Variant in placements_arr:
		if typeof(placement_v) != TYPE_DICTIONARY:
			_refuse("placements.json placements contains a non-object entry")
			return false
		var placement: Dictionary = placement_v
		var id := str(placement.get("id"))
		var rule: Variant = placement.get("rule")
		# Obligation 5: unknown enum values are errors, never defaults.
		if typeof(rule) != TYPE_STRING or not placement_rules.has(rule):
			_refuse(id + " carries unknown rule " + str(rule) + " (format-" + str(int(pack_format)) + " rules: " + ", ".join(placement_rules) + ")")
			return false
		if not _int_pair(placement.get("accessCell")) or not _int_pair(placement.get("cell")):
			_refuse(id + " cell/accessCell is not an integer pair")
			return false
		var access: Array = placement.get("accessCell")
		if not _walkable(grid, width, height, int(access[0]), int(access[1])):
			_refuse(id + " access cell is not walkable")
			return false
		if rule == "world_boss.v1":
			if not _int_pair(placement.get("arenaOrigin")) or not _is_int(placement.get("arenaSide")):
				_refuse(id + " carries no arena")
				return false
			var origin: Array = placement.get("arenaOrigin")
			var side := int(placement.get("arenaSide"))
			for y in range(int(origin[1]), int(origin[1]) + side):
				for x in range(int(origin[0]), int(origin[0]) + side):
					if not _walkable(grid, width, height, x, y):
						_refuse(id + " arena cell is not walkable")
						return false
		if rule == "dungeon_binding.v1":
			if not _is_int(placement.get("anchorPoiId")):
				_refuse(id + " binds no anchor poi")
				return false
			var anchor_id: Variant = placement.get("anchorPoiId")
			if not poi_cells.has(anchor_id):
				_refuse(id + " binds anchor poi #" + str(int(anchor_id)) + " which does not exist in the world pack")
				return false
			var anchor_cell: Array = poi_cells[anchor_id]
			var cell: Array = placement.get("cell")
			if anchor_cell[0] != cell[0] or anchor_cell[1] != cell[1]:
				_refuse(id + " anchor poi #" + str(int(anchor_id)) + " moved")
				return false
		placement_count += 1

	var territory_cells := 0
	for territory_v: Variant in territories_arr:
		if typeof(territory_v) != TYPE_DICTIONARY:
			_refuse("territories.json territories contains a non-object entry")
			return false
		var territory: Dictionary = territory_v
		var id := str(territory.get("id"))
		var cells_v: Variant = _dict_in(territory, "cells", id)
		if cells_v == null:
			return false
		var cells: Dictionary = cells_v
		if cells.get("encoding") != "runs":
			_refuse(id + " carries unknown cells encoding " + str(cells.get("encoding")) + " (format 1: runs)")
			return false
		var pressure: Variant = territory.get("respawnPressure")
		if typeof(pressure) != TYPE_STRING or not RESPAWN_PRESSURES.has(pressure):
			_refuse(id + " carries unknown respawnPressure " + str(pressure) + " (format 1: " + ", ".join(RESPAWN_PRESSURES) + ")")
			return false
		var runs_v: Variant = _array_in(cells, "runs", id + ".cells")
		if runs_v == null:
			return false
		var seen := {}
		for run_v: Variant in (runs_v as Array):
			if typeof(run_v) != TYPE_ARRAY:
				_refuse(id + " has a non-array run")
				return false
			var run: Array = run_v
			if run.size() != 3 or not _is_int(run[0]) or not _is_int(run[1]) or not _is_int(run[2]):
				_refuse(id + " has a run that is not integer [x, y, length]")
				return false
			var x := int(run[0])
			var y := int(run[1])
			var length := int(run[2])
			if x < 0 or y < 0 or length < 1 or y >= height or x + length > width:
				_refuse(id + " run [" + str(x) + ", " + str(y) + ", " + str(length) + "] leaves the grid (runs never cross rows)")
				return false
			for i in range(length):
				var index := y * width + x + i
				seen[index] = true
				if not _walkable(grid, width, height, x + i, y):
					_refuse(id + " territory cell is not walkable")
					return false
		if territory.get("cellCount") != seen.size():
			_refuse(id + " cellCount " + str(territory.get("cellCount")) + " does not match its runs (" + str(seen.size()) + ")")
			return false
		territory_cells += seen.size()

	print("verify-content-pack: OK — %d placements, %d territory cells against %dx%d reference walkability" % [
		placement_count, territory_cells, width, height,
	])
	return true
