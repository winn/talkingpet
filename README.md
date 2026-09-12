# Paint Momo

A responsive pet-painting studio for children aged 8 and up. Choose a Mini Cat or Mini Dog, paint its texture, build a personality prompt with presets, then meet the pet in the existing hosted chat experience.

## Develop

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
cp .env.example .env   # then fill in the Supabase and Stripe keys described below
npm run dev
```

Open the local address printed by Vite. The previous plain-file server workflow has been replaced by a bundled Vite build; fonts and 3D libraries now ship with the app.

## Build and verify

```sh
npm run build
npm test
npm run test:e2e
```

The end-to-end suite signs in through the real sign-in screen, so set `E2E_EMAIL` and `E2E_PASSWORD` in `.env` to an account created in the app (it needs a few points for the talk tests). Serve or deploy the `dist` directory. The build copies the model and painting-guide assets to their stable paths. Browser checks use installed Google Chrome, including mobile emulation and actual multi-touch input through the browser protocol.

## Creation and editing

- Choose one of two animals. Choose or type a name.
- Paint directly on the pet, or use the coloring sheet. Undo/redo includes fills, erasing and image stamps.
- After painting, edit the pet's name and choose their gender, personality, activity and speaking style. Name changes update the recipe and practice reply immediately, then persist with Save. Optional custom instructions augment the presets.
- The prompt recipe explains how the choices turn into instructions. The practice preview is explicitly a sample; live AI replies happen in chat.
- Saved pet cards provide separate **Edit colors**, **Edit prompt**, and **Talk** actions. Editing prompts preserves textures and previews; editing colors preserves prompts and gender.
- Tap **Backdrop** in the pet view to choose a solid color or one of six images: Sunny room, Flower sky, Magic world, Cozy apartment, Dreamy bedroom, and Sweet kitchen. The choice is saved per pet and restored in painting, saved previews, and talk. The saved color remains underneath as a fallback. Add future room images to `assets/backgrounds/` and register their stable IDs and labels in `src/backgrounds.js`, with Thai labels in `src/locales/th.js`.
- Legacy `minicat_f`, `minicat_m`, `minidog_f`, and `minidog_m` records retain their gender/voice mapping. Pets without a room selection keep their saved solid color.

## Memories

**Chat window** (the speech-bubble button above Settings in Talk) shows the conversation as text, messenger style, with large kid-friendly type and a box to type to the pet through the widget's public `sendUserMessage`. Its 🧠 button turns the log into permanent memories (the end-of-session summary below, run on demand) and then clears the log through the widget's public `clearHistory`. The same action runs by itself when the voice session drops, and on leaving Talk or closing the tab.

While you are talking, the chat just continues — nothing is saved mid-turn. When a talk session ends (🧠 in the chat window, voice hang-up, leaving with **My pets**, signing out, or closing the tab), the app posts the session transcript to `/api/memories/summarize`. Gemini decides what lasting facts about the child are worth keeping and invents short English snake_case keys for them (reusing a key when the same topic was already known), then stores the new or changed pairs in `public.user_memories`, scoped to the account. The chat log is cleared through the widget's public `clearHistory` (on tab close, clear runs after a keepalive summarise). The next chat's instructions include these facts so the pet can bring them up naturally.

Memories are key/value records (`birthday` → `19 March`), one per key per account, so a changed fact replaces the old one. **Settings** in Talk (the gear) and **Open memory** in the account sheet open the memory table, where the owner can add a fact by hand, **Forget** one, or **Forget everything**. Edits made during a talk reach the current chat's instructions immediately. Summarising needs a Gemini key: with `SUPABASE_SECRET_KEY` set on the server, the key saved in the admin AI keys tab is used; otherwise set `GEMINI_API_KEY` in the server environment. Without either, sessions are simply not summarised and talking works as before. Apply `supabase/migrations/20260911230000_user_memories.sql` to the project first.

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

Pets are stored in Supabase, in the `public.pets` table (`src/pet-db.js`). Each row keeps the whole pet record as JSON and belongs to the signed-in account; row level security limits every read and write to the owner. Save success is reported only when the Supabase request completes; a failed save leaves the draft available for retry. Pets follow the account to every device.

The schema lives in `supabase/migrations/`. Apply it to your project with the Supabase CLI or the SQL editor, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` (see `.env.example`). On Vercel, add the same variables to the project environment.

## Accounts, points, and payments

Everyone signs in before using the studio (`src/auth.js`, `src/account.js`). Sign-in is Supabase Auth with email + password, plus Google when the Google provider is turned on in the Supabase dashboard (Authentication → Providers; add the site URL to the redirect allow-list).

- **Points.** Every new account starts with 10 points. Talking to a pet costs 1 point (`TALK_COST` in `src/auth.js`), spent through the `spend_points` database function before the chat opens. The balance shows in the hub header; tapping it opens the account sheet.
- **Ledger.** Every change is a row in `public.point_ledger` (sign-up, talk, admin grant, purchase). Purchases are idempotent on the Stripe session id.
- **Admin.** Emails listed in `public.admin_emails` become admins on sign-up; admins can also promote others. Admins open the Admin screen from the account sheet to see every user, give or take points, and edit the point packs for sale.
- **Coupons.** Admins create codes (a custom one or a batch of generated `MOMO-…` codes) with a point value, a use limit per code, and an optional claim-by date. Users redeem a code from the account sheet; each account can use a code once and the points land in the ledger as `coupon`.
- **Admin URL.** `/admin` opens the admin screen directly for signed-in admins (Vercel rewrites it to the app in `vercel.json`); everyone else is sent home.
- **Buying points.** Point packs (`public.point_packs`) are sold through Stripe Checkout. `api/checkout.js` creates the session and `api/stripe/webhook.js` adds the points once Stripe reports payment. Until Stripe is configured the Buy buttons read “Soon”.

### Admin: AI keys, music, and sounds

The admin screen (`/admin`) has three more tabs, modeled on Story in the Air:

- **AI keys.** Save an ElevenLabs key (music and sound effects) and optionally a Gemini key (batch planning). Keys are verified with the provider, stored in `public.app_settings` (admins only), and never shown again; `ELEVENLABS_API_KEY` / `GEMINI_API_KEY` environment variables act as fallbacks.
- **Music.** Compose instrumental background tracks with ElevenLabs Music (`api/admin/music.js`). Pick a starter idea, write a prompt, choose a length, or make the whole starter set. With a Gemini key, "Plan with Gemini and compose" invents a batch and makes them one by one.
- **Sounds.** Make short effects with ElevenLabs Sound Effects (`api/admin/sfx.js`): meows, purrs, paws crawling, room ambience, and more. Each clip ends with a `[tag]` such as `[meow]` that is unique in the library.

Files land in the public `bgm` and `sfx` storage buckets and rows in `bgm_tracks` / `sfx_clips`; any signed-in user can read active items (`listActiveAudio` in `src/auth.js`) for playback in the app. These functions act with the admin's own session under row level security, so they work without the Supabase secret key. Set `ELEVENLABS_API_BASE` to point the functions at a stub for tests.

### Server functions

The `api/` folder holds Vercel functions (Web `Request`/`Response` handlers) and `server/` their shared helpers. During `npm run dev` the Vite plugin in `tools/dev-api.js` serves the same functions at `/api/*`, reading secrets from `.env`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | register, checkout, webhook | Instant sign-up without a confirmation email; crediting purchased points. Without it, sign-up falls back to Supabase's confirmation email. |
| `STRIPE_SECRET_KEY` | checkout, webhook | Creates Checkout sessions and verifies webhooks. |
| `STRIPE_WEBHOOK_SECRET` | webhook | Signing secret of the `checkout.session.completed` webhook endpoint (`https://<your-domain>/api/stripe/webhook`). |

Set the same three variables on Vercel (`vercel env add NAME production`), then add the webhook endpoint in the Stripe dashboard. To test payments locally:

```sh
stripe listen --forward-to localhost:8090/api/stripe/webhook   # prints a whsec_… for .env
```

Use card `4242 4242 4242 4242` in test mode. The points appear on the hub a moment after Checkout returns to the app.

The remote `chat-widget.js` is loaded as an opaque third-party dependency. Its source was not read or modified. Integration uses the existing config and lifecycle calls. The surrounding talk surface adopts the saved background and provides a connection-error message. The widget's redundant fullscreen button is hidden because this screen already occupies the viewport. Live calling still depends on the hosted service, network and microphone permission.

Automated tests stub the external widget at its integration boundary, without loading its source, and verify local persistence, legacy migration, independent edits, mobile layouts, gesture cancellation, stamping and keyboard focus. A separate manual browser check verified the real widget rendered the avatar over the saved background; voice calls were not exercised.

## Artwork

The interface uses portraits rendered from the repository's own VRM assets. To regenerate them, start the dev server on port 8090 and run `node tools/render-portraits.mjs`. No model or facial texture assets are changed by portrait rendering.

### Thai and English

Use the **English / ไทย** buttons in each screen's header. The language choice is saved on this device. Menus, tool hints, dialogs, preset choices, the highlighted prompt recipe and practice replies switch together. Thai fonts are bundled locally.

Names and custom instructions stay exactly as written. Structured recipes are generated in the selected language when saving a prompt or starting a chat; color-only edits preserve the saved prompt and its language. Legacy free-text prompts are retained, with an explicit conversation-language instruction added when chatting. Changing language during a call updates the app immediately; the next conversation uses the new language without interrupting the current call.

The known rendered chat controls and account labels are translated through a narrowly scoped DOM adapter. It does not read or modify `chat-widget.js`, translate chat transcripts, or change account values. The real widget's Thai control labels were verified, but live voice responses were not tested.
