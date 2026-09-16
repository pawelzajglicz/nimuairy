import { defineConfig } from 'orval';

/**
 * Generates the Angular API client from the backend's OpenAPI contract.
 *
 * The spec is read from the running backend (`dev` profile, port 8000), so the
 * backend must be up when running `npm run api:generate`. There is deliberately
 * no build-time generation: `ng build` uses the committed output below.
 *
 * Everything under src/app/api/generated/ is generated — never edit it by hand.
 */
export default defineConfig({
  nimuairy: {
    input: {
      target: 'http://localhost:8000/v3/api-docs',
    },
    output: {
      client: 'angular',
      target: 'src/app/api/generated/nimuairy-api.ts',
      schemas: 'src/app/api/generated/model',
      override: {
        angular: {
          // GET endpoints -> httpResource() signals, everything else -> HttpClient service.
          client: 'httpResource',
        },
      },
    },
  },
});
