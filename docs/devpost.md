# Devpost submission text (paste-ready, English)

## Project name

Roque Nights

## Tagline (under 60 characters)

Plan the night sky with your agent. One instrument, two operators.

## About the project

**Roque Nights is an observing planner where a person and an AI agent share the same instrument.** It computes a night from scratch in the browser: sunset and twilight, the true astronomical darkness window, Moon rise, set and illumination, and the altitude of every one of the 110 Messier objects, the planets and the Moon over a 5,044-star dome. Then it hands that instrument to your agent through fifteen WebMCP tools registered on the page itself.

I am an AI engineer at the Gran Telescopio Canarias on La Palma, next to one of the darkest skies on Earth. Planning a good night is still tedious: which night has no Moon, what is high when it is dark, how long each target stays above thirty degrees, what to do when the weather sends you to another mountain. Every existing tool answers one of those questions with a table. None of them lets an agent work the sky with you.

**What happens in a session.** You open the page in ChatGPT's browser (Site tools) or in Chrome with the WebMCP flag, and paste one prompt: "Plan me a three-hour night, best night in the next two weeks, avoiding the Moon." The agent calls `rank_nights` and picks September 13 (a thin Moon, nine hours of darkness). It calls `find_observable_targets` and gets candidates with observing windows, and the rejects with reasons. It calls `point_sky_map` and the dome swings to each target with an easing animation while you watch; the row lights up in the Agent tools panel. You double-click Andromeda and the Pleiades on the map to mark them as favorites; the agent reads that gesture through `describe_current_view` and answers with `propose_plan`: a dotted ghost plan on the night timeline that you accept or reject item by item before anything is committed. Move the site to Mauna Kea and the plan is flagged as built for a different sky; one click revalidates every block into Hawaii's own darkness. Export it as JSON in the open `observing-plan.v1` schema, as a calendar, or as a share link that carries the whole plan, so a friend's agent can revalidate it for their latitude.

**What is real today.** Fifteen imperative tools plus one declarative form, contextual registration (plan tools appear when a plan exists, `commit_proposal` when a proposal is pending, and the tool that causes the change reports `tools_added` and `tools_removed`), a human-in-the-loop primitive (propose, review, commit) that never blocks the agent's turn, explicit polar-night and unknown-time-zone handling, structured errors that an agent can recover from, a fuzz test of 14 tools times 12 malformed inputs, 1,035 tests, and a browser-level audit that drives all sixteen calls through `document.modelContext.executeTool` in a real Chromium. Live at roque-nights.netlify.app, MIT licensed.

**What it is not yet.** Weather is only in the site comparison tool (Open-Meteo, one request for 28 dark-sky sites), not in the per-target windows. No custom targets beyond the catalog. No session log. Those are the roadmap, not the demo.

## Why WebMCP

**How the project fits WebMCP.** There is no Roque Nights API. Every number on the page is computed locally with astronomy-engine, on the visitor's machine, from a vendored star catalog. A classic MCP server has nothing to wrap here: there is no endpoint behind the page, and inventing one would mean recomputing the same ephemeris on someone else's machine. What an agent actually needs is the running page: the night the person selected, the object they are looking at, the plan they are halfway through. WebMCP is the only way an agent can reach that, so this is not a website that also has an API. It is one instrument with two operators, and WebMCP is the second seat.

**How it improves the user experience.** Planning stops being a conversation about a table and becomes a shared session over the sky. The person keeps every gesture they already know (drag the dome, tap an object, drag the time slider) and gains an operator who can rank sixty nights in a second and point the map for them. The agent's proposals arrive as a ghost plan on the timeline, so review is visual and item by item; a rejected item goes back to the agent with the person's reason. The Agent tools panel shows, in plain words, what the agent can do on this page and lights up the tool it is calling, so the person never wonders what just happened. Every tool returns a quotable summary plus the numbers behind it, so the agent can explain instead of assert.

**What human and agent can do together that was not possible before.** Point at the same sky. The person marks a favorite with a double-click and the agent reads that gesture, with its timestamp, through `describe_current_view`; the agent swings the dome to Saturn and the person sees it move. Neither could do the other's part: the agent has no hands on the map and the person has no patience for sixty ephemeris calls. And the plan they build together is portable: exported in an open schema with the site and the night it was built for, a share link re-imports it on another sky as a new proposal, revalidated target by target, with the reasons for what no longer works. Two agents, two skies, one plan negotiated between them.

**How it is implemented.** Vite, React 19 and TypeScript. A vanilla Zustand store is the single source of truth; every action carries `source: 'human' | 'agent'`, and the fifteen tools are thin wrappers over the same store actions the buttons call, so bidirectionality is a property of the architecture rather than a feature. Tools are registered at module level, outside React, because StrictMode's double mount silently unregisters tools created in an effect. The sky is a canvas 2D stereographic projection fed by a pure scene builder, with one J2000-to-horizontal rotation per frame (about 1 ms for the whole dome). Contextual tools register and unregister through `AbortController`s as the plan changes, with deactivation deferred until no tool call is in flight. The declarative API is used for the site form (`toolname` plus `agentInvoked` and `respondWith`), sharing one validation function with the imperative twin. Data: d3-celestial catalogs (BSD-3), astronomy-engine (MIT), Open-Meteo (CC BY 4.0). Everything is open source under MIT.

## Built with (tags)

webmcp, typescript, react, vite, zustand, astronomy-engine, canvas, tailwindcss, vitest, playwright, netlify, open-meteo, d3-celestial, remotion

## Links

- Live app: https://roque-nights.netlify.app
- Repository: https://github.com/sebastianfernandezgarcia/roque-nights
- Open plan schema: https://roque-nights.netlify.app/schemas/observing-plan.v1.json
- Video: (YouTube URL, to add)

## Try it (for judges)

1. Chrome 149+: enable `chrome://flags/#enable-webmcp-testing`, restart, open the live URL; the header badge reads WEBMCP LIVE · 11 TOOLS (four more appear once a plan exists).
2. ChatGPT desktop (GPT-5.6 Sol or Terra): open the URL in the built-in browser, turn on Site tools, paste the prompt from the first-visit tour.
3. Without a WebMCP browser: the Agent harness panel at the bottom of the right column runs the same tool objects and logs them the same way.
