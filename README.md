# AOABot

AOABot is the TeamAOA water rocket project assistant.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `GEMINI_API_KEY` in `.env.local` to enable Gemini responses. The key is read only by the server-side `/api/chat` route and is never exposed to the browser. `GEMINI_MODEL` is optional and defaults to `gemini-3-flash-preview`. The route uses Gemini's Interactions API and falls back across available models when a model is unavailable or overloaded.

The assistant is constrained by a project-grounded system prompt and does not invent missing rocket or telemetry values. The conversation remains available while the page is open and resets to a fresh chat after a browser refresh. The API validates request size, rate-limits clients, applies local safety checks, and uses Gemini safety settings.

Never commit a real API key. If a real key was placed in `.env.example` or committed anywhere, revoke it and create a replacement key.

## Next.js setup

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
