svgtoeagle
==========

Online converter from SVG to Eagle CAD scripts. Runs entirely in the browser, nothing is uploaded.

[TRY IT NOW!](https://hazarkarabay.github.io/svgtoeagle/)

Features:

* Outputs real Eagle polygons (no hatching or bitmaps), so board files and gerbers stay small
* Handles holes at any nesting depth (a dot inside an "O" stays a dot), joined to their outline with thin slits since Eagle polygons can't have holes
* Reads paths, rects, circles, ellipses, lines, polylines and polygons, with transforms, CSS styles and fill rules applied. No ungrouping or "Object to path" needed, except for text
* Filled shapes become polygons, strokes become wires with their real stroke width
* Tolerance setting trades accuracy for simpler geometry, which Eagle and Gerber output handle much better
* Polygons are inset by half the trace width so the final shape keeps its SVG size
* Output size box scales the drawing to fit a width x height in mm, keeping the aspect ratio
* Board or library output, optional split to layers by fill color, signal names on copper layers only
* Can leave the result attached to the cursor in Eagle for placing
* Shows output complexity (polygons, wires, vertices, script size) and warns about skipped text and dropped shapes

Usage:

1. If the SVG contains text, convert it to paths first (Inkscape: select all, Path -> Object to path)
2. Choose the SVG file, set the Eagle layer and other options, click Convert
3. Copy the script into Eagle's command box, or for large scripts download it and run it with File -> Execute Script

The tool assumes 0,0 is at the bottom left of your board in Eagle.
Only tested on Eagle 7.x. Your mileage with Fusion Electronics may vary.

Credits
-------

Fork of [gfwilliams/svgtoeagle](https://github.com/gfwilliams/svgtoeagle) by Gordon Williams, with HTML design by [Pnoxi](https://github.com/Pnoxi/svgtoeagle).

Uses [Clipper 6.4.2](https://www.npmjs.com/package/clipper-lib) (Boost license) for polygon operations and [simplify-js](https://github.com/mourner/simplify-js) (BSD) for simplification.
