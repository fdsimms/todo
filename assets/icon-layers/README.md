# Icon layers

The app icon split into the layers Icon Composer builds a layered icon from. iOS 26
renders a layered icon as Liquid Glass; the flat `../icon.png` (with its dark and
tinted variants) is what ships until one exists.

`scripts/generate-icon.js` writes these files from the same geometry as every other
icon, so don't edit them by hand. Change the script and re-run it.

| File | What it is |
|---|---|
| `dots.svg`, `dots.png` | The two dots, ink (`#17131C`) on transparent |
| `check.svg`, `check.png` | The check, ink on transparent |

Both are on a 1024 canvas at the position they have in `icon.png`, so they stack back
into it exactly. The tile is not a file: it's the background fill you set in Icon
Composer.

## Building the `.icon` (on a Mac with Xcode 26)

1. Open Icon Composer and start a new icon.
2. Set the background fill to solid `#FFB020`.
3. Drag `dots.svg` in, then `check.svg`, as two separate groups. Keep the
   SVGs: they stay sharp at every size where the PNGs would not.
4. Leave Liquid Glass on for both groups, and check the result in Default, Dark and
   Mono. In Dark, set the background to `#17131C` and the two layers' fill to
   `#FFB020`, which matches today's `icon-dark.png`.
5. Save it as `assets/AppIcon.icon` and set `ios.icon` in `app.json` to the string
   `"./assets/AppIcon.icon"`. It has to be a string; Expo ignores a `.icon` inside
   the light/dark/tinted object. Expo copies the folder into the native project at
   prebuild, and Xcode builds the older icon sizes from it.
