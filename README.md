<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8236605a-df5a-44ec-9ef5-274f3226f5df

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `VITE_GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Call Compliance Endpoint Tester

If you are submitting to an external endpoint tester, use the backend endpoint below (not the Vite frontend URL).

### Required environment variables

- `GEMINI_API_KEY`: Gemini server key used for audio analysis.
- `ENDPOINT_API_KEY`: shared secret expected in request header `x-api-key`.

### Start API server

`npm run start`

### Endpoint URL

`POST /api/call-compliance`

### Required Header

- `x-api-key: <ENDPOINT_API_KEY>`

### Accepted audio request formats

- `multipart/form-data` with an audio file field (for example `audio` or `file`)
- JSON body with one of: `audioBase64`, `audio_base64`, `audio`, `voice_input`, `file`

### Response shape

The endpoint returns these top-level fields exactly:

- `transcript`
- `summary`
- `sop_validation`
- `analytics`
- `keywords`
