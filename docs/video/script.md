# Roque Nights · submission video script (v2, 2:35 target, hard cap 3:00)

Voice: Sebastián, English, calm and concrete, ~150 words per minute. Read the **VO** lines only. Screen actions are what the recording shows; subtitles quote the bold fragments.

Changes from v1: numbers now match what the app really says (September 13 is a **thin Moon**, not new Moon; the Saturn line no longer quotes times that depend on the clock), the ghost-plan beat gives the human's clicks their own moment, the closing states the WebMCP argument in one sentence, and every scene has a spare second so the voice never has to rush.

| Time | Scene (screen) | VO |
|---|---|---|
| 0:00–0:14 | **Cold open.** Your footage of the Roque at night if you send it; otherwise the whole-sky dome slowly rotating with the title held back. | Hi, I'm Sebastián. I'm an AI engineer at the Gran Telescopio Canarias, the largest optical telescope in the world, here on La Palma. This is one of the best night skies on Earth. And planning a good night under it is still surprisingly hard. |
| 0:14–0:28 | **Title.** "ROQUE NIGHTS" tracks in over the dome, tagline "Plan the sky with your agent". Cut to the app at 1920×1080, night sky, WebMCP badge lit. | This is Roque Nights: an observing planner where you and your AI agent share the same instrument. Not an API behind a page. **One live sky map, two operators.** |
| 0:28–0:44 | **Onboarding.** First visit: the four-step tour, the prompt copied with one click, "Copied". Tour closes, the Agent tools panel is visible with eleven rows lit (the badge reads 11 TOOLS; the other four appear once a plan exists). | I open it in a WebMCP browser. The page registers its tools right here, in the DOM: **fifteen WebMCP tools, eleven always live**, no server behind them. I paste one prompt: **plan me a three-hour night, best night in the next two weeks, avoiding the Moon.** |
| 0:44–1:02 | **Agent at work.** Chip "TOOL CALL · rank_nights" lights; the night chip jumps to 13/09/2026; then point_sky_map swings the dome to M13, M31, Saturn, the Pleiades, one every three seconds, each row flashing in the panel. | Watch the panel. The agent ranks the nights and picks **September thirteenth: a thin Moon, nine hours of darkness.** And the sky map moves. **The agent is pointing the dome at each target while I watch.** |
| 1:02–1:20 | **Favorites.** Cursor double-clicks Andromeda, then the Pleiades: dashed amber rings, Inspector lists "Favorites: M31, M45". Chip "TOOL CALL · describe_current_view". | Now the part I care about. I tap the sky and mark **Andromeda and the Pleiades as favorites.** No typing. Just a gesture on the map. I ask the agent to build the plan around them. **It reads my gesture through describe_current_view.** |
| 1:20–1:38 | **Ghost plan.** Chip "TOOL CALL · propose_plan": dotted blocks appear on the timeline with a "proposed by agent" card. Cursor clicks Accept on each item, then "Commit accepted"; blocks turn solid. | It answers with a plan I can see before it exists: **a ghost plan.** Nothing is committed until I say so. I review it, **item by item**, and confirm. |
| 1:38–2:00 | **Another sky.** Chip "TOOL CALL · set_observing_site": header reads Mauna Kea. Banner "This plan was built for a different sky". Cursor clicks "Revalidate plan": blocks slide into the new night; result line "4 kept, 4 moved, 0 dropped". Chip "TOOL CALL · export_plan", "Copy share link" → "Copied". | The plan is portable. I move the app to **Mauna Kea.** The app flags it at once: **this plan was built for a different sky.** One click revalidates it: every block slides into Hawaii's own darkness. Then I export it: JSON, calendar, or **a share link that carries the whole plan.** |
| 2:00–2:22 | **Closing dome.** Whole sky, play ×600, stars wheeling; the panel column fades out. | Everything runs in the browser. **Zero servers. All the astronomy computed locally.** That is why WebMCP is the only way an agent could ever work here: **it doesn't scrape my interface. It uses the same instrument I do.** |
| 2:22–2:35 | **Outro.** Logo, "Plan the sky with your agent.", URL roque-nights.netlify.app, github.com/sebastianfernandezgarcia/roque-nights, MIT. | Roque Nights. **Plan the sky with your agent.** Open source, live now, built from the Roque de los Muchachos. |

## Facts the video may state (verified against the deployed app on 2 Sep 2026)

- Tools registered: 15 in total, 11 always, 4 contextual (they appear when a plan or a proposal exists).
- Best astronomical night 2 Sep–16 Sep 2026 at the Roque: **2026-09-13**, score 90, 8.97 usable dark hours, Moon 8 % (waxing crescent). Runner-ups: 09-12 (score 89, Moon 4 %), 09-11 (89, Moon 1 %).
- Darkness at the Roque on 09-13: 21:38–06:36 local.
- Revalidation Roque → Mauna Kea keeps M13, M31, Saturn and M45 observable; every block moves into Mauna Kea's darkness (19:39–04:55 HST). Exact block times are captured in `video/public/clips/log.json` by the recording.

## Recording notes

- Subtitles: the bold fragments only, one line, IBM Plex Mono, amber for the tool names.
- Tool chips: appear the moment `executeTool` resolves, stay 2.4 s, top-left of the screen area: `TOOL CALL · rank_nights`.
- If the voice runs long on a scene, the scene's clip is extended by holding its last frame, never by speeding the clip up.
