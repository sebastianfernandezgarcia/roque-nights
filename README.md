# Roque Nights

**An agent-native night sky observing planner.** Plan tonight's observing session *together* with your AI agent: it reads the same sky you see, moves the same map you touch, and every computation runs in your browser — no server, no account, no API key.

Built from the Roque de los Muchachos observatory (La Palma, Canary Islands — a Starlight Reserve and home of the world's largest optical telescope), works for any coordinates on Earth.

> 🚧 In active development for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com) (deadline Sep 3, 2026).

## Try it with an agent

- **Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, reload the page.
- **ChatGPT desktop app**: open the page in the built-in browser and use **Site tools**.

## Why WebMCP

All the astronomy here is computed client-side (astronomy-engine, deterministic ephemeris). There is no API a traditional MCP server could wrap: the only way an agent can plan a night with you is through the living page itself — reading what you're looking at, proposing a plan you can see, and pointing the sky map you both share.

## License

[MIT](./LICENSE) · uses [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT).
