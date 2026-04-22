Ankarafantsika Plant Viewer
===========================

A local herbarium image browser for field botanists.

QUICK START (Windows)
---------------------
1. Double-click start.bat
2. Chrome will open automatically at http://localhost:5173
3. Click "Select image folder" in the left sidebar
4. Navigate to your folder of herbarium JPEG images
5. Species cards will load images from that folder

NOTES
-----
- Python must be installed on your computer (python.org)
- The app runs entirely offline — no internet needed
- Your folder choice is remembered between sessions
- Filter species by Order, Family, Genus, Vernacular name, Habit, Leaf
  arrangement, Leaf form, Leaf venation, Leaf margin, Stipules and Exudate
  using the sidebar fields. Combine filters to narrow the grid.
- The Vernacular name field is a typeahead — start typing and pick from the
  suggestion list. More than one species can share the same vernacular name
  (e.g. "fig" matching every Ficus); selecting it shows all of them.
- Click any thumbnail to view the full-size image
- Use arrow keys to navigate between images in the lightbox
- Press Escape to close the lightbox

LINUX / MAC
-----------
Run: bash start.sh

EDITING SPECIES DATA (no rebuild needed)
----------------------------------------
Species data lives in CSV files under the `data/` folder next to this README
(one file per dataset, e.g. data/ankarafantsika.csv). You can edit these in
Excel, LibreOffice, or a text editor to add vernacular names, fix typos, or
add new species rows. Reload the browser tab (Ctrl+F5) and the changes appear
immediately — no rebuild required.

Columns the app reads:
  TaxonomicName      required — scientific name, used as the display label
  CatalogueNumber    required for images — matches <value>.jpg in the image
                     folder; one row per image, so a species with three
                     images has three rows with the same TaxonomicName
  Clade, Order,      optional — shown / used for filters
    Family, Genus
  VernacularName     optional — shown in brackets after the scientific name
                     and powers the vernacular typeahead filter
  Habit              optional — tree / shrub / herb / liana / epiphyte
                     (case-insensitive; "Trees" and "tree" both work)
  LeafArrangement,   optional — each one drives its own sidebar filter;
    LeafForm,          dropdown options are taken from the values present
    LeafVenation,      in the column (e.g. simple / compound, entire /
    LeafMargin,        toothed, present / absent, milky / clear / none).
    Stipules,          Leave a cell blank if you don't know — blank cells
    Exudate            are hidden only when that specific filter is active.

Other columns are ignored. Column names are case-sensitive.

IMPORTANT: save as real .csv, not .xlsx. The app cannot read Excel files and
will simply show an empty grid if the file is saved in Excel format.

Adding a whole new dataset (new CSV file plus a new entry in the Dataset
selector) does require a rebuild — ask the developer.

TROUBLESHOOTING
---------------
- If the browser does not open, manually go to http://localhost:5173
- If images do not appear, make sure you selected the correct folder
  containing .jpg files named by catalogue number (e.g. K000032574.jpg)
- The app only works in Google Chrome (File System Access API required)
