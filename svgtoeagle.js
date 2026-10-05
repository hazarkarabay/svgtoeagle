var container, canvas, ctx;
var FLIP_HORIZ = true;
var SCALE = 1 / 90;
var DRAWSCALE = 1 / SCALE;
var SAMPLES_PER_MM = 20; // curves are sampled this densely, then simplified down to TOLERANCE
var TOLERANCE = 0.01; // max deviation from the SVG outline, in mm
var TRACEWIDTH = 0.1; // in mm
var CLIPPER_SCALE = 1e4; // Clipper works in integers, so mm * this
var POINTS_PER_LINE = 8; // Eagle's parser chokes on very long lines
var PASTE_LIMIT = 16384; // this is a guess

// Start file download.
function download_script(filename, text) {
	var text = document.getElementById("result").value;
	var element = document.createElement('a');

	if (typeof filename === 'undefined') {
		filename = 'import_svg.scr';
	} else {
		var patternFileName = /([^\\\/]+)\.svg$/i;
		var filename = filename.match(patternFileName)[1] + ".scr";
	}

	element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
	element.setAttribute('download', filename);
	element.style.display = 'none';
	document.body.appendChild(element);
	element.click();

	document.body.removeChild(element);
}

function copy_script() {
	var text = document.getElementById("result").value;
	var btn = document.getElementById("copy-btn");
	function done(ok) {
		btn.textContent = ok ? "Copied!" : "Copy failed, select the text and press Ctrl+C";
		setTimeout(function () { btn.textContent = "Copy to clipboard"; }, 2000);
	}
	navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
}

function isCopper(layer) {
	return /^(1[0-6]?|[2-9]|top|bottom|route\d+)$/i.test(String(layer).trim());
}

function isBottom(layer) {
	layer = String(layer).trim();
	var n = parseInt(layer);
	return /^(bottom|b[a-z]+)$/i.test(layer) || n == 16 || n == 52 || (n >= 22 && n <= 42 && n % 2 == 0);
}

function updateFormHints() {
	var layer = document.getElementById("eagleLayer").value;
	var board = document.querySelector('input[name="eagleformat"]:checked').value == "board";
	document.getElementById("signalName").disabled = !(board && isCopper(layer));
	document.getElementById("flipHint").style.display =
		isBottom(layer) && !document.getElementById("flipImage").checked ? "" : "none";
}

function polygonArea(poly) {
	var area = 0;
	for (var i = 0; i < poly.length; i++) {
		var j = (i + 1) % poly.length;
		area += poly[i].x * poly[j].y;
		area -= poly[j].x * poly[i].y;
	}
	return area / 2;
}

// Returns [[cmd, [args]], ...]. Stops quietly at the first error, like browsers do.
function parsePathData(d) {
	var ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
	var numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
	var i = 0, cmd = null, out = [];
	function skip() { while (i < d.length && /[\s,]/.test(d[i])) i++; }
	function num() {
		skip();
		numRe.lastIndex = i;
		var m = numRe.exec(d);
		if (!m) throw "bad number";
		i = numRe.lastIndex;
		return +m[0];
	}
	// arc flags may be written without separators, eg "a1 1 0 011 1"
	function flag() {
		skip();
		var c = d[i++];
		if (c !== "0" && c !== "1") throw "bad flag";
		return +c;
	}
	try {
		for (; ;) {
			skip();
			if (i >= d.length) break;
			if (/[a-z]/i.test(d[i])) cmd = d[i++];
			else if (!cmd) throw "missing command";
			var lc = cmd.toLowerCase();
			if (!(lc in ARGS)) throw "bad command";
			var args = [];
			if (lc == "a") args = [num(), num(), num(), flag(), flag(), num(), num()];
			else for (var k = 0; k < ARGS[lc]; k++) args.push(num());
			out.push([cmd, args]);
			if (lc == "m") cmd = cmd == "m" ? "l" : "L";
			if (lc == "z") cmd = null;
		}
	} catch (e) { }
	return out;
}

// Flatten path data into [{points:[{x,y}], closed}] in the element's user units
function pathToPolylines(d, steps) {
	var subs = [], cur = null;
	var x = 0, y = 0, sx = 0, sy = 0;
	var lastCtrl = null, lastType = "";
	function ensure() {
		if (!cur || cur.closed) {
			cur = { points: [{ x: x, y: y }], closed: false };
			subs.push(cur);
		}
	}
	function lineTo(nx, ny) {
		ensure();
		x = nx; y = ny;
		cur.points.push({ x: x, y: y });
	}
	function curve(pts, evalAt) {
		var len = 0;
		for (var k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
		var n = Math.max(1, Math.min(1000, Math.ceil(len * steps)));
		for (var k = 1; k < n; k++) {
			var p = evalAt(k / n);
			lineTo(p[0], p[1]);
		}
		lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
	}
	function cubic(x1, y1, x2, y2, x3, y3) {
		var x0 = x, y0 = y;
		curve([[x0, y0], [x1, y1], [x2, y2], [x3, y3]], function (t) {
			var u = 1 - t;
			return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
			u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3];
		});
	}
	function quad(x1, y1, x2, y2) {
		var x0 = x, y0 = y;
		curve([[x0, y0], [x1, y1], [x2, y2]], function (t) {
			var u = 1 - t;
			return [u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2];
		});
	}
	// SVG spec appendix B.2.4: endpoint to center parameterization
	function arc(rx, ry, phi, fa, fs, x2, y2) {
		var x1 = x, y1 = y;
		if (x1 == x2 && y1 == y2) return;
		rx = Math.abs(rx); ry = Math.abs(ry);
		if (!rx || !ry) return lineTo(x2, y2);
		var cos = Math.cos(phi * Math.PI / 180), sin = Math.sin(phi * Math.PI / 180);
		var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
		var x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
		var lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
		if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
		var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
		var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
		var co = Math.sqrt(Math.max(0, num / den)) * (fa == fs ? -1 : 1);
		var cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
		var cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
		function ang(ux, uy, vx, vy) { return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); }
		var t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
		var dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
		if (!fs && dt > 0) dt -= 2 * Math.PI;
		else if (fs && dt < 0) dt += 2 * Math.PI;
		var n = Math.max(1, Math.min(1000, Math.ceil(Math.abs(dt) * Math.max(rx, ry) * steps)));
		for (var k = 1; k < n; k++) {
			var t = t1 + dt * k / n;
			lineTo(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
				cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
		}
		lineTo(x2, y2);
	}

	parsePathData(d).forEach(function (c) {
		var cmd = c[0], a = c[1], C = cmd.toUpperCase();
		var ox = cmd == C ? 0 : x, oy = cmd == C ? 0 : y;
		var ctrl = null, type = "";
		switch (C) {
			case "M":
				x = sx = ox + a[0]; y = sy = oy + a[1];
				cur = { points: [{ x: x, y: y }], closed: false };
				subs.push(cur);
				break;
			case "L": lineTo(ox + a[0], oy + a[1]); break;
			case "H": lineTo(ox + a[0], y); break;
			case "V": lineTo(x, oy + a[0]); break;
			case "C":
			case "S":
				var c1 = C == "C" ? [ox + a[0], oy + a[1]] :
					lastType == "C" ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
				var r = C == "C" ? a.slice(2) : a;
				ctrl = [ox + r[0], oy + r[1]]; type = "C";
				cubic(c1[0], c1[1], ctrl[0], ctrl[1], ox + r[2], oy + r[3]);
				break;
			case "Q":
			case "T":
				ctrl = C == "Q" ? [ox + a[0], oy + a[1]] :
					lastType == "Q" ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
				var e = C == "Q" ? a.slice(2) : a;
				type = "Q";
				quad(ctrl[0], ctrl[1], ox + e[0], oy + e[1]);
				break;
			case "A": arc(a[0], a[1], a[2], a[3], a[4], ox + a[5], oy + a[6]); break;
			case "Z":
				if (cur) cur.closed = true;
				x = sx; y = sy;
				break;
		}
		lastCtrl = ctrl; lastType = type;
	});
	subs.forEach(function (s) {
		var p = s.points;
		if (s.closed && p.length > 1 && p[0].x == p[p.length - 1].x && p[0].y == p[p.length - 1].y) p.pop();
	});
	return subs;
}

function shapeToPathData(el) {
	function v(name) { return el[name].baseVal.value; }
	switch (el.localName) {
		case "path": return el.getAttribute("d") || "";
		case "line": return `M${v("x1")} ${v("y1")}L${v("x2")} ${v("y2")}`;
		case "polyline": return "M" + (el.getAttribute("points") || "");
		case "polygon": return "M" + (el.getAttribute("points") || "") + "Z";
		case "circle":
		case "ellipse":
			var rx = el.localName == "circle" ? v("r") : v("rx");
			var ry = el.localName == "circle" ? v("r") : v("ry");
			var cx = v("cx"), cy = v("cy");
			return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
		case "rect":
			var x = v("x"), y = v("y"), w = v("width"), h = v("height");
			var rx = el.hasAttribute("rx") ? v("rx") : el.hasAttribute("ry") ? v("ry") : 0;
			var ry = el.hasAttribute("ry") ? v("ry") : rx;
			rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
			if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
			return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
				`A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
				`V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
	}
	return "";
}

// Merge rings (in mm) using the SVG fill rule, then shrink by 'inset' mm because Eagle's outline
// pen grows it back. Returns [{outer, holes}] with any nesting depth flattened out.
function fillRings(rings, fillRule, inset, arcTolerance) {
	var c = new ClipperLib.Clipper();
	c.StrictlySimple = true;
	c.AddPaths(rings.map(function (r) {
		return r.map(function (p) { return { X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }; });
	}), ClipperLib.PolyType.ptSubject, true);
	var tree = new ClipperLib.PolyTree();
	var ft = fillRule == "evenodd" ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
	if (inset > 0) {
		var merged = [];
		c.Execute(ClipperLib.ClipType.ctUnion, merged, ft, ft);
		var co = new ClipperLib.ClipperOffset(2, Math.max(0.25, arcTolerance * CLIPPER_SCALE));
		co.AddPaths(merged, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
		co.Execute(tree, -inset * CLIPPER_SCALE);
	} else {
		c.Execute(ClipperLib.ClipType.ctUnion, tree, ft, ft);
	}
	function toMM(path) {
		return path.map(function (p) { return { x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }; });
	}
	return ClipperLib.JS.PolyTreeToExPolygons(tree).map(function (ep) {
		return { outer: toMM(ep.outer), holes: ep.holes.map(toMM) };
	});
}

// Eagle polygons can't have holes, so join each hole to the outline with a thin slit.
// Bridge search is ported from earcut (ISC, Mapbox) so slits never cross other edges.
function bridgeHoles(outer, holes, slitGap) {
	function node(p) { return { x: p.x, y: p.y, prev: null, next: null }; }
	function ring(pts, wantPositive) {
		if ((polygonArea(pts) > 0) != wantPositive) pts = pts.slice().reverse();
		var first = null, last = null;
		pts.forEach(function (p) {
			var n = node(p);
			if (last) { last.next = n; n.prev = last; } else first = n;
			last = n;
		});
		last.next = first; first.prev = last;
		return first;
	}
	function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
	function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
		return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
			(ax - px) * (by - py) >= (bx - px) * (ay - py) &&
			(bx - px) * (cy - py) >= (cx - px) * (by - py);
	}
	function locallyInside(a, b) {
		return area(a.prev, a, a.next) < 0 ?
			area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
			area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
	}
	function sectorContainsSector(m, p) {
		return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
	}
	function findHoleBridge(hole, outerNode) {
		var p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
		do {
			if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
				var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
				if (x <= hx && x > qx) {
					qx = x;
					m = p.x < p.next.x ? p : p.next;
					if (x === hx) return m;
				}
			}
			p = p.next;
		} while (p !== outerNode);
		if (!m) return null;
		var stop = m, mx = m.x, my = m.y, tanMin = Infinity;
		p = m;
		do {
			if (hx >= p.x && p.x >= mx && hx !== p.x &&
				pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
				var tan = Math.abs(hy - p.y) / (hx - p.x);
				if (locallyInside(p, hole) &&
					(tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
					m = p;
					tanMin = tan;
				}
			}
			p = p.next;
		} while (p !== stop);
		return m;
	}
	// Move n slightly towards 'to', so the two sides of a slit don't sit exactly on top of each other
	// (Eagle reports an invalid polygon on copper layers if they do)
	function nudge(n, to) {
		var dx = to.x - n.x, dy = to.y - n.y, d = Math.hypot(dx, dy);
		var amt = Math.min(slitGap, d / 3);
		if (d) { n.x += dx * amt / d; n.y += dy * amt / d; }
	}
	function split(a, b) {
		var a2 = node(a), b2 = node(b), an = a.next, bp = b.prev;
		a.next = b; b.prev = a;
		a2.next = an; an.prev = a2;
		b2.next = a2; a2.prev = b2;
		bp.next = b2; b2.prev = bp;
		nudge(a, a.prev); nudge(b, b.next);
		nudge(b2, b2.prev); nudge(a2, a2.next);
	}

	var outerNode = ring(outer, true);
	var lost = 0;
	holes.map(function (h) {
		var n = ring(h, false), p = n, left = n;
		do {
			if (p.x < left.x || (p.x === left.x && p.y < left.y)) left = p;
			p = p.next;
		} while (p !== n);
		return left;
	}).sort(function (a, b) { return a.x - b.x; }).forEach(function (hole) {
		var bridge = findHoleBridge(hole, outerNode);
		if (bridge) split(bridge, hole);
		else lost++;
	});
	var pts = [], p = outerNode;
	do { pts.push({ x: p.x, y: p.y }); p = p.next; } while (p !== outerNode);
	return { points: pts, lost: lost };
}

// width in mm, so the preview matches what Eagle draws
function plotPoly(points, isFilled, width) {
	ctx.lineWidth = Math.max(1, width * DRAWSCALE);
	ctx.beginPath();
	ctx.moveTo(points[0].x * DRAWSCALE, points[0].y * DRAWSCALE);
	for (var i = 1; i < points.length; i++)
		ctx.lineTo(points[i].x * DRAWSCALE, points[i].y * DRAWSCALE);
	if (isFilled) {
		ctx.closePath();
		ctx.fill();
	}
	ctx.stroke();
}

function drawSVG() {
	if (container === undefined) return;
	TRACEWIDTH = parseFloat(document.getElementById("traceWidth").value);
	TOLERANCE = parseFloat(document.getElementById("tolerance").value) || 0;
	FLIP_HORIZ = document.getElementById("flipImage").checked;
	var LAYER_COLOR = document.getElementById("layerColor").checked;
	var PICK_UP = document.getElementById("pickUp").checked;
	var EAGLE_LAYER = document.getElementById("eagleLayer").value;
	var SIGNAL_NAME = document.getElementById("signalName").value;
	var EAGLE_FORMAT = document.querySelector('input[name="eagleformat"]:checked').value;

	container.style.display = "block";

	var logarea = document.getElementById("log");
	logarea.innerHTML = "";
	logarea.style.display = 'none';
	function log(x) {
		logarea.innerHTML += x + "\n";
		logarea.style.display = 'block';
	}

	var dimensions_area = document.getElementById("dimensions");
	dimensions_area.innerHTML = "";
	function dimensions_log(x) {
		dimensions_area.innerHTML += x + "\n";
	}

	var textarea = document.getElementById("result");
	textarea.value = "";
	document.getElementById("dwn-btn").disabled = true;
	document.getElementById("copy-btn").disabled = true;
	var output = [];
	function out(x) {
		output.push(x);
	}
	var viewBox = container.viewBox.baseVal;
	var size = viewBox;
	if (!size || size.width == 0 || size.height == 0) {
		size = {
			width: container.width.baseVal.value,
			height: container.height.baseVal.value
		};
	}

	var currentLayer = EAGLE_LAYER;
	var layersUsed = {};
	function ChangeLayer(LayerID) {
		currentLayer = LayerID;
		layersUsed[LayerID] = true;
		if (EAGLE_FORMAT == "board") {
			out("CHANGE layer " + LayerID + "; CHANGE rank 3; CHANGE pour solid; SET WIRE_BEND 2;\n");
		} else if (EAGLE_FORMAT == "library") {
			out("CHANGE layer " + LayerID + "; CHANGE pour solid; SET WIRE_BEND 2;\n");
		}
	}

	var COLOR_MAPPING_OFFSET = 0;
	var COLOR_MAPPING = {};

	function LookupLayerForFillColor(fillColor) {
		if (!COLOR_MAPPING.hasOwnProperty(fillColor))
			COLOR_MAPPING[fillColor] = Number(EAGLE_LAYER) + COLOR_MAPPING_OFFSET++;

		return COLOR_MAPPING[fillColor];
	}

	var UNITS = { mm: 1, cm: 10, "in": 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };
	var specifiedWidth = (container.getAttribute("width") || "").match(/^\s*([0-9.]+)\s*(mm|cm|in|pt|pc)\s*$/);
	if (specifiedWidth) {
		SCALE = parseFloat(specifiedWidth[1]) * UNITS[specifiedWidth[2]] / size.width;
		dimensions_log("SVG width detected in " + specifiedWidth[2]);
	} else {
		SCALE = 25.4 / 96;
		log("SVG width not in physical units - assuming 96 DPI, set the output size to resize");
	}
	var bbox = container.getBBox();
	var fitW = parseFloat(document.getElementById("outWidth").value);
	var fitH = parseFloat(document.getElementById("outHeight").value);
	var fit = Math.min(fitW > 0 ? fitW / (bbox.width * SCALE) : Infinity, fitH > 0 ? fitH / (bbox.height * SCALE) : Infinity);
	if (isFinite(fit)) SCALE *= fit;
	dimensions_log(`Drawing ${(bbox.width * SCALE).toFixed(2)}mm x ${(bbox.height * SCALE).toFixed(2)}mm, page ${(size.width * SCALE).toFixed(2)}mm x ${(size.height * SCALE).toFixed(2)}mm`);

	var exportHeight = size.height * SCALE;
	var originX = viewBox ? viewBox.x : 0;
	var originY = viewBox ? viewBox.y : 0;

	var drawMultiplier = (window.innerWidth - 40) / size.width;
	canvas.width = size.width * drawMultiplier;
	canvas.height = size.height * drawMultiplier;
	DRAWSCALE = drawMultiplier / SCALE;

	out("GRID MM;\n");
	ChangeLayer(EAGLE_LAYER);

	function fmt(n) { return String(+n.toFixed(4)); }
	var stats = { polygon: 0, wire: 0, vertices: 0, maxVertices: 0 };
	var extent = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
	function writeCommand(cmd, width, points) {
		stats[cmd]++;
		stats.vertices += points.length;
		stats.maxVertices = Math.max(stats.maxVertices, points.length);
		var line = cmd + (EAGLE_FORMAT == "board" && isCopper(currentLayer) ? " " + SIGNAL_NAME : "") + " " + fmt(width) + "mm";
		points.forEach(function (p, i) {
			extent.x1 = Math.min(extent.x1, p.x - width / 2);
			extent.x2 = Math.max(extent.x2, p.x + width / 2);
			extent.y1 = Math.min(extent.y1, exportHeight - p.y - width / 2);
			extent.y2 = Math.max(extent.y2, exportHeight - p.y + width / 2);
			if (i && i % POINTS_PER_LINE == 0) line += "\n ";
			line += ` (${fmt(p.x)} ${fmt(exportHeight - p.y)})`;
		});
		out(line + ";\n");
	}
	function dedupe(points, closed) {
		var r = points.filter(function (p, i) {
			var q = points[i ? i - 1 : points.length - 1];
			return (i == 0 && !closed) || fmt(p.x) != fmt(q.x) || fmt(p.y) != fmt(q.y);
		});
		return r;
	}

	function isHidden(el) {
		for (; el && el != container.parentNode; el = el.parentElement)
			if (getComputedStyle(el).display == "none") return true;
		return false;
	}

	ctx.lineJoin = ctx.lineCap = "round";
	var col = 0;
	var thinDropped = 0;
	var els = container.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon");
	if (els.length == 0)
		log("No shapes found.");
	var anyVisiblePaths = false;
	var rootCTM = container.getScreenCTM().inverse();
	for (var i = 0; i < els.length; i++) {
		var el = els[i];
		if (el.closest("defs,clipPath,mask,symbol,marker,pattern")) continue;
		var cs = getComputedStyle(el);
		if (cs.visibility != "visible" || isHidden(el)) continue;
		var filled = cs.fill != "none";
		var strokeWidth = cs.stroke != "none" ? parseFloat(cs.strokeWidth) || 0 : 0;
		if (!filled && !strokeWidth) continue;
		anyVisiblePaths = true;
		var m = rootCTM.multiply(el.getScreenCTM());
		var unitToMM = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * SCALE;
		var subs = pathToPolylines(shapeToPathData(el), SAMPLES_PER_MM * unitToMM).map(function (s) {
			var pts = s.points.map(function (p) {
				var x = m.a * p.x + m.c * p.y + m.e - originX;
				var y = m.b * p.x + m.d * p.y + m.f - originY;
				if (FLIP_HORIZ) x = size.width - x;
				return { x: x * SCALE, y: y * SCALE };
			});
			return { points: simplify(pts, TOLERANCE, true), closed: s.closed };
		});

		if (LAYER_COLOR) {
			var targetLayer = LookupLayerForFillColor(filled ? cs.fill : cs.stroke);
			if (currentLayer != targetLayer) ChangeLayer(targetLayer);
		}
		ctx.strokeStyle = `hsl(${col += 40},100%,50%)`;
		ctx.fillStyle = `hsla(${col += 40},100%,50%,0.4)`;

		if (filled) {
			var rings = subs.map(function (s) { return s.points; }).filter(function (r) { return r.length >= 3; });
			var shapes = fillRings(rings, cs.fillRule, TRACEWIDTH / 2, TOLERANCE);
			if (rings.length && !shapes.length) thinDropped++;
			shapes.forEach(function (shape) {
				var holes = shape.holes.map(function (h) { return simplify(h, TOLERANCE, true); }).filter(function (h) { return h.length >= 3; });
				var outer = simplify(shape.outer, TOLERANCE, true);
				if (outer.length < 3) return;
				var b = bridgeHoles(outer, holes, TRACEWIDTH / 8);
				if (b.lost) log(b.lost + " hole(s) could not be joined to their outline and were left out");
				var points = dedupe(b.points, true);
				if (points.length < 3) return;
				plotPoly(points, true, TRACEWIDTH);
				// re-add first point so we loop around
				writeCommand("polygon", TRACEWIDTH, points.concat([points[0]]));
			});
		}
		if (strokeWidth) {
			var widthMM = strokeWidth * unitToMM;
			subs.forEach(function (s) {
				var points = dedupe(s.points, s.closed);
				if (points.length < 2) return;
				if (s.closed) points.push(points[0]);
				plotPoly(points, false, widthMM);
				writeCommand("wire", widthMM, points);
			});
		}
	}
	var texts = Array.prototype.filter.call(container.querySelectorAll("text"), function (t) {
		return !t.closest("defs,clipPath,mask,symbol,marker,pattern") && !isHidden(t) && t.textContent.trim();
	});
	if (texts.length)
		log(texts.length + " text object(s) were skipped. Convert them to paths first (Inkscape: Path -> Object to path)");
	if (thinDropped)
		log(thinDropped + " filled shape(s) are thinner than the trace width and were left out");
	if (!anyVisiblePaths)
		log("No shapes with fills or strokes found.");
	var drawn = stats.polygon + stats.wire > 0;
	if (PICK_UP && drawn) {
		// GROUP grabs everything inside the rectangle on visible layers, so only show ours while grouping
		var x1 = fmt(extent.x1 - 0.1), y1 = fmt(extent.y1 - 0.1), x2 = fmt(extent.x2 + 0.1), y2 = fmt(extent.y2 + 0.1);
		out("DISPLAY NONE " + Object.keys(layersUsed).join(" ") + ";\n");
		out(`GROUP (${x1} ${y1}) (${x2} ${y1}) (${x2} ${y2}) (${x1} ${y2}) (${x1} ${y1});\n`);
		out("DISPLAY LAST;\n");
	}
	if (output.length) out("GRID LAST;\n");
	// Ctrl+right click picks up the group. Left unterminated and last, so the move stays active for the user
	if (PICK_UP && drawn) out(`MOVE (C> ${x1}mm ${y1}mm)`);
	textarea.value = output.join("");
	dimensions_log(`Output: ${stats.polygon} polygons, ${stats.wire} wires, ${stats.vertices} vertices (largest ${stats.maxVertices}), script ${(textarea.value.length / 1024).toFixed(1)} KB`);
	if (textarea.value.length > PASTE_LIMIT)
		log("Generated script is large, pasting into Eagle's command box may fail. If you get unexpected errors, use 'Download Eagle Script' and run it in Eagle (File -> Execute Script). Do not double click on it, won't work that way.");
	document.getElementById("dwn-btn").disabled = output.length == 0;
	document.getElementById("copy-btn").disabled = output.length == 0;
	container.style.display = "none";
}

window.addEventListener("load", function (event) {
	container = document.getElementById("container");
	canvas = document.getElementById("can");
	ctx = canvas.getContext('2d');
	["eagleLayer", "flipImage", "board", "library"].forEach(function (id) {
		document.getElementById(id).addEventListener("input", updateFormHints);
		document.getElementById(id).addEventListener("change", updateFormHints);
	});
	updateFormHints();
	var fileLoader = document.getElementById("fileLoader");
	function unlock() {
		document.getElementById("settings").disabled = !fileLoader.files.length;
		fileLoader.classList.toggle("attention", !fileLoader.files.length);
	}
	fileLoader.addEventListener("change", unlock);
	unlock();
	//loadSVG("test.svg");
});

// load SVG from online - not used
function loadSVG(url) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (this.readyState == 4 && this.status == 200) {
			var svgs = xhr.responseXML.getElementsByTagName("svg");
			if (svgs.length) {
				var newSVG = svgs[0];
				document.getElementById("container").replaceWith(newSVG);
				container = newSVG;
				setTimeout(drawSVG, 0);
			} else alert("No SVG loaded");
		}
	};
	xhr.open("GET", url, true);
	xhr.send();
}

function convert() {
	//document.getElementById("fileLoader").onchange = function(event) {
	//if (event.target.files.length != 1) {
	//  alert("Select only one file");
	//  return;
	//}
	var fileToLoad = document.getElementById("fileLoader").files[0];

	var reader = new FileReader();
	reader.onload = function (event) {
		var div = document.createElement('div');
		div.innerHTML = event.target.result;
		var svgs = div.getElementsByTagName("svg");
		if (svgs.length) {
			var newSVG = svgs[0];
			container.replaceWith(newSVG);
			container = newSVG;
			setTimeout(drawSVG, 0);
		} else alert("No SVG loaded");
	};
	reader.readAsText(fileToLoad);
	//reader.readAsText(event.target.files[0]);
}
