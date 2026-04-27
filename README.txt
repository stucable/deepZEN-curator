deepZEN-curator  —  v0.3  (Ankarafantsika + Ranomafana, 2026-04-23)
===================================================================

Offline herbarium image browser for field botanists in Madagascar.
Ships with two datasets — Ankarafantsika and Ranomafana — switchable
from the sidebar at runtime.
Runs entirely on your laptop — no internet needed once you have the files.


QUICK START (Windows 11)
------------------------
1. Unzip this folder somewhere convenient (e.g. your Desktop).
   If the file inside is called "start.bat.txt" (it's renamed that
   way so email scanners let the zip through), right-click it →
   Rename → delete the trailing ".txt" so it becomes "start.bat".
   If Windows hides the extension, turn on "File name extensions"
   in File Explorer's View menu first.
2. Double-click start.bat.
   - If Windows SmartScreen blocks it, click "More info" then "Run anyway".
3. Google Chrome opens at http://localhost:5173.
4. At the top of the sidebar, pick the dataset you want to browse
   (Ankarafantsika is selected by default).
5. Click "Select image folder" and browse to the folder of .jpg
   images for that dataset.
6. To use the other dataset, click it in the selector and pick its
   image folder the same way. Each dataset remembers its own folder,
   so you only have to pick each one once.
7. Species cards will populate with thumbnails. Click any thumbnail to
   view the full image. Use the arrow keys in the lightbox to flip
   through images; press Escape to close.
   (The first scroll-through is slow — see FIRST USE IS SLOW below.)

Each dataset's image-folder choice is remembered between sessions. If
Chrome forgets (e.g. after a browser reset), just click "Reconnect" or
"Select image folder" again.


FIRST USE IS SLOW (THIS IS NORMAL)
----------------------------------
The first time you scroll through a dataset, the app reads your full-
size herbarium .jpg files (often 5+ MB each), shrinks them down to
small thumbnails, and saves those thumbnails inside Chrome. Expect
the first scroll-through to feel sluggish — each thumbnail takes a
moment to generate, and the disk and CPU work hard. On a typical
work laptop, plan for roughly 2 minutes to pre-warm Ankarafantsika
and roughly 5 minutes for Ranomafana (Ranomafana has more specimens).
Older laptops or slow external drives can take longer.

After that, every later session is fast: Chrome reuses the saved
thumbnails instead of re-reading the big .jpg files. Closing Chrome,
restarting the laptop, or coming back the next day all keep the
saved thumbnails — you only pay the slow cost once per dataset.

A few practical notes:
- To pre-warm the whole dataset, just scroll from top to bottom once
  while you have time. From then on, browsing is snappy.
- If you scroll partway and stop, only the thumbnails you have seen
  are saved; the rest are generated the next time you scroll past
  them.
- If a future update ships a new image (e.g. an updated specimen
  scan), only that one image will regenerate its thumbnail on next
  view; everything else stays fast.


IF PYTHON IS NOT INSTALLED
--------------------------
start.bat will tell you if Python is missing. To install it:

- Open the Microsoft Store, search for "Python 3.12", click Install.
  This does not require admin rights.
- If the Store is blocked, try Company Portal, or download from
  https://python.org (an admin may need to run the installer).

After installing, double-click start.bat again.


FILTERS
-------
The sidebar lets you narrow the grid by any combination of:

  Order, Family, Genus, Vernacular name, Habit, Leaf arrangement,
  Leaf form, Leaf venation, Leaf margin, Stipules, Exudate,
  Stem armature, Tendrils.

Notes:
- Vernacular name is a typeahead — start typing and pick from the list.
  Many species can share a vernacular name (e.g. "fig" matches every
  Ficus); selecting it shows all of them.
- Habit is a multi-select pill row (defaults to tree + shrub). A species
  with multiple habits (e.g. "climber;shrub;tree") shows under any of
  them.
- Stipules: if you pick "caducous", species recorded as "absent" are
  also shown — caducous stipules fall off early, so a field observer
  may see either. This is intentional.
- "Clear filters" resets everything and reselects tree + shrub.


EDIT THE SPECIES DATA YOURSELF
------------------------------
Each tester can maintain a personal copy of the CSV — add vernacular
names, fix typos, add new species rows — without waiting for a rebuild.
The app picks up your personal copy automatically.

Each dataset has its own CSV and its own image folder, so personal
edits for Ankarafantsika live in the Ankarafantsika image folder,
and Ranomafana edits live in the Ranomafana image folder. You can
personalise one, both, or neither — your choice.

How (repeat for each dataset you want to personalise):

1. In the app folder, open build\data\. Copy the shipped CSV for the
   dataset you want to edit into that dataset's image folder (next
   to its .jpg files):
     Ankarafantsika_herbarium_images_260422.csv
     Ranomafana_herbarium_images_260423.csv

2. Rename the copy so it starts with the same prefix as the shipped
   file, followed by your name:
     Ankarafantsika_herbarium_images_<YourName>.csv
     Ranomafana_herbarium_images_<YourName>.csv
   For example: Ankarafantsika_herbarium_images_Johny.csv
   (Capitalisation does not matter.)

3. Open your copy in Excel, make your edits, then save as CSV
   (Comma delimited, *.csv). Do NOT save as .xlsx — the app cannot
   read Excel files and will show an empty grid.

4. Reload the browser tab (Ctrl+F5). The sidebar will say:
     Using Ankarafantsika_herbarium_images_Johny.csv from this folder
   Your edits are live.

5. To go back to the shipped data, delete or rename your personal
   file and reload the tab.

6. To share edits with the other testers, email each other the CSV.
   (In a future version the data will live in a cloud database and
   sync automatically.)

If your personal CSV has a typo and cannot be parsed, an amber banner
appears naming the file, and the grid keeps showing the previously
loaded data so nothing breaks.


CSV COLUMN REFERENCE
--------------------
Columns the app reads (case-sensitive):

  TaxonomicName      required — scientific name, the display label.
  CatalogueNumber    required for images — matches <value>.jpg in
                     your image folder. One row per image, so a
                     species with three images has three rows with
                     the same TaxonomicName.
  Clade, Order,      optional — shown and used for filters.
    Family, Genus
  VernacularName     optional — shown after the scientific name and
                     powers the vernacular typeahead filter.
  Habit              optional — tree / shrub / herb / liana / epiphyte.
                     Multiple values separated by ";" (e.g.
                     "climber;shrub;tree"). "climber" is treated as
                     "liana". Case-insensitive.
  LeafArrangement,   optional — each one drives its own sidebar filter.
    LeafForm,          Dropdown options are taken from the values
    LeafVenation,      present in the column. Leave a cell blank if
    LeafMargin,        you don't know — blank cells are hidden only
    Stipules,          when that specific filter is active.
    Exudate,
    StemArmature,
    Tendrils

Any other columns are ignored.

Shipped data files:
  build\data\Ankarafantsika_herbarium_images_260422.csv
  build\data\Ranomafana_herbarium_images_260423.csv


CHROME ONLY
-----------
This app uses the browser's File System Access API to read images
from your local folder. That feature only exists in Google Chrome
(and Edge). Firefox and Safari will not work.


HOW IT WORKS (for the technically curious)
------------------------------------------
- The app is a small website — plain HTML, CSS, and JavaScript —
  that lives in the build\ folder on your laptop. It is NOT
  compiled to an .exe, and NOT WebAssembly. It is an ordinary
  web page, served from your own computer instead of the internet.

- start.bat launches a tiny local web server (Python's built-in
  http.server) that serves build\ on http://localhost:5173, then
  opens Chrome at that address. "localhost" means "this machine"
  — nothing is sent or received over the internet. You can
  unplug the network cable and it still works. Your CSV and
  image folder never leave your laptop; the browser reads them
  directly from disk through the folder picker.

- Why a browser rather than a normal installed program (.exe)?
  * Chrome already provides everything the app needs: a fast
    image viewer, the folder-picker that reads your .jpg files
    from disk, a layout engine, keyboard shortcuts. Rebuilding
    that as a desktop app would mean shipping ~100 MB of extra
    code for no visible gain.
  * An unsigned .exe on a managed Windows laptop usually trips
    SmartScreen and may need IT approval. A zip plus start.bat
    needs none of that: you unzip it and run — nothing is
    installed, nothing touches the registry, uninstalling is
    just deleting the folder.
  * The same build runs on Windows, Mac, and Linux with no
    platform-specific packaging.
  * Updates are a small zip dropped over the old folder.

- Why the local server rather than just opening an .html file?
  Chrome refuses to load JavaScript modules from file:// URLs
  for security reasons. A tiny server on localhost is the
  minimum workaround and exposes nothing to the network.

- Is it sandboxed? Yes, the app code runs inside a Chrome tab,
  so it inherits Chrome's tab sandbox: no arbitrary filesystem
  access, no ability to install drivers, no registry writes.
  The folder you pick is the only folder the app can see —
  Chrome will not let it read anywhere else on disk. The page
  only talks to localhost (itself); no internet traffic, no
  telemetry. The one unsandboxed piece is the small Python
  web server that starts.bat launches: it is stock library
  code, serves the build\ folder read-only, and is bound to
  localhost so other machines on the network cannot reach it.


REPORTING ISSUES / GETTING UPDATES
----------------------------------
- If something looks wrong (missing species, broken image, weird
  filter behaviour), email Stuart with a screenshot and the
  version number at the top of this file (v0.3).
- New versions will arrive by email as a small zip. Unzip over
  the old folder (or delete the old folder first to avoid stale
  cached files), then double-click start.bat as before.
- If only the CSV has changed, you can edit your personal copy
  (see "Edit the species data yourself" above) — no re-install
  required.


TROUBLESHOOTING
---------------
- Browser didn't open: go to http://localhost:5173 manually in Chrome.
- Images don't appear: check the image folder contains .jpg files
  named by catalogue number (e.g. K000032574.jpg). Names must match
  the CatalogueNumber column exactly, including any suffix like
  K000175461_a.
- "start.bat" disappears when double-clicked: SmartScreen may have
  blocked it. Right-click, choose Properties, tick "Unblock", OK.
- Port 5173 is already in use (rare): close any other local web
  servers and try again, or ask Stuart for a different port.
- Sidebar says "No folder selected" after a browser update: just
  click "Select image folder" again.
