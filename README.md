# Uncatalogued Human — web gallery

A walkable virtual gallery that runs in the browser, no download needed.
It is a web re-creation of a [BAPALON](https://akuma-kira.itch.io/bap) project: it reads the same folders and the same `CF.ini` the original engine uses.

Controls: **W A S D** walk · **mouse** look · **Esc** pause · **F4** fullscreen · **F9** screenshot · **M** mute.
On phones: left thumb to walk, right thumb to look, `II` button to pause.
Walk into the artwork in the middle of a room to move to the next room.

---

## 1. What is in this folder

```
index.html          the page (you rarely need to touch this)
CF.ini              settings, same as the original game
js/                 the viewer code (three.js is included, nothing is downloaded from elsewhere)
DATA/
  TITLE/            menu, splash screens, pause screen, UI sounds, menu music (LOOP.mp3)
  NIGHT_1/
    ROOM_1/         ART.jpg, WALL.png, FLOOR.png, ROOF.png, MINI.png, CREDIT.png, FOOT.wav, MUSIC.mp3
    ROOM_2/ ... ROOM_9/
```

## 2. Put it on GitHub Pages (free)

1. Sign in (or sign up) at <https://github.com>.
2. Click **+** (top right) → **New repository**. Name it something like `uncatalogued-human`, set it to **Public**, tick **Add a README file**, and click **Create repository**.
3. Unzip this package on your computer.
4. In your new repository click **Add file → Upload files** and drag things in **in two or three batches**. GitHub's web uploader takes up to about 100 files at a time and up to 25 MB per file (every file here is well under that). Dragging a *folder* keeps its structure.
   - batch 1: `index.html`, `CF.ini`, `README.md` and the `js` folder → scroll down and click **Commit changes**
   - batch 2: the whole `DATA` folder (87 files) → **Commit changes**
   - if GitHub complains that it is too many files, upload `DATA/TITLE` first, then the rooms a few at a time (`ROOM_1`–`ROOM_3`, `ROOM_4`–`ROOM_6`, `ROOM_7`–`ROOM_9`). When you drag a room folder, GitHub keeps the path, but check afterwards that the rooms ended up inside `DATA/NIGHT_1/` (see section 1).
   *Prefer a tool?* [GitHub Desktop](https://desktop.github.com) handles any number of files in one go: clone the repo, copy the files in, commit, push.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and **Save**.
6. Wait a minute or two. The page shows your link, `https://YOUR-USERNAME.github.io/uncatalogued-human/`. Open it and click through.

Share that link anywhere, or embed it on another site:

```html
<iframe src="https://YOUR-USERNAME.github.io/uncatalogued-human/" width="800" height="600"
        allow="fullscreen; autoplay" style="border:0"></iframe>
```

## 3. Replace the placeholder music

Each room plays the file called **`MUSIC`** inside its own folder, and the menu plays `DATA/TITLE/LOOP`.

1. Export your track as **.mp3** (best for the web; .ogg and .wav also work, MIDI does not).
2. Name it exactly **`MUSIC.mp3`** (capitals matter on GitHub — `music.mp3` will *not* be found).
3. On GitHub open the room's folder (`DATA/NIGHT_1/ROOM_3`), click **Add file → Upload files**, drop in the new `MUSIC.mp3` and commit. A file with the same name replaces the old one.
4. Wait a minute for the site to update. If you still hear the old track, refresh with **Ctrl+F5** (Cmd+Shift+R on Mac).

Tips: a 3–4 minute track at 128–192 kbps is only 3–6 MB. Keep each file under 25 MB for web uploads. If you save as `.ogg` instead, delete the old `MUSIC.mp3` (the site tries mp3 first, then ogg, then wav).
Browsers only allow one music track at a time, which matches the original engine.

## 4. Change or add rooms

- **Replace artwork:** upload a new `ART.jpg` (or `ART.png`) to the room folder. Around 2000 px wide is plenty; much larger just makes the page slower to load.
- **Replace any texture or sound:** same idea. Same name, same folder.
- **Add a room:** make `ROOM_10` (the next number) inside `DATA/NIGHT_1/` with at least `ART`, `WALL`, `FLOOR`. The viewer finds rooms by counting folders, exactly like the original. Add a `[NIGHT_1_ROOM_10]` block to `CF.ini` for its settings (copy another room's block).
- **Add a night:** make `DATA/NIGHT_2/ROOM_1/...`, widen `DATA/TITLE/NIGHT.png` with one extra frame per night (same as the original README), and add `[NIGHT_2_ROOM_1]` blocks to `CF.ini`.
- Images can be `.png` or `.jpg`. Audio can be `.mp3`, `.ogg` or `.wav`.
- Optional files: `WALL2/3/4` (alternate walls: right, back, left), `LAYER` (screen overlay, animated if `Layer_Frames` > 1), `INTERACT` (picture shown when you look at the art), `MINI` (4-frame strip, runs around the room).

## 5. Settings (`CF.ini`)

Everything from the original engine is supported: `size`, `speed`, `FOV`, `Texture_Repeat`, `Room_Height`, `Layer_Frames`, `Fog_Color`, `Fog_End`, `Mini_speed`, and in `[SETTINGS]`: `Sensitivity`, `Splash1len`, `Splash2len`, `Shake_Effects`, `Head_Bob`.

Extra options for the web version (all optional):

| Where | Key | What it does |
|---|---|---|
| `[SETTINGS]` | `Title=` | Text on the "click to enter" screen |
| `[SETTINGS]` | `Exit_URL=` | Where the LEAVE button goes (e.g. your music page). Default: back to the start screen |
| `[SETTINGS]` | `Skip_Splash=1` | Skip the two splash images |
| `[SETTINGS]` | `Resolution_Scale=2` | Sharper picture (1 = classic 640×480 look, 2 = crisper, slower on weak devices) |
| each room | `Art_Scale=1.2` | Make the artwork bigger/smaller |
| each room | `Art_Fog=1` | Let the fog hide the artwork too (by default the art stays visible inside fog) |

Edit `CF.ini` on GitHub (click the file → pencil icon → **Commit changes**).

Deep links: add `?room=3` to the URL to start in a specific room (e.g. `.../uncatalogued-human/?room=3`).

## 6. Test on your own computer first (optional)

Browsers block files opened straight from a folder, so run a tiny local server. With Python installed:

```
cd path/to/this/folder
python -m http.server 8000
```

then open <http://localhost:8000>. (Double-clicking `index.html` will show an error message instead; that is expected.)

## 7. Troubleshooting

- **Blank / "could not find ROOM_1"**: the folders are not in the right place. `DATA/NIGHT_1/ROOM_1/` must be directly under the repository root.
- **A texture or sound is missing in one room**: check the spelling and capitals of the file name on GitHub (`ART.jpg`, not `Art.JPG`).
- **No sound until I click**: normal, browsers require a click first — that is the "click to enter" screen.
- **Mouse stops turning after Esc**: click the picture once, or press Resume.
- The site works best in Chrome, Edge, Firefox and Safari. Phones work in landscape.

## Credits

- Built with **BAPALON** by KIRA LLC (<https://akuma-kira.itch.io/bap>), engine © KIRA LLC, based on **SOUP** by 丼 / Don (yarhalla).
- This web viewer is an unofficial re-creation of how BAPALON loads rooms; it contains none of the original engine's code. Layout, hotspots and file formats follow the BAPALON README.
- Rendering by [three.js](https://threejs.org) (MIT licence), included as `js/three.module.min.js`.
- Artwork, music and menu graphics belong to their creators (see each room's `CREDIT.png`).
