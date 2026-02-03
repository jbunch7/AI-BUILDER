Remodel Builder (V1)
===================

This app is a **"choose-your-finishes"** remodel configurator:

1) User uploads a real photo of a space (interior or exterior)
2) The server **scans** the image into a scene graph + coarse masks
3) The UI presents finish options (paint colors, flooring, etc.)
4) The user selects options and the server renders a **photoreal** updated version of the exact same space

## Environment Variables

Set these in Vercel (Project Settings → Environment Variables):

**Required**
- `OPENAI_API_KEY`

**Required in production (API origin protection)**
- `ALLOWED_EMBED_HOSTS` (comma-separated hostnames; no paths)
  - Example: `ALLOWED_EMBED_HOSTS="yourdomain.com,www.yourdomain.com"`

**Recommended**
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (persistence for scans/jobs)
- `WORKER_SECRET` (protects the render worker endpoint)

**Optional**
- `SCANNER_MODEL` (default: `gpt-4.1-mini`)
- `IMAGE_MODEL` (default: `gpt-image-1.5`)
- `OVERLAY_LOGO` (default: `true`)
- `EMBED_TOKEN_SECRET` (only if you want to gate the homepage with a signed token)

**Optional (recommended for pixel-level auto masking)**
- `MASK_SERVICE_URL` (example: `http://localhost:8080`)
  - When set, `/api/scan` will call a mask-refinement service to convert coarse polygons into
    **pixel-accurate alpha masks** for instant previews in the builder.
  - See `services/masker/` (GrabCut-based reference service).
- `MASK_SERVICE_SECRET` (optional shared secret header)
- `MASK_SERVICE_TIMEOUT_MS` (default: `12000`)
- `MASK_PREVIEW_MAX_SIDE` (default: `1200`) — preview mask resolution cap

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

Open [http://localhost:3000](http://localhost:3000) with your browser.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

Key endpoints
-------------

- `POST /api/scan` (multipart form-data: `image`) → `{ scanId, sceneGraph, autoMasks? }`
- `POST /api/options` (`{ scanId }`) → `{ modules, defaultSelections }`
- `POST /api/render` (`{ scanId, selections }`) → `{ jobId }`
- `GET /api/job/:id` → job status + image (base64)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
