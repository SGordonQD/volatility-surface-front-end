# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Run With Docker (Frontend + API)

This repo now includes:

- `Dockerfile` (builds frontend assets and serves with `nginx`)
- `nginx.conf` (proxies websocket `/ws` to the `api` container)
- `docker-compose.yml` (starts `frontend` + `api`)

### 1. Build and run

```bash
docker compose up --build
```

- Frontend: `http://localhost:8080`
- API websocket expected on container `api:8765` (proxied via `/ws`)

### 2. Point compose at your API image

By default, compose uses `svi-api:latest`:

```bash
SVI_API_IMAGE=your-registry/your-api:tag docker compose up --build
```

If your API source is local, replace `api.image` in `docker-compose.yml` with a `build:` block for your API project.

### 3. Override websocket URL (optional)

The frontend resolves websocket URL in this order:

1. `VITE_SVI_WS_URL` (if set)
2. `ws://localhost:8765` (default)

To connect frontend directly to a remote API (example EC2):

```bash
VITE_SVI_WS_URL=ws://3.9.118.165:8765 docker compose up --build frontend
```

Local dev server:

```bash
VITE_SVI_WS_URL=ws://3.9.118.165:8765 npm run dev
```

If you serve the frontend over `https`, use a `wss://...` endpoint (or the browser will block mixed content).

## Export Build Into Another Repo

If another project serves this frontend from `frontend/dist`, use:

```bash
npm run build:export -- /absolute/path/to/other-repo/frontend
```

Equivalent with env var:

```bash
TARGET_FRONTEND_DIR=/absolute/path/to/other-repo/frontend npm run build:export
```

## Runtime Debug Mode

Enable feed diagnostics in browser:

```js
localStorage.setItem("SVI_DEBUG", "1")
location.reload()
```

This prints `[svi-debug] feed` samples every 5s and exposes the latest metrics at `window.__SVI_DEBUG__`
(queue depth, dropped messages, flush timing, tracked strikes/expiries).

To inspect captured runtime crashes:

```js
JSON.parse(localStorage.getItem("SVI_CRASH_LOG") || "[]")
```

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
