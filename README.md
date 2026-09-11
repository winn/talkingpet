# Paint Momo

A responsive pet-painting studio for children aged 8 and up. Choose a Mini Cat or Mini Dog, paint its texture, build a personality prompt with presets, then meet the pet in the existing hosted chat experience.

## Develop

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
cp .env.example .env   # then fill in your Supabase URL and publishable key
npm run dev
```

Open the local address printed by Vite. The previous plain-file server workflow has been replaced by a bundled Vite build; fonts and 3D libraries now ship with the app.

## Build and verify

```sh
npm run build
npm test
npm run test:e2e
```

Serve or deploy the `dist` directory. The build copies the model and painting-guide assets to their stable paths. Browser checks use installed Google Chrome, including mobile emulation and actual multi-touch input through the browser protocol.

## Creation and editing

- Choose one of two animals. Choose or type a name.
- Paint directly on the pet, or use the coloring sheet. Undo/redo includes fills, erasing and image stamps.
- After painting, edit the pet's name and choose their gender, personality, activity and speaking style. Name changes update the recipe and practice reply immediately, then persist with Save. Optional custom instructions augment the presets.
- The prompt recipe explains how the choices turn into instructions. The practice preview is explicitly a sample; live AI replies happen in chat.
- Saved pet cards provide separate **Edit colors**, **Edit prompt**, and **Talk** actions. Editing prompts preserves textures and previews; editing colors preserves prompts and gender.
- Tap **Backdrop** in the pet view to choose a solid color or one of six images: Sunny room, Flower sky, Magic world, Cozy apartment, Dreamy bedroom, and Sweet kitchen. The choice is saved per pet and restored in painting, saved previews, and talk. The saved color remains underneath as a fallback. Add future room images to `assets/backgrounds/` and register their stable IDs and labels in `src/backgrounds.js`, with Thai labels in `src/locales/th.js`.
- Legacy `minicat_f`, `minicat_m`, `minidog_f`, and `minidog_m` records retain their gender/voice mapping. Pets without a room selection keep their saved solid color.

## Talk mode controls

While talking, the pet can be posed without involving the AI:

- Press on the pet, hold, and drag sideways to spin it. One drag across the screen is a full turn. **Bigger** and **Smaller** change its size, as do a pinch or the mouse wheel. Double tap or **Reset view** restores the default pose.
- The tray at the bottom has **View**, then **Moves** (wave, sawasdee, jump, spin, clap, yay, dance, laugh, think, look around, sleepy, relax) and **Faces** (happy, surprised, sad, angry, relaxed, calm). One tap plays the move or sets the expression immediately.

These controls use the public `playAnimation` and `setEmotion` calls and the scene group the hosted widget exposes on `window.WebAvatar`. The widget's source is still not read or modified; if a widget update removes those globals the tray hides itself and chat keeps working. The moves are humanoid clips retargeted onto the pets, so the curated list in `src/talk-controls.js` favours ones that read well on four legs. Dragging is ignored in the widget's AR mode, where the device drives the camera.

## Controls

On phones and compact landscape layouts, tap **3D preview** above the coloring sheet to show a small live pet. Tap again to hide it. The preview can rotate and zoom while the sheet keeps its painting tool, zoom, and undo history. Desktop keeps both full-size views.

| Surface                      | One pointer | Two fingers   | Wheel           |
| ---------------------------- | ----------- | ------------- | --------------- |
| Pet, drawing tool            | Paint       | Turn and zoom | Zoom            |
| Pet, Move tool               | Turn        | Turn and zoom | Zoom            |
| Mobile 3D preview            | Turn        | Turn and zoom | Zoom            |
| Coloring sheet, drawing tool | Paint       | Pan and zoom  | Zoom at pointer |
| Coloring sheet, Move tool    | Pan         | Pan and zoom  | Zoom at pointer |

A second pointer cancels the pending paint stroke before navigating. Painting resumes only after all fingers lift and a fresh stroke begins. Pointer cancellation restores the preceding texture. The sheet has Fit controls and the pet has Reset view. Page zoom is disabled on mobile while in-canvas zoom remains available.

Picture stamps use pointer controls for dragging, scaling and rotating on mouse and touch. Stamp and Cancel actions stay outside the rotating image. More tools contains the picture importer, mirror painting and clearing colors.

Close More tools with its × button, Escape, or a tap outside; selecting an action also closes it. Mirror painting shows a draggable ↔ handle on the coloring sheet. Move the line left or right to change the reflection axis, including while zoomed. Arrow keys adjust it by 1% (Shift: 10%); Home and End move to the edges. Moving the line never paints, and a new editing session resets it to the center.

## Storage and chat boundaries

Pets are stored in Supabase, in the `public.pets` table (`src/pet-db.js`). Each row keeps the whole pet record as JSON, tagged with a per-browser device ID that is generated once and kept in `localStorage` (`paintmomo.deviceId`). The app sends that ID as an `x-device-id` header and row level security limits every read and write to rows with the same ID, so a browser still only sees the pets it created. Save success is reported only when the Supabase request completes; a failed save leaves the draft available for retry. Clearing site data creates a new device ID and hides earlier pets.

The schema lives in `supabase/migrations/`. Apply it to your project with the Supabase CLI or the SQL editor, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` (see `.env.example`). On Vercel, add the same two variables to the project environment.

The remote `chat-widget.js` is loaded as an opaque third-party dependency. Its source was not read or modified. Integration uses the existing config and lifecycle calls. The surrounding talk surface adopts the saved background and provides a connection-error message. The widget's redundant fullscreen button is hidden because this screen already occupies the viewport. Live calling still depends on the hosted service, network and microphone permission.

Automated tests stub the external widget at its integration boundary, without loading its source, and verify local persistence, legacy migration, independent edits, mobile layouts, gesture cancellation, stamping and keyboard focus. A separate manual browser check verified the real widget rendered the avatar over the saved background; voice calls were not exercised.

## Artwork

The interface uses portraits rendered from the repository's own VRM assets. To regenerate them, start the dev server on port 8090 and run `node tools/render-portraits.mjs`. No model or facial texture assets are changed by portrait rendering.

### Thai and English

Use the **English / ไทย** buttons in each screen's header. The language choice is saved on this device. Menus, tool hints, dialogs, preset choices, the highlighted prompt recipe and practice replies switch together. Thai fonts are bundled locally.

Names and custom instructions stay exactly as written. Structured recipes are generated in the selected language when saving a prompt or starting a chat; color-only edits preserve the saved prompt and its language. Legacy free-text prompts are retained, with an explicit conversation-language instruction added when chatting. Changing language during a call updates the app immediately; the next conversation uses the new language without interrupting the current call.

The known rendered chat controls and account labels are translated through a narrowly scoped DOM adapter. It does not read or modify `chat-widget.js`, translate chat transcripts, or change account values. The real widget's Thai control labels were verified, but live voice responses were not tested.
